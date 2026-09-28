# Cintillo "Hoy" (today_highlights)

Carrusel editorial mostrado encima del selector de días en la vista Hoy
(web + iOS + Android). Editable desde panel admin. Cada entrada apunta a
**uno** de los destinos elegibles: jornada, competición, dorsales, orden de
salida, entrada personalizada (web) o, en Ciclocross, prueba o torneo.

El cintillo de la sección **Ciclocross es independiente** del de carretera: la
columna `scope` (`road`/`cx`) separa ambas fuentes editoriales. La vista Hoy y
el resto de superficies de carretera leen `road`; la agenda de Ciclocross lee
`cx`. Las apps guardan un dismiss por sección.

Sustituye la lógica automática previa (WorldTour 15d) del cintillo web.

## Tabla Supabase

`today_highlights` — migración 066.

| Campo            | Tipo  | Notas                                                     |
|------------------|-------|-----------------------------------------------------------|
| `id`             | text  | PK (uuid generado)                                        |
| `position`       | int   | Orden en el carrusel (drag&drop desde panel)              |
| `scope`          | text  | `road` (defecto) \| `cx`. Sección del cintillo            |
| `targetType`     | text  | `raceDay` \| `race` \| `startlist` \| `startOrder` \| `custom` \| `championships` \| `transfers` \| `cxRace` \| `cxTournament` (CHECK) |
| `raceId`         | text? | FK → `races`. Obligatorio si `targetType` es `race` o `startlist` |
| `raceDayId`      | text? | FK → `race_days`. Obligatorio para `raceDay`/`startOrder` |
| `cxRaceId`       | text? | FK → `cx_races`. Obligatorio para `cxRace` (solo `scope='cx'`) |
| `cxTournamentId` | text? | FK → `cx_tournaments`. Obligatorio para `cxTournament` (solo `scope='cx'`) |
| `customTitle`    | text? | Override ES                                               |
| `customTitleEn`  | text? | Override EN                                               |
| `customDetail`   | text? | Subtítulo opcional ES                                     |
| `customDetailEn` | text? | Subtítulo opcional EN                                     |
| `visibleFrom`    | timestamptz? | Programación: aparece desde este instante (mig. 067)  |
| `visibleUntil`   | timestamptz? | Programación: deja de aparecer tras este instante      |
| `createdAt`      | tstz  |                                                           |
| `updatedAt`      | tstz  | trigger BEFORE UPDATE                                     |

**RLS:** SELECT público, INSERT/UPDATE/DELETE solo usuarios autenticados (panel admin).

**Validación**: CHECK condicional por `scope`. En `cx`, `cxRace` exige `cxRaceId` y
`cxTournament` exige `cxTournamentId` (sin IDs de carretera). En `road`, se exige
`raceId` para `startlist`/`race` y `raceDayId` para `raceDay`/`startOrder`, y ningún
ID CX.

**Precisión horaria** (migración 067): `visibleFrom` y `visibleUntil` son
`TIMESTAMPTZ`. El panel los muestra como `<input type="datetime-local">` en la
TZ local del editor; al guardar se convierten a ISO con TZ. La consulta del
cintillo compara contra `now()` (precisión al segundo).

## Dismiss persistente por hash

Cuando el usuario pulsa la X, se guarda en almacenamiento local el **hash de contenido**
(`id:targetType:position:updatedAt` concatenado con `|`). Si el admin reordena, edita
o añade entradas en el panel, el hash cambia y el cintillo reaparece automáticamente.

| Plataforma | Almacenamiento                                           |
|------------|----------------------------------------------------------|
| Web        | `localStorage.cc_giro_dismissed_hash`                    |
| iOS        | `UserDefaults.standard["cc_giro_dismissed_hash"]` (road) / `…_cx` (Ciclocross) |
| Android    | `SharedPreferences("today_highlights_prefs")["dismissed_hash"]` (road) / `…_cx` (Ciclocross) |

## Sin seed inicial

Tras desplegar la migración, la tabla queda vacía y el cintillo no se muestra hasta
que un admin añade entradas desde el panel.

## Comportamiento del carrusel

- Auto-advance 5s entre slides.
- Swipe horizontal manual (drag) cambia de slide y pausa el avance automático.
- Indicador de página (dots) en la base.
- Botón X (top-right) para dismiss.
- Color de fondo deriva de `race.colorHex` con opacidad ~16%.

## Resolución del destino → URL/Navegación

