# Mundial de carretera de Montréal 2026 — resultados y listas

Pruebas: 2026-09-20 a 2026-09-27, Montreal (CAN), zona `America/Toronto`.
Fuente de resultados: Tissot Timing, comp_id `crdwch2026` (evento `MultiEvents`).
Las pruebas junior quedan fuera de alcance.

Las operaciones de inscritos, orden de salida y validación se rigen por sus
skills (`cc-startlists-corredores`, `cc-nucleo`). Esta nota fija el mapa de este
campeonato y la operación específica de `MultiEvents`.

## Mapa carrera ↔ evento Tissot

| Evento | Prueba | Tipo | Fecha | raceId |
| --- | --- | --- | --- | --- |
| 1 | CRI femenino | ITT | 09-20 | `79881f90-fabc-4e30-a5a9-fbdcc1efd775` |
| 2 | CRI masculino | ITT | 09-20 | `89082eae-729f-46c8-b712-90728a3db8f4` |
| 3 | CRI sub23 femenino | ITT | 09-21 | `dd640608-e599-4f28-a2cf-140c50226890` |
| 4 | CRI sub23 masculino | ITT | 09-21 | `f860c8f3-7141-4255-85c4-834292d975db` |
| 5 | CRE relevo mixto | TTT | 09-22 | `dd74443d-b3d9-4488-b368-ee428db39177` |
| 8 | Línea sub23 femenino | MS | 09-24 | `31911bfb-2e80-41a7-8ccd-54a38ec72cb3` |
| 10 | Línea sub23 masculino | MS | 09-25 | `94138c1a-7867-4a18-a7ed-9d1e44b3abca` |
| 12 | Línea femenino | MS | 09-26 | `b4252aec-373d-415c-a602-5e4aad1c546f` |
| 13 | Línea masculino | MS | 09-27 | `680f6a7f-424c-4f8d-becb-515481f7a641` |

Los enlaces ya están creados en `race_uci_links` con `source='tissot'`,
`tissotCode='crdwch'` y `tissotEventNumber` = la columna «Evento». El cron lee ese
número y lo pasa al fetcher como `--tissot-event`. No reasignar `competitionId`.

## Resultados

- Automático: el timer del VPS ejecuta `cc-results.timer`; no requiere ninguna
  acción si el enlace está en ventana. Tissot publica 5-15 min tras meta.
- Dirigido (prueba o recuperación), solo esa carrera:
  `node scripts/results-fetchers/results-cron.mjs --race-id <raceId>`
- Antes de carrera el endpoint no devuelve filas: el ∅-guard deja el enlace
  `pending` sin escribir. Es el estado normal hasta el día de la prueba.
- Tras el volcado, comprobar `syncStatus`/`syncError`/`lastSyncedAt`, ganador
  único, dorsales duplicados y corredores sin resolver. Anomalías →
  `cc-saneo-resultados`. Cada prueba escribe su propio `raceId`; el CRE puede
  requerir revisión del despliegue por equipos una vez publicado.

## Listas y orden de salida

La lista provisional de la UCI ya está cargada (sin dorsales). La Start List
oficial de Tissot se importa a mano con `cc-startlists-corredores`: el carril
automático `tissot-startlists-sync.mjs` se retiró del runner del VPS el
2026-09-25. El script se conserva en el repositorio; al ejecutarlo sustituye la
provisional y fija `startlistProvisional=false`, y en las CRI aplica además el
orden de salida con hora local (`start_order_entries`, `timezone`, asset
`startOrder`). Prueba dirigida sin escritura:

```
node scripts/results-fetchers/tissot-startlists-sync.mjs --race-id <raceId> --dry-run
```

La resolución de identidad reutiliza la selección y la ficha ya existentes
(por UCI ID y por país), así que variantes de Tissot como `CZECHIA` o `ATHLETE
INDIVIDUAL NEUTRAL` no crean equipos nuevos. Si la preparación devuelve
excepciones, no se escribe nada y se revisa con `cc-startlists-corredores`.

## Referencias

- Fetcher y contrato: `scripts/results-fetchers/README.md`.
- Operación del VPS: `docs/runbooks/results-vps.md`.
- El contrato de endpoints de Tissot no está en el repositorio.
