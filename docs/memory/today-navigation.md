# Navegación Hoy / Mes / Temporada

## Vista Hoy — filtros y ordenación

Día sin carreras del filtro (desde la 5.2.5 y la web de 2026-11-20): Hoy de
carretera y de Ciclocross salta siempre al siguiente día con carreras que pasen
la selección, al abrir, al cambiar de día y al cambiar los filtros. El botón
«Ir al próximo día con carreras» solo aparece si no hay ningún día posterior.

Filtros (desde la 5.2.4 y en la web desde 2026-11-19): menú «Filtros» de
opciones marcables, el del Mercado de Fichajes, en Hoy, Mes, Temporada y la
agenda de Ciclocross. Dentro de un grupo se suman y entre grupos se combinan;
un grupo con todo marcado no filtra y nunca queda vacío; «Limpiar filtros»
marca todo. Carretera: nivel (WorldTour, Profesional, .2) y género (Masculino,
Femenino), separados por un filete y sin rótulo. Ciclocross: Big, UCI y
Nacional (sin Nacional en inglés). Reglas en «Reglas de filtros». Ordenación:
Cat. UCI / Hora TV / Hora de meta, recordada por disciplina (web `cc_road_sort`
y `cc_cx_sort`; apps `road_sort_mode` y `cx_sort_mode`). «Ordenar» muestra las
flechas y el orden activo en las tres plataformas (web
`js/components/sort-menu.js`).

Burbujas de la primera visita (web y apps desde la 5.2.4): la primera vez que
se ve Hoy de carretera y la primera vez que se ve Hoy de Ciclocross, una sobre
«Filtros» y, tras «Siguiente», otra sobre «Ordenar». Nunca bajo el arranque,
la bienvenida, la hoja de apoyo o el aviso de cookies. Web
`js/components/today-tip.js`; iOS TipKit (`TodayTips.swift`); Android
`RichTooltip` (`TodayTips.kt`).

Posición: en Hoy de carretera y de Ciclocross, «Filtros» y «Ordenar» van a la
derecha de la fila de la fecha (el día y el mes a la izquierda, «24 de
octubre», sin el día de la semana que ya muestra la tira). Web: botón
`.agenda-filter-btn` con el aspecto de «Ordenar»; en Mes y Temporada, un chip
`.tcat-btn` en la primera fila de la barra (en móvil, en su propia línea).
iOS: etiqueta «Filtros» con `line.3.horizontal.decrease.circle` (relleno con
filtros) en Hoy y Ciclocross; el icono solo, en la barra de Mes y Temporada.
Android: `Icons.Filled.FilterList` con texto en Hoy y Ciclocross y en la fila
de Año y País de Temporada; el icono con punto de aviso en la barra de Mes.
Código: web `js/components/filter-menu.js` y `js/race-filters.js`; iOS
`RaceFilters.swift`; Android `RaceFilters.kt` y `ui/components/RaceFiltersMenu.kt`.

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
nacionales entre sí, gran vuelta, `categoryRank` (tabla única de
`js/services/race-order.js`), sexo, hora de salida, sector A/B y nombre. El
miniperfil no interviene en el orden. Ningún día tiene destacada obligatoria.

`categoryRank` (desde la 5.2.4 y en la web desde 2026-11-19): Grandes Vueltas,
Mundiales (WC), WorldTour (1.UWT, 2.UWT, 1.WWT, 2.WWT), Continental europeo
(CC con `europa|europe` en el nombre), ProSeries, .1, Continentales de otras
áreas, Nacionales (CN) y .2 (1.2, 2.2, 1.2U, 2.2U y las clases sueltas). Sin
excepciones por país ni para el Tour del Porvenir. Ciclocross, por clase: CM,
CDM, Europeo, C1, C2, otros Continentales, CN y NAC (`cxClassRank` en la web,
`CyclocrossLogic.classRank` en las apps). El widget sigue el mismo orden
(`widget_day`).

Tarjetas web: una sola estructura (logo | datos | horario, miniperfil en banda
inferior) para carreras, carreras sin jornada, canceladas y descansos. Desde
761 px la lista es una rejilla de dos columnas en la que todas las tarjetas
reservan la banda del perfil y alinean su contenido arriba; la destacada ocupa
la fila y lleva el perfil a una columna central. El DOM no cambia con el ancho.
El ♀ junto a la categoría se omite si el nombre, la categoría WWT o el filtro
femenino ya lo indican.

