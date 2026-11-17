#!/usr/bin/env node
// Genera el SQL de carga de la selección del sondeo en race_day_videos (RPC
// save_race_day_videos). No ejecuta nada: escribe el SQL por stdout.
//
//   node scripts/videos-sondeo/cargar.mjs --manifiesto <manifiesto.json> [--carrera <texto>[|<texto>]] [--genero male|female] [--categoria 1.Pro|2.Pro] [--un-dia|--por-etapas] [--excluir <ids.json>] > carga.sql
//   node scripts/db/sql.mjs --rollback --all --file carga.sql   # prueba sin dejar cambios
//   node scripts/db/sql.mjs --all --file carga.sql              # carga real
//
// Una llamada por jornada con la lista completa deseada: conserva las filas
// vigentes de tipo `full` y `other` y las de resumen o último kilómetro cuya URL
// no está en la selección, y añade la selección (orden: full, summary, last_km,
// other; `sortOrder` lo fija la RPC por el orden del array).
import fs from 'node:fs';

function leerArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifiesto') a.manifiesto = argv[++i];
    else if (argv[i] === '--carrera') a.carrera = argv[++i].toLowerCase().split('|');
    else if (argv[i] === '--sin-carrera') a.sin = argv[++i].toLowerCase().split('|');
    else if (argv[i] === '--genero') a.genero = argv[++i];
    else if (argv[i] === '--categoria') a.categoria = argv[++i].split('|');
    else if (argv[i] === '--un-dia') a.tipo = 'un-dia';
    else if (argv[i] === '--por-etapas') a.tipo = 'por-etapas';
    else if (argv[i] === '--excluir') a.excluir = argv[++i];
  }
  if (!a.manifiesto) { console.error('Uso: cargar.mjs --manifiesto <manifiesto.json> [--carrera <texto>[|<texto>]] [--genero male|female] [--categoria 1.Pro|2.Pro] [--un-dia|--por-etapas] [--excluir <ids.json>]'); process.exit(2); }
  return a;
}

const A = leerArgs(process.argv.slice(2));
const m = JSON.parse(fs.readFileSync(A.manifiesto, 'utf8'));
const excluir = new Set(A.excluir ? JSON.parse(fs.readFileSync(A.excluir, 'utf8')) : []);
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const TITULOS = { summary: ['Resumen', 'Highlights'], last_km: ['Último kilómetro', 'Last kilometre'] };
const ORDEN = { full: 0, summary: 1, last_km: 2, other: 3 };

let dias = 0, videos = 0;
const out = ['-- Carga del sondeo de vídeos. Generado por scripts/videos-sondeo/cargar.mjs'];
for (const d of m.dias) {
  if (A.carrera && !A.carrera.some((c) => d.carrera.toLowerCase().includes(c))) continue;
  if (A.sin && A.sin.some((c) => d.carrera.toLowerCase().includes(c))) continue;
  if (A.genero && d.genero !== A.genero) continue;
  if (A.categoria && !A.categoria.includes(d.categoria)) continue;
  if (A.tipo === 'un-dia' && !d.unDia) continue;
  if (A.tipo === 'por-etapas' && d.unDia) continue;
  const filas = [];
  for (const kind of ['summary', 'last_km']) {
    for (const id of d.seleccion[kind]) {
      if (excluir.has(id)) continue;
      const c = d.candidatos.find((x) => x.id === id);
      if (!c || !c.valido || !c.embebible) continue;
      const country = c.grupoPaises === 'ALL' ? 'ALL' : c.grupoPaises === 'EUROPA' ? 'EUROPA' : null;
      if (!country) continue; // REVISAR o ES: no se carga sin decisión
      filas.push({ kind, title: TITULOS[kind][0], titleEn: TITULOS[kind][1], channel: c.canal.trim(), url: c.url, embeddable: true, country });
    }
  }
  if (!filas.length) continue;
  dias++; videos += filas.length;
  const nuevas = filas.map((f) => `jsonb_build_object('id', gen_random_uuid()::text, 'kind', ${sq(f.kind)}, 'title', ${sq(f.title)}, 'titleEn', ${sq(f.titleEn)}, 'channel', ${sq(f.channel)}, 'url', ${sq(f.url)}, 'embeddable', true, 'country', ${sq(f.country)}, 'k', ${ORDEN[f.kind]}, 'n', 1)`).join(',\n      ');
  out.push(`-- ${d.carrera}${d.unDia ? '' : ' E' + d.etapa} ${d.fecha} (${d.daySlug})
select public.save_race_day_videos(${sq(d.dayId)}, (
  select coalesce(jsonb_agg(r - 'k' - 'n' - 'o' order by (r->>'k')::int, (r->>'n')::int, (r->>'o')::int), '[]'::jsonb)
  from (
    select jsonb_build_object('id', v.id, 'kind', v.kind, 'title', v.title, 'titleEn', v."titleEn", 'channel', v.channel, 'url', v.url, 'embeddable', v.embeddable, 'country', v.country,
             'k', case v.kind when 'full' then 0 when 'summary' then 1 when 'last_km' then 2 else 3 end, 'n', 0, 'o', v."sortOrder") as r
      from public.race_day_videos v
     where v."raceDayId" = ${sq(d.dayId)}
       and v.url not in (${filas.map((f) => sq(f.url)).join(', ')})
    union all
    select x || jsonb_build_object('o', 0) as r from unnest(array[
      ${nuevas}
    ]) as x
  ) t
)) as filas;`);
}
console.log(out.join('\n'));
console.error(`jornadas: ${dias}; vídeos: ${videos}`);
