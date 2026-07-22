-- 127_drop_broadcasts_suggested.sql
--
-- Retira la tabla `broadcasts_suggested` (migraciones 041 + 042).
--
-- Contexto: la tabla la alimentaba SOLO una utilidad de importación de
-- broadcasts, retirada el 2026-07-17. Ningún cliente vivo la LEE (ni panel, ni
-- web, ni apps): solo esa utilidad la escribía. Sin ella, es una tabla huérfana.
--
-- Protocolo pre-DROP verificado (patrón de las migraciones 098/111/126):
--   0 FKs entrantes · 0 vistas/matviews dependientes · 0 funciones que la nombren
--   · 0 triggers propios · 0 referencias en el código vivo.
--
-- Backup previo (360 filas, 357 pendientes) en `broadcasts_suggested_bak_drop_20260717`.
-- Ese backup es efímero: retirarlo cuando ya no haga falta (tiene RLS OFF, así que
-- lo marcan los advisors — no dejarlo indefinidamente).

DROP TABLE IF EXISTS broadcasts_suggested;
