#!/usr/bin/env node
// Empaqueta el JS y el CSS públicos de `_site` con esbuild.
//
// Las fuentes se sirven como módulos ES sueltos: una página pública descarga
// 50-60 ficheros encadenados por sus `import` (7-8 niveles, un RTT cada uno).
// Este paso se ejecuta tras componer `_site` y antes de `version_assets.py`:
//
// - Cada <script type="module"> de las páginas y cada módulo cargado con
//   `import()` literal es un punto de entrada. Su salida conserva ruta y nombre
//   (`js/jornada.js`), así que el HTML no cambia y las URL de las páginas
//   antiguas en caché siguen resolviendo.
// - El código compartido entre puntos de entrada va a `js/chunks/*` con nombre
//   por contenido; solo se carga junto a la entrada que lo importa.
// - Los <script> clásicos (theme.js, cookie-consent.js…) solo se minifican:
//   comparten globals y orden de carga con config.js.
// - El CSS de `css/*.css` se aplana (`@import` de tokens y tipografías) y se
//   minifica, lo que elimina la cadena de hojas del primer pintado.
//
// `js/panel/` y `js/vendor/` quedan sin empaquetar: el panel usa el cliente
// completo de Supabase y carga sus propios módulos. Si un módulo de `js/panel/`
// entrase en un paquete público, el paso falla: dos instancias de shared.js
// darían dos clientes (uno sin sesión).
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const ATTR_SRC = /\bsrc\s*=\s*["']([^"']+)["']/i;
const ATTR_TYPE = /\btype\s*=\s*["']([^"']+)["']/i;
const IMPORT_LITERAL = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+\.m?js)(?:\?[^"']*)?["']/g;
const DYNAMIC_LITERAL = /\bimport\s*\(\s*["']([^"']+\.m?js)["']\s*\)/g;
const EXCLUDED_SEGMENTS = ['vendor', 'panel', 'chunks', '__tests__'];
const NOT_BUNDLED_FILES = new Set(['config.js', 'config.template.js']);

/** Rutas de fichero absolutas de un especificador local, o null si no es local. */
export function resolveLocal(specifier, fromDir, site) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier) || specifier.startsWith('//')) return null;
  const clean = specifier.split(/[?#]/)[0];
  const target = clean.startsWith('/') ? join(site, clean) : resolve(fromDir, clean);
  const rel = relative(site, target);
  return rel.startsWith('..') ? null : target;
}

function bundlable(file, site) {
  const rel = relative(join(site, 'js'), file);
  if (rel.startsWith('..')) return false;
  const parts = rel.split(/[\\/]/);
  if (!/\.m?js$/.test(file) || NOT_BUNDLED_FILES.has(parts.at(-1))) return false;
  return !parts.slice(0, -1).some(part => EXCLUDED_SEGMENTS.includes(part));
}

/**
 * Entradas de un HTML: módulos (`src` de <script type="module">, imports de
 * módulos en línea) y scripts clásicos (`src` sin type="module").
 */
export function scriptsOfHtml(html, htmlDir, site) {
  const modules = new Set();
  const classic = new Set();
  for (const [, attrs, body] of html.matchAll(SCRIPT_TAG)) {
    const type = ATTR_TYPE.exec(attrs)?.[1]?.toLowerCase();
    const src = ATTR_SRC.exec(attrs)?.[1];
    if (src) {
      const file = resolveLocal(src, htmlDir, site);
      if (file) (type === 'module' ? modules : classic).add(file);
    } else if (type === 'module') {
      for (const match of body.matchAll(IMPORT_LITERAL)) {
        const file = resolveLocal(match[1], htmlDir, site);
        if (file) modules.add(file);
      }
    }
  }
  return { modules, classic };
}

function walk(directory, visit) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, visit);
    else visit(path);
  }
}

