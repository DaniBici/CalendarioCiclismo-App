# Revisión de fichajes: ProTeams femeninos (PRW), mercado 2027 (fase 1)

- Fecha de la consulta: 2026-10-13, después de aplicar las correcciones de los WWT ([informe WWT](fichajes-wwt-femenino-20261013.md)).
- Estado: fase 1 de solo lectura; las correcciones aprobadas por Dani se aplicaron el mismo día (sección 9).
- Alcance: `team_seasons.category='PRW'`, `gender='female'`, año 2027 (8 equipos: Cofidis Women Team, Decathlon CMA CGM, Laboral Kutxa - Fundación Euskadi, Lotto Intermarche Ladies, Ma Petite Entreprise, Mayenne Monbana My Pie, St Michel - Preference Home - Auber93, VolkerWessels Cycling Team); `rider_transfers.season=2027`, `riderGender='female'`; plantilla = `riders_women.currentTeamId` del equipo (97 fichas; Decathlon CMA CGM es equipo nuevo y no tiene plantilla 2026).

## 1. Línea base del feed público

Misma consulta y valores que antes de las correcciones WWT (las escrituras WWT no alteraron el feed):

| Ámbito | ids visibles | md5 de los ids ordenados (`COLLATE "C"`, separador `,`) |
| --- | --- | --- |
| Todos los géneros | 338 | `d88ece763c2a4c0bc5de1f7e72304457` |
| Solo `female` | 112 | `b4d44a3e437ad2f3ceaf4656e3bfcc4e` |

## 2. Recuentos

| Concepto | Recuento |
| --- | --- |
| Filas 2027 femeninas con origen o destino en un PRW | 96 (65 `transfer` confirmadas, 16 `renewal` confirmadas, 13 `transfer` en rumor, 2 `retirement`) |
| Bajas `?` desde un equipo PRW | 37 |
| — con respaldo para corregir (continúan en 2027) | 18 |
| — con respaldo para corregir (destino conocido) | 1 |
| — consistentes con las fuentes (mantener) | 18 |
| Plantilla PRW sin movimiento y sin afiliación 2027 («sin decidir») | 0 (29 con afiliación sin movimiento, 68 con movimiento) |
| Rumores con origen o destino PRW | 13 (11 hacia Decathlon CMA CGM; Vollering y Schoens, ya tratadas en el informe WWT) |
| Dudas `renewal` en `doubt` | 0 |
| Retiradas registradas | 2 (Arzuffi, Boilard), coherentes con fuente externa |
| Altas 2027 publicadas por fuente externa (`2027 In`, más Meeusen en Lotto, página 2028) con fila en la base | 24 de 24 |

Plantilla por equipo (afiliación sin movimiento / con movimiento): Cofidis 7/8, Laboral Kutxa 9/6, Lotto Intermarche Ladies 1/13, Ma Petite Entreprise 0/10, Mayenne Monbana My Pie 2/10, St Michel 6/6, VolkerWessels 4/15.

## 3. Bajas `?` (37)

Las 37 filas proceden de la carga inicial del 2026-07-20 (`dateVisible=false`, sin `contractUntil`) y de los vencimientos 2026 de fuente externa (FC): las 37 figuran en `contract.php?y=2026&g=1`. El contraste con fuente externa (fuente externa) las divide en tres grupos. fuente externa estuvo caído unos minutos durante la revisión (HTTP 522/500) y se recuperó antes de recoger los datos.

Criterio: la lista fuente externa de sin contrato (`teamlevel=prw`, 23 corredoras) es la comprobación más actual; la plantilla 2027 de fuente externa y la ficha de corredora indican equipo y tramo de contrato registrados.

### 3.1 Corregir con respaldo: continúan en 2027 (18)

fuente externa las incluye en la plantilla 2027 de su equipo, en el bloque «2027 Out ?» de sus transfers (contrato que termina en 2027) y con ficha «2027»; ninguna figura en la lista de sin contrato. No se localizó anuncio oficial: el respaldo es el registro de fuente externa, igual que en las 10 continuidades WWT aprobadas.

