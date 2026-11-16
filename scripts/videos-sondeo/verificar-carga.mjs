#!/usr/bin/env node
// Comprueba en la base de datos que cada vídeo seleccionado del manifiesto está en su jornada, sin URL
// repetida, con sortOrder consecutivo (0..n-1), orden por tipo y los campos de la carga.
//   node scripts/videos-sondeo/verificar-carga.mjs --manifiesto <manifiesto.json> [--excluir <ids.json>] [--carrera <texto>] [--genero male|female] [--categoria 1.Pro|2.Pro]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const a = process.argv.slice(2);
const val = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
const m = JSON.parse(fs.readFileSync(val('--manifiesto'), 'utf8'));
const excluir = new Set(val('--excluir') ? JSON.parse(fs.readFileSync(val('--excluir'), 'utf8')) : []);
const carrera = val('--carrera')?.toLowerCase().split('|');
const categoria = val('--categoria')?.split('|');
const dias = m.dias.filter((d) => (!carrera || carrera.some((c) => d.carrera.toLowerCase().includes(c))) && (!val('--genero') || d.genero === val('--genero')) && (!categoria || categoria.includes(d.categoria)));
const esperado = new Map();
for (const d of dias) {
  const urls = [];
  for (const k of ['summary', 'last_km']) for (const id of d.seleccion[k]) {
    const c = d.candidatos.find((x) => x.id === id);
    if (!excluir.has(id) && c.valido && c.embebible && ['ALL', 'EUROPA'].includes(c.grupoPaises)) urls.push({ kind: k, url: c.url, canal: c.canal.trim(), country: c.grupoPaises });
  }
  if (urls.length) esperado.set(d.dayId, urls);
}
const ids = [...esperado.keys()].map((x) => `'${x}'`).join(',');
const r = spawnSync('node', ['scripts/db/sql.mjs', '--read-only', `select "raceDayId", kind, url, channel, country, embeddable, "sortOrder" from race_day_videos where "raceDayId" in (${ids}) order by "raceDayId", "sortOrder"`], { encoding: 'utf8', maxBuffer: 1e8 });
const filas = JSON.parse(r.stdout);
const porDia = new Map();
for (const f of filas) { if (!porDia.has(f.raceDayId)) porDia.set(f.raceDayId, []); porDia.get(f.raceDayId).push(f); }
const ORDEN = { full: 0, summary: 1, last_km: 2, other: 3 };
let faltan = 0, sobran = 0, repetidas = 0, orden = 0, campos = 0, videos = 0;
for (const [dayId, esp] of esperado) {
  const bd = porDia.get(dayId) || [];
  const set = new Set(bd.map((x) => x.url));
  if (set.size !== bd.length) repetidas++;
  for (const e of esp) { videos++; const f = bd.find((x) => x.url === e.url); if (!f) { faltan++; console.error('falta', dayId, e.url); } else if (f.kind !== e.kind || f.channel !== e.canal || f.country !== e.country || f.embeddable !== true) { campos++; console.error('campos', dayId, e.url, f); } }
  const espSet = new Set(esp.map((e) => e.url));
  for (const f of bd) if (!espSet.has(f.url) && f.kind !== 'full' && f.kind !== 'other') { sobran++; console.error('sobra', dayId, f.url); }
  if (!bd.every((x, i) => Number(x.sortOrder) === i && (i === 0 || ORDEN[bd[i - 1].kind] <= ORDEN[x.kind]))) { orden++; console.error('orden', dayId, bd.map((x) => `${x.kind}:${x.sortOrder}`).join(',')); }
}
console.log(JSON.stringify({ jornadas: esperado.size, videosEsperados: videos, filasEnBD: filas.length, faltan, sobran, repetidas, ordenIncorrecto: orden, camposDistintos: campos }));
process.exit(faltan || sobran || repetidas || orden || campos ? 1 : 0);
