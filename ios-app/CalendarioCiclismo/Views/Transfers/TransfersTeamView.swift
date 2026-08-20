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
    // Push por valor al equipo de un movimiento (Llegan → equipo de origen;
    // Se marchan → equipo destino). Esta vista es una hoja empujada por
    // TransfersView, que NO declara este destino → lo declara ella misma.
    @State private var linkedTeamRoute: TransfersTeamRoute?

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
        .navigationTitle(localeService.t(
            "Mercado de Fichajes \(String(TransfersLogic.marketSeason))",
            "\(String(TransfersLogic.marketSeason)) Transfer Market"
        ))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $linkedTeamRoute) { route in
            TransfersTeamView(teamId: route.teamId)
        }
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
            let roster = try await SupabaseService.shared.ridersByAffiliation(
                teamId: teamId, season: TransfersLogic.marketSeason, gender: gender)
            season = teamSeason
            data = market
            // Categoría del equipo de destino (para ordenar "se marchan").
            var categoryByTeamId: [String: String] = [:]
            for s in market.seasons { if let c = s.category { categoryByTeamId[s.teamId] = c } }
            detail = TransfersLogic.teamDetail(
                transfers: market.transfers, roster: roster, teamId: teamId,
                ridersById: market.ridersById, categoryByTeamId: categoryByTeamId,
                teamNameById: market.teamNameById
            )
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
                            Text(season.category ?? "")
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

                // Cada sección solo se muestra si tiene contenido (una categoría
                // vacía se oculta por completo, título incluido).

                // ── Continúan ──────────────────────────────────────
                if !detail.staying.isEmpty {
                    sectionTitle(localeService.t("Continúan", "Staying"))
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
                if !detail.doubtful.isEmpty {
                    sectionTitle(localeService.t("En duda", "Undecided"))
                    CCCard {
                        VStack(spacing: 0) {
                            ForEach(Array(detail.doubtful.enumerated()), id: \.element.id) { index, row in
                                if index > 0 { Divider().opacity(0.5) }
                                // Sin badge "Duda": ya están bajo la sección "En duda".
                                personRow(
                                    nationality: row.rider?.nationality,
                                    name: {
                                        let full = row.rider?.fullName ?? ""
                                        return full.isEmpty ? row.riderId : full
                                    }(),
                                    detail: nil,
                                    contractUntil: row.contractUntil,
                                    isRumor: false
                                )
                            }
                        }
                    }
                }

                // ── Terminan contrato ──────────────────────────────
                // Acaban su contrato sin equipo conocido (sin destino).
                if !detail.contractEnds.isEmpty {
                    sectionTitle(localeService.t("Terminan contrato", "Contract ending"))
                    CCCard {
                        VStack(spacing: 0) {
                            ForEach(Array(detail.contractEnds.enumerated()), id: \.element.id) { index, move in
                                if index > 0 { Divider().opacity(0.5) }
                                let rider = data.ridersById[move.riderId]
                                personRow(
                                    nationality: rider?.nationality,
                                    name: rider.map { $0.fullName.isEmpty ? move.riderId : $0.fullName } ?? move.riderId,
                                    detail: nil,
                                    contractUntil: nil,
                                    isRumor: move.status == "rumor"
                                )
                            }
                        }
                    }
                }

                // ── Llegan ─────────────────────────────────────────
                if !detail.arrivals.isEmpty {
                    sectionTitle(localeService.t("Llegan", "Arrivals"))
                    movementCard(moves: detail.arrivals, data: data, showOrigin: true, unknownTeam: unknownTeam)
                }

                // ── Se marchan ─────────────────────────────────────
                if !detail.departures.isEmpty {
                    sectionTitle(localeService.t("Se marchan", "Departures"))
                    movementCard(moves: detail.departures, data: data, showOrigin: false, unknownTeam: unknownTeam)
                }

                // Equipo sin ningún movimiento anunciado: aviso único.
                if detail.staying.isEmpty && detail.doubtful.isEmpty && detail.contractEnds.isEmpty
                    && detail.arrivals.isEmpty && detail.departures.isEmpty {
                    emptyText(localeService.t("Sin movimientos anunciados por ahora.", "No moves announced yet."))
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
        // Equipos con ficha en el mercado (destino enlazable de un nombre).
        let marketTeamIds = Set(data.seasons.map(\.teamId))
        return CCCard {
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
                            return localeService.t("Se retira", "Retires")
                        }
                        return TransfersLogic.teamLabel(
                            teamId: move.toTeamId, freeText: move.toTeamName,
                            names: data.teamNameById, unknownLabel: unknownTeam)
                    }()
                    // Llega → enlaza al equipo del que VENÍA (fromTeamId); se marcha
                    // → al equipo AL QUE VA (toTeamId). Solo si ese equipo tiene
                    // ficha en el mercado (una retirada no tiene destino).
                    let candidate = showOrigin ? move.fromTeamId : move.toTeamId
                    let linkTeamId = candidate.flatMap { marketTeamIds.contains($0) ? $0 : nil }
                    personRow(
                        nationality: rider?.nationality,
                        name: rider.map { $0.fullName.isEmpty ? move.riderId : $0.fullName } ?? move.riderId,
                        detail: detailText,
                        contractUntil: showOrigin ? move.contractUntil : nil,
                        isRumor: move.status == "rumor",
                        linkTeamId: linkTeamId
                    )
                }
            }
        }
    }

    /// Aviso de continuidad del equipo en duda — espejo de `.tr-team-notice`.
    private func teamDoubtNotice(_ text: String) -> some View {
        Text(text)
        .font(.footnote)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.transfersDoubt.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.top, 10)
    }

    /// Fila de persona: bandera + nombre + detalle + contrato + badge Rumor/Duda.
    /// El detalle (equipo de origen/destino) va INLINE a la derecha del nombre,
    /// atenuado y separado por "·" — misma estética que la web (`personRowHtml`),
    /// no como subtítulo debajo. Si se pasa `linkTeamId`, la FILA ENTERA es
    /// tocable y navega a la ficha de ese equipo (no solo el nombre).
    private func personRow(
        nationality: String?,
        name: String,
        detail: String?,
        contractUntil: Int?,
        isRumor: Bool,
        isDoubt: Bool = false,
        linkTeamId: String? = nil
    ) -> some View {
        // El año de contrato como BADGE al final de la fila, junto al de
        // rumor/duda (solo el año, sin "hasta").
        let row = HStack(spacing: 8) {
            CountryFlag(countryCode: nationality, width: 16)
            // Corredor + equipo trunca con "…" a una línea (misma fórmula que
            // las cards de Hoy): sin doble altura, y los badges quedan fijos a
            // la derecha. El realce de "clicable" es la FILA entera (Button más
            // abajo), no el nombre → nombre en el color normal, sin accent.
            Text(personLine(name: name, detail: detail))
                .font(.footnote)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 4)
            if let year = contractUntil { YearBadge(year: year) }
            if isDoubt { DoubtBadge() } else if isRumor { RumorBadge() }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)

        return Group {
            if let linkTeamId {
                // Fila entera enlazada al equipo del movimiento (no hay ficha
                // pública de corredor). `contentShape` hace tocable todo el
                // ancho, incluidos los huecos entre elementos.
                Button {
                    Haptics.play(.navigation)
                    linkedTeamRoute = TransfersTeamRoute(teamId: linkTeamId)
                } label: {
                    row.contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                row
            }
        }
    }

    /// Nombre (medium) + "· equipo" atenuado inline — espejo del divisor de la web.
    private func personLine(name: String, detail: String?) -> AttributedString {
        var line = AttributedString(name)
        line.font = .footnote.weight(.medium)
        guard let detail, !detail.isEmpty else { return line }
        var tail = AttributedString(" · \(detail)")
        tail.font = .footnote
        tail.foregroundColor = .secondary
        return line + tail
    }
}

/// Badge neutro del año de fin de contrato — espejo del `.tr-contract` de la web.
/// El año centinela 9999 (contrato vitalicio) se pinta como ∞.
struct YearBadge: View {
    let year: Int
    var body: some View {
        Text(year == 9999 ? "∞" : String(year))
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.secondary.opacity(0.14))
            )
    }
}

/// Badge azul para un fichaje efectivo durante la temporada en curso.
struct MidSeasonBadge: View {
    var body: some View {
        Text(LocaleService.t("M. TEMPORADA", "MID-SEASON"))
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(Color(red: 37 / 255, green: 99 / 255, blue: 235 / 255))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(red: 37 / 255, green: 99 / 255, blue: 235 / 255).opacity(0.14))
            )
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
    /// Texto opcional (la tarjeta de equipo usa "En duda").
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
