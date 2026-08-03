import SwiftUI

/// Push por valor al detalle de equipo del mercado (regla iOS: navegación por
/// valor, nunca por destino — no corrompe el NavigationStack).
struct TransfersTeamRoute: Hashable, Identifiable {
    let teamId: String
    var id: String { teamId }
}

private enum TransfersFeed { case signings, renewals }

/// Pestaña "Fichajes" (apps 4.0) — mercado de la temporada 2027, espejo de
/// /fichajes/ web (`js/fichajes.js`) y de `TransfersScreen` (Android): feed
/// cronológico inverso de CONFIRMACIONES + botones de división (WT·PT·WWT·PRW)
/// + parrilla de equipos 2027 (team_seasons; chapa solo si badgeVisible). Tocar
/// un equipo abre `TransfersTeamView` (continúan / llegan / se marchan).
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
    @State private var isShowingInfo = false
    @State private var localeService = LocaleService.shared

    var body: some View {
        Group {
            if isLoading && data == nil {
                LoadingView(
                    message: localeService.t("Cargando Mercado de Fichajes...", "Loading transfer market..."),
                    branded: true
                )
            } else if let error, data == nil {
                ErrorView(message: error) {
                    Task { await load() }
                }
            } else if let data {
                marketList(data)
            }
        }
        .navigationTitle(localeService.t(
            "Mercado de Fichajes \(String(TransfersLogic.marketSeason))",
            "\(String(TransfersLogic.marketSeason)) Transfer Market"
        ))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Haptics.play(.selection)
                    isShowingInfo = true
                } label: {
                    Image(systemName: "info.circle")
                }
                .accessibilityLabel(localeService.t("Información sobre los fichajes", "Transfer information"))
            }
        }
        .sheet(isPresented: $isShowingInfo) {
            TransfersInfoSheet(localeService: localeService)
                .presentationDetents([.medium, .large])
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
        let baseFeed = activeFeed == .signings
            ? TransfersLogic.confirmedFeed(data.transfers)
            : TransfersLogic.renewalFeed(data.transfers)
        let feed = TransfersLogic.limitedFeed(baseFeed)
        let feedByDay = TransfersLogic.groupByDay(feed)
        let teams = TransfersLogic.divisionTeams(data.seasons, division: activeDivision)

        // Un único scroll permite que el feed crezca y todos los equipos sigan accesibles.
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                // ── Panel 1: feed de confirmaciones ────────────────
                VStack(alignment: .leading, spacing: 0) {
                    // Primer título: pegado a la barra de navegación → menos top
                    // que el de "Equipos" (que sí separa del feed de arriba).
                    sectionTitle(localeService.t("Últimas confirmaciones", "Latest confirmations"), topPadding: 4)
                    HStack(spacing: 8) {
                        feedChip(
                            localeService.t("Fichajes", "Signings"),
                            selected: activeFeed == .signings
                        ) { activeFeed = .signings }
                        feedChip(
                            localeService.t("Renovaciones", "Renewals"),
                            selected: activeFeed == .renewals
                        ) { activeFeed = .renewals }
                    }
                    .padding(.top, 6)
                    .padding(.bottom, 8)
                    LazyVStack(alignment: .leading, spacing: 8) {
                            if feed.isEmpty {
                                emptyText(localeService.t("Todavía no hay movimientos confirmados.", "No confirmed moves yet."))
                            } else {
                                ForEach(feedByDay, id: \.day) { group in
                                    Text(DateFormatting.formatDateWeekdayNoYear(group.day))
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                        .foregroundStyle(.secondary)
                                        .padding(.top, 8)
                                    ForEach(group.moves) { move in
                                        TransferFeedRowView(transfer: move, data: data) { teamId in
                                            Haptics.play(.navigation)
                                            teamRoute = TransfersTeamRoute(teamId: teamId)
                                        }
                                    }
                                }
                            }
                    }
                    .padding(.bottom, 8)
                }
                Divider().padding(.top, 8)

                // ── Panel 2: divisiones + equipos ──────────────────
                VStack(alignment: .leading, spacing: 0) {
                    sectionTitle(localeService.t(
                        "Equipos \(String(TransfersLogic.marketSeason))",
                        "\(String(TransfersLogic.marketSeason)) Teams"
                    ))
                    .padding(.bottom, 8)
                    HStack(spacing: 8) {
                        ForEach(TransfersLogic.divisions, id: \.self) { div in
                            divisionChip(div)
                        }
                    }
                    .padding(.bottom, 12)
                    if teams.isEmpty {
                        emptyText(localeService.t("Sin equipos en esta división.", "No teams in this division."))
                    } else {
                        LazyVGrid(
                            columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4),
                            spacing: 8
                        ) {
                            ForEach(teams, id: \.teamId) { season in
                                teamTile(season, prev: data.prevSeasonsByTeamId)
                            }
                        }
                    }
                }
                .padding(.bottom, 12)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .refreshable { await load() }
    }

    private func sectionTitle(_ text: String, topPadding: CGFloat = 16) -> some View {
        Text(text.uppercased())
            .font(.caption)
            .fontWeight(.bold)
            .kerning(0.8)
            .foregroundStyle(.secondary)
            .padding(.top, topPadding)
    }

    private func emptyText(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.vertical, 4)
    }

    /// Píldora de división — mismo tamaño que los filtros de categoría de la
    /// vista Hoy (`TodayFilterChip`): caption + padding 12/6 + Capsule. Activo =
    /// relleno accent-dim + texto accent.
    private func divisionChip(_ division: String) -> some View {
        let selected = division == activeDivision
        return marketChip(division, selected: selected) {
            Haptics.play(.selection)
            activeDivision = division
        }
    }

    private func feedChip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        marketChip(label, selected: selected) {
            Haptics.play(.selection)
            action()
        }
    }

    private func marketChip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            action()
        } label: {
            Text(label)
                .font(.caption)
                .fontWeight(selected ? .semibold : .regular)
                .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    Capsule().fill(
                        selected
                            ? Color.accentColor.opacity(0.15)
                            : Color(.secondarySystemBackground)
                    )
                )
        }
        .buttonStyle(.plain)
    }

    private func teamTile(_ season: TeamSeason, prev: [String: TeamSeason]) -> some View {
        Button {
            Haptics.play(.navigation)
            teamRoute = TransfersTeamRoute(teamId: season.teamId)
        } label: {
            CCCard {
                VStack(spacing: 5) {
                    // Sin chapa no se monta la vista para no dejar un hueco.
                    if let badge = TransfersLogic.badgeSeason(for: season, prev: prev) {
                        TransfersSeasonBadge(season: badge, size: 32)
                    }
                    if season.continuityDoubt == true {
                        VStack(spacing: 0) {
                            teamTileName(season.name ?? "", reservesSpace: false)
                            DoubtBadge(text: localeService.t("En duda", "TBC"))
                        }
                    } else {
                        teamTileName(season.name ?? "")
                    }
                }
                .frame(
                    minWidth: nil, idealWidth: nil, maxWidth: .infinity,
                    minHeight: 92, idealHeight: 92, maxHeight: 92,
                    alignment: .center
                )
                .padding(6)
            }
        }
        .buttonStyle(.plain)
    }

    private func teamTileName(_ name: String, reservesSpace: Bool = true) -> some View {
        Text(name)
            .font(.caption2)
            .foregroundStyle(.primary)
            .lineLimit(2, reservesSpace: reservesSpace)
            .truncationMode(.tail)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
    }
}

