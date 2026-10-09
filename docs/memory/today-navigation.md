# Navegación Hoy / Mes / Temporada

## Vista Hoy — filtros y ordenación

Filtros: `all`, `pro`, `uwt`, `wwt`, `male`, `female`. Ordenación: Categoría / Hora TV / Hora meta.

Las carreras seleccionadas como destacadas solo reciben prioridad y presentación especial en Categoría. En Hora TV y Hora meta se ordenan por su horario y usan tarjetas normales; la selección se conserva y el formato destacado reaparece al volver a Categoría. En layouts de varias columnas, solo las destacadas del modo Categoría ocupan todo el ancho.

Orden (web `js/services/today-agenda-order.js`, espejo `RaceLogic` en iOS y
Android): destacadas primero solo en Categoría; carreras sin jornada publicada
y canceladas siempre al final, aunque estén destacadas; después campeonatos
nacionales, gran vuelta, `categoryRank` (tabla única de
`js/services/race-order.js`), sexo, hora de salida, sector A/B y nombre. El
miniperfil no interviene en el orden. Ningún día tiene destacada obligatoria.

Tarjetas web: una sola estructura (logo | datos | horario, miniperfil en banda
inferior) para carreras, carreras sin jornada, canceladas y descansos. Desde
761 px la lista es una rejilla de dos columnas en la que todas las tarjetas
reservan la banda del perfil y alinean su contenido arriba; la destacada ocupa
la fila y lleva el perfil a una columna central. El DOM no cambia con el ancho.
El ♀ junto a la categoría se omite si el nombre, la categoría WWT o el filtro
femenino ya lo indican.

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

En Android, la cabecera de Hoy contiene el acceso directo a Ajustes (en la de Ciclocross mientras Hoy está oculta).
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

## Vista Hoy de Ciclocross

Desde 2026-10-08 (apps 5.0.15) la agenda general de Ciclocross es una vista
Hoy con la navegación de carretera; la agenda mensual se retiró. Filtros CX:
Todas, Big, Pro y España, con chincheta propia (web `cc_cx_default_filter`,
iOS `cx_default_filter`). Rango: temporada CX del día civil (1 de agosto – fin
de febrero); hoy fuera de rango se acota al extremo. Tira de siete días
desplazada en los extremos; flechas y deslizamiento al día con carreras del
filtro o al contiguo, deshabilitados en los extremos. Apertura en el próximo
día con carreras del filtro; después, avance automático desde un día vacío
solo con Todas. Pruebas de la temporada cargadas una vez; filtro y día en
memoria. La página de torneo conserva la lista de temporada.

Web: cada cambio de día muestra la carga y relee el mes del día de destino.

### Ciclocross en lugar de Hoy fuera de la temporada de carretera

- **Web:** desde el día siguiente al último de la temporada de carretera
  (`js/services/today-season.js`, por año) hasta el 31 de diciembre, el menú
  pone Ciclocross primero y oculta Hoy, y `/` y `/en/` sin `?date=` pintan
  Ciclocross en la misma URL sin tocar título, canonical ni texto estático
  (`js/home.js`). `?date=` abre siempre Hoy de carretera, sin límite de
  navegación; en ese periodo conserva `?date=` también en el día actual.
- **Apps (5.0.15):** `RoadTodayAvailability` oculta Hoy hasta el 1 de enero de
  2027. Pestañas Ciclocross, Resultados, Fichajes y Calendario, con
  Ciclocross inicial; los enlaces a Hoy van a la pestaña inicial vigente, los
  destinos de carretera siguen accesibles por deep link y Ajustes pasa a la
  cabecera de Ciclocross.
- **Resultados:** en esos mismos periodos, pestañas Ciclocross, Carretera y
  Ránking UCI, con Ciclocross por defecto (web `cyclocrossHome`, iOS
  `ResultsFeedTabs`, Android `ResultsSections`).
- **Desde el 1 de enero de 2027**, web y apps vuelven exactamente a la
  configuración del 17-18 de octubre de 2026 (Hoy, menú, home, Temporada y
  Resultados). El cambio automático se limita a este otoño-invierno.
- **Actualización de enero de 2027 (apps):** Dani la publicará al cruzar el
  1 de enero para que cada app quede exactamente como antes del 18 de octubre:
  icono Original de nuevo y Ciclocross en su posición anterior. Lo único
  permanente es la vista por días de Ciclocross, que sustituye a la agenda
  mensual.

Tarjeta CX de altura única en Hoy y Torneos: la fila de estado reserva el alto
de la copa, la variante sin horarios reserva caja y estado, y nombre y línea
secundaria ocupan una línea con puntos suspensivos (la sede se recorta antes
que el torneo).

| Plataforma | Lógica | Vista |
|---|---|---|
| Web | `js/cx/today.js`, `js/components/day-swipe.js` | `js/ciclocross.js` |
| iOS | `CyclocrossLogic`, `CyclocrossAgendaModel` | `Views/Cyclocross/CyclocrossView.swift` |
| Android | `util/CyclocrossLogic.kt`, `CyclocrossAgendaState.kt` | `ui/cyclocross/CyclocrossScreen.kt` |

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
- **Challenges** (`challenge_groups`): sus pruebas visibles (al menos dos) forman una sola fila en el mes de la primera prueba. Web enlaza a `/competicion.html?challenge=<slug>`; las apps (5.0.11) despliegan las pruebas bajo la fila (`SeasonChallengeLogic` en iOS y Android).

| Plataforma | ViewModel | Vista |
|---|---|---|
| iOS | `SeasonViewModel.swift` — `racesByMonth`, `shouldCollapseToAll` | `SeasonView.swift` — `bestMonthIndex()`, `syncMonthIndex()` |
| Android | estado local en `SeasonScreen` | `SeasonScreen.kt` — `bestPageIndex()` |
