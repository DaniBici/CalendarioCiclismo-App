import SwiftUI
import StoreKit

/// Destinos de navegación programática vía deep link.
enum DeepLinkDestination: Hashable {
    case race(String)      // raceId
    case stage(String)     // raceDayId
    case startlist(String) // raceId → vista de inscritos
    case startOrder(String) // raceDayId → orden de salida
    case profile(String)    // raceDayId → perfil de elevación de la jornada
    case routeMap(String)   // raceDayId → mapa del recorrido de la jornada
    case settings          // pantalla de ajustes
    case championships     // Campeonatos Nacionales
    case results(String, Int?, String?) // raceId, etapa (nil = final), sufijo de doble sector
}

/// Página de serie CX (agenda de torneo) empujada por deep link. Campos
/// planos Hashable: `CxTournament` no es Hashable por `pointsScheme`.
struct CxTournamentDestination: Hashable {
    let tournamentId: String
    let season: String
    let name: String
    let nameEn: String?
    let logoUrl: String?

    init(tournamentId: String, season: String, name: String, nameEn: String?, logoUrl: String?) {
        self.tournamentId = tournamentId
        self.season = season
        self.name = name
        self.nameEn = nameEn
        self.logoUrl = logoUrl
    }

    init(_ tournament: CxTournament, season: String) {
        self.init(tournamentId: tournament.id, season: season, name: tournament.name, nameEn: tournament.nameEn, logoUrl: tournament.logoUrl)
    }

    @MainActor var tournament: CxTournament {
        CxTournament(id: tournamentId, name: name, nameEn: nameEn, slug: tournamentId,
                     colorHex: nil, logoUrl: logoUrl, pointsScheme: nil, seasonKey: season)
    }
}

/// Pantalla de cada `DeepLinkDestination`. La registran la pila de Hoy y la
/// de Ciclocross, que la sustituye mientras Hoy está retirada.
struct DeepLinkDestinationView: View {
    let destination: DeepLinkDestination

    var body: some View {
        switch destination {
        case .race(let raceId):
            RaceDetailView(raceId: raceId)
        case .stage(let raceDayId):
            StageDetailView(raceDayId: raceDayId)
        case .startlist(let raceId):
            StartlistView(raceId: raceId)
        case .startOrder(let raceDayId):
            StartOrderView(raceDayId: raceDayId)
        case .profile(let raceDayId):
            ProfileDestinationView(raceDayId: raceDayId)
        case .routeMap(let raceDayId):
            RouteMapDestinationView(raceDayId: raceDayId)
        case .settings:
            SettingsView()
                .onAppear { AnalyticsService.shared.logScreenView("settings") }
        case .championships:
            ChampionshipsView()
        case .results(let raceId, let stageNumber, let stageSuffix):
            ResultsView(raceId: raceId, initialStageNumber: stageNumber, initialStageSuffix: stageSuffix)
        }
    }
}