| `targetType`  | Destino                                                      |
|---------------|--------------------------------------------------------------|
| `raceDay`     | jornada — web: `jornadaUrl(rd)` / iOS: `StageDetailView(raceDayId)` / Android: `Routes.stage(rdId)` |
| `race`        | competición — web: `raceUrl(race)` / iOS: `RaceDetailView(raceId)` / Android: `Routes.race(raceId)` |
| `startlist`   | inscritos — web: `startlistUrl(race)` / iOS: `StartlistView(raceId)` / Android: `Routes.startlist(raceId)` |
| `startOrder`  | orden de salida — web: `startOrderUrl(rd)` / iOS: `StartOrderView(raceDayId)` / Android: `Routes.startOrder(rdId)` |
| `custom`      | **solo web** — `customUrl`/`customUrlEn` + `customTitle`/`customLogo`. Las apps lo descartan (sin carrera). |
| `cxRace`      | **solo `scope='cx'`** — prueba CX: web `cxRaceUrl(race)`; iOS/Android abren la ficha de la prueba. |
| `cxTournament` | **solo `scope='cx'`** — torneo CX: web `cxTournamentUrl(tournament)` (`/ciclocross/torneos/<slug>/`, `/en/cyclocross/series/<slug>/`); apps reutilizan el deep link de serie por slug. |
| `championships` | **solo apps** (Modo Campeonatos) — iOS: `ChampionshipsView()` / Android: `Routes.CHAMPIONSHIPS`. Sin carrera ni URL: destino fijo por config; `customTitle`/`customDetail` opcionales (si faltan, las apps usan `ChampionshipsConfig`). **La web lo IGNORA** (`js/cintillo.js` lo filtra antes de resolver/render/hash): para web se crea un slide `custom` con logo/URL propios apuntando a Campeonatos. Espejo de `custom` (solo web). `customLogo` queda inerte (las apps pintan su globo nativo). Migración `072_today_highlights_championships.sql`. El CHECK de `targetType` sigue admitiendo `championships` (lo necesitan las apps). |

## Panel admin

Tab "Cintillo" en `panel/app.html` + `js/panel/highlights.js::setupHighlightsView`. CRUD completo:
- La lista y el editor se filtran por el área activa (`panelArea()`): carretera
  edita `scope='road'` y Ciclocross `scope='cx'`.
- Búsqueda de carrera por nombre.
- Selector de jornada si la carrera tiene varias.
- Radio para elegir destino, limitado a los destinos del área: carretera no
  ofrece CX y Ciclocross solo ofrece prueba (`cxRace`) o torneo (`cxTournament`).
- Selector de carrera CX y selector de torneo CX según el destino.
- Validación visual: warning si se elige `startlist` y la carrera no tiene startlist
  importada, o `startOrder` y la jornada no tiene orden de salida importado.
- Drag&drop para reordenar las filas existentes (persiste `position` en DB).

## Archivos clave

### Web
- `js/app.js::initGiroCountdown` — reemplazada para leer `today_highlights`.
- `js/app.js::_buildHighlightAutoDetail` — texto fallback "Hoy"/"Mañana"/fecha.

### iOS
- `ios-app/CalendarioCiclismo/Models/TodayHighlight.swift` — DTOs + `TodayHighlightView` con race/raceDay resueltas.
- `ios-app/CalendarioCiclismo/ViewModels/TodayHighlightsViewModel.swift` — fetch + dismiss hash.
- `ios-app/CalendarioCiclismo/Views/Today/TodayHighlightsBanner.swift` — UI SwiftUI con TabView.
- Inserción en `TodayView.mainStack`, justo encima del `DateBarView`.

### Android
- `android-app/.../data/model/TodayHighlight.kt`
- `android-app/.../data/remote/SupabaseService.kt::todayHighlights`
- `android-app/.../data/repository/CalendarRepository.kt::todayHighlights / raceDaysByIds / racesByIds`
- `android-app/.../ui/today/TodayHighlightsBanner.kt` — UI Compose con HorizontalPager.
- Inserción en `TodayScreen` justo encima de `DateBarWithControls`.

### Panel
- `panel/app.html` — tab `tab-highlights` + view `highlightsView`.
- `js/panel/highlights.js::setupHighlightsView` y compañía.

## No es Premium

El cintillo es gratis en las 3 plataformas. Coherente con la regla de no degradar
features que estuvieron disponibles antes del paywall.
