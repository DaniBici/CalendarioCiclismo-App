# Equipos y listas enriquecidas

Documentación técnica de equipos y startlists enriquecidas.

Asignar un equipo global (tabla `teams`) a cada `startlist_teams.teamId` para pintar la cabecera con colores propios y mostrar una chapa ciclista (SVG) junto al nombre. Solo se activa cuando `races.enrichedStartlist = true`.

## Base de datos (`019_teams.sql`, `058_riders.sql`)

| Tabla / columna | Qué es |
|---|---|
| `teams` | Equipos globales. `headerBg` guarda el fondo público y `headerText` se deriva automáticamente por contraste. Los campos históricos `badgeTorsoSides`, `badgeTorsoCenter` y `badgeShorts` almacenan, en ese orden, los tres cuadrados cromáticos. `badgeInnerCircle` queda como compatibilidad de esquema y el editor lo limpia. `nameAliases` = alias separados por `\n` para matching. |
| `teams.category` | Categoría UCI: `WT`, `WWT`, `PT`, `PRW`, `CT`, `CTW`, `CLUBM`, `CLUBW`, `NTM`, `NTW`. |
| `teams.gender` | `'male'` / `'female'`. Se auto-rellena en el panel al seleccionar `category`. |
| `startlist_teams.teamId` | FK nullable a `teams` (`ON DELETE SET NULL`). |
| `startlist_teams.isDev` | ⛔ **RETIRADO — columna eliminada en producción el 2026-08-29.** Marcaba el equipo como filial añadiendo " (Devo)" al nombre. Redundante desde que cada filial tiene su **ficha propia** en `teams` (nombre y chapa propios): la condición vive en el `teamId` canónico. La 063 limpió los datos, la 128 ejecutó el `DROP COLUMN` tras publicar y adoptar la 4.0, y el checkbox del panel y la lectura en web/iOS/Android ya no existen. |
| `races.enrichedStartlist` | Boolean. Si `false` → render estándar aunque haya `teamId`. |

Ver `docs/memory/riders-database.md` para la BD de corredores y su matching en el editor de startlist.

## Matching — `findMatchingTeam(name, teams)` en `js/shared.js`

1. Normaliza (minúsculas, sin acentos, sin stopwords: `pro`, `team`, `cycling`, `wt`, `continental`, `women`…).
2. Coincidencia exacta normalizada contra `name` o cualquier alias.
3. Fallback: contención bidireccional (≥ 4 caracteres).

## Chapa — `buildTeamBadgeSvg(team, { size, className })` en `js/shared.js`

- Polígono de 22 lados gris (`#8a8d91`) como borde exterior.
- Círculo interior con `clipPath`:
  - Semicírculo superior: fondo `badgeTorsoSides` + franja central `badgeTorsoCenter` + círculo `badgeInnerCircle` (opcional).
  - Semicírculo inferior: `badgeShorts` plano.

## Panel — sección "Equipos"

`#teamsView` en `panel/app.html`. CRUD con cuatro pares color-picker+hex sincronizados: tres cuadrados cromáticos y el fondo de pestaña/barra de título. La vista previa reproduce esas dos salidas; el texto de cabecera se calcula automáticamente. Funciones en `js/panel/teams.js`: `setupTeamsView`, `openTeamEditor`, `saveTeam`, `deleteTeam`, `refreshTeamPreview`.

## Editor e importación (2026-09-04)

Todas las listas guardadas mediante el panel o la skill se enriquecen. El selector
`Enriquecida` y la importación de JSON mínimo se han retirado. El panel tampoco
permite cargar archivos JSON completos: la creación abre directamente el editor
y las listas existentes se editan mediante campos. No ofrece recuperación ni
persistencia de borradores en el navegador. El contrato interno conserva
nombres separados, países, nacimiento, identificadores y fuentes.

`prepare_startlist_import` conserva el borrador y resuelve identidades en servidor.
`apply_startlist_import` guarda la lista y sus altas en una transacción. Las fichas
nuevas requieren nacionalidad y fecha de nacimiento; los equipos ausentes se crean
como club o selección mediante `ensure_startlist_team`. Las coincidencias ambiguas
se revisan antes de aplicar. El panel permite preparar esas altas en el selector.

No se borran todas las filas para reconstruirlas: se conservan los ids por dorsal y
solo se actualizan diferencias. Cada `importId` se aplica una sola vez. Las listas
históricas no se reclasifican en masa; el flag se conserva para los clientes móviles
existentes. Procedimiento: [importación](../runbooks/importacion-inscritos-resultados.md).

## Render público (`js/inscritos.js`)

Si `race.enrichedStartlist`, carga los `teams` referenciados por `teamId` en una sola query y pinta:
- Header con `background/color` del equipo + chapa 24px + clase `.startlist-team__header--enriched`.
- Equipos sin match o flag OFF → estilo estándar (gris).

## Orden de equipos — por dorsal del primer corredor (cliente, 2026-06-11)

`startlist_teams.sortOrder` es el **orden de inserción del panel** ("al tuntún") y NO se usa como
orden principal: las tres plataformas ordenan en cliente por el **mínimo dorsal > 0** de cada
equipo (= dorsal del primer corredor mostrado). Equipos sin ningún dorsal (0/null) van al final
conservando `sortOrder` entre ellos → una startlist entera sin dorsales queda en el orden del panel.
- Web: `js/inscritos.js` (sort in-place del array `teams` tras agrupar corredores; el PDF
  `js/inscritos-pdf.js` comparte ese array → hereda el orden).
- Android: `util/StartlistLogic.teamsByFirstDorsal` (+ `StartlistLogicTest`), cableado en
  `CalendarRepository.loadStartlistData`.
- iOS: sort al final de `StartlistViewModel.fetchTeams` (espejo del de Android — cambios en paralelo).
No hay nada que tocar en el panel ni en BD; los corredores dentro del equipo ya se ordenaban por dorsal.

## CSS (`css/app.css`)

- `.startlist-team__header` ahora es `display:flex; align-items:center; gap:0.55rem` para acomodar la chapa.
- `.startlist-team__badge`, `.team-badge` — wrappers neutros (el SVG lleva width/height propias).
