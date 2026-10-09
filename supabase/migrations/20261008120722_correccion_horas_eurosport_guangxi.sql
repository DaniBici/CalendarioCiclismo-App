-- Tour de Guangxi 2026, etapas 1 a 3: HBO Max sustituyó las horas provisionales
-- (08:00, 01:10 y 01:00 UTC) por las definitivas del catálogo oficial. El
-- sincronizador descarta cambios de más de tres horas (implausible_change), por lo
-- que se aplican aquí, en las filas Eurosport (HBO Max) y TNT Sports (HBO Max) y en
-- last_applied del vínculo, para que la siguiente pasada no registre conflicto.
WITH t(ev, ts) AS (VALUES
  ('bf132098-7c7b-5823-9c55-5d7e4f027fa2', '2026-10-13T04:30:00.000Z'),
  ('13181d91-6cb2-5143-a580-90d912778860', '2026-10-14T05:40:00.000Z'),
  ('374ef501-d6ba-5a8f-8758-a03552efc927', '2026-10-15T06:30:00.000Z')),
b AS (
  UPDATE public.broadcasts br SET "startTimeUtc" = t.ts::timestamptz
  FROM private.broadcast_source_links l, t
  WHERE l.source = 'hbo_max' AND l.external_event_id = t.ev
    AND br.id IN (l.primary_broadcast_id, l.mirror_broadcast_id)
  RETURNING br.id)
UPDATE private.broadcast_source_links l SET
  last_applied = (SELECT jsonb_agg(jsonb_set(e, '{startTimeUtc}', to_jsonb(t.ts)))
                    FROM jsonb_array_elements(l.last_applied) e),
  updated_at = now()
FROM t WHERE l.source = 'hbo_max' AND l.external_event_id = t.ev;
