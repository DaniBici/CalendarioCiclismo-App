import SwiftUI

private enum UciRankingGender: String {
    case male
    case female
}

private struct UciRankingExplanationItem: Identifiable {
    let id: String
    let title: String
    let message: String
}

/// Pestaña "Resultados" — feed "Últimos resultados" (apps 3.1, fase F3).
/// Réplica nativa de `js/resultados-feed.js` (`renderResultsFeed`): cronología
/// inversa agrupada por día, ventana de 14 días + "Cargar más" hasta el
/// arranque de temporada. Espejo de `ResultsFeedScreen` (Android).
///
/// Filas con la superficie neutra de las cards de Hoy (`CCCard`, sin tinte del
/// color de carrera), logo + bandera, "Etapa N · km · desnivel"
/// + badge de tipo solo para contrarrelojes, y el ganador con trofeo. Cada fila
/// abre su clasificación propia mediante `ResultsRoute`.
///
/// Pestañas según `ResultsFeedTabs`: durante la temporada de ciclocross se
/// añade la de resultados CX (`CxResultsFeedModel`), con filas que abren la
/// ficha CX en sus resultados.
/// Destino de una fila del feed en la columna de detalle de
/// `ResultsSplitView`.
enum ResultsFeedSelection: Hashable {
    case road(ResultsRoute)
    case cx(CxDestination)
}

/// Estado de la pestaña Resultados: secciones, feed de carretera, ciclocross
/// y ránking UCI. `ResultsSplitView` lo conserva al pasar de la lista y
/// detalle al ránking a todo el ancho, que recrea `ResultsFeedView`: los
/// datos no se vuelven a pedir con pantalla de carga ni se pierde la sección.
@MainActor @Observable
final class ResultsFeedStore {
    var tabLayout: ResultsFeedTabLayout
    var activeSection: ResultsFeedTab
    var entries: [FeedEntry] = []
    var isLoading = true
    var error: String?
    /// Inicio de la ventana cargada (se amplía con "Cargar más").
    var fromKey = ResultsFeedLogic.initialFromKey()
    /// La ventana inicial ya cuenta desde el último día con resultados.
    private var windowAnchored = false
    var isLoadingMore = false
    /// Identifica la última carga del feed (completa o «Cargar más»). Una
    /// respuesta de una carga anterior se descarta: no puede sustituir la
    /// lista ni el inicio de la ventana de otra más reciente.
    private var feedGeneration = 0
    let cxModel: CxResultsFeedModel
    fileprivate var rankingGender = UciRankingGender.male
    var rankingRows: [UciTeamRankingRow] = []
    var isRankingLoading = false
    var rankingError: String?
    /// Marco del selector de sección en la columna lateral, en coordenadas
    /// globales: el ránking a todo el ancho lo dibuja en el mismo sitio y con
    /// el mismo ancho.
    var sidebarSelectorFrame: CGRect?
    /// Esquina superior izquierda del contenido a todo el ancho (bajo la barra
    /// de navegación), en coordenadas globales; se mide al entrar en el
    /// ránking.
    var fullWidthContentOrigin: CGPoint?
    /// El cambio de contenedor recrea la vista: su `onAppear` no es una
    /// visita nueva a la pantalla.
    var skipsNextAppearanceLog = false

    init() {
        let layout = ResultsFeedTabs.layout()
        tabLayout = layout
        activeSection = layout.initial
        cxModel = CxResultsFeedModel()
    }

    func load() async {
        feedGeneration &+= 1
        let generation = feedGeneration
        if entries.isEmpty { isLoading = true }
        error = nil
        do {
            let todayKey = DateFormatting.todayKey()
            // Primera carga: 14 días contados desde el último día con
            // resultados, no desde hoy. Si la consulta falla, la ventana
            // cuenta desde hoy y la siguiente carga vuelve a intentarlo.
            if !windowAnchored {
                let last: String?
                do {
                    last = try await SupabaseService.shared.latestResultsFeedDate(onOrBefore: todayKey)
                    windowAnchored = true
                } catch is CancellationError {
                    return
                } catch {
                    last = nil
                }
                guard generation == feedGeneration else { return }
                // Nunca acorta la ventana: el ancla es como mucho hoy.
                if let last { fromKey = min(fromKey, ResultsFeedLogic.initialFromKey(anchorKey: min(last, todayKey))) }
            }
            let loadedEntries = try await SupabaseService.shared.loadResultsFeed(
                from: fromKey,
                to: todayKey
            )
            try Task.checkCancellation()
            guard generation == feedGeneration else { return }
            // Commit único: nunca se expone una lista previa a la resolución de
            // ganadores y líderes.
            entries = loadedEntries
            isLoading = false
        } catch is CancellationError {
            // Navegar fuera cancela .task; se conserva el último modelo completo.
            return
        } catch {
            guard generation == feedGeneration else { return }
            self.error = error.localizedDescription
            isLoading = false
        }
    }

