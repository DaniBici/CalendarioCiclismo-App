import SwiftUI

/// Valor de navegación para empujar la pantalla de Campeonatos por valor (no por
/// destino), evitando mezclar estilos de NavigationLink en un stack guiado por
/// `NavigationPath` (lo que corrompía la navegación de las filas).
///
/// `Identifiable` (id constante) para poder empujarla también con
/// `navigationDestination(item:)` desde un root estable (ver TodayView, donde el
/// cintillo NO puede ser el dueño del push porque se recrea cada 5 s).
struct ChampionshipsRoute: Hashable, Identifiable {
    var id: String { "championships" }
}

/// Destino de navegación de una celda de prueba a su detalle de etapa. Clave
/// ESTABLE = solo el `raceDayId` de la jornada.
///
/// ⚠️ Antes la celda empujaba el `EnrichedRaceDay` directamente
/// (`NavigationLink(value: item)`). Pero `EnrichedRaceDay.==` compara campos
/// VOLÁTILES (tvStatus, horas, broadcasts, assets, updatedAt…) mientras que su
/// `hash(into:)` solo usa el `id`: en cuanto el ViewModel recarga o el badge de
/// TV/hora de meta se refresca, la instancia recreada para la MISMA jornada deja
/// de ser `==` a la que está en el `NavigationPath` → SwiftUI considera que el
/// valor de ruta "cambió", desapila la entrada y vuelve a Campeonatos (el detalle
/// solo aparece al pulsar "atrás"). Empujar una ruta ligera con identidad estable
/// por `raceDayId` rompe ese ciclo. Mismo patrón que `ResultsRoute`.
struct ChampionshipStageRoute: Hashable {
    let raceDayId: String
}

/// Destino de una celda con resultados in-house → pantalla NATIVA de resultados.
/// Ruta propia (no la `ResultsRoute` de TodayView, que es item-based) para empujar
/// por valor con `NavigationLink`, igual que `ChampionshipStageRoute`.
struct ChampionshipResultsRoute: Hashable {
    let raceId: String
    let stageNumber: Int?
}

/// Modo Campeonatos — rejilla país × pruebas de los Campeonatos Nacionales.
/// Port nativo de `campeonatos-nacionales-2026.html` / `js/campeonatos.js`.
/// En móvil la rejilla horizontal de la web se traduce a una tarjeta por país
/// con sus pruebas apiladas. Cada prueba navega al detalle de etapa existente.
///
/// Se renderiza dentro del `NavigationStack` de Hoy (takeover en la semana de
/// campeonatos, o empujada desde el botón "Modo Campeonatos"), de modo que el
/// `navigationDestination(for: EnrichedRaceDay.self)` de TodayView resuelve la
/// navegación a `StageDetailView`.
struct ChampionshipsView: View {
    /// Embebida en el takeover del tab Hoy → el título va inline (no hay barra
    /// propia, la del tab dice "Hoy"). Empujada como pantalla → el título va en
    /// la barra de navegación, igual que etapas y carreras.
    var embedded: Bool = false

    @State private var viewModel = ChampionshipsViewModel()

    private var navTitle: String { "\(ChampionshipsConfig.title) \(String(ChampionshipsConfig.year))" }

    var body: some View {
        if embedded {
            // Takeover: la barra del tab Hoy ya muestra su título; el de
            // campeonatos va inline dentro del scroll.
            content
        } else {
            content
                .navigationTitle(navTitle)
                .navigationBarTitleDisplayMode(.inline)
        }
    }

