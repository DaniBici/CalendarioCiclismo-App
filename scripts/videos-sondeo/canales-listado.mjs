#!/usr/bin/env node
// Enumera las últimas subidas de los canales de organizador marcados con "enumerar": true en canales.json
// y las guarda en la caché de búsquedas del sondeo bajo la clave `canal:<id>`. El emparejamiento de
// sondeo.mjs las usa para todas las jornadas: recupera vídeos oficiales que la búsqueda por relevancia
// de YouTube no devuelve (el plan recomienda esta pasada para los huecos).
//
//   node scripts/videos-sondeo/canales-listado.mjs --salida <carpeta> [--max 300] [--refrescar]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const salida = a[a.indexOf('--salida') + 1];
const maxPorDefecto = a.includes('--max') ? Number(a[a.indexOf('--max') + 1]) : 300;
const refrescar = a.includes('--refrescar');
if (!salida || salida.startsWith('--')) { console.error('Uso: canales-listado.mjs --salida <carpeta> [--max 300] [--refrescar]'); process.exit(2); }
const cat = JSON.parse(fs.readFileSync(path.join(AQUI, 'canales.json'), 'utf8'));
const ruta = path.join(salida, 'busquedas.json');
const cache = fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : {};
// En el listado plano de un canal, %(channel)s llega vacío («NA»); el nombre va en %(playlist_channel)s.
const FMT = '%(id)s\t%(playlist_channel)s\t%(channel_id)s\t%(channel_is_verified)s\t%(duration)s\t%(view_count)s\t%(title)s';
for (const c of cat.canales.filter((x) => x.enumerar)) {
  const k = `canal:${c.id}`;
  if (cache[k] && !refrescar) continue;
  const max = typeof c.enumerar === 'number' ? c.enumerar : maxPorDefecto;
  const r = spawnSync('yt-dlp', ['--flat-playlist', '--playlist-end', String(max), '--print', FMT, `https://www.youtube.com/channel/${c.id}/videos`], { encoding: 'utf8', maxBuffer: 1e8 });
  const items = r.stdout.split('\n').filter(Boolean).map((l) => {
    // Sin `nombre` en canales.json, el que da YouTube.
    const [id, canalYt, , , duration, views, ...t] = l.split('\t');
    return { id, channel: c.nombre || canalYt, channelId: c.id, verified: false, duration: Number(duration) || null, views: Number(views) || null, title: t.join('\t') };
  });
  cache[k] = items;
  console.error(`${c.nombre || c.id}: ${items.length}`);
  fs.writeFileSync(ruta, JSON.stringify(cache));
  await new Promise((ok) => setTimeout(ok, 1500));
}
