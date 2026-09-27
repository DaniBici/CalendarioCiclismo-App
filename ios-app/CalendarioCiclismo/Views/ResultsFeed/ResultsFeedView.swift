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
/// Filas con el lenguaje visual de las cards de Hoy (`RaceCardView`): CCCard
/// con tinte del color de la carrera, logo + bandera, "Etapa N · km · desnivel"
/// + badge de tipo solo para contrarrelojes, y el ganador con trofeo. Cada fila
/// abre su clasificación propia mediante `ResultsRoute`.
struct ResultsFeedView: View {
    @State private var entries: [FeedEntry] = []
    @State private var isLoading = true
    @State private var error: String?
    /// Inicio de la ventana cargada (se amplía con "Cargar más").
    @State private var fromKey = ResultsFeedLogic.initialFromKey()
    @State private var isLoadingMore = false
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
                        LoadingView(message: localeService.t("Cargando resultados...", "Loading results..."), branded: true)
                    } else if let error, entries.isEmpty {
                        ErrorView(message: error) {
                            Task { await load() }
                        }
                    } else {
                        feedList
                    }
                case .ranking:
                    if isRankingLoading && rankingRows.isEmpty {
                        LoadingView(message: localeService.t("Cargando ránking UCI...", "Loading UCI ranking..."), branded: true)
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

    private var sectionSelector: some View {
        HStack(spacing: 8) {
            sectionChip(
                localeService.t("Últimos Resultados", "Latest Results"),
                selected: activeSection == .latest
            ) {
                activeSection = .latest
            }
            sectionChip(
                localeService.t("Ránking UCI", "UCI Ranking"),
                selected: activeSection == .ranking
            ) {
                activeSection = .ranking
                AnalyticsService.shared.logScreenView("uci_team_ranking")
                if rankingRows.isEmpty {
                    Task { await loadRanking() }
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func sectionChip(
        _ label: String,
        selected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            Haptics.play(.selection)
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
                    ForEach(groupedByDay) { group in
                        // Cabecera de día: fecha larga en idioma de CONTENIDO.
                        Text(DateFormatting.formatDateLongContent(group.date))
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundStyle(.secondary)
                            .padding(.top, 8)
                            .accessibilityAddTraits(.isHeader)
                        let rows = AdaptiveLayoutPolicy.rows(
                            group.entries,
                            columns: columns,
                            spansAllColumns: { _ in group.entries.count == 1 }
                        )
                        ForEach(rows) { row in
                            if columns == 1 || row.spansAllColumns {
                                feedRow(row.items[0])
                            } else {
                                HStack(alignment: .top, spacing: 8) {
                                    ForEach(row.items) { entry in
                                        feedRow(entry)
                                            .frame(maxWidth: .infinity, alignment: .top)
                                    }
                                    if row.items.count < columns {
                                        Color.clear.frame(maxWidth: .infinity)
                                    }
                                }
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

    private var rankingList: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                sectionChip(
                    localeService.t("Masculino", "Men"),
                    selected: rankingGender == .male
                ) { rankingGender = .male }
                sectionChip(
                    localeService.t("Femenino", "Women"),
                    selected: rankingGender == .female
                ) { rankingGender = .female }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            if let rankingDate = decoratedRanking.first?.row.rankingDate {
                Text(DateFormatting.formatUciRankingUpdated(rankingDate))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if decoratedRanking.isEmpty {
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
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Section {
                            ForEach(decoratedRanking) { item in
                                UciRankingRowView(item: item) {
                                    let message = item.explanation(isEnglish: LocaleService.isEnglish)
                                    guard !message.isEmpty else { return }
                                    Haptics.play(.selection)
                                    rankingExplanation = UciRankingExplanationItem(
                                        id: item.id,
                                        title: item.row.displayName,
                                        message: message
                                    )
                                }
                            }
                        } header: {
                            UciRankingTableHeader()
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                }
                .refreshable { await loadRanking() }
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
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
            }
            .buttonStyle(.bordered)
            .disabled(isLoadingMore)
            Spacer()
        }
        .padding(.vertical, 12)
    }

    // MARK: - Carga

    private func load() async {
        if entries.isEmpty { isLoading = true }
        error = nil
        do {
            let loadedEntries = try await SupabaseService.shared.loadResultsFeed(
                from: fromKey,
                to: DateFormatting.todayKey()
            )
            try Task.checkCancellation()
            // Commit único: nunca se expone una lista previa a la resolución de
            // ganadores y líderes.
            entries = loadedEntries
            isLoading = false
        } catch is CancellationError {
            // Navegar fuera cancela .task; se conserva el último modelo completo.
            return
        } catch {
            self.error = error.localizedDescription
            isLoading = false
        }
    }

    /// Amplía la ventana 14 días más (tope: arranque de temporada) y recarga
    /// el rango completo, como la web.
    private func loadMore() async {
        guard !isLoadingMore else { return }
        isLoadingMore = true
        fromKey = ResultsFeedLogic.extendedFromKey(fromKey)
        await load()
        isLoadingMore = false
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

private struct UciRankingTableHeader: View {
    var body: some View {
        HStack(spacing: 7) {
            Text("#").frame(width: 27, alignment: .trailing)
            Color.clear.frame(width: 18)
            Text(LocaleService.t("Equipo", "Team")).frame(maxWidth: .infinity, alignment: .leading)
            Text("Cat.").frame(width: 32)
            Text(LocaleService.t("Puntos", "Points")).frame(width: 68, alignment: .trailing)
        }
        .font(.caption2)
        .fontWeight(.bold)
        .textCase(.uppercase)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(AppTheme.background)
        .accessibilityHidden(true)
    }
}

private struct UciRankingRowView: View {
    let item: UciTeamRankingPresentation
    let onTap: () -> Void

    private var background: Color {
        if item.grandTourExcluded {
            return AppTheme.red.opacity(0.13)
        }
        return switch item.invitationTier {
        case .worldTour:
            AppTheme.categoryBadgeColor(for: "1.UWT").background
        case .allWorldTour, .womensWorldTour:
            AppTheme.orange.opacity(0.15)
        case .proSeries:
            AppTheme.green.opacity(0.15)
        case .standard:
            Color.clear
        }
    }

    private var explanation: String {
        item.explanation(isEnglish: LocaleService.isEnglish)
    }

    var body: some View {
        HStack(spacing: 7) {
            Text("\(item.row.rank)")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .frame(width: 27, alignment: .trailing)
            CountryFlag(countryCode: item.row.countryCode, width: 18)
                .frame(width: 18)
            Text(item.row.displayName)
                .font(.footnote)
                .fontWeight(.semibold)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(item.row.teamCategory ?? "")
                .font(.caption2)
                .fontWeight(.bold)
                .foregroundStyle(.secondary)
                .frame(width: 32)
            Text(item.row.points.formatted(.number.precision(.fractionLength(0))))
                .font(.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(width: 68, alignment: .trailing)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(background)
        .overlay(alignment: .bottom) {
            Divider()
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .accessibilityElement(children: .combine)
        .accessibilityHint(explanation)
        .accessibilityAddTraits(explanation.isEmpty ? [] : .isButton)
    }
}

// MARK: - Fila del feed

/// Una fila del feed, con el lenguaje visual de las cards de Hoy.
private struct FeedRowView: View {
    let entry: FeedEntry
    let onTap: () -> Void

    private var race: Race { entry.race }
    private var rd: RaceDay? { entry.rd }

    /// Tinte de la carrera (como `stripeColor` en RaceCardView).
    private var accent: Color {
        if let hex = race.colorHex, !hex.isEmpty {
            return Color(hex: hex)
        }
        return .gray
    }

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
            CCCard(
                accent: accent,
                accentAlpha: 0.04,
                cornerRadius: 14,
                showShadow: false
            ) {
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
                            HStack(spacing: 4) {
                                Text(race.localizedName)
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .lineLimit(1)
                                if RaceLogic.shouldShowFemaleIndicator(race) {
                                    Text("♀")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.green)
                                }
                            }

                            if entry.isGcFinal {
                                Text(LocaleService.t("General final", "Final GC"))
                                    .font(.caption)
                                    .fontWeight(.semibold)
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
                                            .font(.caption)
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
                                        .font(.caption)
                                        .fontWeight(.semibold)
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
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(.secondary)
                                        if !item.winner.isEmpty {
                                            Text(item.winner).font(.caption2).lineLimit(1)
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
