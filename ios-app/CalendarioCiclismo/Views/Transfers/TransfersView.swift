import SwiftUI

/// Push por valor al detalle de equipo del mercado (regla iOS: navegación por
/// valor, nunca por destino — no corrompe el NavigationStack).
struct TransfersTeamRoute: Hashable, Identifiable {
    let teamId: String
    var id: String { teamId }
}

private enum TransfersFeed { case signings, renewals }

/// Filtro de las pulsaciones que abren un equipo del Mercado. Al bloquear la
/// pantalla con un dedo sobre la lista, iOS puede completar la pulsación de la
/// fila en vez de cancelarla, y al desbloquear aparecía un equipo abierto. La
/// acción se aplica tras un instante y solo si la app sigue activa y no acaba
/// de volver a primer plano.
@MainActor
enum ForegroundTap {
    private static let activationGrace: TimeInterval = 0.5
    private static var activatedAt = Date.distantPast

    static func sceneBecameActive() {
        activatedAt = Date()
    }

    static func perform(_ action: @escaping @MainActor @Sendable () -> Void) {
        guard isAccepting else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(80))
            guard isAccepting else { return }
            action()
        }
    }

    private static var isAccepting: Bool {
        UIApplication.shared.applicationState == .active
            && Date().timeIntervalSince(activatedAt) > activationGrace
    }
}

/// Pestaña "Fichajes" (apps 4.0) — mercado de la temporada 2027, espejo de
/// /fichajes/ web (`js/fichajes.js`) y de `TransfersScreen` (Android): paneles
/// de Fichajes y Renovaciones confirmados + botones de división (WT·PT·WWT·PRW)
/// + parrilla de equipos 2027 con las franjas de maillot de Resultados. Tocar
/// un equipo abre `TransfersTeamView` (continúan / llegan / se marchan).
///
/// En teléfono se ve un panel, elegido con los botones, con el corte corto del
/// feed; en pantallas anchas los dos paneles van en paralelo, con título y
/// lista de altura fija desplazable (corte largo).
///
/// Solo-online (sin caché), como resultados/inscritos. La lógica pura vive en
/// `TransfersLogic` (testeada); aquí solo carga + render.
struct TransfersView: View {
    @Binding var deepLinkedTeamId: String?
    @State private var data: TransfersLogic.MarketData?
    @State private var isLoading = true
    @State private var error: String?
    @State private var activeDivision = TransfersLogic.divisions[0]
    @State private var activeFeed = TransfersFeed.signings
    @State private var teamRoute: TransfersTeamRoute?
    @State private var localeService = LocaleService.shared
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    /// Altura fija de la lista de cada panel en pantallas anchas (22rem web).
    private static let feedHeight: CGFloat = 352

    private var title: String {
        localeService.t(
            "Mercado de Fichajes \(String(TransfersLogic.marketSeason))",
            "\(String(TransfersLogic.marketSeason)) Transfer Market"
        )
    }

