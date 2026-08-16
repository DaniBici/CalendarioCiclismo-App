# Pagers paginados — diferir logos y banderas (iOS + Android)

Documentación técnica de los pagers paginados.

Tamaños del artwork: 28×28 logo, 20×15 bandera.

## Swipe horizontal (settle)

`settledMonthIndex`/`settledPage` lagea **280 ms** (casa con snap 250-350 ms del paginador). Solo la página settled renderiza `RaceLogo` + `CountryFlag`; adyacentes muestran hueco.

## Scroll vertical

- **iOS:** `@State isVerticallyScrolling` con `.onScrollPhaseChange`. `loadArtwork = isActive && !isVerticallyScrolling`. **Guard `isActive`** para que páginas adyacentes no escriban el estado.
- **Android:** `effectiveLoadArtwork = loadArtwork && !listState.isScrollInProgress`.

## Latch por fila (imprescindible)

Impide que iconos ya renderizados desaparezcan cuando `loadArtwork` vuelve a `false`:

- **iOS:** `@State var hasLoadedArtwork = false` + `.task(id: loadArtwork) { if loadArtwork { hasLoadedArtwork = true } }`.
- **Android:** `var hasLoadedArtwork by remember { mutableStateOf(loadArtwork) }; if (loadArtwork && !hasLoadedArtwork) hasLoadedArtwork = true`.
- Latch se resetea al salir del viewport.

## Auto-scroll al día en curso (Month)

El scroll programático día1→hoy compite con la carga de logos → stutter. Gatear artwork durante TODO el movimiento programático.

- **iOS:** `@State isAutoScrollingToToday` (default = `day > 1` al instanciar la vista). `shouldLoadArtwork = isActive && !isVerticallyScrolling && !isAutoScrollingToToday`.
  - Helper `performScrollToToday`: enciende flag, `proxy.scrollTo` tras 150 ms, apaga tras 600 ms (100 ms con reduce-motion).
  - Llamado desde `.onAppear` y `.onChange(scrollToTodayTrigger)`. Botón "Hoy" enciende flag ANTES de cambiar `settledMonthIndex`.
  - Liberar gate desde `.onChange(of: viewModel.allRaceDays.isEmpty)` y `.onChange(of: viewModel.year)`.
  - Acciones programáticas iOS: asignar `currentMonthIndex` + `settledMonthIndex` + cancelar `settleTask`.
- **Android:** `var autoScrollPending = remember { mutableStateOf(isCurrentMonth && todayDay > 1) }`. `effectiveLoadArtwork = loadArtwork && !listState.isScrollInProgress && !autoScrollPending`. `LaunchedEffect` apaga tras `animateScrollToItem`; limpiar manualmente si no hay scroll.
- **Gate DEBE arrancar en `true`** — si filas 1–N se componen con `loadArtwork = true`, latchan y el gate no sirve.
- En iOS Month: solo modo agenda (único modo existente) usa logos/banderas.

## Archivos

- iOS: `SeasonView.swift`, `MonthView.swift` (latch en `MonthScheduleRaceRow`).
- Android: `SeasonScreen.kt`, `MonthScreen.kt` (latch en `MonthScheduleRaceRow`).
