# Sondas de descubrimiento de DataRide (UCI) — ARCHIVADAS (2026-07-18)

Tres herramientas de **un solo uso** que sirvieron para descubrir el contrato de
la API de resultados de la UCI (DataRide). Cumplieron su función: el contrato
que destaparon está documentado y **implementado en producción** por
`scripts/results-fetchers/uci-results-fetch.mjs`, que es lo que ejecuta el cron.

Se archivan al preparar el repo para publicarse (AGPL-3.0): ninguna la invocaba
ya ningún workflow, ningún cron ni ningún otro script — solo se citaban entre sí
en comentarios de cabecera.

## Qué había (código BORRADO del árbol, recuperable del historial)

Vivían en `scripts/results-fetchers/`:

- `uci-results-probe.mjs` — sonda original. Descubrió que las páginas de
  resultados son apps JS que por debajo piden el JSON a `dataridewsv2`.
- `uci-results-confirm.mjs` — confirmación del contrato hallado por la sonda
  (endpoints, forma de los parámetros, forma de la respuesta).
- `uci-find-dauphine.mjs` — localizó el `competitionId` real del Critérium du
  Dauphiné 2026. Caso concreto, no herramienta general.

Para recuperar una:

```bash
git log --all --oneline -- scripts/results-fetchers/uci-results-probe.mjs
git show <sha>:scripts/results-fetchers/uci-results-probe.mjs
```

⚠️ Si el historial se purga con `git-filter-repo` al publicar el repo (ver
`docs/runbooks/publicar-repo-agpl.md`), este código deja de ser recuperable.
Es aceptable: lo que aportaban —el contrato de la API— está implementado y
documentado en el fetcher de producción.

## Por qué se borró el código en vez de solo moverlo

Las tres usan Playwright con **evasión de detección de automatización**
(`--disable-blink-features=AutomationControlled` + `navigator.webdriver`
sobrescrito a `undefined`) y comentarios que describen cómo superar los
challenges de Cloudflare.

Ese patrón es el mismo que se destruyó al retirar el scraping de fuente externa (migración
127) y **contradice cómo trabaja hoy el proyecto**: los fetchers en producción se
identifican con `calendariociclismo-bot/1.0 (+https://calendariociclismo.app)`,
respetan los challenges en vez de romperlos y siembran cookies con un GET normal
a la home.

Como no las usa nadie, limpiarlas habría sido cosmético: una corrección que
nunca se verificaría porque el código no se vuelve a ejecutar. Borrarlas evita
publicar ese patrón y no cuesta nada real.

**Si alguna vez hay que re-sondear el contrato de DataRide, la sonda nueva debe
salir del patrón actual** (UA identificado, sin anti-fingerprinting), no de una
copia recuperada de estos ficheros.

## Lo que SÍ sigue vivo (no confundir)

- `scripts/results-fetchers/uci-results-fetch.mjs` — el fetcher real del cron.
  `fetch` nativo, sin Playwright, UA identificado, cookies vía GET a la home.
- `scripts/results-fetchers/uci-fetch-teams.mjs` y `uci-ingest-riders.mjs` —
  herramientas manuales que SÍ se conservan en el árbol; usan Playwright pero se
  les retiró la evasión en esta misma pasada. Si alguna dejara de atravesar
  Cloudflare, se verá al ejecutarlas a mano (no las toca ningún workflow).
