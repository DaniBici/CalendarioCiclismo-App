# Navegación Hoy / Mes / Temporada

## Vista Hoy — filtros y ordenación

Filtros: `all`, `pro`, `uwt`, `wwt`, `male`, `female`. Ordenación: Cat. UCI / Hora TV / Hora de meta.

Categoría en desplegable (apps y web móvil desde la 5.1.2, solo en Hoy de
carretera y de Ciclocross): el filtro se elige en un desplegable «Categoría»
con el aspecto de «Ordenar», en la fila de la fecha: el día y el mes a la
izquierda, «24 de octubre», sin el día de la semana que ya muestra la tira, y
«Categoría» y «Ordenar» a la derecha (iOS y Android desde la `680`; web
hasta 600 px, ver «Franja web» abajo).
Muestra «Categoría» con Todas y, si no, la categoría activa, con la chincheta
cuando es la predeterminada; la última opción fija o quita la activa. La web
de escritorio (desde 1080 px con el conmutador «CX | Ruta» y desde 860 px sin
él), Mes y Temporada conservan los chips. La opción
de orden por categoría se rotula «Cat. UCI» en las tres plataformas para no
repetir «Categoría». Código: iOS `categoryMenu` y `sortMenuBar` (`TodayView`,
`CyclocrossView`) con `DateFormatting.formatDayMonth`, Android `CategoryMenu` (`TodayScreen.kt`), web
`syncCategorySelect`/`handleCategorySelect` (`js/shared.js`) y
`.agenda-cat-wrap` (`css/app.css`). Android: `DateFormatting.formatDayMonth`.

Franja web (Hoy de carretera y de Ciclocross, desde 2026-10-21): conmutador
«CX | Ruta» (si existe) y fecha a la izquierda, categoría y «Ordenar» a la
derecha y filete antes de las tarjetas. Fecha completa, «Miércoles, 21 de
octubre», salvo en móvil sin conmutador, donde comparte fila con los
desplegables y queda en «21 de octubre»; en móvil con conmutador pasa a su
propia línea sobre el filete. `agendaDateHtml` (`js/shared.js`), `.agenda-date`.

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

En Android, la cabecera de Hoy contiene el acceso directo a Ajustes (en la de Ciclocross mientras Hoy está oculta, junto al conmutador «CX | Ruta»).
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
- **UX chincheta:** pulsación larga o segundo toque sobre chip activo abre el modal. "Todas" → ninguna; fijado → relleno; activo ≠ fijado ≠ "Todas" → contorno en activo. En el desplegable «Categoría» de Hoy, la opción final «Fijar/Quitar «X» como predeterminada» (apps: abre el modal; web móvil: alterna directamente, como el icono del chip) y la chincheta junto a la categoría activa si es la fijada.
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
memoria. La página de torneo conserva la lista de temporada. Las destacadas
(`cx_race_featured`) de la primera pintura desde caché salen de la última
lectura del repositorio (sesión o caché local, `cachedFeaturedRaceIds`), de
modo que la vuelta desde «Ruta» y la apertura no recolocan la lista al
responder la red.

Orden del día (web y apps desde la 5.1.2), con las opciones y la posición de
Hoy de carretera: «Ordenar» al final de la fila de la fecha, a la derecha. En memoria, sin
persistir. Categoría: orden de la agenda, con las destacadas primero. Hora TV:
primero las pruebas con hora de TV (la primera emisión del día de la región
con URL válida que aplica a una categoría no cancelada), por esa hora; después
las de TV sin hora y al final las de sin TV y las canceladas. Hora de meta:
fin estimado de la última manga del día (salida más duración reglamentaria
verificada o 60 min), por esa hora; sin hora y canceladas, al final. En Hora
TV y Hora de meta, los empates siguen el orden canónico sin destacadas. Las
tarjetas no cambian con el orden. Lógica: web `cxSortDayRaces`
(`js/cx/presentation.js`), iOS `CyclocrossPresentation.agendaRaces`, Android
`CxPresentation.agendaRaces`.