| Fila | Corredora | Equipo | Año propuesto |
| --- | --- | --- | --- |
| `tr_1784552446934_lo60cg` | Ema Comte | Cofidis Women Team | 2027 |
| `tr_1784552446934_uu4mv4` | Hannah Ludwig | Cofidis Women Team | 2027 |
| `tr_1784552446934_5ht0mj` | Dina Boels | Lotto Intermarche Ladies | 2027 |
| `tr_1784552446934_tpl630` | Ilken Seynave | Lotto Intermarche Ladies | 2027 |
| `tr_1784552446934_9t9sfo` | Julie Brouwers | Lotto Intermarche Ladies | 2027 |
| `tr_1784552446934_bx09gi` | Lani Wittevrongel | Lotto Intermarche Ladies | 2027 |
| `tr_1784552446934_ihoxgb` | Linda Riedmann | Lotto Intermarche Ladies | 2027 |
| `tr_1784552446934_auf9qn` | Marieke Meert | Lotto Intermarche Ladies | 2027 |
| `tr_1784552446934_gjdywu` | Romina Hinojosa | Lotto Intermarche Ladies | 2027 |
| `tr_1784552446934_ervc8s` | Sterre Vervloet | Lotto Intermarche Ladies | 2027 |
| `tr_mpe_rouat-ilona_80857` | Ilona Rouat | Ma Petite Entreprise | 2027 |
| `tr_mpe_marasco-margot_21195` | Margot Marasco | Ma Petite Entreprise | 2027 |
| `tr_1784552446934_j0v8jf` | Elyne Roussel | St Michel - Preference Home - Auber93 | 2027 |
| `tr_1784552446934_dqr7r3` | Anne Knijnenburg | VolkerWessels Cycling Team | 2027 |
| `tr_1784552446934_9ky1in` | Anneke Dijkstra | VolkerWessels Cycling Team | 2027 |
| `tr_1784552446934_56jhap` | Florien Bolks | VolkerWessels Cycling Team | 2027 |
| `tr_1784552446934_2qdyaz` | Malou Eisen | VolkerWessels Cycling Team | 2027 |
| `tr_1784552446934_acugau` | Vera Tieleman | VolkerWessels Cycling Team | 2027 |

Corrección propuesta: borrar la fila `?`; insertar afiliación `regular` 2027 al propio equipo (2027-01-01..2027-12-31); `riders_women.contractUntil` 2027. Sin fila `renewal`.

### 3.2 Corregir con respaldo: destino conocido (1)

