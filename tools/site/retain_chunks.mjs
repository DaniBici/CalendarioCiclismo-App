#!/usr/bin/env node
// Conserva en `_site` los chunks de despliegues anteriores durante unos días.
//
// Los chunks de `js/chunks/` llevan un hash del contenido en el nombre y
// cambian en cada despliegue que cambia el JS. El HTML y las entradas se
// cachean 10 minutos (max-age=600) en el navegador y en la CDN de GitHub
// Pages, cada URL por su cuenta: tras un despliegue, un HTML o una entrada
// anteriores aún en caché importan chunks que el sitio nuevo ya no publica, el
// import falla con 404 y la página queda sin JS (capa de carga hasta su
// fallback, contenido sin interacción).
//
// Va después de `version_assets.py`: los chunks retenidos se publican tal como
// se descargan (con sus imports `?v=` anteriores) y no entran en la versión del
// sitio. `js/chunks/chunk-index.json` registra los chunks publicados: `null`
// los vigentes y la fecha de retirada los retenidos. Cada build lee el índice
// del sitio publicado y descarga de allí los retenidos que no hayan caducado.
// Sin índice publicado o sin red, avisa y publica solo los vigentes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RETAIN_DAYS = 7;
export const INDEX_FILE = 'chunk-index.json';
const CHUNK_NAME = /^[\w-]+\.js$/;
const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 15_000;
const CONCURRENCY = 8;

/**
 * Chunks que conservar: los del índice publicado que ya no son vigentes y se
 * retiraron hace menos de `days` días. Un chunk recién retirado toma `now`.
 */
export function planRetention(published, current, now, days = RETAIN_DAYS) {
  const vigentes = new Set(current);
  const retain = [], expired = [];
  for (const [name, retiredAt] of Object.entries(published ?? {})) {
    if (!CHUNK_NAME.test(name) || vigentes.has(name)) continue;
    const parsed = retiredAt ? Date.parse(retiredAt) : NaN;
    const since = Number.isNaN(parsed) ? now : parsed;
    if (now - since > days * DAY_MS) expired.push(name);
    else retain.push({ name, retiredAt: new Date(since).toISOString() });
  }
  return { retain, expired };
}

async function readPublishedIndex(live, now, fetchImpl) {
  const response = await fetchImpl(`${live}/js/chunks/${INDEX_FILE}?t=${now}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body?.chunks ?? {};
}

async function download(live, name, fetchImpl) {
  const response = await fetchImpl(`${live}/js/chunks/${name}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length) throw new Error('vacío');
  return body;
}

/** Añade a `site` los chunks retenidos del sitio publicado `live` y escribe el índice. */
export async function retainChunks(site, { live, days = RETAIN_DAYS, now = Date.now(), fetchImpl = fetch, warn = console.warn } = {}) {
  const dir = join(site, 'js', 'chunks');
  const current = existsSync(dir) ? readdirSync(dir).filter(name => CHUNK_NAME.test(name)) : [];
  let published = {};
  try {
    const index = await readPublishedIndex(live, now, fetchImpl);
    if (index === null) warn(`Sin ${INDEX_FILE} publicado: solo los chunks vigentes`);
    else published = index;
  } catch (error) {
    warn(`::warning::No se pudo leer ${INDEX_FILE} de ${live} (${error.message}): solo los chunks vigentes`);
  }
  const { retain, expired } = planRetention(published, current, now, days);
  const index = Object.fromEntries(current.map(name => [name, null]));
  const failed = [];
  let bytes = 0;
  const queue = [...retain];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const body = await download(live, item.name, fetchImpl);
        writeFileSync(join(dir, item.name), body);
        index[item.name] = item.retiredAt;
        bytes += body.length;
      } catch (error) {
        failed.push(item.name);
        warn(`::warning::Chunk retirado ${item.name} no descargado (${error.message})`);
      }
    }
  }));
  const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(dir, INDEX_FILE), `${JSON.stringify({ chunks: sorted }, null, 1)}\n`);
  return { current: current.length, retained: retain.length - failed.length, bytes, expired: expired.length, failed: failed.length };
}

function main(argv) {
  const site = resolve(argv[0] ?? '');
  const option = name => { const at = argv.indexOf(name); return at > 0 ? argv[at + 1] : undefined; };
  if (!argv[0] || !existsSync(join(site, 'CNAME'))) {
    console.error('Uso: retain_chunks.mjs <directorio-del-sitio> [--live <url>] [--days <n>]');
    return Promise.resolve(2);
  }
  const live = (option('--live') ?? `https://${readFileSync(join(site, 'CNAME'), 'utf8').trim()}`).replace(/\/$/, '');
  const days = Number(option('--days') ?? RETAIN_DAYS);
  const started = Date.now();
  return retainChunks(site, { live, days }).then(summary => {
    console.log(`Chunks: ${summary.current} vigentes, ${summary.retained} retenidos (${Math.round(summary.bytes / 1024)} KB), `
      + `${summary.expired} caducados, ${summary.failed} sin descargar; ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return 0;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
