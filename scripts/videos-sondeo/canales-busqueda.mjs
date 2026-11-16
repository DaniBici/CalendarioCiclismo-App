#!/usr/bin/env node
// Búsqueda dentro de los canales de WBD y de los equipos WorldTour (pestaña de búsqueda de cada canal): una consulta por
// carrera y canal («<nombre> 2026»). Recupera vídeos que la búsqueda general de YouTube, ordenada por
// relevancia, no devuelve (p. ej. «Tour of Luxembourg» frente a «Tour de Luxembourg»). Guarda los
// resultados en busquedas.json bajo `cb:<canal>:<consulta>`; sondeo.mjs los empareja con todas las jornadas.
//
//   node scripts/videos-sondeo/canales-busqueda.mjs --dias dias.json --salida <carpeta> [--conc 4]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const val = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const dias = JSON.parse(fs.readFileSync(val('--dias'), 'utf8'));
const salida = val('--salida');
const conc = Number(val('--conc', '4'));
if (!val('--dias') || !salida) { console.error('Uso: canales-busqueda.mjs --dias dias.json --salida <carpeta> [--conc 4]'); process.exit(2); }
const cat = JSON.parse(fs.readFileSync(path.join(AQUI, 'canales.json'), 'utf8'));
const canales = cat.canales.filter((c) => c.tier === 'wbd' || c.tier === 'equipos');
const fixNombre = (s) => String(s || '').replace(/\u008f/g, 'è').replace('Flche', 'Flèche');
const consultas = new Set();
for (const d of dias) for (const n of [d.nameEn, d.name]) if (n) consultas.add(`${fixNombre(n).replace(/\s*\(.*?\)\s*/g, ' ').trim()} 2026`);
const ruta = path.join(salida, 'busquedas.json');
const cache = fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : {};
const FMT = '%(id)s\t%(channel)s\t%(channel_id)s\t%(channel_is_verified)s\t%(duration)s\t%(view_count)s\t%(title)s';
const buscar = (c, q) => new Promise((ok) => {
  const p = spawn('yt-dlp', ['--flat-playlist', '--playlist-end', '40', '--print', FMT, `https://www.youtube.com/channel/${c.id}/search?query=${encodeURIComponent(q)}`]);
  let buf = '';
  p.stdout.on('data', (x) => (buf += x));
  p.stderr.on('data', () => {});
  p.on('error', () => ok(null));
  p.on('close', () => ok(buf.split('\n').filter(Boolean).map((l) => {
    // Sin `nombre` en canales.json, el que da YouTube.
    const [id, canalYt, , , duration, views, ...t] = l.split('\t');
    return { id, channel: c.nombre || canalYt, channelId: c.id, verified: false, duration: Number(duration) || null, views: Number(views) || null, title: t.join('\t') };
  }).filter((x) => x.id.length === 11)));
});
const trabajos = [];
for (const c of canales) for (const q of consultas) if (!(`cb:${c.id}:${q}` in cache)) trabajos.push([c, q]);
console.error(`consultas dentro de canales: ${trabajos.length}`);
let i = 0, hechas = 0;
await Promise.all(Array.from({ length: conc }, async () => {
  while (i < trabajos.length) {
    const [c, q] = trabajos[i++];
    let r = await buscar(c, q);
    if (r === null || !r.length) r = (await buscar(c, q)) || [];
    cache[`cb:${c.id}:${q}`] = r;
    if (++hechas % 50 === 0) { fs.writeFileSync(ruta, JSON.stringify(cache)); console.error(`  ${hechas}/${trabajos.length}`); }
  }
}));
fs.writeFileSync(ruta, JSON.stringify(cache));
console.error('hecho');
