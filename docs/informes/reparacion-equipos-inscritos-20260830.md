# Reparación de equipos pendientes en listas de inscritos 2026 — 2026-08-30

## Alcance

Operación: `repair-unlinked-startlist-teams-2026-20260830`.

Se auditó el catálogo de `public.teams`, las filas de
`public.startlist_teams` y sus `startlist_riders` para todas las carreras con
`races.year=2026`. El objetivo era enlazar las ocurrencias repetidas de un
nombre con una identidad común cuando la evidencia era suficiente, crear una
identidad nueva cuando el nombre no estaba en el catálogo UCI y conservar
pendientes los estados que no representan un equipo.

Las selecciones regionales se trataron como selecciones, con
`teamKind='selection'`, `selectionScope='regional'` y categoría `NTM` o
`NTW`. No se convirtieron filas colectivas ni placeholders en corredores y no
se crearon startlists de Campeonatos Nacionales `resultsOnly`.

## Backup y trazabilidad

Antes de escribir se respaldaron en una tabla privada, con RLS habilitado y
lectura/escritura explícitas únicamente para `service_role`:

`private.repair_unlinked_startlist_teams_2026_backup`

| Entidad | Filas |
| --- | ---: |
| `startlist_teams` preexistentes sin `teamId` | 1.536 |
| aliases regionales preexistentes | 3 |
| equipos creados durante la operación | 834 |

La tabla conserva el `row_data` completo de cada fila respaldada. Las 1.536
filas respaldadas tienen una decisión en `public.team_link_decisions`; no hay
decisiones huérfanas.

## Método aplicado

Se mantuvieron separados los siguientes casos:

1. Coincidencia canónica única, con nombre plegado, alias o `foldedNames`,
   carrera compatible y sexo compatible: 243 filas enlazadas a una identidad
   existente.
2. Resolución automática controlada mediante `ensure_startlist_team`: 1.278
   filas. Se reutilizaron 444 identidades y se crearon 834 cuando no existía
   una identidad compatible.
3. Ambigüedades entre sénior, desarrollo, filial o continental: 15 filas
   enlazadas solo después de contrastar la inscripción oficial de 2026 y el
   bloque de corredores de cada carrera. La decisión quedó registrada con
   `matchMethod='official_source_directed'` y
   `source='official_startlist_2026'`.

Los 834 equipos nuevos quedan desglosados así:

| Identidad | Sexo | Ámbito | Categoría | Equipos |
| --- | --- | --- | --- | ---: |
| Club | masculino | — | `CLUBM` | 489 |
| Club | femenino | — | `CLUBW` | 303 |
| Selección | masculino | regional | `NTM` | 24 |
| Selección | masculino | nacional | `NTM` | 10 |
| Selección | femenino | nacional | `NTW` | 8 |

Se añadieron 12 aliases de selecciones regionales con
`source='regional_selection_rule'`. Se conservaron los tres aliases
regionales existentes. El conjunto español regional reconocido en esta pasada
incluye Andalucía, Aragón, Cantabria, Castilla y León, Castilla-La Mancha,
Catalunya, Comunidad de Madrid, Comunitat Valenciana, Euskadi, Extremadura,
Galicia, Islas Canarias, Navarra, Principado de Asturias y Región de Murcia.

## Ambigüedades resueltas con fuente oficial

| Ocurrencia | Identidad aplicada |
| --- | --- |
| `XDS Astana Team` — GP Miguel Indurain | `XDS Astana Team` sénior |
| `Team Visma | Lease a Bike` — NXT Classic | `Visma | Lease a Bike` sénior |
| `Decathlon CMA CGM Team` — Région Pays de la Loire Tour | sénior |
| `Team Novo Nordisk` — Région Pays de la Loire Tour | sénior |
| `AG Insurance - Soudal Team` — Scheldeprijs femenino | sénior |
| `Liv-Alula-Jayco` — Scheldeprijs femenino | sénior |
| `Bahrain - Victorious` — Tour de Limburgo | sénior |
| `Team Novo Nordisk` — Tour of Hainan | sénior |
| `XDS Astana Team` — Tour of Hainan | sénior |
| `Decathlon CMA CGM Team` — Classic Grand Besançon Doubs | sénior |
| `AG Insurance - Soudal Team` — Flecha de Brabante femenina | sénior |
| `Liv-Alula-Jayco` — Flecha de Brabante femenina | sénior |
| `Decathlon CMA CGM Team` — Tour du Jura | sénior |
| `AG Insurance - Soudal Team` — Grand Prix Féminin de Chambéry | sénior |
| `LIV-ALULA-Jayco` — Grand Prix Féminin de Chambéry | continental femenino |