    /// Amplía la ventana 14 días más (tope: arranque de temporada). Solo se
    /// descarga el tramo nuevo: las entradas se ordenan primero por fecha y
    /// el tramo es anterior a todo lo cargado, así que se añade al final.
    func loadMore() async {
        guard !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let previousFrom = fromKey
        let newFrom = ResultsFeedLogic.extendedFromKey(previousFrom)
        guard newFrom < previousFrom else { return }
        feedGeneration &+= 1
        let generation = feedGeneration
        fromKey = newFrom
        do {
            let older = try await SupabaseService.shared.loadResultsFeed(
                from: newFrom,
                to: ResultsFeedLogic.addDays(previousFrom, -1)
            )
            try Task.checkCancellation()
            // Una carga completa posterior ya cubre la ventana ampliada.
            guard generation == feedGeneration else { return }
            let loadedKeys = Set(entries.map(\.key))
            entries += older.filter { !loadedKeys.contains($0.key) }
        } catch {
            guard generation == feedGeneration else { return }
            // El tramo no se cargó: se restaura el inicio de la ventana para
            // que «Cargar más» vuelva a pedirlo.
            fromKey = previousFrom
            if !(error is CancellationError) { self.error = error.localizedDescription }
        }
    }

    func loadRanking() async {
        if rankingRows.isEmpty { isRankingLoading = true }
        rankingError = nil
        do {
            rankingRows = try await SupabaseService.shared.loadUciTeamRankings()
        } catch {
            if rankingRows.isEmpty {
                rankingError = LocaleService.t(
                    "No se pudo cargar el ránking UCI.",
                    "The UCI ranking could not be loaded."
                )
            }
        }
        isRankingLoading = false
    }
}

/// Resultados en iPad (ancho regular): el feed en la columna lateral y la
/// clasificación o la ficha CX en el detalle. El ránking UCI no abre ningún
/// detalle: ocupa todo el ancho, fuera de la lista y detalle, con el
/// selector de sección en el mismo sitio que en la columna lateral. En
/// ancho compacto la pestaña usa `ResultsFeedView` en una pila, como en el
/// iPhone.
struct ResultsSplitView: View {
    @State private var store = ResultsFeedStore()
    @State private var selection: ResultsFeedSelection?
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    var body: some View {
        Group {
            if store.activeSection == .ranking {
                NavigationStack {
                    ResultsFeedView(store: store, placement: .fullWidth)
                }
            } else {
                splitView
            }
        }
    }

    private var splitView: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            ResultsFeedView(store: store, placement: .sidebar, onSelect: { selection = $0 })
                .navigationSplitViewColumnWidth(min: 320, ideal: 360, max: 420)
        } detail: {
            NavigationStack {
                Group {
                    switch selection {
                    case .road(let route):
                        ResultsView(raceId: route.raceId, initialStageNumber: route.stageNumber, initialStageSuffix: route.stageSuffix)
                    case .cx(let destination):
                        CxRaceDetailView(raceId: destination.raceId, anchor: destination.anchor)
                    case nil:
                        ContentUnavailableView(
                            LocaleService.t("Elige un resultado", "Choose a result"),
                            systemImage: "trophy",
                            description: Text(LocaleService.t(
                                "La clasificación se abre aquí.",
                                "The classification opens here."
                            ))
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(AppTheme.background.ignoresSafeArea())
                    }
                }
                .navigationDestination(for: CxDestination.self) { destination in
                    CxRaceDetailView(raceId: destination.raceId, anchor: destination.anchor)
                }
                .navigationDestination(for: CxTournamentDestination.self) { destination in
                    CyclocrossView(tournament: destination.tournament, season: destination.season)
                }
            }
            // Cada selección parte de una pila nueva.
            .id(selection)
        }
        .navigationSplitViewStyle(.balanced)
    }
}

struct ResultsFeedView: View {
    /// Contenedor de la vista.
    enum Placement {
        /// Pila del iPhone y de las ventanas compactas.
        case stack
        /// Columna lateral de `ResultsSplitView`.
        case sidebar
        /// Ránking UCI a todo el ancho en `ResultsSplitView`.
        case fullWidth
    }

