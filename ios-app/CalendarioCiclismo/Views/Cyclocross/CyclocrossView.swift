import SwiftUI

struct CxDestination: Hashable {
    let raceId: String
    var anchor: String? = nil
}

/// Secciones de la página de torneo, con el selector de la ficha de carrera.
enum CxTournamentSection: String, CaseIterable, Identifiable {
    case calendar, general
    var id: String { rawValue }
    @MainActor var title: String {
        switch self {
        case .calendar: CyclocrossPresentation.t("Calendario", "Calendar")
        case .general: CyclocrossPresentation.t("Clasificación general", "Overall standings")
        }
    }
}

struct CyclocrossView: View {
    let tournament: CxTournament?
    let selectedSeason: String?
    @State private var model: CyclocrossAgendaModel
    init(tournament: CxTournament? = nil, season: String? = nil) {
        self.tournament = tournament
        self.selectedSeason = season
        _model = State(initialValue: CyclocrossAgendaModel(tournamentId: tournament?.id))
    }
    @State private var now = Date()
    @State private var locale = LocaleService.shared
    @State private var championshipsRoute: ChampionshipsRoute?
    @State private var highlightedStageDayId: IdentifiableID?
    @State private var highlightedRaceId: IdentifiableID?
    @State private var highlightedStartlistRaceId: IdentifiableID?
    @State private var highlightedStartOrderDayId: IdentifiableID?
    /// Los siete meses caben en el selector sin desplazamiento: sin flechas.
    @State private var monthsFit = false
    /// Carrera cuya card es placeholder: muestra el aviso de información.
    @State private var placeholderRace: CxRace?
    /// Filtro cuya chincheta se está alternando (alert de predeterminado).
    @State private var pendingDefaultFilter: CxAgendaFilter?
    /// Deslizamiento entre meses con la animación de Hoy en Carretera.
    @State private var contentOffset: CGFloat = 0
    @State private var contentWidth: CGFloat = 0
    @State private var isAnimatingNavigation = false
    /// Durante un swipe horizontal se desactivan las cards para que el
    /// touch-up no navegue a la vez que cambia el mes.
    @GestureState private var isHorizontalSwipe = false
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    /// Torneo formado solo por carreras ocultas en el idioma activo.
    @State private var tournamentHidden = false
    /// Generales publicadas del torneo: sin ellas la página no muestra
    /// secciones y queda en el calendario.
    @State private var standings: CxTournamentStandings?
    @State private var standingsMatcher = UciResultsLogic.TeamMatcher(teams: [])
    @State private var section = CxTournamentSection.calendar
    @State private var generalCategory = ""

    var body: some View {
        Group {
            if tournamentHidden {
                CxSpanishAudienceView()
            } else {
                agenda
            }
        }
        .task(id: tournament?.id) {
            guard let id = tournament?.id else { return }
            tournamentHidden = !(await CyclocrossRepository.shared.tournamentIsVisible(id))
        }
        .task(id: tournament?.id) { await loadStandings() }
    }

    private var standingsSeason: String { tournament?.seasonKey ?? selectedSeason ?? model.season }
    private var generalCategories: [String] {
        guard let standings else { return [] }
        return CyclocrossPresentation.tournamentGeneralCategories(standings: standings.standings, states: standings.states)
    }
    private var showsGeneral: Bool { section == .general && !generalCategories.isEmpty }

    /// Carga las generales; un fallo conserva lo ya publicado (o ninguna
    /// sección si aún no había).
    private func loadStandings() async {
        guard let id = tournament?.id else { return }
        guard let value = try? await CyclocrossRepository.shared.tournamentStandings(tournamentId: id, season: standingsSeason) else { return }
        standingsMatcher = UciResultsLogic.TeamMatcher(teams: value.teams.map(\.roadTeam))
        standings = value
        let codes = generalCategories
        if codes.isEmpty { section = .calendar }
        if !codes.contains(generalCategory) { generalCategory = codes.contains("ME") ? "ME" : codes.first ?? "" }
    }

