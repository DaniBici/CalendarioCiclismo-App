# Cruce final de carreras UCI 2026 ausentes — 2026-08-29

## Resultado

Este documento refina el inventario inicial de
[`auditoria-carreras-uci-2026-20260829.md`](auditoria-carreras-uci-2026-20260829.md)
contra el estado actual de Supabase. El alcance se limita a pruebas de carretera
élite y sub23, masculino y femenino, ya disputadas en 2026. No se han realizado
escrituras.

El conjunto final contiene **342 pruebas sin carrera equivalente en la base y
sin rastro de resultados**: 5 pruebas directas y 337 pruebas de campeonatos
nacionales. Son candidatas para una fase posterior de alta mínima y volcado
exclusivo de resultados.

## Método y controles

- DataRide: carretera, `disciplineId=10`, temporada UCI 2026
  (`SeasonId=464`), con expansión de `Races/` para obtener categoría y fecha
  concreta.
- Supabase: `races` del año 2026, `race_uci_links`,
  `race_uci_stages` y `race_uci_results`, mediante consultas `SELECT` del
  conector MCP.
- En pruebas nacionales se compararon país, categoría `CN`, sexo, edad,
  modalidad y fecha concreta de `Races/` con tolerancia de tres días.
- En pruebas directas se verificó la categoría de `Races/`; se excluyó toda
  competición cuya única categoría era `Men Junior` o `Women Junior`.
- El código `IRR` se representa como `rr` y `ITT` como `itt`.

| Control | Resultado |
|---|---:|
| Carreras 2026 en Supabase | 816 |
| Candidatas iniciales del inventario anterior | 383 |
| Directas exclusivamente júnior excluidas | 34 |
| Candidatas elegibles tras excluir júnior | 349 |
| Coincidencias ya existentes con resultados | 7 |
| Candidatas finales sin carrera ni resultado | 342 |
| Trazas UCI para las 342 candidatas finales | 0 enlaces, 0 stages, 0 resultados |

Las 342 filas finales son un inventario de candidatos, no una autorización de
escritura. Antes del alta habrá que verificar la disponibilidad y la integridad
del resultado oficial en DataRide.

## Categorías de las candidatas finales

| Ámbito | Edad | Género | Modalidad | Número |
|:---|:---|:---|:---|---:|
| Directas | elite | female | ITT/RR | 3 |
| Directas | elite | male | ITT/RR | 2 |
| CN | elite | female | ITT | 52 |
| CN | elite | female | RR | 54 |
| CN | elite | male | ITT | 63 |
| CN | elite | male | RR | 67 |
| CN | u23 | female | ITT | 23 |
| CN | u23 | female | RR | 11 |
| CN | u23 | male | ITT | 43 |
| CN | u23 | male | RR | 24 |

## Exclusiones por categoría

Las siguientes 34 competiciones directas se excluyeron porque DataRide las
devuelve exclusivamente como júnior, aunque la clase de calendario sea
`1.1`, `2.1` u otra clase internacional:

`77486`, `77493`, `77496`, `77498`, `77576`, `77587`,
`77598`, `77601`, `77608`, `77613`, `77614`, `77622`,
`77625`, `77626`, `77649`, `77650`, `77656`, `77681`,
`77688`, `77689`, `77690`, `77693`, `77694`, `77695`,
`77696`, `77697`, `77702`, `77703`, `77705`, `77711`,
`77992`, `77998`, `78696`.

## Coincidencias ya existentes con resultados

Estas siete filas se retiran del inventario de altas. El identificador DataRide
de la fila inicial no coincide con el enlace de resultados existente porque las
cuatro pruebas directas de juegos se cargaron originalmente desde PDF y los
tres campeonatos nacionales ya están enlazados a otra representación de la
fuente.

| DataRide | uciRaceId | Carrera existente | Sexo | Fecha DB | Resultados |
|---:|---:|:---|:---|:---:|---:|
| 79271 | — | Juegos Centroamericanos y del Caribe línea masculino | male | 2026-08-02 | 44 |
| 79272 | — | Juegos Centroamericanos y del Caribe línea femenino | female | 2026-08-01 | 41 |
| 79281 | — | Juegos del Mediterráneo línea masculino | male | 2026-08-24 | 51 |
| 79282 | — | Juegos del Mediterráneo línea femenino | female | 2026-08-24 | 32 |
| 79210 | 266152 | Campeonato de Austria línea sub23 masculino | male | 2026-07-05 | 1 |
| 79211 | 266154 | Campeonato de Alemania línea sub23 masculino | male | 2026-07-05 | 3 |
| 79213 | 266158 | Campeonato de Suiza línea sub23 masculino | male | 2026-07-05 | 3 |

La comprobación de categorías y fechas concretas de DataRide resolvió además que
`77625` y `77626` son pruebas `Women Junior` y `Men Junior`, no
pruebas sub23.

## Candidatas finales