Altura única de las tarjetas de carretera en las tres plataformas: todas miden
lo que una tarjeta completa (relleno, nombre, cifras, una fila de etiquetas y
banda del miniperfil), con o sin perfil, cifras, etiquetas o botón ☰. Web:
`--road-card-h` en `css/app.css`. Apps: una plantilla invisible de la tarjeta
completa, medida con las mismas tipografías (`heightTemplate` y
`RaceCardMinHeightLayout` en iOS; `RaceCardHeightTemplate` y `RaceCardColumn` en
Android), fija el alto mínimo y el perfil queda anclado al pie. Nombre, cifras y
etiquetas ocupan una línea y las etiquetas que no caben se omiten. Al cambiar el
relleno, las separaciones o las tipografías de la tarjeta, cambiar también la
plantilla.

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

- **Nivel de carretera** (`uciCategory`): WorldTour = 1.UWT, 2.UWT, 1.WWT,
  2.WWT y WC; Profesional = 1.Pro, 2.Pro, 1.1, 2.1, CC y CN (sub23 incluidas);
  .2 = 1.2, 2.2, 1.2U, 2.2U y la lista cerrada 1.Ncup, 2.Ncup, 1.NE y 2.NE.
  Una clase fuera de las tres listas no tiene nivel: solo se ve con el grupo
  entero marcado. Ampliar la lista de .2 es una decisión de Dani.
- **Género:** `gender` masculino o femenino; una carrera sin género y los
  relevos mixtos de WC/CC cuentan en los dos.
- **Ciclocross:** Big = CM, CDM, CC y las pruebas de los torneos Copa del
  Mundo, Superprestige, X2O y HG Cross (antes Exact Cross); Nacional = `NAC`;
  UCI = el resto (C1, C2 y CN de cualquier país, también las pruebas UCI en
  España). En un torneo no se filtra.
- **Solo Femenino marcado:** nombres sin sufijo femenino y sin ♀
  (`needsFemaleMark`/`cleanFeminineName` con `femaleMarkCat` en la web;
  `femaleOnly` en las apps).
- **Auto-navegación:** con o sin filtros (desde la 5.2.5). Se ejecuta al final de `loadDay()` directamente. Al cambiar el filtro con el día ya cargado, iOS la dispara desde `onChange(of: viewModel.filter)` solo si hay items y la carga terminó; Android, desde `skipDayEmptiedByFilter`.
- **`nextDayWithRaces`:** recalcular al cambiar filtros. Flechas prev/next escanean 180 días; fallback ±1 día si `allRaces` no cargado.
- Las CN de la ventana de la página de Campeonatos no se listan sueltas en Mes y Temporada (fila sintética), con o sin filtros.

### Memoria de los filtros

La selección se recuerda por disciplina; carretera la comparten Hoy, Mes y
Temporada. Web `localStorage` `cc_road_filters` y `cc_cx_filters` (JSON por
grupo; sin clave con todo marcado); iOS `UserDefaults` `road_race_filters` y
`cx_race_filters` (JSON); Android DataStore `road_race_filters` y
`cx_race_filters` (formato del widget, `level:wt,pro;gender:female`). La
chincheta de la 5.2.3 (`cc_default_filter`/`defaultFilter`/`default_filter` y
sus equivalentes de CX) se convierte una vez y se retira: WT → WorldTour +
Masculino; WWT → WorldTour + Femenino; Pro → WorldTour + Profesional; Masc →
WorldTour + Profesional + Masculino; Fem → Femenino; CX Big → Big; CX Pro →
Big + UCI; España → Nacional. Fichajes recuerda también los suyos
(`cc_transfer_filters` en la web, `transfer_filters` en las apps).

### Auto-recarga al recuperar conectividad

- **iOS:** `.onChange(of: network.isOnline)` → `loadDay(refresh: true)` si `isFromCache || isUncachedOffline || error != nil`.
- **Android:** `LaunchedEffect` colecta `NetworkMonitor.online(context)`; flag `wasOffline`; `vm.refresh()` si `error != null || data == null`.
- **Pull-to-refresh en todos los estados.** iOS: `ScrollView.refreshable` con `minHeight: 320` en estados vacíos.

## Vista Hoy de Ciclocross

