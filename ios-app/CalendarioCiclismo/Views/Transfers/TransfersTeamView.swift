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
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var contentWidth: CGFloat = 0

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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
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
                // Cabecera cromática compacta, equivalente a la web.
                let appearance = TransfersLogic.badgeSeason(for: season, prev: data.prevSeasonsByTeamId)
                let background = appearance?.headerBg.map(Color.init(hex:)) ?? AppTheme.cardBackground
                let foreground = appearance?.headerText.map(Color.init(hex:)) ?? .primary
                HStack(spacing: 12) {
                    Text(season.name ?? "")
                        .font(.headline)
                        .foregroundStyle(foreground)
                    Spacer(minLength: 8)
                    Text("\(season.category ?? "") · \(String(TransfersLogic.marketSeason))")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(foreground)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .ccCardSurface(cornerRadius: 8, fill: background, showShadow: false)

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

                marketSections(detail: detail, data: data, unknownTeam: unknownTeam)

                // Equipo sin ningún movimiento anunciado: aviso único.
                if detail.staying.isEmpty && detail.doubtful.isEmpty && detail.contractEnds.isEmpty
                    && detail.arrivals.isEmpty && detail.departures.isEmpty {
                    emptyText(localeService.t("Sin movimientos anunciados por ahora.", "No moves announced yet."))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .onGeometryChange(for: CGFloat.self) { geometry in
            geometry.size.width
        } action: { width in
            contentWidth = width
        }
        .background(AppTheme.background)
        .refreshable { await load() }
    }

    private enum MarketBlock: Identifiable {
        case staying([TransfersLogic.StayingRow], continuation: Bool)
        case doubtful([TransfersLogic.DoubtRow], continuation: Bool)
        case contractEnds([RiderTransfer], continuation: Bool)
        case arrivals([RiderTransfer], continuation: Bool)
        case departures([RiderTransfer], continuation: Bool)

        var count: Int {
            switch self {
            case .staying(let rows, _): rows.count
            case .doubtful(let rows, _): rows.count
            case .contractEnds(let rows, _), .arrivals(let rows, _), .departures(let rows, _): rows.count
            }
        }

        var id: String {
            let suffix: String
            switch self {
            case .staying(let rows, let continuation): suffix = "staying:\(rows.first?.id ?? "empty"):\(continuation)"
            case .doubtful(let rows, let continuation): suffix = "doubtful:\(rows.first?.id ?? "empty"):\(continuation)"
            case .contractEnds(let rows, let continuation): suffix = "contracts:\(rows.first?.id ?? "empty"):\(continuation)"
            case .arrivals(let rows, let continuation): suffix = "arrivals:\(rows.first?.id ?? "empty"):\(continuation)"
            case .departures(let rows, let continuation): suffix = "departures:\(rows.first?.id ?? "empty"):\(continuation)"
            }
            return suffix
        }

        func split(at index: Int) -> (MarketBlock, MarketBlock)? {
            guard index > 0, index < count else { return nil }
            switch self {
            case .staying(let rows, let continuation):
                return (.staying(Array(rows.prefix(index)), continuation: continuation), .staying(Array(rows.dropFirst(index)), continuation: true))
            case .doubtful(let rows, let continuation):
                return (.doubtful(Array(rows.prefix(index)), continuation: continuation), .doubtful(Array(rows.dropFirst(index)), continuation: true))
            case .contractEnds(let rows, let continuation):
                return (.contractEnds(Array(rows.prefix(index)), continuation: continuation), .contractEnds(Array(rows.dropFirst(index)), continuation: true))
            case .arrivals(let rows, let continuation):
                return (.arrivals(Array(rows.prefix(index)), continuation: continuation), .arrivals(Array(rows.dropFirst(index)), continuation: true))
            case .departures(let rows, let continuation):
                return (.departures(Array(rows.prefix(index)), continuation: continuation), .departures(Array(rows.dropFirst(index)), continuation: true))
            }
        }
    }

    private func marketBlocks(_ detail: TransfersLogic.TeamDetail) -> [MarketBlock] {
        var blocks: [MarketBlock] = []
        if !detail.staying.isEmpty { blocks.append(.staying(detail.staying, continuation: false)) }
        if !detail.doubtful.isEmpty { blocks.append(.doubtful(detail.doubtful, continuation: false)) }
        if !detail.contractEnds.isEmpty { blocks.append(.contractEnds(detail.contractEnds, continuation: false)) }
        if !detail.arrivals.isEmpty { blocks.append(.arrivals(detail.arrivals, continuation: false)) }
        if !detail.departures.isEmpty { blocks.append(.departures(detail.departures, continuation: false)) }
        return blocks
    }

    private func marketColumns(_ blocks: [MarketBlock]) -> [[MarketBlock]] {
        let division = AdaptiveLayoutPolicy.balancedBreak(counts: blocks.map(\.count))
        var left = Array(blocks.prefix(division.blockIndex))
        var right = Array(blocks.dropFirst(division.blockIndex))
        if division.offset > 0,
           let crossing = right.first,
           let parts = crossing.split(at: division.offset) {
            left.append(parts.0)
            right[0] = parts.1
        }
        return [left, right]
    }

    @ViewBuilder
    private func marketSections(
        detail: TransfersLogic.TeamDetail,
        data: TransfersLogic.MarketData,
        unknownTeam: String
    ) -> some View {
        let blocks = marketBlocks(detail)
        let wide = AdaptiveLayoutPolicy.feedColumns(
            width: max(0, contentWidth - 32),
            isRegular: horizontalSizeClass == .regular
        ) == 2
        if wide, !blocks.isEmpty {
            let columns = marketColumns(blocks)
            HStack(alignment: .top, spacing: 16) {
                marketColumn(columns[0], data: data, unknownTeam: unknownTeam)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                Divider()
                marketColumn(columns[1], data: data, unknownTeam: unknownTeam)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        } else {
            marketColumn(blocks, data: data, unknownTeam: unknownTeam)
        }
    }

    private func marketColumn(
        _ blocks: [MarketBlock],
        data: TransfersLogic.MarketData,
        unknownTeam: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(blocks) { block in
                marketBlock(block, data: data, unknownTeam: unknownTeam)
            }
        }
    }

    @ViewBuilder
    private func marketBlock(
        _ block: MarketBlock,
        data: TransfersLogic.MarketData,
        unknownTeam: String
    ) -> some View {
        switch block {
        case .staying(let rows, _):
            sectionTitle(localeService.t("Continúan", "Staying"))
            CCCard {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
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
        case .doubtful(let rows, _):
            sectionTitle(localeService.t("En duda", "Undecided"))
            CCCard {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { Divider().opacity(0.5) }
                        let riderName = row.rider?.fullName ?? ""
                        personRow(
                            nationality: row.rider?.nationality,
                            name: riderName.isEmpty ? row.riderId : riderName,
                            detail: nil,
                            contractUntil: row.contractUntil,
                            isRumor: false
                        )
                    }
                }
            }
        case .contractEnds(let rows, _):
            sectionTitle(localeService.t("Terminan contrato", "Contract ending"))
            CCCard {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, move in
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
        case .arrivals(let rows, _):
            sectionTitle(localeService.t("Llegan", "Arrivals"))
            movementCard(moves: rows, data: data, showOrigin: true, unknownTeam: unknownTeam)
        case .departures(let rows, _):
            sectionTitle(localeService.t("Se marchan", "Departures"))
            movementCard(moves: rows, data: data, showOrigin: false, unknownTeam: unknownTeam)
        }
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
            movementColumn(
                moves: moves, data: data, showOrigin: showOrigin,
                unknownTeam: unknownTeam, marketTeamIds: marketTeamIds
            )
        }
    }

    private func movementColumn(
        moves: [RiderTransfer],
        data: TransfersLogic.MarketData,
        showOrigin: Bool,
        unknownTeam: String,
        marketTeamIds: Set<String>
    ) -> some View {
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
        .frame(maxWidth: .infinity, alignment: .topLeading)
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
