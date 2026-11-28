import SwiftUI

/// Detalle de equipo del mercado (apps 4.0) — espejo de la vista de equipo de
/// /fichajes/ web y de `TransfersTeamScreen` (Android), en dos columnas:
/// plantilla de la temporada del mercado (continúan y llegadas confirmadas,
/// tintadas por años de contrato) y estados (en duda, terminan contrato,
/// llegan, se marchan), con badge Rumor donde proceda. Regla Dani: una salida rumoreada saca al corredor de "continúan"
/// y lo pinta como baja·Rumor.
struct TransfersTeamView: View {
    let teamId: String
    /// Mercado que el llamador ya tiene cargado: la primera carga lo reutiliza
    /// en lugar de pedirlo entero otra vez (como `TransfersTeamPane` de Android).
    /// La recarga manual (pull-to-refresh, Reintentar) siempre lo vuelve a pedir.
    var preloadedMarket: TransfersLogic.MarketData? = nil

    @State private var season: TeamSeason?
    @State private var data: TransfersLogic.MarketData?
    @State private var detail: TransfersLogic.TeamDetail?
    /// País del equipo, para la cabecera (nil si no consta).
    @State private var countryCode: String?
    @State private var isLoading = true
    @State private var error: String?
    @State private var localeService = LocaleService.shared
    // Push por valor al equipo de un movimiento (Llegan → equipo de origen;
    // Se marchan → equipo destino). Esta vista es una hoja empujada por
    // TransfersView, que NO declara este destino → lo declara ella misma.
    @State private var linkedTeamRoute: TransfersTeamRoute?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var contentWidth: CGFloat = 0
    /// Orden de la plantilla: por año de contrato (por defecto) o alfabético.
    @State private var squadAlphabetical = false

    private var title: String {
        localeService.t(
            "Mercado de Fichajes \(String(TransfersLogic.marketSeason))",
            "\(String(TransfersLogic.marketSeason)) Transfer Market"
        )
    }