/// Vista principal con navegación por pestañas.
struct ContentView: View {
    /// Hoy de carretera visible (`RoadTodayAvailability`); se reevalúa al
    /// volver a primer plano.
    @State private var roadTodayVisible: Bool
    /// Con Hoy retirada, la pestaña Ciclocross muestra Hoy de carretera tras
    /// elegir «Ruta» en su conmutador. No se conserva entre aperturas.
    @State private var showsRoadToday = false
    @State private var selectedTab: Int
    @State private var navigationPath = NavigationPath()
    @State private var cxNavigationPath = NavigationPath()
    @State private var calendarNavigationPath = NavigationPath()
    @State private var deepLinkRevision = 0
    @State private var transfersTeamId: String?
    @State private var manager = NotificationManager.shared
    @State private var localeService = LocaleService.shared
    @State private var premium = PremiumService.shared
    @State private var contributionPrompt = ContributionPromptService.shared
    @State private var reviewPrompt = ReviewPromptService.shared
    @Environment(\.requestReview) private var requestReview
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let visible = RoadTodayAvailability.isVisible()
        _roadTodayVisible = State(initialValue: visible)
        _selectedTab = State(initialValue: RoadTodayAvailability.initialTab(todayVisible: visible))
    }

    var body: some View {
        // `value` identifica cada sección con independencia de su posición:
        // `DeepLink.tab(index)` apunta siempre a la misma pestaña.
        TabView(selection: $selectedTab) {
            ForEach(RoadTodayAvailability.tabs(todayVisible: roadTodayVisible), id: \.self) { value in
                tab(value)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            let visible = RoadTodayAvailability.isVisible()
            guard visible != roadTodayVisible else { return }
            roadTodayVisible = visible
            if !RoadTodayAvailability.tabs(todayVisible: visible).contains(selectedTab) {
                selectedTab = RoadTodayAvailability.initialTab(todayVisible: visible)
            }
        }
        .tint(Color("AccentColor"))
        .onChange(of: reviewPrompt.shouldRequest) { _, shouldRequest in
            guard shouldRequest else { return }
            reviewPrompt.markRequested()
            requestReview()
        }
        .onChange(of: selectedTab) { _, newTab in
            // La API `Tab` de iOS 18 no expone una acción de botón, así que
            // enganchamos el háptico al cambio del `selection`. Se dispara
            // tanto en taps del usuario como en cambios programáticos por
            // deep link, que también son eventos de navegación.
            Haptics.play(.navigation)
            // Analytics se loguean en cada vista individual (TodayView, MonthView, etc.)
            // con sus parámetros específicos.
        }
        .onChange(of: manager.pendingDeepLink) { _, newLink in
            guard let link = newLink else { return }
            manager.pendingDeepLink = nil
            handleDeepLink(link)
        }
        .sheet(isPresented: Binding(
            get: { premium.isSupportPresented },
            set: { if !$0 { premium.dismissSupport() } }
        )) {
            SupportView()
            .environment(\.locale, localeService.current.locale)
        }
        .alert(
            localeService.t("¿Te está sirviendo Calendario Ciclismo?", "Is Calendario Ciclismo useful to you?"),
            isPresented: Binding(
                get: { contributionPrompt.shouldPresent },
                set: { if !$0 && contributionPrompt.shouldPresent { contributionPrompt.deferPrompt() } }
            )
        ) {
            Button(localeService.t("Ver formas de apoyar", "View support options")) {
                contributionPrompt.openSupport()
                premium.presentSupport()
            }
            Button(localeService.t("Ahora no", "Not now"), role: .cancel) {
                contributionPrompt.deferPrompt()
            }
        } message: {
            Text(localeService.t(
                "Es un proyecto Open Source, independiente, gratuito y sin anuncios. Si te resulta útil, puedes ayudar a sostener sus servidores y mantenimiento.",
                "It is an independent Open Source project, free and ad-free. If it is useful to you, you can help sustain its servers and maintenance."
            ))
        }
    }

    @TabContentBuilder<Int>
    private func tab(_ value: Int) -> some TabContent<Int> {
        switch value {
        case RoadTodayAvailability.todayTab:
            Tab(localeService.t("Hoy", "Today"), systemImage: "calendar.day.timeline.leading", value: value) {
                NavigationStack(path: $navigationPath) {
                    TodayView(navigationPath: $navigationPath)
                        .navigationDestination(for: DeepLinkDestination.self) { DeepLinkDestinationView(destination: $0) }
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabToday)
        case RoadTodayAvailability.resultsTab:
            // Apps 3.1 (fase F3): el feed "Últimos resultados" entra como 2º
            // tab y Mes+Temporada se fusionan en "Calendario" (con toggle).
            Tab(localeService.t("Resultados", "Results"), systemImage: "trophy", value: value) {
                NavigationStack {
                    ResultsFeedView()
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabResults)
        case RoadTodayAvailability.transfersTab:
            Tab(localeService.t("Fichajes", "Transfers"), systemImage: "arrow.left.arrow.right", value: value) {
                NavigationStack {
                    TransfersView(deepLinkedTeamId: $transfersTeamId)
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabTransfers)
        case RoadTodayAvailability.cyclocrossTab:
            if roadTodayVisible {
                Tab(localeService.t("Ciclocross", "Cyclocross"), image: "CyclocrossEmblem", value: value) {
                    cyclocrossStack
                }
                .accessibilityIdentifier(AccessibilityID.tabCyclocross)
            } else {
                // Con Hoy retirada, la pestaña se rotula Hoy, con su icono:
                // alberga la agenda de Ciclocross y, desde el conmutador, Hoy
                // de carretera.
                Tab(localeService.t("Hoy", "Today"), systemImage: "calendar.day.timeline.leading", value: value) {
                    cyclocrossStack
                }
                .accessibilityIdentifier(AccessibilityID.tabCyclocross)
            }
        default:
            Tab(localeService.t("Calendario", "Calendar"), systemImage: "calendar", value: value) {
                NavigationStack(path: $calendarNavigationPath) {
                    CalendarTabView()
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabCalendar)
        }
    }

    private var cyclocrossStack: some View {
        NavigationStack(path: $cxNavigationPath) {
            cyclocrossRoot
                .navigationDestination(for: CxDestination.self) { destination in
                    CxRaceDetailView(raceId: destination.raceId, anchor: destination.anchor, titleHint: destination.title)
                }
                .navigationDestination(for: CxTournamentDestination.self) { destination in
                    CyclocrossView(tournament: destination.tournament, season: destination.season)
                }
                .navigationDestination(for: DeepLinkDestination.self) { DeepLinkDestinationView(destination: $0) }
        }
    }

    /// Raíz de la pestaña Ciclocross. Con Hoy retirada, la agenda CX lleva
    /// Ajustes y el conmutador «CX | Ruta» en su barra, que alterna con Hoy de
    /// carretera en la misma pila; esa pila recibe además los destinos de
    /// carretera de los deep links. El cintillo común (Ciclocross y después
    /// carretera) queda fijo sobre las dos vistas: alternar no lo recrea ni lo
    /// vuelve a cargar.
    @ViewBuilder
    private var cyclocrossRoot: some View {
        if roadTodayVisible {
            CyclocrossView()
        } else {
            VStack(spacing: 0) {
                TodayHighlightsBanner(
                    scope: "cx",
                    includesRoad: true,
                    onTapChampionships: { cxNavigationPath.append(DeepLinkDestination.championships) },
                    onOpenTarget: openHomeHighlight
                )
                    .padding(.top, 8)
                    .padding(.bottom, 10)
                if showsRoadToday {
                    TodayView(navigationPath: $cxNavigationPath, onSelectCyclocross: { showsRoadToday = false })
                } else {
                    CyclocrossView(showsSettings: true, onSelectRoad: { showsRoadToday = true })
                }
            }
            .background(AppTheme.background.ignoresSafeArea())
        }
    }

    /// Destino de una entrada del cintillo común, en la pila de la pestaña.
    private func openHomeHighlight(_ target: TodayHighlightTarget) {
        switch target {
        case .stage(let id): cxNavigationPath.append(DeepLinkDestination.stage(id))
        case .race(let id): cxNavigationPath.append(DeepLinkDestination.race(id))
        case .startlist(let id): cxNavigationPath.append(DeepLinkDestination.startlist(id))
        case .startOrder(let id): cxNavigationPath.append(DeepLinkDestination.startOrder(id))
        case .championships: cxNavigationPath.append(DeepLinkDestination.championships)
        case .transfers: NotificationManager.shared.pendingDeepLink = .tab(2)
        case .season(let year): NotificationManager.shared.pendingDeepLink = .season(year)
        case .cxRace(let id): NotificationManager.shared.pendingDeepLink = .cxRace(id, anchor: nil)
        case .cxTournament: break
        }
    }

    /// Abre un destino de carretera en la pila de Hoy o, mientras Hoy está
    /// retirada, en la de Ciclocross.
    private func openRoadDestination(_ destination: DeepLinkDestination) {
        if roadTodayVisible {
            selectedTab = RoadTodayAvailability.todayTab
            navigationPath = NavigationPath()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { navigationPath.append(destination) }
        } else {
            selectedTab = RoadTodayAvailability.cyclocrossTab
            cxNavigationPath = NavigationPath()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { cxNavigationPath.append(destination) }
        }
    }

    private func handleDeepLink(_ link: NotificationManager.DeepLink) {
        deepLinkRevision += 1
        let revision = deepLinkRevision
        switch link {
        case .tab(let index):
            navigationPath = NavigationPath()
            cxNavigationPath = NavigationPath()
            if RoadTodayAvailability.tabs(todayVisible: roadTodayVisible).contains(index) {
                selectedTab = index
            } else if (0..<5).contains(index) {
                // Hoy retirada: la pestaña inicial vigente.
                selectedTab = RoadTodayAvailability.initialTab(todayVisible: roadTodayVisible)
            } else {
                // Enlaces de pestañas retiradas → ajustes
                openRoadDestination(.settings)
            }
        case .race(let raceId):
            openRoadDestination(.race(raceId))
        case .stage(let raceDayId):
            openRoadDestination(.stage(raceDayId))
        case .startlist(let raceId):
            openRoadDestination(.startlist(raceId))
        case .startOrder(let raceDayId):
            openRoadDestination(.startOrder(raceDayId))
        case .profile(let raceDayId):
            openRoadDestination(.profile(raceDayId))
        case .routeMap(let raceDayId):
            openRoadDestination(.routeMap(raceDayId))
        case .results(let raceId, let stageNumber, let stageSuffix):
            openRoadDestination(.results(raceId, stageNumber, stageSuffix))
        case .cxRace(let raceId, let anchor):
            selectedTab = RoadTodayAvailability.cyclocrossTab
            cxNavigationPath = NavigationPath()
            DispatchQueue.main.async {
                guard deepLinkRevision == revision else { return }
                cxNavigationPath.append(CxDestination(raceId: raceId, anchor: anchor))
            }
        case .cxRaceSlug(let slug, let anchor):
            selectedTab = RoadTodayAvailability.cyclocrossTab
            cxNavigationPath = NavigationPath()
            Task {
                guard let id = try? await CyclocrossRepository.shared.raceId(forSlug: slug), deepLinkRevision == revision else { return }
                cxNavigationPath.append(CxDestination(raceId: id, anchor: anchor))
            }
        case .cxTournamentSlug(let slug):
            // Página de serie: se resuelve el slug a torneo; sin resolución,
            // la pestaña CX queda en su raíz.
            selectedTab = RoadTodayAvailability.cyclocrossTab
            cxNavigationPath = NavigationPath()
            Task {
                guard let tournament = await CyclocrossRepository.shared.tournament(forSlug: slug),
                      deepLinkRevision == revision else { return }
                let todayKey = CyclocrossAgendaModel.todayKey()
                let current = CxMonth(year: Int(todayKey.prefix(4))!, month: Int(todayKey.dropFirst(5).prefix(2))!)
                let name = LocaleService.shared.t(tournament.name, tournament.nameEn ?? tournament.name)
                cxNavigationPath.append(CxTournamentDestination(tournamentId: tournament.id,
                    season: tournament.seasonKey ?? current.season,
                    name: name, nameEn: tournament.nameEn, logoUrl: tournament.logoUrl))
            }
        case .season(let year):
            // La subvista y el año se fijan antes de mostrar la pestaña para
            // que Calendario abra ya en Temporada.
            calendarNavigationPath = NavigationPath()
            UserDefaults.standard.set("season", forKey: "calendar_subview")
            manager.pendingSeasonYear = year
            selectedTab = RoadTodayAvailability.calendarTab
        case .team(let teamId):
            navigationPath = NavigationPath()
            selectedTab = RoadTodayAvailability.transfersTab
            // La pila del Mercado pertenece a su propio NavigationStack. Se
            // entrega el ID en el siguiente ciclo para que la pestaña exista
            // antes de empujar su destino.
            DispatchQueue.main.async {
                transfersTeamId = teamId
            }
        }
    }
}
