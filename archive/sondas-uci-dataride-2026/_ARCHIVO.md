# Sondas de descubrimiento de DataRide (UCI) — ARCHIVADAS (2026-07-18)

Tres herramientas de **un solo uso** que sirvieron para descubrir el contrato de
la API de resultados de la UCI (DataRide). Cumplieron su función: el contrato
que destaparon está documentado y **implementado en producción** por
`scripts/results-fetchers/uci-results-fetch.mjs`, que es lo que ejecuta el cron.

Se archivan al preparar el repo para publicarse (AGPL-3.0): ninguna la invocaba
ya ningún workflow, ningún cron ni ningún otro script — solo se citaban entre sí
en comentarios de cabecera.

## Qué había (código BORRADO del árbol)

Vivían en `scripts/results-fetchers/`:

- `uci-results-probe.mjs` — sonda original. Descubrió que las páginas de
  resultados son apps JS que por debajo piden el JSON a `dataridewsv2`.
- `uci-results-confirm.mjs` — confirmación del contrato hallado por la sonda
  (endpoints, forma de los parámetros, forma de la respuesta).
- `uci-find-dauphine.mjs` — localizó el `competitionId` real del Critérium du
  Dauphiné 2026. Caso concreto, no herramienta general.

## Por qué se borró el código en vez de solo moverlo

Eran herramientas de un solo uso que no invocaba nadie: lo que aportaban —el
contrato de la API— ya está implementado y documentado en el fetcher de
producción, así que conservarlas no aportaba nada. El fetcher en producción se
identifica con `calendariociclismo-bot/1.0 (+https://calendariociclismo.app)` y
siembra cookies con un GET normal a la home.

**Si alguna vez hay que re-sondear el contrato de DataRide, la sonda nueva debe
salir del patrón actual** (UA identificado), no de una copia recuperada.

## Lo que SÍ sigue vivo (no confundir)

- `scripts/results-fetchers/uci-results-fetch.mjs` — el fetcher real del cron.
  `fetch` nativo, sin Playwright, UA identificado, cookies vía GET a la home.
- `scripts/results-fetchers/uci-fetch-teams.mjs` y `uci-ingest-riders.mjs` —
  herramientas manuales que SÍ se conservan en el árbol; usan Playwright con el
  mismo UA identificado.
