#!/usr/bin/env node
// Resumen por canal de los vídeos seleccionados de canales fuera de la lista de referencia («otro»):
// una fila por canal, con los vídeos propuestos, las jornadas y la insignia, para aprobarlos canal por canal.
//   node scripts/videos-sondeo/otros-canales.mjs --manifiesto <manifiesto.json> [--seguidores <fichas.json>] > otros-canales.md
import fs from 'node:fs';
const a = process.argv.slice(2);
const val = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
const m = JSON.parse(fs.readFileSync(val('--manifiesto'), 'utf8'));
const fichas = val('--seguidores') && fs.existsSync(val('--seguidores')) ? JSON.parse(fs.readFileSync(val('--seguidores'), 'utf8')) : {};
const por = new Map();
for (const d of m.dias) for (const k of ['summary', 'last_km']) for (const id of d.seleccion[k]) {
  const c = d.candidatos.find((x) => x.id === id);
  if (c.tier !== 'otro') continue;
  const g = por.get(c.canalId) || { nombre: c.canal, insignia: c.insignia, excluido: c.excluidoMotivo, videos: [] };
  // «Hueco»: la jornada no tiene ningún vídeo de referencia de ese tipo (sin este canal quedaría sin él).
  const hueco = !d.seleccion[k].some((x) => d.candidatos.find((y) => y.id === x).tier !== 'otro');
  g.videos.push({ d, c, k, hueco });
  por.set(c.canalId, g);
}
const dur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '?');
let md = '# Canales fuera de la lista de referencia con vídeos propuestos\n\nUna fila por canal; se aprueba o se descarta el canal entero. `Insignia`: marca de verificación de YouTube en los resultados de búsqueda.\n\n| Canal | Suscriptores | Insignia | Vídeos | Cubren un hueco | Carreras | Observación | Ejemplo |\n| --- | --: | --- | --: | --: | --- | --- | --- |\n';
for (const [id, g] of [...por].sort((x, y) => y[1].videos.length - x[1].videos.length)) {
  const f = fichas[id] || {};
  const ej = g.videos[0];
  const carreras = [...new Set(g.videos.map((v) => v.d.carrera))];
  md += `| [${g.nombre}](https://www.youtube.com/channel/${id}) | ${f.seguidores ?? '?'} | ${g.insignia ? 'sí' : 'no'} | ${g.videos.length} | ${g.videos.filter((v) => v.hueco).length} | ${carreras.slice(0, 3).join('; ')}${carreras.length > 3 ? ` (+${carreras.length - 3})` : ''} | ${g.excluido || f.nota || ''} | [${dur(ej.c.segundos)}](${ej.c.url}) ${ej.c.titulo.slice(0, 60).replace(/\|/g, '/')} |\n`;
}
console.log(md);
console.error(`canales: ${por.size}; vídeos: ${[...por.values()].reduce((s, g) => s + g.videos.length, 0)}`);
