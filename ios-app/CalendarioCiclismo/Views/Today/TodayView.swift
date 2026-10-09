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
    /// Jornadas visibles con resultados in-house (raceDayId → stageNumber): el
    /// acceso de esas etapas navega a la pantalla nativa. Sin clasificación
    /// publicada, Hoy mantiene el estado «Esperando resultados» y no ofrece
    /// enlaces provisionales a proveedores externos. Paridad con Android.
    @State private var inhouseByDay: [String: Int?] = [:]
    /// Push programático (por valor) a la pantalla de resultados in-house.
    @State private var resultsRoute: ResultsRoute?
    /// Push programático a la pantalla de Campeonatos (cintillo). Vive en el ROOT
    /// estable, no en `TodayHighlightsBanner` (que muta su estado cada 5 s y
    /// recreaba `ChampionshipsView`, rompiendo la navegación a la prueba tocada).
    @State private var championshipsRoute: ChampionshipsRoute?
    @State private var competitionRaceId: IdentifiableID?
    @State private var highlightedStageDayId: IdentifiableID?
    @State private var startlistRouteRaceId: IdentifiableID?
    @State private var startOrderRouteRaceDayId: IdentifiableID?
    @State private var showSettings = false
    @State private var safariURL: URL?
    @State private var pendingDefaultFilter: Constants.CategoryFilter? = nil
    @AppStorage("defaultFilter") private var storedDefaultFilter: String = ""
    /// Semana de Campeonatos (22-28 jun): cuando la JORNADA MOSTRADA cae en la
    /// ventana, "Hoy" impone Masculino por defecto, solo ofrece Todas/Pro/Masc/Fem
    /// y no permite fijar otro predeterminado. Reactivo al día mostrado.
    private var champWeekLock: Bool { viewModel.isChampWeekLock }
    @State private var contentOffset: CGFloat = 0
    @State private var contentWidth: CGFloat = 0
    @State private var isAnimatingNavigation = false
    /// `true` mientras el dedo está moviéndose horizontalmente lo suficiente
    /// para considerar que el gesto es un swipe de cambio de día. Se usa para
    /// desactivar las race cards (NavigationLink/Button) mientras dure el
    /// gesto, de modo que al soltar no se dispare la navegación a la jornada
    /// además del cambio de día. `@GestureState` se resetea automáticamente
    /// al terminar el gesto.
    @GestureState private var isHorizontalSwipe: Bool = false
    /// Monitor de conectividad — usado para auto-recargar cuando el usuario
    /// recupera la red tras haber visto datos cacheados o un estado offline.
    @State private var statusNow = Date()
    @State private var network = NetworkMonitor.shared
    @State private var localeService = LocaleService.shared
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

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
            .allowsHitTesting(!isAnimatingNavigation)
            .safariSheet(url: $safariURL)
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
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                statusNow = Date()
                viewModel.advanceIfNewLocalDay()
                if viewModel.hasLoaded, !viewModel.isNetworkLoading,
                   viewModel.lastNetworkLoadAt.map({ Date().timeIntervalSince($0) > 60 }) ?? true {
                    await viewModel.refreshDay()
                }
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(60)) } catch { return }
                    statusNow = Date()
                    viewModel.advanceIfNewLocalDay()
                    guard viewModel.isToday, !viewModel.isNetworkLoading else { continue }
                    // Sin nada en curso, en espera de resultados o a punto de
                    // salir no hay datos que cambien: se omite la recarga.
                    guard RaceLogic.needsLiveRefresh(
                        viewModel.items,
                        inhouseDayIds: Set(inhouseByDay.keys)
                    ) else { continue }
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
        return raceIds + "|" + dayIds + "|\(viewModel.refreshToken)"
    }

    /// Carga el mapa raceDayId → stageNumber de las carreras visibles. Pasa las
    /// jornadas de cada carrera para resolver el caso de un día/general (la
    /// stage 'gc' no trae raceDayId).
    private func loadInhouseMap() async {
        let items = viewModel.displayItems.filter { $0.race != nil }
        guard !items.isEmpty else {
            inhouseByDay = [:]
            return
        }
        // Una sola consulta para todas las carreras visibles.
        let requests = items.map {
            SupabaseService.InhouseDayRequest(
                raceId: $0.race!.id,
                raceDayId: $0.raceDay.id,
                stageNumber: $0.raceDay.stageNumber,
                isCancelled: $0.raceDay.isCancelledDay
            )
        }
        let merged = await SupabaseService.shared.inhouseStagesForDays(requests)
        guard !Task.isCancelled else { return }
        inhouseByDay = merged
    }

    // MARK: - Configured view

    private var configuredView: some View {
        mainStack
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarItems }
            .navigationDestination(for: EnrichedRaceDay.self) { item in
                StageDetailView(raceDayId: item.raceDay.id, raceIdHint: item.raceDay.raceId, titleHint: StageDetailView.title(raceName: item.race?.localizedName, raceDay: item.raceDay))
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
            .navigationDestination(item: $highlightedStageDayId) { wrapper in
                StageDetailView(raceDayId: wrapper.id)
            }
            .navigationDestination(item: $startlistRouteRaceId) { wrapper in
                StartlistView(raceId: wrapper.id)
            }
            .navigationDestination(item: $startOrderRouteRaceDayId) { wrapper in
                StartOrderView(raceDayId: wrapper.id)
            }
    }

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        // iOS 26 envuelve automáticamente los ToolbarItem interactivos en una
        // cápsula de Liquid Glass. El logotipo es una enseña gráfica, no un
        // control con fondo: se conserva la interacción, pero se suprime ese
        // contenedor del sistema únicamente para este elemento.
        if #available(iOS 26, *) {
            ToolbarItem(placement: .topBarLeading) {
                todayLogo
            }
            .sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: .topBarLeading) {
                todayLogo
            }
        }
        // Ajustes es una utilidad de cabecera, no un botón destacado. En iOS 26
        // se elimina su cápsula Liquid Glass compartida, igual que en la marca de
        // CC, conservando un área táctil de 44 puntos.
        if #available(iOS 26, *) {
            ToolbarItem(placement: .topBarTrailing) {
                todayUtilityActions
            }
            .sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: .topBarTrailing) {
                todayUtilityActions
            }
        }
    }

    private var todayUtilityActions: some View {
        HStack(spacing: 4) {
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.accentColor)
            .accessibilityLabel(localeService.t("Ajustes", "Settings"))
            .accessibilityHint(localeService.t("Calendario iCal, notificaciones y privacidad", "iCal calendar, notifications and privacy"))
            .accessibilityInputLabels([localeService.t("Ajustes", "Settings"), localeService.t("Configuración", "Configuration"), localeService.t("Opciones", "Options")])
            .accessibilityIdentifier(AccessibilityID.settingsButton)
        }
    }

    private var todayLogo: some View {
        CCHeaderBrandView()
            .contentShape(Rectangle())
            .onTapGesture {
                Haptics.play(.navigation)
                let forward = DateFormatting.todayKey() >= viewModel.dateKey
                animateNavigation(forward: forward) { await viewModel.goToToday() }
            }
            .accessibilityAddTraits(.isButton)
            .accessibilityAction {
                let forward = DateFormatting.todayKey() >= viewModel.dateKey
                animateNavigation(forward: forward) { await viewModel.goToToday() }
            }
            .accessibilityLabel(localeService.t("Ir al día de hoy", "Go to today"))
            .accessibilityInputLabels([localeService.t("Hoy", "Today"), localeService.t("Ir a hoy", "Go to today"), localeService.t("Día de hoy", "Today")])
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
            TodayHighlightsBanner(
                onTapChampionships: goToChampionships,
                onOpenTarget: openHighlightedTarget
            )
                .padding(.top, 8)
                .padding(.bottom, 10)

            dateNavigationBar

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
        .background(AppTheme.background)
    }

    private func openHighlightedTarget(_ target: TodayHighlightTarget) {
        switch target {
        case .stage(let id):
            highlightedStageDayId = IdentifiableID(id: id)
        case .race(let id):
            competitionRaceId = IdentifiableID(id: id)
        case .startlist(let id):
            startlistRouteRaceId = IdentifiableID(id: id)
        case .startOrder(let id):
            startOrderRouteRaceDayId = IdentifiableID(id: id)
        case .championships:
            goToChampionships()
        case .transfers:
            NotificationManager.shared.pendingDeepLink = .tab(2)
        case .season(let year):
            NotificationManager.shared.pendingDeepLink = .season(year)
        case .cxRace(let id):
            NotificationManager.shared.pendingDeepLink = .cxRace(id, anchor: nil)
        case .cxTournament:
            break
        }
    }

    /// Navegación de fecha situada bajo el cintillo: acceso a Hoy cuando procede,
    /// selector de siete días y flechas anterior/siguiente.
    private var dateNavigationBar: some View {
        HStack(spacing: 0) {
            Button {
                Haptics.play(.navigation)
                animateNavigation(forward: false) { await viewModel.goToPreviousDay() }
            } label: {
                Image(systemName: "chevron.left")
                    .frame(width: 44, height: 60)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(localeService.t("Día anterior", "Previous day"))
            .accessibilityIdentifier(AccessibilityID.previousDayButton)
            .accessibilityInputLabels([localeService.t("Día anterior", "Previous day"), localeService.t("Anterior", "Previous"), localeService.t("Ayer", "Yesterday")])

            if !viewModel.isShowingCurrentDay {
                Button {
                    Haptics.play(.navigation)
                    let forward = DateFormatting.todayKey() >= viewModel.dateKey
                    animateNavigation(forward: forward) { await viewModel.goToToday() }
                } label: {
                    Text(localeService.t("Hoy", "Today"))
                        .ccFont(.s14, weight: .semibold)
                        .foregroundStyle(Color.accentColor)
                        .frame(minWidth: 44, minHeight: 48)
                        .padding(.horizontal, 4)
                        .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: AppTheme.Radius.surface))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(localeService.t("Ir al día de hoy", "Go to today"))
                .accessibilityIdentifier(AccessibilityID.todayButton)
            }

            DateBarView(
                selectedDate: viewModel.dateKey,
                lastDate: TodaySeason.lastDay(),
                onSelect: { newDate in
                    let forward = newDate > viewModel.dateKey
                    animateNavigation(forward: forward) { await viewModel.navigate(to: newDate) }
                }
            )
            // Al abandonar o recuperar el día actual aparece o desaparece el
            // botón Hoy y cambia el ancho disponible. Recrear solo en esa
            // transición evita reutilizar un offset calculado con celdas de
            // otro ancho, que podía desplazar la selección siete u ocho días.
            .id(viewModel.isShowingCurrentDay)

            Button {
                Haptics.play(.navigation)
                animateNavigation(forward: true) { await viewModel.goToNextDay() }
            } label: {
                Image(systemName: "chevron.right")
                    .frame(width: 44, height: 60)
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canGoToNextDay)
            .opacity(viewModel.canGoToNextDay ? 1 : 0.3)
            .accessibilityLabel(localeService.t("Día siguiente", "Next day"))
            .accessibilityIdentifier(AccessibilityID.nextDayButton)
            .accessibilityInputLabels([localeService.t("Día siguiente", "Next day"), localeService.t("Siguiente", "Next"), localeService.t("Mañana", "Tomorrow")])
        }
        .foregroundStyle(Color.accentColor)
        .background(AppTheme.headerBackground)
    }

    // MARK: - Sort menu bar

    @ViewBuilder private var sortMenuBar: some View {
        HStack {
            Text(viewModel.dateLabel)
                .ccFont(.s14, weight: .medium)
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
                .ccFont(.s13, weight: .semibold)
                .foregroundStyle(.secondary)
            }
            // Control secundario en gris, como `.agenda-sort-select` de la web:
            // el acento queda para la selección.
            .tint(AppTheme.textMuted)
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
                LoadingView(branded: true, title: LocaleService.t("Carreras de hoy", "Today's races"))
            } else {
                ScrollView {
                    raceScrollContent
                }
                // Cada fecha debe empezar en la cabecera de su propia lista.
                // Sin una identidad distinta, SwiftUI conserva el offset
                // vertical del día anterior: al pasar de una agenda larga a
                // otra corta, el contenido entrante puede quedar por encima
                // del viewport y la pantalla aparece vacía.
                .id(viewModel.dateKey)
                .refreshable {
                    await viewModel.refreshDay(force: true)
                    Haptics.play(.success)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .offset(x: contentOffset)
        .clipped()
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { width in
            contentWidth = width
        }
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
                    // Último día de temporada: el gesto hacia delante no navega.
                    if h < 0, !viewModel.canGoToNextDay { return }
                    Haptics.play(.navigation)
                    if h < 0 {
                        animateNavigation(forward: true) { await viewModel.goToNextDay() }
                    } else {
                        animateNavigation(forward: false) { await viewModel.goToPreviousDay() }
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
                    .ccFont(.s14, weight: .medium)
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
                        animateNavigation(forward: true) { await viewModel.navigate(to: nextDate) }
                    } label: {
                        HStack(spacing: 4) {
                            Text(LocaleService.t("Ir al próximo día con carreras", "Go to next day with races"))
                            Image(systemName: "arrow.right")
                        }
                        .ccFont(.s14, weight: .medium)
                    }
                    .accessibilityHint(LocaleService.t("Navega al siguiente día que tenga carreras programadas", "Navigate to the next day with scheduled races"))
                    .accessibilityInputLabels([LocaleService.t("Próximo día con carreras", "Next day with races"), LocaleService.t("Siguiente día", "Next day"), LocaleService.t("Próximo día", "Next day")])
                }
            }
            .frame(maxWidth: .infinity, minHeight: 320)
        } else {
            let columns = AdaptiveLayoutPolicy.feedColumns(
                width: max(0, contentWidth - 32),
                isRegular: horizontalSizeClass == .regular
            )
            // Las destacadas solo cambian el orden: misma tarjeta y misma
            // columna que el resto. Una tarjeta suelta conserva media anchura.
            let rows = AdaptiveLayoutPolicy.rows(viewModel.displayItems, columns: columns)
            LazyVStack(spacing: 8) {
                ForEach(rows) { row in
                    if row.spansAllColumns || columns == 1 {
                        raceItemView(item: row.items[0])
                            .frame(maxWidth: .infinity, alignment: .top)
                    } else {
                        HStack(alignment: .top, spacing: 8) {
                            ForEach(row.items) { item in
                                raceItemView(item: item)
                                    .frame(maxWidth: .infinity, alignment: .top)
                            }
                            if row.items.count < columns {
                                Color.clear.frame(maxWidth: .infinity)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal)
            .padding(.top, 8)
            .padding(.bottom, 8)
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
            canPin: !champWeekLock && filter != .all,
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
    private func raceItemView(item: EnrichedRaceDay) -> some View {
        // In-house: si la jornada tiene clasificación propia, el acceso va a la
        // pantalla nativa. Presencia en el mapa = la tiene.
        let hasInhouse = inhouseByDay.index(forKey: item.id) != nil
        let inhouseStage = inhouseByDay[item.id].flatMap { $0 }
        // Revive/TV forma parte del estado de resultados: nunca aparece por el
        // mero hecho de alcanzar la hora de meta sin clasificaciones visibles.
        let reviveURL = hasInhouse ? RaceLogic.reviveUrl(from: item.broadcasts) : nil
        let raceState = RaceLogic.todayRaceState(
            rd: item.raceDay,
            hasInhouseResults: hasInhouse,
            now: statusNow
        )
        let isWaiting = raceState == .waiting
        let showsFinishTime = viewModel.sortMode == .finishTime || raceState == .running
        let isFinalStage = item.race?.isStageRace == true
            && !item.raceDay.isRestDay
            && !item.raceDay.isCancelledDay
            && item.raceDay.dateKey == item.race?.endDate
        // Identidad estable: actualizar datos sin recrear la tarjeta ni su posición.
        let viewId: String = item.id

        if item.isPlaceholder {
            Button {
                Haptics.play(.navigation)
                if let race = item.race {
                    placeholderItem = PlaceholderModalItem(race: race, raceDay: item.raceDay)
                }
            } label: {
                RaceCardView(
                    item: item,
                    refreshToken: viewModel.refreshToken,
                    activeFilter: viewModel.activeFilter,
                    isFinalStage: isFinalStage,
                    showsFinishTimeOnly: showsFinishTime,
                    isWaitingForResults: isWaiting
                )
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
            RaceCardView(
                item: item,
                refreshToken: viewModel.refreshToken,
                activeFilter: viewModel.activeFilter,
                isFinalStage: isFinalStage,
                showsFinishTimeOnly: showsFinishTime,
                isWaitingForResults: isWaiting
            )
                .accessibilityIdentifier(AccessibilityID.raceCard(item.id))
                .id(viewId)
        } else {
            NavigationLink(value: item) {
                RaceCardView(
                    item: item,
                    refreshToken: viewModel.refreshToken,
                    activeFilter: viewModel.activeFilter,
                    onShowResults: hasInhouse ? {
                        Haptics.play(.primaryAction)
                        guard let race = item.race else { return }
                        resultsRoute = ResultsRoute(raceId: race.id, stageNumber: inhouseStage, stageSuffix: item.raceDay.stageSuffix)
                    } : nil,
                    onRevive: reviveURL != nil ? {
                        Haptics.play(.primaryAction)
                        if let url = reviveURL {
                            NativeAppLinkOpener.openIfInstalled(url) { safariURL = url }
                        }
                    } : nil,
                    onShowStartlist: item.race?.startlistImportedAt != nil ? {
                        if let race = item.race {
                            startlistRouteRaceId = IdentifiableID(id: race.id)
                        }
                    } : nil,
                    onStartOrderTap: {
                        startOrderRouteRaceDayId = IdentifiableID(id: item.raceDay.id)
                    },
                    onShowCompetition: item.race?.isStageRace == true && item.race?.startDate != item.race?.endDate ? {
                        guard let raceId = item.race?.id else { return }
                        if let path = navigationPath {
                            path.wrappedValue.append(DeepLinkDestination.race(raceId))
                        } else {
                            competitionRaceId = IdentifiableID(id: raceId)
                        }
                    } : nil,
                    isFinalStage: isFinalStage,
                    showsFinishTimeOnly: showsFinishTime,
                    isWaitingForResults: isWaiting
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

    /// Transición animada de cambio de día, espejo de la de Ciclocross:
    /// desliza el contenido fuera, espera a que la navegación tenga el día
    /// listo (caché) y desliza el entrante ya con datos.
    private func animateNavigation(forward: Bool, action: @escaping () async -> Void) {
        guard !isAnimatingNavigation else { return }
        if reduceMotion {
            Task { await action() }
            return
        }
        isAnimatingNavigation = true
        let width = max(contentWidth, 1)
        let outDir: CGFloat = forward ? -1 : 1
        withAnimation(.easeOut(duration: 0.15)) {
            contentOffset = outDir * width
        }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            await action()
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
    /// Fijado permitido (fuera de la semana de Campeonatos y no en «Todas»).
    let canPin: Bool
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

    /// Botón nativo de filtro. El filtro activo, pulsado de nuevo, abre el
    /// diálogo de predeterminado; el menú contextual (pulsación larga) ofrece
    /// la misma acción.
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 4) {
                Text(filter.label)
                    .ccFont(.s13, weight: isActive ? .bold : .medium)
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
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            // Activo en azul de marca suave (15 %) + texto azul (selección);
            // inactivo sobre la superficie de tarjeta con texto secundario.
            .background(isActive ? Color.accentColor.opacity(0.15) : AppTheme.cardBackground)
            .foregroundStyle(isActive ? Color.accentColor : Color(.secondaryLabel))
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if canPin {
                Button {
                    onLongPress()
                } label: {
                    Label(
                        pinDisplay == .filled
                            ? LocaleService.t("Quitar filtro por defecto", "Remove default filter")
                            : LocaleService.t("Fijar como filtro por defecto", "Set as default filter"),
                        systemImage: pinDisplay == .filled ? "pin.slash" : "pin"
                    )
                }
            }
        }
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
        .accessibilityLabel(pinDisplay == .filled
            ? "\(LocaleService.t("Filtro", "Filter")) \(filter.label), \(LocaleService.t("fijado como predeterminado", "set as default"))"
            : "\(LocaleService.t("Filtro", "Filter")) \(filter.label)")
        .accessibilityHint(isActive
            ? LocaleService.t("Filtro activo. Pulsa dos veces para establecerlo como filtro por defecto.", "Active filter. Double tap to set it as default filter.")
            : LocaleService.t("Pulsa dos veces para filtrar por \(filter.label).", "Double tap to filter by \(filter.label)."))
        .accessibilityIdentifier(AccessibilityID.filterButton(filter.rawValue))
    }
}
