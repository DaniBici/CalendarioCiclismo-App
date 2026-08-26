# results-fetchers

Motor de volcado de resultados. **Código en producción**: el watcher del VPS invoca
`uci-results-vps-runner.mjs`, que atiende la cola manual y después ejecuta
`uci-results-cron.mjs --configured`; `uci-results-today.yml` queda como fallback
manual y `uci-results-backlog.yml` mantiene las retrasadas. Los enlaces de DataRide se
introducen manualmente desde la jornada: el matcher automático y sus informes ya
no forman parte del circuito de producción.

La captación automática es opt-in. El panel permite fijar horas de apertura y
cierre en horario de España. La regla puede aplicarse a toda la carrera o
sobrescribirse en una jornada concreta; la frecuencia es política interna del
watcher y no una decisión editorial.

La excepción es `uci-team-ranking-sync.mjs`: mantiene la única instantánea
semanal de los ránkings de equipos masculino y femenino. Un timer del VPS consulta
DataRide cada hora durante lunes y martes y repite el miércoles como red de
seguridad; el workflow queda manual. Sin `--apply` valida DataRide y los
emparejamientos sin escribir; `--fetch-only` comprueba solo la fuente.

Antes se llamaba `catalog-continental/`, nombre heredado de la tarea puntual con la
que nació el directorio. Se renombró en la preparación del repo público (2026-07-18)
porque ese nombre escondía que aquí vive el motor de resultados y estuvo a punto de
costarnos un borrado accidental.

## Qué va aquí

Solo código que **corre en producción**: los fetchers por fuente, el cron, el upsert
y las utilidades de fuentes de resultados.

## Qué NO va aquí

- **Scripts ad-hoc de vigilancia** (`_watch-*.sh`, `_poll-*.sh`). Son andamiaje de una
  carrera concreta y ya cumplieron; los playbooks quedan en `docs/runbooks/`.
  Si necesitas uno nuevo, que sea temporal y no se commitee.
- **Utilidades de catálogo** (seeds, mapeo de equipos): no son parte del volcado.
- **Documentación de contratos de API.** Los `.md` con los contratos verificados de
  las fuentes de cronometraje (Tissot, Matsport, manual_timing, race|result, STS,
  Domtel, livetiming.at, sportstiming, ChronoRace, UCI DataRide) **se mantienen
  fuera de este repositorio** desde que pasó a ser público. Detallan endpoints no documentados y
  los rodeos necesarios para consumirlos, así que publicarlos es superficie de
  reclamación por condiciones de servicio sin ninguna ganancia.

  Si trabajas en un fetcher y necesitas su contrato, pídeselo a Dani. No vuelvas a
  commitearlo aquí.

## Añadir una fuente nueva

Cada fetcher emite el **mismo JSON intermedio**, que consume `uci-results-upsert.mjs`.
Esa es la única interfaz que hay que respetar: si tu fetcher emite ese formato, el
resto del pipeline (locks, resolución por dorsal, saneos) funciona sin tocar nada.

Para una clasificación individual con dorsal, el contrato de salida preferido es
solo `bib`, `rank`/`rankText` y el valor de resultado (`timeText`/`gapText`, puntos
o `irm`). No añadir nombre, equipo, país ni `winnerName`: el upsert los descarta y
resuelve identidad exclusivamente por `bib` contra la startlist. Las únicas
excepciones son clasificaciones por equipos y filas históricas sin dorsal, que
conservan `riderDisplay` como fallback explícito. Los fetchers existentes pueden
mantener campos de texto transitorios mientras el parser los necesita para leer una
tabla; no llegan a persistirse cuando la fila trae dorsal.

El patrón está en cualquiera de los existentes; `tissot-results-fetch.mjs` es el más
completo (incluye el híbrido con DataRide para las CRE).

`classificacoes-results-fetch.mjs` es la excepción portuguesa: recibe el slug de
la prueba, descubre desde la web los ids de etapa y clasificaciones y conserva los
dorsales publicados. Para crear el enlace, su `--suggest-id` da el `competitionId`
sintético estable y el cron usa `race_uci_links.source='classificacoes'` junto a
`classificacoesCode=<slug>`.

`burgos-results-fetch.mjs` descubre los dos PDFs que publica la página estable
`/es/clasificaciones-Na-etapa/` de la Vuelta a Burgos. Extrae etapa, general,
puntos, montaña, jóvenes y equipos; el cron lo activa con
`race_uci_links.source='burgos'`.

`timing-results-fetch.mjs` consume el JSON público de timing.ee, conserva el PDF
oficial de cada jornada como URL de fuente y excluye las filas de preparación que
el cronometrador marca sin correspondencia. El cron lo activa con
`race_uci_links.source='timing.ee'` y `timingCode=<event>`.

`belgiancycling-results-fetch.mjs` vigila el PDF oficial estable `CODE-U.pdf` de
Belgian Cycling. Distingue el marcador previo a la publicación del resultado
definitivo y extrae clasificados, DNS, DNF, OTL y DSQ. El cron lo activa con
`race_uci_links.source='belgiancycling'` y `belgianCyclingCode=<código con año>`.

`evodata-results-fetch.mjs` consume la API JSON pública de EvoData CIS. El
`eventId` padre descubre las jornadas y cada una publica llegada, general,
puntos, montaña, jóvenes y equipos. El token público de aplicación solo vive en
memoria. El cron lo activa con `race_uci_links.source='evodata'` y
`evodataCode=<eventId padre>`.

`manual_timing-results-fetch.mjs` consume el JSON live público de
`timing.example.invalid`. El cron lo activa cada minuto con
`race_uci_links.source='manual_timing'` y `manual_timingCode=<código estable>`, siempre
para la jornada seleccionada. Exige una llegada con filas antes del primer
volcado, omite la general virtual y refresca los puestos firmes durante la ventana.
