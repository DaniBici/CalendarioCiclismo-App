# Alta de carreras y resultados UCI 2026 — 2026-08-29

## Alcance

Se han creado fichas mínimas de carreras disputadas en 2026 para almacenar
exclusivamente jornadas y resultados oficiales de DataRide. No se han creado
inscritos, afiliaciones de equipos, orden de salida, perfiles, GPX, mapas,
rutómetros, emisiones ni otros assets.

El inventario de partida fue el cruce de
[`cruce-final-carreras-uci-2026-20260829.md`](cruce-final-carreras-uci-2026-20260829.md):
342 candidatas elegibles, cinco pruebas directas y 337 pruebas de campeonatos
nacionales élite y sub23, masculinas y femeninas.

## Control de duplicados

Antes de escribir se comprobó cada candidatura contra `races`,
`race_uci_links`, `race_uci_stages` y `race_uci_results`, incluyendo coincidencia
por país, género, edad, modalidad y fecha. No existían duplicados en la base.

La inspección de las propias respuestas de DataRide detectó una única duplicidad
de fuente:

| Se conserva | Se descarta | Control |
|:---|:---|:---|
| `competitionId=77919`, `uciRaceId=255816`, 25-06-2026 | `competitionId=78924`, `uciRaceId=264370`, 24-06-2026 | mismos 27 clasificados y mismos tiempos; la segunda respuesta solo añade tres DNS |

La entrada conservada pertenece al contenedor nacional completo de Argelia. No
se crean dos fichas para ese CRI. Tras la consolidación no hay nombres de carrera
duplicados, slugs duplicados ni duplicados de slot país/género/edad/modalidad/fecha.

## DataRide

Se verificaron las 110 competiciones que contienen las 342 candidatas originales.
Las 342 carreras UCI concretas se localizaron por su `race.Id`; la respuesta de
`Races/` expone `StartDate`, `EndDate`, `RaceName`, `CategoryCode`,
`RaceTypeCode`, `StartLocation`, `EndLocation`, `EventResultPage`, `Venue` y
`Date`, pero no un campo de kilometraje.

En las 347 entradas de `Races/` inspeccionadas, `StartLocation` y `EndLocation`
están vacíos y no hay distancia utilizable. Por tanto, las fichas se han creado
sin salida, llegada ni kilómetros. No se han inferido esos datos desde fuentes
secundarias.

La disponibilidad del resultado se comprobó además con el fetcher existente:

- `BIWASE Cup` (`77540`): cinco etapas, del 10 al 14 de marzo.
- Campeonatos Centroamericanos (`78861`–`78864`): cuatro pruebas directas.
- CRI argelino de control (`77919/255816` y `78924/264370`): ambas respuestas
  contienen la misma clasificación, lo que permitió cerrar la duplicidad.

## Alta realizada

| Registro | Número |
|:---|---:|
| Carreras nuevas | 341 |
| Campeonatos nacionales | 336 |
| Pruebas directas | 5 |
| Jornadas | 345 |
| Enlaces `race_uci_links` | 341 |
| Startlists nuevas | 0 |
| Assets nuevos | 0 |

Las carreras nuevas llevan `races.resultsOnly=true`, `uciCategory='CN'` para
los campeonatos nacionales, `editorialStatus='published'` en sus jornadas y
`hasAssets=false`. BIWASE tiene cinco jornadas; no se ha creado una jornada
separada para la clasificación final de la vuelta.

En el alta, los 341 enlaces quedaron `pending` y sin stages ni resultados. La
primera pasada real del VPS procesó después una de las carreras, por lo que el
estado observado tras esa ejecución es de 340 enlaces `pending`, un stage UCI y
16 resultados. Esto confirma el drenaje de la cola sin sembrar inscritos.

## Procesamiento en VPS

El runner de `/opt/calendario-ciclismo` ejecuta, por este orden:

1. una solicitud manual encolada, si existe;
2. `results-cron.mjs --configured` para jornadas dentro de ventana;
3. `results-cron.mjs --scope backlog --limit 1` para una carrera histórica
   pendiente.

El paso de backlog se ejecuta en cada tick del timer `cc-results.timer`. El
guard de `resultsOnly` impide añadir `--seed-startlist`; los corredores se
resolverán por la identidad disponible en el resultado y no por una lista de
inscritos creada artificialmente. Un payload vacío deja el enlace en `pending`.

La actualización del checkout del VPS se realiza con el procedimiento de
[`../runbooks/results-vps.md`](../runbooks/results-vps.md). Tras publicar el cambio de runner,
debe verificarse el journal del servicio y el descenso progresivo de los enlaces
pendientes en Supabase.

La primera ejecución manual de comprobación del 29-08-2026 terminó con código
correcto. Procesó el CRI masculino de Kirguistán (`77939/256016`), enlazó sus
16 filas con 13 fichas globales nuevas y dejó `startlist_riders=0` para el
conjunto `resultsOnly`.
