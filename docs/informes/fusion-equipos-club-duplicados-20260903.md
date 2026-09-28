# Fusión de equipos de club duplicados — 2026-09-03

## Alcance

Auditoría y reparación del catálogo 2026 de equipos `CLUBM` y `CLUBW`, incluidos los equipos de club creados automáticamente que duplicaban una ficha continental o WorldTeam ya existente.

Estado inicial:

- `CLUBM`: 597 equipos.
- `CLUBW`: 359 equipos.
- Total: 956 equipos de club.

## Criterios de identidad

La detección combinó:

1. igualdad del nombre normalizado por `fold_team_name`;
2. igualdad compacta y por orden de tokens;
3. similitud nominal;
4. solapamiento de corredores enlazados mediante las startlists;
5. aliases y nombres brutos procedentes de cada organizador;
6. categoría y género;
7. comprobación de coaparición en una misma carrera;
8. fuentes oficiales o del propio equipo para los casos que no podían resolverse solo con los datos internos.

La coaparición de dos candidatos en la misma carrera actuó como veto durante la auditoría automática. La revisión manual posterior autorizó dos excepciones en campeonatos nacionales: varias denominaciones de BIKE AID y Minimax representaban bloques del mismo equipo UCI y debían agruparse bajo su fila UCI de la prueba. La coincidencia de corredores sin identidad nominal suficiente no se consideró prueba de duplicidad.

## Resultado aplicado

Las tres migraciones contienen el manifiesto exacto `old_id → survivor_id` y el nombre canónico de cada grupo:

- `20260903062152_merge_duplicate_club_teams_20260903.sql`
- `20260903062711_merge_verified_club_team_followup_20260903.sql`
- `20260903083013_merge_manual_club_team_decisions_20260903.sql`

Resultado conjunto:

- 136 fichas redundantes eliminadas: 94 masculinas y 42 femeninas.
- 108 equipos canónicos receptores.
- 214 referencias redundantes de `startlist_teams.teamId` resueltas: 211 repuntadas y 3 bloques simultáneos consolidados con la fila UCI existente de la misma carrera.
- 915 filas de `startlist_teams` normalizadas al nombre canónico, incluidas las filas que ya apuntaban al equipo receptor.
- 31 filas adicionales de `startlist_teams` modificadas en la revisión manual: 3 eliminadas por consolidación y 28 repuntadas o normalizadas.
- 220 referencias de `team_link_decisions.teamId` trasladadas.
- 46 referencias de `race_uci_results.teamId` trasladadas.
- 4 referencias de `uci_team_rankings.teamId` trasladadas.
- Todos los nombres anteriores conservados en `team_name_aliases` y `teams.nameAliases`.
- 11 referencias de `startlist_riders.teamId` trasladadas a la fila UCI ya existente de su campeonato nacional; el resto continúa apuntando al mismo registro interno de `startlist_teams`.

Estado final:

- `CLUBM`: 503 equipos.
- `CLUBW`: 317 equipos.
- Total: 820 equipos de club.
- Cero colisiones exactas entre `foldedNames` de equipos de club del mismo género.
- Cero referencias residuales a los 136 identificadores eliminados.
- Cero referencias colgantes entre `startlist_teams` y `teams`.
- Cero referencias colgantes entre `startlist_riders` y `startlist_teams`.

## Segunda pasada documentada

La segunda migración resolvió cuatro grupos que requerían evidencia externa adicional:

- `Aegis Cycling Foundation` → `Aegis x Leaders of Enchantment`.
- `Milton Women's Pro Cycling Team` → `Milton Revolution Women's U23 Project`.
- `Québec en Vélo` → `Entreposage Bluebird Québec en Vélo`.
- `Team Wallonie` / `Wallon U23` → `Team Wallonie Espoirs`.

Fuentes de contraste:

- https://www.mrccwomensu21project.com/
- https://www.linkedin.com/posts/capo-cycling-apparel_the-future-of-womens-domestic-racing-is-activity-7419835983564685312-a7XB
- https://www.directvelo.com/equipes/lettre/A/8
- https://pesantliege.com/organisations/route/liege-bastogne-liege-espoirs/participants/

