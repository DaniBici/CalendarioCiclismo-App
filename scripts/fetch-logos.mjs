#!/usr/bin/env node
/**
 * fetch-logos.mjs — descarga los logos de carreras que las apps empaquetan.
 *
 * Los logos son obras de terceros (organizadores, federaciones) y NO se
 * redistribuyen en el repositorio: sus directorios están en .gitignore. Este
 * script los reconstruye desde `races.logoUrl` en Supabase, que es la fuente
 * de verdad.
 *
 * Cuándo ejecutarlo:
 *   - Tras clonar el repo en una máquina nueva (o tras formatear), ANTES de
 *     compilar iOS o Android. Sin esto las apps compilan, pero se quedan sin
 *     logo cuando no hay red (el bundle es el fallback offline).
 *   - Cuando se añadan carreras nuevas y quieras refrescar el bundle.
 *
 * Uso:
 *   node scripts/fetch-logos.mjs             # descarga lo que falte
 *   node scripts/fetch-logos.mjs --force     # re-descarga todo
 *   node scripts/fetch-logos.mjs --prune     # borra además los que ya no están en BD
 *
 * Requiere SUPABASE_ANON_KEY en el entorno o en .env (la clave publishable,
 * la misma que sirve la web; no hace falta la service_role).
 *
 * NOTA sobre optimización: `bundle-logos.yml` además redimensiona a 192 px y
 * comprime con pngquant/oxipng. Aquí NO se hace: requiere binarios de sistema y
 * el objetivo de este script es desbloquear un build local. Los logos pesan algo
 * más, lo que no afecta al funcionamiento. Para el bundle definitivo de una
 * release, lanza el workflow a mano (`workflow_dispatch`).
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile, access, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SUPABASE_URL = 'https://bcecwlkynpgovnzhbpah.supabase.co';
const IOS_DIR = join(REPO_ROOT, 'ios-app/CalendarioCiclismo/BundledLogos');
const ANDROID_DIR = join(REPO_ROOT, 'android-app/app/src/main/assets/bundled_logos');

const FORCE = process.argv.includes('--force');
const PRUNE = process.argv.includes('--prune');

/** Lee SUPABASE_ANON_KEY del entorno o, si no está, del .env de la raíz. */
async function resolveAnonKey() {
  if (process.env.SUPABASE_ANON_KEY) return process.env.SUPABASE_ANON_KEY;

  try {
    const { readFile } = await import('node:fs/promises');
    const env = await readFile(join(REPO_ROOT, '.env'), 'utf8');
    const match = env.match(/^SUPABASE_ANON_KEY\s*=\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    /* sin .env: caemos al error de abajo */
  }

  console.error(
    'FALTA SUPABASE_ANON_KEY.\n' +
      '  export SUPABASE_ANON_KEY=sb_publishable_...\n' +
      'o añádela al .env de la raíz. Es la clave publishable (la de js/config.js),\n' +
      'no la service_role.',
  );
  process.exit(1);
}

/**
 * Nombre de fichero de un logo. DEBE coincidir exactamente con el hashing de
 * CacheManager.swift (iOS) e ImageAssetCache.kt (Android): si cambia aquí, las
 * apps dejan de encontrar el fichero y pierden el fallback offline en silencio.
 */
function logoFilename(url) {
  const sha1 = createHash('sha1').update(url, 'utf8').digest('hex').slice(0, 20);
  let ext = 'img';
  try {
    const path = new URL(url).pathname;
    const dot = path.lastIndexOf('.');
    if (dot > 0 && dot < path.length - 1) ext = path.slice(dot + 1).toLowerCase().slice(0, 5);
  } catch {
    /* URL mal formada: se queda en .img, igual que en el workflow */
  }
  return `logo_${sha1}.${ext}`;
}

/** Trae todas las logoUrl de `races`, paginando (PostgREST corta en 1000). */
async function fetchLogoUrls(anonKey) {
  const urls = new Set();
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select: 'logoUrl',
      logoUrl: 'not.is.null',
      limit: '1000',
      offset: String(offset),
    });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/races?${params}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);

    const rows = await res.json();
    for (const row of rows) if (row.logoUrl) urls.add(row.logoUrl);
    if (rows.length < 1000) break;
  }
  return urls;
}

const exists = (p) => access(p).then(() => true, () => false);

async function main() {
  const anonKey = await resolveAnonKey();
  await mkdir(IOS_DIR, { recursive: true });
  await mkdir(ANDROID_DIR, { recursive: true });

  const logoUrls = await fetchLogoUrls(anonKey);
  console.log(`Logos únicos en BD: ${logoUrls.size}`);

  let downloaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const url of [...logoUrls].sort()) {
    const filename = logoFilename(url);
    const iosPath = join(IOS_DIR, filename);
    const androidPath = join(ANDROID_DIR, filename);

    if (!FORCE && (await exists(iosPath)) && (await exists(androidPath))) {
      skipped++;
      continue;
    }

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'CalendarioCiclismo-BundleBot/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(iosPath, buf);
      await writeFile(androidPath, buf);
      downloaded++;
    } catch (err) {
      console.error(`  ERROR ${url}: ${err.message}`);
      errors++;
    }
  }

  if (PRUNE) {
    const current = new Set([...logoUrls].map(logoFilename));
    for (const dir of [IOS_DIR, ANDROID_DIR]) {
      for (const name of await readdir(dir)) {
        if (name.startsWith('logo_') && !current.has(name)) {
          await unlink(join(dir, name));
          console.log(`  Purgado: ${name}`);
        }
      }
    }
  }

  console.log(`Descargados: ${downloaded} | Omitidos: ${skipped} | Errores: ${errors}`);
  if (errors > 0) {
    console.log('\nLos errores suelen ser logos cuya URL de origen ya no responde.');
    console.log('No bloquean el build: esas carreras caen al logo remoto o al placeholder.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
