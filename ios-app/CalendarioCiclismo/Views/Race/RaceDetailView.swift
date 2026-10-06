import SwiftUI

/// Vista de detalle de una carrera — equivalente a `competicion.html` + `competicion.js`.
struct RaceDetailView: View {
    let raceId: String

    @State private var viewModel = RaceDetailViewModel()
    @State private var showStartlist = false
    @State private var safariURL: URL?
    @State private var manager = NotificationManager.shared
    @State private var raceFollow = RaceFollowService.shared
    /// Jornadas con resultados in-house (raceDayId → stageNumber): el trofeo de
    /// esas etapas navega a la pantalla nativa de clasificaciones. Diferido y no
    /// bloqueante. Pasa las jornadas para resolver el caso de un día/general
    /// (stage sin raceDayId).
    @State private var inhouseByDay: [String: Int?] = [:]
    /// Push programático (por valor) a la pantalla de resultados in-house.
    @State private var resultsRoute: ResultsRoute?

    var body: some View {
        Group {
            if viewModel.isLoading || (viewModel.race == nil && viewModel.error == nil) {
                LoadingView()
            } else if let error = viewModel.error {
                ErrorView(message: error) {
                    Task { await viewModel.load(raceId: raceId) }
                }
            } else if let race = viewModel.race {
                ScrollView {
                    VStack(spacing: 0) {
                        raceHeader(race)
                        raceDocumentationSection(race: race)

                        if viewModel.days.isEmpty {
                            EmptyStateView(
                                icon: "list.bullet",
                                title: "Sin etapas publicadas",
                                subtitle: "Las etapas se irán publicando próximamente"
                            )
                            .frame(height: 200)
                        } else {
                            stagesList(race: race)
                        }
                    }
                }
                .sheet(isPresented: $showStartlist) {
                    NavigationStack {
                        StartlistView(raceId: race.id, showDismissButton: true)
                    }
                }
                .safariSheet(url: $safariURL)
                // Push por valor a la pantalla de resultados in-house (trofeo).
                .navigationDestination(item: $resultsRoute) { route in
                    ResultsView(raceId: route.raceId, initialStageNumber: route.stageNumber, initialStageSuffix: route.stageSuffix)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(viewModel.race?.name ?? "Carrera")
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load(raceId: raceId) }
        // Mapa de jornadas con resultados in-house, diferido tras la carga.
        .task(id: viewModel.days.map(\.id).joined(separator: ",")) {
            let days = viewModel.days.map { ($0.raceDay.id, $0.raceDay.stageNumber) }
            guard !days.isEmpty else {
                inhouseByDay = [:]
                return
            }
            let cancelled = Set(viewModel.days.filter { $0.raceDay.isCancelledDay }.map { $0.raceDay.id })
            inhouseByDay = await SupabaseService.shared.inhouseStagesForDays(
                raceId: raceId, days: days, cancelledDayIds: cancelled
            )
        }
        .onChange(of: viewModel.race) { _, newRace in
            if let race = newRace {
                AnalyticsService.shared.logScreenView("race_detail", parameters: [
                    "race_id": raceId,
                    "race_name": race.name,
                ])
            }
        }
    }

    // MARK: - Stages list

    @ViewBuilder
    private func stagesList(race: Race) -> some View {
        LazyVStack(spacing: 8) {
            ForEach(viewModel.days) { day in
                stageRow(day: day, race: race)
            }
        }
        .padding(.horizontal)
        // Separa la primera tarjeta de etapa del encabezado
        // (logo + datos + botones de documentación).
        .padding(.top, 14)
    }

    @ViewBuilder
    private func stageRow(day: EnrichedRaceDay, race: Race) -> some View {
        // Resultados/Revive solo si esta jornada tiene clasificación propia: el
        // trofeo va a la pantalla nativa.
        let hasInhouse = inhouseByDay.index(forKey: day.id) != nil
        let inhouseStage = inhouseByDay[day.id].flatMap { $0 }
        let showResults = hasInhouse
        // Revive/TV solo acompaña al acceso a Resultados; la hora de meta por sí
        // sola no activa el botón en la vista de Competición.
        let reviveURL = showResults ? RaceLogic.reviveUrl(from: day.broadcasts) : nil
        let row = StageRowView(
            item: day,
            race: race,
            onShowResults: showResults ? {
                Haptics.play(.primaryAction)
                resultsRoute = ResultsRoute(raceId: race.id, stageNumber: inhouseStage, stageSuffix: day.raceDay.stageSuffix)
            } : nil,
            onRevive: reviveURL != nil ? {
                Haptics.play(.primaryAction)
                if let url = reviveURL {
                    NativeAppLinkOpener.openIfInstalled(url) { safariURL = url }
                }
            } : nil
        )
        // La jornada cancelada SÍ navega a su ficha (paridad con la web y
        // Android): conserva recorrido, perfil y documentación. La de DESCANSO
        // no: no tiene ficha que abrir.
        if day.raceDay.isRestDay {
            row
        } else {
            NavigationLink(destination: StageDetailView(raceDayId: day.raceDay.id)) {
                row
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Header

    @ViewBuilder
    private func raceHeader(_ race: Race) -> some View {
        VStack(spacing: 12) {
            RaceCompetitionIdentity(name: race.localizedName, logoUrl: race.logoUrl, countryCode: race.countryCode,
                hideFlag: race.hideFlag == true, originalName: race.originalName.flatMap { $0 != race.name ? $0 : nil },
                showFemale: RaceLogic.shouldShowFemaleIndicator(race))

            HStack(spacing: 8) {
                CategoryBadge(category: race.uciCategory)

                if race.isStageRace {
                    Text("\(viewModel.stageCount) etapas")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if !viewModel.dateRange.isEmpty {
                        Text("·")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                    }
                }

                Text(viewModel.dateRange)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()
            }

            if race.isCancelled {
                HStack {
                    Image(systemName: "xmark.circle.fill")
                        .accessibilityHidden(true)
                    Text("Carrera cancelada")
                }
                .font(.subheadline)
                .foregroundStyle(AppTheme.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Carrera cancelada")
            }
        }
        .padding()
        .background(AppTheme.cardBackground)
    }

    // MARK: - Documentation chips

    @ViewBuilder
    private func raceDocumentationSection(race: Race) -> some View {
        let hasWebsite = race.websiteUrl != nil
        let hasStartlist = race.startlistImportedAt != nil
        let technicalGuide = viewModel.days.lazy.flatMap(\.assets)
            .first { $0.type == "technicalGuide" && !($0.url ?? "").isEmpty }
        // Debe permanecer disponible antes de activar permisos, igual que en
        // la ficha de jornada y en Android.
        let showNotifications = true
        if hasWebsite || technicalGuide != nil || hasStartlist || showNotifications {
            Divider()
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(spacing: 0) {
                    if let urlStr = race.websiteUrl, let url = URL(string: urlStr) {
                        raceDocChip(icon: "globe", label: LocaleService.t("Sitio web", "Website")) {
                            safariURL = url
                        }
                    }
                    if let guide = technicalGuide, let urlStr = guide.url, let url = URL(string: urlStr) {
                        raceDocChip(icon: "doc.text", label: guide.typeLabel) { safariURL = url }
                    }
                    if hasStartlist {
                        let startlistLabel: String = {
                            if race.startlistProvisional == true {
                                return LocaleService.t("Lista provisional", "Provisional Startlist")
                            }
                            return LocaleService.t("Dorsales", "Startlist")
                        }()
                        raceDocChip(
                            icon: "person.2",
                            label: startlistLabel
                        ) {
                            showStartlist = true
                        }
                    }
                    if showNotifications {
                        RaceNotificationChip(raceId: race.id)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
            }
            .background(AppTheme.cardBackground)
        }
    }

    private func raceDocChip(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ActionStripTile(icon: icon, label: label)
        }
        .accessibilityLabel(label)
    }
}

// MARK: - RaceNotificationChip

/// Chip de notificaciones por carrera. Visible a todos los usuarios:
/// - followAll → alert para cambiar a followRaces.
/// - followRaces → toggle inmediato.
private struct RaceNotificationChip: View {
    let raceId: String

    @State private var raceFollow = RaceFollowService.shared
    @State private var showModeAlert = false

    private var isFollowing: Bool { raceFollow.isFollowing(raceId) }

    var body: some View {
        Button {
            handleTap()
        } label: {
            ActionStripTile(
                icon: isFollowing ? "bell.fill" : "bell",
                label: LocaleService.t("Notificaciones", "Notifications"),
                showsTrailingSeparator: false
            )
        }
        .accessibilityLabel(LocaleService.t("Notificaciones de esta carrera", "Race notifications"))
        .accessibilityValue(isFollowing
            ? LocaleService.t("Activas", "Active")
            : LocaleService.t("Inactivas", "Inactive"))
        .alert(
            LocaleService.t("Modo de notificaciones", "Notification mode"),
            isPresented: $showModeAlert
        ) {
            Button(LocaleService.t("Solo esta carrera", "Only this race")) {
                raceFollow.setFollowing(raceId, following: true)
                Haptics.play(.success)
            }
            Button(LocaleService.t("Seguir recibiendo todas", "Keep receiving all"), role: .cancel) {}
        } message: {
            Text(LocaleService.t(
                "Ahora recibes notificaciones de todas las carreras. ¿Quieres cambiar a recibir solo de esta?",
                "You're currently receiving notifications for all races. Switch to only this race?"
            ))
        }
    }

    private func handleTap() {
        Haptics.play(.selection)
        switch raceFollow.followMode {
        case .followAll:
            showModeAlert = true
        case .followRaces:
            raceFollow.setFollowing(raceId, following: !isFollowing)
        case .followFilters:
            raceFollow.setFollowing(raceId, following: !isFollowing)
        }
    }
}
