#!/usr/bin/env node
// Documento de aprobación: por carrera y jornada, los vídeos que cargaría cargar.mjs.
//   node scripts/videos-sondeo/lista.mjs --manifiesto <manifiesto.json> > lista-aprobacion.md
import fs from 'node:fs';
const i = process.argv.indexOf('--manifiesto');
if (i < 0) { console.error('Uso: lista.mjs --manifiesto <manifiesto.json>'); process.exit(2); }
const m = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
const dur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '?');
const celda = (d, kind) => d.seleccion[kind].map((id) => {
  const c = d.candidatos.find((x) => x.id === id);
  return `[${c.canal}](${c.url}) ${dur(c.segundos)} ${c.idioma}${c.inferido ? ' **inferido**' : ''}${c.pequeno ? ' **canal pequeño**' : ''}${c.tier === 'otro' ? ' **otro canal**' : ''}${c.grupoPaises === 'EUROPA' ? ' EUROPA' : ''}${c.paisesFaltantes?.length && c.grupoPaises !== 'ALL' ? ` (sin ${c.paisesFaltantes.join(',')})` : ''}`;
}).join('<br>') || '—';
let md = `# Lista de aprobación del sondeo\n\nGenerada ${new Date().toISOString().slice(0, 10)}. Cada fila es una jornada; resumen y último km propuestos (país: ALL salvo marca EUROPA). Idioma deducido del título. Los vídeos \`inferido\` son de canales de organizador sin palabra de tipo en el título; \`canal pequeño\` marca canales de organizador con menos de 1 000 suscriptores.\n`;
const porCarrera = new Map();
for (const d of m.dias) {
  const k = `${d.genero === 'female' ? 'F' : 'M'} · ${d.categoria} · ${d.carrera}`;
  if (!porCarrera.has(k)) porCarrera.set(k, []);
  porCarrera.get(k).push(d);
}
for (const [k, ds] of porCarrera) {
  md += `\n## ${k}\n\n| Jornada | Resumen | Último kilómetro |\n| --- | --- | --- |\n`;
  for (const d of ds) md += `| ${d.unDia ? d.fecha : `E${d.etapa} · ${d.fecha}`} | ${celda(d, 'summary')} | ${celda(d, 'last_km')} |\n`;
}
const perd = m.dias.filter((d) => d.perdidasPorInsercion.summary || d.perdidasPorInsercion.last_km);
md += `\n## Jornadas que pierden vídeo por inserción desactivada (D3)\n\n`;
for (const d of perd) md += `- ${d.carrera} ${d.unDia ? '' : 'E' + d.etapa} ${d.fecha}\n`;
console.log(md);
