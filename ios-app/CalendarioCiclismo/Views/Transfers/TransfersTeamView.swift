import SwiftUI

/// Detalle de equipo del mercado (apps 4.0) — espejo de la vista de equipo de
/// /fichajes/ web y de `TransfersTeamScreen` (Android): continúan (plantilla
/// actual con fin de contrato) / llegan / se marchan, con badge Rumor donde
/// proceda. Regla Dani: una salida rumoreada saca al corredor de "continúan"
/// y lo pinta como baja·Rumor.
struct TransfersTeamView: View {
    let teamId: String

    @State private var season: TeamSeason?
    @State private var data: TransfersLogic.MarketData?
    @State private var detail: TransfersLogic.TeamDetail?
    @State private var isLoading = true
    @State private var error: String?
    @State private var localeService = LocaleService.shared

    var body: some View {
        Group {
            if isLoading {
                LoadingView(message: localeService.t("Cargando...", "Loading..."), branded: true)
            } else if let error {
                ErrorView(message: error) {
                    Task { await load() }
                }
            } else if let season, let data, let detail {
                content(season: season, data: data, detail: detail)
            }
        }
        .navigationTitle(season?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onAppear {
            AnalyticsService.shared.logScreenView("transfers_team")
        }
    }

    private func load() async {
        isLoading = true
        do {
            let market = try await SupabaseService.shared.loadTransfersMarket(season: TransfersLogic.marketSeason)
            guard let teamSeason = market.seasons.first(where: { $0.teamId == teamId }) else {
                throw URLError(.resourceUnavailable)
            }
            let gender = teamSeason.gender ?? TransfersLogic.divisionGender(teamSeason.category)
            let roster = try await SupabaseService.shared.ridersByCurrentTeam(teamId: teamId, gender: gender)
            season = teamSeason
            data = market
            detail = TransfersLogic.teamDetail(transfers: market.transfers, roster: roster, teamId: teamId)
            error = nil
        } catch {
            self.error = localeService.t(
                "No se pudo cargar el mercado de fichajes.",
                "Could not load the transfer market."
            )
        }
        isLoading = false
    }

    // MARK: - Contenido

    private func content(
        season: TeamSeason,
        data: TransfersLogic.MarketData,
        detail: TransfersLogic.TeamDetail
    ) -> some View {
        let unknownTeam = localeService.t("Por confirmar", "To be confirmed")
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                // Cabecera: chapa (si está activada) + nombre + categoría·año.
                CCCard {
                    HStack(spacing: 12) {
                        // Sin chapa no se monta la vista: en un HStack con
                        // spacing, un EmptyView gastaría el hueco igual.
                        if let badge = TransfersLogic.badgeSeason(for: season, prev: data.prevSeasonsByTeamId) {
                            TransfersSeasonBadge(season: badge, size: 40)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(season.name ?? "")
                                .font(.headline)
                            Text("\(season.category ?? "") · \(String(TransfersLogic.marketSeason))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(14)
                }

                // Aviso: la continuidad del equipo en la temporada del mercado
                // no está confirmada (mig. 123). El equipo se lista igual.
                if season.continuityDoubt == true {
                    teamDoubtNotice(
                        localeService.t(
                            "La continuidad del equipo en \(String(TransfersLogic.marketSeason)) no está confirmada.",
                            "The team's participation in \(String(TransfersLogic.marketSeason)) is not confirmed."
                        )
                    )
                }

                // ── Continúan ──────────────────────────────────────
                sectionTitle(localeService.t("Continúan", "Staying"))
                if detail.staying.isEmpty {
                    emptyText(localeService.t("Sin corredores en la plantilla actual.", "No riders on the current roster."))
                } else {
                    CCCard {
                        VStack(spacing: 0) {
                            ForEach(Array(detail.staying.enumerated()), id: \.element.id) { index, row in
                                if index > 0 { Divider().opacity(0.5) }
                                personRow(
                                    nationality: row.rider.nationality,
                                    name: row.rider.fullName.isEmpty ? row.rider.id : row.rider.fullName,
                                    detail: nil,
                                    contractUntil: row.contractUntil,
                                    isRumor: row.isRumor
                                )
                            }
                        }
                    }
                }

                // ── En duda ────────────────────────────────────────
                // Renovaciones sin despejar: ni continúan, ni salen, ni entran.
                sectionTitle(localeService.t("En duda", "Undecided"))
                if detail.doubtful.isEmpty {
                    emptyText(localeService.t("Sin corredores en duda por ahora.", "No undecided riders yet."))
                } else {
                    CCCard {
                        VStack(spacing: 0) {
                            ForEach(Array(detail.doubtful.enumerated()), id: \.element.id) { index, row in
                                if index > 0 { Divider().opacity(0.5) }
                                personRow(
                                    nationality: row.rider?.nationality,
                                    name: {
                                        let full = row.rider?.fullName ?? ""
                                        return full.isEmpty ? row.riderId : full
                                    }(),
                                    detail: nil,
                                    contractUntil: row.contractUntil,
                                    isRumor: false,
                                    isDoubt: true
                                )
                            }
                        }
                    }
                }

                // ── Se marchan ─────────────────────────────────────
                sectionTitle(localeService.t("Se marchan", "Departures"))
                if detail.departures.isEmpty {
                    emptyText(localeService.t("Sin salidas anunciadas por ahora.", "No departures announced yet."))
                } else {
                    movementCard(moves: detail.departures, data: data, showOrigin: false, unknownTeam: unknownTeam)
                }

                // ── Llegan ─────────────────────────────────────────
                sectionTitle(localeService.t("Llegan", "Arrivals"))
                if detail.arrivals.isEmpty {
                    emptyText(localeService.t("Sin llegadas anunciadas por ahora.", "No arrivals announced yet."))
                } else {
                    movementCard(moves: detail.arrivals, data: data, showOrigin: true, unknownTeam: unknownTeam)
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

    /// Tarjeta de llegadas o salidas: una fila por movimiento.
    private func movementCard(
        moves: [RiderTransfer],
        data: TransfersLogic.MarketData,
        showOrigin: Bool,
        unknownTeam: String
    ) -> some View {
        CCCard {
            VStack(spacing: 0) {
                ForEach(Array(moves.enumerated()), id: \.element.id) { index, move in
                    if index > 0 { Divider().opacity(0.5) }
                    let rider = data.ridersById[move.riderId]
                    let detailText: String = {
                        if showOrigin {
                            return TransfersLogic.teamLabel(
                                teamId: move.fromTeamId, freeText: move.fromTeamName,
                                names: data.teamNameById, unknownLabel: unknownTeam,
                                side: .from, namesPrev: data.teamNamePrev)
                        }
                        if move.type == "retirement" {
                            return localeService.t("se retira", "retires")
                        }
                        return TransfersLogic.teamLabel(
                            teamId: move.toTeamId, freeText: move.toTeamName,
                            names: data.teamNameById, unknownLabel: unknownTeam)
                    }()
                    personRow(
                        nationality: rider?.nationality,
                        name: rider.map { $0.fullName.isEmpty ? move.riderId : $0.fullName } ?? move.riderId,
                        detail: detailText,
                        contractUntil: showOrigin ? move.contractUntil : nil,
                        isRumor: move.status == "rumor"
                    )
                }
            }
        }
    }

    /// Aviso de continuidad del equipo en duda — espejo de `.tr-team-notice`.
    private func teamDoubtNotice(_ text: String) -> some View {
        HStack(spacing: 0) {
            // Barra lateral de acento (equivalente al border-left de la web).
            Rectangle()
                .fill(Color.transfersDoubt)
                .frame(width: 3)
            Text(text)
                .font(.footnote)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.transfersDoubt.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.top, 10)
    }

    /// Fila de persona: bandera + nombre + detalle + contrato + badge Rumor/Duda.
    private func personRow(
        nationality: String?,
        name: String,
        detail: String?,
        contractUntil: Int?,
        isRumor: Bool,
        isDoubt: Bool = false
    ) -> some View {
        let untilText = contractUntil.map { localeService.t("hasta \(String($0))", "until \(String($0))") }
        let sub = [detail, untilText].compactMap { $0 }.joined(separator: " · ")
        return HStack(spacing: 8) {
            CountryFlag(countryCode: nationality, width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                if !sub.isEmpty {
                    Text(sub)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if isDoubt { DoubtBadge() } else if isRumor { RumorBadge() }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
    }
}

/// Badge ámbar "Rumor" — espejo del `.tr-chip--rumor` de la web.
struct RumorBadge: View {
    var body: some View {
        Text(LocaleService.shared.t("Rumor", "Rumor").uppercased())
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(Color(red: 0.96, green: 0.62, blue: 0.04))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(red: 0.96, green: 0.62, blue: 0.04).opacity(0.16))
            )
    }
}

/// Badge violeta "Duda" — espejo del `.tr-chip--doubt` de la web. Color propio,
/// distinto del ámbar del rumor: un rumor es una noticia sin confirmar, una
/// duda es la ausencia de noticia; no deben leerse como el mismo estado.
struct DoubtBadge: View {
    /// Texto opcional (la tarjeta de equipo usa "Continuidad en duda").
    var text: String?

    var body: some View {
        Text((text ?? LocaleService.shared.t("Duda", "Undecided")).uppercased())
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(Color.transfersDoubt)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.transfersDoubt.opacity(0.16))
            )
    }
}

extension Color {
    /// Violeta de las DUDAS (corredor sin renovación despejada / equipo sin
    /// continuidad confirmada). Espejo del `.tr-chip--doubt` de la web.
    static let transfersDoubt = Color(red: 0.545, green: 0.361, blue: 0.965)  // #8B5CF6
}
