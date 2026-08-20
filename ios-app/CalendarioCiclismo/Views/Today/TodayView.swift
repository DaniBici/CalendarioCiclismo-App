import SwiftUI

/// Wrapper Identifiable para usar un raceId con `.sheet(item:)`.
struct IdentifiableID: Identifiable, Hashable {
    let id: String
}

/// Vista principal de agenda del día — equivalente a `index.html` + `app.js`.
struct TodayView: View {
    var initialDateKey: String?
    var initialFilter: Constants.CategoryFilter?
    /// Binding al `NavigationPath` del `NavigationStack` que contiene este Today.
    /// Solo lo pasa el tab Hoy (ContentView), cuyo stack usa `path:` explícito.
    /// Cuando existe, los pushes programáticos (p. ej. Campeonatos desde el
    /// cintillo) van a ESE path para mantener UNA sola fuente de verdad de la
    /// pila: si se empujara Campeonatos por `navigationDestination(item:)` y
    /// luego, dentro, la celda empuja su etapa al `navigationPath`, SwiftUI
    /// reconcilia el path (que no conoce la entrada `item`) y RECORTA la pila →
    /// la etapa cae por debajo de Campeonatos y la pantalla "rebota" a la rejilla
    /// (el detalle solo aparece al pulsar Atrás). Mezclar `item:` con un stack de
    /// `path:` explícito es la causa. El Today embebido en Mes (MonthView) vive en
    /// un stack SIN path-binding → ahí el fallback `item:` es seguro.
    var navigationPath: Binding<NavigationPath>? = nil
    @State private var viewModel = TodayViewModel()
    @State private var placeholderItem: PlaceholderModalItem?
    @State private var resultsSheetItem: ResultsSheetItem?
    /// Jornadas visibles con resultados in-house (raceDayId → stageNumber): el
    /// trofeo de esas etapas navega a la pantalla nativa, no al modal FC/PCS.
    /// Una query por carrera visible (en Hoy suelen ser pocas); diferido y no
    /// bloqueante (sin red → vacío → modal clásico). Paridad con Android.
    @State private var inhouseByDay: [String: Int?] = [:]
    /// Push programático (por valor) a la pantalla de resultados in-house.
    @State private var resultsRoute: ResultsRoute?
    /// Push programático a la pantalla de Campeonatos (cintillo). Vive en el ROOT
    /// estable, no en `TodayHighlightsBanner` (que muta su estado cada 5 s y
    /// recreaba `ChampionshipsView`, rompiendo la navegación a la prueba tocada).
    @State private var championshipsRoute: ChampionshipsRoute?
    @State private var competitionRaceId: IdentifiableID?
    @State private var startlistSheetRaceId: IdentifiableID?
    @State private var startOrderSheetRaceDayId: IdentifiableID?
    @State private var showSettings = false
    @Environment(\.openURL) private var openURL
    @State private var pendingDefaultFilter: Constants.CategoryFilter? = nil
    @AppStorage("defaultFilter") private var storedDefaultFilter: String = ""
    /// Semana de Campeonatos (22-28 jun): cuando la JORNADA MOSTRADA cae en la
    /// ventana, "Hoy" impone Masculino por defecto, solo ofrece Todas/Pro/Masc/Fem
    /// y no permite fijar otro predeterminado. Reactivo al día mostrado.
    private var champWeekLock: Bool { viewModel.isChampWeekLock }
    @State private var contentOffset: CGFloat = 0
    @State private var isAnimatingNavigation = false
    /// Altura del safe area inferior REAL del área de scroll (tab bar flotante de
    /// iOS 26 + home indicator), capturada ANTES de `.ignoresSafeArea`. El scroll
    /// se extiende bajo la barra para que las cards pasen traslúcidas (efecto
    /// "Liquid Glass"), pero como el contenedor está envuelto en `.offset`/
    /// `.clipped()` (para la animación de cambio de día), UIKit NO inyecta el
    /// content inset que normalmente libraría el último ítem (sí lo hace en
    /// Mes/Temporada, que cuelgan de un `TabView(.page)` sin esa envoltura). Por
    /// eso lo aplicamos a mano como padding inferior del contenido, de modo que
    /// la última card quede completa por encima de la barra al final del scroll.
    @State private var bottomBarInset: CGFloat = 0
    /// `true` mientras el dedo está moviéndose horizontalmente lo suficiente
    /// para considerar que el gesto es un swipe de cambio de día. Se usa para
    /// desactivar las race cards (NavigationLink/Button) mientras dure el
    /// gesto, de modo que al soltar no se dispare la navegación a la jornada
    /// además del cambio de día. `@GestureState` se resetea automáticamente
    /// al terminar el gesto.
    @GestureState private var isHorizontalSwipe: Bool = false
    /// Monitor de conectividad — usado para auto-recargar cuando el usuario
    /// recupera la red tras haber visto datos cacheados o un estado offline.
    @State private var network = NetworkMonitor.shared
    @State private var localeService = LocaleService.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        withObservers
            .alert(
                pendingDefaultFilter?.rawValue == storedDefaultFilter
                    ? localeService.t("Quitar filtro por defecto", "Remove default filter")
                    : localeService.t("Filtro por defecto", "Default filter"),
                isPresented: Binding(get: { pendingDefaultFilter != nil }, set: { if !$0 { pendingDefaultFilter = nil } }),
                presenting: pendingDefaultFilter
            ) { filter in
                if filter.rawValue == storedDefaultFilter {
                    Button(localeService.t("Quitar", "Remove"), role: .destructive) { viewModel.clearDefaultFilter(); pendingDefaultFilter = nil }
                } else {
                    Button(localeService.t("Establecer", "Set")) { viewModel.setDefaultFilter(filter); pendingDefaultFilter = nil }
                }
                Button(localeService.t("Cancelar", "Cancel"), role: .cancel) { pendingDefaultFilter = nil }
            } message: { filter in
                if filter.rawValue == storedDefaultFilter {
                    Text(localeService.t(
                        "Se eliminará «\(filter.label)» como filtro predeterminado y se mostrarán todas las categorías.",
                        "«\(filter.label)» will be removed as the default filter and all categories will be shown."
                    ))
                } else {
                    Text(localeService.t(
                        "El filtro «\(filter.label)» se aplicará como predeterminado en Hoy, Mes y Temporada.",
                        "The filter «\(filter.label)» will be applied as default in Today, Month and Season."
                    ))
                }
            }
            .onChange(of: network.isOnline) { _, isOnline in
                guard isOnline else { return }
                let needsReload = viewModel.isFromCache || viewModel.isUncachedOffline || viewModel.error != nil
                guard needsReload, !viewModel.isLoading else { return }
                Task { await viewModel.refreshDay() }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                // Al volver a primer plano, primero comprobar si cruzamos la
                // medianoche local (auto-avance al nuevo "hoy" si procede).
                viewModel.advanceIfNewLocalDay()
                guard !viewModel.isLoading else { return }
                let stale = viewModel.lastNetworkLoadAt.map { Date().timeIntervalSince($0) > 300 } ?? true
                guard stale else { return }
                Task { await viewModel.refreshDay() }
            }
            .allowsHitTesting(!isAnimatingNavigation)
    }

    private var withObservers: some View {
        withTasks
            .onChange(of: viewModel.isLoading) { _, isLoading in
                guard !isLoading else { return }
                let count = viewModel.displayItems.count
                let label = viewModel.dateLabel
                let msg = count > 0
                    ? "\(label), \(count) \(LocaleService.t("carrera", "race"))\(count == 1 ? "" : LocaleService.t("s", "s"))"
                    : "\(label), \(LocaleService.t("sin carreras", "no races"))"
                AccessibilityAnnouncement.announce(msg)
            }
            .onChange(of: viewModel.activeFilter) { _, _ in
                viewModel.nextDayWithRaces = viewModel.nextDayMatchingFilter(after: viewModel.dateKey)
            }
            .onChange(of: viewModel.sortMode) { _, _ in
                Haptics.play(.selection)
            }
            .onChange(of: storedDefaultFilter) { _, newValue in
                // El pin pudo cambiar desde otra pantalla (Mes/Temporada). Se
                // guarda en el VM; solo se refleja en el filtro mostrado si la
                // jornada actual NO está en la ventana de Campeonatos.
                let filter = Constants.CategoryFilter(rawValue: newValue) ?? .all
                viewModel.syncPinnedFilter(filter)
            }
            .onAppear {
                AnalyticsService.shared.logScreenView("today", parameters: [
                    "category_filter": viewModel.activeFilter.rawValue,
                ])
            }
    }

    private var withTasks: some View {
        configuredView
            .task {
                guard !viewModel.hasLoaded else { return }
                // Si el deep link abre una jornada concreta, aplicar la transición
                // de bloqueo de Campeonatos (puede ser un día de la ventana).
                if let initial = initialDateKey { viewModel.applyDateForChampLock(initial) }
                if let filter = initialFilter { viewModel.activeFilter = filter }
                await viewModel.loadDay()
            }
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(300))
                    // Comprobar el cruce de medianoche antes del guard isToday: si
                    // se cruzó, isToday ya sería false y el refresco se detendría
                    // sin avanzar nunca.
                    viewModel.advanceIfNewLocalDay()
                    guard viewModel.isToday, !viewModel.isLoading else { continue }
                    await viewModel.refreshDay()
                }
            }
            .task(id: viewModel.dateKey) {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(300))
                    guard !Task.isCancelled else { break }
                    guard !viewModel.isLoading else { continue }
                    await viewModel.refreshDay()
                }
            }
            // Mapa de jornadas visibles con resultados in-house (clave para
            // redirigir el trofeo). Se recalcula al cambiar el día/filtro.
            .task(id: inhouseTaskKey) { await loadInhouseMap() }
    }

    /// Clave del efecto: carreras visibles + jornadas visibles, para que el mapa
    /// se recalcule al cambiar de día o de filtro (espejo de `visibleKey` Android).
    private var inhouseTaskKey: String {
        let items = viewModel.displayItems
        let raceIds = Set(items.compactMap { $0.race?.id }).sorted().joined(separator: ",")
        let dayIds = items.map(\.id).joined(separator: ",")
        return raceIds + "|" + dayIds
    }

    /// Carga el mapa raceDayId → stageNumber de las carreras visibles. Agrupa por
    /// carrera y pasa sus jornadas para resolver el caso de un día/general (la
    /// stage 'gc' no trae raceDayId).
    private func loadInhouseMap() async {
        let items = viewModel.displayItems.filter { $0.race != nil }
        guard !items.isEmpty else {
            inhouseByDay = [:]
            return
        }
        var merged: [String: Int?] = [:]
        let byRace = Dictionary(grouping: items) { $0.race!.id }
        for (raceId, days) in byRace {
            let pairs = days.map { ($0.raceDay.id, $0.raceDay.stageNumber) }
            let cancelled = Set(days.filter { $0.raceDay.isCancelledDay }.map { $0.raceDay.id })
            let map = await SupabaseService.shared.inhouseStagesForDays(
                raceId: raceId, days: pairs, cancelledDayIds: cancelled
            )
            merged.merge(map) { _, new in new }
        }
        inhouseByDay = merged
    }

    // MARK: - Configured view

    private var configuredView: some View {
        mainStack
            .navigationTitle(viewModel.isToday ? localeService.t("Hoy", "Today") : viewModel.dateLabel)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarItems }
            .navigationDestination(for: EnrichedRaceDay.self) { item in
                StageDetailView(raceDayId: item.raceDay.id)
            }
            // Push a Campeonatos (lo dispara el cintillo vía `onTapChampionships`).
            // NO se ancla en `TodayHighlightsBanner` (se recrea cada 5 s por el
            // auto-advance). Dos registros para los dos contextos de TodayView:
            //  · value-based → lo consume el `navigationPath` cuando el cintillo
            //    empuja `ChampionshipsRoute()` al path (tab Hoy, stack con path:).
            //  · item-based  → fallback para el Today embebido en Mes (stack SIN
            //    path-binding), donde no hay path al que empujar.
            // Cada contexto dispara solo UNO → no se duplica en pantalla.
            .navigationDestination(for: ChampionshipsRoute.self) { _ in
                ChampionshipsView()
            }
            .navigationDestination(item: $championshipsRoute) { _ in
                ChampionshipsView()
            }
            .navigationDestination(item: $competitionRaceId) { item in
                RaceDetailView(raceId: item.id)
            }
            // Push por valor a la pantalla de resultados in-house (trofeo de las
            // race cards). Data-driven, como ChampionshipsRoute, para no
            // corromper el NavigationStack de Hoy.
            .navigationDestination(item: $resultsRoute) { route in
                ResultsView(raceId: route.raceId, initialStageNumber: route.stageNumber, initialStageSuffix: route.stageSuffix)
            }
            .navigationDestination(isPresented: $showSettings) {
                SettingsView()
            }
            .placeholderModal(item: $placeholderItem)
            .resultsSheet(item: $resultsSheetItem)
            .sheet(item: $startlistSheetRaceId) { wrapper in
                NavigationStack {
                    StartlistView(raceId: wrapper.id, showDismissButton: true)
                }
            }
            .sheet(item: $startOrderSheetRaceDayId) { wrapper in
                NavigationStack {
                    StartOrderView(raceDayId: wrapper.id, showDismissButton: true)
                }
            }
    }

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) { leadingToolbarView }
        ToolbarItem(placement: .topBarTrailing) { trailingToolbarView }
    }

    @ViewBuilder
    private var leadingToolbarView: some View {
        HStack(spacing: 8) {
            Button {
                Haptics.play(.navigation)
                animateNavigation(forward: false) { viewModel.goToPreviousDay() }
            } label: {
                Image(systemName: "chevron.left")
            }
            .accessibilityLabel(localeService.t("Día anterior", "Previous day"))
            .accessibilityIdentifier(AccessibilityID.previousDayButton)
            .accessibilityInputLabels([localeService.t("Día anterior", "Previous day"), localeService.t("Anterior", "Previous"), localeService.t("Ayer", "Yesterday")])

            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape")
            }
            .accessibilityLabel(localeService.t("Ajustes", "Settings"))
            .accessibilityHint(localeService.t("Calendario iCal, notificaciones y privacidad", "iCal calendar, notifications and privacy"))
            .accessibilityInputLabels([localeService.t("Ajustes", "Settings"), localeService.t("Configuración", "Configuration"), localeService.t("Opciones", "Options")])
            .accessibilityIdentifier(AccessibilityID.settingsButton)
        }
    }

    @ViewBuilder
    private var trailingToolbarView: some View {
        HStack(spacing: 12) {
            if !viewModel.isToday {
                Button(localeService.t("Ir al día de hoy", "Go to today")) {
                    Haptics.play(.navigation)
                    let forward = DateFormatting.todayKey() >= viewModel.dateKey
                    animateNavigation(forward: forward) { viewModel.goToToday() }
                }
                .font(.caption)
                .accessibilityIdentifier(AccessibilityID.todayButton)
                .accessibilityInputLabels([localeService.t("Hoy", "Today"), localeService.t("Ir a hoy", "Go to today"), localeService.t("Día de hoy", "Today")])
            }
            Button {
                Haptics.play(.navigation)
                animateNavigation(forward: true) { viewModel.goToNextDay() }
            } label: {
                Image(systemName: "chevron.right")
            }
            .accessibilityLabel(localeService.t("Día siguiente", "Next day"))
            .accessibilityIdentifier(AccessibilityID.nextDayButton)
            .accessibilityInputLabels([localeService.t("Día siguiente", "Next day"), localeService.t("Siguiente", "Next"), localeService.t("Mañana", "Tomorrow")])
        }
    }

    /// Navega a Campeonatos. Con `navigationPath` (tab Hoy) empuja al MISMO path
    /// que usan las celdas de la rejilla → una sola fuente de verdad, sin rebote.
    /// Sin él (Today embebido en Mes) cae al `@State` item-based.
    private func goToChampionships() {
        if let path = navigationPath {
            path.wrappedValue.append(ChampionshipsRoute())
        } else {
            championshipsRoute = ChampionshipsRoute()
        }
    }

    // MARK: - Main stack

    @ViewBuilder private var mainStack: some View {
        // Ya NO hay takeover ni pantalla dedicada de Campeonatos en la vista Hoy:
        // las fechas de la semana de Campeonatos fluyen por el flujo normal
        // (barra de fecha, chips, lista de carreras). El botón "Ir a Campeonatos"
        // solo aparece como ESTADO VACÍO cuando el día/filtro no tiene carreras.
        normalStack
    }

    @ViewBuilder private var normalStack: some View {
        VStack(spacing: 0) {
            TodayHighlightsBanner(onTapChampionships: goToChampionships)
                .padding(.top, 8)
                .padding(.bottom, 10)

            DateBarView(
                selectedDate: viewModel.dateKey,
                isToday: viewModel.isToday,
                onSelect: { newDate in
                    let forward = newDate > viewModel.dateKey
                    animateNavigation(forward: forward) { viewModel.goToDate(newDate) }
                },
                onToday: {
                    let forward = DateFormatting.todayKey() >= viewModel.dateKey
                    animateNavigation(forward: forward) { viewModel.goToToday() }
                }
            )

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    let chips = champWeekLock
                        ? ChampionshipsConfig.champWeekHoyFilters
                        : Constants.CategoryFilter.allCases
                    ForEach(chips) { filter in
                        filterChipView(filter: filter)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }
            .accessibilityIdentifier(AccessibilityID.categoryFilters)

            sortMenuBar

            if viewModel.isFromCache && !viewModel.isNetworkLoading {
                OfflineBanner(ageLabel: viewModel.cacheAgeLabel)
            }

            Divider()

            contentArea
        }
    }

    // MARK: - Sort menu bar

    @ViewBuilder private var sortMenuBar: some View {
        HStack {
            Text(viewModel.dateLabel)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)

            Spacer()

            Menu {
                Picker(localeService.t("Ordenar", "Sort"), selection: $viewModel.sortMode) {
                    ForEach(TodayViewModel.SortMode.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.up.arrow.down")
                    Text(viewModel.sortMode.label)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .accessibilityLabel(localeService.t("Ordenar carreras por \(viewModel.sortMode.label)", "Sort races by \(viewModel.sortMode.label)"))
            .accessibilityHint(localeService.t("Pulsa dos veces para cambiar el orden", "Double tap to change sort order"))
            .accessibilityIdentifier(AccessibilityID.sortMenu)
            .accessibilityInputLabels([localeService.t("Ordenar", "Sort"), localeService.t("Cambiar orden", "Change order"), localeService.t("Orden", "Order")])
        }
        .padding(.horizontal)
        .padding(.vertical, 4)
    }

    // MARK: - Content area

    @ViewBuilder private var contentArea: some View {
        Group {
            if viewModel.isLoading {
                LoadingView(message: LocaleService.t("Cargando carreras...", "Loading races..."), branded: true)
            } else {
                ScrollView {
                    raceScrollContent
                }
                .refreshable {
                    await viewModel.refreshDay()
                    Haptics.play(.success)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .offset(x: contentOffset)
        .clipped()
        // El área de scroll llega hasta el borde inferior de la pantalla (por
        // DEBAJO de la tab bar flotante de iOS 26): así las cards pasan
        // traslúcidas bajo la barra "Liquid Glass" al desplazarse, en vez de
        // cortarse en su borde.
        //
        // ⚠️ A diferencia de un ScrollView "pelado", aquí la envoltura
        // `.offset(x:)` + `.clipped()` (necesaria para la animación de cambio de
        // día) ROMPE la cadena por la que UIKit inyectaría el content inset de la
        // tab bar: medido en simulador, `safeAreaInsets.bottom` del scroll = 0 con
        // y sin `.ignoresSafeArea`, y el del `.background` externo también. Por eso
        // el último ítem quedaba tapado por la barra. La barra flotante tampoco
        // modifica el safe area de la window (solo el home indicator, 34pt). La
        // ÚNICA medida fiable es la altura real de la `UITabBar` leída de la
        // window (`TabBarInsetReader`), que aplicamos como colchón inferior del
        // contenido para que la última card quede completa sobre la barra al
        // final del scroll. (Mes/Temporada no lo necesitan: cuelgan de un
        // `TabView(.page)` que sí recibe el inset del sistema.)
        .ignoresSafeArea(.container, edges: .bottom)
        .background(TabBarInsetReader(inset: $bottomBarInset))
        .simultaneousGesture(
            // minimumDistance bajo para que la detección de "swipe horizontal"
            // dispare en `.updating` antes de que el sistema considere que el
            // touch-up pulsa la race card. El umbral real para cambiar de día
            // se sigue aplicando en `.onEnded` (60pt).
            DragGesture(minimumDistance: 10, coordinateSpace: .local)
                .updating($isHorizontalSwipe) { value, state, _ in
                    let h = abs(value.translation.width)
                    let v = abs(value.translation.height)
                    if h > 15 && h > v * 1.5 { state = true }
                }
                .onEnded { value in
                    let h = value.translation.width
                    let v = abs(value.translation.height)
                    guard abs(h) > v, abs(h) > 60 else { return }
                    Haptics.play(.navigation)
                    if h < 0 {
                        animateNavigation(forward: true) { viewModel.goToNextDay() }
                    } else {
                        animateNavigation(forward: false) { viewModel.goToPreviousDay() }
                    }
                }
        )
    }

    @ViewBuilder private var raceScrollContent: some View {
        if viewModel.isUncachedOffline {
            VStack(spacing: 16) {
                EmptyStateView(
                    icon: "icloud.slash",
                    title: LocaleService.t("Día no disponible offline", "Day not available offline"),
                    subtitle: LocaleService.t("Este día no está guardado en tu dispositivo. Se cargará automáticamente cuando recuperes la conexión.", "This day is not saved on your device. It will load automatically when you regain connection.")
                )
                .fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { await viewModel.loadDay() }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise")
                        Text(LocaleService.t("Reintentar", "Retry"))
                    }
                    .font(.subheadline)
                    .fontWeight(.medium)
                }
                .buttonStyle(.bordered)
                .accessibilityHint(LocaleService.t("Intenta cargar los datos de nuevo", "Try loading data again"))
            }
            .frame(maxWidth: .infinity, minHeight: 320)
        } else if let error = viewModel.error {
            ErrorView(message: error) {
                Task { await viewModel.loadDay() }
            }
            .frame(maxWidth: .infinity, minHeight: 320)
        } else if viewModel.displayItems.isEmpty {
            VStack(spacing: 16) {
                EmptyStateView(
                    icon: "calendar.badge.exclamationmark",
                    title: LocaleService.t("No hay carreras", "No races"),
                    subtitle: LocaleService.t("No hay carreras programadas para este día", "No races scheduled for this day")
                )
                .fixedSize(horizontal: false, vertical: true)
                if let nextDate = viewModel.nextDayWithRaces {
                    Button {
                        Haptics.play(.navigation)
                        animateNavigation(forward: true) { viewModel.goToDate(nextDate) }
                    } label: {
                        HStack(spacing: 4) {
                            Text(LocaleService.t("Ir al próximo día con carreras", "Go to next day with races"))
                            Image(systemName: "arrow.right")
                        }
                        .font(.subheadline)
                        .fontWeight(.medium)
                    }
                    .accessibilityHint(LocaleService.t("Navega al siguiente día que tenga carreras programadas", "Navigate to the next day with scheduled races"))
                    .accessibilityInputLabels([LocaleService.t("Próximo día con carreras", "Next day with races"), LocaleService.t("Siguiente día", "Next day"), LocaleService.t("Próximo día", "Next day")])
                }
            }
            .frame(maxWidth: .infinity, minHeight: 320)
        } else {
            LazyVStack(spacing: 8) {
                let items = viewModel.displayItems
                ForEach(items) { item in
                    raceItemView(item: item, refreshToken: String(viewModel.refreshToken))
                }
            }
            .padding(.horizontal)
            .padding(.top, 8)
            // Colchón inferior = el aire normal (8) + el safe area que el sistema
            // no inyecta aquí, para que la última card quede completa sobre la
            // tab bar flotante al final del scroll (las intermedias siguen
            // pasando traslúcidas bajo la barra al desplazarse).
            .padding(.bottom, 8 + bottomBarInset)
            .accessibilityIdentifier(AccessibilityID.raceList)
        }
    }

    // MARK: - Filter chip

    @ViewBuilder
    private func filterChipView(filter: Constants.CategoryFilter) -> some View {
        TodayFilterChip(
            filter: filter,
            isActive: viewModel.activeFilter == filter,
            activeFilter: viewModel.activeFilter,
            // En la semana de Campeonatos el pin está inhibido: sin chincheta.
            pinnedRawValue: champWeekLock ? "" : storedDefaultFilter,
            onTap: {
                if viewModel.activeFilter == filter {
                    // Fijado inhibido durante la semana de Campeonatos.
                    if !champWeekLock {
                        Haptics.play(.primaryAction)
                        pendingDefaultFilter = filter
                    }
                } else {
                    Haptics.play(.selection)
                    viewModel.selectFilter(filter)
                }
            },
            onLongPress: {
                guard !champWeekLock else { return }
                Haptics.play(.primaryAction)
                pendingDefaultFilter = filter
            }
        )
    }

    // MARK: - Race item

    @ViewBuilder
    private func raceItemView(item: EnrichedRaceDay, refreshToken: String) -> some View {
        // In-house: si la jornada tiene clasificación propia, el trofeo va a la
        // pantalla nativa (no al modal FC/PCS). Presencia en el mapa = la tiene.
        let hasInhouse = inhouseByDay.index(forKey: item.id) != nil
        let inhouseStage = inhouseByDay[item.id].flatMap { $0 }
        let showResults = hasInhouse || RaceLogic.shouldShowResults(rd: item.raceDay, race: item.race)
        let hideNoIds = !showResults && RaceLogic.noIdsAndPastDeadline(rd: item.raceDay, race: item.race)
        let reviveURL = (showResults || hideNoIds) ? RaceLogic.reviveUrl(from: item.broadcasts) : nil
        let isFinalStage = item.race?.isStageRace == true
            && !item.raceDay.isRestDay
            && !item.raceDay.isCancelledDay
            && item.raceDay.dateKey == item.race?.endDate
        // Identidad compuesta: SwiftUI preserva instancias de view
        // por item.id incluso si el contenedor cambia de .id —
        // añadir el token fuerza destrucción/creación real de cada
        // card en cada respuesta de red fresca.
        let viewId: String = "\(refreshToken)-\(item.id)"

        if item.isPlaceholder {
            Button {
                Haptics.play(.navigation)
                if let race = item.race {
                    placeholderItem = PlaceholderModalItem(race: race, raceDay: item.raceDay)
                }
            } label: {
                RaceCardView(item: item, activeFilter: viewModel.activeFilter, isFinalStage: isFinalStage)
            }
            .buttonStyle(.plain)
            .disabled(isHorizontalSwipe)
            .accessibilityHint("Sin información detallada, pulsa dos veces para ver más")
            .accessibilityIdentifier(AccessibilityID.raceCard(item.id))
            .id(viewId)
        } else if item.raceDay.isRestDay {
            // La jornada cancelada SÍ navega a su ficha (paridad con la vista de
            // competición y la web): conserva recorrido, perfil y documentación.
            // La de DESCANSO no: no tiene ficha que abrir.
            RaceCardView(item: item, activeFilter: viewModel.activeFilter, isFinalStage: isFinalStage)
                .accessibilityIdentifier(AccessibilityID.raceCard(item.id))
                .id(viewId)
        } else {
            NavigationLink(value: item) {
                RaceCardView(
                    item: item,
                    activeFilter: viewModel.activeFilter,
                    onShowResults: showResults ? {
                        Haptics.play(.primaryAction)
                        guard let race = item.race else { return }
                        if hasInhouse {
                            resultsRoute = ResultsRoute(raceId: race.id, stageNumber: inhouseStage, stageSuffix: item.raceDay.stageSuffix)
                        } else {
                            resultsSheetItem = ResultsSheetItem(race: race, raceDay: item.raceDay)
                        }
                    } : nil,
                    onRevive: reviveURL != nil ? {
                        Haptics.play(.primaryAction)
                        if let url = reviveURL { openURL(url) }
                    } : nil,
                    onShowStartlist: item.race?.startlistImportedAt != nil ? {
                        if let race = item.race {
                            startlistSheetRaceId = IdentifiableID(id: race.id)
                        }
                    } : nil,
                    onStartOrderTap: {
                        startOrderSheetRaceDayId = IdentifiableID(id: item.raceDay.id)
                    },
                    onShowCompetition: item.race?.isStageRace == true && item.race?.startDate != item.race?.endDate ? {
                        guard let raceId = item.race?.id else { return }
                        if let path = navigationPath {
                            path.wrappedValue.append(DeepLinkDestination.race(raceId))
                        } else {
                            competitionRaceId = IdentifiableID(id: raceId)
                        }
                    } : nil,
                    isFinalStage: isFinalStage
                )
            }
            .buttonStyle(.plain)
            // Mientras el usuario esté deslizando lateralmente para cambiar de
            // día, desactivamos la card para que el touch-up no dispare la
            // navegación a la jornada en paralelo al cambio de día.
            .disabled(isHorizontalSwipe)
            .simultaneousGesture(TapGesture().onEnded {
                guard !isHorizontalSwipe else { return }
                Haptics.play(.navigation)
            })
            .accessibilityHint("Pulsa dos veces para ver el detalle de la etapa")
            .accessibilityIdentifier(AccessibilityID.raceCard(item.id))
            .id(viewId)
        }
    }

    // MARK: - Navigation animation

    /// Animated day transition: slides the content out, performs the navigation, then slides new content in.
    private func animateNavigation(forward: Bool, action: @escaping () -> Void) {
        guard !isAnimatingNavigation else { return }
        isAnimatingNavigation = true
        let width = UIScreen.main.bounds.width
        let outDir: CGFloat = forward ? -1 : 1
        withAnimation(.easeOut(duration: 0.15)) {
            contentOffset = outDir * width
        }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            action()
            contentOffset = -outDir * width
            withAnimation(.easeOut(duration: 0.2)) {
                contentOffset = 0
            }
            try? await Task.sleep(for: .milliseconds(200))
            isAnimatingNavigation = false
        }
    }
}

// MARK: - Filter chip

/// Chip de filtro de categoría para TodayView.
/// Extraído en struct propio para que el type-checker de Swift no se ahogue
/// con la cadena de modificadores + gestures + accesibilidad inline.
private struct TodayFilterChip: View {
    let filter: Constants.CategoryFilter
    let isActive: Bool
    let activeFilter: Constants.CategoryFilter
    let pinnedRawValue: String
    let onTap: () -> Void
    let onLongPress: () -> Void

    private enum PinDisplay { case filled, outline, hidden }

    private var pinDisplay: PinDisplay {
        if filter == .all || activeFilter == .all { return .hidden }
        let pinned = Constants.CategoryFilter(rawValue: pinnedRawValue)
        if let p = pinned, p != .all, p == filter { return .filled }
        if filter == activeFilter { return .outline }
        return .hidden
    }

    var body: some View {
        HStack(spacing: 4) {
            Text(filter.label)
                .fontWeight(isActive ? .semibold : .regular)
            switch pinDisplay {
            case .filled:
                Image(systemName: "pin.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
            case .outline:
                Image(systemName: "pin")
                    .font(.system(size: 10))
                    .foregroundStyle(Color.accentColor)
                    .opacity(0.55)
            case .hidden:
                EmptyView()
            }
        }
        .font(.caption)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        // Activo en azul de marca suave (15%) + texto azul — mismo gesto que el
        // cintillo "Hoy" y el día seleccionado, en vez del azul sólido + blanco.
        .background(isActive ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemBackground))
        .foregroundStyle(isActive ? Color.accentColor : Color(.secondaryLabel))
        .clipShape(Capsule())
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
        .onLongPressGesture(minimumDuration: 0.5, pressing: { isPressing in
            if isPressing { Haptics.play(.selection) }
        }, perform: { onLongPress() })
        .accessibilityAddTraits([.isButton])
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
        .accessibilityLabel(pinDisplay == .filled
            ? "\(LocaleService.t("Filtro", "Filter")) \(filter.label), \(LocaleService.t("fijado como predeterminado", "set as default"))"
            : "\(LocaleService.t("Filtro", "Filter")) \(filter.label)")
        .accessibilityHint(isActive
            ? LocaleService.t("Filtro activo. Mantén pulsado para establecer como filtro por defecto.", "Active filter. Long press to set as default filter.")
            : LocaleService.t("Pulsa dos veces para filtrar por \(filter.label). Mantén pulsado para establecer como filtro por defecto.", "Double tap to filter by \(filter.label). Long press to set as default filter."))
        .accessibilityIdentifier(AccessibilityID.filterButton(filter.rawValue))
    }
}

// MARK: - Tab bar inset reader

/// Mide la altura REAL de la `UITabBar` flotante de iOS 26 leyéndola de la
/// ventana, y la publica en un binding. Necesario porque en `TodayView` la
/// envoltura `.offset`/`.clipped()` del área de scroll impide que UIKit propague
/// el content inset de la tab bar al SwiftUI (medido: `safeAreaInsets.bottom` = 0
/// en el subárbol), y la barra flotante tampoco modifica el safe area de la
/// window. Esta vía —recorrer la jerarquía UIKit hasta la `UITabBar`— sí da la
/// altura correcta (p. ej. 83pt en un iPhone 17 Pro = 49 de barra + 34 de home
/// indicator; 0 cuando no hay tab bar, p. ej. en pruebas o iPad multitarea).
///
/// Re-mide en `updateUIView` y en cada `layoutSubviews` (rotación, cambios de
/// safe area). El binding solo se escribe si el valor cambió, para no provocar
/// ciclos de layout.
private struct TabBarInsetReader: UIViewRepresentable {
    @Binding var inset: CGFloat

    func makeUIView(context: Context) -> InsetProbeView {
        let v = InsetProbeView()
        v.onResolve = { newValue in
            // Diferido para no mutar estado de SwiftUI durante el ciclo de layout.
            DispatchQueue.main.async {
                if abs(inset - newValue) > 0.5 { inset = newValue }
            }
        }
        return v
    }

    func updateUIView(_ uiView: InsetProbeView, context: Context) {
        uiView.resolve()
    }

    final class InsetProbeView: UIView {
        var onResolve: ((CGFloat) -> Void)?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            resolve()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            resolve()
        }

        func resolve() {
            guard let w = window else { return }
            let height = Self.findTabBar(w)?.frame.height ?? 0
            onResolve?(height)
        }

        private static func findTabBar(_ v: UIView) -> UITabBar? {
            if let tb = v as? UITabBar { return tb }
            for sub in v.subviews {
                if let found = findTabBar(sub) { return found }
            }
            return nil
        }
    }
}
