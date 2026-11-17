#!/usr/bin/env node
// Genera el SQL que retira de race_day_videos todos los vídeos de unos canales (nombre exacto de la
// columna `channel`), con la RPC save_race_day_videos: por cada jornada afectada guarda la lista
// vigente sin esos canales (la RPC borra lo ausente y renumera sortOrder). No ejecuta nada.
//
//   node scripts/videos-sondeo/retirar.mjs --canales "Canal A|Canal B" > retirada.sql
//   node scripts/db/sql.mjs --rollback --all --file retirada.sql   # prueba sin dejar cambios
//   node scripts/db/sql.mjs --all --file retirada.sql              # retirada real
const i = process.argv.indexOf('--canales');
if (i < 0 || !process.argv[i + 1]) { console.error('Uso: retirar.mjs --canales "Canal A|Canal B"'); process.exit(2); }
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lista = process.argv[i + 1].split('|').map((s) => s.trim()).filter(Boolean).map(sq).join(', ');
console.log(`-- Retirada de vídeos de canales. Generado por scripts/videos-sondeo/retirar.mjs
select d."raceDayId", public.save_race_day_videos(d."raceDayId", (
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'title', v.title, 'titleEn', v."titleEn", 'channel', v.channel, 'url', v.url, 'embeddable', v.embeddable, 'country', v.country) order by v."sortOrder"), '[]'::jsonb)
    from public.race_day_videos v
   where v."raceDayId" = d."raceDayId" and v.channel not in (${lista})
)) as filas
  from (select distinct "raceDayId" from public.race_day_videos where channel in (${lista})) d;`);
