import SwiftUI

/// Push por valor al detalle de equipo del mercado (regla iOS: navegación por
/// valor, nunca por destino — no corrompe el NavigationStack).
struct TransfersTeamRoute: Hashable, Identifiable {
    let teamId: String
    var id: String { teamId }
}

/// Pestaña "Fichajes" (apps 4.0) — mercado de la temporada 2027, espejo de
/// /fichajes/ web (`js/fichajes.js`) y de `TransfersScreen` (Android): feed
/// cronológico inverso de CONFIRMACIONES + botones de división (WT·WWT·PT·PRW)
/// + lista de equipos 2027 (team_seasons; chapa solo si badgeVisible). Tocar
/// un equipo abre `TransfersTeamView` (continúan / llegan / se marchan).
///
/// Solo-online (sin caché), como resultados/inscritos. La lógica pura vive en
/// `TransfersLogic` (testeada); aquí solo carga + render.
struct TransfersView: View {
    @State private var data: TransfersLogic.MarketData?
    @State private var isLoading = true
    @State private var error: String?
    @State private var activeDivision = TransfersLogic.divisions[0]
    @State private var teamRoute: TransfersTeamRoute?
    @State private var localeService = LocaleService.shared

    var body: some View {
        Group {
            if isLoading && data == nil {
                LoadingView(
                    message: localeService.t("Cargando mercado de fichajes...", "Loading transfer market..."),
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
            "Mercado de fichajes \(String(TransfersLogic.marketSeason))",
            "\(String(TransfersLogic.marketSeason)) transfer market"
        ))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $teamRoute) { route in
            TransfersTeamView(teamId: route.teamId)
        }
        .task { await load() }
        .onAppear {
            AnalyticsService.shared.logScreenView("transfers")
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
        let feed = TransfersLogic.confirmedFeed(data.transfers)
        let feedByDay = TransfersLogic.groupByDay(feed)
        let teams = TransfersLogic.divisionTeams(data.seasons, division: activeDivision)

        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                // ── Feed de confirmaciones ─────────────────────────
                sectionTitle(localeService.t("Últimas confirmaciones", "Latest confirmations"))
                if feed.isEmpty {
                    emptyText(localeService.t("Todavía no hay movimientos confirmados.", "No confirmed moves yet."))
                } else {
                    ForEach(feedByDay, id: \.day) { group in
                        Text(DateFormatting.formatDateLongContent(group.day))
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundStyle(.secondary)
                            .padding(.top, 8)
                        ForEach(group.moves) { move in
                            TransferFeedRowView(transfer: move, data: data)
                        }
                    }
                }

                // ── Divisiones + equipos ───────────────────────────
                sectionTitle(localeService.t(
                    "Equipos \(String(TransfersLogic.marketSeason))",
                    "\(String(TransfersLogic.marketSeason)) teams"
                ))
                HStack(spacing: 8) {
                    ForEach(TransfersLogic.divisions, id: \.self) { div in
                        divisionChip(div)
                    }
                }
                if teams.isEmpty {
                    emptyText(localeService.t("Sin equipos en esta división.", "No teams in this division."))
                } else {
                    ForEach(teams, id: \.teamId) { season in
                        teamRow(season, prev: data.prevSeasonsByTeamId)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .refreshable { await load() }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption)
            .fontWeight(.bold)
            .kerning(0.8)
            .foregroundStyle(.secondary)
            .padding(.top, 16)
    }

    private func emptyText(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.vertical, 4)
    }

    /// Píldora de división — mismo lenguaje que los chips de filtros (activo =
    /// relleno accent-dim + texto accent).
    private func divisionChip(_ division: String) -> some View {
        let selected = division == activeDivision
        return Button {
            Haptics.play(.selection)
            activeDivision = division
        } label: {
            Text(division)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 7)
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

    private func teamRow(_ season: TeamSeason, prev: [String: TeamSeason]) -> some View {
        Button {
            Haptics.play(.navigation)
            teamRoute = TransfersTeamRoute(teamId: season.teamId)
        } label: {
            CCCard {
                HStack(spacing: 10) {
                    // Sin chapa no se monta la vista: en un HStack con spacing,
                    // un EmptyView gastaría el hueco igual.
                    if let badge = TransfersLogic.badgeSeason(for: season, prev: prev) {
                        TransfersSeasonBadge(season: badge, size: 26)
                    }
                    Text(season.name ?? "")
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    // Continuidad del equipo sin confirmar (mig. 123): sigue
                    // listado, solo se advierte.
                    if season.continuityDoubt == true {
                        DoubtBadge(text: localeService.t("Continuidad en duda", "Future in doubt"))
                    }
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Fila del feed

/// Fila del feed: bandera + "Corredor  Origen → Destino" + "hasta YYYY".
struct TransferFeedRowView: View {
    let transfer: RiderTransfer
    let data: TransfersLogic.MarketData

    private var localeService: LocaleService { LocaleService.shared }

    var body: some View {
        let unknownTeam = localeService.t("Por confirmar", "To be confirmed")
        let rider = data.ridersById[transfer.riderId]
        CCCard {
            HStack(spacing: 8) {
                CountryFlag(countryCode: rider?.nationality, width: 16)
                VStack(alignment: .leading, spacing: 2) {
                    Text(moveText(rider: rider, unknownTeam: unknownTeam))
                        .font(.subheadline)
                    if let until = transfer.contractUntil {
                        Text(localeService.t("hasta \(String(until))", "until \(String(until))"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
    }

    private func moveText(rider: TransferRider?, unknownTeam: String) -> AttributedString {
        var name = AttributedString(rider.map { $0.fullName.isEmpty ? transfer.riderId : $0.fullName } ?? transfer.riderId)
        name.font = .subheadline.weight(.semibold)
        var out = name + AttributedString("  ")
        switch transfer.type {
        case "renewal":
            out += AttributedString(localeService.t("renueva con", "renews with") + " ")
            var team = AttributedString(TransfersLogic.teamLabel(
                teamId: transfer.toTeamId, freeText: transfer.toTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam))
            team.font = .subheadline.weight(.semibold)
            out += team
        case "retirement":
            out += AttributedString(localeService.t("se retira", "retires") + " (")
            out += AttributedString(TransfersLogic.teamLabel(
                teamId: transfer.fromTeamId, freeText: transfer.fromTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam,
                side: .from, namesPrev: data.teamNamePrev))
            out += AttributedString(")")
        default:
            out += AttributedString(TransfersLogic.teamLabel(
                teamId: transfer.fromTeamId, freeText: transfer.fromTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam,
                side: .from, namesPrev: data.teamNamePrev))
            out += AttributedString(" → ")
            var team = AttributedString(TransfersLogic.teamLabel(
                teamId: transfer.toTeamId, freeText: transfer.toTeamName,
                names: data.teamNameById, unknownLabel: unknownTeam))
            team.font = .subheadline.weight(.semibold)
            out += team
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