private struct TransfersInfoSheet: View {
    let localeService: LocaleService

    private let sources = [
        ("Nacho Labarga", "MARCA", "https://x.com/nacholabarga"),
        ("Dani Miranda", "AS", "https://x.com/danimiranda9"),
        ("Ciro Scognamiglio", "La Gazzetta dello Sport", "https://x.com/cirogazzetta"),
        ("Youri IJnsen", "WielerFlits", "https://x.com/Youri_IJnsen"),
        ("James Odvart", "DirectVelo", "https://x.com/OdvartJames"),
        ("Daniel Benson", "", "https://x.com/dnlbenson"),
        ("Bram Vandecapelle", "Het Laatste Nieuws", "https://x.com/bvdecape"),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(localeService.t(
                        "La información del mercado de fichajes —altas, bajas y renovaciones— se contrasta con los anuncios de los equipos y con el trabajo de periodistas especializados que siguen y adelantan los movimientos temporada a temporada. Agradecemos especialmente el seguimiento de:",
                        "Transfer market information — signings, departures and renewals — is cross-checked against the teams’ official announcements and the work of specialist journalists who track and break the moves season after season. We especially thank:"
                    ))

                    ForEach(sources, id: \.0) { source in
                        let (name, outlet, url) = source
                        HStack(spacing: 0) {
                            Link(name, destination: URL(string: url)!)
                                .fontWeight(.semibold)
                            if !outlet.isEmpty {
                                Text(" (\(outlet))")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .navigationTitle(localeService.t("Fuentes de Fichajes", "Transfer sources"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

// MARK: - Fila del feed

/// Fila del feed: bandera + "Corredor  Origen → Destino" + "hasta YYYY".
struct TransferFeedRowView: View {
    let transfer: RiderTransfer
    let data: TransfersLogic.MarketData
    let onLinkTeam: (String) -> Void

    private var localeService: LocaleService { LocaleService.shared }

    var body: some View {
        if let teamId = linkTeamId {
            Button { onLinkTeam(teamId) } label: { rowCard }
                .buttonStyle(.plain)
        } else {
            rowCard
        }
    }

    private var linkTeamId: String? {
        guard let teamId = transfer.toTeamId,
              data.seasons.contains(where: { $0.teamId == teamId }) else { return nil }
        return teamId
    }

    private var rowCard: some View {
        let unknownTeam = localeService.t("Por confirmar", "To be confirmed")
        let rider = data.ridersById[transfer.riderId]
        return CCCard {
            HStack(spacing: 8) {
                CountryFlag(countryCode: rider?.nationality, width: 15)
                // Corredor + movimiento trunca con "…" a una línea; el año de
                // contrato (o el marcador de mitad de temporada) queda fijo a la derecha.
                Text(moveText(rider: rider, unknownTeam: unknownTeam))
                    .font(.footnote)
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
        }
    }

    private func moveText(rider: TransferRider?, unknownTeam: String) -> AttributedString {
        var name = AttributedString(rider.map { $0.fullName.isEmpty ? transfer.riderId : $0.fullName } ?? transfer.riderId)
        name.font = .footnote.weight(.semibold)
        var out = name
        // Divisor atenuado del nombre solo cuando el movimiento no empieza con
        // flecha (renovación / retirada). En un fichaje la "→" ya separa.
        func appendSeparator() {
            var sep = AttributedString("  ·  ")
            sep.foregroundColor = .secondary
            out += sep
        }
        switch transfer.type {
        case "renewal":
            // La renovación no lleva flecha: separar siempre el nombre del texto.
            out += AttributedString(" ")
            out += AttributedString(localeService.t("renueva con", "renews with") + " ")
            out += AttributedString(TransfersLogic.teamLabel(
                teamId: transfer.toTeamId, freeText: transfer.toTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam))
        case "retirement":
            appendSeparator()
            out += AttributedString(localeService.t("se retira", "retires") + " (")
            out += AttributedString(TransfersLogic.teamLabel(
                teamId: transfer.fromTeamId, freeText: transfer.fromTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam,
                side: .from, namesPrev: data.teamNamePrev))
            out += AttributedString(")")
        default:
            // Por falta de espacio en el feed móvil solo se muestra el equipo de
            // DESTINO (a dónde va), no el de origen. La flecha ya separa el nombre
            // del destino → sin divisor "·". El destino NO va en negrita: el nombre
            // del corredor ya lo está. Decisión Dani 2026-07-20.
            var arrow = AttributedString("  →  ")
            arrow.foregroundColor = .secondary
            out += arrow
            out += AttributedString(TransfersLogic.teamLabel(
                teamId: transfer.toTeamId, freeText: transfer.toTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam))
        }
        return out
    }
}

// MARK: - Chapa de temporada

/// Chapa de un equipo del mercado. Se le pasa la fila (del mercado o la
/// anterior) cuyos colores hay que pintar; la decisión de CUÁL —o si no hay
/// chapa— vive en `TransfersLogic.badgeSeason(for:prev:)`: colores del mercado
/// publicados → 2027; sin publicar pero equipo preexistente → colores antiguos
/// (2026); equipo nuevo → nada. Espejo de `badgeOrPlaceholder` (web) y
/// `SeasonBadge` (Android).
///
/// ⚠️ Los call sites viven en `HStack(spacing:)`, donde un `EmptyView` gastaría
/// el spacing igual y dejaría un hueco. Por eso se gatean con
/// `if let ... = TransfersLogic.badgeSeason(...)` y solo montan la vista cuando
/// hay chapa.
struct TransfersSeasonBadge: View {
    let season: TeamSeason
    let size: Int

    var body: some View {
        TeamBadgeView(team: season.asBadgeTeam, size: size)
    }
}

extension TeamSeason {
    /// Team mínimo para pintar la chapa con los colores de la temporada.
    var asBadgeTeam: Team {
        Team(
            id: teamId,
            name: name ?? "",
            badgeTorsoCenter: badgeTorsoCenter ?? "#ffffff",
            badgeTorsoSides: badgeTorsoSides ?? "#111111",
            badgeShorts: badgeShorts ?? "#111111",
            badgeInnerCircle: badgeInnerCircle,
            headerBg: headerBg ?? "#1f2937",
            headerText: headerText ?? "#ffffff",
            nameAliases: nil,
            category: category
        )
    }
}
