# Plantillas de clubes y selecciones — 2026-09-04

## Alcance y decisión

Estudio de las startlists 2026 asociadas a clubes del catálogo, tras la
regularización del 30 de agosto y las fusiones del 3 de septiembre. Se incluyen
las identidades canónicas supervivientes y las altas posteriores: 823 clubes,
506 masculinos y 317 femeninos. Tras la autorización expresa posterior de Dani,
se aplica la asignación histórica de los 3.570 candidatos sin afiliación ni
otro equipo regular observado, en 768 clubes.
Por indicación posterior de Dani, las incorporaciones futuras a startlists de
club sí generan automáticamente una afiliación de temporada.

La petición de impedir plantillas en selecciones sí se aplica: se retiran las
dos afiliaciones incorrectas auditadas y se impiden nuevas. La regla se refiere
al tipo de equipo. Ningún corredor queda excluido de futuras startlists o de
una posterior afiliación a un club.

## Viabilidad de incorporar clubes

La relación disponible es:

`startlist_riders.globalRiderId → startlist_teams.teamId → teams.id`

`startlist_riders.teamId` referencia la fila de inscripción del equipo, no su
identidad global. La temporada y el género proceden de `races`. Se cuentan
carreras distintas, evitando sumar etapas o filas duplicadas.

| Medida de la auditoría | Recuento |
| --- | ---: |
| Relaciones distintas corredor–club | 4.119 |
| Corredores distintos, con género | 3.930 |
| Clubes con relaciones de startlist | 823 |
| Relaciones ya reflejadas en equipo actual | 36 |
| Relaciones cuyo corredor tiene otro equipo actual | 74 |
| Relaciones sin equipo actual y con un único club observado | 3.648 |
| De ellas, sin afiliación 2026 | 3.645 |
| Candidatos sin afiliación ni otro equipo regular observado, incluido UCI | 3.570 |
| Clubes de esos candidatos | 768 |
| Candidatos observados en dos o más carreras | 1.200 |
| Clubes de esos candidatos repetidos | 284 |
| Candidatos observados en una sola carrera | 2.370 |

El criterio estricto descarta también las apariciones con otro equipo UCI,
aunque la ficha todavía no tenga afiliación. Una convocatoria con selección
no cuenta como otro equipo regular.

Ejemplos para revisar primero:

| Corredor / id | Club / id | Carreras distintas |
| --- | --- | ---: |
| Loes Sels / `sels-loes` | Belco-Van Eyck / `team_auto_981ccbefa11c8bdeedbf3a3be5b09cad` | 13 |
| Rose Kloese / `kloese-rose` | Carbonbike Giordana Giofré by Gen Z / `team_auto_80c6a8672976a1774ed01c3cf9f3fdd0` | 13 |
| Dina Scavone / `scavone-dina` | Carbonbike Giordana Giofré by Gen Z / `team_auto_80c6a8672976a1774ed01c3cf9f3fdd0` | 13 |
| Jakub Gilicki / `gilicki-jakub` | Mostostal Puławy Cycling Team / `team_auto_9ac817d53e431ce243d7ec332d6cb8b2` | 10 |

La repetición permite priorizar, pero no demuestra un contrato o licencia. El
catálogo puede carecer de participaciones en otros equipos; las carreras pueden
ser inscripciones provisionales o futuras. Tampoco permite deducir las fechas
efectivas de un fichaje a partir de la primera o última aparición.

La autorización posterior aplica el mismo criterio de incorporación desde
startlists a los 3.570 candidatos históricos, tanto repetidos como de una sola
carrera. Las filas llevan `source=startlist_club` y `verified=false`, sin
atribuir una verificación contractual ni inventar fechas. La presentación de la
plantilla es uniforme. Los casos con varias entidades o afiliaciones previas
siguen pendientes y no se sustituyen equipos UCI.

El manifiesto reproducible está en
[`audit-club-rosters.sql`](../../scripts/data-preflight/audit-club-rosters.sql).
Devuelve por pareja los identificadores, carreras fuente, afiliaciones vigentes,
veredicto y estado pendiente. Es exclusivamente `SELECT`; no genera escrituras.
Los riesgos comunes de sus ítems son la participación invitada, la falta de
cobertura y los fichajes dentro de temporada. Tras aplicar el lote, sus candidatos
pasan a `already_current`. El manifiesto anterior a la escritura se conserva
en el respaldo privado descrito en el cierre histórico.