| Ámbito | competitionId | uciRaceId | Nombre DataRide | Clase | País | Fecha concreta | Edad | Género | Tipo |
|:---|---:|---:|:---|:---:|:---:|:---:|:---|:---|:---|
| direct | 77540 | — | BIWASE Cup | 2.2 | VN | 2026-03-10 | elite | female | rr |
| direct | 78861 | — | Campeonato Centroamericano ITT - ME | 1.2 | CR | 2026-04-09 | elite | male | itt |
| direct | 78862 | — | Campeonato Centroamericano ITT - WE | 1.2 | CR | 2026-04-09 | elite | female | itt |
| direct | 78863 | — | Campeonato Centroamericano IRR - WE | 1.2 | CR | 2026-04-11 | elite | female | rr |
| direct | 78864 | — | Campeonato Centroamericano IRR - ME | 1.2 | CR | 2026-04-12 | elite | male | rr |
| CN | 77939 | 256016 | National Road Championships - Kyrgystan — Men Elite - Individual Road Race | CN | KG | 2026-08-23 | elite | male | rr |
| CN | 77939 | 256018 | National Road Championships - Kyrgystan — Women Elite - Individual Road Race | CN | KG | 2026-08-23 | elite | female | rr |
| CN | 77939 | 256011 | National Road Championships - Kyrgystan — Men Elite - Individual Time Trial | CN | KG | 2026-08-22 | elite | male | itt |
| CN | 77939 | 256014 | National Road Championships - Kyrgystan — Women Elite - Individual Time Trial | CN | KG | 2026-08-22 | elite | female | itt |
| CN | 79253 | 266554 | National Road Championships - Lesotho — Men Elite - Individual Road Race | CN | LS | 2026-08-08 | elite | male | rr |
| CN | 79310 | 267090 | National Road Championships - Cape Verde — Men Elite - Individual Road Race | CN | CV | 2026-07-26 | elite | male | rr |
| CN | 79310 | 267093 | National Road Championships - Cape Verde — Women Elite - Individual Road Race | CN | CV | 2026-07-25 | elite | female | rr |
| CN | 79310 | 267096 | National Road Championships - Cape Verde — Men Elite - Individual Time Trial | CN | CV | 2026-07-24 | elite | male | itt |
| CN | 79310 | 267098 | National Road Championships - Cape Verde — Men Under 23 - Individual Time Trial | CN | CV | 2026-07-24 | u23 | male | itt |
| CN | 79310 | 267099 | National Road Championships - Cape Verde — Women Elite - Individual Time Trial | CN | CV | 2026-07-24 | elite | female | itt |
| CN | 77950 | 256063 | National Road Championships - St. Maarten — Men Elite - Individual Time Trial | CN | SX | 2026-07-18 | elite | male | itt |
| CN | 77950 | 256066 | National Road Championships - St. Maarten — Women Elite - Individual Time Trial | CN | SX | 2026-07-18 | elite | female | itt |
| CN | 77950 | 256069 | National Road Championships - St. Maarten — Men Elite - Individual Road Race | CN | SX | 2026-07-18 | elite | male | rr |
| CN | 77950 | 256072 | National Road Championships - St. Maarten — Women Elite - Individual Road Race | CN | SX | 2026-07-18 | elite | female | rr |
| CN | 78725 | 263166 | National Road Championships - Georgia — Men Elite - Individual Road Race | CN | GE | 2026-07-19 | elite | male | rr |
| CN | 78725 | 263168 | National Road Championships - Georgia — Men Elite - Individual Time Trial | CN | GE | 2026-07-18 | elite | male | itt |
| CN | 79292 | 266919 | National Road Championships - Burkina Faso — Men Elite - Individual Road Race | CN | BF | 2026-07-19 | elite | male | rr |
| CN | 79292 | 266917 | National Road Championships - Burkina Faso — Women Elite - Individual Road Race | CN | BF | 2026-07-18 | elite | female | rr |
| CN | 77888 | 255527 | National Road Championships - France (Junior/U23) — Men Under 23 - Individual Road Race | CN | FR | 2026-07-18 | u23 | male | rr |
| CN | 77888 | 255529 | National Road Championships - France (Junior/U23) — Women Under 23 - Individual Road Race | CN | FR | 2026-07-18 | u23 | female | rr |
| CN | 77888 | 255523 | National Road Championships - France (Junior/U23) — Men Under 23 - Individual Time Trial | CN | FR | 2026-07-15 | u23 | male | itt |
| CN | 77888 | 255525 | National Road Championships - France (Junior/U23) — Women Under 23 - Individual Time Trial | CN | FR | 2026-07-15 | u23 | female | itt |
| CN | 78084 | 258375 | National Road Championships - Iran — Men Elite - Individual Time Trial | CN | IR | 2026-07-17 | elite | male | itt |
| CN | 78084 | 258371 | National Road Championships - Iran — Men Elite - Individual Road Race | CN | IR | 2026-07-16 | elite | male | rr |
| CN | 78084 | 258372 | National Road Championships - Iran — Women Elite - Individual Time Trial | CN | IR | 2026-07-16 | elite | female | itt |
| CN | 78084 | 258368 | National Road Championships - Iran — Women Elite - Individual Road Race | CN | IR | 2026-07-15 | elite | female | rr |
| CN | 79327 | 267314 | National Road Championships - Malta (IRR) — Men Elite - Individual Road Race | CN | MT | 2026-07-12 | elite | male | rr |
| CN | 77955 | 256091 | National Road Championships - Czechia (MU) — Men Under 23 - Individual Road Race | CN | CZ | 2026-07-05 | u23 | male | rr |
| CN | 79302 | 266963 | National Road Championships - Ivory Coast — Men Elite - Individual Road Race | CN | CI | 2026-07-05 | elite | male | rr |
| CN | 79302 | 266966 | National Road Championships - Ivory Coast — Women Under 23 - Individual Road Race | CN | CI | 2026-07-05 | u23 | female | rr |
| CN | 77941 | 256032 | National Road Championships - Slovakia (MU IRR) — Men Under 23 - Individual Road Race | CN | SK | 2026-07-04 | u23 | male | rr |
| CN | 79020 | 265001 | National Road Championships - Mongolia — Women Elite - Individual Road Race | CN | MN | 2026-07-05 | elite | female | rr |
| CN | 79020 | 264997 | National Road Championships - Mongolia — Women Elite - Individual Time Trial | CN | MN | 2026-07-04 | elite | female | itt |
| CN | 79250 | 266533 | National Road Championships - Mongolia (ME) — Men Elite - Individual Time Trial | CN | MN | 2026-07-05 | elite | male | itt |
| CN | 79250 | 266532 | National Road Championships - Mongolia (ME) — Men Elite - Individual Road Race | CN | MN | 2026-07-04 | elite | male | rr |
| CN | 77917 | 255803 | National Road Championships - Uzbekistan — Men Elite - Individual Road Race | CN | UZ | 2026-07-02 | elite | male | rr |
| CN | 77917 | 255802 | National Road Championships - Uzbekistan — Women Elite - Individual Road Race | CN | UZ | 2026-07-01 | elite | female | rr |
| CN | 77917 | 255800 | National Road Championships - Uzbekistan — Men Elite - Individual Time Trial | CN | UZ | 2026-06-30 | elite | male | itt |
| CN | 77917 | 255801 | National Road Championships - Uzbekistan — Women Elite - Individual Time Trial | CN | UZ | 2026-06-30 | elite | female | itt |
| CN | 77952 | 256081 | National Road Championships - Dominica — Men Elite - Individual Road Race | CN | DM | 2026-06-28 | elite | male | rr |
| CN | 77954 | 256088 | National Road Championships - Lebanon — Men Elite - Individual Road Race | CN | LB | 2026-07-05 | elite | male | rr |
| CN | 77954 | 256090 | National Road Championships - Lebanon — Women Elite - Individual Road Race | CN | LB | 2026-07-05 | elite | female | rr |
| CN | 77954 | 256085 | National Road Championships - Lebanon — Men Elite - Individual Time Trial | CN | LB | 2026-06-28 | elite | male | itt |
| CN | 77954 | 256087 | National Road Championships - Lebanon — Women Elite - Individual Time Trial | CN | LB | 2026-06-28 | elite | female | itt |
| CN | 78892 | 264125 | National Road Championships - Puerto Rico — Men Elite - Individual Time Trial | CN | PR | 2026-07-05 | elite | male | itt |
| CN | 78892 | 264127 | National Road Championships - Puerto Rico — Men Under 23 - Individual Time Trial | CN | PR | 2026-07-05 | u23 | male | itt |
| CN | 78892 | 264128 | National Road Championships - Puerto Rico — Women Elite - Individual Time Trial | CN | PR | 2026-07-05 | elite | female | itt |
| CN | 78892 | 264121 | National Road Championships - Puerto Rico — Men Elite - Individual Road Race | CN | PR | 2026-06-28 | elite | male | rr |
| CN | 78892 | 264122 | National Road Championships - Puerto Rico — Women Elite - Individual Road Race | CN | PR | 2026-06-28 | elite | female | rr |
| CN | 79328 | 267313 | National Road Championships - Malta (ITT) — Men Elite - Individual Time Trial | CN | MT | 2026-06-28 | elite | male | itt |
| CN | 79347 | 267416 | National Road Championships - Senegal (WE) — Women Elite - Individual Road Race | CN | SN | 2026-06-28 | elite | female | rr |
| CN | 79348 | 267415 | National Road Championships - Senegal (ME) — Men Elite - Individual Road Race | CN | SN | 2026-06-28 | elite | male | rr |
| CN | 77891 | 255538 | National Road Championships - Japan — Men Under 23 - Individual Road Race | CN | JP | 2026-06-27 | u23 | male | rr |
| CN | 77928 | 255909 | National Road Championships - Azerbaijan — Men Elite - Individual Road Race | CN | AZ | 2026-06-29 | elite | male | rr |
| CN | 77928 | 255902 | National Road Championships - Azerbaijan — Men Elite - Individual Time Trial | CN | AZ | 2026-06-27 | elite | male | itt |
| CN | 77938 | 256006 | National Road Championships - Barbados — Men Elite - Individual Road Race | CN | BB | 2026-06-28 | elite | male | rr |
| CN | 77938 | 256008 | National Road Championships - Barbados — Women Elite - Individual Road Race | CN | BB | 2026-06-28 | elite | female | rr |
| CN | 77938 | 256002 | National Road Championships - Barbados — Men Elite - Individual Time Trial | CN | BB | 2026-06-27 | elite | male | itt |
| CN | 77938 | 256004 | National Road Championships - Barbados — Women Elite - Individual Time Trial | CN | BB | 2026-06-27 | elite | female | itt |
| CN | 77948 | 256049 | National Road Championships - Mauritius — Men Under 23 - Individual Road Race | CN | MU | 2026-06-28 | u23 | male | rr |
| CN | 77948 | 256043 | National Road Championships - Mauritius — Men Under 23 - Individual Time Trial | CN | MU | 2026-06-27 | u23 | male | itt |
| CN | 77953 | 256082 | National Road Championships - Cameroun — Men Elite - Individual Road Race | CN | CM | 2026-06-28 | elite | male | rr |
| CN | 77953 | 263162 | National Road Championships - Cameroun — Men Elite - Individual Time Trial | CN | CM | 2026-06-27 | elite | male | itt |
| CN | 78117 | 258721 | National Road Championships - Cayman Islands — Men Elite - Individual Road Race | CN | KY | 2026-06-28 | elite | male | rr |
| CN | 78117 | 258723 | National Road Championships - Cayman Islands — Women Elite - Individual Road Race | CN | KY | 2026-06-28 | elite | female | rr |
| CN | 78117 | 258725 | National Road Championships - Cayman Islands — Men Elite - Individual Time Trial | CN | KY | 2026-06-27 | elite | male | itt |
| CN | 78117 | 258727 | National Road Championships - Cayman Islands — Men Under 23 - Individual Time Trial | CN | KY | 2026-06-27 | u23 | male | itt |
| CN | 78117 | 258728 | National Road Championships - Cayman Islands — Women Elite - Individual Time Trial | CN | KY | 2026-06-27 | elite | female | itt |
| CN | 78329 | 260052 | National Road Championships - Sweden — Men Elite - Individual Road Race | CN | SE | 2026-06-28 | elite | male | rr |
| CN | 78395 | 260560 | National Road Championships - Antigua and Barbuda — Men Elite - Individual Road Race | CN | AG | 2026-06-28 | elite | male | rr |
| CN | 78395 | 260561 | National Road Championships - Antigua and Barbuda — Men Elite - Individual Time Trial | CN | AG | 2026-06-27 | elite | male | itt |
| CN | 78396 | 260562 | National Road Championships - Honduras — Men Elite - Individual Road Race | CN | HN | 2026-06-28 | elite | male | rr |
| CN | 78396 | 260564 | National Road Championships - Honduras — Women Elite - Individual Road Race | CN | HN | 2026-06-28 | elite | female | rr |
| CN | 78396 | 260566 | National Road Championships - Honduras — Men Elite - Individual Time Trial | CN | HN | 2026-06-27 | elite | male | itt |
| CN | 78396 | 260569 | National Road Championships - Honduras — Women Elite - Individual Time Trial | CN | HN | 2026-06-27 | elite | female | itt |
| CN | 78413 | 260635 | National Road Championships - Peru — Men Elite - Individual Road Race | CN | PE | 2026-06-28 | elite | male | rr |
| CN | 78413 | 260636 | National Road Championships - Peru — Women Elite - Individual Road Race | CN | PE | 2026-06-28 | elite | female | rr |
| CN | 78413 | 260637 | National Road Championships - Peru — Men Elite - Individual Time Trial | CN | PE | 2026-06-27 | elite | male | itt |
| CN | 78413 | 260638 | National Road Championships - Peru — Men Under 23 - Individual Time Trial | CN | PE | 2026-06-27 | u23 | male | itt |
| CN | 78413 | 260639 | National Road Championships - Peru — Women Elite - Individual Time Trial | CN | PE | 2026-06-27 | elite | female | itt |
| CN | 78712 | 262939 | National Road Championships - Jamaica — Men Elite - Individual Road Race | CN | JM | 2026-06-28 | elite | male | rr |
| CN | 78712 | 262943 | National Road Championships - Jamaica — Men Elite - Individual Time Trial | CN | JM | 2026-06-27 | elite | male | itt |
| CN | 78712 | 262945 | National Road Championships - Jamaica — Men Under 23 - Individual Time Trial | CN | JM | 2026-06-27 | u23 | male | itt |
| CN | 78712 | 262946 | National Road Championships - Jamaica — Women Elite - Individual Time Trial | CN | JM | 2026-06-27 | elite | female | itt |
| CN | 78807 | 263554 | National Road Championships - Bulgaria — Men Elite - Individual Road Race | CN | BG | 2026-06-28 | elite | male | rr |
| CN | 78807 | 263556 | National Road Championships - Bulgaria — Women Elite - Individual Road Race | CN | BG | 2026-06-28 | elite | female | rr |
| CN | 78807 | 263558 | National Road Championships - Bulgaria — Men Elite - Individual Time Trial | CN | BG | 2026-06-27 | elite | male | itt |
| CN | 78807 | 263560 | National Road Championships - Bulgaria — Men Under 23 - Individual Time Trial | CN | BG | 2026-06-27 | u23 | male | itt |
| CN | 78807 | 263561 | National Road Championships - Bulgaria — Women Elite - Individual Time Trial | CN | BG | 2026-06-27 | elite | female | itt |
| CN | 78873 | 264015 | National Road Championships - Laos — Men Elite - Individual Road Race | CN | LA | 2026-06-28 | elite | male | rr |
| CN | 78873 | 264017 | National Road Championships - Laos — Men Elite - Individual Time Trial | CN | LA | 2026-06-27 | elite | male | itt |
| CN | 79035 | 265132 | National Road Championships - Croatia — Men Elite - Individual Road Race | CN | HR | 2026-06-28 | elite | male | rr |
| CN | 79035 | 265134 | National Road Championships - Croatia — Women Elite - Individual Road Race | CN | HR | 2026-06-28 | elite | female | rr |
| CN | 79035 | 265136 | National Road Championships - Croatia — Men Elite - Individual Time Trial | CN | HR | 2026-06-27 | elite | male | itt |
| CN | 79035 | 265138 | National Road Championships - Croatia — Women Elite - Individual Time Trial | CN | HR | 2026-06-27 | elite | female | itt |
| CN | 79109 | 265827 | National Road Championships - Trinidad and Tobago — Men Elite - Individual Road Race | CN | TT | 2026-06-28 | elite | male | rr |
| CN | 79109 | 265831 | National Road Championships - Trinidad and Tobago — Men Elite - Individual Time Trial | CN | TT | 2026-06-27 | elite | male | itt |
| CN | 79109 | 265833 | National Road Championships - Trinidad and Tobago — Men Under 23 - Individual Time Trial | CN | TT | 2026-06-27 | u23 | male | itt |
| CN | 79248 | 266529 | National Road Championships - Trinidad and Tobago (WE) — Women Elite - Individual Road Race | CN | TT | 2026-06-28 | elite | female | rr |
| CN | 79248 | 266528 | National Road Championships - Trinidad and Tobago (WE) — Women Elite - Individual Time Trial | CN | TT | 2026-06-27 | elite | female | itt |
| CN | 79249 | 266530 | National Road Championships - Sweden (WE) — Women Elite - Individual Road Race | CN | SE | 2026-06-27 | elite | female | rr |
| CN | 79252 | 266545 | National Road Championships - Montenegro — Men Elite - Individual Road Race | CN | ME | 2026-06-28 | elite | male | rr |
| CN | 79252 | 266553 | National Road Championships - Montenegro — Men Elite - Individual Time Trial | CN | ME | 2026-06-27 | elite | male | itt |
| CN | 79258 | 266580 | National Road Championships - St. Vincent & the Grenadines — Men Elite - Individual Road Race | CN | VC | 2026-06-28 | elite | male | rr |
| CN | 79258 | 266581 | National Road Championships - St. Vincent & the Grenadines — Men Elite - Individual Time Trial | CN | VC | 2026-06-27 | elite | male | itt |
| CN | 79279 | 266791 | National Road Championships - Rwanda — Men Elite - Individual Road Race | CN | RW | 2026-06-28 | elite | male | rr |
| CN | 79279 | 266793 | National Road Championships - Rwanda — Women Elite - Individual Road Race | CN | RW | 2026-06-28 | elite | female | rr |
| CN | 79279 | 266795 | National Road Championships - Rwanda — Men Elite - Individual Time Trial | CN | RW | 2026-06-27 | elite | male | itt |
| CN | 79279 | 266797 | National Road Championships - Rwanda — Women Elite - Individual Time Trial | CN | RW | 2026-06-27 | elite | female | itt |
| CN | 77932 | 255938 | National Road Championships - Denmark — Men Under 23 - Individual Time Trial | CN | DK | 2026-06-26 | u23 | male | itt |
| CN | 77933 | 255954 | National Road Championships - Serbia — Women Elite - Individual Road Race | CN | RS | 2026-06-28 | elite | female | rr |
| CN | 77933 | 255950 | National Road Championships - Serbia — Women Elite - Individual Time Trial | CN | RS | 2026-06-26 | elite | female | itt |
| CN | 77934 | 255961 | National Road Championships - Slovenia — Women Under 23 - Individual Time Trial | CN | SI | 2026-06-26 | u23 | female | itt |
| CN | 77935 | 255974 | National Road Championships - Singapore — Men Elite - Individual Road Race | CN | SG | 2026-06-28 | elite | male | rr |
| CN | 77935 | 255977 | National Road Championships - Singapore — Women Elite - Individual Road Race | CN | SG | 2026-06-28 | elite | female | rr |
| CN | 77935 | 255968 | National Road Championships - Singapore — Men Elite - Individual Time Trial | CN | SG | 2026-06-26 | elite | male | itt |
| CN | 77935 | 255970 | National Road Championships - Singapore — Men Under 23 - Individual Time Trial | CN | SG | 2026-06-26 | u23 | male | itt |
| CN | 77935 | 255971 | National Road Championships - Singapore — Women Elite - Individual Time Trial | CN | SG | 2026-06-26 | elite | female | itt |
| CN | 77936 | 255982 | National Road Championships - Canada — Men Under 23 - Individual Time Trial | CN | CA | 2026-06-26 | u23 | male | itt |
| CN | 77936 | 255985 | National Road Championships - Canada — Women Under 23 - Individual Time Trial | CN | CA | 2026-06-26 | u23 | female | itt |
| CN | 78253 | 259040 | National Road Championships - Jordan — Men Elite - Individual Time Trial | CN | JO | 2026-06-27 | elite | male | itt |
| CN | 78253 | 259042 | National Road Championships - Jordan — Men Under 23 - Individual Time Trial | CN | JO | 2026-06-27 | u23 | male | itt |
| CN | 78253 | 259043 | National Road Championships - Jordan — Women Elite - Individual Time Trial | CN | JO | 2026-06-27 | elite | female | itt |
| CN | 78253 | 259045 | National Road Championships - Jordan — Women Under 23 - Individual Time Trial | CN | JO | 2026-06-27 | u23 | female | itt |
| CN | 78253 | 259036 | National Road Championships - Jordan — Men Elite - Individual Road Race | CN | JO | 2026-06-26 | elite | male | rr |
| CN | 78253 | 259038 | National Road Championships - Jordan — Women Elite - Individual Road Race | CN | JO | 2026-06-26 | elite | female | rr |
| CN | 78331 | 260078 | National Road Championships - Greece — Men Elite - Individual Road Race | CN | GR | 2026-06-28 | elite | male | rr |
| CN | 78331 | 260079 | National Road Championships - Greece — Women Elite - Individual Road Race | CN | GR | 2026-06-28 | elite | female | rr |
| CN | 78331 | 260076 | National Road Championships - Greece — Men Elite - Individual Time Trial | CN | GR | 2026-06-26 | elite | male | itt |
| CN | 78331 | 260077 | National Road Championships - Greece — Women Elite - Individual Time Trial | CN | GR | 2026-06-26 | elite | female | itt |
| CN | 78702 | 262890 | National Road Championships - Morroco — Men Elite - Individual Road Race | CN | MA | 2026-06-28 | elite | male | rr |
| CN | 78702 | 262892 | National Road Championships - Morroco — Women Elite - Individual Road Race | CN | MA | 2026-06-27 | elite | female | rr |
| CN | 78702 | 262894 | National Road Championships - Morroco — Men Elite - Individual Time Trial | CN | MA | 2026-06-26 | elite | male | itt |
| CN | 78702 | 262896 | National Road Championships - Morroco — Men Under 23 - Individual Time Trial | CN | MA | 2026-06-26 | u23 | male | itt |
| CN | 78702 | 262897 | National Road Championships - Morroco — Women Elite - Individual Time Trial | CN | MA | 2026-06-26 | elite | female | itt |
| CN | 78702 | 262899 | National Road Championships - Morroco — Women Under 23 - Individual Time Trial | CN | MA | 2026-06-26 | u23 | female | itt |
| CN | 78713 | 262949 | National Road Championships - Guinea-Bissau — Men Elite - Individual Road Race | CN | GW | 2026-06-28 | elite | male | rr |
| CN | 78713 | 262952 | National Road Championships - Guinea-Bissau — Men Elite - Individual Time Trial | CN | GW | 2026-06-26 | elite | male | itt |
| CN | 78713 | 262954 | National Road Championships - Guinea-Bissau — Men Under 23 - Individual Time Trial | CN | GW | 2026-06-26 | u23 | male | itt |
| CN | 78814 | 263736 | National Road Championships - Macedonia — Men Elite - Individual Road Race | CN | MK | 2026-06-28 | elite | male | rr |
| CN | 78814 | 263738 | National Road Championships - Macedonia — Women Elite - Individual Road Race | CN | MK | 2026-06-28 | elite | female | rr |
| CN | 78814 | 263739 | National Road Championships - Macedonia — Men Elite - Individual Time Trial | CN | MK | 2026-06-26 | elite | male | itt |
| CN | 78814 | 263741 | National Road Championships - Macedonia — Men Under 23 - Individual Time Trial | CN | MK | 2026-06-26 | u23 | male | itt |
| CN | 78814 | 263742 | National Road Championships - Macedonia — Women Elite - Individual Time Trial | CN | MK | 2026-06-26 | elite | female | itt |
| CN | 78932 | 264390 | National Road Championships - Guinea-Bissau (WE) — Women Elite - Individual Road Race | CN | GW | 2026-06-28 | elite | female | rr |
| CN | 78932 | 264389 | National Road Championships - Guinea-Bissau (WE) — Women Elite - Individual Time Trial | CN | GW | 2026-06-26 | elite | female | itt |
| CN | 78934 | 264394 | National Road Championships - Serbia (ME) — Men Elite - Individual Time Trial | CN | RS | 2026-06-28 | elite | male | itt |
| CN | 78934 | 264393 | National Road Championships - Serbia (ME) — Men Elite - Individual Road Race | CN | RS | 2026-06-26 | elite | male | rr |
| CN | 77923 | 255862 | National Road Championships - Korea — Men Elite - Individual Road Race | CN | KR | 2026-06-26 | elite | male | rr |
| CN | 77923 | 255863 | National Road Championships - Korea — Women Elite - Individual Road Race | CN | KR | 2026-06-26 | elite | female | rr |
| CN | 77923 | 255860 | National Road Championships - Korea — Men Elite - Individual Time Trial | CN | KR | 2026-06-25 | elite | male | itt |
| CN | 77923 | 255861 | National Road Championships - Korea — Women Elite - Individual Time Trial | CN | KR | 2026-06-25 | elite | female | itt |
| CN | 77931 | 255932 | National Road Championships - Brazil — Women Elite - Individual Road Race | CN | BR | 2026-06-27 | elite | female | rr |
| CN | 77931 | 266760 | National Road Championships - Brazil — Men Under 23 - Individual Road Race | CN | BR | 2026-06-26 | u23 | male | rr |
| CN | 77931 | 255929 | National Road Championships - Brazil — Men Under 23 - Individual Time Trial | CN | BR | 2026-06-25 | u23 | male | itt |
| CN | 77931 | 255930 | National Road Championships - Brazil — Women Elite - Individual Time Trial | CN | BR | 2026-06-25 | elite | female | itt |
| CN | 77940 | 256020 | National Road Championships - China — Men Elite - Individual Road Race | CN | CN | 2026-06-29 | elite | male | rr |
| CN | 77940 | 267310 | National Road Championships - China — Men Under 23 - Individual Road Race | CN | CN | 2026-06-28 | u23 | male | rr |
| CN | 77940 | 267311 | National Road Championships - China — Women Under 23 - Individual Road Race | CN | CN | 2026-06-28 | u23 | female | rr |
| CN | 77940 | 256023 | National Road Championships - China — Women Elite - Individual Time Trial | CN | CN | 2026-06-25 | elite | female | itt |
| CN | 77940 | 256026 | National Road Championships - China — Men Under 23 - Individual Time Trial | CN | CN | 2026-06-25 | u23 | male | itt |
| CN | 77940 | 256027 | National Road Championships - China — Women Under 23 - Individual Time Trial | CN | CN | 2026-06-25 | u23 | female | itt |
| CN | 77940 | 256030 | National Road Championships - China — Women Elite - Individual Road Race | CN | CN | 2026-06-25 | elite | female | rr |
| CN | 77940 | 256031 | National Road Championships - China — Men Elite - Individual Time Trial | CN | CN | 2026-06-25 | elite | male | itt |
| CN | 78884 | 264068 | National Road Championships - Andorra — Men Under 23 - Individual Road Race | CN | AD | 2026-06-27 | u23 | male | rr |
| CN | 78884 | 264070 | National Road Championships - Andorra — Women Elite - Individual Road Race | CN | AD | 2026-06-27 | elite | female | rr |
| CN | 78884 | 264071 | National Road Championships - Andorra — Men Under 23 - Individual Time Trial | CN | AD | 2026-06-25 | u23 | male | itt |
| CN | 78884 | 264073 | National Road Championships - Andorra — Women Elite - Individual Time Trial | CN | AD | 2026-06-25 | elite | female | itt |
| CN | 78931 | 264388 | National Road Championships - Brazil (ME) — Men Elite - Individual Road Race | CN | BR | 2026-06-28 | elite | male | rr |
| CN | 78931 | 264387 | National Road Championships - Brazil (ME) — Men Elite - Individual Time Trial | CN | BR | 2026-06-25 | elite | male | itt |
| CN | 78982 | 264612 | National Road Championships - Dominican Republic — Men Elite - Individual Road Race | CN | DO | 2026-06-28 | elite | male | rr |
| CN | 78982 | 264614 | National Road Championships - Dominican Republic — Women Elite - Individual Road Race | CN | DO | 2026-06-28 | elite | female | rr |
| CN | 78982 | 264622 | National Road Championships - Dominican Republic — Men Under 23 - Individual Road Race | CN | DO | 2026-06-27 | u23 | male | rr |
| CN | 78982 | 264616 | National Road Championships - Dominican Republic — Men Elite - Individual Time Trial | CN | DO | 2026-06-25 | elite | male | itt |
| CN | 78982 | 264618 | National Road Championships - Dominican Republic — Men Under 23 - Individual Time Trial | CN | DO | 2026-06-25 | u23 | male | itt |
| CN | 78982 | 264619 | National Road Championships - Dominican Republic — Women Elite - Individual Time Trial | CN | DO | 2026-06-25 | elite | female | itt |
| CN | 78982 | 264621 | National Road Championships - Dominican Republic — Women Under 23 - Individual Time Trial | CN | DO | 2026-06-25 | u23 | female | itt |
| CN | 79049 | 265203 | National Road Championships - Bermuda — Men Elite - Individual Road Race | CN | BM | 2026-06-28 | elite | male | rr |
| CN | 79049 | 265205 | National Road Championships - Bermuda — Women Elite - Individual Road Race | CN | BM | 2026-06-28 | elite | female | rr |
| CN | 79049 | 265207 | National Road Championships - Bermuda — Men Elite - Individual Time Trial | CN | BM | 2026-06-25 | elite | male | itt |
| CN | 79049 | 265209 | National Road Championships - Bermuda — Women Elite - Individual Time Trial | CN | BM | 2026-06-25 | elite | female | itt |
| CN | 79070 | 265244 | National Road Championships - Monaco — Men Elite - Individual Road Race | CN | MC | 2026-06-28 | elite | male | rr |
| CN | 79070 | 265245 | National Road Championships - Monaco — Men Elite - Individual Time Trial | CN | MC | 2026-06-25 | elite | male | itt |
| CN | 79131 | 266006 | Women's Road National Championships of Afghanistan — Women Elite - Individual Road Race | CN | AF | 2026-06-27 | elite | female | rr |
| CN | 79131 | 266007 | Women's Road National Championships of Afghanistan — Women Elite - Individual Time Trial | CN | AF | 2026-06-25 | elite | female | itt |
| CN | 79209 | 266143 | National Road Championships - Eritrea — Women Elite - Individual Road Race | CN | ER | 2026-06-28 | elite | female | rr |
| CN | 79209 | 266148 | National Road Championships - Eritrea — Women Elite - Individual Time Trial | CN | ER | 2026-06-26 | elite | female | itt |
| CN | 79246 | 266524 | National Road Championships - Eritrea (ME) — Men Elite - Individual Road Race | CN | ER | 2026-06-28 | elite | male | rr |
| CN | 79246 | 266525 | National Road Championships - Eritrea (ME) — Men Elite - Individual Time Trial | CN | ER | 2026-06-25 | elite | male | itt |
| CN | 77918 | 255811 | National Road Championships - Kosovo — Women Elite - Individual Road Race | CN | XK | 2026-06-26 | elite | female | rr |
| CN | 77918 | 266737 | National Road Championships - Kosovo — Men Under 23 - Individual Road Race | CN | XK | 2026-06-26 | u23 | male | rr |
| CN | 77918 | 255806 | National Road Championships - Kosovo — Men Elite - Individual Road Race | CN | XK | 2026-06-25 | elite | male | rr |
| CN | 77918 | 255807 | National Road Championships - Kosovo — Men Under 23 - Individual Time Trial | CN | XK | 2026-06-25 | u23 | male | itt |
| CN | 77918 | 255808 | National Road Championships - Kosovo — Women Elite - Individual Time Trial | CN | XK | 2026-06-25 | elite | female | itt |
| CN | 77918 | 255804 | National Road Championships - Kosovo — Men Elite - Individual Time Trial | CN | XK | 2026-06-24 | elite | male | itt |
| CN | 77919 | 255819 | National Road Championships - Algeria — Women Elite - Individual Road Race | CN | DZ | 2026-06-26 | elite | female | rr |
| CN | 77919 | 255816 | National Road Championships - Algeria — Men Elite - Individual Time Trial | CN | DZ | 2026-06-25 | elite | male | itt |
| CN | 77919 | 255817 | National Road Championships - Algeria — Men Under 23 - Individual Time Trial | CN | DZ | 2026-06-25 | u23 | male | itt |
| CN | 77919 | 255813 | National Road Championships - Algeria — Women Elite - Individual Time Trial | CN | DZ | 2026-06-24 | elite | female | itt |
| CN | 77919 | 255815 | National Road Championships - Algeria — Women Under 23 - Individual Time Trial | CN | DZ | 2026-06-24 | u23 | female | itt |
| CN | 77920 | 255829 | National Road Championships - Lithuania — Women Under 23 - Individual Time Trial | CN | LT | 2026-06-24 | u23 | female | itt |
| CN | 77922 | 255851 | National Road Championships - Kazakhstan — Men Under 23 - Individual Time Trial | CN | KZ | 2026-06-25 | u23 | male | itt |
| CN | 77922 | 255854 | National Road Championships - Kazakhstan — Women Under 23 - Individual Time Trial | CN | KZ | 2026-06-25 | u23 | female | itt |
| CN | 78083 | 258367 | National Road Championships - Ethiopia — Men Elite - Individual Road Race | CN | ET | 2026-06-28 | elite | male | rr |
| CN | 78083 | 258360 | National Road Championships - Ethiopia — Men Elite - Individual Time Trial | CN | ET | 2026-06-24 | elite | male | itt |
| CN | 78912 | 264245 | National Road Championships - Cyprus — Men Elite - Individual Road Race | CN | CY | 2026-06-28 | elite | male | rr |
| CN | 78912 | 264246 | National Road Championships - Cyprus — Women Elite - Individual Road Race | CN | CY | 2026-06-28 | elite | female | rr |
| CN | 78912 | 264241 | National Road Championships - Cyprus — Men Elite - Individual Time Trial | CN | CY | 2026-06-24 | elite | male | itt |
| CN | 78912 | 264242 | National Road Championships - Cyprus — Women Elite - Individual Time Trial | CN | CY | 2026-06-24 | elite | female | itt |
| CN | 78924 | 264371 | National Road Championships - Algeria (ME) — Men Elite - Individual Road Race | CN | DZ | 2026-06-27 | elite | male | rr |
| CN | 78924 | 264370 | National Road Championships - Algeria (ME) — Men Elite - Individual Time Trial | CN | DZ | 2026-06-24 | elite | male | itt |
| CN | 78925 | 264373 | National Road Championships - Ethiopia (WE) — Women Elite - Individual Road Race | CN | ET | 2026-06-28 | elite | female | rr |
| CN | 78925 | 264372 | National Road Championships - Ethiopia (WE) — Women Elite - Individual Time Trial | CN | ET | 2026-06-24 | elite | female | itt |
| CN | 78991 | 264668 | National Road Championships - Ukraine — Men Elite - Individual Road Race | CN | UA | 2026-06-28 | elite | male | rr |
| CN | 78991 | 264670 | National Road Championships - Ukraine — Women Elite - Individual Road Race | CN | UA | 2026-06-27 | elite | female | rr |
| CN | 78991 | 266803 | National Road Championships - Ukraine — Men Under 23 - Individual Road Race | CN | UA | 2026-06-26 | u23 | male | rr |
| CN | 78991 | 264672 | National Road Championships - Ukraine — Men Elite - Individual Time Trial | CN | UA | 2026-06-25 | elite | male | itt |
| CN | 78991 | 264675 | National Road Championships - Ukraine — Women Elite - Individual Time Trial | CN | UA | 2026-06-25 | elite | female | itt |
| CN | 78991 | 264674 | National Road Championships - Ukraine — Men Under 23 - Individual Time Trial | CN | UA | 2026-06-24 | u23 | male | itt |
| CN | 78991 | 264677 | National Road Championships - Ukraine — Women Under 23 - Individual Time Trial | CN | UA | 2026-06-24 | u23 | female | itt |
| CN | 77914 | 255775 | National Road Championships - Guatemala — Men Under 23 - Individual Road Race | CN | GT | 2026-06-28 | u23 | male | rr |
| CN | 77914 | 255773 | National Road Championships - Guatemala — Women Under 23 - Individual Road Race | CN | GT | 2026-06-27 | u23 | female | rr |
| CN | 77914 | 255766 | National Road Championships - Guatemala — Men Under 23 - Individual Time Trial | CN | GT | 2026-06-21 | u23 | male | itt |
| CN | 77949 | 256055 | National Road Championships - Bosnia and Herzegovina — Men Under 23 - Individual Time Trial | CN | BA | 2026-06-27 | u23 | male | itt |
| CN | 77949 | 256058 | National Road Championships - Bosnia and Herzegovina — Women Under 23 - Individual Time Trial | CN | BA | 2026-06-27 | u23 | female | itt |
| CN | 77949 | 264376 | National Road Championships - Bosnia and Herzegovina — Men Under 23 - Individual Road Race | CN | BA | 2026-06-21 | u23 | male | rr |
| CN | 77949 | 264377 | National Road Championships - Bosnia and Herzegovina — Women Under 23 - Individual Road Race | CN | BA | 2026-06-21 | u23 | female | rr |
| CN | 77909 | 255715 | National Road Championships - Hong Kong — Men Elite - Individual Road Race | CN | HK | 2026-06-21 | elite | male | rr |
| CN | 77909 | 266892 | National Road Championships - Hong Kong — Men Under 23 - Individual Road Race | CN | HK | 2026-06-21 | u23 | male | rr |
| CN | 77909 | 255710 | National Road Championships - Hong Kong — Men Elite - Individual Time Trial | CN | HK | 2026-06-20 | elite | male | itt |
| CN | 77909 | 255712 | National Road Championships - Hong Kong — Men Under 23 - Individual Time Trial | CN | HK | 2026-06-20 | u23 | male | itt |
| CN | 77910 | 267085 | National Road Championships - Israel — Men Under 23 - Individual Road Race | CN | IL | 2026-06-20 | u23 | male | rr |
| CN | 78342 | 260189 | National Road Championships - Benin — Men Elite - Individual Road Race | CN | BJ | 2026-06-21 | elite | male | rr |
| CN | 78342 | 260193 | National Road Championships - Benin — Men Elite - Individual Time Trial | CN | BJ | 2026-06-20 | elite | male | itt |
| CN | 78342 | 260195 | National Road Championships - Benin — Men Under 23 - Individual Time Trial | CN | BJ | 2026-06-20 | u23 | male | itt |
| CN | 78342 | 260198 | National Road Championships - Benin — Women Under 23 - Individual Time Trial | CN | BJ | 2026-06-20 | u23 | female | itt |
| CN | 78920 | 264362 | National Road Championships - Benin (WE) — Women Elite - Individual Road Race | CN | BJ | 2026-06-21 | elite | female | rr |
| CN | 78920 | 264361 | National Road Championships - Benin (WE) — Women Elite - Individual Time Trial | CN | BJ | 2026-06-20 | elite | female | itt |
| CN | 78921 | 264364 | National Road Championships - Hong Kong (WE) — Women Elite - Individual Road Race | CN | HK | 2026-06-21 | elite | female | rr |
| CN | 78921 | 264363 | National Road Championships - Hong Kong (WE) — Women Elite - Individual Time Trial | CN | HK | 2026-06-20 | elite | female | itt |
| CN | 78984 | 264627 | National Road Championships - Kenya — Men Elite - Individual Road Race | CN | KE | 2026-06-21 | elite | male | rr |
| CN | 78984 | 264629 | National Road Championships - Kenya — Women Elite - Individual Road Race | CN | KE | 2026-06-21 | elite | female | rr |
| CN | 78984 | 264631 | National Road Championships - Kenya — Men Elite - Individual Time Trial | CN | KE | 2026-06-20 | elite | male | itt |
| CN | 78984 | 264633 | National Road Championships - Kenya — Men Under 23 - Individual Time Trial | CN | KE | 2026-06-20 | u23 | male | itt |
| CN | 78984 | 264634 | National Road Championships - Kenya — Women Elite - Individual Time Trial | CN | KE | 2026-06-20 | elite | female | itt |
| CN | 78984 | 264636 | National Road Championships - Kenya — Women Under 23 - Individual Time Trial | CN | KE | 2026-06-20 | u23 | female | itt |
| CN | 79023 | 265013 | National Road Championships - Suriname — Women Elite - Individual Road Race | CN | SR | 2026-06-21 | elite | female | rr |
| CN | 79023 | 265015 | National Road Championships - Suriname — Men Elite - Individual Time Trial | CN | SR | 2026-06-20 | elite | male | itt |
| CN | 79023 | 265017 | National Road Championships - Suriname — Women Elite - Individual Time Trial | CN | SR | 2026-06-20 | elite | female | itt |
| CN | 79118 | 265873 | National Championships - Macao SAR — Men Elite - Individual Road Race | CN | MO | 2026-06-21 | elite | male | rr |
| CN | 79118 | 265874 | National Championships - Macao SAR — Men Elite - Individual Time Trial | CN | MO | 2026-06-20 | elite | male | itt |
| CN | 79221 | 266227 | National Road Championships - St. Lucia — Men Elite - Individual Road Race | CN | LC | 2026-06-21 | elite | male | rr |
| CN | 79221 | 266228 | National Road Championships - St. Lucia — Men Elite - Individual Time Trial | CN | LC | 2026-06-20 | elite | male | itt |
| CN | 79257 | 266577 | National Road Championships - Moldavia — Men Elite - Individual Road Race | CN | MD | 2026-06-21 | elite | male | rr |
| CN | 79257 | 266576 | National Road Championships - Moldavia — Men Elite - Individual Time Trial | CN | MD | 2026-06-20 | elite | male | itt |
| CN | 77906 | 255692 | National Road Championships - Belize — Women Elite - Individual Road Race | CN | BZ | 2026-06-21 | elite | female | rr |
| CN | 77906 | 266534 | National Road Championships - Belize — Men Under 23 - Individual Road Race | CN | BZ | 2026-06-21 | u23 | male | rr |
| CN | 77906 | 255686 | National Road Championships - Belize — Women Elite - Individual Time Trial | CN | BZ | 2026-06-19 | elite | female | itt |
| CN | 77906 | 255688 | National Road Championships - Belize — Women Under 23 - Individual Time Trial | CN | BZ | 2026-06-19 | u23 | female | itt |
| CN | 77906 | 255695 | National Road Championships - Belize — Men Under 23 - Individual Time Trial | CN | BZ | 2026-06-19 | u23 | male | itt |
| CN | 78919 | 264360 | National Road Championships - Belize (ME) — Men Elite - Individual Road Race | CN | BZ | 2026-06-21 | elite | male | rr |
| CN | 78919 | 264359 | National Road Championships - Belize (ME) — Men Elite - Individual Time Trial | CN | BZ | 2026-06-19 | elite | male | itt |
| CN | 77905 | 255681 | National Road Championships - Indonesia — Men Under 23 - Individual Road Race | CN | ID | 2026-06-21 | u23 | male | rr |
| CN | 77905 | 255683 | National Road Championships - Indonesia — Women Under 23 - Individual Road Race | CN | ID | 2026-06-21 | u23 | female | rr |
| CN | 77905 | 255678 | National Road Championships - Indonesia — Men Elite - Individual Road Race | CN | ID | 2026-06-20 | elite | male | rr |
| CN | 77905 | 255679 | National Road Championships - Indonesia — Women Elite - Individual Road Race | CN | ID | 2026-06-20 | elite | female | rr |
| CN | 77905 | 255674 | National Road Championships - Indonesia — Men Elite - Individual Time Trial | CN | ID | 2026-06-19 | elite | male | itt |
| CN | 77905 | 255676 | National Road Championships - Indonesia — Women Elite - Individual Time Trial | CN | ID | 2026-06-19 | elite | female | itt |
| CN | 77905 | 255672 | National Road Championships - Indonesia — Men Under 23 - Individual Time Trial | CN | ID | 2026-06-18 | u23 | male | itt |
| CN | 77905 | 255673 | National Road Championships - Indonesia — Women Under 23 - Individual Time Trial | CN | ID | 2026-06-18 | u23 | female | itt |
| CN | 79251 | 266535 | National Road Championships - Iceland — Men Elite - Individual Road Race | CN | IS | 2026-06-20 | elite | male | rr |
| CN | 79251 | 266537 | National Road Championships - Iceland — Women Elite - Individual Road Race | CN | IS | 2026-06-20 | elite | female | rr |
| CN | 79251 | 266539 | National Road Championships - Iceland — Men Elite - Individual Time Trial | CN | IS | 2026-06-18 | elite | male | itt |
| CN | 79251 | 266542 | National Road Championships - Iceland — Women Elite - Individual Time Trial | CN | IS | 2026-06-18 | elite | female | itt |
| CN | 77904 | 255671 | National Road Championships - Slovakia (MU ITT) — Men Under 23 - Individual Time Trial | CN | SK | 2026-06-13 | u23 | male | itt |
| CN | 79021 | 265004 | National Road Championships - Mongolia (MU) — Men Under 23 - Individual Road Race | CN | MN | 2026-05-31 | u23 | male | rr |
| CN | 79021 | 265003 | National Road Championships - Mongolia (MU) — Men Under 23 - Individual Time Trial | CN | MN | 2026-05-30 | u23 | male | itt |
| CN | 78700 | 262876 | National Road Championships - Romania (U23) — Men Under 23 - Individual Road Race | CN | RO | 2026-05-23 | u23 | male | rr |
| CN | 78700 | 262877 | National Road Championships - Romania (U23) — Women Under 23 - Individual Road Race | CN | RO | 2026-05-23 | u23 | female | rr |
| CN | 77880 | 255488 | National Road Championships - Belgium (ITT Junior/U23) — Men Under 23 - Individual Time Trial | CN | BE | 2026-05-01 | u23 | male | itt |
| CN | 77880 | 255490 | National Road Championships - Belgium (ITT Junior/U23) — Women Under 23 - Individual Time Trial | CN | BE | 2026-05-01 | u23 | female | itt |
| CN | 78385 | 260428 | National Road Championships - Panamá — Women Elite - Individual Road Race | CN | PA | 2026-04-26 | elite | female | rr |
| CN | 78385 | 265019 | National Road Championships - Panamá — Men Under 23 - Individual Road Race | CN | PA | 2026-04-26 | u23 | male | rr |
| CN | 78385 | 260421 | National Road Championships - Panamá — Men Under 23 - Individual Time Trial | CN | PA | 2026-04-24 | u23 | male | itt |
| CN | 78385 | 260422 | National Road Championships - Panamá — Women Elite - Individual Time Trial | CN | PA | 2026-04-24 | elite | female | itt |
| CN | 78915 | 264352 | National Road Championships - Panamá (ME) — Men Elite - Individual Road Race | CN | PA | 2026-04-26 | elite | male | rr |
| CN | 78915 | 264351 | National Road Championships - Panamá (ME) — Men Elite - Individual Time Trial | CN | PA | 2026-04-24 | elite | male | itt |
| CN | 78911 | 264237 | National Road Championships - Cyprus ITT MU/WU — Men Under 23 - Individual Time Trial | CN | CY | 2026-04-19 | u23 | male | itt |
| CN | 78911 | 264238 | National Road Championships - Cyprus ITT MU/WU — Women Under 23 - Individual Time Trial | CN | CY | 2026-04-19 | u23 | female | itt |
| CN | 78089 | 258408 | National Road Championships - Kazakhstan (MU/WU IRR) — Men Under 23 - Individual Road Race | CN | KZ | 2026-04-13 | u23 | male | rr |
| CN | 78089 | 258409 | National Road Championships - Kazakhstan (MU/WU IRR) — Women Under 23 - Individual Road Race | CN | KZ | 2026-04-12 | u23 | female | rr |
| CN | 77901 | 255653 | National Road Championships - Egypt — Men Elite - Individual Road Race | CN | EG | 2026-04-25 | elite | male | rr |
| CN | 77901 | 255651 | National Road Championships - Egypt — Men Elite - Individual Time Trial | CN | EG | 2026-04-24 | elite | male | itt |
| CN | 77901 | 255652 | National Road Championships - Egypt — Men Under 23 - Individual Time Trial | CN | EG | 2026-04-24 | u23 | male | itt |
| CN | 77901 | 255646 | National Road Championships - Egypt — Women Elite - Individual Road Race | CN | EG | 2026-04-11 | elite | female | rr |
| CN | 77901 | 255643 | National Road Championships - Egypt — Women Elite - Individual Time Trial | CN | EG | 2026-04-10 | elite | female | itt |
| CN | 77901 | 255645 | National Road Championships - Egypt — Women Under 23 - Individual Time Trial | CN | EG | 2026-04-10 | u23 | female | itt |
| CN | 77900 | 255641 | National Road Championships - United Arab Emirates — Men Elite - Individual Road Race | CN | AE | 2026-04-12 | elite | male | rr |
| CN | 77900 | 255642 | National Road Championships - United Arab Emirates — Men Under 23 - Individual Road Race | CN | AE | 2026-04-12 | u23 | male | rr |
| CN | 77900 | 255638 | National Road Championships - United Arab Emirates — Women Elite - Individual Road Race | CN | AE | 2026-04-11 | elite | female | rr |
| CN | 77900 | 255640 | National Road Championships - United Arab Emirates — Women Under 23 - Individual Road Race | CN | AE | 2026-04-11 | u23 | female | rr |
| CN | 77900 | 255635 | National Road Championships - United Arab Emirates — Men Elite - Individual Time Trial | CN | AE | 2026-04-05 | elite | male | itt |
| CN | 77900 | 255636 | National Road Championships - United Arab Emirates — Men Under 23 - Individual Time Trial | CN | AE | 2026-04-05 | u23 | male | itt |
| CN | 77900 | 255632 | National Road Championships - United Arab Emirates — Women Elite - Individual Time Trial | CN | AE | 2026-04-04 | elite | female | itt |
| CN | 77900 | 255634 | National Road Championships - United Arab Emirates — Women Under 23 - Individual Time Trial | CN | AE | 2026-04-04 | u23 | female | itt |
| CN | 78711 | 262938 | National Road Championships - Bolivia — Men Elite - Individual Road Race | CN | BO | 2026-03-01 | elite | male | rr |
| CN | 78711 | 262931 | National Road Championships - Bolivia — Women Elite - Individual Road Race | CN | BO | 2026-02-28 | elite | female | rr |
| CN | 78711 | 262933 | National Road Championships - Bolivia — Men Elite - Individual Time Trial | CN | BO | 2026-02-27 | elite | male | itt |
| CN | 78711 | 262935 | National Road Championships - Bolivia — Men Under 23 - Individual Time Trial | CN | BO | 2026-02-27 | u23 | male | itt |
| CN | 78711 | 262936 | National Road Championships - Bolivia — Women Elite - Individual Time Trial | CN | BO | 2026-02-27 | elite | female | itt |
| CN | 77996 | 256205 | National Road Championships - Philippines — Women Elite - Individual Road Race | CN | PH | 2026-02-27 | elite | female | rr |
| CN | 77996 | 256208 | National Road Championships - Philippines — Men Elite - Individual Road Race | CN | PH | 2026-02-27 | elite | male | rr |
| CN | 77996 | 256206 | National Road Championships - Philippines — Men Under 23 - Individual Road Race | CN | PH | 2026-02-26 | u23 | male | rr |
| CN | 77996 | 256207 | National Road Championships - Philippines — Women Under 23 - Individual Road Race | CN | PH | 2026-02-26 | u23 | female | rr |
| CN | 77996 | 256198 | National Road Championships - Philippines — Men Elite - Individual Time Trial | CN | PH | 2026-02-24 | elite | male | itt |
| CN | 77996 | 256200 | National Road Championships - Philippines — Men Under 23 - Individual Time Trial | CN | PH | 2026-02-24 | u23 | male | itt |
| CN | 77996 | 256201 | National Road Championships - Philippines — Women Elite - Individual Time Trial | CN | PH | 2026-02-24 | elite | female | itt |
| CN | 77996 | 256203 | National Road Championships - Philippines — Women Under 23 - Individual Time Trial | CN | PH | 2026-02-24 | u23 | female | itt |
| CN | 77899 | 255625 | National Road Championships - Namibia — Men Elite - Individual Road Race | CN | NA | 2026-02-08 | elite | male | rr |
| CN | 77899 | 255628 | National Road Championships - Namibia — Women Elite - Individual Road Race | CN | NA | 2026-02-08 | elite | female | rr |
| CN | 77899 | 255619 | National Road Championships - Namibia — Men Elite - Individual Time Trial | CN | NA | 2026-02-06 | elite | male | itt |
| CN | 77899 | 255621 | National Road Championships - Namibia — Men Under 23 - Individual Time Trial | CN | NA | 2026-02-06 | u23 | male | itt |
| CN | 77899 | 255622 | National Road Championships - Namibia — Women Elite - Individual Time Trial | CN | NA | 2026-02-06 | elite | female | itt |
| CN | 77899 | 255624 | National Road Championships - Namibia — Women Under 23 - Individual Time Trial | CN | NA | 2026-02-06 | u23 | female | itt |
| CN | 77897 | 255603 | National Road Championships - Zimbabwe — Men Elite - Individual Road Race | CN | ZW | 2026-02-07 | elite | male | rr |
| CN | 77897 | 255605 | National Road Championships - Zimbabwe — Women Elite - Individual Road Race | CN | ZW | 2026-02-07 | elite | female | rr |
| CN | 77897 | 255598 | National Road Championships - Zimbabwe — Men Elite - Individual Time Trial | CN | ZW | 2026-02-05 | elite | male | itt |
| CN | 77897 | 255600 | National Road Championships - Zimbabwe — Men Under 23 - Individual Time Trial | CN | ZW | 2026-02-05 | u23 | male | itt |
| CN | 77897 | 255601 | National Road Championships - Zimbabwe — Women Elite - Individual Time Trial | CN | ZW | 2026-02-05 | elite | female | itt |
| CN | 77895 | 255583 | National Road Championships - Thailand — Women Elite - Individual Road Race | CN | TH | 2026-01-18 | elite | female | rr |
| CN | 77895 | 260643 | National Road Championships - Thailand — Men Under 23 - Individual Road Race | CN | TH | 2026-01-18 | u23 | male | rr |
| CN | 77895 | 260644 | National Road Championships - Thailand — Women Under 23 - Individual Road Race | CN | TH | 2026-01-18 | u23 | female | rr |
| CN | 77895 | 255576 | National Road Championships - Thailand — Men Under 23 - Individual Time Trial | CN | TH | 2026-01-16 | u23 | male | itt |
| CN | 77895 | 255577 | National Road Championships - Thailand — Women Elite - Individual Time Trial | CN | TH | 2026-01-16 | elite | female | itt |
| CN | 77895 | 255579 | National Road Championships - Thailand — Women Under 23 - Individual Time Trial | CN | TH | 2026-01-16 | u23 | female | itt |
| CN | 78196 | 258996 | National Road Championships - Thailand (ME) — Men Elite - Individual Time Trial | CN | TH | 2026-01-18 | elite | male | itt |
| CN | 78196 | 258995 | National Road Championships - Thailand (ME) — Men Elite - Individual Road Race | CN | TH | 2026-01-16 | elite | male | rr |

