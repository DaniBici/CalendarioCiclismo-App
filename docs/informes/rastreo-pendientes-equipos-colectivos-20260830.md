# Rastreo de equipos pendientes en clasificaciones colectivas UCI 2026 — 2026-08-30

## Alcance y estado de entrada

Operación: `pending-collective-team-rastreo-20260830`.

Se continuó la auditoría de las filas de `public.race_uci_results` asociadas a
stages con `classKind='teams'` o `isTeamEvent=true`, carrera 2026,
`globalRiderId IS NULL` y `teamId IS NULL`. El censo completo contiene 5.470
filas. Las 18 filas adicionales respecto de las 5.452 comunicadas pertenecen
al `Clubklassement` de Dwars door het Hageland y se mantienen pendientes por
no tener startlist ni `sourcePdfUrl`.

Antes de esta operación, ocho filas de `NATIONAL TEAM ESTONIA` ya estaban
enlazadas en una operación independiente con evidencia oficial. El estado de
entrada de este lote era:

| Métrica | Valor |
| --- | ---: |
| Colectivas 2026 | 5.470 |
| Ya enlazadas | 5.105 |
| Pendientes | 365 |
| Filas respaldadas para este lote | 326 |
| Filas de `startlist_teams` respaldadas | 7 |

El backup privado es
`private.pending_collective_team_rastreo_20260830_backup`, con RLS habilitado y
privilegios explícitos solo para `service_role`.

## Segunda pasada dirigida y cierre del lote

La operación `repair_pending_collective_team_rastreo_v2` partió de las 39 filas
pendientes anteriores. El manifiesto se limitó a nombres colectivos concretos,
carrera 2026, sexo de la carrera y fuente oficial por ocurrencia. El backup
privado de esta segunda pasada es
`private.pending_collective_team_rastreo_v2_20260830_backup`, con RLS habilitado
y privilegios explícitos solo para `service_role`.

| Bloque | Filas | Resolución |
| --- | ---: | --- |
| Baltic Chain Tour — selecciones de Argelia y Polonia | 12 | Reutilización de las selecciones nacionales `Algeria` y `Poland` |
| Tour del Porvenir — `NETCOMPANY INEOS RACING ACADEMY` | 6 | Reutilización de `INEOS Grenadiers Racing Academy` (`team_devo_ineos`) y alias oficial |
| Vuelta Femenina a Guatemala — `ASO SOLOLÁ-INTERCOP` | 3 | Nuevo club femenino `Aso Sololá-Intercop`, enlazado también a la fila de inscritos `Asociación de Sololá` |
| Dwars door het Hageland — `Clubklassement` | 18 | 14 reutilizaciones y cuatro nuevos clubes femeninos |

Los cuatro clubes femeninos nuevos de Hageland son `Jan van Arckel Women`,
`Révvi-EGS Group-Velopro`, `The Lead Out Cycling Academy` y `WV Breda Women
Cycling Team`. El nombre masculino ya existente de The Lead Out no se reutilizó.
No se creó una startlist sintética para Hageland.

