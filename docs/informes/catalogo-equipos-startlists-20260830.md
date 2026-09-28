# Catálogo obligatorio de equipos en startlists — 2026-08-30

## Objetivo

Desde este cambio, toda fila nueva de `public.startlist_teams` debe conservar
un `teamId` canónico. Si el nombre no existe en la lista UCI o en el catálogo,
se crea una identidad de equipo. El flujo no crea corredores.

El alcance actual de resultados y clasificaciones es la temporada 2026. La
resolución usa `races.year` y `2026` como valor de respaldo para mantener el
contrato cuando se incorporen otras temporadas.

## Modelo

`public.teams` incorpora:

- `teamKind`: `club` o `selection`.
- `selectionScope`: `national` o `regional` cuando `teamKind=selection`.
- `selectionCode`: código estable de país o región.

Las selecciones regionales se equiparan funcionalmente a NTM/NTW. La separación
de ámbito solo conserva la procedencia de la selección y evita mezclarla con
una selección nacional de igual nombre.

`public.team_name_aliases` permite que varias entidades compartan un nombre.
La clave de resolución es `(teamId, foldedName, year)`, no `foldedName` global.
Si un nombre exacto apunta a más de un equipo compatible, la resolución queda
`ambiguous` y no elige uno arbitrariamente.

`public.team_selection_aliases` clasifica nombres nacionales y regionales antes
de crear una identidad. `public.team_link_decisions` conserva la decisión por
ocurrencia de startlist o resultado.

## Flujo obligatorio

1. Antes de llamar a `public.ensure_startlist_team`, detectar si el nombre de la
   fuente identifica una selección nacional o regional. Consultar primero
   `team_selection_aliases` y `teams` por `teamKind`, ámbito, código de selección,
   género, categoría y alias lingüísticos. Si existe una entidad compatible,
   pasar su `teamId` canónico de forma explícita.
2. `public.ensure_startlist_team(raceId, teamName, teamGender)` busca alias
   exactos de la temporada, nombre canónico y `foldedNames` para los casos que
   sigan sin resolver.
3. Filtra equipos especiales y equipos de sexo incompatible con la carrera.
4. Reutiliza el único candidato compatible.
5. Si no hay candidato, crea un `CLUBM/CLUBW` o `NTM/NTW`. Las selecciones
   regionales reciben `teamKind=selection`, `selectionScope=regional` y
   categoría NTM/NTW.
6. `auto_link_startlist_team` se ejecuta como trigger `BEFORE INSERT OR UPDATE`
   y rechaza ambigüedades, equipos inexistentes y sexo incompatible.
7. El panel de inscritos ejecuta la misma resolución antes de borrar y
   reconstruir una lista; una ambigüedad detiene el guardado sin pérdida de la
   lista existente.

Los placeholders `Individual`, `Private Member`, `Sin equipo`, `UN` y
`Un-Attached Leinster` quedan sin `teamId` y no crean un equipo. La función
`public.is_startlist_no_team_placeholder(text)` centraliza esta excepción en
la RPC y el trigger. Las filas de inscritos y sus corredores se conservan;
la presentación los trata como estados sin equipo. No se crean startlists
para Campeonatos Nacionales `resultsOnly`.

### Corrección de alcance del panel

La obligación se aplica exclusivamente a las filas de `startlist_teams` que
el editor de inscritos crea o vuelve a guardar. No modifica el flujo ordinario
del editor general del catálogo. La etiqueta de identidad se muestra en el
editor aunque la lista no esté marcada como enriquecida: ese ajuste solo
controla la presentación pública. Cambiar el texto de una fila invalida el
enlace previo; solo se repone una coincidencia exacta única. Los homónimos y
las entidades compartidas quedan pendientes hasta seleccionar un equipo
compatible de forma explícita.

La función `ensure_startlist_team` conserva el filtro de sexo y, cuando no hay
una señal explícita de selección, compara tanto clubes como selecciones. Si
varias entidades compatibles comparten el nombre, devuelve `ambiguous` y no
crea un duplicado. Una señal de selección nacional o regional usa únicamente
esa clase de entidad, manteniendo separados clubes, selecciones nacionales y
regionales.

La RPC mantiene `SECURITY DEFINER` para realizar el alta controlada, pero exige
en su propio cuerpo `private.is_admin()` o `service_role`. La concesión de
ejecución a `authenticated` no autoriza a un usuario autenticado no inscrito en
el registro privado de administración.

## Backfill dirigido de 2026

Antes de escribir se hizo backup en
`private.team_catalog_backfill_20260830_backup`:

| Entidad | Filas respaldadas |
| --- | ---: |
| `startlist_teams` | 91 |
| `race_uci_results` | 291 |

El backfill solo usó el mismo nombre plegado, la misma carrera, una startlist
existente y sexo compatible. La operación principal creó 84 equipos
`team_auto_*` y tres selecciones nacionales (`Canada`, `Indonesia` y `Norway`).
Se enlazaron las 277 filas de resultados respaldadas por la operación principal.
El resultado pendiente de `Norway` del Tour del Porvenir se respaldó en una
migración adicional antes de enlazarlo. Después se respaldaron y enlazaron 14
resultados con coincidencia exacta de startlist, única y compatible; el backup
privado contiene 277 filas de la operación principal y 14 de esta corrección.

Durante la misma ventana, una sincronización posterior de `Ixina Classic - GP
Stad Halle` creó automáticamente 12 equipos adicionales mediante el trigger;
no forman parte del backfill dirigido. `Reffen Co:Play Giant Store` fue creado
por el backfill en `Baltic Chain Tour` y se reutilizó en Halle.

