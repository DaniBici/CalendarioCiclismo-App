# Revisión de fichajes: WWT femeninos, mercado 2027 (fase 1)

- Fecha de la consulta: 2026-10-13.
- Estado: fase 1 de solo lectura; las correcciones aprobadas por Dani se aplicaron el mismo día (sección 10).
- Alcance: `team_seasons.category='WWT'`, `gender='female'`, año 2027 (14 equipos); `rider_transfers.season=2027`, `riderGender='female'`; plantilla = `riders_women.currentTeamId` del equipo (251 fichas, ninguna con `historicalCatalogOnly`).

## 1. Línea base del feed público

Consulta: `rider_transfers` con `season=2027`, `status='confirmed'`, `dateVisible` distinto de `false` y (`type='renewal'` o `type='transfer'` con `toTeamId` no nulo o `toTeamName` distinto de `?`), conforme a `js/fichajes.js` (`confirmedFeed`, `renewalFeed`).

| Ámbito | ids visibles | md5 de los ids ordenados (`COLLATE "C"`, separador `,`) |
| --- | --- | --- |
| Todos los géneros | 338 | `d88ece763c2a4c0bc5de1f7e72304457` |
| Solo `female` | 112 | `b4d44a3e437ad2f3ceaf4656e3bfcc4e` |

Ninguna de las escrituras propuestas debe alterar estos valores.

## 2. Recuentos

| Concepto | Recuento |
| --- | --- |
| Filas `rider_transfers` 2027 femeninas con origen o destino en un equipo WWT | 155 (107 `transfer` confirmadas, 29 `renewal` confirmadas, 11 `retirement`, 7 `transfer` en rumor, 1 `renewal` en rumor) |
| Bajas `transfer` con `toTeamId` nulo y `toTeamName='?'` desde un equipo WWT | 56 |
| — con respaldo sólido para corregir | 12 (10 continúan, 2 con destino conocido) |
| — probables (solo fuente externa) | 1 |
| — consistentes con las fuentes (mantener) | 43 |
| Plantilla WWT sin movimiento y sin afiliación 2027 («sin decidir») | 0 (119 fichas con afiliación 2027 sin movimiento, 132 con movimiento) |
| Rumores `rumor` con origen o destino WWT | 8 (7 `transfer`, 1 `renewal`) |
| Dudas `renewal` en `doubt` en el ámbito | 0 (no existen en `riderGender='female'`) |
| Retiradas WWT registradas (`retirement`) | 11, todas coherentes con `teams/retiring` de fuente externa |

Distribución de la plantilla por equipo (afiliación 2027 sin movimiento / con movimiento): AG Insurance - Soudal 6/15, Canyon//SRAM 3/13, EF Education - Oatly 7/10, FDJ United - SUEZ 10/8, Fenix-Premier Tech 3/15, Human Powered Health 6/14, Lidl - Trek 13/6, Liv-AlUla-Jayco 9/7, Movistar 10/7, Picnic PostNL 9/7, SD Worx - Protime 8/10, Visma | Lease a Bike 12/3, UAE L'IMAD 10/10, Uno-X Mobility 13/7.

## 3. Aspecto 1: bajas `?` (término de contrato)

Las 56 filas proceden de la carga inicial del 2026-07-20 (`dateVisible=false`, sin `contractUntil`), salvo `tr_1791213463454_oofxg5` (Realini, 2026-10-05, `dateVisible=true`). fuente externa (FC) da vencimiento 2026 para 52 de ellas (Blanco y Worst no figuran en FC; Realini y Schrempf figuran con 2027). fuente externa contradice 13 (secciones 3.1, 3.2 y 3.3).

Criterio de contraste: la lista de fuente externa «sin contrato para 2027» (`teams.php?s=no-team-next-year`, derivada del registro UCI) es la comprobación más actual; la plantilla 2027 y la ficha de corredora de fuente externa indican el equipo y el tramo de contrato registrados; los vencimientos de FC quedan obsoletos tras renovaciones.

### 3.1 Corregir con respaldo sólido: destino conocido (2)