Se registraron las URLs oficiales de carrera en `team_link_decisions`, entre
ellas [GP Miguel Indurain — participantes](https://gpmiguelindurain.com/wp-content/uploads/2026/04/XXVII-GRAN-PREMIO-MIGUEL-INDURAIN-participantes.pdf),
[Région Pays de la Loire Tour — equipos](https://www.regionpaysdelaloire-tour.fr/equipes-hommes),
[Scheldeprijs — noticia oficial](https://www.scheldeprijs.be/en/news/looking-for-the-successors-to-merlier-and-balsamo),
[Ronde van Limburg — noticia oficial](https://www.rondevanlimburg.be/en/news/who-will-succeed-milan-fretin),
[Classic Grand Besançon Doubs — dossier 2026](https://www.classicgrandbesancondoubs.com/medias/2026/PLAQUETTE-CLASSIC-GRAND-BESANCON-2026.pdf),
[Brabantse Pijl — lista oficial](https://www.debrabantsepijl.be/en/files/12ed5a99-34ca-11f1-9f83-0050569301fd/1776246734),
[Decathlon CMA CGM Team — resultados](https://decathloncmacgmteam.com/resultats/) y
[Grand Prix Féminin de Chambéry](https://www.facebook.com/GrandPrixFeminindeChambery/).

Cuando una misma inscripción contenía corredores sénior y de desarrollo, el
nombre oficial del bloque y la fuente de la carrera prevalecieron sobre la
afiliación individual actual. Esto evita separar una sola inscripción en
varias identidades por la composición contractual del roster.

## Resultado posterior

| Verificador | Resultado |
| --- | ---: |
| Filas `startlist_teams` 2026 | 8.895 |
| Filas enlazadas a `teams` | 8.761 |
| Nombres reales sin `teamId` | 0 |
| Placeholders sin `teamId` | 134 |
| Referencias de equipo colgantes | 0 |
| Incompatibilidades sexo carrera/equipo | 0 |
| Filas `startlist_riders` 2026 | 52.941 |
| Corredores sin `globalRiderId` | 0 |
| `globalRiderId` colgantes | 0 |
| Filas de corredor con fila de inscripción válida | 52.941 |
| Clasificaciones colectivas UCI 2026 | 5.470 |
| Colectivas con `teamId` | 5.470 |
| Colectivas con corredor o dorsal | 0 |
| Equipos con `gender` nulo | 0 |
| Conflictos categoría/sexo | 0 |

Los 134 placeholders corresponden a 124 filas `Individual`, cinco `Private
Member`, dos `Sin equipo`, dos `UN` y una `Un-Attached Leinster`. No se crea
una identidad de catálogo para ninguno de ellos.

Persisten 1.535 filas individuales de `race_uci_results` sin
`globalRiderId`, distribuidas en 106 carreras sin `startlist_riders`. No
forman parte de la reparación de equipos: requieren una fuente de identidad
de corredor o una startlist oficial y no se deben resolver por nombre de
equipo.

## Regla futura

La función `public.ensure_startlist_team` y el trigger de `startlist_teams`
continúan activos. El editor de listas de inscritos debe crear o reutilizar
obligatoriamente la identidad antes de guardar una fila con un equipo nuevo.
El filtro de sexo y la separación club/selección permanecen activos; una
ambigüedad no se resuelve por similitud. Los nombres regionales se clasifican
como selecciones y comparten el modelo nacional sin fusionarse con clubes.

## Rollback dirigido

El rollback debe restaurar primero `startlist_teams.teamId` usando únicamente
las filas `entity='startlist_teams'` del backup y después revisar las
decisiones derivadas. Como el trigger puede resolver de nuevo un `NULL`, la
restauración requiere una ventana de mantenimiento controlada y las mismas
comprobaciones de autorización que la operación original.

Los 834 equipos creados no se deben borrar automáticamente. Solo pueden
retirarse tras comprobar que no tienen referencias fuera de esta operación en
startlists, resultados, temporadas, afiliaciones o aliases. Los snapshots de
`entity='teams_created'` permiten esa comprobación; no autorizan por sí solos
un borrado.
