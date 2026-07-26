import SwiftUI

/// Pestaña "Resultados" — feed "Últimos resultados" (apps 3.1, fase F3).
/// Réplica nativa de `js/resultados-feed.js` (`renderResultsFeed`): cronología
/// inversa agrupada por día, ventana de 14 días + "Cargar más" hasta el
/// arranque de temporada. Espejo de `ResultsFeedScreen` (Android).
///
/// Filas con el lenguaje visual de las cards de Hoy (`RaceCardView`): CCCard
/// con tinte del color de la carrera, logo + bandera, "Etapa N · salida › meta
/// · km" + badges de tipo, y el ganador con trofeo. Tap in-house → pantalla
/// nativa de resultados (push POR VALOR con `ResultsRoute`); filas EXT → la
/// sheet externos existente.
struct ResultsFeedView: View {
    @State private var entries: [FeedEntry] = []
    @State private var isLoading = true
    @State private var error: String?
    /// Inicio de la ventana cargada (se amplía con "Cargar más").
    @State private var fromKey = ResultsFeedLogic.initialFromKey()
    @State private var isLoadingMore = false
    /// Push por valor a la pantalla de resultados in-house.
    @State private var resultsRoute: ResultsRoute?
    /// Sheet externos para las filas EXT (sin volcado in-house).
    @State private var resultsSheetItem: ResultsSheetItem?
    @State private var localeService = LocaleService.shared

    var body: some View {
        Group {
            if isLoading && entries.isEmpty {
                LoadingView(message: localeService.t("Cargando resultados...", "Loading results..."), branded: true)
            } else if let error, entries.isEmpty {
                ErrorView(message: error) {
                    Task { await load() }
                }
            } else {
                feedList
            }
        }
        .navigationTitle(localeService.t("Últimos Resultados", "Latest Results"))
        .navigationBarTitleDisplayMode(.inline)
        // Push por valor a la pantalla de resultados in-house (data-driven,
        // como en Hoy — NUNCA por destino, corrompe el NavigationStack).
        .navigationDestination(item: $resultsRoute) { route in
            ResultsView(raceId: route.raceId, initialStageNumber: route.stageNumber, initialStageSuffix: route.stageSuffix)
        }
        .resultsSheet(item: $resultsSheetItem)
        .task { await load() }
        .onAppear {
            AnalyticsService.shared.logScreenView("results_feed")
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
                        ForEach(group.entries) { entry in
                            FeedRowView(entry: entry) {
                                Haptics.play(.navigation)
                                if entry.kind == .inhouse {
                                    resultsRoute = ResultsRoute(raceId: entry.race.id, stageNumber: entry.stageNumber)
                                } else if let rd = entry.rd {
                                    resultsSheetItem = ResultsSheetItem(race: entry.race, raceDay: rd)
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
        .refreshable { await load() }
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
            entries = try await SupabaseService.shared.loadResultsFeed(
                from: fromKey,
                to: DateFormatting.todayKey()
            )
            isLoading = false
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
                : "\(LocaleService.t("Etapa", "Stage")) \(sn)"
        }
        return ""
    }

    /// "salida › meta" (campo EN cuando la UI va en inglés, espejo de rdLocation).
    private var routeText: String {
        guard let rd else { return "" }
        let isEn = LocaleService.isEnglish
        let start = (isEn && rd.startLocationEn?.isEmpty == false ? rd.startLocationEn : rd.startLocation) ?? ""
        let finish = (isEn && rd.finishLocationEn?.isEmpty == false ? rd.finishLocationEn : rd.finishLocation) ?? ""
        if finish.isEmpty || start == finish { return start.isEmpty ? finish : start }
        if start.isEmpty { return finish }
        return "\(start) › \(finish)"
    }

    /// Línea 2: "Etapa N" y el kilometraje en NEGRITA · salida › meta.
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
        if !routeText.isEmpty {
            append(Text(routeText))
        }
        if let dist = rd?.distanceFormatted, !dist.isEmpty {
            append(Text(dist).fontWeight(.semibold))
        }
        return result
    }

    var body: some View {
        Button {
            onTap()
        } label: {
            // General final: tinte algo más fuerte que el de las filas normales.
            CCCard(
                accent: accent,
                accentAlpha: entry.isGcFinal ? 0.10 : 0.04,
                cornerRadius: 14,
                showShadow: false
            ) {
                HStack(spacing: 10) {
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
                            // "Etapa N · salida › meta · km" rebosaba la card. Así
                            // el texto se comprime con puntos suspensivos y el
                            // badge conserva su tamaño.
                            HStack(spacing: 4) {
                                if let subtitle = subtitleText {
                                    subtitle
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                }
                                // Badges de tipo reducidos (los de las cards).
                                if let rd, rd.primaryType?.isEmpty == false {
                                    StageTypeBadge(
                                        primaryType: rd.primaryType,
                                        secondaryType: rd.secondaryType,
                                        countryCode: rd.countryCode ?? race.countryCode
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
                    }

                    Spacer(minLength: 0)

                    Image(systemName: entry.kind == .inhouse ? "chevron.right" : "arrow.up.right.square")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(entry.kind == .inhouse
            ? LocaleService.t("Pulsa dos veces para ver las clasificaciones", "Double tap to view classifications")
            : LocaleService.t("Pulsa dos veces para ver los resultados externos", "Double tap to view external results"))
        .accessibilityIdentifier(AccessibilityID.feedCard(entry.id))
    }

    private var accessibilityText: String {
        var parts: [String] = [race.localizedName]
        if entry.isGcFinal {
            parts.append(LocaleService.t("General final", "Final GC"))
        } else if !stageLabelText.isEmpty {
            parts.append(stageLabelText)
        }
        if entry.kind == .inhouse, !entry.winner.isEmpty {
            parts.append("\(LocaleService.t("Ganador", "Winner")): \(entry.winner)")
        }
        return parts.joined(separator: ", ")
    }
}
