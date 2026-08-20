-- Fase 1 de la retirada de la marca "Devo" en startlist_teams.
--
-- Los equipos Devo ahora son entidades independientes en el catálogo `teams`
-- (con su propio currentTeamId y badge), así que la columna isDev de
-- startlist_teams pasa a ser información redundante: la condición Devo
-- queda implícita en el teamId canónico del equipo Devo.
--
-- Esta migración solo limpia datos. La columna se mantiene con default false
-- por compatibilidad con apps iOS/Android publicadas que la decodifican como
-- Bool no-opcional (Swift Decodable). Cuando todas las apps en uso estén
-- actualizadas (sin lectura de isDev), una segunda migración hará el
-- ALTER TABLE startlist_teams DROP COLUMN "isDev".
--
-- Tras este UPDATE, todas las filas de startlist_teams quedan con isDev=false,
-- así que las apps viejas dejarán de mostrar el sufijo "(Devo)" en el nombre
-- del equipo — comportamiento deseado: el nombre canónico viene del catálogo
-- `teams` cuando hay teamId, sin sufijo.

UPDATE public.startlist_teams SET "isDev" = false WHERE "isDev" = true;
