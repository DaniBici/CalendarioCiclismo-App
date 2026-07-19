-- Vista que resuelve los nombres de corredor y equipo de start_order_entries
-- desde la BD canónica EN TIEMPO DE LECTURA, igual que startlist_riders_resolved
-- hace para las startlists.
--
-- Problema que arregla: start_order_entries guarda un snapshot (riderName,
-- teamName, countryCode) tomado en el momento de la importación. Cuando después
-- se matchea un dorsal a su ficha canónica (riders_men/women) o se corrige el
-- nombre de un corredor/equipo, el snapshot quedaba obsoleto y las páginas de
-- orden de salida seguían mostrando el nombre viejo (o "sin match") hasta que el
-- admin pulsaba "Re-sincronizar" a mano.
--
-- Esta vista resuelve el nombre por (raceId, dorsal) contra
-- startlist_riders_resolved (que ya aplica la precedencia BD↔snapshot) y el
-- equipo siguiendo la misma cadena que el panel:
--   startlist_riders_resolved.teamId → startlist_teams.id
--   startlist_teams.teamId           → teams.id → teams.name (normalizado)
-- cayendo al teamName de la startlist y, en último término, al snapshot de
-- start_order_entries.
--
-- Precedencia:
-- - riderName: nombre canónico resuelto si hay match por dorsal; si no, snapshot.
-- - teamName:  teams.name → startlist_teams.teamName → snapshot soe.teamName.
-- - countryCode: el resuelto (que ya respeta el override de selección nacional);
--   si no hay match, el snapshot.
--
-- Shape idéntico a start_order_entries para que web/iOS/Android puedan migrar
-- sin tocar sus DTOs. Las apps antiguas que sigan leyendo la tabla funcionan
-- gracias a los mecanismos de sync existentes (save, botón Re-sincronizar,
-- sync_startlist_riders_to_canonical).
--
-- El match por dorsal usa LATERAL ... LIMIT 1 para garantizar como mucho una
-- fila resuelta por entrada, evitando multiplicar filas si hubiese dorsales
-- duplicados en una startlist.

CREATE OR REPLACE VIEW public.start_order_entries_resolved AS
SELECT
  soe.id,
  soe."raceDayId",
  soe."sortOrder",
  soe.dorsal,
  soe."startTime",
  COALESCE(v.id, soe."riderId") AS "riderId",
  COALESCE(
    NULLIF(trim(COALESCE(v."firstName", '') || ' ' || COALESCE(v."lastName", '')), ''),
    soe."riderName"
  ) AS "riderName",
  COALESCE(
    NULLIF(t.name, ''),
    NULLIF(st."teamName", ''),
    soe."teamName"
  ) AS "teamName",
  COALESCE(v."countryCode", soe."countryCode") AS "countryCode",
  soe."createdAt"
FROM public.start_order_entries soe
JOIN public.race_days rd ON rd.id = soe."raceDayId"
LEFT JOIN LATERAL (
  SELECT srr.id, srr."firstName", srr."lastName", srr."countryCode", srr."teamId"
  FROM public.startlist_riders_resolved srr
  WHERE srr."raceId" = rd."raceId" AND srr.dorsal = soe.dorsal
  LIMIT 1
) v ON true
LEFT JOIN public.startlist_teams st ON st.id = v."teamId"
LEFT JOIN public.teams t ON t.id = st."teamId";

GRANT SELECT ON public.start_order_entries_resolved TO anon, authenticated;
