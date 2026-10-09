import SwiftUI

struct CxDestination: Hashable {
    let raceId: String
    var anchor: String? = nil
    /// Nombre de la prueba para rotular la pantalla de carga.
    var title: String? = nil
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
    /// Carrera cuya card es placeholder: muestra el aviso de información.
    @State private var placeholderRace: CxRace?
    /// Filtro cuya chincheta se está alternando (alert de predeterminado).
    @State private var pendingDefaultFilter: CxAgendaFilter?
    /// Deslizamiento entre días con la animación de Hoy en Carretera.
    @State private var contentOffset: CGFloat = 0
    @State private var contentWidth: CGFloat = 0
    @State private var isAnimatingNavigation = false
    /// Durante un swipe horizontal se desactivan las cards para que el
    /// touch-up no navegue a la vez que cambia el día.
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
        Group {
            if tournament == nil { dayAgenda } else { tournamentAgenda }
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
            await model.advanceIfNewLocalDay()
            // La pestaña Ciclocross refresca solo el mes del día mostrado; la
            // página de torneo, toda la temporada.
            await model.refresh(forceArtwork: false, visibleMonthOnly: true)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                await model.refresh(forceArtwork: false, visibleMonthOnly: true)
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                now = Date()
                await model.advanceIfNewLocalDay()
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

    // MARK: - Pestaña Ciclocross: vista Hoy

    /// Estructura de Hoy en Carretera: cintillo, barra de fechas, filtros y
    /// las pruebas del día.
    private var dayAgenda: some View {
        VStack(spacing: 0) {
            TodayHighlightsBanner(
                scope: "cx",
                onTapChampionships: { championshipsRoute = ChampionshipsRoute() },
                onOpenTarget: openHighlightedTarget
            )
                .padding(.top, 8)
                .padding(.bottom, 10)
            dateNavigationBar
            filterBar
            Divider()
            dayContent
        }
        .background(AppTheme.background)
        .allowsHitTesting(!isAnimatingNavigation)
        .onAppear { AnalyticsService.shared.logScreenView("cyclocross") }
        .onChange(of: model.dateKey) { _, date in
            let count = model.dayRaces.count
            let label = DateFormatting.formatDateLabel(date)
            AccessibilityAnnouncement.announce(count > 0
                ? CyclocrossPresentation.t("\(label), \(count) carrera\(count == 1 ? "" : "s")", "\(label), \(count) race\(count == 1 ? "" : "s")")
                : CyclocrossPresentation.t("\(label), sin carreras", "\(label), no races"))
        }
    }

    /// Navegación de fecha de Hoy: flechas al día con carreras anterior o
    /// siguiente, acceso a Hoy y tira de siete días limitada a la temporada.
    private var dateNavigationBar: some View {
        HStack(spacing: 0) {
            Button {
                Haptics.play(.navigation)
                animateNavigation(forward: false) { model.goToPreviousDay() }
            } label: {
                Image(systemName: "chevron.left")
                    .frame(width: 44, height: 60)
            }
            .buttonStyle(.plain)
            .disabled(!model.canGoToPreviousDay)
            .opacity(model.canGoToPreviousDay ? 1 : 0.3)
            .accessibilityLabel(CyclocrossPresentation.t("Día anterior", "Previous day"))

            if !model.isShowingCurrentDay {
                Button {
                    Haptics.play(.navigation)
                    animateNavigation(forward: model.agendaToday >= model.dateKey) { model.goToToday() }
                } label: {
                    Text(CyclocrossPresentation.t("Hoy", "Today"))
                        .ccFont(.s14, weight: .semibold)
                        .foregroundStyle(Color.accentColor)
                        .frame(minWidth: 44, minHeight: 48)
                        .padding(.horizontal, 4)
                        .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: AppTheme.Radius.surface))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(CyclocrossPresentation.t("Ir al día de hoy", "Go to today"))
            }

            DateBarView(
                selectedDate: model.dateKey,
                firstDate: model.firstDay,
                lastDate: model.lastDay,
                onSelect: { newDate in
                    animateNavigation(forward: newDate > model.dateKey) { model.navigate(to: newDate) }
                }
            )
            // Mismo criterio que Hoy: se recrea al aparecer o desaparecer el
            // botón Hoy y, además, al cambiar de temporada (otros extremos).
            .id("\(model.season):\(model.isShowingCurrentDay)")

            Button {
                Haptics.play(.navigation)
                animateNavigation(forward: true) { model.goToNextDay() }
            } label: {
                Image(systemName: "chevron.right")
                    .frame(width: 44, height: 60)
            }
            .buttonStyle(.plain)
            .disabled(!model.canGoToNextDay)
            .opacity(model.canGoToNextDay ? 1 : 0.3)
            .accessibilityLabel(CyclocrossPresentation.t("Día siguiente", "Next day"))
        }
        .foregroundStyle(Color.accentColor)
        .background(AppTheme.headerBackground)
    }