    var body: some View {
        LoadingGate(isLoading: isLoading && data == nil, title: title) {
            if let error, data == nil {
                ErrorView(message: error) {
                    Task { await load() }
                }
            } else if let data {
                marketList(data)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(title)
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
        .navigationDestination(item: $teamRoute) { route in
            TransfersTeamView(teamId: route.teamId)
        }
        .task { await load() }
        .onAppear { openDeepLinkedTeamIfNeeded() }
        .onChange(of: deepLinkedTeamId) { _, _ in openDeepLinkedTeamIfNeeded() }
        .onAppear {
            AnalyticsService.shared.logScreenView("transfers")
        }
    }

    private func openDeepLinkedTeamIfNeeded() {
        guard let teamId = deepLinkedTeamId else { return }
        deepLinkedTeamId = nil
        teamRoute = TransfersTeamRoute(teamId: teamId)
    }

    private func openTeam(_ teamId: String) {
        ForegroundTap.perform {
            Haptics.play(.navigation)
            teamRoute = TransfersTeamRoute(teamId: teamId)
        }
    }

    private func load() async {
        if data == nil { isLoading = true }
        do {
            data = try await SupabaseService.shared.loadTransfersMarket(season: TransfersLogic.marketSeason)
            error = nil
        } catch {
            if data == nil {
                self.error = localeService.t(
                    "No se pudo cargar el mercado de fichajes.",
                    "Could not load the transfer market."
                )
            }
        }
        isLoading = false
    }

    // MARK: - Lista principal

    private func marketList(_ data: TransfersLogic.MarketData) -> some View {
        let wide = horizontalSizeClass == .regular
        let categoryByTeamId = Dictionary(uniqueKeysWithValues: data.seasons.compactMap { season in
            season.category.map { (season.teamId, $0) }
        })
        // Listas de altura fija con desplazamiento propio en todos los
        // tamaños: admiten el historial largo.
        func cut(_ feed: [RiderTransfer]) -> [RiderTransfer] {
            TransfersLogic.limitedFeed(
                feed,
                maxDays: TransfersLogic.feedScrollMaxDays,
                maxItems: TransfersLogic.feedScrollMaxItems
            )
        }
        let signingsFeed = cut(TransfersLogic.confirmedFeed(
            data.transfers, categoryByTeamId: categoryByTeamId, teamNameById: data.teamNameById
        ))
        let renewalsFeed = cut(TransfersLogic.renewalFeed(
            data.transfers, categoryByTeamId: categoryByTeamId, teamNameById: data.teamNameById
        ))
        let teams = TransfersLogic.divisionTeams(data.seasons, division: activeDivision)
        let signingsTitle = localeService.t("Fichajes", "Signings")
        let renewalsTitle = localeService.t("Renovaciones", "Renewals")

        // Un único scroll permite que el feed crezca y todos los equipos sigan accesibles.
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // ── Fichajes y Renovaciones ────────────────────────
                if wide {
                    HStack(alignment: .top, spacing: 24) {
                        feedPanel(title: signingsTitle, feed: signingsFeed, data: data)
                        feedPanel(title: renewalsTitle, feed: renewalsFeed, data: data)
                    }
                } else {
                    Picker(localeService.t("Movimientos", "Moves"), selection: $activeFeed) {
                        Text(signingsTitle).tag(TransfersFeed.signings)
                        Text(renewalsTitle).tag(TransfersFeed.renewals)
                    }
                    .pickerStyle(.segmented)
                    .padding(.bottom, 12)
                    feedPanel(
                        title: nil,
                        feed: activeFeed == .signings ? signingsFeed : renewalsFeed,
                        data: data
                    )
                }

                // ── Divisiones + equipos ───────────────────────────
                sectionTitle(localeService.t(
                    "Equipos \(String(TransfersLogic.marketSeason))",
                    "\(String(TransfersLogic.marketSeason)) Teams"
                ))
                Picker(localeService.t("División", "Division"), selection: $activeDivision) {
                    ForEach(TransfersLogic.divisions, id: \.self) { division in
                        Text(division).tag(division)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.bottom, 12)
                if teams.isEmpty {
                    emptyText(localeService.t("Sin equipos en esta división.", "No teams in this division."))
                } else {
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 150, maximum: 300), spacing: 10)],
                        spacing: 10
                    ) {
                        ForEach(teams, id: \.teamId) { season in
                            teamTile(season, prev: data.prevSeasonsByTeamId)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .background(AppTheme.background)
        .refreshable { await load() }
        .onChange(of: activeFeed) { _, _ in Haptics.play(.selection) }
        .onChange(of: activeDivision) { _, _ in Haptics.play(.selection) }
    }

    /// Panel de Fichajes o Renovaciones: superficie de tarjeta con filas
    /// separadas por filete y lista de altura fija con desplazamiento propio.
    /// En pantallas anchas lleva título.
    private func feedPanel(
        title: String?,
        feed: [RiderTransfer],
        data: TransfersLogic.MarketData
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                Text(title)
                    .ccFont(.s16, weight: .semibold)
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    .padding(.horizontal, 12)
                    .accessibilityAddTraits(.isHeader)
                Divider()
            }
            ScrollView {
                feedRows(feed, data: data)
            }
            .frame(height: Self.feedHeight)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .ccCardSurface()
    }

    @ViewBuilder
    private func feedRows(_ feed: [RiderTransfer], data: TransfersLogic.MarketData) -> some View {
        if feed.isEmpty {
            emptyText(localeService.t("Todavía no hay movimientos confirmados.", "No confirmed moves yet."))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(TransfersLogic.groupByDay(feed), id: \.day) { group in
                    Text(DateFormatting.formatDateWeekdayNoYear(group.day))
                        .ccFont(.s13, weight: .semibold)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.top, 10)
                        .padding(.bottom, 4)
                    ForEach(group.moves) { move in
                        TransferFeedRowView(transfer: move, data: data) { teamId in
                            openTeam(teamId)
                        }
                        Divider()
                    }
                }
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .ccFont(.s16, weight: .semibold)
            .foregroundStyle(.primary)
            .padding(.top, 28)
            .padding(.bottom, 10)
            .accessibilityAddTraits(.isHeader)
    }

    private func emptyText(_ text: String) -> some View {
        Text(text)
            .ccFont(.s14)
            .foregroundStyle(.secondary)
            .padding(.vertical, 4)
    }

    /// Tarjeta de equipo: superficie neutra con las franjas de maillot de
    /// Resultados delante del nombre (colores del mercado si están publicados;
    /// si no, los de la temporada anterior).
    private func teamTile(_ season: TeamSeason, prev: [String: TeamSeason]) -> some View {
        Button {
            openTeam(season.teamId)
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .center, spacing: 6) {
                        if let team = TransfersLogic.stripesTeam(for: season, prev: prev) {
                            TeamColorBands(team: team, width: 14, height: 15)
                        }
                        Text(season.name ?? "")
                            .ccFont(.s14, weight: .semibold)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                    }
                    if season.continuityDoubt == true {
                        DoubtBadge(text: localeService.t("En duda", "TBC"))
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .ccCardSurface()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Fila del feed

/// Fila del feed: bandera + "Corredor → Destino" + año de contrato o
/// «M. temporada» como texto gris. Sin superficie propia: va dentro del panel.
struct TransferFeedRowView: View {
    let transfer: RiderTransfer
    let data: TransfersLogic.MarketData
    let onLinkTeam: (String) -> Void

    private var localeService: LocaleService { LocaleService.shared }

    var body: some View {
        if let teamId = linkTeamId {
            Button { onLinkTeam(teamId) } label: { row.contentShape(Rectangle()) }
                .buttonStyle(.plain)
        } else {
            row
        }
    }

    private var linkTeamId: String? {
        guard let teamId = transfer.toTeamId,
              data.seasons.contains(where: { $0.teamId == teamId }) else { return nil }
        return teamId
    }

    private var row: some View {
        let unknownTeam = localeService.t("Por confirmar", "To be confirmed")
        let rider = data.ridersById[transfer.riderId]
        return HStack(spacing: 8) {
            CountryFlag(countryCode: rider?.nationality, width: 15)
            // Corredor + movimiento trunca con "…" a una línea; el año de
            // contrato (o el marcador de mitad de temporada) queda fijo a la derecha.
            Text(moveText(rider: rider, unknownTeam: unknownTeam))
                .ccFont(.s14)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 4)
            if transfer.midSeason {
                MidSeasonBadge()
            } else if let contractUntil = transfer.contractUntil {
                YearBadge(year: contractUntil)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func moveText(rider: TransferRider?, unknownTeam: String) -> AttributedString {
        var name = AttributedString(rider.map { $0.fullName.isEmpty ? transfer.riderId : $0.fullName } ?? transfer.riderId)
        name.inlinePresentationIntent = .stronglyEmphasized
        var out = name
        switch transfer.type {
        case "renewal":
            // La renovación no lleva flecha: separar siempre el nombre del texto.
            out += AttributedString(" " + localeService.t("renueva con", "renews with") + " ")
            out += AttributedString(TransfersLogic.teamLabel(
                teamId: transfer.toTeamId, freeText: transfer.toTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam))
        case "retirement":
            out += AttributedString(" " + localeService.t("se retira", "retires") + " ")
            var origin = AttributedString("(" + TransfersLogic.teamLabel(
                teamId: transfer.fromTeamId, freeText: transfer.fromTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam,
                side: .from, namesPrev: data.teamNamePrev) + ")")
            origin.foregroundColor = .secondary
            out += origin
        default:
            // Por falta de espacio en el feed móvil solo se muestra el equipo de
            // DESTINO (a dónde va), no el de origen. La flecha ya separa el nombre
            // del destino. El destino NO va en negrita: el nombre del corredor
            // ya lo está. Decisión Dani 2026-07-20.
            var arrow = AttributedString(" → ")
            arrow.foregroundColor = .secondary
            out += arrow
            out += AttributedString(TransfersLogic.teamLabel(
                teamId: transfer.toTeamId, freeText: transfer.toTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam))
        }
        return out
    }
}
