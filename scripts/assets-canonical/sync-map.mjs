#!/usr/bin/env node
// Sincroniza en el VPS el `map` de nginx con asset-canonicals.json.
//
//   node scripts/assets-canonical/sync-map.mjs [--map /etc/nginx/cc-assets-canonicals.map]
//
// Descarga el JSON publicado por el build del sitio, genera el mapa, lo valida
// con `nginx -t` y recarga nginx. Si la validación falla, restaura el mapa
// anterior y termina con código 1. Sin cambios, no recarga. Instalación:
// docs/runbooks/assets-canonical-vps.md.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { buildNginxMap, MAP_URL } from './map.mjs';

const run = promisify(execFile);
const NGINX = process.env.NGINX_BIN || '/usr/sbin/nginx';
const DEFAULT_MAP = '/etc/nginx/cc-assets-canonicals.map';
const FETCH_TIMEOUT_MS = 30_000;

function mapPath(argv) {
  const index = argv.indexOf('--map');
  return index >= 0 && argv[index + 1] ? argv[index + 1] : DEFAULT_MAP;
}

async function readOptional(path) {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  const target = mapPath(process.argv.slice(2));
  const response = await fetch(MAP_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${MAP_URL}: HTTP ${response.status}`);
  const { text, count, skipped } = buildNginxMap(JSON.parse(await response.text()));

  const previous = await readOptional(target);
  if (previous === text) {
    console.log(`Sin cambios: ${count} rutas.`);
    return;
  }

  const temporary = `${target}.new`;
  await fs.writeFile(temporary, text, { mode: 0o644 });
  if (previous !== null) await fs.writeFile(`${target}.prev`, previous, { mode: 0o644 });
  await fs.rename(temporary, target);
  try {
    await run(NGINX, ['-t']);
  } catch (error) {
    if (previous !== null) await fs.writeFile(target, previous, { mode: 0o644 });
    else await fs.rm(target, { force: true });
    throw new Error(`nginx -t rechaza el mapa; restaurado el anterior: ${error.stderr || error.message}`);
  }
  await run(NGINX, ['-s', 'reload']);
  console.log(`Mapa actualizado: ${count} rutas (${skipped} descartadas).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