    private var agenda: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                if tournament == nil { TodayHighlightsBanner(
                    scope: "cx",
                    onTapChampionships: { championshipsRoute = ChampionshipsRoute() },
                    onOpenTarget: openHighlightedTarget
                )
                    .padding(.top, 8).padding(.bottom, 10) }
                VStack(spacing: 8) {
                    // Página de torneo: estructura de las vueltas por etapas de
                    // carretera, sin el logo simplificado en la barra superior.
                    if let tournament {
                        VStack(alignment: .leading, spacing: 10) {
                            RaceCompetitionIdentity(name: CyclocrossPresentation.t(tournament.name, tournament.nameEn ?? tournament.name), logoUrl: tournament.logoUrl, countryCode: nil, hideFlag: true)
                            HStack(spacing: 8) {
                                if roundTotal > 1 {
                                    Text(CyclocrossPresentation.t("\(roundTotal) rondas", "\(roundTotal) rounds")).font(.caption).foregroundStyle(.secondary)
                                    Text("·").font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
                                }
                                Text(tournament.seasonKey ?? model.season).font(.caption).foregroundStyle(.secondary)
                                Spacer()
                            }
                        }
                        .padding().background(AppTheme.cardBackground)
                    }
                    if !generalCategories.isEmpty { tournamentSectionControls }
                    // La agenda general conserva el selector de meses; la página de
                    // torneo muestra todas sus pruebas juntas y prescinde de él.
                    if tournament == nil { monthControls }
                    if tournament == nil { filterBar }
                    if showsGeneral, let standings {
                        tournamentGeneral(standings)
                    } else {
                        if model.busy && !model.isRefreshing { ProgressView().accessibilityLabel(CyclocrossPresentation.t("Cargando ciclocross", "Loading cyclocross")) }
                        if let error = model.error {
                            VStack {
                                Text(error).foregroundStyle(.red)
                                Button(CyclocrossPresentation.t("Reintentar", "Retry")) { Task { await model.retry() } }.buttonStyle(.bordered)
                            }.padding(.horizontal)
                        }
                        // Torneo: pantalla de carga completa (sin perfil inferior,
                        // como las transiciones de Hoy) hasta la primera tanda.
                        if tournament != nil, model.busy, !model.isRefreshing, model.rows.isEmpty {
                            LoadingView(message: CyclocrossPresentation.t("Cargando ciclocross", "Loading cyclocross"), branded: true, showProfile: false)
                        } else {
                            agendaList(proxy: proxy)
                        }
                    }
                }
            }
        }
        .navigationDestination(item: $championshipsRoute) { _ in ChampionshipsView() }
        .navigationDestination(item: $highlightedStageDayId) { item in StageDetailView(raceDayId: item.id) }
        .navigationDestination(item: $highlightedRaceId) { item in RaceDetailView(raceId: item.id) }
        .navigationDestination(item: $highlightedStartlistRaceId) { item in StartlistView(raceId: item.id) }
        .navigationDestination(item: $highlightedStartOrderDayId) { item in StartOrderView(raceDayId: item.id) }
        .cxPlaceholderModal($placeholderRace)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(tournament.map { CyclocrossPresentation.t($0.name, $0.nameEn ?? $0.name) } ?? CyclocrossPresentation.t("Ciclocross", "Cyclocross"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar { toolbarItems }
        .alert(
            pendingDefaultFilter == model.pinnedFilter && model.pinnedFilter != .all
                ? CyclocrossPresentation.t("Quitar filtro por defecto", "Remove default filter")
                : CyclocrossPresentation.t("Filtro por defecto", "Default filter"),
            isPresented: Binding(get: { pendingDefaultFilter != nil }, set: { if !$0 { pendingDefaultFilter = nil } }),
            presenting: pendingDefaultFilter
        ) { filter in
            if filter == model.pinnedFilter && model.pinnedFilter != .all {
                Button(CyclocrossPresentation.t("Quitar", "Remove"), role: .destructive) { model.clearDefaultFilter(); pendingDefaultFilter = nil }
            } else {
                Button(CyclocrossPresentation.t("Establecer", "Set")) { model.setDefaultFilter(filter); pendingDefaultFilter = nil }
            }
            Button(CyclocrossPresentation.t("Cancelar", "Cancel"), role: .cancel) { pendingDefaultFilter = nil }
        } message: { filter in
            if filter == model.pinnedFilter && model.pinnedFilter != .all {
                Text(CyclocrossPresentation.t(
                    "Se eliminará «\(filter.label)» como filtro predeterminado de la agenda de Ciclocross.",
                    "«\(filter.label)» will no longer be the default for the Cyclocross agenda."
                ))
            } else {
                Text(CyclocrossPresentation.t(
                    "El filtro «\(filter.label)» se aplicará como predeterminado solo en la agenda de Ciclocross.",
                    "The filter «\(filter.label)» will be applied as default only in the Cyclocross agenda."
                ))
            }
        }
        .task { await model.open(selectedSeason ?? model.season) }
        .task(id: model.season) { await model.loadRounds() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await model.refresh(forceArtwork: false)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                await model.refresh(forceArtwork: false)
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                now = Date()
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
    }

    private func openHighlightedTarget(_ target: TodayHighlightTarget) {
        switch target {
        case .stage(let id): highlightedStageDayId = IdentifiableID(id: id)
        case .race(let id): highlightedRaceId = IdentifiableID(id: id)
        case .startlist(let id): highlightedStartlistRaceId = IdentifiableID(id: id)
        case .startOrder(let id): highlightedStartOrderDayId = IdentifiableID(id: id)
        case .championships: championshipsRoute = ChampionshipsRoute()
        case .transfers: NotificationManager.shared.pendingDeepLink = .tab(2)
        case .season(let year): NotificationManager.shared.pendingDeepLink = .season(year)
        case .cxRace(let id): NotificationManager.shared.pendingDeepLink = .cxRace(id, anchor: nil)
        case .cxTournament: break
        }
    }
    private struct AgendaGroup: Identifiable {
        let header: CxAgendaRow?
        var rows: [CxAgendaRow]
        var id: String { header?.id ?? rows.first?.id ?? "empty" }
    }

    private var agendaGroups: [AgendaGroup] {
        var groups: [AgendaGroup] = []
        for row in model.rows {
            if case .day = row {
                groups.append(AgendaGroup(header: row, rows: []))
            } else if groups.isEmpty {
                groups.append(AgendaGroup(header: nil, rows: [row]))
            } else {
                groups[groups.count - 1].rows.append(row)
            }
        }
        return groups
    }

    /// Lista de la agenda con su gesto y su animación de mes, extraída para que
    /// el type-checker no se ahogue con la cadena completa del body.
    private func agendaList(proxy: ScrollViewProxy) -> some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                let columns = AdaptiveLayoutPolicy.feedColumns(
                    width: max(0, contentWidth - 32),
                    isRegular: horizontalSizeClass == .regular
                )
                ForEach(agendaGroups) { group in
                    if let header = group.header {
                        agendaRow(header).id(header.id)
                    }
                    let rows = AdaptiveLayoutPolicy.rows(
                        group.rows,
                        columns: columns,
                        spansAllColumns: { row in
                            if case .race = row { return false }
                            return true
                        }
                    )
                    ForEach(rows) { row in
                        if columns == 1 || row.spansAllColumns {
                            agendaRow(row.items[0]).id(row.items[0].id)
                        } else {
                            HStack(alignment: .top, spacing: 10) {
                                ForEach(row.items) { item in
                                    agendaRow(item)
                                        .id(item.id)
                                        .frame(maxWidth: .infinity, alignment: .top)
                                }
                                if row.items.count < columns {
                                    Color.clear.frame(maxWidth: .infinity)
                                }
                            }
                        }
                    }
                }
            }.scrollTargetLayout().padding()
        }
        .refreshable {
            await model.refresh()
            Haptics.play(.success)
        }
        .onChange(of: model.jumpDate) { _, date in
            guard let date else { return }
            let id = model.rows.first { $0.id == "day:" + date }?.id
                ?? model.rows.first?.id
            model.jumpDate = nil
            Task {
                await Task.yield()
                if let id { proxy.scrollTo(id, anchor: .top) }
                await Task.yield()
            }
        }
        .offset(x: contentOffset)
        .clipped()
        .onGeometryChange(for: CGFloat.self) { geometry in
            geometry.size.width
        } action: { width in
            contentWidth = width
        }
        .simultaneousGesture(
            // Misma receta que Hoy: detección temprana en `.updating` (para
            // cortar la navegación de la card) y umbral real de 60 pt en
            // `.onEnded`. El gesto vive solo en la lista: el cintillo desliza
            // su carrusel sin cambiar de mes.
            DragGesture(minimumDistance: 10, coordinateSpace: .local)
                .updating($isHorizontalSwipe) { value, state, _ in
                    let h = abs(value.translation.width)
                    let v = abs(value.translation.height)
                    if h > 15 && h > v * 1.5 { state = true }
                }
                .onEnded { value in
                    guard tournament == nil else { return }
                    let h = value.translation.width
                    let v = abs(value.translation.height)
                    guard abs(h) > v, abs(h) > 60, let active = model.activeMonth else { return }
                    let target = h < 0 ? active.next : active.previous
                    guard model.allowed.contains(target) else { return }
                    Haptics.play(.navigation)
                    animateNavigation(forward: h < 0) { await model.selectMonth(target) }
                }
        )
    }
    /// Selector de secciones y, en la general, de categorías: los mismos
    /// controles que la ficha de carrera.
    private var tournamentSectionControls: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(CxTournamentSection.allCases) { item in
                        ResultsClassificationTab(label: item.title, selected: section == item, tint: nil) { section = item }
                    }
                }
            }
            if section == .general {
                ResultsStageSelector(stageKeys: generalCategories, activeKey: generalCategory,
                    onSelect: { generalCategory = $0 }, labelForKey: { $0 },
                    accessibilityLabelForKey: { CyclocrossPresentation.category($0) })
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal)
        .background(AppTheme.background)
    }
    private func tournamentGeneral(_ data: CxTournamentStandings) -> some View {
        let rows = data.standings.filter { $0.category == generalCategory }
        let state = data.states.first { $0.category == generalCategory }
        let mode = CyclocrossPresentation.standingMode(scheme: data.pointsScheme, category: generalCategory, rows: rows)
        return ScrollView {
            // Con columnas de ronda, el gesto horizontal desplaza la tabla y no
            // cambia de categoría.
            CxStandingsTable(rows: rows, state: state, mode: mode, matcher: standingsMatcher, rounds: model.rounds, races: data.races)
                .contentShape(Rectangle())
                .classificationSwipe(options: CxStandingsTable.hasRounds(state: state, mode: mode) ? [] : generalCategories, current: generalCategory) { generalCategory = $0 }
                .padding(.horizontal)
                .padding(.bottom)
        }
        .refreshable {
            await loadStandings()
            Haptics.play(.success)
        }
    }
    private var roundTotal: Int {
        guard let tournament else { return 0 }
        let races = model.rows.compactMap { row -> CxRace? in
            if case .race(let race, _) = row { return race }
            return nil
        }
        return CyclocrossPresentation.tournamentRoundTotal(tournament.id, races: races, rounds: model.rounds)
    }
    /// Transición animada de cambio de mes, espejo de `animateNavigation` de
    /// Hoy en Carretera (TodayView.swift).
    private func animateNavigation(forward: Bool, action: @escaping () async -> Void) {
        guard !isAnimatingNavigation else { return }
        if reduceMotion {
            Task { await action() }
            return
        }
        isAnimatingNavigation = true
        let width = max(contentWidth, 1)
        let outDir: CGFloat = forward ? -1 : 1
        withAnimation(.easeOut(duration: 0.15)) { contentOffset = outDir * width }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            await action()
            contentOffset = -outDir * width
            withAnimation(.easeOut(duration: 0.2)) { contentOffset = 0 }
            try? await Task.sleep(for: .milliseconds(200))
            isAnimatingNavigation = false
        }
    }
    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        // La marca simplificada solo acompaña a la agenda general; la página de
        // torneo usa la identidad de la cabecera, como las vueltas por etapas.
        if tournament == nil {
            if #available(iOS 26, *) {
                ToolbarItem(placement: .topBarLeading) { CCHeaderMarkView() }
                    .sharedBackgroundVisibility(.hidden)
            } else {
                ToolbarItem(placement: .topBarLeading) { CCHeaderMarkView() }
            }
        }
    }
    private var monthControls: some View {
        let active = model.activeMonth ?? model.allowed.first
        return HStack(spacing: 0) {
            // Flechas visibles solo si los siete meses no caben sin desplazarse.
            if !monthsFit {
                Button { if let active { Haptics.play(.navigation); animateNavigation(forward: false) { await model.selectMonth(active.previous) } } } label: {
                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                }.disabled(model.busy || active == model.allowed.first)
                    .accessibilityLabel(CyclocrossPresentation.t("Mes anterior", "Previous month"))
            }
            if #available(iOS 26, *) {
                monthSelector.scrollEdgeEffectHidden()
            } else {
                monthSelector
            }
            if !monthsFit {
                Button { if let active { Haptics.play(.navigation); animateNavigation(forward: true) { await model.selectMonth(active.next) } } } label: {
                    Image(systemName: "chevron.right").frame(width: 44, height: 44)
                }.disabled(model.busy || active == model.allowed.last)
                    .accessibilityLabel(CyclocrossPresentation.t("Mes siguiente", "Next month"))
            }
        }
        .padding(.horizontal, 8)
        .background(AppTheme.headerBackground)
    }
    private var monthSelector: some View {
        ResultsStageSelector(stageKeys: model.allowed.map(\.key), activeKey: (model.activeMonth ?? model.allowed.first)?.key, onSelect: { key in
            if let target = model.allowed.first(where: { $0.key == key }) {
                Haptics.play(.navigation)
                animateNavigation(forward: target > (model.activeMonth ?? target)) { await model.selectMonth(target) }
            }
        }, labelForKey: { key in CyclocrossPresentation.date(key + "-01", format: "MMM").lowercased() },
            subtitleForKey: { String($0.prefix(4)) },
            accessibilityLabelForKey: { CyclocrossPresentation.date($0 + "-01", format: "MMMM yyyy") }, dateNavigationStyle: true)
            .disabled(model.busy)
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentSize.width <= geometry.containerSize.width + 0.5
            } action: { _, fits in monthsFit = fits }
    }
    /// Franja de filtros con la misma presentación que Hoy en Carretera: chips
    /// de cápsula bajo la cabecera, sin fijado por defecto.
    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(CxAgendaFilter.allCases) { filter in
                    CxFilterChip(
                        filter: filter,
                        isActive: model.filter == filter,
                        activeFilter: model.filter,
                        pinnedFilter: model.pinnedFilter,
                        onTap: {
                            if model.filter == filter {
                                Haptics.play(.primaryAction)
                                pendingDefaultFilter = filter
                            } else {
                                Haptics.play(.selection)
                                model.filter = filter
                            }
                        },
                        onLongPress: {
                            Haptics.play(.primaryAction)
                            pendingDefaultFilter = filter
                        }
                    )
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 4)
        }
        .accessibilityIdentifier("cx_agenda_filters")
    }
    @ViewBuilder private func agendaRow(_ row: CxAgendaRow) -> some View {
        switch row {
        case .day(let date):
            Text(DateFormatting.formatDateLabel(date)).font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading).accessibilityAddTraits(.isHeader)
                .padding(.top, tournament != nil && row.id != model.rows.first?.id ? 6 : 0)
        case .empty(_, let filtered):
            // Estado vacío con la presentación de Hoy en Carretera.
            EmptyStateView(
                icon: "calendar.badge.exclamationmark",
                title: CyclocrossPresentation.t("No hay carreras", "No races"),
                subtitle: filtered
                    ? CyclocrossPresentation.t("No hay carreras con este filtro para el mes seleccionado", "No races matching this filter for the selected month")
                    : CyclocrossPresentation.t("No hay carreras programadas para este mes", "No races scheduled for this month")
            )
            .frame(maxWidth: .infinity, minHeight: 220)
            .padding(.horizontal)
        case .race(let race, let date): CxRaceCard(race: race, date: date, now: now, round: model.rounds[race.id], showTournamentLink: tournament == nil, disableTap: isHorizontalSwipe, onPlaceholder: { placeholderRace = $0 })
        }
    }
}

