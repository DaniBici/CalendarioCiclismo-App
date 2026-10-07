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

    private var title: String {
        localeService.t(
            "Mercado de fichajes \(String(TransfersLogic.marketSeason))",
            "\(String(TransfersLogic.marketSeason)) Transfer Market"
        )
    }

    var body: some View {
        LoadingGate(isLoading: isLoading && detail == nil, title: season?.name ?? title) {
            if let error {
                ErrorView(message: error) {
                    Task { await load() }
                }
            } else if let season, let data, let detail {
                content(season: season, data: data, detail: detail)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(title)
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
                // Cabecera sobre superficie neutra con las franjas de maillot
                // de Resultados delante del nombre (`.tr-team-header` web).
                HStack(spacing: 12) {
                    HStack(spacing: 8) {
                        if let team = TransfersLogic.stripesTeam(for: season, prev: data.prevSeasonsByTeamId) {
                            TeamColorBands(team: team, width: 14, height: 15)
                        }
                        Text(season.name ?? "")
                            .ccFont(.s20, weight: .bold)
                            .accessibilityAddTraits(.isHeader)
                    }
                    Spacer(minLength: 8)
                    Text([season.category, String(TransfersLogic.marketSeason)]
                        .compactMap { $0?.isEmpty == false ? $0 : nil }
                        .joined(separator: " · "))
                        .ccFont(.s13, weight: .semibold)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .ccCardSurface()

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
            HStack(alignment: .top, spacing: 24) {
                marketColumn(columns[0], data: data, unknownTeam: unknownTeam)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
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
                        if index > 0 { Divider() }
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
                        if index > 0 { Divider() }
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
                        if index > 0 { Divider() }
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
        Text(text)
            .ccFont(.s16, weight: .semibold)
            .foregroundStyle(.primary)
            .padding(.top, 20)
            .padding(.bottom, 2)
            .accessibilityAddTraits(.isHeader)
    }

    private func emptyText(_ text: String) -> some View {
        Text(text)
            .ccFont(.s14)
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
                if index > 0 { Divider() }
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
        .ccFont(.s13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.transfersDoubt.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.surface))
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
                .ccFont(.s14)
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
                    ForegroundTap.perform {
                        Haptics.play(.navigation)
                        linkedTeamRoute = TransfersTeamRoute(teamId: linkTeamId)
                    }
                } label: {
                    row.contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                row
            }
        }
    }

    /// Nombre en negrita + "· equipo" atenuado inline — espejo de la web.
    private func personLine(name: String, detail: String?) -> AttributedString {
        var line = AttributedString(name)
        line.inlinePresentationIntent = .stronglyEmphasized
        guard let detail, !detail.isEmpty else { return line }
        var tail = AttributedString(" · \(detail)")
        tail.foregroundColor = .secondary
        return line + tail
    }
}

/// Año de fin de contrato como texto gris (`.tr-contract` web). El año
/// centinela 9999 (contrato vitalicio) se pinta como ∞.
struct YearBadge: View {
    let year: Int
    var body: some View {
        Text(year == 9999 ? "∞" : String(year))
            .ccFont(.s12, weight: .bold)
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .accessibilityLabel(year == 9999
                ? LocaleService.t("Contrato vitalicio", "Lifetime contract")
                : LocaleService.t("Contrato hasta \(year)", "Contract until \(year)"))
    }
}

/// Fichaje efectivo durante la temporada en curso: mismo texto gris que el año
/// de contrato (`.tr-contract--midseason` web).
struct MidSeasonBadge: View {
    var body: some View {
        Text(LocaleService.t("M. temporada", "Mid-season"))
            .ccFont(.s12, weight: .bold)
            .foregroundStyle(.secondary)
    }
}

/// Etiqueta "Rumor" — espejo del `.tr-chip--rumor` de la web: ámbar sobre su
/// tinte, sin mayúsculas forzadas.
struct RumorBadge: View {
    var body: some View {
        TransferStateChip(
            text: LocaleService.shared.t("Rumor", "Rumor"),
            foreground: Color(light: "a04607", dark: "fbbf24"),
            background: Color(hex: "f59e0b").opacity(0.16)
        )
    }
}

/// Etiqueta "Duda" — espejo del `.tr-chip--doubt` de la web. Color propio,
/// distinto del ámbar del rumor: un rumor es una noticia sin confirmar, una
/// duda es la ausencia de noticia; no deben leerse como el mismo estado.
struct DoubtBadge: View {
    /// Texto opcional (la tarjeta de equipo usa "En duda").
    var text: String?

    var body: some View {
        TransferStateChip(
            text: text ?? LocaleService.shared.t("Duda", "Undecided"),
            foreground: Color(light: "7c3aed", dark: "a78bfa"),
            background: Color.transfersDoubt.opacity(0.16)
        )
    }
}

/// Etiqueta de estado del mercado: 12 negrita, radio de control.
private struct TransferStateChip: View {
    let text: String
    let foreground: Color
    let background: Color

    var body: some View {
        Text(text)
            .ccFont(.s12, weight: .bold)
            .foregroundStyle(foreground)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: AppTheme.Radius.control)
                    .fill(background)
            )
    }
}

extension Color {
    /// Violeta de las DUDAS (corredor sin renovación despejada / equipo sin
    /// continuidad confirmada). Espejo del `.tr-chip--doubt` de la web.
    static let transfersDoubt = Color(red: 0.545, green: 0.361, blue: 0.965)  // #8B5CF6
}