/** Módulos que otro módulo carga con `import('./literal.js')` (cierre transitivo). */
function lazyTargets(roots, site) {
  const found = new Set();
  const queue = [...roots];
  const seen = new Set(queue);
  while (queue.length) {
    const file = queue.pop();
    const source = readFileSync(file, 'utf8');
    const dir = dirname(file);
    for (const match of source.matchAll(DYNAMIC_LITERAL)) {
      const target = resolveLocal(match[1], dir, site);
      if (target && bundlable(target, site) && existsSync(target)) found.add(target);
    }
    for (const match of source.matchAll(IMPORT_LITERAL)) {
      const target = resolveLocal(match[1], dir, site);
      if (target && bundlable(target, site) && existsSync(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return found;
}

export function discover(site) {
  const modules = new Set();
  const classic = new Set();
  walk(site, path => {
    if (!path.endsWith('.html')) return;
    const found = scriptsOfHtml(readFileSync(path, 'utf8'), dirname(path), site);
    found.modules.forEach(file => modules.add(file));
    found.classic.forEach(file => classic.add(file));
  });
  const entries = new Set([...modules].filter(file => bundlable(file, site) && existsSync(file)));
  for (const target of lazyTargets(entries, site)) entries.add(target);
  const scripts = [...classic].filter(file => bundlable(file, site) && existsSync(file) && !entries.has(file));
  return { entries: [...entries].sort(), classic: scripts.sort() };
}

const format = bytes => `${(bytes / 1024).toFixed(0)} KB`;

async function bundleModules(site, entries) {
  const jsDir = join(site, 'js');
  // pdf.js (js/vendor/pdfjs) se carga bajo demanda y es grande: se deja fuera
  // con ruta absoluta, porque un `import('../vendor/…')` relativo dejaría de
  // resolver al moverse a un chunk. postgrest-js sí se empaqueta.
  const keepVendorExternal = {
    name: 'vendor-external',
    setup(api) {
      api.onResolve({ filter: /\/vendor\/pdfjs\// }, args => {
        if (args.kind !== 'dynamic-import' && args.kind !== 'import-statement') return null;
        const file = resolve(args.resolveDir, args.path);
        return { path: '/' + posix.join('js', relative(jsDir, file).split('\\').join('/')), external: true };
      });
    },
  };
  const result = await build({
    entryPoints: entries,
    outdir: jsDir,
    outbase: jsDir,
    bundle: true,
    splitting: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    entryNames: '[dir]/[name]',
    chunkNames: 'chunks/[name]-[hash]',
    external: ['https://*', 'http://*'],
    plugins: [keepVendorExternal],
    metafile: true,
    allowOverwrite: true,
    logLevel: 'warning',
  });
  const panelInputs = Object.keys(result.metafile.inputs).filter(input => /(^|\/)js\/panel\//.test(input));
  if (panelInputs.length) {
    throw new Error(`Un paquete público incluye módulos del panel: ${panelInputs.slice(0, 5).join(', ')}`);
  }
  const outputs = Object.entries(result.metafile.outputs);
  const chunks = outputs.filter(([path]) => path.includes('/chunks/'));
  const total = outputs.reduce((sum, [, meta]) => sum + meta.bytes, 0);
  console.log(`JS: ${entries.length} entradas, ${chunks.length} chunks, ${format(total)} en total`);
  return result.metafile;
}

async function minifyClassic(files) {
  let before = 0;
  let after = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Sin renombrar globals: los scripts clásicos comparten el ámbito global.
    const { code } = await transform(source, {
      loader: 'js', minifyWhitespace: true, minifySyntax: true, legalComments: 'none', target: 'es2022',
    });
    writeFileSync(file, code);
    before += source.length;
    after += code.length;
  }
  console.log(`Scripts clásicos: ${files.length} minificados, ${format(before)} → ${format(after)}`);
}

async function bundleCss(site) {
  const cssDir = join(site, 'css');
  if (!existsSync(cssDir)) return;
  const files = readdirSync(cssDir).filter(name => name.endsWith('.css')).map(name => join(cssDir, name));
  if (!files.length) return;
  // Con los `url()` relativos intactos: la salida queda en el mismo directorio.
  const result = await build({
    entryPoints: files,
    outdir: cssDir,
    bundle: true,
    minify: true,
    legalComments: 'none',
    external: ['*.woff2', '*.woff', '*.png', '*.jpg', '*.jpeg', '*.webp', '*.svg', '*.gif', 'https://*'],
    allowOverwrite: true,
    metafile: true,
    logLevel: 'warning',
  });
  const total = Object.values(result.metafile.outputs).reduce((sum, meta) => sum + meta.bytes, 0);
  console.log(`CSS: ${files.length} hojas, ${format(total)} en total`);
}

/** Empaqueta `site`. Devuelve el resumen; lanza si falta algo o el panel se cuela. */
export async function bundleSite(site) {
  const { entries, classic } = discover(site);
  if (!entries.length) throw new Error('Sin puntos de entrada de módulos en el sitio');
  const metafile = await bundleModules(site, entries);
  await minifyClassic(classic);
  await bundleCss(site);
  return { entries, classic, outputs: Object.keys(metafile.outputs) };
}

async function main(argv) {
  const site = resolve(argv[0] ?? '');
  if (!argv[0] || !existsSync(join(site, 'index.html'))) {
    console.error('Uso: bundle_assets.mjs <directorio-del-sitio>');
    return 2;
  }
  const started = Date.now();
  await bundleSite(site);
  console.log(`Empaquetado en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