    let placement: Placement
    /// En `ResultsSplitView`, la fila abre su destino en la columna de
    /// detalle en lugar de empujarlo en la pila.
    var onSelect: ((ResultsFeedSelection) -> Void)? = nil
    @State private var store: ResultsFeedStore
    /// Push por valor a la pantalla de resultados in-house.
    @State private var resultsRoute: ResultsRoute?
    /// Push por valor a la ficha CX, en su sección de resultados.
    @State private var cxRoute: CxDestination?
    @State private var rankingExplanation: UciRankingExplanationItem?
    @State private var localeService = LocaleService.shared
    @State private var contentWidth: CGFloat = 0
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.scenePhase) private var scenePhase
    /// La pantalla está en primer plano de la pila (no cubierta por otra
    /// pestaña ni por un push): solo entonces el regreso de la app recarga.
    @State private var isVisible = false

    /// Sin `store`, la vista tiene el suyo (pila del iPhone).
    init(
        store: ResultsFeedStore? = nil,
        placement: Placement = .stack,
        onSelect: ((ResultsFeedSelection) -> Void)? = nil
    ) {
        _store = State(initialValue: store ?? ResultsFeedStore())
        self.placement = placement
        self.onSelect = onSelect
    }

    private var activeSection: ResultsFeedTab { store.activeSection }
    private var tabLayout: ResultsFeedTabLayout { store.tabLayout }
    private var cxModel: CxResultsFeedModel { store.cxModel }
    private var entries: [FeedEntry] { store.entries }

    var body: some View {
        VStack(spacing: 0) {
            sectionSelector
            Group {
                switch activeSection {
                case .cyclocross:
                    if let error = cxModel.error, !cxModel.hasLoaded {
                        ErrorView(message: error) {
                            Task { await cxModel.load() }
                        }
                    } else if !cxModel.hasLoaded {
                        LoadingView(branded: true, title: localeService.t("Ciclocross", "Cyclocross"))
                    } else {
                        cxList
                    }
                case .road:
                    if store.isLoading && entries.isEmpty {
                        LoadingView(branded: true, title: localeService.t("Últimos resultados", "Latest results"))
                    } else if let error = store.error, entries.isEmpty {
                        ErrorView(message: error) {
                            Task { await store.load() }
                        }
                    } else {
                        feedList
                    }
                case .ranking:
                    if store.isRankingLoading && store.rankingRows.isEmpty {
                        LoadingView(branded: true, title: localeService.t("Ránking UCI", "UCI ranking"))
                    } else if let rankingError = store.rankingError, store.rankingRows.isEmpty {
                        ErrorView(message: rankingError) {
                            Task { await store.loadRanking() }
                        }
                    } else {
                        rankingList
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // A todo el ancho, origen del contenido bajo la barra.
        .onGeometryChange(for: CGPoint?.self) { proxy in
            placement == .fullWidth ? proxy.frame(in: .global).origin : nil
        } action: { origin in
            if let origin { store.fullWidthContentOrigin = origin }
        }
        .background(AppTheme.background.ignoresSafeArea())
        // «Ránking» con el ránking UCI, que no es un resultado.
        .navigationTitle(activeSection == .ranking
            ? localeService.t("Ránking", "Ranking")
            : localeService.t("Resultados", "Results"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if #available(iOS 26, *) {
                ToolbarItem(placement: .topBarLeading) {
                    CCHeaderMarkView()
                }
                .sharedBackgroundVisibility(.hidden)
            } else {
                ToolbarItem(placement: .topBarLeading) {
                    CCHeaderMarkView()
                }
            }
        }
        // Push por valor a la pantalla de resultados in-house (data-driven,
        // como en Hoy — NUNCA por destino, corrompe el NavigationStack).
        .navigationDestination(item: $resultsRoute) { route in
            ResultsView(raceId: route.raceId, initialStageNumber: route.stageNumber, initialStageSuffix: route.stageSuffix)
        }
        .navigationDestination(item: $cxRoute) { destination in
            CxRaceDetailView(raceId: destination.raceId, anchor: destination.anchor)
        }
        // Enlaces por valor de la ficha CX (rondas de la general, torneo).
        .navigationDestination(for: CxDestination.self) { destination in
            CxRaceDetailView(raceId: destination.raceId, anchor: destination.anchor)
        }
        .navigationDestination(for: CxTournamentDestination.self) { destination in
            CyclocrossView(tournament: destination.tournament, season: destination.season)
        }
        .alert(item: $rankingExplanation) { item in
            Alert(
                title: Text(item.title),
                message: Text(item.message),
                dismissButton: .default(Text(localeService.t("Cerrar", "Close")))
            )
        }
        .task { await store.load() }
        // Pestaña Ciclocross: la primera vez se carga; cada vez que vuelve a
        // aparecer (otra pestaña de la app, regreso de una ficha) o se
        // selecciona se recarga sin pantalla de carga, como el feed de
        // carretera con `.task { load() }`.
        .task(id: activeSection == .cyclocross) {
            guard activeSection == .cyclocross else { return }
            if cxModel.hasLoaded {
                await cxModel.refresh(forceRounds: false)
            } else {
                await cxModel.load()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            let layout = ResultsFeedTabs.layout()
            if layout != tabLayout {
                store.tabLayout = layout
                if !layout.tabs.contains(activeSection) { store.activeSection = layout.initial }
            }
            // Regreso a primer plano con esta pantalla visible: la sección
            // activa se actualiza, también en ciclocross.
            guard isVisible else { return }
            Task { await refreshActiveSection() }
        }
        // Latido de 60 s con la pestaña Ciclocross a la vista: solo descarga
        // los meses de la ventana mostrada, como el sondeo de 60 s de la web.
        .task(id: cxHeartbeatActive) {
            guard cxHeartbeatActive else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                if cxModel.hasLoaded { await cxModel.refresh(forceRounds: false, windowOnly: true) }
            }
        }
        .onAppear {
            isVisible = true
            if store.skipsNextAppearanceLog {
                store.skipsNextAppearanceLog = false
                return
            }
            AnalyticsService.shared.logScreenView("results_feed")
            // Pestaña inicial en Ciclocross (modo ciclocross): mismo nombre
            // que Android.
            if activeSection == .cyclocross {
                AnalyticsService.shared.logScreenView("results_feed_cx")
            }
        }
        .onDisappear { isVisible = false }
    }

    /// Ciclocross seleccionado, pantalla visible y app en primer plano.
    private var cxHeartbeatActive: Bool {
        activeSection == .cyclocross && isVisible && scenePhase == .active
    }

    private func tabLabel(_ tab: ResultsFeedTab) -> String {
        switch tab {
        case .cyclocross:
            return localeService.t("Ciclocross", "Cyclocross")
        case .road:
            return tabLayout.includesCyclocross
                ? localeService.t("Carretera", "Road")
                : localeService.t("Últimos resultados", "Latest results")
        case .ranking:
            return tabLayout.includesCyclocross
                ? localeService.t("Ránking UCI", "UCI Ranking")
                : localeService.t("Ránking UCI", "UCI ranking")
        }
    }

    /// Selector de vista: control segmentado nativo, como el de Fichajes. El
    /// título de la pantalla es el de navegación («Resultados», o «Ránking»
    /// con el ránking UCI). En la
    /// columna lateral del iPad se mide su marco, y el ránking a todo el
    /// ancho lo dibuja con ese marco: el selector no se mueve al entrar en
    /// el ránking ni al salir de él.
    @ViewBuilder private var sectionSelector: some View {
        let picker = Picker(
            localeService.t("Vista de resultados", "Results view"),
            selection: Binding(
                get: { activeSection },
                set: { selectSection($0) }
            )
        ) {
            ForEach(tabLayout.tabs) { tab in
                Text(tabLabel(tab)).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        switch placement {
        case .stack:
            picker
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
        case .sidebar:
            picker
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
                    store.sidebarSelectorFrame = $0
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
        case .fullWidth:
            let inset = fullWidthSelectorInset
            picker
                .frame(width: store.sidebarSelectorFrame?.width ?? Self.sidebarSelectorFallbackWidth)
                .padding(.leading, inset.leading)
                .padding(.top, inset.top)
                .padding(.bottom, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Ancho del selector en la columna lateral de anchura ideal (360 pt),
    /// si aún no se ha medido.
    private static let sidebarSelectorFallbackWidth: CGFloat = 328

    /// Margen del selector a todo el ancho que lo deja en el marco medido en
    /// la columna lateral, a partir del origen del contenido a todo el ancho.
    /// Antes de medirlo, el contenido empieza en el borde de la ventana y
    /// bajo una barra de la misma altura que la de la columna lateral.
    private var fullWidthSelectorInset: (leading: CGFloat, top: CGFloat) {
        guard let frame = store.sidebarSelectorFrame else { return (16, 8) }
        let origin = store.fullWidthContentOrigin ?? CGPoint(x: 0, y: frame.minY - 8)
        return (max(0, frame.minX - origin.x), max(0, frame.minY - origin.y))
    }

    /// Margen lateral del ránking: a todo el ancho, el del selector, para que
    /// el género, el panel y la tabla arranquen bajo él.
    private var rankingHorizontalInset: CGFloat {
        placement == .fullWidth ? fullWidthSelectorInset.leading : 16
    }

    private func selectSection(_ section: ResultsFeedTab) {
        guard section != activeSection else { return }
        Haptics.play(.selection)
        // En el iPad, entrar en el ránking o salir de él cambia de
        // contenedor y recrea la vista.
        if placement != .stack, section == .ranking || activeSection == .ranking {
            store.skipsNextAppearanceLog = true
        }
        store.activeSection = section
        if section == .cyclocross {
            AnalyticsService.shared.logScreenView("results_feed_cx")
        }
        if section == .ranking {
            AnalyticsService.shared.logScreenView("uci_team_ranking")
            if store.rankingRows.isEmpty {
                // Carga a la vista desde el primer fotograma, sin pasar por
                // «Ránking no disponible».
                store.isRankingLoading = true
                Task { await store.loadRanking() }
            }
        }
    }

    // MARK: - Lista

    /// Grupo de entradas de un mismo día (cabecera + filas).
    private struct FeedDayGroup: Identifiable {
        let date: String
        var entries: [FeedEntry]
        var id: String { date }
    }

    /// Entradas agrupadas por día (vienen ya ordenadas en cronología inversa).
    private var groupedByDay: [FeedDayGroup] {
        var out: [FeedDayGroup] = []
        for e in entries {
            if out.last?.date == e.date {
                out[out.count - 1].entries.append(e)
            } else {
                out.append(FeedDayGroup(date: e.date, entries: [e]))
            }
        }
        return out
    }

    private var feedList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                let columns = AdaptiveLayoutPolicy.feedColumns(
                    width: max(0, contentWidth - 32),
                    isRegular: horizontalSizeClass == .regular
                )
                if entries.isEmpty {
                    EmptyStateView(
                        icon: "trophy",
                        title: localeService.t("Sin resultados", "No results"),
                        subtitle: localeService.t("No hay resultados en este periodo.", "No results in this period.")
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, minHeight: 320)
                } else {
                    let groups = groupedByDay
                    ForEach(groups) { group in
                        // Cabecera de día: fecha larga en idioma de CONTENIDO.
                        Text(DateFormatting.formatDateLongContent(group.date))
                            .ccFont(.s13, weight: .semibold)
                            .foregroundStyle(.secondary)
                            .padding(.top, group.id == groups.first?.id ? 0 : 10)
                            .accessibilityAddTraits(.isHeader)
                        // Ninguna fila ocupa las dos columnas, como la web
                        // (`.feed-day>.feed-row { grid-column: auto }`).
                        let rows = AdaptiveLayoutPolicy.rows(group.entries, columns: columns)
                        ForEach(rows) { row in
                            if columns == 1 || row.spansAllColumns {
                                feedRow(row.items[0])
                            } else {
                                // Misma altura para las tarjetas de la fila: la
                                // fila toma el alto de la más alta.
                                HStack(alignment: .top, spacing: 8) {
                                    ForEach(row.items) { entry in
                                        feedRow(entry)
                                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                                    }
                                    if row.items.count < columns {
                                        Color.clear.frame(maxWidth: .infinity)
                                    }
                                }
                                .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                if store.fromKey > ResultsFeedLogic.seasonStart {
                    loadMoreButton
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .onGeometryChange(for: CGFloat.self) { geometry in
            geometry.size.width
        } action: { width in
            contentWidth = width
        }
        .refreshable { await store.load() }
    }

    private func feedRow(_ entry: FeedEntry) -> some View {
        FeedRowView(entry: entry) {
            Haptics.play(.navigation)
            let route = ResultsRoute(
                raceId: entry.race.id,
                stageNumber: entry.stageNumber,
                stageSuffix: entry.stageSuffix.isEmpty ? nil : entry.stageSuffix
            )
            if let onSelect { onSelect(.road(route)) } else { resultsRoute = route }
        }
    }

    // MARK: - Ciclocross

    private var cxList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                let columns = AdaptiveLayoutPolicy.feedColumns(
                    width: max(0, contentWidth - 32),
                    isRegular: horizontalSizeClass == .regular
                )
                let days = cxModel.visibleDays
                if days.isEmpty {
                    EmptyStateView(
                        icon: "trophy",
                        title: localeService.t("Sin resultados", "No results"),
                        subtitle: cxModel.days.isEmpty
                            ? localeService.t("No hay resultados de ciclocross en esta temporada", "No cyclocross results this season")
                            : localeService.t("No hay resultados de ciclocross en este periodo", "No cyclocross results in this period")
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, minHeight: 320)
                } else {
                    ForEach(days) { day in
                        Text(DateFormatting.formatDateLongContent(day.date))
                            .ccFont(.s13, weight: .semibold)
                            .foregroundStyle(.secondary)
                            .padding(.top, day.id == days.first?.id ? 0 : 10)
                            .accessibilityAddTraits(.isHeader)
                        // Tarjetas de altura propia: en dos columnas, cada
                        // una pasa a la columna más corta, sin huecos.
                        CxMasonryLayout(columns: columns, spacing: 8) {
                            ForEach(day.entries) { entry in
                                cxRow(entry)
                            }
                        }
                    }
                }
                // Como en carretera: 14 días de inicio y la opción de ampliar.
                if cxModel.canLoadMore {
                    HStack {
                        Spacer()
                        Button {
                            Haptics.play(.primaryAction)
                            cxModel.loadMore()
                        } label: {
                            Text(localeService.t("Cargar más resultados", "Load more results"))
                                .ccFont(.s14, weight: .semibold)
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
                        Spacer()
                    }
                    .padding(.vertical, 12)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .onGeometryChange(for: CGFloat.self) { geometry in
            geometry.size.width
        } action: { width in
            contentWidth = width
        }
        .refreshable { await cxModel.refresh() }
    }

    private func cxRow(_ entry: CxResultsFeedEntry) -> some View {
        CxFeedRowView(entry: entry, round: cxModel.rounds[entry.race.id]) {
            Haptics.play(.navigation)
            let destination = CxDestination(raceId: entry.race.id, anchor: entry.resultsAnchor)
            if let onSelect { onSelect(.cx(destination)) } else { cxRoute = destination }
        }
    }

    // MARK: - Ránking UCI

    private var decoratedRanking: [UciTeamRankingPresentation] {
        UciTeamRankingLogic.decorate(store.rankingRows, gender: store.rankingGender.rawValue)
    }

    /// Ránking UCI por equipos con la presentación de las clasificaciones:
    /// género y fecha de actualización en una fila, panel «Invitaciones» y
    /// tabla. En pantallas anchas el panel va a la izquierda.
    private var rankingList: some View {
        let ranking = decoratedRanking
        let isEnglish = LocaleService.shouldShowEnglishContent
        let keyItems = UciTeamRankingLogic.keyItems(ranking, isEnglish: isEnglish)
        let wide = AdaptiveLayoutPolicy.usesWideDetail(
            width: contentWidth,
            isRegular: horizontalSizeClass == .regular
        )
        return VStack(spacing: 0) {
            HStack(spacing: 12) {
                Picker(localeService.t("Género del ránking", "Ranking gender"), selection: $store.rankingGender) {
                    Text(localeService.t("Masculino", "Men")).tag(UciRankingGender.male)
                    Text(localeService.t("Femenino", "Women")).tag(UciRankingGender.female)
                }
                .pickerStyle(.segmented)
                .fixedSize()
                .onChange(of: store.rankingGender) { _, _ in Haptics.play(.selection) }

                if let rankingDate = ranking.first?.row.rankingDate {
                    Text(DateFormatting.formatUciRankingUpdated(rankingDate))
                        .ccFont(.s12)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, rankingHorizontalInset)
            .padding(.bottom, 12)

            if ranking.isEmpty {
                EmptyStateView(
                    icon: "list.number",
                    title: localeService.t("Ránking no disponible", "Ranking unavailable"),
                    subtitle: localeService.t(
                        "La UCI todavía no ha publicado esta clasificación.",
                        "The UCI has not published this ranking yet."
                    )
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    Group {
                        if wide {
                            HStack(alignment: .top, spacing: 24) {
                                if !keyItems.isEmpty {
                                    UciRankingKeyPanel(
                                        year: UciTeamRankingLogic.invitationYear(ranking),
                                        items: keyItems
                                    )
                                    .frame(width: 288)
                                }
                                rankingTable(ranking, isEnglish: isEnglish)
                            }
                        } else {
                            VStack(spacing: 16) {
                                if !keyItems.isEmpty {
                                    UciRankingKeyPanel(
                                        year: UciTeamRankingLogic.invitationYear(ranking),
                                        items: keyItems
                                    )
                                }
                                rankingTable(ranking, isEnglish: isEnglish)
                            }
                        }
                    }
                    .padding(.horizontal, rankingHorizontalInset)
                    .padding(.bottom, 24)
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
                .refreshable { await store.loadRanking() }
            }
        }
    }

    private func rankingTable(_ ranking: [UciTeamRankingPresentation], isEnglish: Bool) -> some View {
        ResultsTableSurface {
            UciRankingTableHeader()
            ResultsTableRule()
            ForEach(Array(ranking.enumerated()), id: \.element.id) { index, item in
                UciRankingRowView(
                    item: item,
                    points: UciTeamRankingLogic.formatPoints(item.row.points, isEnglish: isEnglish)
                ) {
                    let message = item.explanation(isEnglish: isEnglish)
                    guard !message.isEmpty else { return }
                    Haptics.play(.selection)
                    rankingExplanation = UciRankingExplanationItem(
                        id: item.id,
                        title: item.row.displayName,
                        message: message
                    )
                }
                if index < ranking.count - 1 { ResultsTableRule() }
            }
        }
    }

    private var loadMoreButton: some View {
        HStack {
            Spacer()
            Button {
                Haptics.play(.primaryAction)
                Task { await store.loadMore() }
            } label: {
                if store.isLoadingMore {
                    ProgressView()
                } else {
                    Text(localeService.t("Cargar más resultados", "Load more results"))
                        .ccFont(.s14, weight: .semibold)
                }
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
            .disabled(store.isLoadingMore)
            Spacer()
        }
        .padding(.vertical, 12)
    }

    // MARK: - Carga

    /// Recarga la sección visible sin pantalla de carga.
    private func refreshActiveSection() async {
        switch activeSection {
        case .cyclocross:
            if cxModel.hasLoaded { await cxModel.refresh(forceRounds: false) }
        case .road:
            await store.load()
        case .ranking:
            break
        }
    }
}

// MARK: - Componentes del ránking UCI

/// Colores de la etiqueta de puesto y de la explicación (`.uci-ranking-legend__item`).
private extension UciRankingKeyStyle {
    var foreground: Color {
        switch self {
        case .worldTour: return Color(light: "0842a0", dark: "aac7ff")
        case .orange: return AppTheme.orange
        case .green: return AppTheme.green
        case .excluded: return AppTheme.red
        }
    }

    var background: Color {
        switch self {
        case .worldTour: return Color(light: "d3e3fd", dark: "383e4b")
        case .orange: return AppTheme.orange.opacity(0.16)
        case .green: return AppTheme.green.opacity(0.16)
        case .excluded: return AppTheme.red.opacity(0.14)
        }
    }
}

/// Etiqueta de color de un nivel (puesto y panel explicativo), radio 4.
private struct UciRankingTag: View {
    let text: String
    let style: UciRankingKeyStyle?

    var body: some View {
        Text(text)
            .ccFont(.s12, weight: .semibold)
            .monospacedDigit()
            .foregroundStyle(style?.foreground ?? Color.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                style?.background ?? Color.clear,
                in: RoundedRectangle(cornerRadius: AppTheme.Radius.control)
            )
    }
}

/// Panel «Invitaciones <año>»: cada etiqueta de puesto con su explicación.
private struct UciRankingKeyPanel: View {
    let year: Int
    let items: [UciRankingKeyItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LocaleService.shouldShowEnglishContent ? "Invitations \(year)" : "Invitaciones \(year)")
                .ccFont(.s16, weight: .semibold)
                .accessibilityAddTraits(.isHeader)
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 4) {
                    UciRankingTag(text: item.label, style: item.style)
                    Text(item.text)
                        .ccFont(.s13)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCardSurface()
    }
}

/// Columnas del ránking: puesto (caja común), bandera, equipo, categoría y puntos.
private enum UciRankingColumns {
    static let rank: CGFloat = 38
    static let flag: CGFloat = 20
    static let category: CGFloat = 40
    static let points: CGFloat = 64
}

private struct UciRankingTableHeader: View {
    var body: some View {
        HStack(spacing: ResultsTableMetrics.columnSpacing) {
            ResultsHeaderCell(text: "#").frame(width: UciRankingColumns.rank)
            Color.clear.frame(width: UciRankingColumns.flag, height: 1)
            ResultsHeaderCell(text: LocaleService.t("Equipo", "Team"))
                .frame(maxWidth: .infinity, alignment: .leading)
            ResultsHeaderCell(text: "Cat.").frame(width: UciRankingColumns.category)
            ResultsHeaderCell(text: LocaleService.t("Puntos", "Points"))
                .frame(width: UciRankingColumns.points, alignment: .trailing)
        }
        .padding(.horizontal, ResultsTableMetrics.horizontalPadding)
        .padding(.vertical, ResultsTableMetrics.headerVerticalPadding)
        .accessibilityHidden(true)
    }
}

private struct UciRankingRowView: View {
    let item: UciTeamRankingPresentation
    let points: String
    let onTap: () -> Void

    private var explanation: String {
        item.explanation(isEnglish: LocaleService.shouldShowEnglishContent)
    }

    var body: some View {
        if explanation.isEmpty {
            rowContent
                .accessibilityElement(children: .combine)
        } else {
            Button(action: onTap) { rowContent }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityHint(explanation)
        }
    }

    private var rowContent: some View {
            HStack(spacing: ResultsTableMetrics.columnSpacing) {
                // Todos los puestos comparten caja: las cifras quedan alineadas.
                UciRankingTag(text: "\(item.row.rank)", style: item.rankStyle)
                    .frame(minWidth: 30)
                    .frame(width: UciRankingColumns.rank)
                CountryFlag(countryCode: item.row.countryCode, width: 18)
                    .frame(width: UciRankingColumns.flag)
                Text(item.row.displayName)
                    .ccFont(.s14, weight: .medium)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(item.row.teamCategory ?? "")
                    .ccFont(.s12, weight: .semibold)
                    .foregroundStyle(.secondary)
                    .frame(width: UciRankingColumns.category)
                Text(points)
                    .ccFont(.s14, weight: .semibold)
                    .monospacedDigit()
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(width: UciRankingColumns.points, alignment: .trailing)
            }
            .padding(.horizontal, ResultsTableMetrics.horizontalPadding)
            .padding(.vertical, ResultsTableMetrics.rowVerticalPadding)
            .frame(minHeight: 35)
            .contentShape(Rectangle())
    }
}

// MARK: - Mampostería del feed CX

/// Columnas independientes: cada tarjeta, en orden de lectura, va a la
/// columna más corta (a igualdad, la de la izquierda). Las tarjetas conservan
/// su altura propia y las columnas no dejan huecos verticales.
private struct CxMasonryLayout: Layout {
    var columns: Int
    var spacing: CGFloat

    private func arrange(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], height: CGFloat) {
        let count = max(1, columns)
        let columnWidth = max(0, (width - spacing * CGFloat(count - 1)) / CGFloat(count))
        var heights = Array(repeating: CGFloat(0), count: count)
        var frames: [CGRect] = []
        for subview in subviews {
            let column = heights.indices.min { heights[$0] < heights[$1] } ?? 0
            let height = subview.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil)).height
            frames.append(CGRect(x: CGFloat(column) * (columnWidth + spacing), y: heights[column], width: columnWidth, height: height))
            heights[column] += height + spacing
        }
        let tallest = heights.max() ?? 0
        return (frames, subviews.isEmpty ? 0 : max(0, tallest - spacing))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.replacingUnspecifiedDimensions().width
        return CGSize(width: width, height: arrange(width: width, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = arrange(width: bounds.width, subviews: subviews).frames
        for (subview, frame) in zip(subviews, frames) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(width: frame.width, height: frame.height)
            )
        }
    }
}

// MARK: - Fila del feed CX

/// Fila de una prueba CX con la presentación de la fila destacada del feed
/// de carretera: logo y bandera, nombre, torneo · manga · sede y, bajo el
/// separador, una línea por categoría con su ganador o ganadora.
private struct CxFeedRowView: View {
    let entry: CxResultsFeedEntry
    /// Manga n/total del torneo, con la regla de la tarjeta de Hoy de
    /// Ciclocross: se omite con un total de una sola prueba.
    var round: CxRound? = nil
    let onTap: () -> Void

    private var race: CxRace { entry.race }

    private var subtitle: String {
        var parts: [String] = []
        if let tournament = race.tournament {
            parts.append(LocaleService.t(tournament.name, tournament.nameEn ?? tournament.name))
        }
        if let round, round.total > 1 {
            parts.append("\(round.n)/\(round.total)")
        }
        if let venue = race.venue?.trimmingCharacters(in: .whitespaces), !venue.isEmpty,
           venue != CyclocrossPresentation.name(race) {
            parts.append(venue)
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        Button {
            onTap()
        } label: {
            CCCard {
                ZStack(alignment: .trailing) {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(spacing: 3) {
                            RaceLogo(CyclocrossPresentation.logo(race), size: 36, placeholder: race.raceClass != "CN")
                            CountryFlag(countryCode: race.countryCode, width: 18)
                        }
                        // Columna del logo aunque no lo haya (Nacionales): el
                        // nombre arranca a la misma altura en todas las filas.
                        .frame(width: 36)

                        VStack(alignment: .leading, spacing: 3) {
                            // Una línea, con puntos suspensivos si no cabe.
                            Text(CyclocrossPresentation.name(race))
                                .ccFont(.s16, weight: .semibold)
                                .lineLimit(1)
                                .truncationMode(.tail)

                            if !subtitle.isEmpty {
                                Text(subtitle)
                                    .ccFont(.s13)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                            }

                            Divider().padding(.vertical, 2)
                            ForEach(entry.winners, id: \.category) { item in
                                HStack(spacing: 6) {
                                    Text(item.category)
                                        .ccFont(.s12, weight: .semibold)
                                        .foregroundStyle(.secondary)
                                        .frame(minWidth: 24, alignment: .leading)
                                    Text(item.winner).ccFont(.s12).lineLimit(1)
                                }
                            }
                        }

                        Spacer(minLength: 16)
                    }

                    RaceCardChevron()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(LocaleService.t(
            "Pulsa dos veces para ver los resultados",
            "Double tap to view results"
        ))
    }

    private var accessibilityText: String {
        var parts: [String] = [CyclocrossPresentation.name(race)]
        if !subtitle.isEmpty { parts.append(subtitle) }
        for item in entry.winners {
            parts.append("\(CyclocrossPresentation.category(item.category)): \(item.winner)")
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Fila del feed

/// Una fila del feed, con el lenguaje visual de las cards de Hoy.
private struct FeedRowView: View {
    let entry: FeedEntry
    let onTap: () -> Void

    private var race: Race { entry.race }
    private var rd: RaceDay? { entry.rd }

    /// Etiqueta de etapa: prólogo/Etapa N; pruebas de un día SIN etiqueta.
    private var stageLabelText: String {
        if let sn = entry.stageNumber {
            return sn == 0
                ? LocaleService.t("Prólogo", "Prologue")
                : "\(LocaleService.t("Etapa", "Stage")) \(sn)\(entry.stageSuffix)"
        }
        return ""
    }

    /// Línea 2: número de etapa, kilometraje y desnivel acumulado.
    /// (Las generales finales llevan solo su etiqueta; un día: sin etiqueta.)
    private var subtitleText: Text? {
        let separator = Text(" · ")
        var result: Text? = nil
        func append(_ part: Text) {
            result = result.map { $0 + separator + part } ?? part
        }
        if !stageLabelText.isEmpty {
            append(Text(stageLabelText).fontWeight(.semibold))
        }
        if let dist = rd?.distanceFormatted, !dist.isEmpty {
            append(Text(dist).fontWeight(.semibold))
        }
        if let elevation = rd?.elevationGainFormatted, !elevation.isEmpty {
            append(Text(elevation))
        }
        return result
    }

    var body: some View {
        Button {
            onTap()
        } label: {
            CCCard {
                ZStack(alignment: .trailing) {
                    HStack(alignment: entry.isFeatured ? .top : .center, spacing: 10) {
                        // Columna izquierda: logo de carrera con la bandera debajo.
                        VStack(spacing: 3) {
                            RaceLogo(race.logoUrl, size: 36, placeholder: race.uciCategory != "CN")
                            // Bandera de la ETAPA: el país propio de la jornada
                            // (rd.countryCode) prevalece sobre el de la carrera, y
                            // vence también al hideFlag cuando está fijado (espejo
                            // de Android y de la web — effectiveCountryCode).
                            if !race.hideFlag || rd?.countryCode != nil {
                                CountryFlag(countryCode: rd?.countryCode ?? race.countryCode, width: 18)
                            }
                        }
                        // Columna del logo aunque no lo haya (Nacionales): el
                        // nombre arranca a la misma altura en todas las filas.
                        .frame(width: 36)

                        VStack(alignment: .leading, spacing: 3) {
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                // Una línea, con puntos suspensivos si no cabe;
                                // el símbolo femenino queda visible.
                                Text(race.localizedName)
                                    .ccFont(.s16, weight: .semibold)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                if RaceLogic.shouldShowFemaleIndicator(race) {
                                    Text("♀")
                                        .ccFont(.s12)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            if entry.isGcFinal {
                                Text(LocaleService.t("General final", "Final GC"))
                                    .ccFont(.s13, weight: .semibold)
                                    .foregroundStyle(.secondary)
                            } else {
                                // HStack (no FlowLayout): el flow mide el texto a su
                                // ancho IDEAL y el lineLimit nunca truncaba — la línea
                                // "Etapa N · km · desnivel" rebosaba la card. Así
                                // el texto se comprime con puntos suspensivos y el
                                // badge conserva su tamaño.
                                HStack(spacing: 6) {
                                    if let subtitle = subtitleText {
                                        subtitle
                                            .ccFont(.s13)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                            .truncationMode(.tail)
                                    }
                                    // Badge de tipo solo para contrarrelojes.
                                    if let rd, rd.primaryType == "itt" || rd.primaryType == "ttt" {
                                        StageTypeBadge(
                                            primaryType: rd.primaryType,
                                            secondaryType: rd.primaryType == "itt" && ["chrono_climb", "summit_finish"].contains(rd.secondaryType ?? "") ? rd.secondaryType : nil,
                                            countryCode: rd.countryCode ?? race.countryCode,
                                            compact: true
                                        )
                                        .fixedSize()
                                        .layoutPriority(1)
                                    }
                                }
                            }

                            if entry.kind == .inhouse, !entry.winner.isEmpty {
                                HStack(spacing: 4) {
                                    Image(systemName: "trophy")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .accessibilityHidden(true)
                                    Text(entry.winner)
                                        .ccFont(.s13, weight: .semibold)
                                        .lineLimit(1)
                                }
                            }

                            if entry.isFeatured, !entry.complementary.isEmpty {
                                Divider().padding(.vertical, 2)
                                ForEach(entry.complementary) { item in
                                    HStack(spacing: 6) {
                                        if let hex = item.colorHex {
                                            // Contorno interior tenue, como `.feed-row__leader-dot`:
                                            // un maillot blanco o muy oscuro no desaparece sobre la tarjeta.
                                            Circle().fill(Color(hex: hex))
                                                .overlay(Circle().strokeBorder(Color.primary.opacity(0.3), lineWidth: 1))
                                                .frame(width: 7, height: 7)
                                        }
                                        Text(item.localizedLabel)
                                            .ccFont(.s12, weight: .semibold)
                                            .foregroundStyle(.secondary)
                                        if !item.winner.isEmpty {
                                            Text(item.winner).ccFont(.s12).lineLimit(1)
                                        }
                                    }
                                }
                            }
                        }

                        Spacer(minLength: 16)
                    }

                    RaceCardChevron()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                // En dos columnas, las tarjetas de una fila igualan su alto.
                .frame(maxHeight: .infinity)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(LocaleService.t(
            "Pulsa dos veces para ver las clasificaciones",
            "Double tap to view classifications"
        ))
        .accessibilityIdentifier(AccessibilityID.feedCard(entry.id))
    }

    private var accessibilityText: String {
        var parts: [String] = [race.localizedName]
        if entry.isGcFinal {
            parts.append(LocaleService.t("General final", "Final GC"))
        } else if !stageLabelText.isEmpty {
            parts.append(stageLabelText)
        }
        if !entry.winner.isEmpty {
            parts.append("\(LocaleService.t("Ganador", "Winner")): \(entry.winner)")
        }
        return parts.joined(separator: ", ")
    }
}