Desde 2026-10-08 (apps 5.0.15) la agenda general de Ciclocross es una vista
Hoy con la navegación de carretera; la agenda mensual se retiró. Filtros CX:
Big, UCI y Nacional, combinables y recordados (ver «Memoria de los
filtros»). Rango: temporada CX del día civil (1 de agosto – fin
de febrero); hoy fuera de rango se acota al extremo. Tira de siete días
desplazada en los extremos; flechas y deslizamiento al día con carreras del
filtro o al contiguo, deshabilitados en los extremos. Apertura en el próximo
día con carreras del filtro; después, avance automático desde un día sin
carreras que pasen el filtro (desde la 5.2.5 y la web de 2026-11-20, con o sin
filtros; antes solo con todos marcados). Pruebas de la temporada cargadas una vez; filtro y día en
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
  (`js/services/today-season.js`: desde el día siguiente a la Chrono des Nations, el tercer domingo de octubre, hasta el domingo anterior al primer lunes del año siguiente; desde 2026) `/` y
  `/en/` sin `?date=` pintan Ciclocross en la misma URL sin tocar título,
  canonical ni texto estático (`js/home.js`). El menú tiene cuatro destinos:
  Hoy (a `/`, activo en `/`, en `/?date=` y en las páginas de Ciclocross),
  Resultados, Fichajes y Calendario; el destino Ciclocross no aparece.
  `?date=` abre siempre Hoy de carretera, sin límite de navegación; en ese
  periodo conserva `?date=` también en el día actual, salvo con Carretera
  fijada (ver «Chincheta de Carretera» abajo).
- **Apps (5.0.15; rótulo Hoy desde la 5.1.2):** `RoadTodayAvailability` saca
  Hoy de carretera de la barra desde el día siguiente a la Chrono des Nations hasta el domingo anterior al primer lunes del año (regla anual, sin ediciones; mismo periodo en la web). Pestañas Hoy,
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
- **Barra de cinco destinos todo el año (5.2.0, D1 de
  `docs/plans/videos-5-2.md`, confirmada por Dani el 2026-11-11):** Hoy ·
  Resultados · Vídeos · Fichajes · Calendario. Ciclocross queda dentro de Hoy
  con el conmutador «CX | Ruta» todo el año; el destino Ciclocross no vuelve a
  la barra. Apps: iOS `RoadTodayAvailability.tabs` (Vídeos es el valor 7) y
  la pestaña Hoy es `cyclocrossTab`; Android `Routes.MAIN_TABS` y
  `Routes.HOME` (`CYCLOCROSS`). Los enlaces `today` y `cyclocross` abren la
  pestaña Hoy en Ruta y en CX. Web: `PRIMARY_NAV_ITEMS` (`js/header-html.js`).
- **Desde el primer lunes del año hasta la Chrono des Nations** (la primera vez, el 4 de enero de 2027), la disciplina inicial pasa a Ruta: Hoy abre
  en carretera (apps: `RoadTodayAvailability.isVisible`) y Resultados y Vídeos
  en Carretera, con el conmutador para volver a CX. Dani prevé dar prioridad a
  Ruta sobre CX en todas las secciones desde esa fecha. Sustituye, en lo
  relativo a la pestaña Ciclocross, la vuelta a la configuración del 17-18 de
  octubre de 2026.
- **Icono de las apps (5.2.2, adelantado desde enero de 2027):** el icono
  Original vuelve al azul y Tierra seca queda como «Ciclocross», elegible por
  cualquier usuario en Ajustes. La vista por días de Ciclocross sigue
  sustituyendo a la agenda mensual.

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
- **CN sin hueco de logo:** las filas `CN` de Calendario no reservan el hueco del logo (`.t-race--no-logo` en la web, `showLogo` en `SeasonRowLayout` de las apps). Las demás lo conservan.
- **Campeonatos agrupados:** las pruebas `CC` y `WC` de un campeonato, las que llevan «Panamericano» o «Juegos» en el nombre y las `CN` fuera de la ventana de la página de Campeonatos (`queryStart`–`queryEnd`, sin el año) forman la misma fila desplegable (desde la 5.1.7). No están en `challenge_groups`: se deducen del nombre sin la prueba (`_buildChampionshipGroups` en `js/temporada.js`, `SeasonChallengeLogic.championshipGroups` en iOS y Android). Un país con pruebas a ambos lados de la ventana forma un grupo por cada lado. Bajo la fila, cada prueba muestra solo su nombre, con el género concordado con la modalidad («CRI femenina»); en los datos y en el resto de vistas sigue «femenino». Las `CN` de la ventana siguen en la fila «Campeonatos Nacionales». Mes no agrupa: web y apps listan por día las `CN` de fuera de la ventana (`isOnChampionshipsPage` en la web, `isOnChampionshipsScreen` en las apps) y las de dentro quedan para la fila sintética de la semana de Campeonatos.

| Plataforma | ViewModel | Vista |
|---|---|---|
| iOS | `SeasonViewModel.swift` — `racesByMonth`, `shouldCollapseToAll` | `SeasonView.swift` — `bestMonthIndex()`, `syncMonthIndex()` |
| Android | estado local en `SeasonScreen` | `SeasonScreen.kt` — `bestPageIndex()` |
