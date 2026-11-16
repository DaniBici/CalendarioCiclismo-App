#!/usr/bin/env node
// Búsqueda ampliada en YouTube para las jornadas que siguen sin resumen o sin último kilómetro:
// más variantes de consulta (nombres en varios idiomas, castellano, francés, neerlandés, etapa y tipo)
// y 50 resultados por consulta. Guarda los resultados en busquedas.json bajo `amp:<consulta>`;
// sondeo.mjs --otros los empareja con todas las jornadas (también con canales fuera de la lista).
//
//   node scripts/videos-sondeo/busqueda-amplia.mjs --dias dias.json --manifiesto manifiesto.json --salida <carpeta> [--conc 4] [--contar]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const a = process.argv.slice(2);
const val = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const dias = JSON.parse(fs.readFileSync(val('--dias'), 'utf8'));
const man = JSON.parse(fs.readFileSync(val('--manifiesto'), 'utf8'));
const salida = val('--salida');
const conc = Number(val('--conc', '4'));
if (!val('--dias') || !val('--manifiesto') || !salida) { console.error('Uso: busqueda-amplia.mjs --dias dias.json --manifiesto manifiesto.json --salida <carpeta> [--conc 4] [--contar]'); process.exit(2); }
const fix = (s) => String(s || '').replace(/\u008f/g, 'è').replace('Flche', 'Flèche').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hueco = new Set(man.dias.filter((d) => !d.seleccion.summary.length || !d.seleccion.last_km.length).map((d) => d.dayId));
const consultas = new Set();
const porCarrera = new Set();
for (const d of dias) {
  if (!hueco.has(d.dayId)) continue;
  const nombres = [...new Map([d.nameEn, d.name, d.originalName].filter(Boolean).map(fix).map((n) => [norm(n), n])).values()];
  const unDia = Number(d.ridingDays) === 1;
  const n = Number(d.stageNumber);
  for (const N of nombres) {
    if (!porCarrera.has(`${d.raceId}|${N}`)) {
      porCarrera.add(`${d.raceId}|${N}`);
      for (const s of unDia ? ['2026', '2026 resumen', '2026 highlights', '2026 summary', '2026 last km', '2026 final km', '2026 résumé', '2026 samenvatting', '2026 último km'] : ['2026', '2026 resumen', '2026 highlights']) consultas.add(`${N} ${s}`);
    }
    if (!unDia) {
      const en = n === 0 ? 'prologue' : `stage ${n}`;
      for (const s of ['', ' highlights', ' last km', ' final km']) consultas.add(`${N} 2026 ${en}${s}`);
      const es = n === 0 ? 'prólogo' : `etapa ${n}`;
      for (const s of ['', ' resumen']) consultas.add(`${N} 2026 ${es}${s}`);
      consultas.add(`${N} 2026 ${n === 0 ? 'prologue' : `étape ${n}`} résumé`);
    }
  }
}
const lista = [...consultas];
const ruta = path.join(salida, 'busquedas.json');
const cache = fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : {};
const pend = lista.filter((q) => !(`amp:${q}` in cache));
console.error(`jornadas con hueco: ${hueco.size}; consultas: ${lista.length}; pendientes: ${pend.length}`);
if (a.includes('--contar')) process.exit(0);
const FMT = '%(id)s\t%(channel)s\t%(channel_id)s\t%(channel_is_verified)s\t%(duration)s\t%(view_count)s\t%(title)s';
const buscar = (q) => new Promise((ok) => {
  const p = spawn('yt-dlp', ['--flat-playlist', '--print', FMT, `ytsearch50:${q}`]);
  let buf = '';
  p.stdout.on('data', (x) => (buf += x));
  p.stderr.on('data', () => {});
  p.on('error', () => ok(null));
  p.on('close', () => ok(buf.split('\n').filter(Boolean).map((l) => {
    const [id, channel, channelId, verified, duration, views, ...t] = l.split('\t');
    return { id, channel, channelId, verified: verified === 'True', duration: Number(duration) || null, views: Number(views) || null, title: t.join('\t') };
  }).filter((x) => x.id && x.id.length === 11)));
});
let i = 0, hechas = 0;
await Promise.all(Array.from({ length: conc }, async () => {
  while (i < pend.length) {
    const q = pend[i++];
    let r = await buscar(q);
    if (r === null || !r.length) r = (await buscar(q)) || [];
    cache[`amp:${q}`] = r;
    if (++hechas % 50 === 0) { fs.writeFileSync(ruta, JSON.stringify(cache)); console.error(`  ${hechas}/${pend.length}`); }
  }
}));
fs.writeFileSync(ruta, JSON.stringify(cache));
console.error('hecho');
