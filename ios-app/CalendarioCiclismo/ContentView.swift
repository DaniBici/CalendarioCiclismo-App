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

    @MainActor var tournament: CxTournament {
        CxTournament(id: tournamentId, name: name, nameEn: nameEn, slug: tournamentId,
                     colorHex: nil, logoUrl: logoUrl, pointsScheme: nil, seasonKey: season)
    }
}

/// Vista principal con navegación por pestañas.
struct ContentView: View {
    @State private var selectedTab = 0
    @State private var navigationPath = NavigationPath()
    @State private var cxNavigationPath = NavigationPath()
    @State private var deepLinkRevision = 0
    @State private var transfersTeamId: String?
    @State private var manager = NotificationManager.shared
    @State private var localeService = LocaleService.shared
    @State private var premium = PremiumService.shared
    @State private var contributionPrompt = ContributionPromptService.shared
    @State private var reviewPrompt = ReviewPromptService.shared
    @Environment(\.requestReview) private var requestReview

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab(localeService.t("Hoy", "Today"), systemImage: "calendar.day.timeline.leading", value: 0) {
                NavigationStack(path: $navigationPath) {
                    TodayView(navigationPath: $navigationPath)
                        .navigationDestination(for: DeepLinkDestination.self) { dest in
                            switch dest {
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
                            case .results(let raceId, let stageNumber, let stageSuffix):
                                ResultsView(raceId: raceId, initialStageNumber: stageNumber, initialStageSuffix: stageSuffix)
                            }
                        }
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabToday)

            // Apps 3.1 (fase F3): el feed "Últimos resultados" entra como 2º
            // tab y Mes+Temporada se fusionan en "Calendario" (con toggle).
            Tab(localeService.t("Resultados", "Results"), systemImage: "trophy", value: 1) {
                NavigationStack {
                    ResultsFeedView()
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabResults)

            // Los índices coinciden con NotificationManager.DeepLink.
            Tab(localeService.t("Fichajes", "Transfers"), systemImage: "arrow.left.arrow.right", value: 2) {
                NavigationStack {
                    TransfersView(deepLinkedTeamId: $transfersTeamId)
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabTransfers)

            Tab(localeService.t("Ciclocross", "Cyclocross"), image: "CyclocrossEmblem", value: 3) {
                NavigationStack(path: $cxNavigationPath) {
                    CyclocrossView()
                        .navigationDestination(for: CxDestination.self) { destination in
                            CxRaceDetailView(raceId: destination.raceId, anchor: destination.anchor)
                        }
                        .navigationDestination(for: CxTournamentDestination.self) { destination in
                            CyclocrossView(tournament: destination.tournament, season: destination.season)
                        }
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabCyclocross)

            Tab(localeService.t("Calendario", "Calendar"), systemImage: "calendar", value: 4) {
                NavigationStack {
                    CalendarTabView()
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabCalendar)
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
            get: { premium.pendingPaywallSource != nil },
            set: { if !$0 { premium.dismissPaywall() } }
        )) {
            PaywallView(source: premium.pendingPaywallSource ?? .general)
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
                premium.presentPaywall(.general)
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

    private func handleDeepLink(_ link: NotificationManager.DeepLink) {
        deepLinkRevision += 1
        let revision = deepLinkRevision
        switch link {
        case .tab(let index):
            navigationPath = NavigationPath()
            cxNavigationPath = NavigationPath()
            if (0..<5).contains(index) {
                selectedTab = index
            } else {
                // Enlaces de pestañas retiradas → ajustes
                selectedTab = 0
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    navigationPath.append(DeepLinkDestination.settings)
                }
            }
        case .race(let raceId):
            selectedTab = 0
            navigationPath = NavigationPath()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                navigationPath.append(DeepLinkDestination.race(raceId))
            }
        case .stage(let raceDayId):
            selectedTab = 0
            navigationPath = NavigationPath()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                navigationPath.append(DeepLinkDestination.stage(raceDayId))
            }
        case .startlist(let raceId):
            selectedTab = 0
            navigationPath = NavigationPath()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                navigationPath.append(DeepLinkDestination.startlist(raceId))
            }
        case .startOrder(let raceDayId):
            selectedTab = 0
            navigationPath = NavigationPath()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                navigationPath.append(DeepLinkDestination.startOrder(raceDayId))
            }
        case .profile(let raceDayId):
            selectedTab = 0
            navigationPath = NavigationPath()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                navigationPath.append(DeepLinkDestination.profile(raceDayId))
            }
        case .routeMap(let raceDayId):
            selectedTab = 0
            navigationPath = NavigationPath()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                navigationPath.append(DeepLinkDestination.routeMap(raceDayId))
            }
        case .results(let raceId, let stageNumber, let stageSuffix):
            selectedTab = 0
            navigationPath = NavigationPath()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                navigationPath.append(DeepLinkDestination.results(raceId, stageNumber, stageSuffix))
            }
        case .cxRace(let raceId, let anchor):
            selectedTab = 3
            cxNavigationPath = NavigationPath()
            DispatchQueue.main.async {
                guard deepLinkRevision == revision else { return }
                cxNavigationPath.append(CxDestination(raceId: raceId, anchor: anchor))
            }
        case .cxRaceSlug(let slug, let anchor):
            selectedTab = 3
            cxNavigationPath = NavigationPath()
            Task {
                guard let id = try? await CyclocrossRepository.shared.raceId(forSlug: slug), deepLinkRevision == revision else { return }
                cxNavigationPath.append(CxDestination(raceId: id, anchor: anchor))
            }
        case .cxTournamentSlug(let slug):
            // Página de serie: se resuelve el slug a torneo; sin resolución,
            // la pestaña CX queda en su raíz.
            selectedTab = 3
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
        case .team(let teamId):
            navigationPath = NavigationPath()
            selectedTab = 2
            // La pila del Mercado pertenece a su propio NavigationStack. Se
            // entrega el ID en el siguiente ciclo para que la pestaña exista
            // antes de empujar su destino.
            DispatchQueue.main.async {
                transfersTeamId = teamId
            }
        }
    }
}
