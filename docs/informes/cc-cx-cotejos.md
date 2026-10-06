# CC-CX — cotejos oficiales F5

Goal cerrado de momento por Dani el 13-09-2026, con F5 incompleta y diferida. El [traspaso, sección 81](../plans/cerrados/cc-cx-traspaso-f5-f6.md#81-cierre-temporal-del-goal-y-pendientes-para-retomar), reúne los pendientes, evidencia necesaria y procedimiento para una futura reanudación explícita. Este registro conserva los cotejos y sus diferencias; no continuar automáticamente las búsquedas.

Los cotejos históricos de este documento se ejecutan offline. No crean carreras, torneos, fichas ni resultados en Supabase, no activan ingesta histórica y no habilitan reglamentos 2026–27. Un cotejo local tampoco acredita el flujo completo del VPS con una manga real autorizada.

## Copa del Mundo MJ 2025–26

Fuente: [resultados](https://www.ucicyclocrossworldcup.com/en/results) y [generales oficiales](https://www.ucicyclocrossworldcup.com/en/ranking). El [manifiesto versionado](../../js/__tests__/fixtures/cx-cotejos/worldcup-2025-26-mj.json) conserva las filas íntegras, URL exacta y SHA-256 de cada PDF. La general final es un informe independiente de los resultados de las seis rondas.

| Informe | Fecha | Filas |
| --- | --- | --- |
| Tábor, PDF 435 | 2025-11-23 | 65 |
| Flamanville, PDF 445 | 2025-11-30 | 39 |
| Koksijde, PDF 461 | 2025-12-21 | 78 |
| Dendermonde, PDF 467 | 2025-12-28 | 77 |
| Benidorm, PDF 476 | 2026-01-18 | 39 |
| Hoogerheide, PDF 483 | 2026-01-25 | 55 |
| General final, PDF 436 | 2026-01-25 | 48 |

Hay 353 filas de ronda y 128 identidades locales. Los identificadores hash locales no son fichas del catálogo. El alias BROWN Melvin Ethan → BROWN Ethan, USA/2008, se limita a este cotejo y se apoya en las celdas de ronda de la general. No acredita fecha completa de nacimiento, licencia ni una unión de fichas.

Ejecución reproducible desde el repositorio, sin red ni BD:

```sh
node scripts/cx/cx-worldcup-cotejo.mjs
```

El motor v2 con las políticas anteriores por defecto deja 85 empates adyacentes sin resolver. La hipótesis `pointsEligibilityPolicy=awardedAtLeastOnce` y `latestRoundPointsPolicy=backwardsUntilDifferent` reproduce los 48 totales, 288 celdas y 48 puestos oficiales, tanto con `droppedPlacingsPolicy=all` como con `retained`.

La conclusión es `inconclusive_both_candidates_match`. Este ejemplo no discrimina qué puestos de rondas descartadas cuentan. El script deriva la conclusión de los cotejos: una diferencia en la general o sus celdas impide anunciar coincidencia. El informe incluye estados, incidencias, totales/celdas revisados y diferencias de cada candidato; código 2 si alguno no coincide íntegramente.

La comparación de rondas hacia atrás es una inferencia de esta general. No constituye un texto reglamentario universal ni autoriza extrapolar a categorías o ediciones distintas. La [Parte V UCI 01.07.2026](https://assets.ctfassets.net/761l7gh5x5an/3X0PPNdbWNAhMGaZzKly8J/c1ffde19720611fa2fddae4e4601845b/5-CRO-20260701-E.pdf), art. 5.3.013, conserva escala y descartes juveniles, pero no resuelve la ambigüedad por este cotejo. La sección 77 aporta un caso discriminante MU 2019–20 con una escala antigua; no convierte este cotejo MJ en discriminante ni activa reglas actuales.

## Copa del Mundo WU derivada, 2025–26

El [manifiesto WU](../../js/__tests__/fixtures/cx-cotejos/worldcup-2025-26-wu.json) conserva las 752 filas WE de doce rondas, los estados del PDF y los nacimientos completos de DataRide. No crea manga WU ni fichas en BD. Las 153 identidades hash son locales; `verified` solo se asigna a la hipótesis en memoria tras exigir la evidencia de nacimiento del manifiesto. Los puestos, dorsales, nombres, nacionalidad y año se contrastaron entre cada PDF y DataRide; cuatro variantes de nombre se documentan como correspondencias locales de fuente. Los alias que unen filas/general tampoco modifican el catálogo.

| Ronda | Fecha | PDF | Filas WE |
| --- | --- | --- | --- |
| Tábor | 2025-11-23 | 441 | 56 |
| Flamanville | 2025-11-30 | 448 | 46 |
| Terralba | 2025-12-07 | 451 | 29 |
| Namur | 2025-12-14 | 452 | 50 |
| Antwerpen | 2025-12-20 | 459 | 81 |
| Koksijde | 2025-12-21 | 464 | 71 |
| Gavere | 2025-12-26 | 466 | 68 |
| Dendermonde | 2025-12-28 | 470 | 89 |
| Zonhoven | 2026-01-04 | 474 | 64 |
| Benidorm | 2026-01-18 | 479 | 65 |
| Maasmechelen | 2026-01-24 | 481 | 61 |
| Hoogerheide | 2026-01-25 | 486 | 72 |

Las URL exactas/SHA-256 de los PDF y los identificadores de Results DataRide están en cada ronda. `normalizedDataRideSha256` corresponde al documento normalizado guardado localmente por el fetcher, no al JSON crudo del servidor. Se conservan esos documentos en `/tmp/cc-cx-worldcup-cotejo/next/`. En 127 filas el PDF acredita LAP mientras DataRide conserva el puesto y deja tiempo/IRM vacíos; el cotejo usa el estado del PDF. No se inventan tiempos ni se afirma que DataRide los haya publicado.

La [Parte V UCI 01.07.2025](https://assets.ctfassets.net/761l7gh5x5an/3X0PPNdbWNAhMGaZzKly8J/7cfe482b94626424f9967d6df5cb3f38/5-CRO-20250701-E.pdf), artículos 5.1.001/5.3.023, define WU por edades 19–22 en el año final de la temporada dentro de la competición femenina. El asterisco de los PDF también marca juveniles de 2008; no sustituye ese intervalo. El cálculo conserva el puesto WE para otorgar puntos, sin renumerar las participantes WU en cada manga.

La fuente independiente del cotejo es la [general WE final, PDF 442](https://www.ucicyclocrossworldcup.com/storage/rankings/file_results/442/442.pdf?t=1769348896): 63 filas publicadas, de las que 22 cumplen 19–22. El esperado conserva sus totales y orden relativo. No se presenta ese filtrado como una general WU separada publicada por el organizador. La cabecera resumida HTML discrepa del total Fouquenet; el manifiesto conserva el informe PDF completo, no el resumen.

```sh
node scripts/cx/cx-worldcup-cotejo.mjs WU
```

Con las hipótesis de elegibilidad/desempate ya descritas, el motor reproduce los 22 totales y los 22 puestos relativos; coinciden 263 de 264 celdas. La discrepancia restante es Sarkisov Katherine en la octava ronda: el [PDF de Dendermonde](https://www.ucicyclocrossworldcup.com/storage/rankings/file_results/470/470.pdf?t=1766929995) y DataRide acreditan puesto 55, mientras la general final muestra `0 (56)`. Ambos puestos valen cero y no intervienen en los recuentos de puestos premiados. No se altera ninguna publicación para forzar coincidencia: `derivedCategoryMatches=false` y el CLI devuelve 2. `droppedPlacingsPolicyConclusion=not_applicable_no_drops`; WU no tiene descartes en esta referencia.

El cotejo completo WU sigue abierto por esa celda contradictoria. No activar una edición 2026–27 a partir de estos hechos históricos. Una identidad/nacimiento sin verificar sigue impidiendo el cálculo del motor, también para una participante WE que finalmente quede fuera de WU.

## Búsqueda adicional de descartes

Se inspeccionaron cinco generales oficiales adicionales y sus grupos de igualdad de puntos. La búsqueda compara recuentos de puestos premiados con todas las rondas o las cuatro retenidas y, después, los puntos desde la última ronda hacia atrás. En los 43 grupos empatados ambas hipótesis dan el mismo orden publicado.

| Temporada/categoría | Informe oficial | Filas | Grupos empatados |
| --- | --- | --- | --- |
| 2025–26 WJ | [PDF 438](https://www.ucicyclocrossworldcup.com/storage/rankings/file_results/438/438.pdf?t=1769336690) | 49 | 9 |
| 2025–26 MU | [PDF 440](https://www.ucicyclocrossworldcup.com/storage/rankings/file_results/440/440.pdf?t=1769342572) | 46 | 6 |
| 2024–25 MU | [PDF 389](https://www.ucicyclocrossworldcup.com/storage/rankings/file_results/389/389.pdf?t=1737896048) | 50 | 10 |
| 2024–25 MJ | [PDF 391](https://www.ucicyclocrossworldcup.com/storage/rankings/file_results/391/391.pdf?t=1737884088) | 52 | 10 |
| 2024–25 WJ | [PDF 390](https://www.ucicyclocrossworldcup.com/storage/rankings/file_results/390/390.pdf?t=1737895729) | 45 | 8 |

El registro de búsqueda `worldcup-drop-search-2024-26.json`, con alcance, URL y SHA-256, se retiró del repositorio el 2026-09-29 por no tener lector; se recupera del historial de git (`a03301dba8c`). Esta búsqueda usa celdas de la propia general para localizar un caso discriminante; no es un cotejo contra resultados independientes de ronda. No añade categorías verificadas ni resuelve la política de descartes.

### Ampliación 2021–24

El segundo registro, `worldcup-drop-search-2021-24.json` (retirado el 2026-09-29; historial de git, `a03301dba8c`), conservaba nueve informes adicionales enlazados por la página oficial de generales, sus fechas de cabecera, número de celdas por fila, URL y SHA-256. En MU/MJ/WJ 2023–24, PDF 341/369/371, hay seis rondas; en MU/MJ/WJ 2022–23, PDF 255/251/252, cinco. Sus 64 grupos empatados tampoco distinguen las políticas `all` y `retained`: ambas reproducen el orden publicado con la hipótesis de comparación de puntos hacia atrás.

Los informes 177/175/176 de 2021–22 tienen cabecera 16-01-2022 y solo cuatro celdas de ronda por fila. Se registran como generales intermedias, sin descartes aplicables. No se presentan como una general final ni se suman a los ejemplos que prueban rondas descartadas. En los nueve informes no aparecen grupos aún empatados bajo las claves examinadas; esto no sustituye resultados independientes ni verifica una política universal.

## Superprestige ME/WE 2025–26

Fuentes independientes: los resultados de ocho mangas por categoría enlazados en [Uitslagen](https://www.superprestigecyclocross.be/nl/uitslagen) y los informes finales completos enlazados en [Klassement](https://www.superprestigecyclocross.be/nl/klassement). El [reglamento oficial 2025–26](https://www.superprestigecyclocross.be/nl/reglement) establece escala 15…1, suma de todas las rondas y desempates por participaciones, victorias y puesto de la última prueba. Los manifiestos [ME](../../js/__tests__/fixtures/cx-cotejos/superprestige-2025-26-me.json) y [WE](../../js/__tests__/fixtures/cx-cotejos/superprestige-2025-26-we.json) conservan URL/SHA-256 de cada PDF y todos los puestos, dorsales, nombres, nacionalidades y estados necesarios. Omiten licencias, nacimientos y tiempos que no intervienen en el cálculo por puntos.

| Ronda | Fecha | Filas ME | Filas WE |
| --- | --- | --- | --- |
| Ruddervoorde | 2025-10-19 | 62 | 36 |
| Overijse | 2025-10-26 | 46 | 32 |
| Niel | 2025-11-11 | 38 | 24 |
| Merksplas | 2025-11-15 | 37 | 35 |
| Heusden-Zolder | 2025-12-23 | 86 | 63 |
| Diegem | 2025-12-30 | 80 | 77 |
| Gullegem | 2026-01-03 | 76 | 38 |
| Middelkerke | 2026-02-07 | 37 | 34 |

Se comprueban fecha del informe, número total de participantes, dorsales únicos, secuencia íntegra de puestos y recuentos DNF/DNS. ME incluye 462 filas, 41 DNF y un DNS; WE, 339 filas, 16 DNF y tres DNS. LAP conserva el puesto publicado; DNF/DNS conservan puesto NULL. La errata `HLADÍKOVÁ Kateina` se une exclusivamente en el cotejo con `Katerina Hladikova`: los tres resultados comparten UCI ID 10047765309 y el [informe UEC independiente](https://www.uec.ch/resources/2025%20Events/cyclocross%20middelkerke/lists/res/54_Result_Wom_U23.pdf) acredita ese identificador y el nombre. El alias documenta fuentes y dorsales, sin modificar fichas.

```sh
node scripts/cx/cx-superprestige-cotejo.mjs ME
node scripts/cx/cx-superprestige-cotejo.mjs WE
```

Con la hipótesis offline `pointsEligibilityPolicy=awardedAtLeastOnce`, coinciden los 38 totales/304 celdas ME y los 51 totales/408 celdas WE. La referencia versionada permanece inactiva y no se guarda ningún esquema `verified`. El motor deja un empate ME y ocho empates adyacentes WE sin resolver; por ello no devuelve filas clasificadas. Además, la general PDF deja sin número 11 filas ME y 22 WE dentro de grupos de igualdad de puntos. El esperado conserva `publishedRank=null`; no inventa puestos ordinales ni atribuye puestos compartidos. `pointsAndCellsMatch=true`, `generalMatches=false`, `status=needs_review` y ambos CLI devuelven 2. El cotejo íntegro de general sigue abierto por el orden, aunque todos los puntos coincidan.

La cabecera resumida HTML femenina muestra 92/92 para Van Alphen y Fouquenet; el PDF final y la suma de los ocho resultados independientes dan 91/91. Se conserva esa discrepancia de fuentes. No se sustituye un total para forzar coincidencia. Los PDF, extracciones y salidas del cotejador permanecen en `/tmp/cc-cx-superprestige-cotejo/`. La ejecución reproducible del repositorio usa únicamente hechos versionados, sin red, BD ni ingesta histórica.

## X2O — nueva lectura de enlaces oficiales

La consulta del 12-09-2026 sigue el enlace real de [Uitslagen](https://x2otrofee.be/uitslagen/) a [Uitslagen Vlaamse Duinencross 2025](https://x2otrofee.be/uitslagen/uitslagen-vlaamse-duinencross-2025/). La página contiene bonos de resumen, pero mezcla metadatos publicados en diciembre de 2024, descripción de resultados de enero de 2025 y una tabla con caché fechada noviembre de 2025 y tiempos distintos. No acredita una manga concreta 2025–26 ni separa los tres premios de sprint y los tres de vuelta rápida. El HTML de lectura permanece en `/tmp/cc-cx-x2o-linked-results.html`. Los bonos siguen desconocidos; no se sustituyen por cero ni se deducen por diferencia respecto a la general.

## X2O ME — ocho rondas con bonos, 2025–26

La nueva lectura de solo HTTP público localiza el informe concreto enlazado por [Rapencross](https://rapencrosslokeren.be/renners/) mediante su redirección oficial ACN, evento 2141578068095976/contexto 20251102_x2o. Los índices públicos ACN de las ocho fechas oficiales confirman nombre de prueba y edición. Sus tablas Results, Best lap y Ranking se consultan sin autenticación, revisión visual ni ejecución de la web. El [manifiesto ME](../../js/__tests__/fixtures/cx-cotejos/x2o-2025-26-me.json) conserva URL/SHA-256, cabeceras, todos los puestos/dorsales/identificadores UCI necesarios, estados, tiempos de meta, puestos de la primera vuelta, vuelta rápida y la general final independiente. Las identidades hash solo enlazan el mismo UCI ID dentro del cotejo, sin fichas o uniones de catálogo.

| Ronda | Fecha | Filas de resultado |
| --- | --- | --- |
| Koppenbergcross | 2025-11-01 | 36 |
| Rapencross | 2025-11-02 | 35 |
| Flandriencross | 2025-11-16 | 30 |
| Plage Cross | 2025-12-22 | 40 |
| Azencross | 2025-12-29 | 52 |
| GP Sven Nys | 2026-01-01 | 35 |
| Krawatencross | 2026-02-08 | 37 |
| Brussels Universities Cyclocross | 2026-02-15 | 26 |

Hay 291 filas: 188 tiempos de meta, 79 LAP con puesto, 20 DNF y cuatro DNS. El campo Temps del cronometraje contiene tiempos parciales para LAP/DNF y 0:00 para DNS; no se convierte en tiempo de meta. Esos estados conservan finishSeconds=NULL.

Los tres bonos de sprint se obtienen del puesto acumulado publicado al terminar la primera vuelta, aplicando art. 5; los tres de vuelta rápida, de los puestos explícitos de Best lap. No se deducen por diferencia de general ni por puesto de meta. Siete informes tienen una sección adicional anterior a las vueltas; Bruselas tiene nueve secciones/nueve vueltas. La sección de primera vuelta se determina con esos recuentos antes de comprobar el total de bonos. Best lap excluye la vuelta inicial y conserva milésimas y número de vuelta, sin premios duplicados por corredor. Los 48 premios aplicados suman 60 segundos por ronda y coinciden con los 37 totales Bonif explícitos. Las celdas Bonif NULL se conservan: un agregado cero se establece únicamente después de identificar los seis premios completos, no por convertir NULL en cero.

```sh
node scripts/cx/cx-x2o-cotejo.mjs
```

Bonos coincidentes en las ocho rondas, pero la general íntegra sigue abierta: coinciden 110/111 totales y 887/888 celdas. Tom Meeusen gana cinco segundos en el sprint de Hamme y después abandona; Results publica Bonif 0:05, mientras la general conserva 1:06:13, ganador +300 sin restarlos. La hipótesis del motor los resta y obtiene 1:06:08. El art. 4 describe esos cinco minutos como «zonder […] bonificaties»; el cotejo registra la diferencia y requiere revisar la política de bonos ante forfaits, sin modificar la regla para forzar coincidencia.

El informe final Ranking incluye 53 participantes que no terminan ninguna ronda dentro de cinco minutos; art. 8 y el motor los excluyen. El motor devuelve 58 filas elegibles y coinciden 55 puestos/tiempos. Suárez Fernández y Agostinacchio empatan en 8:38:15: el informe publica 40/41, frente a 41/40 del motor por mejor puesto 19/18. No se inventan fracciones de tiempo ni se utiliza el orden de fuente para reemplazar un desempate. Estas diferencias de elegibilidad/orden y la celda Meeusen impiden generalMatches; status=needs_review y exit 2.

Se conserva esta evidencia de ME sin activar una edición o extrapolar a WE/MU/2026–27. Las referencias permanecen inactivas y verified solo existe en memoria del cotejador. No hay ingesta histórica, corrección de fuentes ni escrituras en BD/VPS. HTML, JSON oficiales, reglamento PDF/texto y report.json permanecen en /tmp/cc-cx-x2o-source-read/; npm.log registra las comprobaciones. La reproducción versionada es offline.

Publicación del cotejo X2O ME: c90ed7771ec92e8c4cb306b92d0e28eb8b4bdde1 en main, Pages 34723345815 completado con success. El avance no modifica assets de producto ni código nativo.

## Copa de España — Alcobendas 2025, puestos y puntos de ronda

La [página oficial del organizador](https://www.cxalcobendas.com/p/clasificaciones_3.html) enlaza los resultados de 2025 en Sportradio. El índice público `pdfs.js` identifica los informes de clasificación Élite, Élite femenina, Junior y Junior femenina, fechados 16-11-2025. Son fuentes independientes de las generales RFEC [Élite–Sub23](https://rfec.com/es/smartweb/seccion/clasificacionescircuito/rfec/2025/25COPACX/4678-ELITE-SUB23), [femenina Élite–Sub23](https://rfec.com/index.php/es/smartweb/seccion/clasificacionescircuito/rfec/2025/25COPACX/4684-FEM-ELITE-SUB23), [Junior](https://rfec.com/index.php/es/smartweb/seccion/clasificacionescircuito/rfec/2025/25COPACX/4716-JUNIOR) y [Junior femenina](https://rfec.com/index.php/es/smartweb/seccion/clasificacionescircuito/rfec/2025/25COPACX/4686-FEM-JUNIOR), publicadas como provisionales el 09-12-2025. En cada general se identifica Alcobendas por el título de la columna P5, sin asignar columnas por posición supuesta.

El [manifiesto](../../js/__tests__/fixtures/cx-cotejos/copa-espana-alcobendas-2025.json) conserva los hechos necesarios, URL exactas y hashes de PDF/HTML. Incluye las 38/23/52/19 filas enumeradas en los cuatro informes y las tablas RFEC completas con sus ocho celdas. Las celdas vacías permanecen NULL: no se identifican con puntos cero ni con una no salida. Los PDF indican 6/1/3/1 DNS sin listar sus dorsales; no se añaden filas desde inscritos ni por diferencia de recuentos. La cabecera femenina indica 24 participantes frente a 22 clasificados y un DNF enumerados; se conserva la cabecera original sin normalizar su definición de participantes.

```sh
node scripts/cx/cx-copa-espana-cotejo.mjs
```

El cotejador usa el motor y la escala RFEC 25/20/16/14/12/10/9/8/7/6/5/4/3/2/1 con evidencia `officialCategory` del PDF. Coinciden los puntos de los quince premiados en cada categoría con P5, sin participantes premiados ausentes o ajenos. El puesto del informe Élite–Sub23 es el de la categoría de competición RFEC: Mira obtiene 20 puntos por el segundo puesto; López Burgos, 14 por el cuarto femenino. No se filtran ni renumeran licencias S23 dentro de esos informes. Los artículos 4/7 del [reglamento RFEC 09.09.2025](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/menu/123/doc_68c7c0ddc9db25_29075634_5-Pruebas-de-Ciclo-Cross--ap-CD-20250909_b_IZDA.pdf) y esas columnas acreditan este alcance de competición; no una correspondencia con eventos separados ME/MU de DataRide ni una general sub23 independiente.

`roundPointsMatch=true` para las cuatro categorías; `fullSeasonGeneralMatches=false`, `sanctionCotejoMatches=false`, `status=partial` y exit 2. No se utilizan las otras siete columnas para simular resultados independientes ni para cotejar el orden final. El art. 15 establece -25 por incumplimiento del maillot; estas fuentes no contienen un informe de una sanción particular y no acreditan un ajuste real. La guardia del motor conserva el requisito de fuente/motivo para cualquier ajuste; este cotejo no la sustituye. Esquemas `verified` e identidades hash solo existen en memoria local, sin ingesta histórica, fichas o escrituras.

Se conservan PDFs, HTML, XML público de lectura, índice de PDFs, extracciones y salida en `/tmp/cc-cx-copa-espana-cotejo/`. No se ejecuta la web de resultados ni se realiza revisión visual. La ampliación a las otras rondas se registra a continuación; el alcance de categorías/ajustes continúa pendiente antes de cerrar el criterio Copa de España.

## Copa de España — ocho rondas independientes, 2025

El [manifiesto de temporada](../../js/__tests__/fixtures/cx-cotejos/copa-espana-2025.json) amplía Alcobendas con resultados independientes de las otras siete rondas. Conserva fuentes exactas PDF/HTML, SHA-256, fechas del [calendario RFEC](https://rfec.com/index.php/es/smartweb/seccion/circuito/rfec/25COPACX), títulos de las ocho columnas de la general y todas las filas enumeradas de las cuatro categorías oficiales RFEC. No convierte esas categorías de competición en eventos separados de DataRide. Los nombres se comparan solo mediante normalización de acentos, comas, mayúsculas y orden de palabras; no se añaden alias ni uniones de fichas.

| Ronda | Fecha | Filas ME | Filas WE | Filas MJ | Filas WJ |
| --- | --- | --- | --- | --- | --- |
| Gijón | 2025-10-05 | 69 | 23 | 81 | 29 |
| Xaxan | 2025-10-12 | 55 | 24 | 55 | 14 |
| Amurrio | 2025-11-01 | 78 | 37 | 87 | 34 |
| Karrantza | 2025-11-02 | 68 | 34 | 79 | 31 |
| Alcobendas | 2025-11-16 | 38 | 23 | 52 | 19 |
| Vic | 2025-11-23 | 54 | 30 | 36 | 15 |
| Xàtiva | 2025-12-06 | 51 | 31 | 62 | 19 |
| Cocentaina | 2025-12-07 | 43 | 28 | 55 | 18 |

Gijón procede de los cuatro informes federativos enlazados por el Ayuntamiento; Amurrio/Karrantza, de los informes completos enlazados por la federación vasca. Xaxan usa las cuatro tablas de clasificación definitiva de la federación gallega; sus enlaces y categorías se obtienen del selector público real. Vic/Xàtiva/Cocentaina proceden de los cuatro informes por prueba enlazados en las noticias de resultados RFEC. Se conservan solo las categorías del cotejo; no se incorporan máster o cadetes de los PDF conjuntos.

```sh
node scripts/cx/cx-copa-espana-season-cotejo.mjs
```

| Categoría RFEC | Totales coincidentes | Celdas explícitas coincidentes | Celdas sin valor publicado |
| --- | --- | --- | --- |
| Élite–Sub23 masculina | 51/51 | 183/183 | 225 |
| Élite–Sub23 femenina | 39/39 | 152/152 | 160 |
| Junior masculina | 50/50 | 212/212 | 188 |
| Junior femenina | 34/35 | 138/139 | 141 |

Los NULL no se contabilizan como ceros coincidentes ni como DNS. Un premio calculado sin celda publicada se informa como diferencia. Los resúmenes que indican DNS sin dorsales conservan ese número sin fabricar filas. Vic imprime `+` en ciertas diferencias sin código LAP explícito; se conserva el puesto, sin atribuir un estado desde ese signo. Xaxan imprime posiciones de listado para DNF; `sourcePosition` conserva esa posición y el motor recibe puesto NULL.

La discrepancia Junior femenina corresponde a Carla Vilouta en Xaxan: la tabla federativa la indica DNF en posición de listado 14 y el [PDF RFEC independiente](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/noticia/60610/documentos/doc_68ebea989041c9_97491890_imagen_RESULTADO-JUNIOR-FEM.pdf) publica trece clasificadas y su DNF, dorsal 14. La general provisional RFEC le asigna dos puntos en P2 y total dos. El manifiesto conserva ambas publicaciones; no atribuye puesto 14 a la retirada ni añade un ajuste para reproducir los puntos.

El art. 8 de RFEC desempata por la última prueba disputada. Aplicado a las ocho rondas, el motor mantiene empates entre participantes sin plaza comparable en Cocentaina: 12/4/7/4 incidencias ME/WE/MJ/WJ. No devuelve filas ordenadas y no se sustituye ese orden por nombre, ID o posición de la fuente. `pointsAndKnownCellsMatch=true` solo en ME/WE/MJ; `fullSeasonGeneralMatches=false` en las cuatro categorías y exit 2. También permanecen falsos los criterios de sanción particular y correspondencia con eventos separados DataRide. Las referencias de puntuación no se activan.

PDF, HTML, extracciones, índices de enlaces, contraste WJ y salida del runner se conservan en `/tmp/cc-cx-copa-espana-cotejo/next/`. La reproducción versionada no necesita red, BD, revisión visual ni ejecución nativa. El cotejo amplía la evidencia de las ocho rondas; sigue abierto el criterio completo de general, categorías y ajustes.

## Estado de los criterios restantes

| Criterio del plan, secciones 7/9 | Estado |
| --- | --- |
| C1/C2 real, resultado de categoría y general por puntos | Alcobendas C2 ME 2025–26: coinciden las 38 filas nombradas, 26 tiempos de meta, nueve LAP y tres DNF. DNS no enumerados por el PDF impiden cotejar todos los participantes; general por puntos pendiente. Se conserva el tiempo discrepante de Waaslandcross |
| Copa del Mundo, descartes juveniles | Totales/celdas/orden MJ cotejados, compatibles con ambas políticas. El caso MU 2019–20 distingue all, solo para esa edición antigua; revisión de la edición actual pendiente |
| Copa del Mundo, WU derivada | Nacimientos completos y 22 totales/orden relativo cotejados desde WE; 263/264 celdas, una contradicción oficial conserva el cotejo íntegro abierto; sin manga WU |
| Superprestige, puntos, DNF/DNS y general | Ocho mangas independientes ME/WE; todos los totales/celdas coinciden. Auditoría de las 56 etiquetas impresas de puesto aun con empates: 45 coinciden con una posición individual calculable, nueve quedan fuera del intervalo y dos son indeterminadas bajo esa interpretación. Otras 33 etiquetas están vacías. Orden íntegro pendiente de interpretación oficial del formato y resolución de empates |
| Copa de España, puestos oficiales de categoría y sanciones | Ocho rondas RFEC y ocho catálogos/resultados DataRide localizados. Correspondencia agrupada ME/WE de Alcobendas cotejada sin renumerar por edad; todos los totales/celdas explícitas ME/WE/MJ coinciden. WJ conserva la contradicción DNF/dos puntos RFEC; orden íntegro, diferencias de otras rondas y ajustes particulares pendientes |
| X2O, tiempo/bonos/forfaits/elegibilidad y general | Ocho rondas ME/WE/MU con 48 premios por categoría y totales Bonif cotejados. Política discard cotejada con tres DNF: ME 111/111 totales, 888/888 celdas; MU 189/189 y 1512/1512; WE 181/181 y 1448/1448 tras alias Hamme revisado por nacimiento completo/nacionalidad y fila licenciada Lille. Elegibilidad y orden conservan las generales abiertas |
| Flujo VPS con una manga real revisada | Pendiente; una pasada noop no cumple este criterio |

F5 permanece abierta. Mantener `CX_TAB_ENABLED=false`, sin avisos de prueba ni releases de tiendas.

## C2 — Waaslandcross ME 2025–26, fuente independiente

La [página de resultados del organizador](https://hgcross.be/uitslagen/) enlaza Sint-Niklaas 14-02-2026 con el [informe ACN de élite masculina](https://www.acn-timing.com/?lng=EN#/events/2152959731400385/ctx/20260214_exact/generic/197998_31/home/RES31). Se consulta visualmente la tabla íntegra: 33 registros, 32 puestos, 28 tiempos absolutos, cuatro LAP con puesto y un DNF sin puesto. DataRide competición 75880, temporada 455, evento 352614 devuelve 33 filas normalizadas.

Los 33 dorsales, nombres y puestos coinciden. Los cuatro LAP conservan puesto y vueltas; solo se normaliza el plural LAP/LAPS para comparar. DNF conserva puesto y tiempo NULL. Coinciden 27 de los 28 tiempos absolutos: Victor Van de Putte, dorsal 14/puesto 9, tiene 57:53 (+0:38) en ACN y 0:57:51 (+36) en DataRide. No se elige una fuente para corregir otra ni se infiere un tiempo; falta comprobar el informe final del jurado. Esto no coteja una general por puntos ni acredita flujo VPS real.

Evidencias locales conservadas en `/tmp/cc-cx-worldcup-cotejo/c2/`: `waaslandcross-acn-me.json` transcrito de la tabla visible, `75880-me.json` salida del fetcher y `report.json`. Reproducción local: `node /tmp/cc-cx-worldcup-cotejo/compare-c2.mjs`, exit 2 por la discrepancia conservada. SHA-256 del documento de hechos ACN `0e476e634f37228c1073fa7c3f773b1e28fb8ff18da4547cc06114079fe3b6f0`; normalizado DataRide `682ae4317e07bca0c447ea3484689ae02362c2da0d86e5c1dfc3003a77b426dc`. No son hashes de PDF ni de una captura remota. No se escribe Supabase ni se activan datos históricos.

El [manifiesto versionado](../../js/__tests__/fixtures/cx-cotejos/waaslandcross-2025-26-me.json) conserva los 33 hechos ACN y una proyección de los campos DataRide necesarios para el cotejo, con los SHA-256 de los documentos originales anteriores. Se omiten nacimientos, equipos e identificadores de resultado que no intervienen en esta comparación. Reproducción desde cualquier checkout: `node scripts/cx/cx-results-cotejo.mjs`; devuelve `needs_review` y exit 2 con la única diferencia 3473/3471 segundos. Exit 0 solo indica coincidencia offline; exit 1 identifica un manifiesto inválido. El cotejador detecta dorsales duplicados/ausentes/ajenos aunque coincida el recuento, conflictos del normalizador y tiempo cero indebidamente asignado a LAP/DNF. No realiza descargas, enlazado de fichas, oficialización ni escrituras.

La lectura HTTP pública directa de ACN confirma los 33 registros C2 de Waaslandcross y conserva 57:53 para el dorsal 14. URL/SHA-256/fecha se añaden al manifiesto C2 como publicApiReadEvidence; el índice CMS ofrece solo Results, sin informe final de jurado. No resuelve la diferencia 3473/3471 con DataRide ni sustituye las evidencias originales. JSON oficiales conservados en /tmp/cc-cx-x2o-source-read/.

## C2 — Canmore 2026–27, preflight de una manga actual

Lecturas del 12-09-2026, aproximadamente 20:29 UTC. El calendario propio conserva Canmore, C2, Canadá, 12-09-2026, temporada 2026–27, carrera publicada a43c1586-c279-4c96-a68a-06f631927acc y categorías ME/WE/MJ/WJ. Todavía no tiene enlace DataRide, timezone, salidas ni fuentes de programa. No se modifica la carrera.

El [organizador](https://www.rundlemountaincyclingclub.com/canmore-cx-c2) y [Cycling Canada](https://cyclingcanada.ca/event/canmore-cx-c2-drie-zussen-superprestige/) enlazan la misma [guía técnica oficial de 2026](https://docs.google.com/document/d/1GwXyS3qT9_KWvqlQghDbDSjEtPvWgoDcCF7Z4327f_E/edit?usp=sharing). Se lee su exportación Markdown desde el documento público, sin editarlo: fecha 12–13 de septiembre, Mountain Time y programa del sábado MJ 12:40, WJ 13:50, WE 14:50 y ME 16:30. La guía distingue call-up y salida. Junior indica mínimo 40 minutos; WE 50 y ME 60. El evento local dominical «Drie Zussen Superprestige» no acredita pertenencia al torneo belga Superprestige ni autoriza otra alta en calendario.

El catálogo DataRide de disciplina 3 identifica temporada 472 (año final 2027), competición 78519 Canmore, C2/CA y 12-09-2026. Descarga dirigida de solo lectura con el fetcher existente: /tmp/cc-cx-live-c1-check/dataride/78519.json, fetchedAt 2026-09-12T20:29:27.269Z. Devuelve MJ, uciRaceId 261818, eventId 378645, 18 filas y publicationHint unverified_results. Los tiempos timeText/timeSeconds están ausentes, incluido el ganador; por tanto no cumple la guardia operativa de tiempo positivo del ganador. No se oficializa, importa, enlaza una ficha ni encola un volcado. El catálogo local conserva también canmore-catalog.json. La guía exportada permanece en el directorio temporal browser-use/exports como fuente de lectura.

Este avance identifica una manga actual y su programa, pero no acredita el flujo VPS con resultados revisados. El siguiente paso depende de un resultado primario que incluya tiempo de meta y revisión de la categoría; no repetir un noop como prueba de cierre ni activar histórico.

Segunda descarga dirigida de solo lectura, fetchedAt 2026-09-12T20:40:22.022Z: /tmp/cc-cx-live-c1-check/dataride-second/78519.json, SHA-256 188452ee2a569148e4728bc13e975cfc939b74b729c00bad531ad9cac320034e. Conserva MJ/18 filas y cero timeSeconds, incluido el ganador. No se importa ni encola. El organizador sigue enlazando confirmación de inscritos del sábado; la página federativa de resultados consultada no aporta un informe Canmore utilizable para el cotejo.

Tercera descarga dirigida de solo lectura, fetchedAt 2026-09-12T21:35:02.545Z: /tmp/cc-cx-live-c1-check/dataride-third/78519.json, SHA-256 0090b3e0ddf4cd179947801ce2086d142f7944607f882ac1992d4144e234cd4a. Sigue devolviendo únicamente MJ, 18 filas y publicationHint unverified_results; todos los timeSeconds y el tiempo del ganador son NULL. No se importa, oficializa ni encola. Esta lectura posterior no satisface la guardia del flujo real F5.

Cuarta descarga dirigida de solo lectura, fetchedAt 2026-09-12T22:01:26.718Z: /tmp/cc-cx-live-c1-check/dataride-fourth/78519.json, SHA-256 66e108418a090eeb678f34861eb497ec382516aaa1200c740170120400f456a1. Devuelve MJ/18 filas y WJ/8 filas, ambas con publicationHint unverified_results. Todos los timeSeconds y los tiempos de sus ganadores (dorsales 32/53) siguen siendo NULL. La nueva categoría no satisface la guardia de ganador ni acredita revisión/flujo real; no se importa, oficializa o encola.

Quinta descarga dirigida de solo lectura, fetchedAt 2026-09-12T22:16:41.347Z: /tmp/cc-cx-live-c1-check/dataride-fifth/78519.json, SHA-256 06d29e5406cb76e49d35d82d1ffccd676cc62b040ee84ddec5e6bcbcbf683a6b. Añade WE/8 filas a MJ/18 y WJ/8. Las tres categorías siguen con publicationHint unverified_results; todos los timeSeconds son NULL, incluidos los ganadores, dorsales MJ 32, WE 20 y WJ 53. No satisface la guardia operativa ni acredita revisión/flujo real; no se importa, oficializa o encola.

Sexta descarga dirigida de solo lectura, fetchedAt 2026-09-12T23:14:34.235Z: /tmp/cc-cx-live-c1-check/dataride-sixth/78519.json, SHA-256 8508347db2d862d4aa3cf6cf3dfd1f91caff41b24b5004d4227748562747d5af. Conserva MJ/18, WE/8 y WJ/8 con publicationHint unverified_results y cero timeSeconds, incluidos los ganadores. No se importa, oficializa o encola.

Séptima descarga dirigida de solo lectura, fetchedAt 2026-09-12T23:31:20.518Z: /tmp/cc-cx-live-c1-check/dataride-seventh/78519.json, SHA-256 43ab20e0f28bf9cd88857f0aed54806198418108ce7c430b8b92f461c95c8ea2. Conserva MJ/18, WE/8 y WJ/8; todos los timeSeconds siguen siendo NULL, incluidos los ganadores. No satisface la guardia operativa ni acredita el flujo real.

Preparación aplicada por MCP el 12-09-2026 a las 23:37:57 UTC: cx_save_race incorpora la zona America/Edmonton y las cuatro salidas documentadas, con IDs, estados pending y demás datos conservados. Conversión mediante Python zoneinfo: MJ/WJ/WE/ME a 18:40/19:50/20:50/22:30 UTC; formato individual y versión 2026-07-01 con duraciones generadas 40/40/50/60. Fuente de horario: [guía oficial](https://docs.google.com/document/d/1GwXyS3qT9_KWvqlQghDbDSjEtPvWgoDcCF7Z4327f_E/edit?usp=sharing), TXT público en /tmp/cc-cx-live-c1-check/guide-2026.txt, SHA-256 a10a9d4172e996a1d08abd880d4bb8a85aa3c56ded8953902d62d086ed27f89d. Se crea cx_race_uci_links para competición 78519, disciplina 3, temporada 472, uciRaceId=0 y syncEnabled=false. Aplicación atómica con guardas ante cambios concurrentes; respuesta MCP confirma programa, enlace y cero resultados. La [URL canónica existente](https://calendariociclismo.app/ciclocross/canmore-2026-27-79079/) devuelve HTTP 200; no se regenera. No se importa, oficializa ni encola; el programa no sustituye la revisión de un resultado utilizable.

El índice público del cronometrador enlaza ahora [Canmore Saturday, Overall Results](https://zone4.ca/race/2026-09-12/0cb75fb6/results) desde [el evento Zone4](https://zone4.ca/event/2026/v8BQ5x). Lectura HTTP del 12-09-2026: HTML del evento SHA-256 c587f76f0c01a52e898500d680d1ef472350f57731d6e6d30501e5a34de4544c y resultados 183583c1db69a786605d56fd503e773df1431ee21c532e211dbfe035230a0acf. El JSON inline identifica fecha, categorías, vueltas, salidas registradas y pasos por puntos de cronometraje; distingue el paso announcer de la meta. Contiene siete/seis/cinco vueltas completas para los dorsales WE 20/MJ 32/WJ 53 y ME en curso durante esa lectura. No se equiparan los pasos a una clasificación final exportada. Las diferencias de timestamps tienen fracciones de segundo; no se redondean ni truncan para cumplir el contrato de enteros, ni se deducen puestos, LAP o DNF. La inspección estática del bundle público no aporta un PDF de resultados. Fuentes, índice de enlaces y JSON de lectura conservados en /tmp/cc-cx-live-c1-check/zone4-latest/; ninguna ejecución de UI o modificación de datos reales.

## 73. F5 — X2O femenina y sub23, ocho rondas

Los manifiestos [WE](../../js/__tests__/fixtures/cx-cotejos/x2o-2025-26-we.json) y [MU](../../js/__tests__/fixtures/cx-cotejos/x2o-2025-26-mu.json) conservan las ocho tablas independientes Results/Best lap y la general final ACN 2025–26, con URL/SHA-256, recuentos y hechos publicados. El mismo cotejador acepta ME/WE/MU y comprueba que cada fuente corresponda a su categoría; las referencias verified solo existen en memoria offline.

Coinciden los 48 premios de cada categoría y 29/32 totales Bonif explícitos. WE enumera 389 resultados (262 tiempos de meta, 111 LAP, 11 DNF y cinco DNS); MU, 529 (378 tiempos de meta, 101 LAP, 48 DNF y dos DNS). La sección inicial se selecciona por el número de vueltas/secciones publicado: Bruselas tiene seis/seis WE y siete/siete MU; las otras siete rondas incluyen una sección anterior. No se obtienen bonos desde la general ni se convierten tiempos parciales o NULL en tiempos de meta/cero.

MU: coinciden 187/189 totales y 1510/1512 celdas. Corsus/Hamme y Haverdings David/Lille publican cinco segundos de sprint antes de DNF; la general conserva ganador +300 sin restarlos, respectivamente 55:27 y 58:26, frente a 55:22 y 58:21 del motor. Son dos casos adicionales al de Meeusen ME para revisar art. 4/política de forfaits. Hay 89 participantes excluidos por elegibilidad pero presentes en el informe. Entre las 100 filas calculadas coinciden 96 puestos/tiempos; Lienert/Remijn conservan el orden inverso en el empate 7:10:57, además de los dos tiempos DNF.

WE: coinciden 180/181 totales y 1447/1448 celdas. Hamme publica WORST Annemarie, dorsal 35, identificador 16071; no es una licencia UCI de once cifras. El listado oficial de inscritos termina en el dorsal 34; la general de Hamme conserva 16071 y DataRide confirma dorsal/puesto/tiempo pero no aporta UCI ID ni perfil. La general final usa 10008082912 y contiene 44:06 (8) en Hamme. La fila se aísla a esa ronda, sin unión por nombre ni corrección silenciosa: hay 182 identidades calculadas, una adicional y un total/celda pendiente en la identidad de la general. El manifiesto conserva las fuentes/proyecciones de esta revisión. Hay 93 exclusiones de elegibilidad; el orden completo no se acredita mientras la identidad esté pendiente.

Reproducción: node scripts/cx/cx-x2o-cotejo.mjs WE y node scripts/cx/cx-x2o-cotejo.mjs MU; ME continúa como opción predeterminada. Las tres categorías devuelven generalMatches=false, needs_review y exit 2. Se comprueban explícitamente fuentes cruzadas, identificadores pendientes no declarados/contradictorios y separación de identidades homónimas de distintas rondas. No se activa ninguna edición ni se escribe BD/histórico. F5 conserva todos los pendientes del registro de cotejos; F6 permanece cerrada, F7 retirada y ejecución nativa excluida. Fuentes, extracciones e informes conservados en /tmp/cc-cx-x2o-source-read/we-mu/; .openchamber/, work/ y outputs/ intactos.

Publicación de la sección 73: 557530ce3af2e5e6963d8c27503163ddf28f7fe2 en main, Pages 34723983581 completado con success. No cambian assets servidos de producto ni código nativo. Los tres informes reproducidos conservan generalMatches=false; no se cierra F5 ni se activan referencias. Se conserva /tmp/cc-cx-x2o-source-read/we-mu/ con fuentes, proyecciones, extracciones e informes; el seguimiento temporal de Pages queda cerrado. .openchamber/, work/ y outputs/ intactos.

## 74. F5 — política explícita de bonos ante forfaits, motor v3

Art. 4 X2O 2025–26 y los informes independientes de Meeusen/Hamme ME, Corsus/Hamme MU y Haverdings/Lille MU acreditan que sus cinco segundos ganados antes de DNF no se descuentan en el forfait. El motor compartido exige ahora review.forfaitBonusesPolicy por edición/categoría de tiempo: discard conserva ganador +300; retain reproduce la hipótesis F1 anterior. Una política ausente, NULL o desconocida impide calcular. No se activa ninguna referencia ni edición real; el cotejador utiliza discard únicamente en memoria offline para 2025–26. Las llegadas exactamente a +300 siguen siendo elegibles, con su bono aplicado.

El desglose conserva bonusSeconds publicado y separa appliedBonusSeconds/discardedBonusSeconds. No altera timeSeconds real de meta ni convierte tiempos parciales/LAP/DNF en meta. Bonos NULL siguen bloqueando, aunque la política descarte el descuento del forfait. No se mezcla con bonusPoints.

Con discard coinciden 111/111 totales y 888/888 celdas ME; 189/189 y 1512/1512 MU. El orden conserva 56/58 y 98/100 filas elegibles coincidentes, con los empates Suárez/Agostinacchio y Lienert/Remijn diferentes. Las 53/89 exclusiones de elegibilidad siguen presentes en las generales oficiales. WE conserva 180/181 totales y 1447/1448 celdas, con identidad Hamme pendiente. generalMatches=false y exit 2 en las tres categorías: no se cierra el cotejo íntegro a partir de tiempos coincidentes.

El contrato de publicación v3 rechaza cálculos v1/v2, incluidos estados de revisión; exige política explícita para una general de tiempo ready/empty y permite registrar needs_review sin filas cuando falte. Migración 20260913011000_cc_cx_standings_engine_v3.sql conserva locks, digest, unidad, identidad CX, permisos mínimos y prioridad manual. Preflight migración/suite ejecutado con rollback; cuerpo v2, ACL, SET del worker y cero torneos/resultados/generales/estados/cola restaurados después. El primer intento detectó una composición errónea de la consulta, corregida antes de aplicar. Pruebas de motor y cotejos contrastan discard/retain, estados, límite exacto, bonos desconocidos y fuentes originales. Aplicación/despliegue se registran tras su comprobación.

F5 permanece abierta según el registro de criterios; F6 conserva su cierre, F7 retirada y comprobación nativa fuera del alcance. Fuentes, proyecciones e informes conservados en /tmp/cc-cx-x2o-source-read/we-mu/. .openchamber/, work/ y outputs/ intactos.

Aplicación comprobada de la sección 74: migración cc_cx_standings_engine_v3 aplicada por MCP; cuerpo SQL idéntico al fichero versionado. Suite posterior con rollback, ACL y SET del worker conservados, cero torneos/resultados/generales/estados/cola de prueba. Edge cx-recompute-standings versión 3 ACTIVE con JWT y sus tres archivos idénticos al checkout; solo cambia el motor frente al bundle anterior. Advisors de seguridad sin cambios. Actualización del VPS y publicación Git/Pages se registran al terminar.

## 75. F5 — alias X2O WE revisado con nacimiento completo

La lectura directa DataRide añade una prueba que las proyecciones de la sección 73 no conservaban: BirthDate completo, nombre y nacionalidad coincidentes para Worst en Hamme (evento 352482, dorsal 35, puesto 8) y Lille (352613, dorsal 15, puesto 21). El informe independiente ACN Lille publica 10008082912 para esa fila. Ambas proyecciones se vinculan a los eventos/categorías/fechas y registros revisados anteriormente; el cotejador valida sus hashes, fecha civil, nacimiento raw, nacionalidad, nombre, dorsal, puesto y tiempo contra cada tabla original. No utiliza una celda de general para deducir la identidad o los bonos.

El manifiesto WE conserva 16071 en los resultados/Best lap de Hamme y mantiene las evidencias anteriores como registro histórico de la revisión. identityAliases declara una correspondencia exclusiva para 20251116_x2o/dorsal 35; no es una unión por nombre ni una modificación del catálogo. Método offline explícito; nacimiento ausente/distinto, eventos falsos o coincidentes, licencia sin fila independiente, fuente/hash contradictorios y dos identidades resueltas a una misma licencia en una ronda impiden calcular. Sin el alias revisado se conserva la separación de la identidad pendiente.

Con la correspondencia revisada se reproducen 181/181 totales y 1448/1448 celdas WE, con 181 identidades y sin identidad adicional. Coinciden 83/88 puestos de participantes elegibles. Persisten los empates Crees/Burquier y Seynave/Eyeington, y Persson tiene rank 154 en la fuente frente a 88 calculado, con el mismo tiempo 24251 y una llegada exactamente a +300. Los 93 excluidos por elegibilidad siguen presentes en el informe oficial. generalMatches=false y exit 2: la identidad queda resuelta, la general íntegra continúa pendiente; no se altera el límite autorizado de +300 ni se añade un desempate para forzar el orden.

El motor compartido, contrato SQL/Edge, versión de apps y flag público no cambian. No se escriben resultados o identidades históricas en BD ni se activan referencias. Fuente nueva y proyección compacta en /tmp/cc-cx-live-c1-check/canmore-raw-time-projection.json, checkedAt 2026-09-12T23:22:31.718Z; contiene también la comprobación Canmore junior de ResultValue NULL en las 18 filas. Informe/logs propios en /tmp/cc-cx-x2o-source-read/we-mu/. F5 conserva todos los criterios pendientes; F6 cerrada, F7 retirada y ejecución nativa excluida. .openchamber/, work/ y outputs/ intactos; sin servidores, pestañas o clones nuevos.

## 77. F5 — caso discriminante de puestos descartados, MU 2019–20

El archivo de [generales oficiales](https://www.ucicyclocrossworldcup.com/en/ranking) enlaza la [general masculina sub23 del 26-01-2020](https://www.ucicyclocrossworldcup.com/storage/rankings/file_results/3/3.pdf?t=1604561483), SHA-256 13ebb50737d985f148edeca7a01794af6f65962fa9267ceccf0e3be51508e6c0. Las fuentes Type3 carecen de mapeo Unicode utilizable: se recuperaron las celdas del PDF original mediante sus códigos y contornos, con comprobación de nombres en las páginas de la fuente. No se modificó el PDF ni se ejecutó una revisión del producto.

La clasificación publica Mein cuarto y Vandeputte quinto, ambos con 173 puntos. Sus cuatro resultados retenidos tienen los mismos puestos 1/3/4/7 y puntos 60/45/40/28. Bern aporta un noveno de Mein y un décimo de Vandeputte, descartados para el total. Contarlos en el desempate reproduce el orden publicado; excluirlos deja decidir la última ronda, favorable a Vandeputte, e invierte el orden.

Se descargaron independientemente las siete tablas MU completas de DataRide, temporada 141: Bern/Tábor/Koksijde/Namur/Zolder/Nommay/Hoogerheide, competiciones 57742/57743/57744/57745/57746/57748/57747 y eventos 193952/193946/193960/193956/193954/193966/193970. Son 345 filas y 106 identidades hash locales, con fecha, fuente, SHA-256 de descarga y checksum de proyección en el [manifiesto](../../js/__tests__/fixtures/cx-cotejos/worldcup-drop-case-2019-20-mu.json). Los puestos, DNF de Mein y ausencias de Vandeputte se conservan de cada tabla; no se deducen de la general.

Reproducción sin red ni BD:

```sh
node scripts/cx/cx-worldcup-drop-case.mjs
```

El motor v3 reproduce los dos totales y catorce celdas con ambas políticas. Solo all reproduce el orden relativo: only_all_case_matches. La entrada completa mantiene tres empates sin resolver y ninguna fila ordenada; el informe lo registra por separado. La comparación de dos corredores conserva los puestos de ronda sin renumerarlos y no asigna puestos globales 4/5 ni anuncia coincidencia de la general íntegra.

La hipótesis utiliza exclusivamente la escala antigua de 60…1 para treinta puestos, cuatro mejores de siete y última ronda celebrada. El encabezado de la general fecha Zolder como 26 DEC18; la fecha real 26-12-2019 se conserva del catálogo y resultado de ronda. No se sustituye por la escala actual de 40…1/25, no se activa ninguna edición ni se ingieren datos históricos.

Octava descarga Canmore de solo lectura, fetchedAt 2026-09-12T23:44:56.029Z: /tmp/cc-cx-live-c1-check/dataride-eighth/78519.json, SHA-256 1db7a8232540bf895fe817d7d9de752ede16e567baa25b2abfe50b04ee9ef109. Conserva MJ/18, WE/8 y WJ/8 con tiempos NULL; no se importa ni encola. F5 conserva la revisión actual y los demás criterios abiertos; F6 cerrada, F7 retirada y ejecución nativa excluida. Fuentes PDF/JSON y extracción en /tmp/cc-cx-worldcup-cotejo/drop-primary-search/ conservadas; caché de compilación y renders de fuente desechables se retiran tras congelar el cotejo. .openchamber/, work/ y outputs/ intactos.

## 78. F5 — categorías agrupadas RFEC/DataRide, Alcobendas

Descarga pública del 13-09-2026 a las 00:10:06 UTC: competición DataRide 75840, disciplina 3, temporada 455, SHA-256 59595c012f3d8e0cf04c2c27aa149c8392a0567a7fe28f9efc5fab09209a89c0. ME/WE corresponden a uciRaceId 244239/244241 y eventId 352472/352474. El catálogo devuelve ME/MJ/WE/WJ, sin MU/WU separados ni exclusiones del normalizador. Las tablas ME/WE tienen 40/24 filas, independientes de las 38/23 filas del PDF del organizador.

El [manifiesto Alcobendas](../../js/__tests__/fixtures/cx-cotejos/copa-espana-alcobendas-2025.json) conserva ambas proyecciones completas con hashes y nacimientos DataRide, sin alterar los resultados RFEC anteriores. Coinciden las 61 filas RFEC por dorsal, nombre normalizado, puesto, nacionalidad, estado y ELT/S23 según nacimiento: veinte/trece sub23, diecinueve/doce con puesto. Mira sigue segundo con veinte puntos dentro de ME; López Burgos cuarta con catorce dentro de WE. No se filtran ni renumeran los puestos para crear categorías MU/WU.

DataRide enumera DNS adicionales ME 20/39 y WE 404. No se añaden al PDF ni se deducen los cuatro DNS masculinos restantes del resumen de seis. El cotejador expone dataRideOfficialCategoryMapping y officialCategoryMappingMatches=true solo para este caso ME/WE; Junior queda fuera de ese indicador. El contraste falla ante puestos, edad, eventos, fuentes o proyecciones alterados. Los puntos siguen calculándose desde RFEC y no se sustituyen por el resultado DataRide para forzar coincidencia.

Reproducción: node scripts/cx/cx-copa-espana-cotejo.mjs. Conserva status partial, fullSeasonGeneralMatches=false, sanctionCotejoMatches=false y exit 2. La correspondencia de este caso no valida una general completa ni una sanción particular.

Búsqueda de lectura completa de las ocho pruebas DataRide: 75772/75780/75853/75814/75840/76467/75861/75942. La octava se localiza por Rafa Valls/Fira Tots Sants y 07-12-2025, aunque el nombre no incluye Cocentaina. Todas devuelven ME/MJ/WE/WJ sin MU/WU separados. El cotejo de búsqueda conserva diferencias en Gijón/Xaxan/Amurrio/Karrantza/Vic: bloques de dorsales femeninos, nombres distintos o truncados y cuatro puestos masculinos distintos en Xaxan. No se crean alias ni se corrigen esas fuentes. Cocentaina coincide en sus 43/28 filas ME/WE por nombre, dorsal, puesto y estados explícitos; permanece como evidencia de búsqueda, sin ampliar el indicador de Alcobendas.

Novena lectura Canmore: fetchedAt 2026-09-13T00:08:28.384Z, SHA-256 ac2efd49d77f7933e5307988c7bb83d45b616ac27dd80d08abfe6aec106fe661, /tmp/cc-cx-live-c1-check/dataride-ninth/78519.json. Añade ME/16 (uciRaceId 261817, eventId 378644) a MJ/18, WE/8 y WJ/8; todos los tiempos siguen NULL. No se importa ni encola. El reglamento UCI 01.07.2026 consultado de nuevo mantiene el texto de 5.3.013; no aporta un caso actual discriminante ni una aclaración del desempate hacia atrás.

F5 conserva los demás criterios abiertos; F6 cerrada, F7 retirada y ejecución nativa excluida. No se modifica el motor desplegado, versiones, flag público ni datos históricos. Fuentes de las ocho pruebas, búsqueda, hashes e informes propios en /tmp/cc-cx-copa-espana-cotejo/dataride/ conservados; sin nuevos renders, cachés, servidores, pestañas o clones. .openchamber/, work/ y outputs/ intactos.

Publicación de la sección 77: 9cf9e50930a8e4084487ab54fb57e098047f23bf en main; Pages 34726967710 completado con success. No activa la edición actual ni valida una general íntegra.

## 79. F5 — Alcobendas C2 ME, tiempos y vueltas perdidas

El catálogo público DataRide acredita C2/ES y 16-11-2025 para la competición 75840. El [manifiesto de clasificación](../../js/__tests__/fixtures/cx-cotejos/alcobendas-2025-26-me.json) conserva la proyección de las cuarenta filas crudas consultadas a las 00:25:51 UTC del 13-09-2026, evento 352472/uciRaceId 244239/temporada 455, y las treinta y ocho filas nombradas del [PDF oficial](https://cronosportradio.es/RESULTADOS25/ALCOBENDAS25/clasificacion-elite.pdf), enlazado por el [organizador](https://www.cxalcobendas.com/p/clasificaciones_3.html). El SHA-256 del PDF sigue siendo 050c71dfa9936b7fa5d20d3328f01e69de7468872c21580590eaa38495ae9163; JSON crudo b59d26bcf911a381d6ed27607b6a33e8a387371cb4b5d1a794481205145c7d4a. El documento normalizado nuevo tiene SHA-256 1508d049ca2a842492b6f25818da5da01cd12c9694685559c94ed426233c33e3. Se conserva, sin sobrescribirlo, el snapshot anterior 59595c012f3d8e0cf04c2c27aa149c8392a0567a7fe28f9efc5fab09209a89c0.

Coinciden los treinta y ocho dorsales, nombres exactos y puestos; veintiséis tiempos absolutos de meta, nueve LAP y tres DNF. Los tiempos parciales de los doblados quedan como hechos del PDF, fuera de `timeSeconds`; los DNF no reciben puesto ni tiempo de meta. La fuente cruda publica `Irm=LAP` y `ResultValue=-2/-3/-4/-5`. Se corrige el fetcher compartido para guardar esos déficits como `gapText=-n LAP`, con tiempo NULL, sin inferir LAP desde un negativo sin estado ni redondear fracciones. Solo cambian los nueve pares `timeText/gapText` frente al snapshot anterior.

```sh
node scripts/cx/cx-results-cotejo.mjs js/__tests__/fixtures/cx-cotejos/alcobendas-2025-26-me.json
```

El runner conserva las cuarenta filas DataRide y todos los hechos oficiales. `sourceCoverage.namedClassificationMatches=true` identifica exclusivamente la clasificación nombrada. El PDF resume seis DNS sin enumerarlos; DataRide nombra a González Bellido/dorsal 20 y Eguiguren Santamaria/39. `dnsCountDifference=4` expresa una diferencia de recuento, sin acreditar sus identidades en el PDF. `officialDnsIdentitiesMatched=false`, `allEntrantsMatches=false`, `status=needs_review` y exit 2. Los dos dorsales adicionales y el recuento distinto siguen en `differences`; ninguna fila se elimina para obtener exit 0. Una fila extra clasificada, un estado/tiempo incorrecto o un duplicado impiden anunciar coincidencia de la clasificación nombrada.

La correspondencia agrupada RFEC/DataRide y los puntos de esta ronda permanecen separados en el manifiesto de la sección 78. El resultado C2 no valida una general íntegra, la discrepancia de Waaslandcross ni el flujo real del VPS. No se activan referencias de torneo, ingieren resultados históricos o crean perfiles. Publicación y actualización del fetcher operativo se registran después de comprobarlas. F5 conserva el resto de criterios abiertos; F6 cerrada, F7 retirada y ejecución nativa excluida.

Fuentes PDF/JSON, texto extraído, constructores e informes propios conservados en `/tmp/cc-cx-copa-espana-cotejo/dataride/`; el PDF original conserva su ruta anterior. No se crean renders, clones, servidores o pestañas. `.openchamber/`, `work/` y `outputs/` intactos.

Publicación anterior comprobada: sección 78 en 708f1300109a15464c32ff35d10dcc9d81274520, Pages 34727599017 completado con success.

Publicación y actualización comprobadas de la sección 79: e9d9096d900a92a1188571fbb8cf344cbbdae471 en main, Pages 34728216636 success. Checkout VPS limpio actualizado mediante fast-forward por cc-results; fetcher idéntico a main, SHA-256 0b9f247f7905e9d8d6610867c7e603735219405e87c80fff9dd1772817091fbe. Node 22.23.2 reproduce las cuarenta filas archivadas, sin importación. Preflight --discipline 3 --dry-run sin candidatos, unidad transitoria recogida y timers CX/carretera activos. Monitor MCP 20082, 13-09-2026 00:33:00 UTC, revisión e9d9096d900a, noop con cero cambios/errores/avisos; no acredita flujo real.

Décima consulta Canmore, fetchedAt 2026-09-13T00:33:42.212Z y SHA-256 d2e15205eeff04bd7d5e10c1ca20d7af1618317454b3ba35e9f61ee5c92a9ed4, conservada en /tmp/cc-cx-live-c1-check/dataride-tenth/78519.json. ME/16, MJ/18, WE/8 y WJ/8 siguen con timeSeconds NULL. Lectura MCP posterior confirma enlace syncEnabled=false, cuatro categorías pending y cero resultados. La primera consulta de comprobación usó incorrectamente ::uuid; tras verificar raceId=text en las tres tablas, se repitió sin el cast y sin escrituras. Registro local de publicación/preflight/monitor en /tmp/cc-cx-copa-espana-cotejo/dataride/alcobendas-c2-publication.json. No hay artefactos desechables nuevos; evidencias y trabajo previo conservados.

## 80. F5 — Superprestige, auditoría de las etiquetas de puesto

El cotejador conserva las entradas completas de las ocho mangas ME/WE, 462/339 filas, y las generales independientes de 38/51 filas. Antes solo comparaba puestos cuando el motor devolvía filas publicables; los empates dejaban ese recuento en cero. El nuevo `printedRanksAudit` compara todas las etiquetas numéricas disponibles aunque el cálculo permanezca `needs_review`, sin publicar filas ni modificar los manifiestos de fuente.

La consulta del [reglamento oficial 2025–26](https://www.superprestigecyclocross.be/nl/reglement) conserva participaciones, victorias y resultado de la última prueba. No añade un cuarto desempate; las controversias corresponden al comité organizador. Copia HTML SHA-256 c6cf77bb63b62ada03082bcf43cb5407c07d2a5e7128850a6789a846edb703c6 en /tmp/cc-cx-superprestige-cotejo/rules-recheck-20260913.html. También se comprueban los hashes de los dieciocho PDF originales de ronda/general; no equivale a una transcripción nueva ni cambia sus hechos.

Para cada participante de la general se conserva posición de fila y etiqueta literal, junto al intervalo de posición individual posible según puntos, salidas, victorias y último puesto. DNF cuenta como salida; DNS no. Un empate conserva un intervalo, sin ordenar por nombre, ID o posición de la fuente. Una etiqueta vacía permanece NULL incluso si el reglamento determina un puesto calculable. Se mantiene toda la población elegible del cálculo, incluidas las filas que no figuren en el esperado, y no se aplica este auditor a otra escala o secuencia de desempates.

| Categoría | Filas de general | Etiquetas numéricas | Coincidencia individual no ambigua | Fuera del intervalo individual | Indeterminadas dentro del intervalo | Etiquetas vacías |
| --- | --- | --- | --- | --- | --- | --- |
| ME | 38 | 27 | 22 | 4 | 1 | 11 |
| WE | 51 | 29 | 23 | 5 | 1 | 22 |

La comparación de etiquetas es condicional: `printed_label_is_individual_rank_requires_organizer_confirmation`. Las filas con igual puntuación y números vacíos podrían usar etiquetas de grupo; no se atribuye esa semántica sin prueba ni se anuncia una clasificación oficial errónea desde la diferencia. Bajo la hipótesis individual, quedan fuera Ronhaar 17/18, Van Aert 21/22, Dockx 27/29, Jezek 31/33; Pieterse 20/21, Bakker 22/23, Bäckstedt 24/25, Van Empel 26/[27,28] y Bialek 46/[49,51]. Boros 34/[34,35] y De Schoesitter 41/[41,44] permanecen indeterminados. Los puntos y todas sus celdas siguen coincidiendo; interpretación del formato y orden íntegro continúan pendientes. `generalMatches=false` y exit 2 en ambas categorías.

Reproducción con los comandos existentes `node scripts/cx/cx-superprestige-cotejo.mjs ME` y `node scripts/cx/cx-superprestige-cotejo.mjs WE`; informes completos en /tmp/cc-cx-superprestige-cotejo/rank-audit-ME.json y rank-audit-WE.json. La reproducción versionada usa únicamente los manifiestos originales; no necesita red, revisión visual o ejecución nativa. Evidencia de fuentes en rank-audit-source-evidence.json del mismo directorio. F5 conserva los demás criterios abiertos; F6 cerrada y F7 retirada. No cambian motor compartido, SQL/Edge, runtime, versiones, flag o datos reales.

Undécima consulta Canmore, fetchedAt 2026-09-13T00:45:32.503Z, SHA-256 7a728d3d932aa2c44f6a55396da9befc8d604597f9b93b17ca98b74ccc5bfbf3, conservada en /tmp/cc-cx-live-c1-check/dataride-eleventh/78519.json. Las mismas ME/16, MJ/18, WE/8 y WJ/8 permanecen con timeSeconds NULL; no se encola o importa. Fuentes/informes propios conservados, sin desechables nuevos; .openchamber/, work/ y outputs/ intactos.

La sección 79 y su despliegue operativo quedan registrados en 104dc11a593380789a95f100ce45fbae491f0da4, ya publicado en main y sincronizado mediante fast-forward al VPS. El registro posterior solo cambia documentación y no dispara Pages según los paths del workflow; el código e9d9096 tiene Pages 34728216636 success y el fetcher conserva SHA-256 0b9f247f7905e9d8d6610867c7e603735219405e87c80fff9dd1772817091fbe.