## Revisión manual posterior

La tercera migración aplicó las decisiones dirigidas posteriores a la auditoría:

- `BIKE AID e.V.` y `BIKE AID Südliche Weinstraße` → `Bike Aid` (`CT`). Los tres bloques pertenecían al Campeonato de Alemania en línea masculino. Las dos filas de club se consolidaron con la fila UCI existente, que conserva 12 corredores distintos.
- `Minimax WB Cycling Team` → `Minimax` (`CTW`). El bloque del Campeonato de Bélgica se consolidó con la fila UCI existente, que conserva 8 corredoras distintas. La participación independiente del Campeonato de Portugal se repuntó al mismo equipo UCI y conserva su corredora.

Las 63 filas finales de `startlist_teams` enlazadas con Bike Aid o Minimax usan el nombre canónico del catálogo. Los nombres retirados permanecen como alias.

## Coincidencias no fusionadas

Los siguientes casos permanecen separados por evidencia de equipos distintos o por insuficiencia probatoria:

- `Konya Gelişim SK` y `Konya Büyükşehir Belediye Spor`: permanecen intactos por decisión manual; coaparecen en la carrera `L18MYotrxPY9P9BDQTGq`.
- `Q36.5-Amacx` y `Pinarello-Q36.5`: equipo de desarrollo y equipo profesional distintos.
- `Kosovo` y `CLN-Kosova`: selección y equipo distintos.
- `Illes Balears` y `Illes Balears Arabay`: selección regional y antiguo equipo UCI distintos.
- `Breizh Ladies` y `Sélection Bretagne`: equipo de club y selección regional distintos. Breizh Ladies aparece en Région Pays de la Loire Tour, Tour du Haut Limousin y Kreiz Breizh; Sélection Bretagne aparece en La Classique Morbihan, Grand Prix du Morbihan y Bretagne Ladies Tour.
- `Regio Team Midden/Noord` y `Volharding Women`: permanecen intactos por decisión manual.
- `Velo Cycling Club`: club danés de 2026, presente en el Campeonato de Dinamarca en línea masculino con Erik Aagaard; no es una denominación genérica pendiente de fusión.

## Backup y recuperación

Las dos primeras operaciones se respaldaron en:

`private.repair_club_team_duplicates_20260903_backup`

Valores de `operation`:

- `merge-club-team-duplicates-20260903`
- `merge-club-team-followup-20260903`

Entidades almacenadas:

- `manifest`
- `teams`
- `team_seasons`
- `team_name_aliases`
- `team_name_aliases_after`
- `startlist_teams`
- `team_link_decisions`
- `race_uci_results`
- `uci_team_rankings`

La revisión manual posterior se respaldó de forma independiente en:

`private.repair_club_team_manual_decisions_20260903_backup`

Valor de `operation`:

- `merge-club-team-user-decisions-20260903`

Entidades almacenadas:

- `manifest`: 3 filas.
- `teams`: 5 filas.
- `team_seasons`: 5 filas.
- `team_name_aliases`: 6 filas.
- `startlist_teams`: 66 filas.
- `startlist_riders`: 11 filas.
- `team_link_decisions`: 4 filas.

Orden de recuperación:

1. bloquear temporalmente nuevas importaciones de startlists;
2. recrear las filas `teams` con `change_kind = 'delete'`;
3. restaurar las fichas canónicas con `change_kind = 'update'`;
4. eliminar los alias registrados como `created` en `team_name_aliases_after` y restaurar `team_name_aliases`;
5. restaurar `team_seasons`;
6. restaurar `startlist_teams`, `team_link_decisions`, `race_uci_results` y `uci_team_rankings` desde `row_data`;
7. verificar las claves foráneas y los recuentos de cada operación antes de reactivar las importaciones.

Para revertir la revisión manual se deben recrear primero las tres fichas eliminadas, restaurar equipos, temporadas y alias, recrear después los tres bloques de `startlist_teams` consolidados y restaurar finalmente `startlist_riders` y `team_link_decisions`. La recuperación debe ejecutarse en una única transacción y usando el manifiesto de la operación correspondiente. No se deben eliminar filas del backup.