Fuentes oficiales utilizadas en esta segunda pasada: [equipos 2026 del Baltic
Chain Tour](https://balticchaintour.com/teams-2026/), [equipos y corredores del
Tour de l'Avenir](https://tourdelavenir.com/en/teams-riders/), [Federación
Guatemalteca — Asociación de Sololá](https://fedeciclismogua.org/asociaciones/asociacion-departamental-de-ciclismo-de-solola/),
[página oficial de Dwars door het Hageland Ladies](https://lottobelgiumcupwomen.be/dwars-door-het-hageland-ladies/),
[participantes oficiales de Lotto Belgium Cup Women](https://www.belgiancycling.be/app/uploads/2022/06/overzicht-deelnemende-ploegen-lotto-belgium-cup-women-2026.pdf),
[guía oficial Women Cycling Series 2026](https://wimhendrikstrofee.nl/wp-content/uploads/2026/03/Technische-Gids-2026-WCS-ver_2422026_Wim-Hendriks-Trofee.pdf),
[Révvi-EGS Group-Velopro](https://www.revvi-egsgroup-velopro.be/), [WV Breda
Women](https://www.wvbreda.nl/disciplines/vrouwen) y [calendario oficial de
Smurfit Westrock](https://smurfitwestrockcyclingteam.com/race-schedule).

## Criterio de enlace

Solo se aplicó un enlace cuando concurrían estas condiciones:

1. La fila era colectiva y no tenía `globalRiderId` ni dorsal.
2. El nombre de resultado estaba documentado por la fuente oficial de la
   carrera.
3. Existía una identidad canónica única en `public.teams`, sin edición
   especial y con sexo compatible.
4. La relación de inscritos o la continuidad oficial de la carrera permitía
   distinguir equipo sénior, filial, desarrollo, club o selección.
5. El `teamId` actual era NULL, salvo las dos correcciones dirigidas de
   inscritos descritas más abajo.

Las selecciones regionales se trataron con el mismo modelo de selección que las
nacionales. `SELECCIO CATALANA` quedó enlazada a `Catalunya` (`NTW`,
`selectionScope='regional'`). Las filas colectivas no se convirtieron en
corredores y no se crearon startlists de Campeonatos Nacionales
`resultsOnly`.

## Enlaces aplicados

| Carrera | Filas | Resolución | Fuente oficial |
| --- | ---: | --- | --- |
| Vuelta a Bélgica | 60 | 12 equipos del mismo startlist; se reutilizó el catálogo | [Baloise Belgium Tour](https://baloisebelgiumtour.be/en/team-presentation/) |
| Tour del Benelux (Renewi Tour) | 29 | 7 equipos; `Netcompany` se distinguió del desarrollo por el team presentation oficial | [Renewi Tour](https://renewitour.com/en/race-info-official-team-presentation/) |
| Baltic Chain Tour | 8 | Latvia; Estonia ya estaba resuelta en la operación anterior | [Equipos 2026](https://balticchaintour.com/teams-2026/) |
| Volta a Catalunya femenina | 26 | 7 equipos; Liv-AlUla-Jayco se corrigió a su filial `CTW` | [Participación oficial](https://www.voltacatalunya.cat/es/noticias/2026/la-volta-a-catalunya-espera-una-participacion-de-primer-nivel-mundial-para-su-3a-edicion-femenina/1514) |
| Baloise Ladies Tour | 25 | 3 reutilizaciones y 2 clubes; Carbonbike se reutilizó y Belco-Van Eyck se creó | [Baloise Ladies Tour](https://www.baloiseladiestour.com/nl) |
| Vuelta a Alemania | 20 | Germany y Storck-MRW Bau; el segundo se reutilizó del catálogo existente | [Deutschland Tour](https://www.deutschland-tour.com/en/) |
| Tour de los Pirineos | 18 | Canyon//SRAM Generation, Laboral Kutxa y Vendée Féminine | [Tour de los Pirineos](https://tourpyreneeswomen.com/) |
| Tour del Porvenir | 12 | Bahrain Victorious Development y United States | [Equipos y corredores](https://tourdelavenir.com/equipes-coureurs/) |
| Vuelta a Gran Bretaña femenina | 18 | Great Britain y Hitec | [British Cycling — equipos](https://www.britishcycling.org.uk/tourofbritain/women/teams) |
| Sibiu Tour | 15 | Kern Pharma, Hungary, Romania y Red Bull-BORA | [Sibiu Cycling Tour](https://turism.sibiu.ro/en/eveniment/sibiu-cycling-tour) |
| Vuelta a Mazovia | 15 | Atom 6, ATT Investments, EEW-VDK, Lotto Kern-Haus y Metec | [Mazovia Team](https://mazovia-team.pl/dookolamazowsza/) |
| Giro Next Gen | 10 | Picnic Development, Groupama-FDJ United CT, Italy y Technipes | [Giro Next Gen](https://www.gironextgen.it/en) |
| Vuelta a Colombia | 10 | Las cinco formaciones colombianas de la lista oficial | [Federación Colombiana de Ciclismo](https://federacioncolombianadeciclismo.com/150-corredores-de-22-equipos-disputaran-la-vuelta-a-colombia-sistecredito-2026/) |
| Premondiale Giro Toscana | 8 | Ukraine, USA, VolkerWessels y nuevo Team Buffaz | [Equipos oficiales](https://girodellatoscana.michelafanini.com/squadre/) |
| Vuelta a Polonia femenina | 8 | Poland y United States | [Tour de Pologne](https://www.tourdepologne.pl/en/uci-world-tour-teams/polish-national-team/) |
| Vuelta a Suiza femenina | 20 | Canyon//SRAM Zondacrypto y Switzerland | [Documentos oficiales](https://www.tourdesuisse.ch/en/women/media/documents/) |
| Kreiz Breizh | 6 | Dos desarrollos, Lotto Kern-Haus y nuevo Mayenne-Monbana-Rapido | [Equipos del organizador](https://www.sitekbe.com/2025/equipes/) |
| Tour de l'Ain | 6 | France U23 y Soudal Quick-Step Devo | [Equipos y corredores](https://tourdelain.com/equipes-coureurs/) |
| Vuelta a Eslovenia | 5 | Equipo Kern Pharma | [Lista oficial](https://tourofslovenia.si/storage/app/media/2026/race-start-list-51.pdf) |
| Giro della Valle d'Aosta | 4 | Campana, Team 74, Technipes y UC Monaco | [Equipos 2026](https://www.girovalledaosta.it/index.php/en/teams) |
| Tour de la Guadeloupe | 2 | Aarco y Competitive Edge Racing | [Lista de inscritos](https://letour-guadeloupe.fr/liste-engages.html) |
| Ruta de Occitania | 1 | Equipo Kern Pharma | [Organización de la carrera](https://laroutedoccitanie.fr/partenariats/en-route-vers-une-cinquantieme-rejouissante/) |

Total aplicado: 326 filas. Se añadieron 75 aliases de resultado verificados con
`source='official_collective_2026'` y 326 decisiones de enlace con
`matchMethod='official_source_directed'`.

## Equipos creados y correcciones de identidad

Se usó `ensure_startlist_team` con sexo explícito y se asignó la fila de
inscritos respaldada:

| Equipo | Categoría | Carrera | Motivo |
| --- | --- | --- | --- |
| `Belco-Van Eyck` | `CLUBW` | Baloise Ladies Tour | La fuente oficial lo identifica como club; no existía identidad reutilizable |
| `Mayenne-Monbana-Rapido` | `CLUBM` | Kreiz Breizh | La fila `Mayenne Monbana My Pie` estaba sin enlace en una carrera masculina y no debía reutilizar la identidad femenina |
| `Team Buffaz Gestion de Patrimoine` | `CLUBW` | Premondiale Giro Toscana | Equipo oficial sin identidad previa en el catálogo |

También se corrigieron dos enlaces preexistentes en `startlist_teams`:

- `Team Visma | Lease A Bike` del Renewi Tour: desarrollo masculino →
  `Visma | Lease a Bike` sénior `WT`.
- `Liv AlUla Jayco` de la Volta femenina: WorldTour femenino → `Liv AlUla
  Jayco Continental` `CTW`, porque la fuente oficial la identifica como filial
  continental.

Carbonbike se enlazó al club femenino existente
`Carbonbike Giordana Giofré by Gen Z`. `Competitive Edge` de Guadeloupe se
enlazó al club masculino existente `Competitive Edge Racing`; no se reutilizó
la identidad femenina homónima de Guatemala.

## Pendientes explícitos antes de la segunda pasada

El estado posterior deja 39 filas, con esta recomendación:

| Pendiente | Filas | Recomendación |
| --- | ---: | --- |
| Baltic Chain Tour — `NATIONAL TEAM ALGERIA` | 8 | Mantener NULL. La página oficial 2026 solo identifica Estonia y Latvia como selecciones nacionales; el nombre de la fila de inscritos no basta para contradecir la fuente. |
| Baltic Chain Tour — `NATIONAL TEAM POLAND` | 4 | Mantener NULL por el mismo conflicto de la página oficial 2026. |
| Tour del Porvenir — `NETCOMPANY INEOS RACING ACADEMY` | 6 | Mantener NULL. La fuente oficial confirma una identidad de academia, pero no existe fila equivalente en la startlist local; no debe fusionarse con `Netcompany INEOS` sénior ni con `INEOS Grenadiers Racing Academy`. Requiere alta dirigida de equipo y startlist. |
| Vuelta Femenina a Guatemala — `ASO SOLOLÁ-INTERCOP` | 3 | Mantener NULL. La fila de inscritos está sin equipo y no se obtuvo fuente oficial suficiente para crear o reutilizar la identidad. |
| Dwars door het Hageland — `Clubklassement` | 18 | Mantener NULL. No existe startlist correspondiente, `sourcePdfUrl` está vacío y no se debe inferir una clasificación colectiva por catálogo. |

No quedaba ninguna fila del alcance con sexo incompatible. Las 39 pendientes no
debían apuntar a corredores. La segunda pasada se ejecutó con fuente oficial
específica por identidad, no por similitud adicional de nombre.

## Verificador posterior de la operación inicial

Consultas ejecutadas mediante el conector MCP de Supabase:

```sql
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE r."teamId" IS NOT NULL) AS linked,
  count(*) FILTER (WHERE r."teamId" IS NULL) AS pending,
  count(*) FILTER (WHERE r."globalRiderId" IS NOT NULL) AS collective_riders,
  count(*) FILTER (WHERE r.bib IS NOT NULL) AS collective_bib
FROM public.race_uci_results r
JOIN public.race_uci_stages s ON s.id = r."stageRef"
JOIN public.races rc ON rc.id = s."raceId"
WHERE rc."year" = 2026
  AND (s."classKind" = 'teams' OR s."isTeamEvent" IS TRUE)
  AND r."globalRiderId" IS NULL;
```

Resultado: `total=5470`, `linked=5431`, `pending=39`,
`collective_riders=0`, `collective_bib=0`.

Otros controles: `gender_mismatch=0`, cero referencias colgantes en las 326
filas del backup, `backup_results=326` y `backup_results_linked=326`.

## Verificador posterior de la segunda pasada

La segunda pasada dejó el censo completo en `total=5470`, `linked=5470` y
`pending=0`. Las 39 filas de resultados del backup quedaron enlazadas, con
`globalRiderId IS NULL` y `bib IS NULL`; se registraron 39 decisiones de enlace.
La fila de inscritos de Sololá quedó enlazada y respaldada; el backup contiene
39 filas de resultados, una de `startlist_teams` y cinco equipos nuevos.

En el alcance 2026 no hay corredores globales ni dorsales en clasificaciones
colectivas, referencias colgantes en resultados colectivos ni referencias
colgantes en startlists. La auditoría posterior identificó que los únicos dos
equipos del catálogo con `teams.gender IS NULL` eran las ediciones especiales
`Mayenne Monbana My Pie` (`PRW`) y `T-Rex Quick-Step` (`WT`). La fuente UCI y sus
equipos padre confirmaron `female` y `male`, respectivamente.

## Reparación de `teams.gender IS NULL`

La operación `repair_team_gender_null_20260830` actualizó exclusivamente:

| Equipo | Filas colectivas 2026 | Valor aplicado | Evidencia |
| --- | ---: | --- | --- |
| `team_mayenne_monbana_my_pie_tdf_femmes_2026` | 18 | `female` | [UCI Women’s ProTeams 2026](https://fr.uci.org/pressrelease/attribution-des-14-licences-uci-womens-worldtour-et-18-licences-uci/6QRootu0WfaZVcXXJVQerE) y [ficha oficial del Tour de France Femmes](https://www.letourfemmes.fr/en/team/MMM/mayenne-monbana-my-pie?hasCookies=false&isWebview=true&partner=sbsapN) |
| `team_trex_quickstep_tdp_2026` | 8 | `male` | [UCI WorldTeams 2026](https://fr.uci.org/pressrelease/attribution-des-14-licences-uci-womens-worldtour-et-18-licences-uci/6QRootu0WfaZVcXXJVQerE) y [alineación oficial del Tour de Pologne](https://www.tourdepologne.pl/en/2026/07/23/soudal-quick-step-to-line-up-with-hayter-and-magnier-at-the-83rd-tdp/) |

El backup privado es
`private.repair_team_gender_null_20260830_backup`, con dos filas completas de
`teams`, RLS habilitado y lectura únicamente para `service_role`. No se
modificaron `race_uci_results`, `startlist_teams`, `team_seasons` ni
`rider_team_affiliations`.

El catálogo queda con cero equipos `gender NULL` y cero conflictos entre
categoría y sexo.

## Rollback dirigido

Solo si se autoriza expresamente:

```sql
UPDATE public.race_uci_results r
SET "teamId" = (b.row_data->>'teamId')
FROM private.pending_collective_team_rastreo_20260830_backup b
WHERE b.operation = 'pending-collective-team-rastreo-20260830'
  AND b.entity = 'race_uci_results'
  AND r.id::text = b.row_id;
```

La restauración de inscritos debe utilizar las siete filas respaldadas en la
misma tabla. Los tres equipos nuevos no se eliminan automáticamente durante un
rollback: antes habría que verificar que no tengan referencias posteriores.

## Migraciones

- `20260830130000_backup_pending_collective_team_rastreo.sql`
- `20260830131500_create_pending_collective_teams.sql`
- `20260830132000_link_pending_collective_team_rastreo.sql`
- `20260830145000_repair_pending_collective_team_rastreo_v2.sql`
- `20260830150000_repair_team_gender_null_20260830.sql`
