# results-fetchers

Motor de volcado de resultados. **Código en producción**: lo invocan los workflows
`uci-results-today.yml` y `uci-results-backlog.yml`. Los enlaces de DataRide se
introducen manualmente desde la jornada: el matcher automático y sus informes ya
no forman parte del circuito de producción.

Antes se llamaba `catalog-continental/`, nombre heredado de la tarea puntual con la
que nació el directorio. Se renombró en la preparación del repo público (2026-07-18)
porque ese nombre escondía que aquí vive el motor de resultados y estuvo a punto de
costarnos un borrado accidental.

## Qué va aquí

Solo código que **corre en producción**: los fetchers por fuente, el cron, el upsert
y las utilidades de fuentes de resultados.

## Qué NO va aquí

- **Scripts ad-hoc de vigilancia** (`_watch-*.sh`, `_poll-*.sh`). Son andamiaje de una
  carrera concreta y ya cumplieron; los playbooks quedan en `CLAUDE.md` y en
  `docs/runbooks/`. Si necesitas uno nuevo, que sea temporal y no se commitee.
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

El patrón está en cualquiera de los existentes; `tissot-results-fetch.mjs` es el más
completo (incluye el híbrido con DataRide para las CRE).