## Cierre de la asignación histórica

Aplicación completada el 2026-09-04 mediante
`private.add_startlist_club_roster_member`, el mismo mecanismo de las
incorporaciones futuras. Se congela el manifiesto antes de escribir y se
ejecutan doce lotes: once de 300 filas y uno de 270. Cada lote vuelve a comprobar
la ficha completa, la inscripción fuente, equipo, género, temporada y
afiliaciones anteriores. Las filas aplicadas se registran por su identificador
exacto; reanudar la operación omite las ya aplicadas.

| Resultado | Recuento |
| --- | ---: |
| Afiliaciones creadas en 2026 | 3.570 |
| Corredores | 2.439 |
| Corredoras | 1.131 |
| Clubes masculinos receptores | 476 |
| Clubes femeninos receptores | 292 |
| Equipos actuales actualizados desde nulo | 3.570 |
| Candidatos del manifiesto pendientes de aplicar | 0 |
| Duplicados de afiliación del lote | 0 |
| Afiliaciones a selecciones | 0 |

Se conservan íntegramente 8.980 filas de inscritos y 36.259 resultados
referenciados por los corredores del lote, así como las 4.956 afiliaciones
preexistentes. La comparación usa recuentos y hashes de las filas completas.
Las fichas solo cambian `currentTeamId` y `updatedAt`.

El detector de clubes devuelve 3.606 relaciones ya reflejadas en equipo actual
(las 36 anteriores más las 3.570 nuevas). Permanecen fuera del lote 436
relaciones con varios equipos regulares observados, 74 cuyo corredor tiene
otro equipo actual y tres con afiliaciones preexistentes. Son relaciones
corredor–club, no necesariamente corredores distintos.

Respaldo: `private.historical_club_rosters_20260904_backup`, creado mediante
`20260904065036_backup_historical_club_rosters_20260904.sql`. Contiene:

- `manifest`: 3.570 filas con evidencia, ficha y afiliaciones anteriores.
- `applied`: 3.570 filas con la afiliación creada y la ficha resultante.
- `control`: estados anterior y posterior con recuentos y hashes.

Los archivos locales de ejecución están en
`output/historical-club-rosters-20260904/`: `apply-batch.sql`,
`verify.sql` y `verification.json`. No se publican en Git.

Para revertir este lote, comprobar primero que cada afiliación y ficha siguen
iguales a `affiliationAfter` y `riderAfter` de su fila `applied`. Retirar
únicamente las afiliaciones con esos ids; el trigger inverso recalcula el equipo
actual. Verificar el resultado frente a `riderBefore` y restaurar su timestamp
previo si no existen cambios posteriores. No reescribir fichas completas ni
borrar por `source` global: otras incorporaciones comparten ese origen.
Conservar el respaldo y las convocatorias.

## Manifiesto de selecciones

| Corredor | Selección | Afiliación retirada | Estado |
| --- | --- | --- | --- |
| Allassane Ouattara (`ouattara-allassane`) | Burkina Faso (`team_ntm_burkina-faso`) | `ouattara-allassane__team_ntm_burkina-faso__2026` | Reparado |
| Marc Didier Tchumthoua Mouaffo (`tchumthoua-mouaffo-marc-didier`) | Cameroon (`team_ntm_cameroon`) | `tchumthoua-mouaffo-marc-didier__team_ntm_cameroon__2026` | Reparado |

Ambas afiliaciones tenían `source=panel`, sin fechas, creadas el 29 de agosto.
Cada corredor aparece convocado por su selección en Grand Prix Chantal Biya y
Grand Prix d'Ongola. No había otra afiliación. El veredicto es pertenencia
permanente incorrecta a una selección; era reparable retirando solo la afiliación.
El riesgo era eliminar también sus convocatorias, evitado mediante comparación
íntegra de las filas de startlist y resultados antes y después.

Resultado: cero afiliaciones a selecciones y cero `currentTeamId` a selecciones.
Los dos equipos actuales quedan nulos. Se conservan íntegramente las cuatro
filas de startlist, los ocho resultados y las dos fichas.

## Prevención

Se considera selección cualquier equipo con `teamKind=selection` o categoría
`NTM/NTW`, incluidas las regionales. Los triggers:

- rechazan afiliaciones de cualquier temporada, incluidas las fechadas;
- rechazan asignaciones directas de `currentTeamId` en ambas tablas de corredores;
- impiden reclasificar como selección un equipo que conserva afiliaciones.

La escritura en `startlist_teams` y `startlist_riders` mantiene su contrato.
La selección continúa en el catálogo y en el selector de equipos participantes.
El panel oculta la plantilla permanente y excluye selecciones del selector de
equipo actual de la ficha. El buscador general de corredores sigue disponible.

Las guardas usan `SECURITY INVOKER`, privilegios explícitos y un bloqueo
transaccional compartido por identificador de equipo. No requieren conceder al
worker de resultados escritura sobre `teams`.

Migraciones:

- `20260904062841_prevent_selection_rosters.sql`
- `20260904063104_serialize_selection_roster_guards.sql`

## Incorporaciones futuras a clubes

La migración `20260904063929_auto_club_rosters_from_startlists.sql` incorpora
automáticamente cada ficha canónica añadida o enlazada en una startlist de
`CLUBM/CLUBW` a `rider_team_affiliations`, con la temporada y el género de la
carrera. También cubre el enlace posterior del equipo de la startlist y las
ediciones especiales cuyo equipo canónico sea un club. No recorre startlists
anteriores durante el despliegue.

La afiliación lleva `source=startlist_club`, `verified=false` y fechas nulas
pertenecientes a esa temporada, sin fabricar fechas de contrato. Una pareja
corredor–club–temporada ya afiliada se conserva íntegra, aunque tenga fechas
curadas. Los reintentos y las apariciones repetidas no duplican la afiliación.
Si la inscripción se creó sin ficha enlazada, el alta se produce cuando recibe
su `globalRiderId`; la importación completa exige resolver esa identidad.

Las afiliaciones previas no se borran. `recompute_current_team` mantiene como
prioridad las afiliaciones curadas activas; si solo hay incorporaciones
automáticas activas, usa el orden temporal de afiliaciones existente. Un alta
en una temporada pasada o futura no cambia el equipo actual. La plantilla
presenta todos los corredores del mismo modo, sin etiqueta de procedencia.

Una convocatoria con selección no crea afiliación, ni impide incorporarse más
tarde a un club. Tampoco genera afiliación automática una participación con
un equipo UCI. La regla es un alta de plantilla: borrar o sustituir después una
inscripción no elimina afiliaciones ya incorporadas. Una corrección de
pertenencia se realiza en el editor de plantilla.

La función escritora se invoca mediante triggers privados, sin RPC pública.
Los roles que guardan startlists conservan sus permisos; el worker no recibe
escritura directa en afiliaciones. El modelo inverso se recalcula explícitamente
porque su trigger existente omite escrituras anidadas.

La prueba reversible
[`auto-club-rosters.sql`](../../scripts/data-preflight/tests/auto-club-rosters.sql)
cubre ambos géneros, enlace tardío, cambios del equipo de inscripción,
idempotencia, temporada futura, prioridad de afiliaciones curadas y selecciones.

## Respaldo, comprobación y recuperación

`private.repair_selection_rosters_20260904_backup` conserva cinco filas:
manifiesto, dos fichas completas y dos afiliaciones completas. La migración
comprueba ids, equipos, temporada, fechas y timestamps antes de borrar; aborta
si aparece una afiliación de selección fuera del manifiesto.

La prueba transaccional
[`selection-rosters.sql`](../../scripts/data-preflight/tests/selection-rosters.sql)
comprueba convocatorias de los dos corredores con club y selección, su posterior
afiliación a un club, y rechazos de plantillas nacionales y regionales,
actuales y futuras. Termina con `ROLLBACK`.

La recuperación de datos debe ejecutarse mediante una nueva migración dirigida,
previa revisión de cambios posteriores. Restaurar esas afiliaciones incorrectas
exige retirar primero las guardas que las prohíben; no deshabilitarlas para
registrar una convocatoria. Para deshacer solo la interfaz, revertir sus cambios
en `panel.js` y `team-roster.js`; el respaldo y las guardas de datos permanecen.
Conservar las tablas de respaldo.

Para detener únicamente las altas automáticas futuras, retirar los triggers
`sync_startlist_rider_club_roster` y `sync_startlist_team_club_roster` mediante
migración. Las filas `source=startlist_club` ya generadas se revisan por
corredor, equipo y temporada antes de una eventual retirada; no borrarlas por
un filtro global.