    @ViewBuilder private var content: some View {
        Group {
            if viewModel.isLoading && viewModel.countries.isEmpty {
                LoadingView(branded: true, title: LocaleService.t("Campeonatos nacionales", "National championships"))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = viewModel.error, viewModel.countries.isEmpty {
                ErrorView(message: error) {
                    Task { await viewModel.load() }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        // Solo embebida: el título va inline. Empujada como
                        // pantalla, lo lleva la barra de navegación.
                        if embedded {
                            Text(navTitle)
                                .ccFont(.s20, weight: .bold)
                                .padding(.horizontal)
                                .padding(.top, 8)
                        }

                        filterChips

                        if viewModel.displayCountries.isEmpty {
                            EmptyStateView(
                                icon: "flag.checkered",
                                title: LocaleService.t("Sin campeonatos", "No championships"),
                                subtitle: LocaleService.t("Aún no hay datos de los campeonatos.", "No championship data available yet.")
                            )
                            .frame(maxWidth: .infinity, minHeight: 280)
                        } else {
                            LazyVStack(spacing: 10) {
                                ForEach(viewModel.displayCountries) { country in
                                    ChampionshipCountryCard(country: country, filter: viewModel.activeFilter, inhouseKeys: viewModel.inhouseKeys)
                                }
                            }
                            .padding(.horizontal)
                            .padding(.bottom, 12)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .task {
            guard !viewModel.hasLoaded else { return }
            await viewModel.load()
        }
        // La pantalla de Campeonatos se empuja desde Hoy y desde Temporada, que
        // registran destinos distintos. Registrando aquí el destino de la celda,
        // la navegación a etapa funciona sea cual sea el padre (y no depende de
        // que el padre haya registrado `EnrichedRaceDay`).
        .navigationDestination(for: ChampionshipStageRoute.self) { route in
            StageDetailView(raceDayId: route.raceDayId)
        }
        .navigationDestination(for: ChampionshipResultsRoute.self) { route in
            ResultsView(raceId: route.raceId, initialStageNumber: route.stageNumber)
        }
    }

    // MARK: - Filter chips

    @ViewBuilder private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(ChampionshipsConfig.visibleFilters) { filter in
                    let isActive = viewModel.activeFilter == filter
                    Button {
                        guard !isActive else { return }
                        Haptics.play(.selection)
                        viewModel.activeFilter = filter
                    } label: {
                        CalendarFilterChipLabel(label: filter.label, isActive: isActive)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isActive ? [.isSelected] : [])
                    .accessibilityLabel("\(LocaleService.t("Filtro", "Filter")) \(filter.label)")
                }
            }
            .padding(.horizontal)
        }
    }
}

// MARK: - Country card

/// Tarjeta de un país: cabecera (bandera + nombre + sede) y sus pruebas en una
/// rejilla compacta de celdas (4 por fila). Reduce las filas frente a la lista
/// vertical: 8 pruebas → 2 filas de celdas, no 8 filas.
private struct ChampionshipCountryCard: View {
    let country: ChampionshipCountry
    let filter: ChampionshipsConfig.Filter
    var inhouseKeys: Set<String> = []

    private let columns = 4

    var body: some View {
        let slots = country.visibleSlots(filter: filter)
        let rows = stride(from: 0, to: slots.count, by: columns).map {
            Array(slots[$0..<min($0 + columns, slots.count)])
        }
        CCCard {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    CountryFlag(countryCode: country.countryCode)
                    Text(AccessibilityCountryNames.name(for: country.countryCode) ?? country.countryCode)
                        .ccFont(.s14, weight: .semibold)
                    if let sede = country.hostCity, !sede.isEmpty {
                        Text("· \(sede)")
                            .ccFont(.s12)
                            .foregroundStyle(AppTheme.textMuted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }

                Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                    ForEach(rows.indices, id: \.self) { r in
                        GridRow {
                            ForEach(rows[r], id: \.self) { slot in
                                if let enriched = country.slots[slot] {
                                    ChampionshipEventCell(slot: slot, item: enriched, inhouseKeys: inhouseKeys)
                                }
                            }
                            // Relleno para mantener anchos uniformes en la última fila.
                            if rows[r].count < columns {
                                ForEach(0..<(columns - rows[r].count), id: \.self) { _ in
                                    Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                                }
                            }
                        }
                    }
                }
            }
            .padding(10)
        }
    }
}

// MARK: - Event cell

/// Celda compacta de una prueba: etiqueta corta (género · disciplina) + día +
/// indicador de estado. Por prioridad (espejo de `eventCell` en js/campeonatos.js):
/// con clasificaciones propias → trofeo a la pantalla nativa; si no, concluida →
/// sello; con TV → badge de TV (Live / hora / "TV"); si no → hora de meta con
/// bandera. El cuerpo navega al detalle.
private struct ChampionshipEventCell: View {
    let slot: ChampionshipsConfig.Slot
    let item: EnrichedRaceDay
    var inhouseKeys: Set<String> = []

    @State private var regionService = RegionService.shared

    private var rd: RaceDay { item.raceDay }
    private var concluded: Bool { RaceLogic.isRaceConcluded(rd: rd) }
    /// ¿Hay clasificaciones in-house para esta prueba? → el trofeo lleva a la
    /// pantalla NATIVA de resultados (igual que las race cards de Hoy/competición).
    private var hasInhouse: Bool {
        guard let raceId = item.race?.id else { return false }
        return inhouseKeys.contains(SupabaseService.inhouseKey(raceId: raceId, stageNumber: rd.stageNumber))
    }
    /// Broadcasts visibles para la región del usuario. El badge de TV de la celda
    /// debe respetar la preferencia regional igual que las race cards / la web (que
    /// pre-filtra), o un usuario de España vería la TV del campeonato de Bélgica.
    private var regionBroadcasts: [Broadcast] {
        RaceLogic.filterBroadcastsByRegion(
            item.broadcasts,
            allowedGroups: regionService.allowedBroadcastGroups
        )
    }
    private var hasTvInfo: Bool {
        !regionBroadcasts.isEmpty || (rd.tvStatus.map { !$0.isEmpty } ?? false)
    }
    /// Con resultados propios (trofeo → pantalla nativa) la celda muestra el
    /// trofeo en vez de hora/TV.
    private var showResults: Bool { hasInhouse }

