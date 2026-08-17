import SwiftUI

/// Destinos de navegación programática vía deep link.
enum DeepLinkDestination: Hashable {
    case race(String)      // raceId
    case stage(String)     // raceDayId
    case startlist(String) // raceId → vista de inscritos
    case startOrder(String) // raceDayId → orden de salida
    case profile(String)    // raceDayId → perfil de elevación de la jornada
    case routeMap(String)   // raceDayId → mapa del recorrido de la jornada
    case settings          // pantalla de ajustes
}

/// Vista principal con navegación por pestañas.
struct ContentView: View {
    @State private var selectedTab = 0
    @State private var navigationPath = NavigationPath()
    @State private var transfersTeamId: String?
    @State private var manager = NotificationManager.shared
    @State private var localeService = LocaleService.shared
    @State private var premium = PremiumService.shared
    @State private var contributionPrompt = ContributionPromptService.shared

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

            // Apps 4.0: Fichajes entra como 3er tab (mercado 2027) y Buscar se
            // retira (archivado en archive/buscador-apps-2026/). Calendario
            // pasa a value 3 — el tabMap de NotificationManager va en sincronía.
            Tab(localeService.t("Fichajes", "Transfers"), systemImage: "arrow.left.arrow.right", value: 2) {
                NavigationStack {
                    TransfersView(deepLinkedTeamId: $transfersTeamId)
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabTransfers)

            Tab(localeService.t("Calendario", "Calendar"), systemImage: "calendar", value: 3) {
                NavigationStack {
                    CalendarTabView()
                }
            }
            .accessibilityIdentifier(AccessibilityID.tabCalendar)
        }
        .tint(Color("AccentColor"))
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
        switch link {
        case .tab(let index):
            navigationPath = NavigationPath()
            if index < 4 {
                selectedTab = index
            } else {
                // Tabs eliminados (subscribe=4, notifications=5) → abrir ajustes
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
