import SwiftUI

private enum ResultsFeedSection {
    case latest
    case ranking
}

private enum UciRankingGender: String {
    case male
    case female
}

private struct UciRankingExplanationItem: Identifiable {
    let id: String
    let title: String
    let message: String
}

/// Pestaña "Resultados" — feed "Últimos resultados" (apps 3.1, fase F3).
/// Réplica nativa de `js/resultados-feed.js` (`renderResultsFeed`): cronología
/// inversa agrupada por día, ventana de 14 días + "Cargar más" hasta el
/// arranque de temporada. Espejo de `ResultsFeedScreen` (Android).
///
/// Filas con la superficie neutra de las cards de Hoy (`CCCard`, sin tinte del
/// color de carrera), logo + bandera, "Etapa N · km · desnivel"
/// + badge de tipo solo para contrarrelojes, y el ganador con trofeo. Cada fila
/// abre su clasificación propia mediante `ResultsRoute`.
struct ResultsFeedView: View {
    @State private var entries: [FeedEntry] = []
    @State private var isLoading = true
    @State private var error: String?
    /// Inicio de la ventana cargada (se amplía con "Cargar más").
    @State private var fromKey = ResultsFeedLogic.initialFromKey()
    @State private var isLoadingMore = false
    /// Identifica la última carga del feed (completa o «Cargar más»). Una
    /// respuesta de una carga anterior se descarta: no puede sustituir la
    /// lista ni el inicio de la ventana de otra más reciente.
    @State private var feedGeneration = 0
    /// Push por valor a la pantalla de resultados in-house.
    @State private var resultsRoute: ResultsRoute?
    @State private var activeSection = ResultsFeedSection.latest
    @State private var rankingGender = UciRankingGender.male
    @State private var rankingRows: [UciTeamRankingRow] = []
    @State private var isRankingLoading = false
    @State private var rankingError: String?
    @State private var rankingExplanation: UciRankingExplanationItem?
    @State private var localeService = LocaleService.shared
    @State private var contentWidth: CGFloat = 0
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        VStack(spacing: 0) {
            sectionSelector
            Group {
                switch activeSection {
                case .latest:
                    if isLoading && entries.isEmpty {
                        LoadingView(branded: true, title: localeService.t("Últimos resultados", "Latest results"))
                    } else if let error, entries.isEmpty {
                        ErrorView(message: error) {
                            Task { await load() }
                        }
                    } else {
                        feedList
                    }
                case .ranking:
                    if isRankingLoading && rankingRows.isEmpty {
                        LoadingView(branded: true, title: localeService.t("Ránking UCI", "UCI ranking"))
                    } else if let rankingError, rankingRows.isEmpty {
                        ErrorView(message: rankingError) {
                            Task { await loadRanking() }
                        }
                    } else {
                        rankingList
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(localeService.t("Resultados", "Results"))
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
        // Push por valor a la pantalla de resultados in-house (data-driven,
        // como en Hoy — NUNCA por destino, corrompe el NavigationStack).
        .navigationDestination(item: $resultsRoute) { route in
            ResultsView(raceId: route.raceId, initialStageNumber: route.stageNumber, initialStageSuffix: route.stageSuffix)
        }
        .alert(item: $rankingExplanation) { item in
            Alert(
                title: Text(item.title),
                message: Text(item.message),
                dismissButton: .default(Text(localeService.t("Cerrar", "Close")))
            )
        }
        .task { await load() }
        .onAppear {
            AnalyticsService.shared.logScreenView("results_feed")
        }
    }

    /// Selector de vista: control segmentado nativo, como el de Fichajes. El
    /// título de la pantalla es el de navegación («Resultados»).
    private var sectionSelector: some View {
        Picker(
            localeService.t("Vista de resultados", "Results view"),
            selection: Binding(
                get: { activeSection },
                set: { selectSection($0) }
            )
        ) {
            Text(localeService.t("Últimos resultados", "Latest results"))
                .tag(ResultsFeedSection.latest)
            Text(localeService.t("Ránking UCI", "UCI ranking"))
                .tag(ResultsFeedSection.ranking)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private func selectSection(_ section: ResultsFeedSection) {
        guard section != activeSection else { return }
        Haptics.play(.selection)
        activeSection = section
        if section == .ranking {
            AnalyticsService.shared.logScreenView("uci_team_ranking")
            if rankingRows.isEmpty {
                Task { await loadRanking() }
            }
        }
    }

    // MARK: - Lista

    /// Grupo de entradas de un mismo día (cabecera + filas).
    private struct FeedDayGroup: Identifiable {
        let date: String
        var entries: [FeedEntry]
        var id: String { date }
    }

    /// Entradas agrupadas por día (vienen ya ordenadas en cronología inversa).
    private var groupedByDay: [FeedDayGroup] {
        var out: [FeedDayGroup] = []
        for e in entries {
            if out.last?.date == e.date {
                out[out.count - 1].entries.append(e)
            } else {
                out.append(FeedDayGroup(date: e.date, entries: [e]))
            }
        }
        return out
    }

    private var feedList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                let columns = AdaptiveLayoutPolicy.feedColumns(
                    width: max(0, contentWidth - 32),
                    isRegular: horizontalSizeClass == .regular
                )
                if entries.isEmpty {
                    EmptyStateView(
                        icon: "trophy",
                        title: localeService.t("Sin resultados", "No results"),
                        subtitle: localeService.t("No hay resultados en este periodo.", "No results in this period.")
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, minHeight: 320)
                } else {
                    let groups = groupedByDay
                    ForEach(groups) { group in
                        // Cabecera de día: fecha larga en idioma de CONTENIDO.
                        Text(DateFormatting.formatDateLongContent(group.date))
                            .ccFont(.s13, weight: .semibold)
                            .foregroundStyle(.secondary)
                            .padding(.top, group.id == groups.first?.id ? 0 : 10)
                            .accessibilityAddTraits(.isHeader)
                        // Ninguna fila ocupa las dos columnas, como la web
                        // (`.feed-day>.feed-row { grid-column: auto }`).
                        let rows = AdaptiveLayoutPolicy.rows(group.entries, columns: columns)
                        ForEach(rows) { row in
                            if columns == 1 || row.spansAllColumns {
                                feedRow(row.items[0])
                            } else {
                                // Misma altura para las tarjetas de la fila: la
                                // fila toma el alto de la más alta.
                                HStack(alignment: .top, spacing: 8) {
                                    ForEach(row.items) { entry in
                                        feedRow(entry)
                                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                                    }
                                    if row.items.count < columns {
                                        Color.clear.frame(maxWidth: .infinity)
                                    }
                                }
                                .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                if fromKey > ResultsFeedLogic.seasonStart {
                    loadMoreButton
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .onGeometryChange(for: CGFloat.self) { geometry in
            geometry.size.width
        } action: { width in
            contentWidth = width
        }
        .refreshable { await load() }
    }

    private func feedRow(_ entry: FeedEntry) -> some View {
        FeedRowView(entry: entry) {
            Haptics.play(.navigation)
            resultsRoute = ResultsRoute(
                raceId: entry.race.id,
                stageNumber: entry.stageNumber,
                stageSuffix: entry.stageSuffix.isEmpty ? nil : entry.stageSuffix
            )
        }
    }

    // MARK: - Ránking UCI

    private var decoratedRanking: [UciTeamRankingPresentation] {
        UciTeamRankingLogic.decorate(rankingRows, gender: rankingGender.rawValue)
    }

    /// Ránking UCI por equipos con la presentación de las clasificaciones:
    /// género y fecha de actualización en una fila, panel «Invitaciones» y
    /// tabla. En pantallas anchas el panel va a la izquierda.
    private var rankingList: some View {
        let ranking = decoratedRanking
        let isEnglish = LocaleService.shouldShowEnglishContent
        let keyItems = UciTeamRankingLogic.keyItems(ranking, isEnglish: isEnglish)
        let wide = AdaptiveLayoutPolicy.usesWideDetail(
            width: contentWidth,
            isRegular: horizontalSizeClass == .regular
        )
        return VStack(spacing: 0) {
            HStack(spacing: 12) {
                Picker(localeService.t("Género del ránking", "Ranking gender"), selection: $rankingGender) {
                    Text(localeService.t("Masculino", "Men")).tag(UciRankingGender.male)
                    Text(localeService.t("Femenino", "Women")).tag(UciRankingGender.female)
                }
                .pickerStyle(.segmented)
                .fixedSize()
                .onChange(of: rankingGender) { _, _ in Haptics.play(.selection) }

                if let rankingDate = ranking.first?.row.rankingDate {
                    Text(DateFormatting.formatUciRankingUpdated(rankingDate))
                        .ccFont(.s12)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)

            if ranking.isEmpty {
                EmptyStateView(
                    icon: "list.number",
                    title: localeService.t("Ránking no disponible", "Ranking unavailable"),
                    subtitle: localeService.t(
                        "La UCI todavía no ha publicado esta clasificación.",
                        "The UCI has not published this ranking yet."
                    )
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    Group {
                        if wide {
                            HStack(alignment: .top, spacing: 24) {
                                if !keyItems.isEmpty {
                                    UciRankingKeyPanel(
                                        year: UciTeamRankingLogic.invitationYear(ranking),
                                        items: keyItems
                                    )
                                    .frame(width: 288)
                                }
                                rankingTable(ranking, isEnglish: isEnglish)
                            }
                        } else {
                            VStack(spacing: 16) {
                                if !keyItems.isEmpty {
                                    UciRankingKeyPanel(
                                        year: UciTeamRankingLogic.invitationYear(ranking),
                                        items: keyItems
                                    )
                                }
                                rankingTable(ranking, isEnglish: isEnglish)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
                .refreshable { await loadRanking() }
            }
        }
    }

    private func rankingTable(_ ranking: [UciTeamRankingPresentation], isEnglish: Bool) -> some View {
        ResultsTableSurface {
            UciRankingTableHeader()
            ResultsTableRule()
            ForEach(Array(ranking.enumerated()), id: \.element.id) { index, item in
                UciRankingRowView(
                    item: item,
                    points: UciTeamRankingLogic.formatPoints(item.row.points, isEnglish: isEnglish)
                ) {
                    let message = item.explanation(isEnglish: isEnglish)
                    guard !message.isEmpty else { return }
                    Haptics.play(.selection)
                    rankingExplanation = UciRankingExplanationItem(
                        id: item.id,
                        title: item.row.displayName,
                        message: message
                    )
                }
                if index < ranking.count - 1 { ResultsTableRule() }
            }
        }
    }

    private var loadMoreButton: some View {
        HStack {
            Spacer()
            Button {
                Haptics.play(.primaryAction)
                Task { await loadMore() }
            } label: {
                if isLoadingMore {
                    ProgressView()
                } else {
                    Text(localeService.t("Cargar más resultados", "Load more results"))
                        .ccFont(.s14, weight: .semibold)
                }
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
            .disabled(isLoadingMore)
            Spacer()
        }
        .padding(.vertical, 12)
    }

    // MARK: - Carga

    private func load() async {
        feedGeneration &+= 1
        let generation = feedGeneration
        if entries.isEmpty { isLoading = true }
        error = nil
        do {
            let loadedEntries = try await SupabaseService.shared.loadResultsFeed(
                from: fromKey,
                to: DateFormatting.todayKey()
            )
            try Task.checkCancellation()
            guard generation == feedGeneration else { return }
            // Commit único: nunca se expone una lista previa a la resolución de
            // ganadores y líderes.
            entries = loadedEntries
            isLoading = false
        } catch is CancellationError {
            // Navegar fuera cancela .task; se conserva el último modelo completo.
            return
        } catch {
            guard generation == feedGeneration else { return }
            self.error = error.localizedDescription
            isLoading = false
        }
    }

    /// Amplía la ventana 14 días más (tope: arranque de temporada). Solo se
    /// descarga el tramo nuevo: las entradas se ordenan primero por fecha y
    /// el tramo es anterior a todo lo cargado, así que se añade al final.
    private func loadMore() async {
        guard !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let previousFrom = fromKey
        let newFrom = ResultsFeedLogic.extendedFromKey(previousFrom)
        guard newFrom < previousFrom else { return }
        feedGeneration &+= 1
        let generation = feedGeneration
        fromKey = newFrom
        do {
            let older = try await SupabaseService.shared.loadResultsFeed(
                from: newFrom,
                to: ResultsFeedLogic.addDays(previousFrom, -1)
            )
            try Task.checkCancellation()
            // Una carga completa posterior ya cubre la ventana ampliada.
            guard generation == feedGeneration else { return }
            let loadedKeys = Set(entries.map(\.key))
            entries += older.filter { !loadedKeys.contains($0.key) }
        } catch {
            guard generation == feedGeneration else { return }
            // El tramo no se cargó: se restaura el inicio de la ventana para
            // que «Cargar más» vuelva a pedirlo.
            fromKey = previousFrom
            if !(error is CancellationError) { self.error = error.localizedDescription }
        }
    }

    private func loadRanking() async {
        if rankingRows.isEmpty { isRankingLoading = true }
        rankingError = nil
        do {
            rankingRows = try await SupabaseService.shared.loadUciTeamRankings()
        } catch {
            if rankingRows.isEmpty {
                rankingError = localeService.t(
                    "No se pudo cargar el ránking UCI.",
                    "The UCI ranking could not be loaded."
                )
            }
        }
        isRankingLoading = false
    }
}

// MARK: - Componentes del ránking UCI

/// Colores de la etiqueta de puesto y de la explicación (`.uci-ranking-legend__item`).
private extension UciRankingKeyStyle {
    var foreground: Color {
        switch self {
        case .worldTour: return Color(light: "0842a0", dark: "aac7ff")
        case .orange: return AppTheme.orange
        case .green: return AppTheme.green
        case .excluded: return AppTheme.red
        }
    }

    var background: Color {
        switch self {
        case .worldTour: return Color(light: "d3e3fd", dark: "333e51")
        case .orange: return AppTheme.orange.opacity(0.16)
        case .green: return AppTheme.green.opacity(0.16)
        case .excluded: return AppTheme.red.opacity(0.14)
        }
    }
}

/// Etiqueta de color de un nivel (puesto y panel explicativo), radio 4.
private struct UciRankingTag: View {
    let text: String
    let style: UciRankingKeyStyle?

    var body: some View {
        Text(text)
            .ccFont(.s12, weight: .semibold)
            .monospacedDigit()
            .foregroundStyle(style?.foreground ?? Color.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                style?.background ?? Color.clear,
                in: RoundedRectangle(cornerRadius: AppTheme.Radius.control)
            )
    }
}

/// Panel «Invitaciones <año>»: cada etiqueta de puesto con su explicación.
private struct UciRankingKeyPanel: View {
    let year: Int
    let items: [UciRankingKeyItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LocaleService.shouldShowEnglishContent ? "Invitations \(year)" : "Invitaciones \(year)")
                .ccFont(.s16, weight: .semibold)
                .accessibilityAddTraits(.isHeader)
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 4) {
                    UciRankingTag(text: item.label, style: item.style)
                    Text(item.text)
                        .ccFont(.s13)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCardSurface()
    }
}

/// Columnas del ránking: puesto (caja común), bandera, equipo, categoría y puntos.
private enum UciRankingColumns {
    static let rank: CGFloat = 38
    static let flag: CGFloat = 20
    static let category: CGFloat = 40
    static let points: CGFloat = 64
}

private struct UciRankingTableHeader: View {
    var body: some View {
        HStack(spacing: ResultsTableMetrics.columnSpacing) {
            ResultsHeaderCell(text: "#").frame(width: UciRankingColumns.rank)
            Color.clear.frame(width: UciRankingColumns.flag, height: 1)
            ResultsHeaderCell(text: LocaleService.t("Equipo", "Team"))
                .frame(maxWidth: .infinity, alignment: .leading)
            ResultsHeaderCell(text: "Cat.").frame(width: UciRankingColumns.category)
            ResultsHeaderCell(text: LocaleService.t("Puntos", "Points"))
                .frame(width: UciRankingColumns.points, alignment: .trailing)
        }
        .padding(.horizontal, ResultsTableMetrics.horizontalPadding)
        .padding(.vertical, ResultsTableMetrics.headerVerticalPadding)
        .accessibilityHidden(true)
    }
}

private struct UciRankingRowView: View {
    let item: UciTeamRankingPresentation
    let points: String
    let onTap: () -> Void

    private var explanation: String {
        item.explanation(isEnglish: LocaleService.shouldShowEnglishContent)
    }

    var body: some View {
        if explanation.isEmpty {
            rowContent
                .accessibilityElement(children: .combine)
        } else {
            Button(action: onTap) { rowContent }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityHint(explanation)
        }
    }

    private var rowContent: some View {
            HStack(spacing: ResultsTableMetrics.columnSpacing) {
                // Todos los puestos comparten caja: las cifras quedan alineadas.
                UciRankingTag(text: "\(item.row.rank)", style: item.rankStyle)
                    .frame(minWidth: 30)
                    .frame(width: UciRankingColumns.rank)
                CountryFlag(countryCode: item.row.countryCode, width: 18)
                    .frame(width: UciRankingColumns.flag)
                Text(item.row.displayName)
                    .ccFont(.s14, weight: .medium)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(item.row.teamCategory ?? "")
                    .ccFont(.s12, weight: .semibold)
                    .foregroundStyle(.secondary)
                    .frame(width: UciRankingColumns.category)
                Text(points)
                    .ccFont(.s14, weight: .semibold)
                    .monospacedDigit()
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(width: UciRankingColumns.points, alignment: .trailing)
            }
            .padding(.horizontal, ResultsTableMetrics.horizontalPadding)
            .padding(.vertical, ResultsTableMetrics.rowVerticalPadding)
            .frame(minHeight: 35)
            .contentShape(Rectangle())
    }
}

// MARK: - Fila del feed

/// Una fila del feed, con el lenguaje visual de las cards de Hoy.
private struct FeedRowView: View {
    let entry: FeedEntry
    let onTap: () -> Void

    private var race: Race { entry.race }
    private var rd: RaceDay? { entry.rd }

    /// Etiqueta de etapa: prólogo/Etapa N; pruebas de un día SIN etiqueta.
    private var stageLabelText: String {
        if let sn = entry.stageNumber {
            return sn == 0
                ? LocaleService.t("Prólogo", "Prologue")
                : "\(LocaleService.t("Etapa", "Stage")) \(sn)\(entry.stageSuffix)"
        }
        return ""
    }

    /// Línea 2: número de etapa, kilometraje y desnivel acumulado.
    /// (Las generales finales llevan solo su etiqueta; un día: sin etiqueta.)
    private var subtitleText: Text? {
        let separator = Text(" · ")
        var result: Text? = nil
        func append(_ part: Text) {
            result = result.map { $0 + separator + part } ?? part
        }
        if !stageLabelText.isEmpty {
            append(Text(stageLabelText).fontWeight(.semibold))
        }
        if let dist = rd?.distanceFormatted, !dist.isEmpty {
            append(Text(dist).fontWeight(.semibold))
        }
        if let elevation = rd?.elevationGainFormatted, !elevation.isEmpty {
            append(Text(elevation))
        }
        return result
    }

    var body: some View {
        Button {
            onTap()
        } label: {
            CCCard {
                ZStack(alignment: .trailing) {
                    HStack(alignment: entry.isFeatured ? .top : .center, spacing: 10) {
                        // Columna izquierda: logo de carrera con la bandera debajo.
                        VStack(spacing: 3) {
                            RaceLogo(race.logoUrl, size: 36)
                            // Bandera de la ETAPA: el país propio de la jornada
                            // (rd.countryCode) prevalece sobre el de la carrera, y
                            // vence también al hideFlag cuando está fijado (espejo
                            // de Android y de la web — effectiveCountryCode).
                            if !race.hideFlag || rd?.countryCode != nil {
                                CountryFlag(countryCode: rd?.countryCode ?? race.countryCode, width: 18)
                            }
                        }

                        VStack(alignment: .leading, spacing: 3) {
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                // Nombre completo: pasa a una segunda línea en
                                // lugar de cortarse («sub23 masculino/femenino»).
                                Text(race.localizedName)
                                    .ccFont(.s16, weight: .semibold)
                                    .fixedSize(horizontal: false, vertical: true)
                                if RaceLogic.shouldShowFemaleIndicator(race) {
                                    Text("♀")
                                        .ccFont(.s12)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            if entry.isGcFinal {
                                Text(LocaleService.t("General final", "Final GC"))
                                    .ccFont(.s13, weight: .semibold)
                                    .foregroundStyle(.secondary)
                            } else {
                                // HStack (no FlowLayout): el flow mide el texto a su
                                // ancho IDEAL y el lineLimit nunca truncaba — la línea
                                // "Etapa N · km · desnivel" rebosaba la card. Así
                                // el texto se comprime con puntos suspensivos y el
                                // badge conserva su tamaño.
                                HStack(spacing: 6) {
                                    if let subtitle = subtitleText {
                                        subtitle
                                            .ccFont(.s13)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                            .truncationMode(.tail)
                                    }
                                    // Badge de tipo solo para contrarrelojes.
                                    if let rd, rd.primaryType == "itt" || rd.primaryType == "ttt" {
                                        StageTypeBadge(
                                            primaryType: rd.primaryType,
                                            secondaryType: rd.primaryType == "itt" && ["chrono_climb", "summit_finish"].contains(rd.secondaryType ?? "") ? rd.secondaryType : nil,
                                            countryCode: rd.countryCode ?? race.countryCode,
                                            compact: true
                                        )
                                        .fixedSize()
                                        .layoutPriority(1)
                                    }
                                }
                            }

                            if entry.kind == .inhouse, !entry.winner.isEmpty {
                                HStack(spacing: 4) {
                                    Image(systemName: "trophy")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .accessibilityHidden(true)
                                    Text(entry.winner)
                                        .ccFont(.s13, weight: .semibold)
                                        .lineLimit(1)
                                }
                            }

                            if entry.isFeatured, !entry.complementary.isEmpty {
                                Divider().padding(.vertical, 2)
                                ForEach(entry.complementary) { item in
                                    HStack(spacing: 6) {
                                        if let hex = item.colorHex {
                                            Circle().fill(Color(hex: hex)).frame(width: 7, height: 7)
                                        }
                                        Text(item.localizedLabel)
                                            .ccFont(.s12, weight: .semibold)
                                            .foregroundStyle(.secondary)
                                        if !item.winner.isEmpty {
                                            Text(item.winner).ccFont(.s12).lineLimit(1)
                                        }
                                    }
                                }
                            }
                        }

                        Spacer(minLength: 16)
                    }

                    RaceCardChevron()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                // En dos columnas, las tarjetas de una fila igualan su alto.
                .frame(maxHeight: .infinity)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(LocaleService.t(
            "Pulsa dos veces para ver las clasificaciones",
            "Double tap to view classifications"
        ))
        .accessibilityIdentifier(AccessibilityID.feedCard(entry.id))
    }

    private var accessibilityText: String {
        var parts: [String] = [race.localizedName]
        if entry.isGcFinal {
            parts.append(LocaleService.t("General final", "Final GC"))
        } else if !stageLabelText.isEmpty {
            parts.append(stageLabelText)
        }
        if !entry.winner.isEmpty {
            parts.append("\(LocaleService.t("Ganador", "Winner")): \(entry.winner)")
        }
        return parts.joined(separator: ", ")
    }
}