Web: cada cambio de día muestra la carga y relee el mes del día de destino.

### Ciclocross en lugar de Hoy fuera de la temporada de carretera

- **Web:** desde el día siguiente al último de la temporada de carretera
  (`js/services/today-season.js`, por año) hasta el 31 de diciembre, `/` y
  `/en/` sin `?date=` pintan Ciclocross en la misma URL sin tocar título,
  canonical ni texto estático (`js/home.js`). El menú tiene cuatro destinos:
  Hoy (a `/`, activo en `/`, en `/?date=` y en las páginas de Ciclocross),
  Resultados, Fichajes y Calendario; el destino Ciclocross no aparece.
  `?date=` abre siempre Hoy de carretera, sin límite de navegación; en ese
  periodo conserva `?date=` también en el día actual, salvo con Carretera
  fijada (ver «Chincheta de Carretera» abajo).
- **Apps (5.0.15; rótulo Hoy desde la 5.1.2):** `RoadTodayAvailability` saca
  Hoy de carretera de la barra hasta el 1 de enero de 2027. Pestañas Hoy,
  Resultados, Fichajes y Calendario: la primera es la pestaña Ciclocross
  (`cyclocrossTab`, ruta `CYCLOCROSS`) rotulada Hoy con el icono de Hoy, y es
  la inicial. Los enlaces a Hoy van a la pestaña inicial vigente, los destinos
  de carretera siguen accesibles por deep link y Ajustes pasa a la cabecera
  de Ciclocross.
- **Conmutador «CX | Ruta» (web y apps 5.1.2):** en ese mismo periodo, la
  vista Hoy de Ciclocross y la de carretera llevan un conmutador de dos
  opciones («CX | Road» en inglés). Apps: control segmentado nativo
  (`Picker` segmentado en iOS; `SegmentedButton` con `ccSegmentedColors` en
  Android) a la izquierda de Ajustes; la firma de la cabecera queda en solo
  los símbolos, porque firma, conmutador y Ajustes no caben juntos en 393 pt
  o 411 dp. La pestaña Ciclocross alterna su agenda con Hoy de carretera en la
  misma pila y conserva la elección solo durante la sesión (Android: Atrás
  desde Ruta vuelve a CX). Web: al final de la franja de filtros, con la
  opción activa en el estilo del chip activo y «Ciclocross | Carretera» desde
  601 px; enlaza a `/` (o `/en/`) y a `/?date=<hoy>`. Hoy de carretera no
  limita la navegación en ninguna plataforma. Componentes:
  `HomeDisciplineSwitch` (iOS `HeaderBrandView.swift`, Android
  `HeaderBrand.kt`) y `js/components/discipline-switch.js`.
- **Cintillo común (apps 5.1.2):** con el conmutador, CX y Ruta muestran el
  mismo cintillo (entradas `cx` y después `road`), que se carga una vez y no
  se recrea al alternar: solo cambian fechas, filtros y carreras. iOS:
  `ContentView.cyclocrossRoot` lo aloja sobre `CyclocrossView` y `TodayView`,
  que omiten el suyo mientras existe el conmutador. Android: un único
  `HighlightsBannerState` en `AppNavHost` (entradas y página del carrusel)
  para `CyclocrossScreen` y `TodayScreen`. La web navega entre páginas y
  vuelve a cargarlo.