| Fila | Corredora | Evidencia | Corrección propuesta |
| --- | --- | --- | --- |
| `tr_1784552446934_fydc92` | Jenaya Francis (Mayenne Monbana My Pie) | [Cyclingnews](https://www.cyclingnews.com/pro-cycling/transfers/cycling-transfers-all-the-latest-news-and-announcements-for-the-2027-season/) (tabla Mayenne-Monbana-MyPie, `Out`: «Team Avesnois»); [fuente externa Mayenne](https://example.invalid) («2026 Out» a Team Avesnois); FC la da en vencimientos 2026 | `transfer` confirmada con destino en texto libre «Avesnois» (nombre del catálogo, `CLUBW`; fuente externa: «Team Avesnois»), `dateVisible=false`, sin afiliación ni `contractUntil` |

### 3.3 Consistentes con las fuentes: mantener (18)

Todas figuran en «2026 Out ?» de la página de transfers de su equipo en fuente externa y en la lista fuente externa de sin contrato; FC las da como vencimiento 2026. Ninguna aparece en las altas publicadas por fuente externa ni en la plantilla 2027 de otro equipo. Ninguna figura en `teams/retiring`.

| Fila | Corredora | Equipo |
| --- | --- | --- |
| `tr_1784552446934_rymo9m` | Victoire Berteau | Cofidis Women Team |
| `tr_1784552446934_4wv2mi` | Nikola Nosková | Cofidis Women Team |
| `tr_1784552446934_rtj3yz` | Špela Kern | Cofidis Women Team |
| `tr_1784552446934_masdqq` | Arianna Fidanza | Laboral Kutxa - Fundación Euskadi |
| `tr_1784552446934_ga6qlh` | Debora Silvestri | Laboral Kutxa - Fundación Euskadi |
| `tr_1784552446934_osd6w2` | Vittoria Ruffilli | Laboral Kutxa - Fundación Euskadi |
| `tr_1784552446934_matjl7` | Anna van Wersch | Lotto Intermarche Ladies |
| `tr_1784552446934_cj7qs2` | Lea Lin Teutenberg | Lotto Intermarche Ladies |
| `tr_mpe_avoine-alison_61797` | Alison Avoine | Ma Petite Entreprise |
| `tr_mpe_coston-morgane_21336` | Morgane Coston | Ma Petite Entreprise |
| `tr_1784552446934_qzmqh4` | Allison Mrugal | Mayenne Monbana My Pie |
| `tr_1784552446934_w7q1eq` | Fiona Mangan | Mayenne Monbana My Pie |
| `tr_1784552446934_odz4pf` | Marine Allione | Mayenne Monbana My Pie |
| `tr_1784552446934_y0y4i4` | Natalie Quinn | Mayenne Monbana My Pie |
| `tr_1784552446934_c8a15i` | Emilie Morier | St Michel - Preference Home - Auber93 |
| `tr_1784552446934_7ylgde` | Sabrina Stultiens | VolkerWessels Cycling Team |
| `tr_1784552446934_bcrfi8` | Meis Poland | VolkerWessels Cycling Team |
| `tr_1784552446934_lbf3hf` | Tirza Wisse | VolkerWessels Cycling Team |

### 3.4 Plantilla sin decidir y retiradas

- Sin decidir: ninguna. Las 97 fichas tienen un movimiento 2027 o una afiliación `regular` 2027.
- Las 45 corredoras que continúan sin fila de movimiento (afiliación 2027 o solo `renewal`) figuran todas en la plantilla fuente externa 2027 de su equipo y ninguna en la lista de sin contrato.
- Retiradas: Alice Maria Arzuffi (`tr_1787763123740_r3ozk2`) y Simone Boilard (`tr_1784552446934_t986ej`) coinciden con fuente externa.

## 4. Rumores (13)

| Filas | Corredoras | Evidencia | Clasificación |
| --- | --- | --- | --- |
| `tr_97f52f4e-6360-488e-9731-ef48e4b057d3`, `tr_204605cf-3239-4714-83f4-6e53982ca629`, `tr_1788347671257_6j65xj`, `tr_6d53d3b2-8413-4ba3-b0f5-2b8d806710fc`, `tr_1788347739414_12g2yv`, `tr_1cc2f561-d21b-4e57-a4c3-adeceffbc09a`, `tr_cfae4cdc-78d2-45d4-9ad7-838d134b433e`, `tr_55fb0179-b55c-4e6e-8ffa-311d81c960ab`, `tr_69f76c21-7405-41d6-8f04-aa20dbe5603a` (visibles, 2026-09-02) | Greta Seiwald, Samara Maxwell, Justine Baud, Laly Pichon, Lidia Castro, Zoe Roche, Anna Dubier, Laura Lizette Sander, Lien Schampaert → Decathlon CMA CGM | Lista de 11 fichajes «reportados» por Daniel Benson ([ProCyclingUK, 2026-09-02](https://procyclinguk.com/decathlon-cma-cgm-womens-2027-line-up-takes-shape-with-samara-maxwell-oceane-mahe-among-11-signings/)); Decathlon no ha presentado plantilla; fuente externa (`decathlon-cma-cgm-women-team-2027`) y Cyclingnews («N/A – new team») no registran corredoras | Mantener en rumor |
| `tr_mpe_mahe-oceane_33113` (oculta), `tr_1784552446934_1fm9ai` (oculta) | Océane Mahé (Ma Petite Entreprise), Laura Molenaar (VolkerWessels) → Decathlon CMA CGM | Nombradas en la misma lista de Benson; ambas figuran en la lista fuente externa de sin contrato y en «2026 Out ?» de su equipo (consistente con la salida) | Mantener en rumor |
| `tr_1784552446934_i6lbj2`, `tr_1784552446934_0pnsrv` | Bodine Vollering → EF Education - Oatly; Quinty Schoens → UAE L'IMAD | Sin respaldo del destino; ambas en la lista fuente externa de sin contrato (VolkerWessels) | Sin respaldo localizado (ver [informe WWT](fichajes-wwt-femenino-20261013.md)). No modificar |

## 5. Otras comprobaciones

- Las 23 altas «2027 In» de fuente externa (Cofidis 4, Laboral Kutxa 5, Ma Petite Entreprise 6, Mayenne Monbana My Pie 4, St Michel 3, VolkerWessels 1; Lotto sin altas) y Anna Meeusen (Lotto, fuente externa 2028) tienen fila `transfer` confirmada en la base. Decathlon CMA CGM no registra altas en fuente externa.
- Yanina Kuskova (Laboral Kutxa → Queen Sport según fuente externa): sin fila ni plantilla (`currentTeamId` NULL). Fuera de alcance.

## 6. Decisiones pendientes para Dani

1. Aplicar las 18 continuidades de 3.1 con respaldo solo de fuente externa (mismo criterio que las 10 WWT), con año 2027.
2. Francis: destino en texto libre «Avesnois» (catálogo) o «Team Avesnois» (fuente externa).
3. Pendientes del informe WWT que siguen abiertos: Josie Nelson (renovación en rumor, Picnic PostNL), Lise Revol, Elise Uijen (Picnic PostNL) y la ficha de Realini. Dani aclaró que de Picnic no se especula con la continuidad del equipo y que sus fichajes y renovaciones sí se corrigen.

## 7. Efectos de escritura propuestos (fase 2, tras aprobación)

| Operación | Filas | Detalle |
| --- | --- | --- |
| `DELETE rider_transfers` | 18 | Las bajas `?` de 3.1 |
| `UPDATE rider_transfers` | 1 | Francis (`toTeamName`, `dateVisible=false`, `announcedAt` = hoy en Europe/Madrid) |
| `INSERT rider_team_affiliations` | 18 | `regular` 2027-01-01..2027-12-31, `id` `aff_<ms>_<rand6>`, `source='manual'`, `verified=true` |
| `UPDATE riders_women.contractUntil` | 18 | 2027 |
| Rumores y retiradas | 0 | Sin cambios |

Verificaciones: mismo guion transaccional que en WWT (línea base del feed, `--rollback` previo, `currentTeamId` y afiliaciones 2026 sin cambios, una afiliación `regular` 2027 por corredora, un solo movimiento vigente no `midSeason`, sin regeneración web).

## 8. Fuentes consultadas

- fuente externa (curl): contratos [2026](https://example.invalid), [2027](https://example.invalid), [2028](https://example.invalid); [transfers ProTeam](https://example.invalid) (solo altas).
- fuente externa (navegador integrado): [sin contrato PRW](https://example.invalid); transfers y plantilla 2027 de los ocho equipos (`team/<slug>-2027/transfers`, `team/<slug>-2027`; Decathlon: `decathlon-cma-cgm-women-team-2027`) y fichas de corredora.
- Cyclingnews: [índice de fichajes 2027](https://www.cyclingnews.com/pro-cycling/transfers/cycling-transfers-all-the-latest-news-and-announcements-for-the-2027-season/) (sección «Women's Pro Teams»: In/Out/Extended).
- ProCyclingUK (Decathlon, curl) y búsquedas web (Domestique, Cyclingnews, Wielerflits: extractos del buscador).
- Firecrawl no utilizado.

## 9. Aplicación (2026-10-13)

Dani aprobó las 18 continuidades y la corrección de Francis («Avesnois», nombre del catálogo), y resolvió los pendientes WWT: borrar la fila de Revol, mantener la renovación de Nelson en rumor, no tocar a Uijen y corregir la ficha de Realini. El SQL se probó con `--rollback` (aserciones internas y verificación final) y se ejecutó después en una sola transacción.

| Operación | Filas |
| --- | --- |
| Bajas `?` borradas (continuidades de 3.1) | 18 |
| Afiliaciones `regular` 2027 insertadas (2027-01-01..2027-12-31, `source='manual'`) | 18 |
| `riders_women.contractUntil` = 2027 | 18 |
| `rider_transfers` actualizada: Francis (`tr_1784552446934_fydc92`, destino «Avesnois», `dateVisible=false`) | 1 |
| Rumor de Revol (`tr_1786783373012_vlxk06`) borrado | 1 |
| Ficha de Realini: `contractUntil` 2027 → 2026 (rescisión anticipada acordada con Lidl-Trek) | 1 |

Sin cambios: Josie Nelson (`tr_1784552446934_ibrltl`, `renewal` en rumor, afiliación 2027 sin año) y Elise Uijen (`tr_1784552446934_0r2d30`, baja `?`).

Verificación posterior:

- Feed visible: 338 ids con md5 `d88ece763c2a4c0bc5de1f7e72304457` y 112 `female` con `b4d44a3e437ad2f3ceaf4656e3bfcc4e`; coinciden con la línea base.
- `currentTeamId` y afiliaciones 2026 de las 21 corredoras afectadas sin cambios (todas las columnas).
- Una afiliación `regular` 2027 por cada una de las 18 y ninguna para Francis, Revol y Realini; un solo movimiento vigente no `midSeason` por corredora.
- Bajas `?` desde equipos PRW: 37 → 18 (las consistentes de 3.3). Desde equipos WWT: 44 (sin cambios en esta ejecución).
