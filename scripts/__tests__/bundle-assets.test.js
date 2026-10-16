import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleSite, resolveLocal, scriptsOfHtml } from '../../tools/site/bundle_assets.mjs';

const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

function makeSite(files) {
  const site = mkdtempSync(join(tmpdir(), 'cc-bundle-'));
  roots.push(site);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(site, name)), { recursive: true });
    writeFileSync(join(site, name), content);
  }
  return site;
}

const PAGE = '<!doctype html><script src="js/theme.js"></script><script type="module" src="/js/home.js"></script>';
const BASE = {
  'index.html': PAGE,
  'js/theme.js': 'var cc = { theme: 1 };\n// comentario\n',
  'js/home.js': "import { shared } from './shared.js';\nimport('./lazy.js').then(m => m.lazy(shared));\nexport const home = 1;\n",
  'js/lazy.js': "import { shared } from './shared.js';\nexport const lazy = value => value + shared;\n",
  'js/shared.js': "export const shared = 'compartido';\n",
  'js/vendor/lib/index.mjs': 'export const lib = 1;\n',
  'css/tokens.css': ':root { --a: 1; }\n',
  'css/app.css': "@import url('tokens.css');\nbody { color: var(--a); }\n",
};

describe('bundle_assets', () => {
  it('distingue módulos, scripts clásicos y rutas relativas en el HTML', () => {
    const site = '/site';
    const html = `<script src="js/theme.js"></script>
      <script type="module" src="../js/login.js"></script>
      <script type="module">import '/js/jornada.js'; import { a } from "/js/x.js?v=1";</script>
      <script src="https://cdn.example.com/x.js"></script>`;
    const found = scriptsOfHtml(html, '/site/panel', site);
    expect([...found.classic]).toEqual(['/site/panel/js/theme.js']);
    expect([...found.modules].sort()).toEqual(['/site/js/jornada.js', '/site/js/login.js', '/site/js/x.js']);
    expect(resolveLocal('//cdn.example.com/a.js', site, site)).toBeNull();
    expect(resolveLocal('../../fuera.js', '/site/js', site)).toBeNull();
  });

  it('conserva la URL de cada entrada, comparte código y aplana el CSS', async () => {
    const site = makeSite(BASE);
    const { entries } = await bundleSite(site);
    expect(entries.map(file => file.slice(site.length))).toEqual(['/js/home.js', '/js/lazy.js']);
    expect(readdirSync(join(site, 'js/chunks')).length).toBe(1);
    // Node real (no el cargador de vitest): las entradas empaquetadas se ejecutan.
    const script = `import { home } from ${JSON.stringify(pathToFileURL(join(site, 'js/home.js')).href)};
      import { lazy } from ${JSON.stringify(pathToFileURL(join(site, 'js/lazy.js')).href)};
      console.log(JSON.stringify([home, lazy('x')]));`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual([1, 'xcompartido']);
    expect(readFileSync(join(site, 'css/app.css'), 'utf8')).toContain('--a');
  });

  it('falla si un paquete público arrastra módulos del panel', async () => {
    const site = makeSite({
      ...BASE,
      'js/lazy.js': "import { x } from './panel/editor.js';\nexport const lazy = x;\n",
      'js/panel/editor.js': 'export const x = 1;\n',
    });
    await expect(bundleSite(site)).rejects.toThrow(/panel/);
  });
});