- **Chincheta de Carretera (solo web, desde 2026-10-23):** la opción
  Carretera de los conmutadores de Hoy y de Resultados lleva la chincheta de
  los filtros (`.tcat-pin`): en contorno cuando está activa y llena cuando
  está fijada. Es una sola preferencia por navegador (`cc_default_discipline`
  en localStorage; `roadPinned`/`setRoadPinned` y `cyclocrossLanding` en
  `js/services/today-season.js`). Fijada, `/` y `/en/` sin `?date=` abren Hoy
  de carretera (el día actual pierde `?date=`), CX enlaza a `/ciclocross/`
  (o `/en/cyclocross/`), Ruta a `/` y Resultados abre en Carretera; en la
  agenda de Ciclocross la chincheta llena solo indica el estado, dentro del
  enlace a Ruta. Menú, cintillo y Temporada no cambian. Hasta 600 px el icono
  mide 12 px y las opciones llevan 0,6 rem de relleno lateral para que
  conmutador, «Categoría» y «Ordenar» quepan en una fila desde 375 px.
  Código: `disciplineSwitchHtml`, `roadPinButtonHtml` y
  `mountDisciplineSwitch` (`js/components/discipline-switch.js`),
  `syncDayUrl` (`js/app.js`), `js/home.js`, `js/page-loading.js` y
  `viewSwitchHtml` (`js/resultados-feed.js`).
- **Resultados:** en esos mismos periodos, Ciclocross, Carretera y Ránking UCI
  con Ciclocross por defecto (web `cyclocrossHome`, iOS `ResultsFeedTabs`,
  Android `ResultsSections`). En la web forman desde el 2026-10-23 un
  conmutador de tres opciones con el estilo del de Hoy («CX | Ruta | Ránking»
  hasta 600 px), botones con `aria-pressed` en un `role="group"`; fuera de ese
  periodo, las dos vistas siguen como títulos con subrayado.
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

Fila de badges de la tarjeta CX, tras la clase y como en Hoy de carretera: TV
con la hora de la primera emisión del día visible en la región del usuario y,
desde su inicio, «En directo» hasta que concluyen todas las categorías del día;
enlaza a la primera emisión y, al alcanzarse la hora de otra posterior de una
categoría aún en directo, a la última iniciada. «Dorsales», en la misma línea,
lleva a la primera categoría del día con lista cargada sin resultados ni
cancelación (`cxAgendaBroadcast`, `cxAgendaStartlistCategory`). Web desde el
2026-10-10 (criterio de TV del 2026-10-11); apps en 5.1.

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

- Subvista inicial de Calendario: sin subvista guardada abre Temporada (desde
  el 2026-10-21; antes, Mes); después, la última elegida (iOS
  `calendar_subview` en `CalendarTabView`, Android
  `AppPreferences.calendarSubview`, web `cc-cal-subview` en
  `resolveInitialSubview` de `js/calendario.js`). Las apps lo aplican en ancho
  compacto (la maqueta ancha muestra ambas). Los enlaces que piden Mes
  (`?vista=mes`, `?mes=AAAA-MM`, `mes.html`) siguen abriendo Mes.
- Píldora "Todos" siempre primera (`month = 0` como sentinel).
- Por defecto: mes en curso (año actual) o primer mes real disponible (otros años).
- **Colapso automático:** país activo + carreras filtradas < 5 → solo "Todos". Sin país → nunca colapsar.
- **Challenges** (`challenge_groups`): sus pruebas visibles (al menos dos) forman una sola fila en el mes de la primera prueba. Web y apps despliegan las pruebas bajo la fila al pulsarla (apps desde la 5.0.11, `SeasonChallengeLogic` en iOS y Android; web en `renderChallengeGroup` de `js/temporada.js`, estado en `expandedChallenges`). La fila ya no enlaza a `/competicion.html?challenge=<slug>`; esa página sigue existiendo pero Temporada no la enlaza.

| Plataforma | ViewModel | Vista |
|---|---|---|
| iOS | `SeasonViewModel.swift` — `racesByMonth`, `shouldCollapseToAll` | `SeasonView.swift` — `bestMonthIndex()`, `syncMonthIndex()` |
| Android | estado local en `SeasonScreen` | `SeasonScreen.kt` — `bestPageIndex()` |