    /// Lista del día con el gesto y la animación de cambio de día de Hoy.
    private var dayContent: some View {
        Group {
            if !model.hasLoaded {
                LoadingView(branded: true, showProfile: false, title: CyclocrossPresentation.t("Ciclocross", "Cyclocross"))
            } else {
                ScrollView { dayScrollContent }
                    // Cada día empieza en la cabecera de su lista (como Hoy).
                    .id(model.dateKey)
                    .refreshable {
                        await model.refresh()
                        Haptics.play(.success)
                    }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
            // su carrusel sin cambiar de día.
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
                    // Extremos de la temporada: el gesto no navega.
                    if h < 0, !model.canGoToNextDay { return }
                    if h > 0, !model.canGoToPreviousDay { return }
                    Haptics.play(.navigation)
                    if h < 0 {
                        animateNavigation(forward: true) { model.goToNextDay() }
                    } else {
                        animateNavigation(forward: false) { model.goToPreviousDay() }
                    }
                }
        )
    }

    @ViewBuilder private var dayScrollContent: some View {
        if let error = model.error, model.seasonRaces.isEmpty {
            ErrorView(message: error) { Task { await model.retry() } }
                .frame(maxWidth: .infinity, minHeight: 320)
        } else if model.dayRaces.isEmpty {
            // Estado vacío de Hoy; con Todas solo aparece si no queda ningún
            // día con carreras (la auto-navegación ya avanzó).
            VStack(spacing: 16) {
                EmptyStateView(
                    icon: "calendar.badge.exclamationmark",
                    title: CyclocrossPresentation.t("No hay carreras", "No races"),
                    subtitle: model.filter == .all
                        ? CyclocrossPresentation.t("No hay carreras programadas para este día", "No races scheduled for this day")
                        : CyclocrossPresentation.t("No hay carreras con este filtro para este día", "No races matching this filter for this day")
                )
                .fixedSize(horizontal: false, vertical: true)
                if let next = model.nextDayWithRaces {
                    Button {
                        Haptics.play(.navigation)
                        animateNavigation(forward: true) { model.navigate(to: next) }
                    } label: {
                        HStack(spacing: 4) {
                            Text(CyclocrossPresentation.t("Siguiente día con carreras", "Next day with races"))
                            Image(systemName: "arrow.right")
                        }
                        .ccFont(.s14, weight: .medium)
                    }
                    .accessibilityHint(CyclocrossPresentation.t("Navega al siguiente día con carreras de este filtro", "Navigate to the next day with races for this filter"))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 320)
        } else {
            LazyVStack(spacing: 10) {
                raceGrid(model.dayRaces.map { CxAgendaRow.race($0, model.dateKey) })
            }
            .padding(.horizontal).padding(.top, 8).padding(.bottom)
        }
    }

    // MARK: - Página de torneo

    private var tournamentAgenda: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 8) {
                // Estructura de las vueltas por etapas de carretera, sin el logo
                // simplificado en la barra superior.
                if let tournament {
                    VStack(alignment: .leading, spacing: 10) {
                        RaceCompetitionIdentity(name: CyclocrossPresentation.t(tournament.name, tournament.nameEn ?? tournament.name), logoUrl: tournament.logoUrl, countryCode: nil, hideFlag: true)
                        HStack(spacing: 8) {
                            if roundTotal > 1 {
                                Text(CyclocrossPresentation.t("\(roundTotal) rondas", "\(roundTotal) rounds")).ccFont(.s13).foregroundStyle(AppTheme.textMuted)
                                Text("·").ccFont(.s13).foregroundStyle(AppTheme.textMuted).accessibilityHidden(true)
                            }
                            Text(tournament.seasonKey ?? model.season).ccFont(.s13).foregroundStyle(AppTheme.textMuted)
                            Spacer()
                        }
                    }
                    .padding().background(AppTheme.cardBackground)
                }
                if !generalCategories.isEmpty { tournamentSectionControls }
                if showsGeneral, let standings {
                    tournamentGeneral(standings)
                } else {
                    // Indicador solo sin pruebas a la vista.
                    if model.busy && !model.isRefreshing && model.rows.isEmpty { ProgressView().accessibilityLabel(CyclocrossPresentation.t("Cargando ciclocross", "Loading cyclocross")) }
                    if let error = model.error {
                        VStack {
                            Text(error).foregroundStyle(.red)
                            Button(CyclocrossPresentation.t("Reintentar", "Retry")) { Task { await model.retry() } }.buttonStyle(.bordered)
                        }.padding(.horizontal)
                    }
                    // Pantalla de carga completa (sin perfil inferior, como las
                    // transiciones de Hoy) hasta la primera tanda.
                    if model.busy, !model.isRefreshing, model.rows.isEmpty {
                        LoadingView(branded: true, showProfile: false, title: CyclocrossPresentation.t("Ciclocross", "Cyclocross"))
                    } else {
                        agendaList(proxy: proxy)
                    }
                }
            }
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

