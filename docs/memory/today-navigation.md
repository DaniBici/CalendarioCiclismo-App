# Navegación Hoy / Mes / Temporada

## Vista Hoy — filtros y ordenación

Filtros: `all`, `pro`, `uwt`, `wwt`, `male`, `female`. Ordenación: Categoría / Hora TV / Hora meta.

Las carreras seleccionadas como destacadas solo reciben prioridad y presentación especial en Categoría. En Hora TV y Hora meta se ordenan por su horario y usan tarjetas normales; la selección se conserva y el formato destacado reaparece al volver a Categoría. En layouts de varias columnas, solo las destacadas del modo Categoría ocupan todo el ancho.

En web, «Hora Meta» también muestra la llegada prevista en las tarjetas, aunque
la etapa aún no haya empezado. Al volver a Categoría o Hora TV se recupera la
salida para las etapas pendientes; las que están en curso conservan la meta.
Resultados y Esperando resultados mantienen su prioridad. Una meta sin horario
definido no se sustituye por la hora de salida. En CRI/CRE, la columna usa
«Inicio / Final» en español y «Start / End» en inglés; las demás jornadas
conservan «Salida / Meta» y «Start / Finish».

| Plataforma | ViewModel | Vista |
|---|---|---|
| iOS | `ViewModels/TodayViewModel.swift` | `Views/Today/TodayView.swift` |
| Android | `ui/today/TodayViewModel.kt` | `ui/today/TodayScreen.kt` |
| Web | `js/app.js` | `index.html` |

En Android, la cabecera de Hoy contiene los accesos directos de tema y Ajustes.
Ajustes no forma parte de `Routes.MAIN_TABS` ni de la barra inferior y presenta
navegación de regreso explícita.

### Reglas de filtros

- **CN:** las pruebas élite entran en Pro y en su género; las sub23 quedan fuera de Pro/Masc/Fem.
- **WC/CC:** Masculino exige `gender='male'` y Femenino exige `gender='female'`; el relevo mixto aparece en ambos y cualquier otra prueba sin género queda fuera. Fuera de Todas, se muestran solo Europa/Mundo (regex `europa|europe|mundo` en iOS/Android; la web aplica `europa|europe` a CC).
- **Auto-navegación:** solo filtro `all`. Ejecutar al final de `loadDay()` directamente, no con `onChange(of:)` en SwiftUI.
- **`nextDayWithRaces`:** recalcular al cambiar filtro. Flechas prev/next escanean 180 días; fallback ±1 día si `allRaces` no cargado.

### Filtro predeterminado fijado (pin)

Persistencia: iOS `UserDefaults.defaultFilter` / Android DataStore `default_filter` / web `localStorage['cc_default_filter']`. Helpers web en `js/shared.js`: `getPinnedFilter`, `setPinnedFilter`, `renderFilterPins`, `handleFilterEvent`.

- **Prioridad al cargar:** URL `?cat=` > pin > default por vista (Hoy `all`, Mes/Temporada `pro`).
- **UX chincheta:** pulsación larga o segundo toque sobre chip activo abre el modal. "Todas" → ninguna; fijado → relleno; activo ≠ fijado ≠ "Todas" → contorno en activo.
- **Modal:** chip no fijado → "Establecer como por defecto"; chip fijado → "Quitar" → vuelve a `ALL`.

### Auto-recarga al recuperar conectividad

- **iOS:** `.onChange(of: network.isOnline)` → `loadDay(refresh: true)` si `isFromCache || isUncachedOffline || error != nil`.
- **Android:** `LaunchedEffect` colecta `NetworkMonitor.online(context)`; flag `wasOffline`; `vm.refresh()` si `error != null || data == null`.
- **Pull-to-refresh en todos los estados.** iOS: `ScrollView.refreshable` con `minHeight: 320` en estados vacíos.

## Pull-to-refresh en jornadas

Re-descarga sin togglear `isLoading`. Éxito → háptico `.success`.

**Sin red → modal antes del spinner:**
- Offline ON + en rango → "Sin conexión".
- Offline ON + fuera de rango → "Jornada fuera de rango".
- Offline OFF → "Sin conexión" + CTA "Activar modo sin conexión".

| Plataforma | API | Método |
|---|---|---|
| iOS | `.refreshable { … }` en el contenedor de `StageDetailView` (no en el `ScrollView` interno) | `StageDetailViewModel.refresh(raceDayId:)` |
| Android | `PullToRefreshBox` (`@OptIn(ExperimentalMaterial3Api::class)`) envolviendo `LazyColumn` | `loadStageData(app, stageId, raceId)` |

## Vista Temporada — Mes "Todos" + colapso por país

- Píldora "Todos" siempre primera (`month = 0` como sentinel).
- Por defecto: mes en curso (año actual) o primer mes real disponible (otros años).
- **Colapso automático:** país activo + carreras filtradas < 5 → solo "Todos". Sin país → nunca colapsar.

| Plataforma | ViewModel | Vista |
|---|---|---|
| iOS | `SeasonViewModel.swift` — `racesByMonth`, `shouldCollapseToAll` | `SeasonView.swift` — `bestMonthIndex()`, `syncMonthIndex()` |
| Android | estado local en `SeasonScreen` | `SeasonScreen.kt` — `bestPageIndex()` |
