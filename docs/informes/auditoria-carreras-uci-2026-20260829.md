# Auditoría de carreras UCI 2026 ausentes — 2026-08-29

## Alcance

Auditoría en solo lectura previa a cualquier reconstrucción o alta. El objetivo es
localizar carreras de 2026 de carretera élite y sub-23 que no estén en la base y
separarlas de las carreras que ya existen pero todavía no tienen enlace UCI. No se
han creado carreras, jornadas, resultados, startlists ni assets.

Este documento conserva el inventario de la primera pasada. El cruce posterior
contra categorías concretas de `Races/` y contra resultados ya existentes está
cerrado en
[`cruce-final-carreras-uci-2026-20260829.md`](cruce-final-carreras-uci-2026-20260829.md);
ese documento es la referencia para cualquier fase de alta posterior.

Se incluyen las clases UCI de élite y sub-23 del calendario de carretera, además de
los campeonatos nacionales. En los campeonatos nacionales DataRide publica una
competición contenedora; se ha descendido a `Races/` y se han incluido únicamente
las pruebas `elite`/`u23` de ruta (`IRR`), contrarreloj individual (`ITT`) y
contrarreloj por equipos (`TTT` cuando existe). Se excluyen las pruebas
exclusivamente junior.

El corte temporal es el 2026-08-29. Las competiciones de la temporada UCI 2026
cuya fecha inicial cae en diciembre de 2025 se excluyen del calendario natural
2026. La tolerancia de comparación de fechas es de un día por la serialización
`/Date(ms)/` de DataRide y por la diferencia entre fecha UCI y fecha editorial.

## Fuentes y procedimiento reproducible

- DataRide carretera, `disciplineId=10`, `SeasonId=464`, endpoint público
  `https://dataride.uci.ch/iframe/Competitions/`, paginado con `take=500`.
- DataRide `https://dataride.uci.ch/iframe/Races/` para expandir cada campeonato
  nacional a sus pruebas concretas.
- Supabase, mediante el conector MCP, lectura de `races` de `year=2026` y de sus
  enlaces en `race_uci_links`.