    var body: some View {
        // Al mostrar resultados la navegación va solo en la cabecera (etiqueta +
        // día); el resto de estados navega desde toda la celda. Mismo reparto que
        // la celda Android, y equivalente al event.stopPropagation() de la web.
        Group {
            if showResults {
                VStack(spacing: 4) {
                    NavigationLink(value: ChampionshipStageRoute(raceDayId: rd.id)) { header }
                        .buttonStyle(.plain)
                    cellDivider
                    resultsRow
                }
                .modifier(CellChrome())
            } else {
                NavigationLink(value: ChampionshipStageRoute(raceDayId: rd.id)) {
                    VStack(spacing: 4) {
                        header
                        cellDivider
                        statusRow
                    }
                    .modifier(CellChrome())
                }
                .buttonStyle(ChampionshipCellStyle())
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(slot.label), \(dayShort)")
        .accessibilityHint(LocaleService.t("Pulsa dos veces para ver el detalle de la prueba", "Double tap to see the event detail"))
    }

    private var header: some View {
        VStack(spacing: 4) {
            Text(slot.shortLabel)
                .ccFont(.s12, weight: .semibold)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .foregroundStyle(.primary)
            cellDivider
            Text(dayShort)
                .ccFont(.s12)
                .foregroundStyle(AppTheme.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    /// Separador fino entre prueba/día y día/estado: línea corta y tenue centrada.
    private var cellDivider: some View {
        Divider().frame(width: 26)
    }

    /// Trofeo de resultados propios: sustituye a hora/TV. Lleva a la pantalla
    /// nativa de clasificaciones.
    @ViewBuilder private var resultsRow: some View {
        if hasInhouse, let raceId = item.race?.id {
            NavigationLink(value: ChampionshipResultsRoute(raceId: raceId, stageNumber: rd.stageNumber)) {
                // Enlace neutro: texto principal sobre el gris de las etiquetas.
                Image(systemName: "trophy.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(AppTheme.neutralFillPressed)
                    .foregroundStyle(AppTheme.textPrimary)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(LocaleService.t("Resultados", "Results"))
        }
    }

    @ViewBuilder private var statusRow: some View {
        if concluded {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 11))
                .foregroundStyle(AppTheme.textMuted)
        } else if hasTvInfo {
            tvBadge
        } else if let finish = rd.estimatedFinishTimeUtc, let time = DateFormatting.formatTimeLocal(finish) {
            // Hora de meta con bandera a cuadros (paridad con la web).
            HStack(spacing: 2) {
                Image(systemName: "flag.checkered")
                    .font(.system(size: 10))
                Text(time)
                    .ccFont(.s12)
                    .monospacedDigit()
            }
            .foregroundStyle(AppTheme.textMuted)
        } else {
            Color.clear.frame(height: 12)
        }
    }

    /// Badge de TV: "Live" si la hora de TV ya pasó, la hora si es futura, o "TV".
    @ViewBuilder private var tvBadge: some View {
        let state = RaceLogic.championshipTvState(broadcasts: regionBroadcasts)
        HStack(spacing: 2) {
            Image(systemName: "tv")
                .font(.system(size: 10))
            switch state {
            case .live:
                Text("Live").ccFont(.s12, weight: .semibold)
            case .time(let t):
                Text(t).ccFont(.s12).monospacedDigit()
            case .label:
                Text("TV").ccFont(.s12)
            }
        }
        // Verde solo en directo; el resto, texto principal neutro.
        .foregroundStyle(state == .live ? AppTheme.green : AppTheme.textPrimary)
    }

    /// Día corto "EEE d" (sin mes — la semana es conocida).
    private var dayShort: String {
        guard let date = DateFormatting.date(from: rd.dateKey) else { return rd.dateKey }
        let f = DateFormatter()
        f.locale = Locale(identifier: LocaleService.isEnglish ? "en_US" : "es_ES")
        f.dateFormat = "EEE d"
        let s = f.string(from: date)
        return s.prefix(1).uppercased() + s.dropFirst()
    }
}

/// Fondo y padding compartidos por la celda de prueba (con o sin botones):
/// superficie gris neutra, sin tinte ni borde.
private struct CellChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .padding(.horizontal, 4)
            .background(AppTheme.neutralFill)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
            .contentShape(Rectangle())
    }
}

/// Pulsación neutra de la celda: gris más intenso.
private struct ChampionshipCellStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(AppTheme.textPrimary)
            .overlay {
                if configuration.isPressed {
                    RoundedRectangle(cornerRadius: AppTheme.Radius.control)
                        .fill(AppTheme.neutralFill)
                        .allowsHitTesting(false)
                }
            }
    }
}