| Fila | Corredora | Situación en base | Evidencia | Corrección propuesta |
| --- | --- | --- | --- | --- |
| `tr_1784552446934_3l2ki9` | Carina Schrempf (Fenix-Premier Tech) | Baja `?` oculta; existe además `schrempf-carina-2026-sd-worx-protime` (`midSeason`, confirmada, visible, destino SD Worx-Protime) y `currentTeamId` = SD Worx; sin afiliación 2027 | Fenix confirmó su salida a SD Worx-Protime para 2027 ([ProCyclingUK, 2026-08-20](https://procyclinguk.com/carina-schrempf-to-join-team-sd-worx-protime-in-2027-after-leaving-fenix-premier-tech/)); [Cyclingnews](https://www.cyclingnews.com/pro-cycling/transfers/cycling-transfers-all-the-latest-news-and-announcements-for-the-2027-season/) (Fenix Out / SD Worx In); [fuente externa Fenix](https://example.invalid) («2026 Out» a SD Worx); plantilla fuente externa de SD Worx 2027; [FC 2027](https://example.invalid) la lista en SD Worx-Protime | `transfer` confirmada `toTeamId` = SD Worx, `contractUntil` 2027, `dateVisible=false`; afiliación `regular` 2027 a SD Worx (2027-01-01..2027-12-31); ficha `contractUntil` 2027. La fila `midSeason` no se toca |
| `tr_1784552446934_yslakl` | Annemarie Worst (Fenix-Premier Tech) | Baja `?` oculta | Fichaje por Team Carbonbike Giordana Sofré (ruta, verano de 2026) y Baloise - Het Poetsbureau Lions (ciclocross) ([ProCyclingUK, 2026-04-14](https://procyclinguk.com/annemarie-worst-set-for-dual-road-and-cyclocross-move-with-new-teams/)); [fuente externa Fenix](https://example.invalid) («2026 Out» a Carbonbike Giordana Sofré by Gen Z) | `transfer` confirmada con destino en texto libre (club fuera de divisiones de mercado), `dateVisible=false`, sin afiliación ni `contractUntil` (año desconocido). Nombre: `team_seasons` registra «Carbonbike Giordana Giofré by Gen Z» (alias verificado); fuente externa y ProCyclingUK usan «Sofré» |

### 3.2 Corregir con respaldo: continúan en 2027 (10)

fuente externa los incluye en la plantilla 2027 de su equipo, con tramo de contrato en la ficha, y no figuran en la lista de sin contrato. FC los mantiene en vencimientos 2026 (dato obsoleto según la lección de las revisiones masculinas). No se localizó anuncio oficial en Cyclingnews ni en las webs de equipo: el respaldo es el registro de fuente externa. Cyclingnews corrobora a Moerman (`In` de AG Insurance - Soudal).

| Fila | Corredora | Equipo | fuente externa: plantilla 2027 / ficha | Año propuesto | Notas de contraste |
| --- | --- | --- | --- | --- | --- |
| `tr_1784552446934_5cunn6` | Justine Ghekiere | AG Insurance - Soudal | sí / 2027 (bloque «2027 Out ?») | 2027 | La web de AG indicaba extensión hasta 2026 ([aviso antiguo](https://www.aginsurance-soudal.com/news/contract-renewal-for-justine-and-marthe)); la ficha fuente externa indica 2027 |
| `tr_1784552446934_qspyr5` | Tess Moerman | AG Insurance - Soudal | sí / 2027 (AG WWT desde 2026-04-20) | 2027 | Cyclingnews: «In» de AG; [Wielerflits](https://www.wielerflits.nl/nieuws/belgisch-klimtalent-tess-moerman-20-maakt-vervroegd-overstap-naar-womens-worldtour/): ascenso anticipado |
| `tr_1784552446934_cfif4g` | Alice Towers | EF Education - Oatly | sí / 2027 | 2027 | |
| `tr_1784552446934_pr8ewt` | Kristen Faulkner | EF Education - Oatly | sí / 2027-2028 | 2028 | |
| `tr_1784552446934_7ojikq` | Solbjørk Anderson | EF Education - Oatly | sí / 2027-2028 | 2028 | |
| `tr_1784552446934_8w2h8b` | Aniek van Alphen | Fenix-Premier Tech | sí / 2027 | 2027 | |
| `tr_1784552446934_ytx1xb` | Ceylin Del Carmen Alvarado | Fenix-Premier Tech | sí / 2027-2028 | 2028 | |
| `tr_1784552446934_6i10ri` | Christina Schweinberger | Fenix-Premier Tech | sí / 2027 | 2027 | |
| `tr_1784552446934_7qeu3e` | Julie De Wilde | Fenix-Premier Tech | sí / 2027 | 2027 | |
| `tr_1784552446934_ve0uu7` | Xaydée Van Sinaey | Fenix-Premier Tech | sí / 2027 | 2027 | |

Corrección propuesta: borrar la fila `?`; insertar afiliación `regular` 2027 al propio equipo con `dateTo` 31-12 del año indicado; `riders_women.contractUntil` = año. No se crea fila `renewal` (definición de «continúa»: afiliación regular sin fila de movimiento). Para los de «2027» se aplica además la regla de Dani de continuidad sin año conocido (2027).

### 3.3 Probable (1)

| Fila | Corredora | Evidencia | Propuesta |
| --- | --- | --- | --- |
| `tr_1784552446934_0r2d30` | Elise Uijen (Picnic PostNL) | Solo [fuente externa Picnic](https://example.invalid) («2026 Out» a WV Schijndel); búsqueda web sin confirmación; FC la mantiene en vencimientos 2026 | Si Dani acepta fuente externa como fuente única: `transfer` confirmada con destino en texto libre «WV Schijndel» (catálogo: «WV Schijndel Women U23»), `dateVisible=false`. En otro caso, mantener la baja `?` |

### 3.4 Consistentes con las fuentes: mantener (43)

Todas figuran en «2026 Out ?» de la página de transfers de su equipo en fuente externa y en la lista fuente externa de sin contrato; FC las da como vencimiento 2026 (salvo Blanco, ausente de FC, y Realini, que FC mantiene en 2027). Ninguna aparece en las altas publicadas por fuente externa (`teams.php?s=transfers&sekse=women`, 400 días) ni en la plantilla 2027 de otro equipo WWT. Ninguna figura en `teams/retiring`.

Notas con fuente propia:

- Gaia Realini: Lidl-Trek y la corredora pactaron terminar el contrato un año antes ([Cyclingnews](https://cyclingnews.com/pro-cycling/womens-cycling/lidl-trek-and-gaia-realini-agree-to-end-contract-a-year-early/); [IDL Pro Cycling, 2026-10-07](https://www.idlprocycling.com/cycling/lidl-trek-terminate-multiple-contracts-lucrative-transfer-season-in-full-swing-at-german-team)). La ficha conserva `contractUntil` 2027 (obsoleto) y FC la mantiene en 2027. Destino sin publicar.
- Lucinda Brand: sale de Lidl-Trek al terminar 2026 y renueva en ciclocross con Baloise - Het Poetsbureau Lions; el equipo de ruta de 2027 queda por anunciar ([ProCyclingUK, 2026-10-09](https://procyclinguk.com/lucinda-brand-leaves-lidl-trek-to-stay-with-sven-nys-and-baloise-het-poetsbureau/); [IDL, 2026-10-11](https://www.idlprocycling.com/cyclo-cross/lidl-trek-presented-lucinda-brand-with-a-tough-choice-and-she-chose-sven-nys-with-all-her-heart)).
- Sheyla Gutiérrez: declara que no tiene contrato para 2027 y no anuncia retirada ([ProCyclingUK, 2026-09-13](https://procyclinguk.com/sheyla-gutierrez-says-professional-career-could-be-over-after-failing-to-secure-2027-contract/)).
- Alena Amialiusik, Anna van der Breggen, Chloé Dygert, Lara Gillespie: sin anuncio de destino ni de retirada localizado; contratos hasta 2026 según los avisos de sus equipos.

| Fila | Corredora | Equipo | FC | fuente externa «2026 Out ?» | fuente externa sin contrato |
| --- | --- | --- | --- | --- | --- |
| `tr_1784552446934_0gs4a5` | Amandine Fouquenet | AG Insurance - Soudal | 2026 | sí | sí |
| `tr_1784552446934_gaw7qj` | Anya Louw | AG Insurance - Soudal | 2026 | sí | sí |
| `tr_1784552446934_plpeg8` | Fauve Bastiaenssen | AG Insurance - Soudal | 2026 | sí | sí |
| `tr_1784552446934_z98mnn` | Ilse Pluimers | AG Insurance - Soudal | 2026 | sí | sí |
| `tr_1784552446934_onz2zs` | Nicole Steigenga | AG Insurance - Soudal | 2026 | sí | sí |
| `tr_1784552446934_lk6mzl` | Anastasiya Kolesava | Canyon//SRAM | 2026 | sí | sí |
| `tr_1784552446934_wghsqe` | Chloé Dygert | Canyon//SRAM | 2026 | sí | sí |
| `tr_1784552446934_erfgay` | Maria Martins | Canyon//SRAM | 2026 | sí | sí |
| `tr_1784552446934_4098ds` | Rosa Maria Klöser | Canyon//SRAM | 2026 | sí | sí |
| `tr_1784552446934_htx2sk` | Wilma Aintila | Canyon//SRAM | 2026 | sí | sí |
| `tr_1784552446934_ockx6q` | Caoimhe O'Brien | EF Education - Oatly | 2026 | sí | sí |
| `tr_1784552446934_w6vo9j` | Henrietta Christie | EF Education - Oatly | 2026 | sí | sí |
| `tr_1784552446934_o2tjzu` | Nina Berton | EF Education - Oatly | 2026 | sí | sí |
| `tr_1784552446934_teiib3` | Eglantine Rayer | FDJ United - SUEZ | 2026 | sí | sí |
| `tr_1784552446934_m6j4hr` | Evy Kuijpers | Fenix-Premier Tech | 2026 | sí | sí |
| `tr_1784552446934_pe0sf5` | Flora Perkins | Fenix-Premier Tech | 2026 | sí | sí |
| `tr_1784552446934_myv5w1` | Inge van der Heijden | Fenix-Premier Tech | 2026 | sí | sí |
| `tr_1784552446934_zqke9w` | Lotte Claes | Fenix-Premier Tech | 2026 | sí | sí |
| `tr_1784552446934_o31h19` | Millie Couzens | Fenix-Premier Tech | 2026 | sí | sí |
| `tr_1784552446934_17l1wc` | Mylène de Zoete | Fenix-Premier Tech | 2026 | sí | sí |
| `tr_1784552446934_rvqrtr` | Sara Casasola | Fenix-Premier Tech | 2026 | sí | sí |
| `tr_1784552446934_oq5hy3` | Daria Pikulik | Human Powered Health | 2026 | sí | sí |
| `tr_1784552446934_ovzvdx` | Giada Borghesi | Human Powered Health | 2026 | sí | sí |
| `tr_1784552446934_qgebb1` | Iurani Blanco | Human Powered Health | — | sí | sí |
| `tr_1784552446934_mg7fzg` | Katia Ragusa | Human Powered Health | 2026 | sí | sí |
| `tr_1784552446934_ou0qy2` | Mona Mitterwallner | Human Powered Health | 2026 | sí | sí |
| `tr_1784552446934_3jyfw1` | Wiktoria Pikulik | Human Powered Health | 2026 | sí | sí |
| `tr_1791213463454_oofxg5` | Gaia Realini | Lidl - Trek | 2027 | sí | sí |
| `tr_1784552446934_vsjkgl` | Lucinda Brand | Lidl - Trek | 2026 | sí | sí |
| `tr_1784552446934_4bje77` | Amber Pate | Liv-AlUla-Jayco | 2026 | sí | sí |
| `tr_1784552446934_esjt5o` | Jeanne Korevaar | Liv-AlUla-Jayco | 2026 | sí | sí |
| `tr_1784552446934_ci230i` | Josie Talbot | Liv-AlUla-Jayco | 2026 | sí | sí |
| `tr_1784552446934_qmhwqg` | Laura Ruiz | Movistar Team | 2026 | sí | sí |
| `tr_1784552446934_0udpck` | Sheyla Gutiérrez | Movistar Team | 2026 | sí | sí |
| `tr_1784552446934_9b5ncf` | Ella Heremans | Team Picnic PostNL | 2026 | sí | sí |
| `tr_1784552446934_wlbktp` | Gaia Masetti | Team Picnic PostNL | 2026 | sí | sí |
| `tr_1784552446934_zn3v41` | Juliana Londoño | Team Picnic PostNL | 2026 | sí | sí |
| `tr_1784552446934_enys84` | Anna van der Breggen | Team SD Worx - Protime | 2026 | sí | sí |
| `tr_1784552446934_asyrh8` | Alena Amialiusik | UAE Team L'IMAD | 2026 | sí | sí |
| `tr_1784552446934_g8nsrw` | Alena Ivanchenko | UAE Team L'IMAD | 2026 | sí | sí |
| `tr_1784552446934_voelgq` | Lara Gillespie | UAE Team L'IMAD | 2026 | sí | sí |
| `tr_1784552446934_94lzaj` | Alberte Greve | Uno-X Mobility | 2026 | sí | sí |
| `tr_1784552446934_8a9mdz` | Ingvild Gåskjenn | Uno-X Mobility | 2026 | sí | sí |

### 3.5 Plantilla sin decidir

Ninguna. Las 251 fichas con `currentTeamId` en un equipo WWT tienen un movimiento 2027 o una afiliación `regular` 2027.

### 3.6 Retiradas

Las 11 filas `retirement` (Castrique, Moolman-Pasio, Magner, Cadzow, Cromwell, Bertizzolo, Spratt, Steels, Baril, Cecchini, Ysland) coinciden con `teams/retiring` y con los bloques «Retired as from» de fuente externa. Sin cambios.

## 4. Aspecto 2: rumores (8)

| Fila | Corredora | Movimiento en base | Evidencia | Clasificación |
| --- | --- | --- | --- | --- |
| `tr_1785215931011_3bo1c8` | Paula Blasi | `transfer` rumor UAE L'IMAD → Movistar, `contractUntil` 2029, visible | Confirma que ha completado su salida de UAE y firmado con un equipo nuevo desde 2027, sin nombrarlo ([Cyclingnews, 2026-09-19](https://www.cyclingnews.com/pro-cycling/transfers/time-to-race-with-a-team-that-can-accompany-me-in-my-ambitions-the-paula-blasi-transfer-saga-is-over-as-rising-star-confirms-done-deal-with-new-team/)); prensa española y El País: Movistar, 3 años (hasta 2029), cláusula de 100 000 EUR ([Escape Collective](https://escapecollective.com/paula-blasi-will-leave-uae-team-adq-early-to-race-for-movistar-from-2027/), [ProCyclingUK](https://procyclinguk.com/paula-blasi-reportedly-set-to-join-movistar-through-2029-as-long-running-transfer-saga-nears-conclusion/)). fuente externa conserva a Blasi en UAE 2027 y no la lista en Movistar | Probable. Mantener en rumor hasta el anuncio de Movistar; confirmar entonces con afiliación Movistar 2027-2029 |
| `tr_1784550346458_qb8m2q` | Hélène Hesters | `transfer` rumor Liv-AlUla-Jayco Continental → AG Insurance - Soudal, visible | DirectVelo vía [ProCyclingUK, 2026-07-20](https://procyclinguk.com/helene-hesters-linked-with-ag-insurance-soudal-move-for-2027/): sin anuncio formal; fuente externa la lista sin contrato (Liv AlUla Jayco Women's Continental Team); no figura en las altas de AG de fuente externa ni de Cyclingnews | Mantener |
| `tr_1786783373012_vlxk06` | Lise Revol | `transfer` rumor AS Bike Racing → Fenix-Premier Tech (WWT), visible | Fenix-Premier Tech la ha fichado en septiembre de 2026: primero con el equipo de desarrollo y con el equipo profesional desde 2029 (blog de transferencias femeninas de [Sporza](https://sporza.be/nl/2026/08/12/wielertransfers-vrouwen-dag-na-haar-wereldtitel-heeft-wilson-haffenden-ook-profcontract-beet-bij-fenix-premier-tech~1786539461364/), entrada no abierta: extracto del buscador; [fuente externa transfers](https://example.invalid): 2026-09-23, Fenix Development Team 2027 y Fenix-Premier Tech 2028); [Wielerflits](https://www.wielerflits.nl/?p=1303243) (agosto, 403: titular y extracto): contrato de tres años | Corregir: el destino 2027 es el equipo de desarrollo (fuera de divisiones de mercado). Propuesta: `confirmed`, `toTeamId` NULL, `toTeamName` «Fenix-Premier Tech Development Team», `dateVisible=false`, `contractUntil` NULL (fuentes discrepantes: 2028, 2029). Alternativa: borrar la fila |
| `tr_1784552446934_ibrltl` | Josie Nelson | `renewal` rumor Picnic PostNL, sin año, afiliación `regular` 2027 con `dateTo` NULL, oculta | Ausente de la plantilla fuente externa 2027 de Picnic; «2026 Out ?» en fuente externa; en la lista de sin contrato; FC: vencimiento 2026; sin anuncio de renovación localizado | Contradicha por las fuentes. Decisión de Dani (sección 7) |
| `tr_1784552446934_p1j3s1` | Maud Oudeman | `transfer` rumor Visma \| Lease a Bike → Movistar, oculta | Sin respaldo del destino: Movistar no la incluye en sus altas (fuente externa, Cyclingnews); fuente externa la lista sin contrato; FC: vencimiento 2026 | Sin respaldo localizado. No modificar |
| `tr_1784552446934_i6lbj2` | Bodine Vollering | `transfer` rumor VolkerWessels → EF Education - Oatly, oculta (2026-10-04) | Sin noticia del destino; fuente externa la lista sin contrato en VolkerWessels Cycling Team (PRW); FC: vencimiento 2026 | Sin respaldo localizado. No modificar |
| `tr_1784552446934_0pnsrv` | Quinty Schoens | `transfer` rumor VolkerWessels → UAE L'IMAD, oculta (2026-10-06) | Sin noticia del destino; fuente externa la lista sin contrato en VolkerWessels Cycling Team (PRW); FC: vencimiento 2026 | Sin respaldo localizado. No modificar |
| `tr_1789112272063_c24bpe` | Ane Zubeldia | `transfer` rumor JRG Norclamp → Lidl - Trek, visible | Sin noticia localizada (ni Cyclingnews, ni fuente externa, ni FC, ni prensa); no figura en las altas de Lidl-Trek de fuente externa ni de Cyclingnews. Ficha: nacida en 2008, `currentTeamId` NULL | Sin respaldo localizado. No modificar |

## 5. Neo-pros promovidas desde filiales o continentales (solo señalización)

No se extrapola ninguna norma de duración del primer contrato. Con `contractUntil` actual de la ficha:

| Corredora | Origen → destino 2027 | Fila 2027 | `contractUntil` en base | Dato fuente externa |
| --- | --- | --- | --- | --- |
| Emma Siegers | AG Soudal Devo → AG Insurance - Soudal | `tr_1789122290901_t09ho8` confirmada | 2028 | Alta 2027 |
| Amandine Muller | AG Soudal Devo → FDJ United - SUEZ | `tr_1786783528261_tta7np` confirmada | 2029 | Alta 2027 |
| Thaïs Poirier | Marmande → FDJ United - SUEZ | `tr_poirier_fdj` confirmada | 2028 (fila); ficha NULL | Alta 2027 |
| Tess Moerman | AG Soudal Devo → AG Insurance - Soudal | baja `?` (ver 3.2) | NULL | Contrato 2027 |
| Talia Appleton | Liv AlUla Jayco Conti → Liv-AlUla-Jayco | ninguna (afiliación 2027) | 2027 | Plantilla 2027, contrato 2027; FC 2027 y Cyclingnews («In») |
| Erin Boothman | Liv AlUla Jayco Conti → Liv-AlUla-Jayco | ninguna (sin afiliación 2027) | NULL | Alta 2027 |
| Puck Langenbarg | Fenix Development → Fenix-Premier Tech | ninguna (sin afiliación 2027) | NULL | Alta 2027 |
| Lise Revol | → Fenix Development Team | rumor (ver sección 4) | NULL | Equipo de desarrollo 2027; fuente externa: pro 2028 |

Boothman (fuente externa: alta de Liv AlUla Jayco) y Langenbarg (fuente externa y Cyclingnews: alta de Fenix-Premier Tech) carecen de fila y de afiliación 2027: fuera del alcance de esta revisión; se señalan para una pasada de altas.

## 6. Observaciones fuera del alcance

- Megan Arens (`tr_1786526858348_9568d5`, `midSeason`, confirmada a AG Insurance - Soudal desde 2026-08-12): su afiliación 2027 es `regular` a Team Picnic PostNL (2027-01-01..2027-12-31), no a AG. Schrempf tiene el mismo patrón de fila `midSeason` sin afiliación 2027 (ver 3.1).
- Marianne Vos: fuente externa no registra equipo 2027 ni figura en la lista de sin contrato; la base mantiene afiliación 2027..9999-12-31 en Visma | Lease a Bike; FC la da en vencimientos 2028. Sin cambio propuesto.
- VolkerWessels (PRW): según [Wielerflits](https://www.wielerflits.nl/nieuws/wielerploeg-volkerwessels-verdwijnt-uit-het-mannenpeloton/), el equipo femenino continúa en 2027 con otra denominación (Team Reggeborgh); `team_seasons` 2027 conserva «VolkerWessels Cycling Team».
- `team_seasons` (solo lectura): «Carbonbike Giordana Giofré by Gen Z» frente a «Sofré» en fuente externa y ProCyclingUK.

## 7. Decisiones pendientes para Dani

1. Aplicar la corrección de las 10 continuidades de 3.2 con respaldo solo de fuente externa (sin anuncio oficial localizado) y con el año de fuente externa (2027 o 2028).
2. Josie Nelson (`tr_1784552446934_ibrltl`): mantener el rumor de renovación (hoy con afiliación 2027 sin año), o convertirlo en baja `?` (`transfer` a `?`, sin afiliación 2027) por la ausencia de contrato en fuente externa y la falta de anuncio.
3. Lise Revol: destino en texto libre «Fenix-Premier Tech Development Team» confirmado y oculto, o borrar la fila.
4. Elise Uijen → WV Schijndel: aceptar fuente externa como única fuente para el destino en texto libre, o mantener la baja `?`.
5. Annemarie Worst: texto libre con el nombre del catálogo («Giofré») o el de fuente externa («Sofré»); el movimiento es efectivo desde el verano de 2026 y no se registra como `midSeason` porque el destino no pertenece a una división de mercado.
6. Schrempf: confirmar que la fila normal (`transfer` Fenix → SD Worx, oculta) coexiste con la fila `midSeason` ya visible; `contractUntil` 2027 según FC.
7. Ficha de Realini: `contractUntil` 2027 obsoleto (contrato terminado en 2026); la skill no toca la ficha en bajas `?`. Dani decide si se limpia.

## 8. Efectos de escritura propuestos (fase 2, tras aprobación)

| Operación | Filas | Detalle |
| --- | --- | --- |
| `DELETE rider_transfers` | 10 | Las bajas `?` de 3.2 |
| `UPDATE rider_transfers` | 2 (+1 opcional) | Schrempf (`toTeamId`, `contractUntil`, `dateVisible=false`), Worst (`toTeamName`, `dateVisible=false`), opcional Uijen; Revol según decisión 3 |
| `INSERT rider_team_affiliations` | 11 | 10 de 3.2 (`regular`, 2027-01-01..31-12 del año) + Schrempf al SD Worx; `id` `aff_<ms>_<rand6>`, `source='manual'`, `verified=true` |
| `UPDATE riders_women.contractUntil` | 11 | Los 10 de 3.2 y Schrempf (2027) |
| Rumores 3, 4, 5, 6, 8 y las dudas | 0 | Sin cambios |

Verificaciones previas a la ejecución:

- Tabla temporal con los ids visibles del feed al inicio del script y consulta final de diferencia vacía (línea base de la sección 1).
- Prueba completa con `--rollback` y consulta final de verificación.
- `currentTeamId` de las corredoras afectadas sin cambios; sin afiliaciones 2027 duplicadas; un solo movimiento vigente por corredora y temporada (salvo `midSeason`); afiliaciones 2026 sin cambios (el disparador `sync_rider_to_affiliation('female')` reacciona a las actualizaciones de la ficha).
- `announcedAt` = fecha del día en Europe/Madrid al modificar o confirmar una fila.
- Sin regeneración web.

## 9. Fuentes consultadas

- fuente externa (curl): [transfers](https://example.invalid), contratos [2026](https://example.invalid), [2027](https://example.invalid), [2028](https://example.invalid).
- fuente externa (navegador integrado): sin contrato [WWT](https://example.invalid), [PRW](https://example.invalid), [CTW](https://example.invalid); [altas femeninas](https://example.invalid); [retiradas](https://example.invalid); transfers y plantilla 2027 de los 14 equipos (`team/<slug>-2027/transfers`, `team/<slug>-2027`) y fichas de corredora.
- Cyclingnews: [índice de fichajes 2027](https://www.cyclingnews.com/pro-cycling/transfers/cycling-transfers-all-the-latest-news-and-announcements-for-the-2027-season/) (tablas «Women's WorldTour»; no recogen términos de contrato).
- IDL Pro Cycling, ProCyclingUK, Escape Collective, Sporza y Wielerflits (enlaces en las tablas); feed de Daniel Benson (sin contenido útil: solo avances de pago); Dicodusport sin cobertura femenina; Domestique (URL del resumen de transfers no disponible, 404).
- Páginas leídas íntegramente por `curl`: ProCyclingUK (Schrempf, Worst, Brand, Gutiérrez, Hesters vía extracto), IDL (Brand, Realini), Cyclingnews (Blasi, índice de fichajes), web de AG Insurance - Soudal. Páginas con 403 en `curl` y `WebFetch` (Cyclingnews Realini y Brand, Wielerflits): el contenido procede del titular y del extracto del buscador. Escape Collective, ProCyclingUK (Blasi, 2029), Velo y Sporza: solo extracto del buscador.
- Firecrawl no utilizado.

## 10. Aplicación (2026-10-13)

Dani aprobó el informe y amplió el alcance a Megan Arens, Erin Boothman y Puck Langenbarg. Aclaró que sobre Picnic PostNL no se especula con su continuidad y que sus fichajes, renovaciones y bajas sí se corrigen. El SQL se probó con `--rollback` (aserciones internas y verificación final) y se ejecutó después en una sola transacción.

| Operación | Filas |
| --- | --- |
| Bajas `?` borradas (continuidades de 3.2) | 10 |
| Afiliaciones `regular` 2027 insertadas (10 continuidades, Schrempf, Arens, Boothman, Langenbarg) | 14 |
| Afiliación 2027 de Arens a Picnic PostNL (`aff_1784552446933_9ma094`) borrada | 1 |
| `rider_transfers` actualizadas: Schrempf (`tr_1784552446934_3l2ki9`, destino SD Worx - Protime, 2027) y Worst (`tr_1784552446934_yslakl`, destino «Carbonbike Giordana Giofré by Gen Z») | 2 |
| `rider_transfers` insertadas: Boothman (Liv-AlUla-Jayco Continental → Liv-AlUla-Jayco) y Langenbarg (Fenix-Premier Tech Development Team → Fenix-Premier Tech), `contractUntil` 2028 (FC `contract.php?y=2028`), `dateVisible=false` | 2 |
| `riders_women.contractUntil` actualizadas (Faulkner, Anderson, Alvarado, Boothman, Langenbarg: 2028; Ghekiere, Moerman, Towers, Schweinberger, Van Sinaey, Van Alphen, De Wilde, Schrempf: 2027) | 13 |

Verificación posterior a la escritura:

- Feed visible: 338 ids con md5 `d88ece763c2a4c0bc5de1f7e72304457` (todos los géneros) y 112 con `b4d44a3e437ad2f3ceaf4656e3bfcc4e` (`female`); coinciden con la línea base.
- `currentTeamId` y afiliaciones 2026 de las 15 corredoras afectadas sin cambios (comparación de todas las columnas).
- Una afiliación `regular` 2027 por corredora (0 para Worst, destino en texto libre) y un solo movimiento vigente no `midSeason` por corredora.
- Bajas `?` desde equipos WWT: 56 → 44 (43 consistentes de 3.4 y Uijen).

Pendientes resueltos después por Dani (aplicados con el lote PRW, [informe PRW](fichajes-prw-femenino-20261013.md), sección 9):

- Lise Revol: rumor `tr_1786783373012_vlxk06` borrado.
- Josie Nelson: la renovación se mantiene en rumor (`tr_1784552446934_ibrltl`, afiliación 2027 sin año); sin cambios.
- Elise Uijen: sin cambios (baja `?`).
- Gaia Realini: `contractUntil` de la ficha corregido de 2027 a 2026.