struct CxRaceCard: View {
    let race: CxRace
    let date: String
    let now: Date
    var round: CxRound? = nil
    var showTournamentLink = true
    /// Bloquea la navegación durante un swipe horizontal entre meses (patrón
    /// de Hoy: el touch-up no debe abrir la ficha a la vez que cambia el mes).
    var disableTap = false
    /// La ficha no tiene la carga mínima (o la prueba está cancelada): el toque
    /// abre el aviso de placeholder de Hoy en Carretera en vez de navegar.
    var onPlaceholder: ((CxRace) -> Void)? = nil
    private var tournament: CxTournament? { showTournamentLink ? race.tournament : nil }
    private var currentRound: CxRound? { round.flatMap { $0.total > 1 ? $0 : nil } }
    private var venue: String? { race.venue.flatMap { $0 != CyclocrossPresentation.name(race) ? $0 : nil } }
    private var metaDot: some View { Text("·").font(.caption).foregroundStyle(.secondary).accessibilityHidden(true) }
    private var categories: [CxCategory] { CyclocrossLogic.categories(on: date, race: race) }
    /// Prueba sin ningún horario asociado: los indicadores pasan a badges.
    private var usesCategoryBadges: Bool {
        CyclocrossPresentation.usesCategoryBadges(race: race, categories: categories, at: now)
    }
    /// Sin documento (Libro de Ruta o Mapa) o sin horarios, la ficha no está
    /// lista: la card no navega a la carrera ni a sus categorías.
    private var open: Bool { CyclocrossLogic.raceOpen(race) }
    private var placeholder: Bool { race.isCancelled || !open }
    /// Sin ficha lista, los indicadores de categoría no navegan: el toque abre
    /// el aviso de placeholder como el resto de la card.
    private var programmeTap: () -> Void {
        if open { return {} }
        return { onPlaceholder?(race) }
    }
    /// Badge de prueba cancelada, con el mismo tratamiento que Hoy en Carretera.
    private var cancelledBadge: some View { CxCancelledBadge() }
    // Card entera clicable (patrón de Hoy): cualquier zona abre la ficha; los
    // botones internos (categorías, torneo, TV) conservan su acción.
    private var cardLink: some View {
        Group {
            if placeholder {
                Button { onPlaceholder?(race) } label: { cardView.contentShape(Rectangle()) }.buttonStyle(.plain)
            } else {
                NavigationLink(value: CxDestination(raceId: race.id)) { cardView.contentShape(Rectangle()) }.buttonStyle(.plain)
            }
        }
        .disabled(disableTap)
    }
    private var cardView: some View {
        CCCard(accent: CyclocrossPresentation.color(race).map { Color(hex: $0) }, accentAlpha: 0.04, cornerRadius: 14, showShadow: false) {
            HStack(spacing: 10) {
            RaceCardIdentity(logoUrl: CyclocrossPresentation.logo(race), countryCode: race.countryCode, stackedFlag: true) {
                VStack(alignment: .leading, spacing: 3) {
                    // Paridad web: nombre, badge de clase y hamburguesa de
                    // torneo en la primera línea.
                    HStack(spacing: 5) {
                        Text(CyclocrossPresentation.name(race)).font(.subheadline.weight(.medium)).lineLimit(1)
                        CategoryBadge(category: CyclocrossPresentation.raceClass(race.raceClass))
                        if race.isCancelled { cancelledBadge }
                        // El acceso al torneo vive solo en la hamburguesa.
                        if let tournament {
                            NavigationLink(destination: CyclocrossView(tournament: tournament, season: race.seasonKey)) {
                                RaceCompetitionLabel()
                            }.buttonStyle(.plain)
                                .accessibilityLabel(CyclocrossPresentation.t("Ver torneo \(tournament.name)", "View series \(tournament.nameEn ?? tournament.name)"))
                        }
                    }
                    // Orden de metadatos: torneo · ronda · localización.
                    HStack(spacing: 5) {
                        if let tournament {
                            Text(CyclocrossPresentation.t(tournament.name, tournament.nameEn ?? tournament.name))
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            if currentRound != nil || venue != nil { metaDot }
                        }
                        if let currentRound {
                            Text("\(currentRound.n)/\(currentRound.total)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                            if venue != nil { metaDot }
                        }
                        if let venue {
                            Text(venue).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            } details: {
                // Prueba cancelada: solo la indicación; sin categorías.
                if !race.isCancelled {
                if usesCategoryBadges {
                    FlowLayout(spacing: 4) {
                        ForEach(categories) { category in
                            CxCategoryActions(race: race, category: category, now: now,
                                compact: true, onProgramme: programmeTap, destination: open ? race.id : nil)
                        }
                    }.padding(.top, 3)
                } else {
                    HStack(spacing: 4) {
                        ForEach(categories) { category in
                            CxCategoryActions(race: race, category: category, now: now,
                                expanded: true, onProgramme: programmeTap, destination: open ? race.id : nil)
                                .frame(maxWidth: .infinity)
                        }
                    }.frame(maxWidth: .infinity).padding(.top, 3)
                }
                }
            }
            if open {
                RaceCardChevron()
            }
            }.padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 8)
        }
    }
    var body: some View {
        cardLink.accessibilityHint(placeholder
            ? CyclocrossPresentation.t("Sin información detallada, pulsa dos veces para ver más", "No detailed information yet, double tap to see more")
            : "")
    }
}

struct CxCategoryActions: View {
    let race: CxRace
    let category: CxCategory
    let now: Date
    var selected = false
    /// Indicador compacto (badge de Hoy) para pruebas aún sin horarios.
    var compact = false
    /// Reparte el cuadro por el ancho disponible en la fila con horarios.
    var expanded = false
    var onProgramme: () -> Void
    var onStartlist: (() -> Void)? = nil
    var onResults: (() -> Void)? = nil
    var destination: String? = nil
    private var phase: CxCategoryCardState { CyclocrossPresentation.categoryCardState(race: race, category: category, at: now) }
    var body: some View {
        if compact {
            HStack(spacing: 4) {
                Group {
                    if let destination {
                        NavigationLink(value: CxDestination(raceId: destination, anchor: phase == .results ? "resultados-" + category.category : category.category)) { categoryBadge }.buttonStyle(.plain)
                    } else {
                        Button(action: phase == .results ? onResults ?? onProgramme : onProgramme) { categoryBadge }.buttonStyle(.plain)
                    }
                }
                if phase == .time, category.startlistImportedAt != nil {
                    action(CyclocrossPresentation.t("Dorsales", "Startlist"), icon: "figure.outdoor.cycle", anchor: "inscritos-" + category.category, primary: true, perform: onStartlist ?? onProgramme)
                }
            }
        } else {
            // Con horarios: la caja solo lleva el código (mismo ancho, menos
            // alta); hora o copa van debajo, fuera de la caja, con la
            // tipografía de salida/meta de Hoy en Carretera.
            VStack(spacing: 2) {
                HStack(spacing: 4) {
                    Group {
                        if let destination {
                            NavigationLink(value: CxDestination(raceId: destination, anchor: category.category)) { categoryTile }.buttonStyle(.plain)
                        } else {
                            Button(action: onProgramme) { categoryTile }.buttonStyle(.plain)
                        }
                    }.frame(maxWidth: expanded ? .infinity : nil)
                    if phase == .time, category.startlistImportedAt != nil {
                        action(CyclocrossPresentation.t("Dorsales", "Startlist"), icon: "figure.outdoor.cycle", anchor: "inscritos-" + category.category, primary: true, perform: onStartlist ?? onProgramme)
                    }
                }
                scheduleUnderBox
            }
        }
    }
    /// Hora, copa, espera o cancelación bajo la caja de categoría.
    @ViewBuilder private var scheduleUnderBox: some View {
        switch phase {
        case .results:
            // Copa de Hoy en Carretera: trofeo secundario que abre resultados.
            Group {
                if let destination {
                    NavigationLink(value: CxDestination(raceId: destination, anchor: "resultados-" + category.category)) { trophyLabel }.buttonStyle(.plain)
                } else {
                    Button(action: onResults ?? onProgramme) { trophyLabel }.buttonStyle(.plain)
                }
            }
        case .awaiting: WaitingResultsLabel()
        case .cancelled: CxCancelledBadge()
        case .time:
            Text(CyclocrossPresentation.localTime(category.startTimeUtc) ?? "—")
                .font(.callout).fontWeight(.semibold).foregroundStyle(.secondary)
        }
    }
    private var trophyLabel: some View {
        // Copa compacta: misma altura contenida que el horario que acompaña,
        // sin el marco de 44 pt que abría hueco sobre el borde de la card.
        Image(systemName: "trophy").font(.body).foregroundStyle(.secondary)
            .frame(width: 44, height: 24).contentShape(Rectangle())
            .accessibilityLabel(CyclocrossPresentation.category(category.category) + ": " + CyclocrossPresentation.t("Resultados", "Results"))
    }
    private var categoryBadge: some View {
        RaceActionLabel(label: category.category, primary: false, neutral: true)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(CyclocrossPresentation.category(category.category) + ": " + tileDescription)
    }
    @ViewBuilder private var categoryTile: some View {
        RaceActionTileLabel(label: category.category, selected: selected, fillWidth: expanded, boxOnly: true, neutral: true) {}
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(CyclocrossPresentation.category(category.category) + ": " + tileDescription)
    }
    private var tileDescription: String {
        switch phase {
        case .results: CyclocrossPresentation.t("Resultados", "Results")
        case .awaiting: CyclocrossPresentation.t("Esperando resultados", "Awaiting results")
        case .cancelled: CyclocrossPresentation.t("Cancelada", "Cancelled")
        case .time: CyclocrossPresentation.localTime(category.startTimeUtc) ?? CyclocrossPresentation.t("Horario pendiente", "Time pending")
        }
    }
    @ViewBuilder private func action(_ label: String, icon: String? = nil, anchor: String, primary: Bool = false, selected: Bool = false, perform: @escaping () -> Void) -> some View {
        if let destination {
            NavigationLink(value: CxDestination(raceId: destination, anchor: anchor)) { RaceActionLabel(label: label, icon: icon, primary: primary, selected: selected) }.buttonStyle(.plain)
        } else {
            Button(action: perform) { RaceActionLabel(label: label, icon: icon, primary: primary, selected: selected) }.buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
        }
    }
}

// MARK: - Filtro de la agenda CX

/// Badge rojo de "Cancelada", idéntico al de Hoy en Carretera.
private struct CxCancelledBadge: View {
    var body: some View {
        Text(CyclocrossPresentation.t("Cancelada", "Cancelled"))
            .font(.caption2)
            .fontWeight(.semibold)
            .textCase(.uppercase)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(AppTheme.red)
            .background(AppTheme.red.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .accessibilityLabel(CyclocrossPresentation.t("Prueba cancelada", "Cancelled race"))
    }
}

/// Chip de filtro de la agenda de ciclocross con la misma presentación que
/// `TodayFilterChip` de Hoy en Carretera (cápsula, azul de marca al activar y
/// chincheta de filtro predeterminado, propia de esta vista).
private struct CxFilterChip: View {
    let filter: CxAgendaFilter
    let isActive: Bool
    let activeFilter: CxAgendaFilter
    let pinnedFilter: CxAgendaFilter
    let onTap: () -> Void
    let onLongPress: () -> Void

    private enum PinDisplay { case filled, outline, hidden }

    private var pinDisplay: PinDisplay {
        if filter == .all || activeFilter == .all { return .hidden }
        if pinnedFilter != .all && pinnedFilter == filter { return .filled }
        if filter == activeFilter { return .outline }
        return .hidden
    }

    var body: some View {
        HStack(spacing: 4) {
            Text(filter.label)
                .fontWeight(isActive ? .semibold : .regular)
            switch pinDisplay {
            case .filled:
                Image(systemName: "pin.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.accentColor)
            case .outline:
                Image(systemName: "pin").font(.system(size: 10)).foregroundStyle(Color.accentColor).opacity(0.55)
            case .hidden:
                EmptyView()
            }
        }
        .font(.caption)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(isActive ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemBackground))
        .foregroundStyle(isActive ? Color.accentColor : Color(.secondaryLabel))
        .clipShape(Capsule())
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
        .onLongPressGesture(minimumDuration: 0.5, pressing: { pressing in
            if pressing { Haptics.play(.selection) }
        }, perform: { onLongPress() })
        .accessibilityAddTraits([.isButton])
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
        .accessibilityLabel(pinDisplay == .filled
            ? "\(LocaleService.t("Filtro", "Filter")) \(filter.label), \(LocaleService.t("fijado como predeterminado", "set as default"))"
            : "\(LocaleService.t("Filtro", "Filter")) \(filter.label)")
    }
}