- La clasificación de categorías se alinea con las clases de los calendarios
  internacionales UCI; la UCI documenta las clases de élite y sub-23 en su
  [procedimiento de calendarios de carretera](https://docs.uci.org/documents/calendar/ProcedureENG.pdf).
- DataRide mantiene la consulta pública de [resultados de carretera](https://dataride.uci.org/iframe/Results/1/).

El emparejamiento usa clase, país, solape de fechas y género cuando la fuente lo
expresa. Para los campeonatos nacionales añade edad (`elite`/`u23`), género y tipo
de prueba. El nombre solo confirma o desempata; no se da de alta una carrera por
coincidencia nominal aislada.

El informe reproducible de esta auditoría se verificó con SHA-256
`c48e4c07e8344fad80a2db195f7ecb4a35c95fa16f72f84894a4ae9608ea08b3`; el script
local utilizado para generarlo tiene SHA-256
`e0a017961248da52fd84875d22259720d0f3875124ecb119f6a68c5b249019d6`. Ambos
artefactos temporales se eliminan al cerrar la auditoría.

## Controles de partida y resultado

| Control | Resultado |
|---|---:|
| Competiciones devueltas por DataRide | 650 |
| Competiciones objetivo tras excluir junior | 547 |
| Competiciones directas objetivo | 375 |
| Competiciones nacionales contenedoras | 172 |
| Pruebas nacionales elite/u23 expandidas | 613 |
| Pruebas objetivo del año natural 2026 | 960 |
| Pruebas finalizadas al corte | 959 |
| Pruebas futuras al corte | 1 (`76406`, La Vuelta Ciclista a España) |
| Carreras `races` en Supabase, año 2026 | 816 |
| Pruebas UCI con enlace ya existente | 375 |
| Carreras existentes sin enlace UCI | 194 |
| Candidatas sin contraparte clara | 383 |
| Candidatas ambiguas para revisión | 7 |

Las 383 candidatas se dividen en 43 pruebas directas y 340 pruebas de campeonatos
nacionales. Las 194 carreras existentes sin enlace se listan más adelante y no
deben generar una carrera nueva.

### Desglose de candidatas nacionales

| Edad | Género | Modalidad | Candidatas ausentes |
|:---|:---|:---|---:|
| elite | female | ITT | 52 |
| elite | female | RR | 54 |
| elite | male | ITT | 63 |
| elite | male | RR | 67 |
| u23 | female | ITT | 23 |
| u23 | female | RR | 11 |
| u23 | male | ITT | 43 |
| u23 | male | RR | 27 |

## Cj Williams

La comprobación previa buscó el perfil UCI `1610729`, el nombre Cj Williams y todas
las referencias directas en `race_uci_results`, `startlist_riders` y
`rider_team_affiliations`. El resultado fue cero filas en las cuatro comprobaciones.
No existe ficha de corredor que eliminar; no se ejecuta ningún `DELETE`. La
exclusión se mantiene como anomalía de fuente porque el roster externo lo identifica
como staff.

## Candidatas sin contraparte clara — 383

Estas filas son candidatas de alta; no son autorización de escritura. Antes de
crear una ficha de carrera hay que verificar que la competición tiene resultados
publicados en DataRide y confirmar que no existe una equivalencia editorial no
detectada por el emparejamiento.

| Ámbito | competitionId | uciRaceId | Nombre DataRide | Clase | País | Inicio UCI | Edad | Género | Tipo |
|:---|---:|---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| direct | 77711 | — | Druivenkoers - Overijse | 1.1 | BE | 2026-08-25 | — | — | — |
| direct | 79281 | — | Giochi del Mediterraneo - WE IRR | 1.2 | IT | 2026-08-23 | — | — | — |
| direct | 79282 | — | Giochi del Mediterraneo - ME IRR | 1.2 | IT | 2026-08-23 | — | — | — |
| direct | 77998 | — | La Ronde Des Vallées | 2.1 | FR | 2026-08-14 | — | — | — |
| direct | 77705 | — | Aubel-Thimister-Stavelot | 2.1 | BE | 2026-08-06 | — | — | — |
| direct | 79271 | — | Juegos centroamericanos y del Caribe, Santo Domingo RR - ME | 1.2 | DO | 2026-08-01 | — | — | — |
| direct | 79272 | — | Juegos centroamericanos y del Caribe, Santo Domingo RR - WE | 1.2 | DO | 2026-07-31 | — | — | — |
| direct | 77702 | — | Gran Premio "Sportivi di Loria" | 1.1 | IT | 2026-07-25 | — | — | — |
| direct | 77703 | — | Trofee van Vlaanderen | 1.1 | BE | 2026-07-21 | — | — | — |
| direct | 77697 | — | VALROMEY Tour Féminin III CNR CA - Montée du Grand Colombier | 1.1 | FR | 2026-07-13 | — | — | — |
| direct | 77696 | — | VALROMEY Tour Féminin II CNR CA | 1.1 | FR | 2026-07-12 | — | — | — |
| direct | 77695 | — | Menen Kemmel Menen | 1.1 | BE | 2026-07-11 | — | — | — |
| direct | 77694 | — | VALROMEY Tour Féminin I CNR CA | 1.1 | FR | 2026-07-10 | — | — | — |
| direct | 77693 | — | Ain Bugey Valromey Tour | 2.1 | FR | 2026-07-09 | — | — | — |
| direct | 77690 | — | Grand Prix de Luxembourg | 1.1 | LU | 2026-07-04 | — | — | — |
| direct | 77689 | — | Grand-Prix Général Patton | 1.1 | LU | 2026-07-03 | — | — | — |
| direct | 77688 | — | Sint Martinusprijs Kontich | 2.1 | BE | 2026-07-01 | — | — | — |
| direct | 77681 | — | Trofeo GD Dorigo - M.O. Sogno Veneto - Trofeo Merotto Spumanti | 1.1 | IT | 2026-06-13 | — | — | — |
| direct | 77613 | — | Trofeo Emozione | 1.1 | IT | 2026-06-12 | — | — | — |
| direct | 77675 | — | VeloBank Ślęża Tour Dolny Śląsk | 2.1 | PL | 2026-06-10 | — | — | — |
| direct | 77656 | — | Gipuzkoa Klasikoa | 2.1 | ES | 2026-05-29 | — | — | — |
| direct | 77649 | — | Ronde van Vlaanderen | 1.1 | BE | 2026-05-23 | — | — | — |
| direct | 77650 | — | Ronde van Vlaanderen | 1.1 | BE | 2026-05-23 | — | — | — |
| direct | 78696 | — | Coppa Tuscany Cycling Academy | 1.1 | IT | 2026-05-22 | — | — | — |
| direct | 77625 | — | In Flanders Fields - In Ieper | 1.1 | BE | 2026-05-09 | — | — | — |
| direct | 77626 | — | In Flanders Fields - In Ieper/GP André Noyelle | 1.1 | BE | 2026-05-09 | — | — | — |
| direct | 77622 | — | Liège-Bastogne-Liège | 1.1 | BE | 2026-05-08 | — | — | — |
| direct | 77614 | — | Grand Prix West Bohemia | 2.1 | CZ | 2026-05-01 | — | — | — |
| direct | 77608 | — | Course de Cujavie-Poméranie pour la Coupe du Président de la Ville de Grudziądz | 2.1 | PL | 2026-04-29 | — | — | — |
| direct | 77601 | — | Giro di Primavera - Trofeo Gino Mazzer | 1.1 | IT | 2026-04-25 | — | — | — |
| direct | 77598 | — | Coppa Montes Gran Premio della Resistenza | 1.1 | IT | 2026-04-24 | — | — | — |
| direct | 77587 | — | Penn Ar Bed - Bro An Hirwazh | 2.1 | FR | 2026-04-17 | — | — | — |
| direct | 78864 | — | Campeonato Centroamericano IRR - ME | 1.2 | CR | 2026-04-11 | — | — | — |
| direct | 77576 | — | Trofeu 15 d'Abril | 1.1 | ES | 2026-04-10 | — | — | — |
| direct | 78863 | — | Campeonato Centroamericano IRR - WE | 1.2 | CR | 2026-04-10 | — | — | — |
| direct | 78861 | — | Campeonato Centroamericano ITT - ME | 1.2 | CR | 2026-04-08 | — | — | — |
| direct | 78862 | — | Campeonato Centroamericano ITT - WE | 1.2 | CR | 2026-04-08 | — | — | — |
| direct | 77498 | — | Gran Premio del Perdono | 1.1 | IT | 2026-04-05 | — | — | — |
| direct | 77496 | — | STER Van Zuid Limburg | 2.1 | BE | 2026-04-02 | — | — | — |
| direct | 77992 | — | Tour du Bocage et de l'Ernée 53 | 2.1 | FR | 2026-03-27 | — | — | — |
| direct | 77493 | — | Guido Reybrouck Classic | 2.1 | BE | 2026-03-20 | — | — | — |
| direct | 77540 | — | BIWASE Cup | 2.2 | VN | 2026-03-09 | — | — | — |
| direct | 77486 | — | Gran Premi Les Franqueses KH7 | 1.1 | ES | 2026-03-07 | — | — | — |
| CN | 77939 | 256016 | National Road Championships - Kyrgystan — Men Elite - Individual Road Race | CN | KG | 2026-08-21 | elite | male | rr |
| CN | 77939 | 256018 | National Road Championships - Kyrgystan — Women Elite - Individual Road Race | CN | KG | 2026-08-21 | elite | female | rr |
| CN | 77939 | 256011 | National Road Championships - Kyrgystan — Men Elite - Individual Time Trial | CN | KG | 2026-08-21 | elite | male | itt |
| CN | 77939 | 256014 | National Road Championships - Kyrgystan — Women Elite - Individual Time Trial | CN | KG | 2026-08-21 | elite | female | itt |
| CN | 79253 | 266554 | National Road Championships - Lesotho — Men Elite - Individual Road Race | CN | LS | 2026-08-07 | elite | male | rr |
| CN | 79310 | 267090 | National Road Championships - Cape Verde — Men Elite - Individual Road Race | CN | CV | 2026-07-23 | elite | male | rr |
| CN | 79310 | 267093 | National Road Championships - Cape Verde — Women Elite - Individual Road Race | CN | CV | 2026-07-23 | elite | female | rr |
| CN | 79310 | 267096 | National Road Championships - Cape Verde — Men Elite - Individual Time Trial | CN | CV | 2026-07-23 | elite | male | itt |
| CN | 79310 | 267098 | National Road Championships - Cape Verde — Men Under 23 - Individual Time Trial | CN | CV | 2026-07-23 | u23 | male | itt |
| CN | 79310 | 267099 | National Road Championships - Cape Verde — Women Elite - Individual Time Trial | CN | CV | 2026-07-23 | elite | female | itt |
| CN | 77950 | 256063 | National Road Championships - St. Maarten — Men Elite - Individual Time Trial | CN | SX | 2026-07-17 | elite | male | itt |
| CN | 77950 | 256066 | National Road Championships - St. Maarten — Women Elite - Individual Time Trial | CN | SX | 2026-07-17 | elite | female | itt |
| CN | 77950 | 256069 | National Road Championships - St. Maarten — Men Elite - Individual Road Race | CN | SX | 2026-07-17 | elite | male | rr |
| CN | 77950 | 256072 | National Road Championships - St. Maarten — Women Elite - Individual Road Race | CN | SX | 2026-07-17 | elite | female | rr |
| CN | 78725 | 263166 | National Road Championships - Georgia — Men Elite - Individual Road Race | CN | GE | 2026-07-17 | elite | male | rr |
| CN | 78725 | 263168 | National Road Championships - Georgia — Men Elite - Individual Time Trial | CN | GE | 2026-07-17 | elite | male | itt |
| CN | 79292 | 266919 | National Road Championships - Burkina Faso — Men Elite - Individual Road Race | CN | BF | 2026-07-17 | elite | male | rr |
| CN | 79292 | 266917 | National Road Championships - Burkina Faso — Women Elite - Individual Road Race | CN | BF | 2026-07-17 | elite | female | rr |
| CN | 77888 | 255527 | National Road Championships - France (Junior/U23) — Men Under 23 - Individual Road Race | CN | FR | 2026-07-14 | u23 | male | rr |
| CN | 77888 | 255529 | National Road Championships - France (Junior/U23) — Women Under 23 - Individual Road Race | CN | FR | 2026-07-14 | u23 | female | rr |
| CN | 77888 | 255523 | National Road Championships - France (Junior/U23) — Men Under 23 - Individual Time Trial | CN | FR | 2026-07-14 | u23 | male | itt |
| CN | 77888 | 255525 | National Road Championships - France (Junior/U23) — Women Under 23 - Individual Time Trial | CN | FR | 2026-07-14 | u23 | female | itt |
| CN | 78084 | 258375 | National Road Championships - Iran — Men Elite - Individual Time Trial | CN | IR | 2026-07-14 | elite | male | itt |
| CN | 78084 | 258371 | National Road Championships - Iran — Men Elite - Individual Road Race | CN | IR | 2026-07-14 | elite | male | rr |
| CN | 78084 | 258372 | National Road Championships - Iran — Women Elite - Individual Time Trial | CN | IR | 2026-07-14 | elite | female | itt |
| CN | 78084 | 258368 | National Road Championships - Iran — Women Elite - Individual Road Race | CN | IR | 2026-07-14 | elite | female | rr |
| CN | 79327 | 267314 | National Road Championships - Malta (IRR) — Men Elite - Individual Road Race | CN | MT | 2026-07-11 | elite | male | rr |
| CN | 77955 | 256091 | National Road Championships - Czechia (MU) — Men Under 23 - Individual Road Race | CN | CZ | 2026-07-04 | u23 | male | rr |
| CN | 79302 | 266963 | National Road Championships - Ivory Coast — Men Elite - Individual Road Race | CN | CI | 2026-07-04 | elite | male | rr |
| CN | 79302 | 266966 | National Road Championships - Ivory Coast — Women Under 23 - Individual Road Race | CN | CI | 2026-07-04 | u23 | female | rr |
| CN | 77941 | 256032 | National Road Championships - Slovakia (MU IRR) — Men Under 23 - Individual Road Race | CN | SK | 2026-07-03 | u23 | male | rr |
| CN | 79020 | 265001 | National Road Championships - Mongolia — Women Elite - Individual Road Race | CN | MN | 2026-07-03 | elite | female | rr |
| CN | 79020 | 264997 | National Road Championships - Mongolia — Women Elite - Individual Time Trial | CN | MN | 2026-07-03 | elite | female | itt |
| CN | 79210 | 266152 | National Road Championships - Austria (MU/WU) — Men Under 23 - Individual Road Race | CN | AT | 2026-07-03 | u23 | male | rr |
| CN | 79211 | 266154 | National Road Championships - Germany (MU/WU) — Men Under 23 - Individual Road Race | CN | DE | 2026-07-03 | u23 | male | rr |
| CN | 79213 | 266158 | National Road Championships - Switzerland (MU/WU) — Men Under 23 - Individual Road Race | CN | CH | 2026-07-03 | u23 | male | rr |
| CN | 79250 | 266533 | National Road Championships - Mongolia (ME) — Men Elite - Individual Time Trial | CN | MN | 2026-07-03 | elite | male | itt |
| CN | 79250 | 266532 | National Road Championships - Mongolia (ME) — Men Elite - Individual Road Race | CN | MN | 2026-07-03 | elite | male | rr |
| CN | 77917 | 255803 | National Road Championships - Uzbekistan — Men Elite - Individual Road Race | CN | UZ | 2026-06-29 | elite | male | rr |
| CN | 77917 | 255802 | National Road Championships - Uzbekistan — Women Elite - Individual Road Race | CN | UZ | 2026-06-29 | elite | female | rr |
| CN | 77917 | 255800 | National Road Championships - Uzbekistan — Men Elite - Individual Time Trial | CN | UZ | 2026-06-29 | elite | male | itt |
| CN | 77917 | 255801 | National Road Championships - Uzbekistan — Women Elite - Individual Time Trial | CN | UZ | 2026-06-29 | elite | female | itt |
| CN | 77952 | 256081 | National Road Championships - Dominica — Men Elite - Individual Road Race | CN | DM | 2026-06-27 | elite | male | rr |
| CN | 77954 | 256088 | National Road Championships - Lebanon — Men Elite - Individual Road Race | CN | LB | 2026-06-27 | elite | male | rr |
| CN | 77954 | 256090 | National Road Championships - Lebanon — Women Elite - Individual Road Race | CN | LB | 2026-06-27 | elite | female | rr |
| CN | 77954 | 256085 | National Road Championships - Lebanon — Men Elite - Individual Time Trial | CN | LB | 2026-06-27 | elite | male | itt |
| CN | 77954 | 256087 | National Road Championships - Lebanon — Women Elite - Individual Time Trial | CN | LB | 2026-06-27 | elite | female | itt |
| CN | 78892 | 264125 | National Road Championships - Puerto Rico — Men Elite - Individual Time Trial | CN | PR | 2026-06-27 | elite | male | itt |
| CN | 78892 | 264127 | National Road Championships - Puerto Rico — Men Under 23 - Individual Time Trial | CN | PR | 2026-06-27 | u23 | male | itt |
| CN | 78892 | 264128 | National Road Championships - Puerto Rico — Women Elite - Individual Time Trial | CN | PR | 2026-06-27 | elite | female | itt |
| CN | 78892 | 264121 | National Road Championships - Puerto Rico — Men Elite - Individual Road Race | CN | PR | 2026-06-27 | elite | male | rr |
| CN | 78892 | 264122 | National Road Championships - Puerto Rico — Women Elite - Individual Road Race | CN | PR | 2026-06-27 | elite | female | rr |
| CN | 79328 | 267313 | National Road Championships - Malta (ITT) — Men Elite - Individual Time Trial | CN | MT | 2026-06-27 | elite | male | itt |
| CN | 79347 | 267416 | National Road Championships - Senegal (WE) — Women Elite - Individual Road Race | CN | SN | 2026-06-27 | elite | female | rr |
| CN | 79348 | 267415 | National Road Championships - Senegal (ME) — Men Elite - Individual Road Race | CN | SN | 2026-06-27 | elite | male | rr |
| CN | 77891 | 255538 | National Road Championships - Japan — Men Under 23 - Individual Road Race | CN | JP | 2026-06-26 | u23 | male | rr |
| CN | 77928 | 255909 | National Road Championships - Azerbaijan — Men Elite - Individual Road Race | CN | AZ | 2026-06-26 | elite | male | rr |
| CN | 77928 | 255902 | National Road Championships - Azerbaijan — Men Elite - Individual Time Trial | CN | AZ | 2026-06-26 | elite | male | itt |
| CN | 77938 | 256006 | National Road Championships - Barbados — Men Elite - Individual Road Race | CN | BB | 2026-06-26 | elite | male | rr |
| CN | 77938 | 256008 | National Road Championships - Barbados — Women Elite - Individual Road Race | CN | BB | 2026-06-26 | elite | female | rr |
| CN | 77938 | 256002 | National Road Championships - Barbados — Men Elite - Individual Time Trial | CN | BB | 2026-06-26 | elite | male | itt |
| CN | 77938 | 256004 | National Road Championships - Barbados — Women Elite - Individual Time Trial | CN | BB | 2026-06-26 | elite | female | itt |
| CN | 77948 | 256049 | National Road Championships - Mauritius — Men Under 23 - Individual Road Race | CN | MU | 2026-06-26 | u23 | male | rr |
| CN | 77948 | 256043 | National Road Championships - Mauritius — Men Under 23 - Individual Time Trial | CN | MU | 2026-06-26 | u23 | male | itt |
| CN | 77953 | 256082 | National Road Championships - Cameroun — Men Elite - Individual Road Race | CN | CM | 2026-06-26 | elite | male | rr |
| CN | 77953 | 263162 | National Road Championships - Cameroun — Men Elite - Individual Time Trial | CN | CM | 2026-06-26 | elite | male | itt |
| CN | 78117 | 258721 | National Road Championships - Cayman Islands — Men Elite - Individual Road Race | CN | KY | 2026-06-26 | elite | male | rr |
| CN | 78117 | 258723 | National Road Championships - Cayman Islands — Women Elite - Individual Road Race | CN | KY | 2026-06-26 | elite | female | rr |
| CN | 78117 | 258725 | National Road Championships - Cayman Islands — Men Elite - Individual Time Trial | CN | KY | 2026-06-26 | elite | male | itt |
| CN | 78117 | 258727 | National Road Championships - Cayman Islands — Men Under 23 - Individual Time Trial | CN | KY | 2026-06-26 | u23 | male | itt |
| CN | 78117 | 258728 | National Road Championships - Cayman Islands — Women Elite - Individual Time Trial | CN | KY | 2026-06-26 | elite | female | itt |
| CN | 78329 | 260052 | National Road Championships - Sweden — Men Elite - Individual Road Race | CN | SE | 2026-06-26 | elite | male | rr |
| CN | 78395 | 260560 | National Road Championships - Antigua and Barbuda — Men Elite - Individual Road Race | CN | AG | 2026-06-26 | elite | male | rr |
| CN | 78395 | 260561 | National Road Championships - Antigua and Barbuda — Men Elite - Individual Time Trial | CN | AG | 2026-06-26 | elite | male | itt |
| CN | 78396 | 260562 | National Road Championships - Honduras — Men Elite - Individual Road Race | CN | HN | 2026-06-26 | elite | male | rr |
| CN | 78396 | 260564 | National Road Championships - Honduras — Women Elite - Individual Road Race | CN | HN | 2026-06-26 | elite | female | rr |
| CN | 78396 | 260566 | National Road Championships - Honduras — Men Elite - Individual Time Trial | CN | HN | 2026-06-26 | elite | male | itt |
| CN | 78396 | 260569 | National Road Championships - Honduras — Women Elite - Individual Time Trial | CN | HN | 2026-06-26 | elite | female | itt |
| CN | 78413 | 260635 | National Road Championships - Peru — Men Elite - Individual Road Race | CN | PE | 2026-06-26 | elite | male | rr |
| CN | 78413 | 260636 | National Road Championships - Peru — Women Elite - Individual Road Race | CN | PE | 2026-06-26 | elite | female | rr |
| CN | 78413 | 260637 | National Road Championships - Peru — Men Elite - Individual Time Trial | CN | PE | 2026-06-26 | elite | male | itt |
| CN | 78413 | 260638 | National Road Championships - Peru — Men Under 23 - Individual Time Trial | CN | PE | 2026-06-26 | u23 | male | itt |
| CN | 78413 | 260639 | National Road Championships - Peru — Women Elite - Individual Time Trial | CN | PE | 2026-06-26 | elite | female | itt |
| CN | 78712 | 262939 | National Road Championships - Jamaica — Men Elite - Individual Road Race | CN | JM | 2026-06-26 | elite | male | rr |
| CN | 78712 | 262943 | National Road Championships - Jamaica — Men Elite - Individual Time Trial | CN | JM | 2026-06-26 | elite | male | itt |
| CN | 78712 | 262945 | National Road Championships - Jamaica — Men Under 23 - Individual Time Trial | CN | JM | 2026-06-26 | u23 | male | itt |
| CN | 78712 | 262946 | National Road Championships - Jamaica — Women Elite - Individual Time Trial | CN | JM | 2026-06-26 | elite | female | itt |
| CN | 78807 | 263554 | National Road Championships - Bulgaria — Men Elite - Individual Road Race | CN | BG | 2026-06-26 | elite | male | rr |
| CN | 78807 | 263556 | National Road Championships - Bulgaria — Women Elite - Individual Road Race | CN | BG | 2026-06-26 | elite | female | rr |
| CN | 78807 | 263558 | National Road Championships - Bulgaria — Men Elite - Individual Time Trial | CN | BG | 2026-06-26 | elite | male | itt |
| CN | 78807 | 263560 | National Road Championships - Bulgaria — Men Under 23 - Individual Time Trial | CN | BG | 2026-06-26 | u23 | male | itt |
| CN | 78807 | 263561 | National Road Championships - Bulgaria — Women Elite - Individual Time Trial | CN | BG | 2026-06-26 | elite | female | itt |
| CN | 78873 | 264015 | National Road Championships - Laos — Men Elite - Individual Road Race | CN | LA | 2026-06-26 | elite | male | rr |
| CN | 78873 | 264017 | National Road Championships - Laos — Men Elite - Individual Time Trial | CN | LA | 2026-06-26 | elite | male | itt |
| CN | 79035 | 265132 | National Road Championships - Croatia — Men Elite - Individual Road Race | CN | HR | 2026-06-26 | elite | male | rr |
| CN | 79035 | 265134 | National Road Championships - Croatia — Women Elite - Individual Road Race | CN | HR | 2026-06-26 | elite | female | rr |
| CN | 79035 | 265136 | National Road Championships - Croatia — Men Elite - Individual Time Trial | CN | HR | 2026-06-26 | elite | male | itt |
| CN | 79035 | 265138 | National Road Championships - Croatia — Women Elite - Individual Time Trial | CN | HR | 2026-06-26 | elite | female | itt |
| CN | 79109 | 265827 | National Road Championships - Trinidad and Tobago — Men Elite - Individual Road Race | CN | TT | 2026-06-26 | elite | male | rr |
| CN | 79109 | 265831 | National Road Championships - Trinidad and Tobago — Men Elite - Individual Time Trial | CN | TT | 2026-06-26 | elite | male | itt |
| CN | 79109 | 265833 | National Road Championships - Trinidad and Tobago — Men Under 23 - Individual Time Trial | CN | TT | 2026-06-26 | u23 | male | itt |
| CN | 79248 | 266529 | National Road Championships - Trinidad and Tobago (WE) — Women Elite - Individual Road Race | CN | TT | 2026-06-26 | elite | female | rr |
| CN | 79248 | 266528 | National Road Championships - Trinidad and Tobago (WE) — Women Elite - Individual Time Trial | CN | TT | 2026-06-26 | elite | female | itt |
| CN | 79249 | 266530 | National Road Championships - Sweden (WE) — Women Elite - Individual Road Race | CN | SE | 2026-06-26 | elite | female | rr |
| CN | 79252 | 266545 | National Road Championships - Montenegro — Men Elite - Individual Road Race | CN | ME | 2026-06-26 | elite | male | rr |
| CN | 79252 | 266553 | National Road Championships - Montenegro — Men Elite - Individual Time Trial | CN | ME | 2026-06-26 | elite | male | itt |
| CN | 79258 | 266580 | National Road Championships - St. Vincent & the Grenadines — Men Elite - Individual Road Race | CN | VC | 2026-06-26 | elite | male | rr |
| CN | 79258 | 266581 | National Road Championships - St. Vincent & the Grenadines — Men Elite - Individual Time Trial | CN | VC | 2026-06-26 | elite | male | itt |
| CN | 79279 | 266791 | National Road Championships - Rwanda — Men Elite - Individual Road Race | CN | RW | 2026-06-26 | elite | male | rr |
| CN | 79279 | 266793 | National Road Championships - Rwanda — Women Elite - Individual Road Race | CN | RW | 2026-06-26 | elite | female | rr |
| CN | 79279 | 266795 | National Road Championships - Rwanda — Men Elite - Individual Time Trial | CN | RW | 2026-06-26 | elite | male | itt |
| CN | 79279 | 266797 | National Road Championships - Rwanda — Women Elite - Individual Time Trial | CN | RW | 2026-06-26 | elite | female | itt |
| CN | 77932 | 255938 | National Road Championships - Denmark — Men Under 23 - Individual Time Trial | CN | DK | 2026-06-25 | u23 | male | itt |
| CN | 77933 | 255954 | National Road Championships - Serbia — Women Elite - Individual Road Race | CN | RS | 2026-06-25 | elite | female | rr |
| CN | 77933 | 255950 | National Road Championships - Serbia — Women Elite - Individual Time Trial | CN | RS | 2026-06-25 | elite | female | itt |
| CN | 77934 | 255961 | National Road Championships - Slovenia — Women Under 23 - Individual Time Trial | CN | SI | 2026-06-25 | u23 | female | itt |
| CN | 77935 | 255974 | National Road Championships - Singapore — Men Elite - Individual Road Race | CN | SG | 2026-06-25 | elite | male | rr |
| CN | 77935 | 255977 | National Road Championships - Singapore — Women Elite - Individual Road Race | CN | SG | 2026-06-25 | elite | female | rr |
| CN | 77935 | 255968 | National Road Championships - Singapore — Men Elite - Individual Time Trial | CN | SG | 2026-06-25 | elite | male | itt |
| CN | 77935 | 255970 | National Road Championships - Singapore — Men Under 23 - Individual Time Trial | CN | SG | 2026-06-25 | u23 | male | itt |
| CN | 77935 | 255971 | National Road Championships - Singapore — Women Elite - Individual Time Trial | CN | SG | 2026-06-25 | elite | female | itt |
| CN | 77936 | 255982 | National Road Championships - Canada — Men Under 23 - Individual Time Trial | CN | CA | 2026-06-25 | u23 | male | itt |
| CN | 77936 | 255985 | National Road Championships - Canada — Women Under 23 - Individual Time Trial | CN | CA | 2026-06-25 | u23 | female | itt |
| CN | 78253 | 259040 | National Road Championships - Jordan — Men Elite - Individual Time Trial | CN | JO | 2026-06-25 | elite | male | itt |
| CN | 78253 | 259042 | National Road Championships - Jordan — Men Under 23 - Individual Time Trial | CN | JO | 2026-06-25 | u23 | male | itt |
| CN | 78253 | 259043 | National Road Championships - Jordan — Women Elite - Individual Time Trial | CN | JO | 2026-06-25 | elite | female | itt |
| CN | 78253 | 259045 | National Road Championships - Jordan — Women Under 23 - Individual Time Trial | CN | JO | 2026-06-25 | u23 | female | itt |
| CN | 78253 | 259036 | National Road Championships - Jordan — Men Elite - Individual Road Race | CN | JO | 2026-06-25 | elite | male | rr |
| CN | 78253 | 259038 | National Road Championships - Jordan — Women Elite - Individual Road Race | CN | JO | 2026-06-25 | elite | female | rr |
| CN | 78331 | 260078 | National Road Championships - Greece — Men Elite - Individual Road Race | CN | GR | 2026-06-25 | elite | male | rr |
| CN | 78331 | 260079 | National Road Championships - Greece — Women Elite - Individual Road Race | CN | GR | 2026-06-25 | elite | female | rr |
| CN | 78331 | 260076 | National Road Championships - Greece — Men Elite - Individual Time Trial | CN | GR | 2026-06-25 | elite | male | itt |
| CN | 78331 | 260077 | National Road Championships - Greece — Women Elite - Individual Time Trial | CN | GR | 2026-06-25 | elite | female | itt |
| CN | 78702 | 262890 | National Road Championships - Morroco — Men Elite - Individual Road Race | CN | MA | 2026-06-25 | elite | male | rr |
| CN | 78702 | 262892 | National Road Championships - Morroco — Women Elite - Individual Road Race | CN | MA | 2026-06-25 | elite | female | rr |
| CN | 78702 | 262894 | National Road Championships - Morroco — Men Elite - Individual Time Trial | CN | MA | 2026-06-25 | elite | male | itt |
| CN | 78702 | 262896 | National Road Championships - Morroco — Men Under 23 - Individual Time Trial | CN | MA | 2026-06-25 | u23 | male | itt |
| CN | 78702 | 262897 | National Road Championships - Morroco — Women Elite - Individual Time Trial | CN | MA | 2026-06-25 | elite | female | itt |
| CN | 78702 | 262899 | National Road Championships - Morroco — Women Under 23 - Individual Time Trial | CN | MA | 2026-06-25 | u23 | female | itt |
| CN | 78713 | 262949 | National Road Championships - Guinea-Bissau — Men Elite - Individual Road Race | CN | GW | 2026-06-25 | elite | male | rr |
| CN | 78713 | 262952 | National Road Championships - Guinea-Bissau — Men Elite - Individual Time Trial | CN | GW | 2026-06-25 | elite | male | itt |
| CN | 78713 | 262954 | National Road Championships - Guinea-Bissau — Men Under 23 - Individual Time Trial | CN | GW | 2026-06-25 | u23 | male | itt |
| CN | 78814 | 263736 | National Road Championships - Macedonia — Men Elite - Individual Road Race | CN | MK | 2026-06-25 | elite | male | rr |
| CN | 78814 | 263738 | National Road Championships - Macedonia — Women Elite - Individual Road Race | CN | MK | 2026-06-25 | elite | female | rr |
| CN | 78814 | 263739 | National Road Championships - Macedonia — Men Elite - Individual Time Trial | CN | MK | 2026-06-25 | elite | male | itt |
| CN | 78814 | 263741 | National Road Championships - Macedonia — Men Under 23 - Individual Time Trial | CN | MK | 2026-06-25 | u23 | male | itt |
| CN | 78814 | 263742 | National Road Championships - Macedonia — Women Elite - Individual Time Trial | CN | MK | 2026-06-25 | elite | female | itt |
| CN | 78932 | 264390 | National Road Championships - Guinea-Bissau (WE) — Women Elite - Individual Road Race | CN | GW | 2026-06-25 | elite | female | rr |
| CN | 78932 | 264389 | National Road Championships - Guinea-Bissau (WE) — Women Elite - Individual Time Trial | CN | GW | 2026-06-25 | elite | female | itt |
| CN | 78934 | 264394 | National Road Championships - Serbia (ME) — Men Elite - Individual Time Trial | CN | RS | 2026-06-25 | elite | male | itt |
| CN | 78934 | 264393 | National Road Championships - Serbia (ME) — Men Elite - Individual Road Race | CN | RS | 2026-06-25 | elite | male | rr |
| CN | 77923 | 255862 | National Road Championships - Korea — Men Elite - Individual Road Race | CN | KR | 2026-06-24 | elite | male | rr |
| CN | 77923 | 255863 | National Road Championships - Korea — Women Elite - Individual Road Race | CN | KR | 2026-06-24 | elite | female | rr |
| CN | 77923 | 255860 | National Road Championships - Korea — Men Elite - Individual Time Trial | CN | KR | 2026-06-24 | elite | male | itt |
| CN | 77923 | 255861 | National Road Championships - Korea — Women Elite - Individual Time Trial | CN | KR | 2026-06-24 | elite | female | itt |
| CN | 77931 | 255932 | National Road Championships - Brazil — Women Elite - Individual Road Race | CN | BR | 2026-06-24 | elite | female | rr |
| CN | 77931 | 266760 | National Road Championships - Brazil — Men Under 23 - Individual Road Race | CN | BR | 2026-06-24 | u23 | male | rr |
| CN | 77931 | 255929 | National Road Championships - Brazil — Men Under 23 - Individual Time Trial | CN | BR | 2026-06-24 | u23 | male | itt |
| CN | 77931 | 255930 | National Road Championships - Brazil — Women Elite - Individual Time Trial | CN | BR | 2026-06-24 | elite | female | itt |
| CN | 77940 | 256020 | National Road Championships - China — Men Elite - Individual Road Race | CN | CN | 2026-06-24 | elite | male | rr |
| CN | 77940 | 267310 | National Road Championships - China — Men Under 23 - Individual Road Race | CN | CN | 2026-06-24 | u23 | male | rr |
| CN | 77940 | 267311 | National Road Championships - China — Women Under 23 - Individual Road Race | CN | CN | 2026-06-24 | u23 | female | rr |
| CN | 77940 | 256023 | National Road Championships - China — Women Elite - Individual Time Trial | CN | CN | 2026-06-24 | elite | female | itt |
| CN | 77940 | 256026 | National Road Championships - China — Men Under 23 - Individual Time Trial | CN | CN | 2026-06-24 | u23 | male | itt |
| CN | 77940 | 256027 | National Road Championships - China — Women Under 23 - Individual Time Trial | CN | CN | 2026-06-24 | u23 | female | itt |
| CN | 77940 | 256030 | National Road Championships - China — Women Elite - Individual Road Race | CN | CN | 2026-06-24 | elite | female | rr |
| CN | 77940 | 256031 | National Road Championships - China — Men Elite - Individual Time Trial | CN | CN | 2026-06-24 | elite | male | itt |
| CN | 78884 | 264068 | National Road Championships - Andorra — Men Under 23 - Individual Road Race | CN | AD | 2026-06-24 | u23 | male | rr |
| CN | 78884 | 264070 | National Road Championships - Andorra — Women Elite - Individual Road Race | CN | AD | 2026-06-24 | elite | female | rr |
| CN | 78884 | 264071 | National Road Championships - Andorra — Men Under 23 - Individual Time Trial | CN | AD | 2026-06-24 | u23 | male | itt |
| CN | 78884 | 264073 | National Road Championships - Andorra — Women Elite - Individual Time Trial | CN | AD | 2026-06-24 | elite | female | itt |
| CN | 78931 | 264388 | National Road Championships - Brazil (ME) — Men Elite - Individual Road Race | CN | BR | 2026-06-24 | elite | male | rr |
| CN | 78931 | 264387 | National Road Championships - Brazil (ME) — Men Elite - Individual Time Trial | CN | BR | 2026-06-24 | elite | male | itt |
| CN | 78982 | 264612 | National Road Championships - Dominican Republic — Men Elite - Individual Road Race | CN | DO | 2026-06-24 | elite | male | rr |
| CN | 78982 | 264614 | National Road Championships - Dominican Republic — Women Elite - Individual Road Race | CN | DO | 2026-06-24 | elite | female | rr |
| CN | 78982 | 264622 | National Road Championships - Dominican Republic — Men Under 23 - Individual Road Race | CN | DO | 2026-06-24 | u23 | male | rr |
| CN | 78982 | 264616 | National Road Championships - Dominican Republic — Men Elite - Individual Time Trial | CN | DO | 2026-06-24 | elite | male | itt |
| CN | 78982 | 264618 | National Road Championships - Dominican Republic — Men Under 23 - Individual Time Trial | CN | DO | 2026-06-24 | u23 | male | itt |
| CN | 78982 | 264619 | National Road Championships - Dominican Republic — Women Elite - Individual Time Trial | CN | DO | 2026-06-24 | elite | female | itt |
| CN | 78982 | 264621 | National Road Championships - Dominican Republic — Women Under 23 - Individual Time Trial | CN | DO | 2026-06-24 | u23 | female | itt |
| CN | 79049 | 265203 | National Road Championships - Bermuda — Men Elite - Individual Road Race | CN | BM | 2026-06-24 | elite | male | rr |
| CN | 79049 | 265205 | National Road Championships - Bermuda — Women Elite - Individual Road Race | CN | BM | 2026-06-24 | elite | female | rr |
| CN | 79049 | 265207 | National Road Championships - Bermuda — Men Elite - Individual Time Trial | CN | BM | 2026-06-24 | elite | male | itt |
| CN | 79049 | 265209 | National Road Championships - Bermuda — Women Elite - Individual Time Trial | CN | BM | 2026-06-24 | elite | female | itt |
| CN | 79070 | 265244 | National Road Championships - Monaco — Men Elite - Individual Road Race | CN | MC | 2026-06-24 | elite | male | rr |
| CN | 79070 | 265245 | National Road Championships - Monaco — Men Elite - Individual Time Trial | CN | MC | 2026-06-24 | elite | male | itt |
| CN | 79131 | 266006 | Women's Road National Championships of Afghanistan — Women Elite - Individual Road Race | CN | AF | 2026-06-24 | elite | female | rr |
| CN | 79131 | 266007 | Women's Road National Championships of Afghanistan — Women Elite - Individual Time Trial | CN | AF | 2026-06-24 | elite | female | itt |
| CN | 79209 | 266143 | National Road Championships - Eritrea — Women Elite - Individual Road Race | CN | ER | 2026-06-24 | elite | female | rr |
| CN | 79209 | 266148 | National Road Championships - Eritrea — Women Elite - Individual Time Trial | CN | ER | 2026-06-24 | elite | female | itt |
| CN | 79246 | 266524 | National Road Championships - Eritrea (ME) — Men Elite - Individual Road Race | CN | ER | 2026-06-24 | elite | male | rr |
| CN | 79246 | 266525 | National Road Championships - Eritrea (ME) — Men Elite - Individual Time Trial | CN | ER | 2026-06-24 | elite | male | itt |
| CN | 77918 | 255811 | National Road Championships - Kosovo — Women Elite - Individual Road Race | CN | XK | 2026-06-23 | elite | female | rr |
| CN | 77918 | 266737 | National Road Championships - Kosovo — Men Under 23 - Individual Road Race | CN | XK | 2026-06-23 | u23 | male | rr |
| CN | 77918 | 255806 | National Road Championships - Kosovo — Men Elite - Individual Road Race | CN | XK | 2026-06-23 | elite | male | rr |
| CN | 77918 | 255807 | National Road Championships - Kosovo — Men Under 23 - Individual Time Trial | CN | XK | 2026-06-23 | u23 | male | itt |
| CN | 77918 | 255808 | National Road Championships - Kosovo — Women Elite - Individual Time Trial | CN | XK | 2026-06-23 | elite | female | itt |
| CN | 77918 | 255804 | National Road Championships - Kosovo — Men Elite - Individual Time Trial | CN | XK | 2026-06-23 | elite | male | itt |
| CN | 77919 | 255819 | National Road Championships - Algeria — Women Elite - Individual Road Race | CN | DZ | 2026-06-23 | elite | female | rr |
| CN | 77919 | 255816 | National Road Championships - Algeria — Men Elite - Individual Time Trial | CN | DZ | 2026-06-23 | elite | male | itt |
| CN | 77919 | 255817 | National Road Championships - Algeria — Men Under 23 - Individual Time Trial | CN | DZ | 2026-06-23 | u23 | male | itt |
| CN | 77919 | 255813 | National Road Championships - Algeria — Women Elite - Individual Time Trial | CN | DZ | 2026-06-23 | elite | female | itt |
| CN | 77919 | 255815 | National Road Championships - Algeria — Women Under 23 - Individual Time Trial | CN | DZ | 2026-06-23 | u23 | female | itt |
| CN | 77920 | 255829 | National Road Championships - Lithuania — Women Under 23 - Individual Time Trial | CN | LT | 2026-06-23 | u23 | female | itt |
| CN | 77922 | 255851 | National Road Championships - Kazakhstan — Men Under 23 - Individual Time Trial | CN | KZ | 2026-06-23 | u23 | male | itt |
| CN | 77922 | 255854 | National Road Championships - Kazakhstan — Women Under 23 - Individual Time Trial | CN | KZ | 2026-06-23 | u23 | female | itt |
| CN | 78083 | 258367 | National Road Championships - Ethiopia — Men Elite - Individual Road Race | CN | ET | 2026-06-23 | elite | male | rr |
| CN | 78083 | 258360 | National Road Championships - Ethiopia — Men Elite - Individual Time Trial | CN | ET | 2026-06-23 | elite | male | itt |
| CN | 78912 | 264245 | National Road Championships - Cyprus — Men Elite - Individual Road Race | CN | CY | 2026-06-23 | elite | male | rr |
| CN | 78912 | 264246 | National Road Championships - Cyprus — Women Elite - Individual Road Race | CN | CY | 2026-06-23 | elite | female | rr |
| CN | 78912 | 264241 | National Road Championships - Cyprus — Men Elite - Individual Time Trial | CN | CY | 2026-06-23 | elite | male | itt |
| CN | 78912 | 264242 | National Road Championships - Cyprus — Women Elite - Individual Time Trial | CN | CY | 2026-06-23 | elite | female | itt |
| CN | 78924 | 264371 | National Road Championships - Algeria (ME) — Men Elite - Individual Road Race | CN | DZ | 2026-06-23 | elite | male | rr |
| CN | 78924 | 264370 | National Road Championships - Algeria (ME) — Men Elite - Individual Time Trial | CN | DZ | 2026-06-23 | elite | male | itt |
| CN | 78925 | 264373 | National Road Championships - Ethiopia (WE) — Women Elite - Individual Road Race | CN | ET | 2026-06-23 | elite | female | rr |
| CN | 78925 | 264372 | National Road Championships - Ethiopia (WE) — Women Elite - Individual Time Trial | CN | ET | 2026-06-23 | elite | female | itt |
| CN | 78991 | 264668 | National Road Championships - Ukraine — Men Elite - Individual Road Race | CN | UA | 2026-06-23 | elite | male | rr |
| CN | 78991 | 264670 | National Road Championships - Ukraine — Women Elite - Individual Road Race | CN | UA | 2026-06-23 | elite | female | rr |
| CN | 78991 | 266803 | National Road Championships - Ukraine — Men Under 23 - Individual Road Race | CN | UA | 2026-06-23 | u23 | male | rr |
| CN | 78991 | 264672 | National Road Championships - Ukraine — Men Elite - Individual Time Trial | CN | UA | 2026-06-23 | elite | male | itt |
| CN | 78991 | 264675 | National Road Championships - Ukraine — Women Elite - Individual Time Trial | CN | UA | 2026-06-23 | elite | female | itt |
| CN | 78991 | 264674 | National Road Championships - Ukraine — Men Under 23 - Individual Time Trial | CN | UA | 2026-06-23 | u23 | male | itt |
| CN | 78991 | 264677 | National Road Championships - Ukraine — Women Under 23 - Individual Time Trial | CN | UA | 2026-06-23 | u23 | female | itt |
| CN | 77914 | 255775 | National Road Championships - Guatemala — Men Under 23 - Individual Road Race | CN | GT | 2026-06-20 | u23 | male | rr |
| CN | 77914 | 255773 | National Road Championships - Guatemala — Women Under 23 - Individual Road Race | CN | GT | 2026-06-20 | u23 | female | rr |
| CN | 77914 | 255766 | National Road Championships - Guatemala — Men Under 23 - Individual Time Trial | CN | GT | 2026-06-20 | u23 | male | itt |
| CN | 77949 | 256055 | National Road Championships - Bosnia and Herzegovina — Men Under 23 - Individual Time Trial | CN | BA | 2026-06-20 | u23 | male | itt |
| CN | 77949 | 256058 | National Road Championships - Bosnia and Herzegovina — Women Under 23 - Individual Time Trial | CN | BA | 2026-06-20 | u23 | female | itt |
| CN | 77949 | 264376 | National Road Championships - Bosnia and Herzegovina — Men Under 23 - Individual Road Race | CN | BA | 2026-06-20 | u23 | male | rr |
| CN | 77949 | 264377 | National Road Championships - Bosnia and Herzegovina — Women Under 23 - Individual Road Race | CN | BA | 2026-06-20 | u23 | female | rr |
| CN | 77909 | 255715 | National Road Championships - Hong Kong — Men Elite - Individual Road Race | CN | HK | 2026-06-19 | elite | male | rr |
| CN | 77909 | 266892 | National Road Championships - Hong Kong — Men Under 23 - Individual Road Race | CN | HK | 2026-06-19 | u23 | male | rr |
| CN | 77909 | 255710 | National Road Championships - Hong Kong — Men Elite - Individual Time Trial | CN | HK | 2026-06-19 | elite | male | itt |
| CN | 77909 | 255712 | National Road Championships - Hong Kong — Men Under 23 - Individual Time Trial | CN | HK | 2026-06-19 | u23 | male | itt |
| CN | 77910 | 267085 | National Road Championships - Israel — Men Under 23 - Individual Road Race | CN | IL | 2026-06-19 | u23 | male | rr |
| CN | 78342 | 260189 | National Road Championships - Benin — Men Elite - Individual Road Race | CN | BJ | 2026-06-19 | elite | male | rr |
| CN | 78342 | 260193 | National Road Championships - Benin — Men Elite - Individual Time Trial | CN | BJ | 2026-06-19 | elite | male | itt |
| CN | 78342 | 260195 | National Road Championships - Benin — Men Under 23 - Individual Time Trial | CN | BJ | 2026-06-19 | u23 | male | itt |
| CN | 78342 | 260198 | National Road Championships - Benin — Women Under 23 - Individual Time Trial | CN | BJ | 2026-06-19 | u23 | female | itt |
| CN | 78920 | 264362 | National Road Championships - Benin (WE) — Women Elite - Individual Road Race | CN | BJ | 2026-06-19 | elite | female | rr |
| CN | 78920 | 264361 | National Road Championships - Benin (WE) — Women Elite - Individual Time Trial | CN | BJ | 2026-06-19 | elite | female | itt |
| CN | 78921 | 264364 | National Road Championships - Hong Kong (WE) — Women Elite - Individual Road Race | CN | HK | 2026-06-19 | elite | female | rr |
| CN | 78921 | 264363 | National Road Championships - Hong Kong (WE) — Women Elite - Individual Time Trial | CN | HK | 2026-06-19 | elite | female | itt |
| CN | 78984 | 264627 | National Road Championships - Kenya — Men Elite - Individual Road Race | CN | KE | 2026-06-19 | elite | male | rr |
| CN | 78984 | 264629 | National Road Championships - Kenya — Women Elite - Individual Road Race | CN | KE | 2026-06-19 | elite | female | rr |
| CN | 78984 | 264631 | National Road Championships - Kenya — Men Elite - Individual Time Trial | CN | KE | 2026-06-19 | elite | male | itt |
| CN | 78984 | 264633 | National Road Championships - Kenya — Men Under 23 - Individual Time Trial | CN | KE | 2026-06-19 | u23 | male | itt |
| CN | 78984 | 264634 | National Road Championships - Kenya — Women Elite - Individual Time Trial | CN | KE | 2026-06-19 | elite | female | itt |
| CN | 78984 | 264636 | National Road Championships - Kenya — Women Under 23 - Individual Time Trial | CN | KE | 2026-06-19 | u23 | female | itt |
| CN | 79023 | 265013 | National Road Championships - Suriname — Women Elite - Individual Road Race | CN | SR | 2026-06-19 | elite | female | rr |
| CN | 79023 | 265015 | National Road Championships - Suriname — Men Elite - Individual Time Trial | CN | SR | 2026-06-19 | elite | male | itt |
| CN | 79023 | 265017 | National Road Championships - Suriname — Women Elite - Individual Time Trial | CN | SR | 2026-06-19 | elite | female | itt |
| CN | 79118 | 265873 | National Championships - Macao SAR — Men Elite - Individual Road Race | CN | MO | 2026-06-19 | elite | male | rr |
| CN | 79118 | 265874 | National Championships - Macao SAR — Men Elite - Individual Time Trial | CN | MO | 2026-06-19 | elite | male | itt |
| CN | 79221 | 266227 | National Road Championships - St. Lucia — Men Elite - Individual Road Race | CN | LC | 2026-06-19 | elite | male | rr |
| CN | 79221 | 266228 | National Road Championships - St. Lucia — Men Elite - Individual Time Trial | CN | LC | 2026-06-19 | elite | male | itt |
| CN | 79257 | 266577 | National Road Championships - Moldavia — Men Elite - Individual Road Race | CN | MD | 2026-06-19 | elite | male | rr |
| CN | 79257 | 266576 | National Road Championships - Moldavia — Men Elite - Individual Time Trial | CN | MD | 2026-06-19 | elite | male | itt |
| CN | 77906 | 255692 | National Road Championships - Belize — Women Elite - Individual Road Race | CN | BZ | 2026-06-18 | elite | female | rr |
| CN | 77906 | 266534 | National Road Championships - Belize — Men Under 23 - Individual Road Race | CN | BZ | 2026-06-18 | u23 | male | rr |
| CN | 77906 | 255686 | National Road Championships - Belize — Women Elite - Individual Time Trial | CN | BZ | 2026-06-18 | elite | female | itt |
| CN | 77906 | 255688 | National Road Championships - Belize — Women Under 23 - Individual Time Trial | CN | BZ | 2026-06-18 | u23 | female | itt |
| CN | 77906 | 255695 | National Road Championships - Belize — Men Under 23 - Individual Time Trial | CN | BZ | 2026-06-18 | u23 | male | itt |
| CN | 78919 | 264360 | National Road Championships - Belize (ME) — Men Elite - Individual Road Race | CN | BZ | 2026-06-18 | elite | male | rr |
| CN | 78919 | 264359 | National Road Championships - Belize (ME) — Men Elite - Individual Time Trial | CN | BZ | 2026-06-18 | elite | male | itt |
| CN | 77905 | 255681 | National Road Championships - Indonesia — Men Under 23 - Individual Road Race | CN | ID | 2026-06-17 | u23 | male | rr |
| CN | 77905 | 255683 | National Road Championships - Indonesia — Women Under 23 - Individual Road Race | CN | ID | 2026-06-17 | u23 | female | rr |
| CN | 77905 | 255678 | National Road Championships - Indonesia — Men Elite - Individual Road Race | CN | ID | 2026-06-17 | elite | male | rr |
| CN | 77905 | 255679 | National Road Championships - Indonesia — Women Elite - Individual Road Race | CN | ID | 2026-06-17 | elite | female | rr |
| CN | 77905 | 255674 | National Road Championships - Indonesia — Men Elite - Individual Time Trial | CN | ID | 2026-06-17 | elite | male | itt |
| CN | 77905 | 255676 | National Road Championships - Indonesia — Women Elite - Individual Time Trial | CN | ID | 2026-06-17 | elite | female | itt |
| CN | 77905 | 255672 | National Road Championships - Indonesia — Men Under 23 - Individual Time Trial | CN | ID | 2026-06-17 | u23 | male | itt |
| CN | 77905 | 255673 | National Road Championships - Indonesia — Women Under 23 - Individual Time Trial | CN | ID | 2026-06-17 | u23 | female | itt |
| CN | 79251 | 266535 | National Road Championships - Iceland — Men Elite - Individual Road Race | CN | IS | 2026-06-17 | elite | male | rr |
| CN | 79251 | 266537 | National Road Championships - Iceland — Women Elite - Individual Road Race | CN | IS | 2026-06-17 | elite | female | rr |
| CN | 79251 | 266539 | National Road Championships - Iceland — Men Elite - Individual Time Trial | CN | IS | 2026-06-17 | elite | male | itt |
| CN | 79251 | 266542 | National Road Championships - Iceland — Women Elite - Individual Time Trial | CN | IS | 2026-06-17 | elite | female | itt |
| CN | 77904 | 255671 | National Road Championships - Slovakia (MU ITT) — Men Under 23 - Individual Time Trial | CN | SK | 2026-06-12 | u23 | male | itt |
| CN | 79021 | 265004 | National Road Championships - Mongolia (MU) — Men Under 23 - Individual Road Race | CN | MN | 2026-05-29 | u23 | male | rr |
| CN | 79021 | 265003 | National Road Championships - Mongolia (MU) — Men Under 23 - Individual Time Trial | CN | MN | 2026-05-29 | u23 | male | itt |
| CN | 78700 | 262876 | National Road Championships - Romania (U23) — Men Under 23 - Individual Road Race | CN | RO | 2026-05-22 | u23 | male | rr |
| CN | 78700 | 262877 | National Road Championships - Romania (U23) — Women Under 23 - Individual Road Race | CN | RO | 2026-05-22 | u23 | female | rr |
| CN | 77880 | 255488 | National Road Championships - Belgium (ITT Junior/U23) — Men Under 23 - Individual Time Trial | CN | BE | 2026-04-30 | u23 | male | itt |
| CN | 77880 | 255490 | National Road Championships - Belgium (ITT Junior/U23) — Women Under 23 - Individual Time Trial | CN | BE | 2026-04-30 | u23 | female | itt |
| CN | 78385 | 260428 | National Road Championships - Panamá — Women Elite - Individual Road Race | CN | PA | 2026-04-23 | elite | female | rr |
| CN | 78385 | 265019 | National Road Championships - Panamá — Men Under 23 - Individual Road Race | CN | PA | 2026-04-23 | u23 | male | rr |
| CN | 78385 | 260421 | National Road Championships - Panamá — Men Under 23 - Individual Time Trial | CN | PA | 2026-04-23 | u23 | male | itt |
| CN | 78385 | 260422 | National Road Championships - Panamá — Women Elite - Individual Time Trial | CN | PA | 2026-04-23 | elite | female | itt |
| CN | 78915 | 264352 | National Road Championships - Panamá (ME) — Men Elite - Individual Road Race | CN | PA | 2026-04-23 | elite | male | rr |
| CN | 78915 | 264351 | National Road Championships - Panamá (ME) — Men Elite - Individual Time Trial | CN | PA | 2026-04-23 | elite | male | itt |
| CN | 78911 | 264237 | National Road Championships - Cyprus ITT MU/WU — Men Under 23 - Individual Time Trial | CN | CY | 2026-04-18 | u23 | male | itt |
| CN | 78911 | 264238 | National Road Championships - Cyprus ITT MU/WU — Women Under 23 - Individual Time Trial | CN | CY | 2026-04-18 | u23 | female | itt |
| CN | 78089 | 258408 | National Road Championships - Kazakhstan (MU/WU IRR) — Men Under 23 - Individual Road Race | CN | KZ | 2026-04-11 | u23 | male | rr |
| CN | 78089 | 258409 | National Road Championships - Kazakhstan (MU/WU IRR) — Women Under 23 - Individual Road Race | CN | KZ | 2026-04-11 | u23 | female | rr |
| CN | 77901 | 255653 | National Road Championships - Egypt — Men Elite - Individual Road Race | CN | EG | 2026-04-09 | elite | male | rr |
| CN | 77901 | 255651 | National Road Championships - Egypt — Men Elite - Individual Time Trial | CN | EG | 2026-04-09 | elite | male | itt |
| CN | 77901 | 255652 | National Road Championships - Egypt — Men Under 23 - Individual Time Trial | CN | EG | 2026-04-09 | u23 | male | itt |
| CN | 77901 | 255646 | National Road Championships - Egypt — Women Elite - Individual Road Race | CN | EG | 2026-04-09 | elite | female | rr |
| CN | 77901 | 255643 | National Road Championships - Egypt — Women Elite - Individual Time Trial | CN | EG | 2026-04-09 | elite | female | itt |
| CN | 77901 | 255645 | National Road Championships - Egypt — Women Under 23 - Individual Time Trial | CN | EG | 2026-04-09 | u23 | female | itt |
| CN | 77900 | 255641 | National Road Championships - United Arab Emirates — Men Elite - Individual Road Race | CN | AE | 2026-04-03 | elite | male | rr |
| CN | 77900 | 255642 | National Road Championships - United Arab Emirates — Men Under 23 - Individual Road Race | CN | AE | 2026-04-03 | u23 | male | rr |
| CN | 77900 | 255638 | National Road Championships - United Arab Emirates — Women Elite - Individual Road Race | CN | AE | 2026-04-03 | elite | female | rr |
| CN | 77900 | 255640 | National Road Championships - United Arab Emirates — Women Under 23 - Individual Road Race | CN | AE | 2026-04-03 | u23 | female | rr |
| CN | 77900 | 255635 | National Road Championships - United Arab Emirates — Men Elite - Individual Time Trial | CN | AE | 2026-04-03 | elite | male | itt |
| CN | 77900 | 255636 | National Road Championships - United Arab Emirates — Men Under 23 - Individual Time Trial | CN | AE | 2026-04-03 | u23 | male | itt |
| CN | 77900 | 255632 | National Road Championships - United Arab Emirates — Women Elite - Individual Time Trial | CN | AE | 2026-04-03 | elite | female | itt |
| CN | 77900 | 255634 | National Road Championships - United Arab Emirates — Women Under 23 - Individual Time Trial | CN | AE | 2026-04-03 | u23 | female | itt |
| CN | 78711 | 262938 | National Road Championships - Bolivia — Men Elite - Individual Road Race | CN | BO | 2026-02-26 | elite | male | rr |
| CN | 78711 | 262931 | National Road Championships - Bolivia — Women Elite - Individual Road Race | CN | BO | 2026-02-26 | elite | female | rr |
| CN | 78711 | 262933 | National Road Championships - Bolivia — Men Elite - Individual Time Trial | CN | BO | 2026-02-26 | elite | male | itt |
| CN | 78711 | 262935 | National Road Championships - Bolivia — Men Under 23 - Individual Time Trial | CN | BO | 2026-02-26 | u23 | male | itt |
| CN | 78711 | 262936 | National Road Championships - Bolivia — Women Elite - Individual Time Trial | CN | BO | 2026-02-26 | elite | female | itt |
| CN | 77996 | 256205 | National Road Championships - Philippines — Women Elite - Individual Road Race | CN | PH | 2026-02-22 | elite | female | rr |
| CN | 77996 | 256208 | National Road Championships - Philippines — Men Elite - Individual Road Race | CN | PH | 2026-02-22 | elite | male | rr |
| CN | 77996 | 256206 | National Road Championships - Philippines — Men Under 23 - Individual Road Race | CN | PH | 2026-02-22 | u23 | male | rr |
| CN | 77996 | 256207 | National Road Championships - Philippines — Women Under 23 - Individual Road Race | CN | PH | 2026-02-22 | u23 | female | rr |
| CN | 77996 | 256198 | National Road Championships - Philippines — Men Elite - Individual Time Trial | CN | PH | 2026-02-22 | elite | male | itt |
| CN | 77996 | 256200 | National Road Championships - Philippines — Men Under 23 - Individual Time Trial | CN | PH | 2026-02-22 | u23 | male | itt |
| CN | 77996 | 256201 | National Road Championships - Philippines — Women Elite - Individual Time Trial | CN | PH | 2026-02-22 | elite | female | itt |
| CN | 77996 | 256203 | National Road Championships - Philippines — Women Under 23 - Individual Time Trial | CN | PH | 2026-02-22 | u23 | female | itt |
| CN | 77899 | 255625 | National Road Championships - Namibia — Men Elite - Individual Road Race | CN | NA | 2026-02-05 | elite | male | rr |
| CN | 77899 | 255628 | National Road Championships - Namibia — Women Elite - Individual Road Race | CN | NA | 2026-02-05 | elite | female | rr |
| CN | 77899 | 255619 | National Road Championships - Namibia — Men Elite - Individual Time Trial | CN | NA | 2026-02-05 | elite | male | itt |
| CN | 77899 | 255621 | National Road Championships - Namibia — Men Under 23 - Individual Time Trial | CN | NA | 2026-02-05 | u23 | male | itt |
| CN | 77899 | 255622 | National Road Championships - Namibia — Women Elite - Individual Time Trial | CN | NA | 2026-02-05 | elite | female | itt |
| CN | 77899 | 255624 | National Road Championships - Namibia — Women Under 23 - Individual Time Trial | CN | NA | 2026-02-05 | u23 | female | itt |
| CN | 77897 | 255603 | National Road Championships - Zimbabwe — Men Elite - Individual Road Race | CN | ZW | 2026-02-04 | elite | male | rr |
| CN | 77897 | 255605 | National Road Championships - Zimbabwe — Women Elite - Individual Road Race | CN | ZW | 2026-02-04 | elite | female | rr |
| CN | 77897 | 255598 | National Road Championships - Zimbabwe — Men Elite - Individual Time Trial | CN | ZW | 2026-02-04 | elite | male | itt |
| CN | 77897 | 255600 | National Road Championships - Zimbabwe — Men Under 23 - Individual Time Trial | CN | ZW | 2026-02-04 | u23 | male | itt |
| CN | 77897 | 255601 | National Road Championships - Zimbabwe — Women Elite - Individual Time Trial | CN | ZW | 2026-02-04 | elite | female | itt |
| CN | 77895 | 255583 | National Road Championships - Thailand — Women Elite - Individual Road Race | CN | TH | 2026-01-15 | elite | female | rr |
| CN | 77895 | 260643 | National Road Championships - Thailand — Men Under 23 - Individual Road Race | CN | TH | 2026-01-15 | u23 | male | rr |
| CN | 77895 | 260644 | National Road Championships - Thailand — Women Under 23 - Individual Road Race | CN | TH | 2026-01-15 | u23 | female | rr |
| CN | 77895 | 255576 | National Road Championships - Thailand — Men Under 23 - Individual Time Trial | CN | TH | 2026-01-15 | u23 | male | itt |
| CN | 77895 | 255577 | National Road Championships - Thailand — Women Elite - Individual Time Trial | CN | TH | 2026-01-15 | elite | female | itt |
| CN | 77895 | 255579 | National Road Championships - Thailand — Women Under 23 - Individual Time Trial | CN | TH | 2026-01-15 | u23 | female | itt |
| CN | 78196 | 258996 | National Road Championships - Thailand (ME) — Men Elite - Individual Time Trial | CN | TH | 2026-01-15 | elite | male | itt |
| CN | 78196 | 258995 | National Road Championships - Thailand (ME) — Men Elite - Individual Road Race | CN | TH | 2026-01-15 | elite | male | rr |
<!-- MISSING-ROWS-END -->

## Carreras existentes sin enlace UCI — 194

Estas filas ya tienen una carrera en `races`; la acción propuesta es resolver el
enlace a `race_uci_links` y no crear otra carrera. El `bestRaceId` es únicamente la
contraparte encontrada en la base durante esta auditoría.

| Ámbito | competitionId | uciRaceId | Nombre DataRide | Clase | País | Inicio UCI | bestRaceId | Carrera existente |
|:---|---:|---:|:---|:---:|:---:|:---:|:---|:---|
| direct | 77793 | — | Kreiz Breizh Elites Féminin | 1.1 | FR | 2026-08-26 | Dj73W2yn1T24QuIt5r2m | Kreiz Breizh Elites Féminin |
| direct | 78496 | — | Gran Prix Chitre | 1.2 | PA | 2026-08-26 | Tme0dkaIPUhOHog6nX37 | Gran Prix Chitré |
| direct | 77791 | — | TPC en Nouvelle-Aquitaine | 2.1 | FR | 2026-08-24 | VSOh7DMbwR8jIh85IpvH | TPC en Nouvelle-Aquitaine (Poitou-Charentes) |
| direct | 77788 | — | Baltic Chain Tour | 2.2 | EE | 2026-08-20 | WiGrn1y70EH7spikAOGW | Baltic Chain Tour |
| direct | 77789 | — | Konvert Kortrijk Koerse | 1.1 | BE | 2026-08-20 | wyPulMAO9ifb8EIobUsV | Konvert Kortrijk Koerse |
| direct | 77517 | — | West Bohemia Tour | 2.2U | CZ | 2026-08-19 | 1GVuEn8Rq4IBZhpAxUno | West Bohemia Tour |
| direct | 76404 | — | Renewi Tour | 2.UWT | BE | 2026-08-18 | njqLb1bcUyokB5zOsUFV | Tour del Benelux (Renewi Tour) |
| direct | 76405 | — | Lloyds Tour of Britain Women | 2.WWT | GB | 2026-08-18 | TJwHJ9T2z6aEDsDN5vvM | Vuelta a Gran Bretaña femenina |
| direct | 77786 | — | Egmont Cycling Race Women | 1.1 | BE | 2026-08-17 | hI5WjSSBjnFPfOdoUcEV | Egmont Race Women |
| direct | 77515 | — | GP Capodarco Comunita Di Capodarco | 1.2U | IT | 2026-08-15 | nfEYyPO7cteHdqZsM1dG | GP Capodarco |
| direct | 77785 | — | La Polynormande | 1.1 | FR | 2026-08-15 | k9QjU6qsXeHZtVLdVjDw | La Polynormande |
| direct | 79120 | — | Volta a Portugal em Bicicleta | 2.1 | PT | 2026-08-04 | GJoxqpe19GTODSeoe99b | Volta a Portugal |
| direct | 76402 | — | Tour de Pologne | 2.UWT | PL | 2026-08-02 | ExYueXRJjvjcXcATkSzk | Vuelta a Polonia |
| direct | 77772 | — | Circuito de Getxo - Memorial Hermanos Otxoa | 1.1 | ES | 2026-08-01 | AVwohNdpT16NhT4KrFj6 | Circuito de Getxo |
| direct | 76400 | — | DSSK (Donostia San Sebastian Klasikoa) | 1.UWT | ES | 2026-07-31 | 5ScHDdIZYVS3VoJBneoJ | Clásica de San Sebastián |
| direct | 76401 | — | Tour de France Femmes avec Zwift | 2.WWT | FR | 2026-07-31 | Ek8WMTm5tnhm6mP0KQd5 | Tour de Francia femenino |
| direct | 77771 | — | Kreiz Breizh Elites | 2.2 | FR | 2026-07-30 | tvXsn05qNn1Waz7V9pEi | Kreiz Breizh |
| direct | 77768 | — | Tour de l'Ain | 2.1 | FR | 2026-07-27 | qpicxChPFHstBQTd4g7J | Tour de l'Ain |
| direct | 77765 | — | Clasica Castilla y Leon | 1.1 | ES | 2026-07-25 | 8jy2LvXLNgTknIVtJEWY | Clásica Castilla y León |
| direct | 77766 | — | Puchar MON | 1.2 | PL | 2026-07-25 | rZ9phbWDLPPVSHOBBNm3 | Copa del Ministro de Defensa Nacional (Puchar MON) |
| direct | 77762 | — | Dookoła Mazowsza | 2.2 | PL | 2026-07-21 | BZtVX5rhaxW4gtnv9coY | Vuelta a Mazovia |
| direct | 77759 | — | La Picto en Nouvelle-Aquitaine | 1.1 | FR | 2026-07-18 | fFHZgqUY5dSEerzTpRa6 | La Picto en Nouvelle-Aquitaine |
| direct | 77758 | — | La Périgord Ladies | 1.1 | FR | 2026-07-17 | LLacEqTGenn5AxN7KQfR | La Périgord Ladies |
| direct | 77513 | — | Giro Ciclistico della Valle d'Aosta - Mont Blanc | 2.2U | IT | 2026-07-15 | O0bkfpB8NwIGL5LgvtUP | Giro della Valle d'Aosta |
| direct | 77753 | — | Visegrad 4 Kerekparverseny | 1.2 | HU | 2026-07-10 | 592cMVCDd1DU3jcWJLNo | Visegrad 4 Race - Kerekparverseny |
| direct | 77754 | — | Dwars door Wingene | 1.2 | BE | 2026-07-10 | F15IAHY9uwZx47vvIrCU | Dwars door Wingene |
| direct | 77752 | — | GP Internacional Torres Vedras - Trofeu Joaquim Agostinho | 2.2 | PT | 2026-07-09 | 4F8OIuGR7z9zJa86hbto | GP Torres Vedras - Trofeu Joaquim Agostinho |
| direct | 77751 | — | Tour of Austria | 2.1 | AT | 2026-07-07 | IkST1piTSTWv5kgeNNBl | Vuelta a Austria |
| direct | 77747 | — | Argenta Classic - Deurne | 1.1 | BE | 2026-07-04 | XXREjBydVZ00t5V5FYP7 | Argenta Classic - Deurne |
| direct | 77748 | — | Giro del Medio Brenta | 1.2 | IT | 2026-07-04 | b73pswPKBlL1qAwPF3Yt | Giro del Medio Brenta |
| direct | 77749 | — | Midden-Brabant Poort Omloop | 1.2 | NL | 2026-07-04 | yLryYtuioff65Cmx181l | Midden-Brabant Poort Omloop |
| direct | 76399 | — | Tour de France | 2.UWT | FR | 2026-07-03 | u5p2npjYLwduznQbDY4e | Tour de Francia |
| direct | 77746 | — | Sibiu Cycling Tour | 2.1 | RO | 2026-07-03 | W989yUqImXadtXZE2jIz | Sibiu Tour |
| direct | 77742 | — | Andorra MoraBanc Clàssica | 1.1 | AD | 2026-06-20 | X1GFZpSA27XvqPgxgqEh | Andorra Morabanc Clàssica |
| direct | 77738 | — | Elmos Dwars door het Hageland | 1.2 | BE | 2026-06-19 | kRRClsEOAXjGigmhHvFn | Dwars door het Hageland |
| direct | 77741 | — | Volta Ciclista a Catalunya Femenina | 2.1 | ES | 2026-06-18 | LCKSRcizS7sGIvbjqLap | Volta a Catalunya femenina |
| direct | 77683 | — | La Route d'Occitanie - CIC | 2.1 | FR | 2026-06-17 | RYfbJykI6YZBBJ7m7sME | Ruta de Occitania |
| direct | 76395 | — | Tour de Suisse Women | 2.WWT | CH | 2026-06-16 | cd6nQmCLONmZdCaygUS2 | Vuelta a Suiza femenina |
| direct | 76396 | — | Tour de Suisse | 2.UWT | CH | 2026-06-16 | 7ZlSZynd92zm5ScyptJ9 | Vuelta a Suiza |
| direct | 76398 | — | Copenhagen Sprint | 1.UWT | DK | 2026-06-13 | cMlovIn93rdUWRvfptZN | Copenhagen Sprint |
| direct | 77512 | — | Giro d'Italia Next Gen | 2.2U | IT | 2026-06-13 | WceHUBiLcq06ZS03tRGn | Giro Next Gen |
| direct | 77680 | — | GP Gippingen | 1.1 | CH | 2026-06-13 | XrUexbdD3PPpOSvgxX8y | GP Gippingen |
| direct | 77792 | — | Muur Classic Geraardsbergen | 1.1 | BE | 2026-06-13 | IHf7H1vVT7vFUpY2qyG2 | Muur Classic Geraardsbergen |
| direct | 76397 | — | Copenhagen Sprint | 1.WWT | DK | 2026-06-12 | DnhlcUCroLfRLjUEvKuo | Copenhagen Sprint femenino |
| direct | 77730 | — | Veenendaal - Veenendaal | 1.1 | NL | 2026-05-21 | 9WSDdpSPoKI4gw0I45Ha | Veenendaal-Veenendaal |
| direct | 77723 | — | La Classique Morbihan | 1.1 | FR | 2026-05-07 | fNZ1y5R9Qo4cNI2ZxnBn | La Classique Morbihan |
| direct | 77603 | — | EPZ Omloop van Borsele | 1.1 | NL | 2026-04-25 | j2REhQvcK4cHM0dZE64d | EPZ Omloop van Borsele |
| direct | 77470 | — | FENIX-EKOÏ Omloop van het Hageland | 1.1 | BE | 2026-02-28 | i6DfK8mn2Baddpx2Yjnt | Omloop van het Hageland |
| CN | 79210 | 266151 | National Road Championships - Austria (MU/WU) — Women Under 23 - Individual Road Race | CN | AT | 2026-07-03 | 5ba001cf-972e-406c-818c-61aaf7f1dd41 | Campeonato de Austria línea sub23 femenino |
| CN | 79211 | 266153 | National Road Championships - Germany (MU/WU) — Women Under 23 - Individual Road Race | CN | DE | 2026-07-03 | 47947a12-4a26-4a7e-bd84-5beee2deaa55 | Campeonato de Alemania línea sub23 femenino |
| CN | 79212 | 266155 | National Road Championships - Luxembourg (MU/WU) — Women Under 23 - Individual Road Race | CN | LU | 2026-07-03 | 9389eed3-149d-49ae-8901-6b40cdec3d37 | Campeonato de Luxemburgo línea sub23 femenino |
| CN | 79213 | 266157 | National Road Championships - Switzerland (MU/WU) — Women Under 23 - Individual Road Race | CN | CH | 2026-07-03 | 7ebc2a19-b8c1-452e-9bd8-7a6a0a0aa13a | Campeonato de Suiza línea sub23 femenino |
| CN | 77948 | 256047 | National Road Championships - Mauritius — Men Elite - Individual Road Race | CN | MU | 2026-06-26 | edd3cb4e-6162-5364-848d-4f51a301c8a0 | Campeonato de Mauricio línea masculino |
| CN | 77948 | 256050 | National Road Championships - Mauritius — Women Elite - Individual Road Race | CN | MU | 2026-06-26 | f04cf55f-d2e6-5e54-8660-031008afa74a | Campeonato de Mauricio línea femenino |
| CN | 77948 | 256041 | National Road Championships - Mauritius — Men Elite - Individual Time Trial | CN | MU | 2026-06-26 | 968d52b2-d0a8-5502-80c3-0fe83a7ca223 | Campeonato de Mauricio CRI masculino |
| CN | 77948 | 256044 | National Road Championships - Mauritius — Women Elite - Individual Time Trial | CN | MU | 2026-06-26 | 3ec8b7a8-cf10-5d5a-87a8-764e2212ddc7 | Campeonato de Mauricio CRI femenino |
| CN | 78329 | 260056 | National Road Championships - Sweden — Men Elite - Individual Time Trial | CN | SE | 2026-06-26 | 6587728a-e121-400b-a0a5-c5a13af2ded8 | Campeonato de Suecia CRI masculino |
| CN | 78917 | 264354 | National Road Championships - Japan IRR (ME) — Men Elite - Individual Road Race | CN | JP | 2026-06-26 | c5a9b3df-e128-4614-a4b4-d711f78a839c | Campeonato de Japón línea masculino |
| CN | 79018 | 264934 | National Road Championships - Austria — Men Elite - Individual Road Race | CN | AT | 2026-06-26 | 5001e3ff-ca30-47e6-adca-d8e61036d44d | Campeonato de Austria línea masculino |
| CN | 79018 | 264938 | National Road Championships - Austria — Men Elite - Individual Time Trial | CN | AT | 2026-06-26 | 2fd6f3d5-3df1-4b18-9339-c1b0d18724e0 | Campeonato de Austria CRI masculino |
| CN | 79208 | 266139 | National Road Championships - Austria — Women Elite - Individual Road Race | CN | AT | 2026-06-26 | f13352f6-4f16-42a7-8578-ee3ac5ecaf82 | Campeonato de Austria línea femenino |
| CN | 79208 | 266140 | National Road Championships - Austria — Women Elite - Individual Time Trial | CN | AT | 2026-06-26 | 4c96e36b-b976-457a-b332-cbb8d18d9b18 | Campeonato de Austria CRI femenino |
| CN | 79249 | 266531 | National Road Championships - Sweden (WE) — Women Elite - Individual Time Trial | CN | SE | 2026-06-26 | 0da10e66-0ffb-4477-8fd8-16aa81242de2 | Campeonato de Suecia CRI femenino |
| CN | 77881 | 255495 | National Road Championships - Portugal — Women Elite - Individual Road Race | CN | PT | 2026-06-25 | 478d26e2-4836-4e25-b7b8-1981c3ad98d2 | Campeonato de Portugal línea femenino |
| CN | 77881 | 266674 | National Road Championships - Portugal — Men Under 23 - Individual Road Race | CN | PT | 2026-06-25 | 3b34b032-1c0e-4b6c-b849-059b63e10f8a | Campeonato de Portugal línea sub23 masculino |
| CN | 77881 | 255492 | National Road Championships - Portugal — Men Under 23 - Individual Time Trial | CN | PT | 2026-06-25 | b0b57dba-4cfb-41ea-a994-e7b199a4ead3 | Campeonato de Portugal CRI sub23 masculino |
| CN | 77881 | 255493 | National Road Championships - Portugal — Women Elite - Individual Time Trial | CN | PT | 2026-06-25 | 4fe041f9-f1ca-4577-bd24-f1b76199e465 | Campeonato de Portugal CRI femenino |
| CN | 77882 | 255500 | National Road Championships - Belgium — Men Elite - Individual Road Race | CN | BE | 2026-06-25 | ba1a2b40-6b0a-49f8-9ae0-076d2f7fa9f0 | Campeonato de Bélgica línea masculino |
| CN | 77882 | 255501 | National Road Championships - Belgium — Women Elite - Individual Road Race | CN | BE | 2026-06-25 | 6fcb3a0c-ca3c-4ecb-a71b-3592e9356844 | Campeonato de Bélgica línea femenino |
| CN | 77882 | 255498 | National Road Championships - Belgium — Men Elite - Individual Time Trial | CN | BE | 2026-06-25 | 0ddf05da-d30b-4c8c-bc03-6cffe6e0a802 | Campeonato de Bélgica CRI masculino |
| CN | 77882 | 255499 | National Road Championships - Belgium — Women Elite - Individual Time Trial | CN | BE | 2026-06-25 | 9bf6c42b-2b8b-4a49-835b-a736d4697c21 | Campeonato de Bélgica CRI femenino |
| CN | 77932 | 255942 | National Road Championships - Denmark — Men Elite - Individual Road Race | CN | DK | 2026-06-25 | ae40ebec-d3e8-49e8-9377-5c5f0e893dd2 | Campeonato de Dinamarca línea masculino |
| CN | 77932 | 255945 | National Road Championships - Denmark — Women Elite - Individual Road Race | CN | DK | 2026-06-25 | e8bfb0ba-034c-4bd6-84d3-3d5aeb76621c | Campeonato de Dinamarca línea femenino |
| CN | 77932 | 255936 | National Road Championships - Denmark — Men Elite - Individual Time Trial | CN | DK | 2026-06-25 | bc4926e5-c177-4bc5-9f1e-259036a09d78 | Campeonato de Dinamarca CRI masculino |
| CN | 77932 | 255939 | National Road Championships - Denmark — Women Elite - Individual Time Trial | CN | DK | 2026-06-25 | 5dbb9419-9647-4dfd-96fd-a5b9fc237a62 | Campeonato de Dinamarca CRI femenino |
| CN | 77934 | 255962 | National Road Championships - Slovenia — Men Elite - Individual Road Race | CN | SI | 2026-06-25 | 7ab151a4-1c51-4b49-9868-831f1e8d5702 | Campeonato de Eslovenia línea masculino |
| CN | 77934 | 255965 | National Road Championships - Slovenia — Women Elite - Individual Road Race | CN | SI | 2026-06-25 | 30a343b0-e7b1-4e02-8408-ec3b7b7ad92c | Campeonato de Eslovenia línea femenino |
| CN | 77934 | 255958 | National Road Championships - Slovenia — Men Under 23 - Individual Time Trial | CN | SI | 2026-06-25 | 8b502f13-a802-46cb-8f86-107e96c73fa7 | Campeonato de Eslovenia CRI sub23 masculino |
| CN | 77934 | 255959 | National Road Championships - Slovenia — Women Elite - Individual Time Trial | CN | SI | 2026-06-25 | 9fa9be6a-0393-461c-bc55-40d16ac047e7 | Campeonato de Eslovenia CRI femenino |
| CN | 77936 | 255986 | National Road Championships - Canada — Men Elite - Individual Road Race | CN | CA | 2026-06-25 | 3fd4da7a-27af-48af-962d-e228cdc71259 | Campeonato de Canadá línea masculino |
| CN | 77936 | 255980 | National Road Championships - Canada — Men Elite - Individual Time Trial | CN | CA | 2026-06-25 | b77e05ec-2ead-43e7-aeed-12091d8fbff5 | Campeonato de Canadá CRI masculino |
| CN | 77936 | 255983 | National Road Championships - Canada — Women Elite - Individual Time Trial | CN | CA | 2026-06-25 | cf37fc77-1d08-41a8-bda3-4fbda54add71 | Campeonato de Canadá CRI femenino |
| CN | 77937 | 255997 | National Road Championships - Turkiye — Women Elite - Individual Road Race | CN | TR | 2026-06-25 | 555e8365-d41e-440a-85ff-a103a78902d0 | Campeonato de Turquía línea femenino |
| CN | 77937 | 266201 | National Road Championships - Turkiye — Men Under 23 - Individual Road Race | CN | TR | 2026-06-25 | 52e0526a-a7ec-411e-981f-934f6f96fe13 | Campeonato de Turquía línea sub23 masculino |
| CN | 78933 | 264392 | National Road Championships - Portugal (ME) — Men Elite - Individual Road Race | CN | PT | 2026-06-25 | 762a8cc7-d0e0-4ac9-adc0-9e7e360afe3d | Campeonato de Portugal línea masculino |
| CN | 78933 | 264391 | National Road Championships - Portugal (ME) — Men Elite - Individual Time Trial | CN | PT | 2026-06-25 | 823ff175-a33e-4bb8-86e0-c6b5cbf3c735 | Campeonato de Portugal CRI masculino |
| CN | 78935 | 264396 | National Road Championships - Turkiye (ME) — Men Elite - Individual Road Race | CN | TR | 2026-06-25 | d6a59112-e915-41e3-b75d-20026133e1d1 | Campeonato de Turquía línea masculino |
| CN | 79117 | 265869 | National Road Championships - Germany — Men Elite - Individual Time Trial | CN | DE | 2026-06-25 | 68992158-4742-454e-8092-ebbd4f7f913c | Campeonato de Alemania CRI masculino |
| CN | 79117 | 265870 | National Road Championships - Germany — Men Under 23 - Individual Time Trial | CN | DE | 2026-06-25 | 8786a809-1831-4f5a-b2d0-e19ff145d0ed | Campeonato de Alemania CRI sub23 masculino |
| CN | 79117 | 265871 | National Road Championships - Germany — Women Elite - Individual Time Trial | CN | DE | 2026-06-25 | b882af9b-432e-47d4-9082-444d0b4a188e | Campeonato de Alemania CRI femenino |
| CN | 79117 | 265872 | National Road Championships - Germany — Women Under 23 - Individual Time Trial | CN | DE | 2026-06-25 | ce2b91b5-bb87-4ed6-97df-501b715760a1 | Campeonato de Alemania CRI sub23 femenino |
| CN | 79117 | 265865 | National Road Championships - Germany — Men Elite - Individual Road Race | CN | DE | 2026-06-25 | fc92517f-6904-4733-bdb6-2548dace9c48 | Campeonato de Alemania línea masculino |
| CN | 79117 | 265867 | National Road Championships - Germany — Women Elite - Individual Road Race | CN | DE | 2026-06-25 | 9bc41c0a-135f-486c-a390-122032731ba6 | Campeonato de Alemania línea femenino |
| CN | 77890 | 255536 | National Road Championships - France — Men Elite - Individual Road Race | CN | FR | 2026-06-24 | 1dcf3118-8130-4584-a017-b0311260177e | Campeonato de Francia línea masculino |
| CN | 77890 | 255537 | National Road Championships - France — Women Elite - Individual Road Race | CN | FR | 2026-06-24 | 876e4766-4570-4665-bce9-912e4c5fb0c8 | Campeonato de Francia línea femenino |
| CN | 77890 | 255534 | National Road Championships - France — Men Elite - Individual Time Trial | CN | FR | 2026-06-24 | db4e3835-6ccb-4e8f-b441-917fb69009c1 | Campeonato de Francia CRI masculino |
| CN | 77890 | 255535 | National Road Championships - France — Women Elite - Individual Time Trial | CN | FR | 2026-06-24 | 19862ac8-c488-47c0-b673-7fea8bde87c3 | Campeonato de Francia CRI femenino |
| CN | 77921 | 255847 | National Road Championships - Spain — Men Elite - Individual Road Race | CN | ES | 2026-06-24 | 93590099-ce05-478b-b623-c8fc60320d2a | Campeonato de España línea masculino |
| CN | 77921 | 255843 | National Road Championships - Spain — Men Under 23 - Individual Road Race | CN | ES | 2026-06-24 | 16cceff0-4caf-42a2-a7c8-b367a5c414bc | Campeonato de España línea sub23 masculino |
| CN | 77921 | 255845 | National Road Championships - Spain — Women Elite - Individual Road Race | CN | ES | 2026-06-24 | 81284bc8-c457-40f9-9838-94e272527e0e | Campeonato de España línea femenino |
| CN | 77921 | 255840 | National Road Championships - Spain — Men Under 23 - Individual Time Trial | CN | ES | 2026-06-24 | 2c705f0d-f0a1-43a9-bccd-0f72b8193e2e | Campeonato de España CRI sub23 masculino |
| CN | 77921 | 255844 | National Road Championships - Spain — Men Elite - Individual Time Trial | CN | ES | 2026-06-24 | aa312fd2-e135-415b-b742-7721d0f75e0a | Campeonato de España CRI masculino |
| CN | 77924 | 255870 | National Road Championships - Ireland — Women Elite - Individual Road Race | CN | IE | 2026-06-24 | b8945b87-c068-4214-83f7-253bb1330439 | Campeonato de Irlanda línea femenino |
| CN | 77924 | 255866 | National Road Championships - Ireland — Men Under 23 - Individual Time Trial | CN | IE | 2026-06-24 | 4a1191e7-fcb2-4435-b42a-63fd0e707520 | Campeonato de Irlanda CRI sub23 masculino |
| CN | 77924 | 255867 | National Road Championships - Ireland — Women Elite - Individual Time Trial | CN | IE | 2026-06-24 | e30ae84e-dcc4-42e2-9df1-c5a8605fe41e | Campeonato de Irlanda CRI femenino |
| CN | 77925 | 255879 | National Road Championships - Czechia — Women Elite - Individual Road Race | CN | CZ | 2026-06-24 | 00ee34f7-ad62-4688-bcd4-052171b6d45a | Campeonato de Chequia línea femenino |
| CN | 77925 | 255875 | National Road Championships - Czechia — Men Under 23 - Individual Time Trial | CN | CZ | 2026-06-24 | 541bc66f-8a8e-4de9-affc-4b1dfe292500 | Campeonato de Chequia CRI sub23 masculino |
| CN | 77925 | 255876 | National Road Championships - Czechia — Women Elite - Individual Time Trial | CN | CZ | 2026-06-24 | 1c750758-6b84-4492-b065-924ad8f81641 | Campeonato de Chequia CRI femenino |
| CN | 77926 | 255887 | National Road Championships - Slovakia — Women Elite - Individual Road Race | CN | SK | 2026-06-24 | 596348a1-3244-41e1-9ac2-0d0be4aa1fe7 | Campeonato de Eslovaquia línea femenino |
| CN | 77926 | 255884 | National Road Championships - Slovakia — Women Elite - Individual Time Trial | CN | SK | 2026-06-24 | cc962bf3-5444-40ba-af2a-02da4a3c7b0d | Campeonato de Eslovaquia CRI femenino |
| CN | 77927 | 255896 | Championnats Nationaux Route - Luxembourg — Men Elite - Individual Road Race | CN | LU | 2026-06-24 | 064f5550-93b8-489f-ab79-e16830982917 | Campeonato de Luxemburgo línea masculino |
| CN | 77927 | 255898 | Championnats Nationaux Route - Luxembourg — Women Elite - Individual Road Race | CN | LU | 2026-06-24 | 0009a7d8-ac10-4b44-be35-0b6a13a16ffb | Campeonato de Luxemburgo línea femenino |
| CN | 77927 | 255890 | Championnats Nationaux Route - Luxembourg — Men Elite - Individual Time Trial | CN | LU | 2026-06-24 | dec30987-b0e7-4f00-a79e-3116b6568883 | Campeonato de Luxemburgo CRI masculino |
| CN | 77927 | 255892 | Championnats Nationaux Route - Luxembourg — Men Under 23 - Individual Time Trial | CN | LU | 2026-06-24 | 4a6f9208-e7af-4678-86f2-fcb38160302c | Campeonato de Luxemburgo CRI sub23 masculino |
| CN | 77927 | 255893 | Championnats Nationaux Route - Luxembourg — Women Elite - Individual Time Trial | CN | LU | 2026-06-24 | 138650ab-a1d5-4fad-96c8-cb08f6af9941 | Campeonato de Luxemburgo CRI femenino |
| CN | 77927 | 255895 | Championnats Nationaux Route - Luxembourg — Women Under 23 - Individual Time Trial | CN | LU | 2026-06-24 | 3635e459-e318-47e9-b8b9-7b072853fa22 | Campeonato de Luxemburgo CRI sub23 femenino |
| CN | 77930 | 255927 | National Road Championships - Great Britain — Women Elite - Individual Road Race | CN | GB | 2026-06-24 | 968d5643-cf38-47f6-a070-2c94703a03e9 | Campeonato de Gran Bretaña línea femenino |
| CN | 77930 | 255923 | National Road Championships - Great Britain — Men Under 23 - Individual Time Trial | CN | GB | 2026-06-24 | b8df1988-660e-409d-9e4c-d0988edefdcf | Campeonato de Gran Bretaña CRI sub23 masculino |
| CN | 77930 | 255924 | National Road Championships - Great Britain — Women Elite - Individual Time Trial | CN | GB | 2026-06-24 | 9d834f0a-c729-46e6-8cb1-c3031fd3ff6c | Campeonato de Gran Bretaña CRI femenino |
| CN | 77930 | 255925 | National Road Championships - Great Britain — Women Under 23 - Individual Time Trial | CN | GB | 2026-06-24 | bb371fd5-1573-4424-aa36-f70e925ec8e5 | Campeonato de Gran Bretaña CRI sub23 femenino |
| CN | 78081 | 258358 | National Road Championships - Switzerland — Men Elite - Individual Road Race | CN | CH | 2026-06-24 | b9ea47ff-e333-4ea1-afde-7eed620bc5bf | Campeonato de Suiza línea masculino |
| CN | 78081 | 258356 | National Road Championships - Switzerland — Women Elite - Individual Road Race | CN | CH | 2026-06-24 | c145a652-0391-45f6-95ce-f0115bce413a | Campeonato de Suiza línea femenino |
| CN | 78081 | 258350 | National Road Championships - Switzerland — Men Elite - Individual Time Trial | CN | CH | 2026-06-24 | 1d5e3e45-768a-43da-ba4d-703f7d017769 | Campeonato de Suiza CRI masculino |
| CN | 78081 | 258352 | National Road Championships - Switzerland — Men Under 23 - Individual Time Trial | CN | CH | 2026-06-24 | 0a3442bb-4221-44fe-ab97-1ff65d39daaa | Campeonato de Suiza CRI sub23 masculino |
| CN | 78081 | 258353 | National Road Championships - Switzerland — Women Elite - Individual Time Trial | CN | CH | 2026-06-24 | b5c79f80-f6a8-46f8-930f-aba9fec167aa | Campeonato de Suiza CRI femenino |
| CN | 78081 | 258355 | National Road Championships - Switzerland — Women Under 23 - Individual Time Trial | CN | CH | 2026-06-24 | cc3a0194-020e-4903-a244-9fe4036bb62b | Campeonato de Suiza CRI sub23 femenino |
| CN | 78809 | 263580 | National Road Championships - Norway — Men Elite - Individual Road Race | CN | NO | 2026-06-24 | 5e92aab5-8649-42b4-b37e-7caa0634f4aa | Campeonato de Noruega línea masculino |
| CN | 78809 | 263582 | National Road Championships - Norway — Women Elite - Individual Road Race | CN | NO | 2026-06-24 | b7b1a2f8-205b-42dd-9ed3-e0b3eb65e482 | Campeonato de Noruega línea femenino |
| CN | 78809 | 263584 | National Road Championships - Norway — Men Elite - Individual Time Trial | CN | NO | 2026-06-24 | a99ac755-0b7f-403c-8d87-842981cb8c1a | Campeonato de Noruega CRI masculino |
| CN | 78809 | 263586 | National Road Championships - Norway — Women Elite - Individual Time Trial | CN | NO | 2026-06-24 | 493ae347-4311-41d9-bd07-979c41b50a51 | Campeonato de Noruega CRI femenino |
| CN | 78928 | 264381 | National Road Championships - Czechia (ME) — Men Elite - Individual Road Race | CN | CZ | 2026-06-24 | 49595c18-6395-4912-929e-1e931b3e2754 | Campeonato de Chequia línea masculino |
| CN | 78928 | 264380 | National Road Championships - Czechia (ME) — Men Elite - Individual Time Trial | CN | CZ | 2026-06-24 | 6dbc1e84-5283-4e8d-a498-747c1364ee6b | Campeonato de Chequia CRI masculino |
| CN | 78929 | 264383 | National Road Championships - Ireland (ME) — Men Elite - Individual Road Race | CN | IE | 2026-06-24 | 1888930d-0e83-4f14-ae42-e3b416f9db01 | Campeonato de Irlanda línea masculino |
| CN | 78929 | 264382 | National Road Championships - Ireland (ME) — Men Elite - Individual Time Trial | CN | IE | 2026-06-24 | 84d9a35c-93f9-4cf3-b69f-4a023c3c8616 | Campeonato de Irlanda CRI masculino |
| CN | 78930 | 264386 | National Road Championships - Slovakia (ME) — Men Elite - Individual Road Race | CN | SK | 2026-06-24 | e100b059-d568-4f7f-a300-e0027424b9a2 | Campeonato de Eslovaquia línea masculino |
| CN | 78930 | 264385 | National Road Championships - Slovakia (ME) — Men Elite - Individual Time Trial | CN | SK | 2026-06-24 | 32e6f8ea-26c6-405b-b002-25a1d2433988 | Campeonato de Eslovaquia CRI masculino |
| CN | 79275 | 266734 | National Road Championships - Great Britain (ME) — Men Elite - Individual Road Race | CN | GB | 2026-06-24 | df5ec91e-e3e7-4eac-9a01-701105e2abbb | Campeonato de Gran Bretaña línea masculino |
| CN | 79275 | 266733 | National Road Championships - Great Britain (ME) — Men Elite - Individual Time Trial | CN | GB | 2026-06-24 | 46cec943-3b7f-469f-8724-a51290f40f37 | Campeonato de Gran Bretaña CRI masculino |
| CN | 77920 | 255834 | National Road Championships - Lithuania — Men Elite - Individual Road Race | CN | LT | 2026-06-23 | 33f370cd-bc8b-4c68-b237-a5451b3d56bc | Campeonato de Lituania línea masculino |
| CN | 77920 | 255835 | National Road Championships - Lithuania — Women Elite - Individual Road Race | CN | LT | 2026-06-23 | 66d39ed5-5c2e-4e64-8e69-e5f9f57f8c75 | Campeonato de Lituania línea femenino |
| CN | 77920 | 266667 | National Road Championships - Lithuania — Men Under 23 - Individual Road Race | CN | LT | 2026-06-23 | 24f615ee-d427-439b-8672-251a3f139b9e | Campeonato de Lituania línea sub23 masculino |
| CN | 77920 | 255826 | National Road Championships - Lithuania — Men Under 23 - Individual Time Trial | CN | LT | 2026-06-23 | 1f972497-6c9f-4bba-ac10-497ed2d5174d | Campeonato de Lituania CRI sub23 masculino |
| CN | 77920 | 255827 | National Road Championships - Lithuania — Women Elite - Individual Time Trial | CN | LT | 2026-06-23 | c7261020-f89d-411d-a834-2670f6ed064e | Campeonato de Lituania CRI femenino |
| CN | 77922 | 255858 | National Road Championships - Kazakhstan — Men Elite - Individual Road Race | CN | KZ | 2026-06-23 | 1b1a6b5a-7330-58a1-8fe0-b9bf32fd50f3 | Campeonato de Kazajistán línea masculino |
| CN | 77922 | 255849 | National Road Championships - Kazakhstan — Men Elite - Individual Time Trial | CN | KZ | 2026-06-23 | 03e3de4d-c1c5-5fca-88ab-8cc36d2e3cfb | Campeonato de Kazajistán CRI masculino |
| CN | 78468 | 261136 | National Road Championships - Poland — Men Elite - Individual Road Race | CN | PL | 2026-06-23 | 3f97ad87-22c4-467a-b366-f4ef6e82f1e0 | Campeonato de Polonia línea masculino |
| CN | 78468 | 261141 | National Road Championships - Poland — Women Under 23 - Individual Time Trial | CN | PL | 2026-06-23 | 44fe0f33-1fcd-4cbf-9e7f-cd844815b7f9 | Campeonato de Polonia CRI sub23 femenino |
| CN | 78468 | 261142 | National Road Championships - Poland — Men Elite - Individual Time Trial | CN | PL | 2026-06-23 | 0da84b0c-8e2d-47e8-b84f-8fbf094eef19 | Campeonato de Polonia CRI masculino |
| CN | 78468 | 261144 | National Road Championships - Poland — Men Under 23 - Individual Time Trial | CN | PL | 2026-06-23 | 5f7db325-ab66-4ad0-976c-412219c576cc | Campeonato de Polonia CRI sub23 masculino |
| CN | 78926 | 264375 | National Road Championships - Kazakhstan (WE) — Women Elite - Individual Road Race | CN | KZ | 2026-06-23 | 32301415-5a6e-5ce7-84fb-8df5628377e7 | Campeonato de Kazajistán línea femenino |
| CN | 78926 | 264374 | National Road Championships - Kazakhstan (WE) — Women Elite - Individual Time Trial | CN | KZ | 2026-06-23 | 2c97ab24-807a-583d-8177-f133d0da1265 | Campeonato de Kazajistán CRI femenino |
| CN | 78927 | 264379 | National Road Championships - Poland (WE) — Women Elite - Individual Road Race | CN | PL | 2026-06-23 | b9fc6f59-f520-44fb-9e8c-36d6a3970d4e | Campeonato de Polonia línea femenino |
| CN | 78927 | 264378 | National Road Championships - Poland (WE) — Women Elite - Individual Time Trial | CN | PL | 2026-06-23 | cc2cefff-decb-458e-9b43-968ce3614c4a | Campeonato de Polonia CRI femenino |
| CN | 77916 | 255791 | National Road Championships - Latvia — Women Elite - Individual Road Race | CN | LV | 2026-06-21 | c188bf4a-bd90-4496-85f0-800032668891 | Campeonato de Letonia línea femenino |
| CN | 77916 | 266676 | National Road Championships - Latvia — Men Under 23 - Individual Road Race | CN | LV | 2026-06-21 | c064e047-3baf-4a6e-9e2c-58ce0b0c4747 | Campeonato de Letonia línea sub23 masculino |
| CN | 78923 | 264369 | National Road Championships - Latvia (ME) — Men Elite - Individual Road Race | CN | LV | 2026-06-21 | e9fa4273-0dff-4e42-b3f7-d8ee085a61c6 | Campeonato de Letonia línea masculino |
| CN | 77914 | 255771 | National Road Championships - Guatemala — Women Elite - Individual Road Race | CN | GT | 2026-06-20 | 8a257627-c5fe-4eba-b4c0-f176e43934fe | Campeonato de Guatemala línea femenino |
| CN | 77910 | 260062 | National Road Championships - Israel — Men Under 23 - Individual Time Trial | CN | IL | 2026-06-19 | 3a1a1da2-b002-4a1e-916c-69f54451d1e6 | Campeonato de Israel CRI sub23 masculino |
| CN | 77910 | 260063 | National Road Championships - Israel — Women Elite - Individual Time Trial | CN | IL | 2026-06-19 | a7c3cbf1-60e4-4d6b-95c5-66a1dc71137e | Campeonato de Israel CRI femenino |
| CN | 77911 | 255743 | National Road Championships - Estonia — Women Elite - Individual Road Race | CN | EE | 2026-06-19 | 3f4c7c4c-f10f-4287-96ab-07b02d7ca070 | Campeonato de Estonia línea femenino |
| CN | 77911 | 266735 | National Road Championships - Estonia — Men Under 23 - Individual Road Race | CN | EE | 2026-06-19 | 78dd602d-6dda-4211-9376-20689161b3fd | Campeonato de Estonia línea sub23 masculino |
| CN | 77911 | 266736 | National Road Championships - Estonia — Women Under 23 - Individual Road Race | CN | EE | 2026-06-19 | 72dad25d-f884-4f56-8ed6-6f11a6b11755 | Campeonato de Estonia línea sub23 femenino |
| CN | 77912 | 255751 | National Road Championships - Italy — Women Elite - Individual Road Race | CN | IT | 2026-06-19 | 390c2f8f-fe32-40ba-88c1-07ba232077be | Campeonato de Italia línea femenino |
| CN | 77912 | 255752 | National Road Championships - Italy — Men Elite - Individual Road Race | CN | IT | 2026-06-19 | c9d0b819-6504-4830-b417-44e9eb93d167 | Campeonato de Italia línea masculino |
| CN | 77912 | 266808 | National Road Championships - Italy — Men Under 23 - Individual Road Race | CN | IT | 2026-06-19 | 6746b4df-f374-4497-a481-dd8e647c5d0f | Campeonato de Italia línea sub23 masculino |
| CN | 77912 | 255750 | National Road Championships - Italy — Men Elite - Individual Time Trial | CN | IT | 2026-06-19 | 97f00da6-d97d-44a4-a365-c7338d882f87 | Campeonato de Italia CRI masculino |
| CN | 78197 | 260067 | National Road Championships - Israel (ME) — Men Elite - Individual Time Trial | CN | IL | 2026-06-19 | 8687b6e2-b890-4cd8-9129-ba9ce56770f4 | Campeonato de Israel CRI masculino |
| CN | 78922 | 264366 | National Road Championships - Estonia (ME) — Men Elite - Individual Road Race | CN | EE | 2026-06-19 | 9517c10f-bb6a-4c12-8485-91984b51cfbf | Campeonato de Estonia línea masculino |
| CN | 79048 | 265194 | National Road Championships - Netherlands — Men Elite - Individual Road Race | CN | NL | 2026-06-19 | 69f95cfe-f212-4021-9d1c-e37f829204bb | Campeonato de Países Bajos línea masculino |
| CN | 79048 | 265196 | National Road Championships - Netherlands — Women Elite - Individual Road Race | CN | NL | 2026-06-19 | 9894d9ca-b30f-44de-85bc-7e9f9fec1d6a | Campeonato de Países Bajos línea femenino |
| CN | 77913 | 255756 | National Road Championships - Hungary — Men Elite - Individual Road Race | CN | HU | 2026-06-18 | c190e487-cd8f-4758-99ee-90768a606bbb | Campeonato de Hungría línea masculino |
| CN | 77913 | 255757 | National Road Championships - Hungary — Women Elite - Individual Road Race | CN | HU | 2026-06-18 | 66bccc2a-931c-4d9a-a1a3-ea7f0a586a22 | Campeonato de Hungría línea femenino |
| CN | 77913 | 255755 | National Road Championships - Hungary — Women Under 23 - Individual Time Trial | CN | HU | 2026-06-18 | e5f398ed-d86e-454a-b259-82ed0d28b7ae | Campeonato de Hungría CRI sub23 femenino |
| CN | 77913 | 255760 | National Road Championships - Hungary — Men Elite - Individual Time Trial | CN | HU | 2026-06-18 | 97beadc9-d1f9-42bc-90c3-cd0015c7aa1a | Campeonato de Hungría CRI masculino |
| CN | 77913 | 255762 | National Road Championships - Hungary — Men Under 23 - Individual Time Trial | CN | HU | 2026-06-18 | eb77162a-eb9c-4824-a89b-15d7558ae33c | Campeonato de Hungría CRI sub23 masculino |
| CN | 77913 | 255763 | National Road Championships - Hungary — Women Elite - Individual Time Trial | CN | HU | 2026-06-18 | 3f9caebf-dccb-4119-b2c8-2404e45850bc | Campeonato de Hungría CRI femenino |
| CN | 78701 | 262880 | American National Championships - Road — Men Under 23 - Individual Road Race | CN | US | 2026-06-15 | af73a9cf-c7f8-478a-9b18-ea70c317cf45 | Campeonato de Estados Unidos línea sub23 masculino |
| CN | 78701 | 265211 | American National Championships - Road — Women Under 23 - Individual Road Race | CN | US | 2026-06-15 | c49a075e-35a0-4eae-8df8-fc6f63f6cd49 | Campeonato de Estados Unidos línea sub23 femenino |
| CN | 78701 | 262884 | American National Championships - Road — Men Elite - Individual Time Trial | CN | US | 2026-06-15 | 0a5f5f9d-f00a-4099-97b1-5be58798513d | Campeonato de Estados Unidos CRI masculino |
| CN | 78701 | 262887 | American National Championships - Road — Women Elite - Individual Time Trial | CN | US | 2026-06-15 | eba8bdb9-0fc4-4eee-841a-ef50f617591b | Campeonato de Estados Unidos CRI femenino |
| CN | 78701 | 262886 | American National Championships - Road — Men Under 23 - Individual Time Trial | CN | US | 2026-06-15 | b455e5f7-11f0-4587-8f76-ee5e3decd62c | Campeonato de Estados Unidos CRI sub23 masculino |
| CN | 78701 | 262889 | American National Championships - Road — Women Under 23 - Individual Time Trial | CN | US | 2026-06-15 | ceec8d91-4dd9-409a-9e74-117194330e83 | Campeonato de Estados Unidos CRI sub23 femenino |
| CN | 79220 | 266217 | National Road Championships - Finland — Men Elite - Individual Road Race | CN | FI | 2026-06-12 | 1a2903b2-a129-4df7-9b09-b6d2617593fe | Campeonato de Finlandia línea masculino |
| CN | 79220 | 266219 | National Road Championships - Finland — Women Elite - Individual Road Race | CN | FI | 2026-06-12 | cb2aa52c-a1bf-4b76-ad50-6bb702e1ebac | Campeonato de Finlandia línea femenino |
| CN | 79220 | 266221 | National Road Championships - Finland — Men Elite - Individual Time Trial | CN | FI | 2026-06-12 | f59c0b4a-2c10-4e7c-8f0f-8605e96dd114 | Campeonato de Finlandia CRI masculino |
| CN | 79220 | 266223 | National Road Championships - Finland — Men Under 23 - Individual Time Trial | CN | FI | 2026-06-12 | d4479368-4a25-4332-8f7c-2f92377a2953 | Campeonato de Finlandia CRI sub23 masculino |
| CN | 79220 | 266224 | National Road Championships - Finland — Women Elite - Individual Time Trial | CN | FI | 2026-06-12 | c5348404-b115-471c-81fa-03516869c381 | Campeonato de Finlandia CRI femenino |
| CN | 79220 | 266226 | National Road Championships - Finland — Women Under 23 - Individual Time Trial | CN | FI | 2026-06-12 | b34d908a-29d4-4ebf-b90d-bd33df4df149 | Campeonato de Finlandia CRI sub23 femenino |
| CN | 79017 | 264926 | National Road Championships - Ecuador — Women Elite - Individual Road Race | CN | EC | 2026-06-10 | 5b7fb224-eb0c-4648-b32e-cdf0ea97dc2d | Campeonato de Ecuador línea femenino |
| CN | 79017 | 264930 | National Road Championships - Ecuador — Men Under 23 - Individual Time Trial | CN | EC | 2026-06-10 | 74cd1389-6bfa-46f4-9028-c0398df6fe0a | Campeonato de Ecuador CRI sub23 masculino |
| CN | 79017 | 264931 | National Road Championships - Ecuador — Women Elite - Individual Time Trial | CN | EC | 2026-06-10 | eded8cef-6a00-47cc-a4ea-73a291ccba19 | Campeonato de Ecuador CRI femenino |
| CN | 79017 | 264933 | National Road Championships - Ecuador — Women Under 23 - Individual Time Trial | CN | EC | 2026-06-10 | 2f2268ba-74be-4df1-adce-fe6c392850e2 | Campeonato de Ecuador CRI sub23 femenino |
| CN | 79207 | 266138 | National Road Championships - Ecuador — Men Elite - Individual Road Race | CN | EC | 2026-06-10 | d2fe7284-31f5-4f7e-a791-9c01bc927bdc | Campeonato de Ecuador línea masculino |
| CN | 79207 | 266137 | National Road Championships - Ecuador — Men Elite - Individual Time Trial | CN | EC | 2026-06-10 | 66a27e85-df5b-4b5a-9c19-f3d0df05de14 | Campeonato de Ecuador CRI masculino |
<!-- EXISTING-ROWS-END -->

## Revisión ambigua — 7

| Ámbito | competitionId | uciRaceId | Nombre DataRide | Clase | País | Inicio UCI | bestRaceId | Carrera candidata |
|:---|---:|---:|:---|:---:|:---:|:---:|:---|:---|
| review | 78881 | — | Giochi del Mediterraneo - ME ITT | 1.2 | IT | 2026-08-21 | 6bd6c07a-4b44-4c5a-b908-249a5c1a71d2 | Juegos del Mediterráneo CRI masculino |
| review | 79283 | — | Giochi del Mediterraneo - WE ITT | 1.2 | IT | 2026-08-21 | c1f7f7d4-8d53-4b0f-8c2a-51a8cf1e90d1 | Juegos del Mediterráneo CRI femenino |
| review | 77787 | — | Tour du Limousin-Périgord - Nouvelle Aquitaine | 2.1 | FR | 2026-08-17 | yhLqymbc76CinYVs9eVT | Tour du Limousin |
| review | 76403 | — | ADAC Cyclassics | 1.UWT | DE | 2026-08-15 | CuuKI2prTjhXvVzhpfv8 | Cyclassics Hamburgo |
| review | 77764 | — | Clásica de Ordizia - Ordiziako Klasikoa | 1.1 | ES | 2026-07-24 | I1omHMec4LNBvMoqbrre | Clásica de Ordizia |
| review | 79036 | — | Juegos centroamericanos y del Caribe, Santo Domingo ITT - ME | 1.2 | DO | 2026-07-24 | 00f9e8dc-9116-4c48-8c69-690023b6cbb6 | Juegos Centroamericanos y del Caribe CRI masculino |
| review | 79273 | — | Juegos centroamericanos y del Caribe, Santo Domingo ITT - WE | 1.2 | DO | 2026-07-24 | 6709a7ac-a2fa-400a-b50b-ca17c53ed374 | Juegos Centroamericanos y del Caribe CRI femenino |
<!-- REVIEW-ROWS-END -->

## Siguiente fase propuesta

1. Verificar resultados publicados para las 383 candidatas mediante `Events/` y
   `Results/`, con prioridad para las 43 directas y para los campeonatos nacionales
   que tengan prueba elite/u23 completa.
2. Resolver las 7 ambiguas y las 194 carreras existentes sin enlace.
3. Preparar un manifiesto de alta por `raceId`/`competitionId`/`uciRaceId` exactos.
4. Crear únicamente la ficha mínima de carrera y sus jornadas necesarias para los
   resultados. No incorporar startlists, assets, broadcasts, perfiles, mapas ni
   contenido editorial.
5. Volcar los resultados oficiales y ejecutar los detectores de saneamiento antes
   de publicar cualquier ampliación.

Este documento no autoriza ninguna de esas escrituras.