    /// Pruebas en una columna o, en pantalla ancha, en dos.
    private func raceGrid(_ items: [CxAgendaRow]) -> some View {
        let columns = AdaptiveLayoutPolicy.feedColumns(
            width: max(0, contentWidth - 32),
            isRegular: horizontalSizeClass == .regular
        )
        let rows = AdaptiveLayoutPolicy.rows(
            items,
            columns: columns,
            spansAllColumns: { row in
                if case .race = row { return false }
                return true
            }
        )
        return Grid(alignment: .top, horizontalSpacing: 10, verticalSpacing: 10) {
            ForEach(rows) { row in
                if columns == 1 || row.spansAllColumns {
                    agendaRow(row.items[0]).id(row.items[0].id)
                        .gridCellColumns(columns)
                } else {
                    GridRow(alignment: .top) {
                        ForEach(row.items) { item in
                            agendaRow(item)
                                .id(item.id)
                                .frame(maxWidth: .infinity, alignment: .top)
                        }
                        if row.items.count < columns {
                            Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                        }
                    }
                }
            }
        }
    }

    /// Lista del torneo: cada día encima de sus pruebas.
    private func agendaList(proxy: ScrollViewProxy) -> some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(agendaGroups) { group in
                    if let header = group.header {
                        agendaRow(header).id(header.id)
                    }
                    raceGrid(group.rows)
                }
            }.scrollTargetLayout().padding(.horizontal).padding(.top, 8).padding(.bottom)
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
        .onGeometryChange(for: CGFloat.self) { geometry in
            geometry.size.width
        } action: { width in
            contentWidth = width
        }
        .simultaneousGesture(
            // Durante un deslizamiento horizontal las cards no navegan.
            DragGesture(minimumDistance: 10, coordinateSpace: .local)
                .updating($isHorizontalSwipe) { value, state, _ in
                    let h = abs(value.translation.width)
                    let v = abs(value.translation.height)
                    if h > 15 && h > v * 1.5 { state = true }
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
    /// Transición animada de cambio de día, espejo de `animateNavigation` de
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
                                model.selectFilter(filter)
                            }
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
            // Fecha del día en gris, como en Resultados, Fichajes y Calendario.
            Text(DateFormatting.formatDateLabel(date)).ccFont(.s13, weight: .semibold).foregroundStyle(AppTheme.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading).accessibilityAddTraits(.isHeader)
                .padding(.top, tournament != nil && row.id != model.rows.first?.id ? 6 : 0)
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
    /// Bloquea la navegación durante un swipe horizontal entre días (patrón
    /// de Hoy: el touch-up no debe abrir la ficha a la vez que cambia el día).
    var disableTap = false
    /// La ficha no tiene la carga mínima: el toque
    /// abre el aviso de placeholder de Hoy en Carretera en vez de navegar.
    var onPlaceholder: ((CxRace) -> Void)? = nil
    private var tournament: CxTournament? { showTournamentLink ? race.tournament : nil }
    private var currentRound: CxRound? { round.flatMap { $0.total > 1 ? $0 : nil } }
    private var venue: String? { race.venue.flatMap { $0 != CyclocrossPresentation.name(race) ? $0 : nil } }
    private var metaDot: some View { Text("·").ccFont(.s12).foregroundStyle(AppTheme.textMuted).accessibilityHidden(true) }
    private var categories: [CxCategory] { CyclocrossLogic.categories(on: date, race: race) }
    /// Prueba sin ningún horario asociado: los indicadores pasan a badges.
    private var usesCategoryBadges: Bool {
        CyclocrossPresentation.usesCategoryBadges(race: race, categories: categories, at: now)
    }
    /// Sin documento (Libro de Ruta o Mapa) o sin horarios, la ficha no está
    /// lista: la card no navega a la carrera ni a sus categorías.
    private var open: Bool { CyclocrossLogic.raceOpen(race) }
    private var placeholder: Bool { !open }
    /// Sin ficha lista, los indicadores de categoría no navegan: el toque abre
    /// el aviso de placeholder como el resto de la card.
    private var programmeTap: () -> Void {
        if open { return {} }
        return { onPlaceholder?(race) }
    }
    // Card entera clicable (patrón de Hoy): cualquier zona abre la ficha; los
    // botones internos (categorías, torneo, TV) conservan su acción.
    private var cardLink: some View {
        Group {
            if placeholder {
                Button { onPlaceholder?(race) } label: { cardView.contentShape(Rectangle()) }.buttonStyle(.plain)
            } else {
                NavigationLink(value: CxDestination(raceId: race.id, title: CyclocrossPresentation.name(race))) { cardView.contentShape(Rectangle()) }.buttonStyle(.plain)
            }
        }
        .disabled(disableTap)
    }
    private var cardView: some View {
        CCCard {
            HStack(spacing: 10) {
            RaceCardIdentity(logoUrl: CyclocrossPresentation.logo(race), countryCode: race.countryCode, stackedFlag: true) {
                VStack(alignment: .leading, spacing: 3) {
                    // Paridad web: nombre, badge de clase y hamburguesa de
                    // torneo en la primera línea.
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        // Una sola línea con puntos suspensivos: altura única
                        // de card.
                        Text(CyclocrossPresentation.name(race)).ccFont(.s16, weight: .medium)
                            .lineLimit(1).truncationMode(.tail)
                        HStack(alignment: .firstTextBaseline, spacing: 0) {
                            CategoryBadge(category: CyclocrossPresentation.raceClass(race.raceClass)).fixedSize()
                            // Reserva la altura del acceso al torneo: misma
                            // altura de línea con o sin él.
                            RaceCompetitionLabel().frame(width: 0).hidden().accessibilityHidden(true)
                        }
                        // El acceso al torneo vive solo en la hamburguesa.
                        if let tournament {
                            NavigationLink(destination: CyclocrossView(tournament: tournament, season: race.seasonKey)) {
                                RaceCompetitionLabel()
                            }.buttonStyle(.plain).fixedSize()
                                .accessibilityLabel(CyclocrossPresentation.t("Ver torneo \(tournament.name)", "View series \(tournament.nameEn ?? tournament.name)"))
                        }
                    }
                    // Orden de metadatos: torneo · ronda · localización, en
                    // una línea. Se recorta primero la sede y después el
                    // torneo; la ronda no se recorta.
                    HStack(spacing: 5) {
                        if let tournament {
                            Text(CyclocrossPresentation.t(tournament.name, tournament.nameEn ?? tournament.name))
                                .ccFont(.s12).foregroundStyle(AppTheme.textMuted).lineLimit(1)
                                .layoutPriority(1)
                            if currentRound != nil || venue != nil { metaDot.fixedSize() }
                        }
                        if let currentRound {
                            Text("\(currentRound.n)/\(currentRound.total)").ccFont(.s12).foregroundStyle(AppTheme.textMuted).monospacedDigit()
                                .fixedSize()
                            if venue != nil { metaDot.fixedSize() }
                        }
                        if let venue {
                            Text(venue).ccFont(.s12).foregroundStyle(AppTheme.textMuted).lineLimit(1)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            } details: {
                // Altura única de card: badges y cajas con hora, copa, espera
                // o aspa reservan caja + separación + fila de estado.
                if usesCategoryBadges {
                    FlowLayout(spacing: 4) {
                        ForEach(categories) { category in
                            CxCategoryActions(race: race, category: category, now: now,
                                compact: true, onProgramme: programmeTap, destination: open ? race.id : nil)
                        }
                    }
                    .frame(minHeight: CxCategoryActions.height, alignment: .top)
                    .padding(.top, 3)
                } else {
                    HStack(spacing: 4) {
                        ForEach(categories) { category in
                            CxCategoryActions(race: race, category: category, now: now,
                                expanded: true, onProgramme: programmeTap, destination: open ? race.id : nil)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: CxCategoryActions.height, alignment: .top)
                    .padding(.top, 3)
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
    /// Caja de categoría, separación y fila de estado (hora, copa, espera o
    /// aspa). La fila reserva siempre el objetivo táctil de la copa para que
    /// todas las cards tengan la misma altura.
    static let boxHeight: CGFloat = 24
    static let statusSpacing: CGFloat = 2
    static let statusRowHeight: CGFloat = 24
    static var height: CGFloat { boxHeight + statusSpacing + statusRowHeight }
    private var phase: CxCategoryCardState { CyclocrossPresentation.categoryCardState(race: race, category: category, at: now) }
    var body: some View {
        if compact {
            HStack(spacing: 4) {
                Group {
                    if let destination {
                        NavigationLink(value: CxDestination(raceId: destination, anchor: phase == .results ? "resultados-" + category.category : category.category, title: CyclocrossPresentation.name(race))) { categoryBadge }.buttonStyle(CxCategoryBoxStyle(selected: selected))
                    } else {
                        Button(action: phase == .results ? onResults ?? onProgramme : onProgramme) { categoryBadge }.buttonStyle(CxCategoryBoxStyle(selected: selected))
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
            VStack(spacing: Self.statusSpacing) {
                HStack(spacing: 4) {
                    Group {
                        if let destination {
                            NavigationLink(value: CxDestination(raceId: destination, anchor: category.category, title: CyclocrossPresentation.name(race))) { categoryTile }.buttonStyle(CxCategoryBoxStyle(selected: selected))
                        } else {
                            Button(action: onProgramme) { categoryTile }.buttonStyle(CxCategoryBoxStyle(selected: selected))
                        }
                    }.frame(maxWidth: expanded ? .infinity : nil)
                    if phase == .time, category.startlistImportedAt != nil {
                        action(CyclocrossPresentation.t("Dorsales", "Startlist"), icon: "figure.outdoor.cycle", anchor: "inscritos-" + category.category, primary: true, perform: onStartlist ?? onProgramme)
                    }
                }
                scheduleUnderBox.frame(height: Self.statusRowHeight)
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
                    NavigationLink(value: CxDestination(raceId: destination, anchor: "resultados-" + category.category, title: CyclocrossPresentation.name(race))) { trophyLabel }.buttonStyle(.plain)
                } else {
                    Button(action: onResults ?? onProgramme) { trophyLabel }.buttonStyle(.plain)
                }
            }
        case .awaiting: WaitingResultsLabel()
        case .cancelled: CxCancelledCross()
        case .time:
            Text(CyclocrossPresentation.localTime(category.startTimeUtc) ?? "-")
                .ccFont(.s16, weight: .semibold).monospacedDigit().foregroundStyle(AppTheme.textPrimary)
                // Una línea en la fila de estado: con seis categorías la hora
                // reduce el cuerpo en lugar de recortarse.
                .lineLimit(1).minimumScaleFactor(0.7)
        }
    }
    private var trophyLabel: some View {
        // Copa compacta: misma altura contenida que el horario que acompaña,
        // sin el marco de 44 pt que abría hueco sobre el borde de la card.
        Image(systemName: "trophy").font(.body).foregroundStyle(.secondary)
            .frame(width: 44, height: Self.statusRowHeight).contentShape(Rectangle())
            .accessibilityLabel(CyclocrossPresentation.category(category.category) + ": " + CyclocrossPresentation.t("Resultados", "Results"))
    }
    private var categoryBadge: some View {
        Text(category.category)
            .ccFont(.s12, weight: .semibold)
            .padding(.horizontal, 8)
            .frame(height: Self.boxHeight)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(CyclocrossPresentation.category(category.category) + ": " + tileDescription)
    }
    @ViewBuilder private var categoryTile: some View {
        Text(category.category)
            .ccFont(.s12, weight: .semibold)
            .lineLimit(1)
            .padding(.horizontal, 5)
            .frame(minWidth: 40, maxWidth: expanded ? .infinity : nil, minHeight: Self.boxHeight, maxHeight: Self.boxHeight)
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
            NavigationLink(value: CxDestination(raceId: destination, anchor: anchor, title: CyclocrossPresentation.name(race))) { CxLinkLabel(label: label, icon: icon) }.buttonStyle(CxCategoryBoxStyle(selected: selected))
        } else {
            Button(action: perform) { CxLinkLabel(label: label, icon: icon) }.buttonStyle(CxCategoryBoxStyle(selected: selected))
                .accessibilityAddTraits(selected ? .isSelected : [])
        }
    }
}

/// Aspa roja de una categoría cancelada: ocupa la mitad central del hueco,
/// con trazo grueso y extremos redondeados como la X del emblema de
/// ciclocross, y la altura del horario o de la copa. El estado ya figura en
/// la etiqueta accesible de la caja de categoría.
private struct CxCancelledCross: View {
    var body: some View {
        CxCrossShape()
            .stroke(AppTheme.red, style: StrokeStyle(lineWidth: 4, lineCap: .round))
            .frame(maxWidth: .infinity).frame(height: 14)
            .padding(.vertical, 5)
            .accessibilityHidden(true)
    }
}

private struct CxCrossShape: Shape {
    func path(in rect: CGRect) -> Path {
        let box = rect.insetBy(dx: rect.width / 4, dy: 0)
        var path = Path()
        path.move(to: CGPoint(x: box.minX, y: box.minY)); path.addLine(to: CGPoint(x: box.maxX, y: box.maxY))
        path.move(to: CGPoint(x: box.maxX, y: box.minY)); path.addLine(to: CGPoint(x: box.minX, y: box.maxY))
        return path
    }
}

// MARK: - Caja de categoría

/// Caja de categoría de la agenda (ME, WE, MJ…): gris neutro con texto
/// principal y radio de control; al pulsar, gris más intenso
/// (`.cx-category-box` de `css/ciclocross.css`).
struct CxCategoryBoxStyle: ButtonStyle {
    var selected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(AppTheme.textPrimary)
            .background(
                configuration.isPressed || selected ? AppTheme.neutralFillPressed : AppTheme.neutralFill,
                in: RoundedRectangle(cornerRadius: AppTheme.Radius.control)
            )
            .contentShape(Rectangle())
    }
}

/// Etiqueta de enlace neutra (Dorsales, torneo): texto principal sobre la
/// superficie gris; el fondo lo pone `CxCategoryBoxStyle`.
struct CxLinkLabel: View {
    let label: String
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .semibold)) }
            Text(label).ccFont(.s12, weight: .semibold).lineLimit(1)
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 24)
    }
}

// MARK: - Filtro de la agenda CX

/// Chip de filtro de la agenda de ciclocross con la misma presentación que los
/// filtros del Calendario (`CalendarFilterChipLabel`): acento al 15 % al
/// activar y chincheta de filtro predeterminado, propia de esta vista.
private struct CxFilterChip: View {
    let filter: CxAgendaFilter
    let isActive: Bool
    let activeFilter: CxAgendaFilter
    let pinnedFilter: CxAgendaFilter
    /// Pulsar el filtro activo abre el diálogo de filtro predeterminado, como
    /// en Mes y Temporada.
    let onTap: () -> Void

    private enum PinDisplay { case filled, outline, hidden }

    private var pinDisplay: PinDisplay {
        if filter == .all || activeFilter == .all { return .hidden }
        if pinnedFilter != .all && pinnedFilter == filter { return .filled }
        if filter == activeFilter { return .outline }
        return .hidden
    }

    var body: some View {
        Button(action: onTap) {
            CalendarFilterChipLabel(
                label: filter.label,
                isActive: isActive,
                pinFilled: pinDisplay == .filled,
                pinOutline: pinDisplay == .outline
            )
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
        .accessibilityLabel(pinDisplay == .filled
            ? "\(LocaleService.t("Filtro", "Filter")) \(filter.label), \(LocaleService.t("fijado como predeterminado", "set as default"))"
            : "\(LocaleService.t("Filtro", "Filter")) \(filter.label)")
    }
}