    var body: some View {
        // Rótulo de la carga: el nombre del equipo si el mercado ya se cargó.
        LoadingGate(isLoading: isLoading && detail == nil, title: season?.name ?? SupabaseService.shared.transfersTeamNames[teamId] ?? title) {
            // El error solo sustituye a la página si todavía no tiene
            // contenido: una recarga fallida conserva lo que ya se ve, como
            // `TransfersView`.
            if let error, detail == nil {
                ErrorView(message: error) {
                    Task { await load(refresh: true) }
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
            TransfersTeamView(teamId: route.teamId, preloadedMarket: data)
        }
        .task { await load() }
        .onAppear {
            AnalyticsService.shared.logScreenView("transfers_team")
        }
    }

    private func load(refresh: Bool = false) async {
        if detail == nil { isLoading = true }
        do {
            let market: TransfersLogic.MarketData
            if !refresh, let preloaded = preloadedMarket {
                market = preloaded
            } else {
                market = try await SupabaseService.shared.loadTransfersMarket(season: TransfersLogic.marketSeason)
            }
            guard let teamSeason = market.seasons.first(where: { $0.teamId == teamId }) else {
                throw URLError(.resourceUnavailable)
            }
            let gender = teamSeason.gender ?? TransfersLogic.divisionGender(teamSeason.category)
            async let countryReq = SupabaseService.shared.teamCountryCode(teamId: teamId)
            let roster = try await SupabaseService.shared.ridersByAffiliation(
                teamId: teamId, season: TransfersLogic.marketSeason, gender: gender)
            countryCode = await countryReq
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
            // Se conserva lo que ya se ve: solo una página sin contenido
            // muestra el error.
            if detail == nil {
                self.error = localeService.t(
                    "No se pudo cargar el mercado de fichajes.",
                    "Could not load the transfer market."
                )
            }
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
                TeamHeader(
                    season: season,
                    colors: TeamHeaderPalette.market(season, prev: data.prevSeasonsByTeamId),
                    countryCode: countryCode,
                    confirmedCount: detail.squad.isEmpty ? nil : detail.confirmedCount
                )

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

                // Leyenda de los tintes bajo todas las listas, si alguna fila
                // de la plantilla lleva tinte.
                if detail.squad.contains(where: { TransfersLogic.contractTint($0.contractUntil) != nil }) {
                    ContractLegend()
                        .padding(.top, 20)
                }

                // Equipo sin ningún movimiento anunciado: aviso único.
                if detail.squad.isEmpty && detail.doubtful.isEmpty && detail.contractEnds.isEmpty
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
        // Tarea no estructurada: si SwiftUI cancela la acción de recarga al
        // repintar la vista, las peticiones en curso no se cancelan con ella.
        .refreshable { await Task { await load(refresh: true) }.value }
    }

    private enum MarketBlock: Identifiable {
        case squad([TransfersLogic.SquadRow])
        case doubtful([TransfersLogic.DoubtRow])
        case contractEnds([RiderTransfer])
        case arrivals([RiderTransfer])
        case departures([RiderTransfer])

        var id: String {
            switch self {
            case .squad: "squad"
            case .doubtful: "doubtful"
            case .contractEnds: "contracts"
            case .arrivals: "arrivals"
            case .departures: "departures"
            }
        }
    }

    /// Bloques de los estados: en duda, terminan contrato, llegan y se
    /// marchan. Una sección vacía no se pinta.
    private func stateBlocks(_ detail: TransfersLogic.TeamDetail) -> [MarketBlock] {
        var blocks: [MarketBlock] = []
        if !detail.doubtful.isEmpty { blocks.append(.doubtful(detail.doubtful)) }
        if !detail.contractEnds.isEmpty { blocks.append(.contractEnds(detail.contractEnds)) }
        if !detail.arrivals.isEmpty { blocks.append(.arrivals(detail.arrivals)) }
        if !detail.departures.isEmpty { blocks.append(.departures(detail.departures)) }
        return blocks
    }

    /// Dos columnas, como la web: la plantilla y, juntos, todos los estados.
    /// En ancho estrecho, una columna con la plantilla primero.
    @ViewBuilder
    private func marketSections(
        detail: TransfersLogic.TeamDetail,
        data: TransfersLogic.MarketData,
        unknownTeam: String
    ) -> some View {
        let squad: [MarketBlock] = detail.squad.isEmpty ? [] : [.squad(detail.squad)]
        let states = stateBlocks(detail)
        let wide = AdaptiveLayoutPolicy.feedColumns(
            width: max(0, contentWidth - 32),
            isRegular: horizontalSizeClass == .regular
        ) == 2
        if wide, !squad.isEmpty, !states.isEmpty {
            HStack(alignment: .top, spacing: 24) {
                marketColumn(squad, data: data, unknownTeam: unknownTeam)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                marketColumn(states, data: data, unknownTeam: unknownTeam)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        } else {
            marketColumn(squad + states, data: data, unknownTeam: unknownTeam)
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
        case .squad(let rows):
            HStack(alignment: .center, spacing: 8) {
                sectionTitle(localeService.t(
                    "Plantilla \(String(TransfersLogic.marketSeason))",
                    "\(String(TransfersLogic.marketSeason)) Squad"
                ))
                Spacer(minLength: 8)
                if rows.count > 1 { squadOrderButton.padding(.top, 20).padding(.bottom, 2) }
            }
            CCCard {
                VStack(spacing: 0) {
                    ForEach(Array(TransfersLogic.sortedSquad(rows, alphabetical: squadAlphabetical).enumerated()), id: \.element.id) { index, row in
                        if index > 0 { Divider() }
                        let riderName = row.rider?.fullName ?? ""
                        personRow(
                            nationality: row.rider?.nationality,
                            name: riderName.isEmpty ? row.riderId : riderName,
                            detail: nil,
                            contractUntil: row.contractUntil,
                            isRumor: row.isRumor,
                            tint: ContractTintColor.color(TransfersLogic.contractTint(row.contractUntil), strong: row.isArrival),
                            // El color no es la única señal de una llegada.
                            accessibilityNote: row.isArrival ? localeService.t("Llega", "Arrival") : nil
                        )
                    }
                }
            }
        case .doubtful(let rows):
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
        case .contractEnds(let rows):
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
        case .arrivals(let rows):
            sectionTitle(localeService.t("Llegan", "Arrivals"))
            movementCard(moves: rows, data: data, showOrigin: true, unknownTeam: unknownTeam)
        case .departures(let rows):
            sectionTitle(localeService.t("Se marchan", "Departures"))
            movementCard(moves: rows, data: data, showOrigin: false, unknownTeam: unknownTeam)
        }
    }

    /// Conmutador del orden de la plantilla, como en la web: muestra el orden
    /// al que cambia (A-Z con el de contrato activo; un lápiz sobre una hoja,
    /// el contrato, con el alfabético). No añade altura a la cabecera.
    private var squadOrderButton: some View {
        Button {
            Haptics.play(.selection)
            withAnimation(.easeInOut(duration: 0.25)) { squadAlphabetical.toggle() }
        } label: {
            Image(squadAlphabetical ? "SquadOrderContract" : "SquadOrderAlphabetical")
                .resizable()
                .frame(width: 18, height: 18)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .padding(.vertical, -7)
        .accessibilityLabel(squadAlphabetical
            ? localeService.t("Ordenar por año de contrato", "Sort by contract year")
            : localeService.t("Ordenar alfabéticamente", "Sort alphabetically"))
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
        let marketTeamIds = TransfersLogic.marketTeamIds(data.seasons)
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
        linkTeamId: String? = nil,
        tint: Color? = nil,
        accessibilityNote: String? = nil
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint ?? .clear)
        .accessibilityElement(children: .combine)
        .accessibilityHint(accessibilityNote ?? "")

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

/// Cabecera de la vista de equipo, espejo de `.tr-team-header` web: cuadrado de
/// colores y nombre, país y ciclistas confirmados separados por «·», y la
/// división con la temporada a la derecha. Si no cabe en una línea, país y
/// recuento bajan a la siguiente, juntos o por separado.
private struct TeamHeader: View {
    let season: TeamSeason
    /// Colores de cabecera del equipo; con ellos, los textos secundarios
    /// derivan del texto de la cabecera. nil → superficie neutra.
    let colors: (background: Color, text: Color)?
    let countryCode: String?
    let confirmedCount: Int?

    private var localeService: LocaleService { LocaleService.shared }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            // El separador «·» queda a 6 pt de cada lado, como un espacio de
            // texto; el resto de elementos, a 12 pt.
            HStack(spacing: 6) {
                name.fixedSize()
                if countryCode != nil { separator; country.fixedSize() }
                if confirmedCount != nil { separator; count.fixedSize() }
                Spacer(minLength: 12)
                category
            }
            // El nombre largo pasa a dos líneas sin que país y recuento
            // dejen de compartir línea si caben.
            VStack(alignment: .leading, spacing: 6) {
                nameAndCategory
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) {
                        if countryCode != nil { country.fixedSize() }
                        if countryCode != nil, confirmedCount != nil { separator }
                        if confirmedCount != nil { count.fixedSize() }
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        if countryCode != nil { country }
                        if confirmedCount != nil { count }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        // `.secondary` de país, recuento y división se resuelve sobre este texto.
        .foregroundStyle(colors?.text ?? .primary)
        .ccCardSurface(fill: colors?.background ?? AppTheme.cardBackground)
    }

    private var name: some View {
        Text(season.name ?? "")
            .ccFont(.s20, weight: .bold)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    /// Nombre con la división y la temporada al final de la línea.
    private var nameAndCategory: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            name
            Spacer(minLength: 8)
            category
        }
    }

    private var separator: some View {
        Text("·").ccFont(.s13).foregroundStyle(.secondary).accessibilityHidden(true)
    }

    @ViewBuilder private var country: some View {
        if let code = countryCode {
            HStack(spacing: 6) {
                CountryFlag(countryCode: code, width: 16)
                Text(Locale(identifier: LocaleService.shouldShowEnglishContent ? "en" : "es")
                    .localizedString(forRegionCode: code.uppercased()) ?? code.uppercased())
                    .ccFont(.s13)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// «N ciclistas confirmados», con el número en negrita. Sin el año: la cabecera
    /// ya lo muestra junto a la categoría.
    @ViewBuilder private var count: some View {
        if let n = confirmedCount {
            let tail = localeService.t(
                n == 1 ? " ciclista confirmado" : " ciclistas confirmados",
                n == 1 ? " rider confirmed" : " riders confirmed"
            )
            (Text("\(n)").fontWeight(.bold) + Text(tail))
                .ccFont(.s13)
                .foregroundStyle(.secondary)
        }
    }

    private var category: some View {
        Text([season.category, String(TransfersLogic.marketSeason)]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: " · "))
            .ccFont(.s13, weight: .semibold)
            .foregroundStyle(.secondary)
            .fixedSize()
    }
}

/// Tintes de la plantilla por años de contrato (`.tr-tint--*` web): pálido
/// para los que continúan y fuerte para las llegadas. El texto pasa 4,5:1
/// sobre cada tinte en los dos temas.
enum ContractTintColor {
    static func color(_ tint: TransfersLogic.ContractTint?, strong: Bool) -> Color? {
        switch (tint, strong) {
        case (.green, false): Color(light: "e3f9e0", dark: "12301c")
        case (.green, true): Color(light: "8dfe96", dark: "1f5a2c")
        case (.yellow, false): Color(light: "fcf8db", dark: "3a3512")
        case (.yellow, true): Color(light: "fef18d", dark: "5c5217")
        case (.red, false): Color(light: "fcdbdb", dark: "3d1b1b")
        case (.red, true): Color(light: "f9a8a8", dark: "6b2424")
        case (nil, _): nil
        }
    }
}

/// Leyenda de los tintes de la plantilla bajo las listas del equipo
/// (`.tr-legend` web): un cuadrado por color con el año de fin de contrato y,
/// aparte, el tono fuerte de los fichajes, centrada. En una línea si cabe; si
/// no, los años en una y los fichajes debajo.
private struct ContractLegend: View {
    private var localeService: LocaleService { LocaleService.shared }
    private var season: Int { TransfersLogic.marketSeason }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) { years; arrival }
            VStack(alignment: .center, spacing: 6) { years; arrival }
            VStack(alignment: .center, spacing: 6) {
                label
                item(.green, false, localeService.t("\(String(season + 2)) o más", "\(String(season + 2)) or later"))
                item(.yellow, false, String(season + 1))
                item(.red, false, String(season))
                arrival
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
    }

    private var label: some View {
        Text(localeService.t("Fin de contrato", "Contract until"))
            .ccFont(.s13, weight: .semibold)
            .foregroundStyle(.secondary)
    }

    private var years: some View {
        HStack(spacing: 14) {
            label
            item(.green, false, localeService.t("\(String(season + 2)) o más", "\(String(season + 2)) or later"))
            item(.yellow, false, String(season + 1))
            item(.red, false, String(season))
        }
        .fixedSize()
    }

    private var arrival: some View {
        item(.green, true, localeService.t(
            "Tono más intenso: fichaje para la nueva temporada",
            "Stronger shade: signing for the new season"
        ))
        .fixedSize()
    }

    private func item(_ tint: TransfersLogic.ContractTint, _ strong: Bool, _ text: String) -> some View {
        HStack(spacing: 6) {
            Rectangle()
                .fill(ContractTintColor.color(tint, strong: strong) ?? .clear)
                .frame(width: 12, height: 12)
                .overlay(Rectangle().stroke(Color(.separator), lineWidth: 1))
                .accessibilityHidden(true)
            Text(text)
                .ccFont(.s13)
                .foregroundStyle(.secondary)
        }
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