Tour del Porvenir masculino:

- `Indonesia` → `team_ntm_indonesia` (`NTM`, `male`, `national`, `id`).
- `Norway` → `team_ntm_norway` (`NTM`, `male`, `national`, `no`).
- Se conservaron `team_ntw_indonesia` y `team_ntw_norway` para su ámbito
  femenino; no quedan enlaces masculinos a esos equipos.
- `Catalunya` conserva su identidad `NTW`, pero su metadato se corrigió a
  `selectionScope=regional`, `selectionCode=es-ct`.

## Estado de entrada antes del rastreo de pendientes

Estos valores son el cierre del backfill inicial y el punto de entrada de la
operación posterior de rastreo. El estado posterior está documentado en
[`rastreo-pendientes-equipos-colectivos-20260830.md`](rastreo-pendientes-equipos-colectivos-20260830.md).

| Verificador | Resultado |
| --- | ---: |
| Clasificaciones colectivas 2026 | 5.470 |
| Colectivas con `teamId` | 5.105 |
| Colectivas pendientes en el censo | 365 |
| Incompatibilidades de sexo | 0 |
| Colectivas con `globalRiderId` | 0 |
| Colectivas con dorsal | 0 |
| Colectivas en `resultsOnly` | 0 |
| Referencias de equipo colgantes | 0 |

Las 365 pendientes no tienen una startlist exacta de la misma carrera. Deben
permanecer pendientes hasta disponer de una fuente oficial o de una startlist
inequívoca. No se deben convertir en corredores ni enlazar por una coincidencia
nominal de catálogo sin evidencia de carrera.

La revisión posterior mantiene 1.552 filas históricas no individuales sin
`teamId`. No se sometieron a una reasignación masiva: la regla impide nuevas
filas sin identidad y resuelve las históricas solo si se abre y guarda su lista
con una decisión explícita o un match exacto único.

## Enlace oficial posterior

La web del organizador del Baltic Chain Tour 2026 identifica de forma explícita
a sus líderes como `National Team of Estonia`. Se respaldan y enlazan las ocho
filas colectivas masculinas cuyo texto es `NATIONAL TEAM ESTONIA` con la
selección nacional masculina existente (`selectionCode=ee`), además de añadir
el alias temporal verificado `National Team Estonia`. No se crea una startlist,
no se modifica ningún corredor y no se enlazan Algeria, Latvia o Poland: sus
PDFs oficiales constan como fuente de resultados, pero esta pasada no dispone
de una confirmación web equivalente de la entidad concreta.

## Verificadores SQL

El detector de colectivas debe unir siempre `race_uci_results` con
`race_uci_stages` y `races`:

```sql
WITH collective AS (
  SELECT r.id, r."teamId", r."bib", r."globalRiderId",
         s."raceId" AS race_id, rc.gender AS race_gender
  FROM public.race_uci_results r
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  JOIN public.races rc ON rc.id = s."raceId"
  WHERE rc."year" = 2026
    AND (s."classKind" = 'teams' OR s."isTeamEvent" = true)
)
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE "teamId" IS NOT NULL) AS linked,
  count(*) FILTER (WHERE "teamId" IS NULL) AS pending,
  count(*) FILTER (WHERE "bib" IS NOT NULL) AS with_bib,
  count(*) FILTER (WHERE "globalRiderId" IS NOT NULL) AS with_rider
FROM collective;
```

El detector de sexo es:

```sql
SELECT count(*) AS gender_incompatible
FROM public.race_uci_results r
JOIN public.race_uci_stages s ON s.id = r."stageRef"
JOIN public.races rc ON rc.id = s."raceId"
JOIN public.teams t ON t.id = r."teamId"
WHERE rc."year" = 2026
  AND (s."classKind" = 'teams' OR s."isTeamEvent" = true)
  AND t.gender IS NOT NULL
  AND rc.gender IS NOT NULL
  AND t.gender <> rc.gender;
```

## Rollback dirigido

No se debe borrar el catálogo automático de forma global. La restauración debe
usar únicamente `private.team_catalog_backfill_20260830_backup`, por entidad y
`row_id`, y devolver `teamId` al valor guardado en `row_data`. La restauración
de startlists debe preceder a la restauración de resultados. Los equipos creados
automáticamente se eliminan solo después de comprobar que no tienen enlaces
fuera de esta operación.

## Migraciones y permisos

- `20260830110000_team_catalog_auto_resolution.sql`
- `20260830112000_team_catalog_backfill_backup.sql`
- `20260830113000_refine_selection_aliases.sql`
- `20260830114000_link_pending_tour_porvenir_team_result.sql`
- `20260830115000_classify_existing_regional_selection.sql`
- `20260830120000_index_team_link_decisions_team_id.sql`
- `20260830121000_link_collective_exact_startlists.sql`
- `20260830121500_reject_dangling_startlist_team.sql`
- `20260830122000_validate_startlist_team_race.sql`

Los aliases no tienen escritura para `authenticated`; la escritura se realiza
desde funciones controladas o `service_role`. La función pública de resolución
requiere autenticación, deniega `anon` y tiene `search_path` fijado. El advisor
mantiene como informativa la ausencia de políticas sobre tablas privadas de
backup; los avisos anteriores de `pg_net` y funciones push no forman parte de
esta operación. La relación `team_link_decisions.teamId` tiene índice propio y
las referencias colgantes de `startlist_teams` se rechazan mediante trigger.
