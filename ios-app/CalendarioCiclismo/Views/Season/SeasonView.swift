import SwiftUI

/// Vista de temporada completa — equivalente a `temporada.html` + `temporada.js`.
/// Muestra un mes por página con deslizamiento horizontal entre meses.
struct SeasonView: View {
    /// Acción del toggle Temporada↔Mes (solo cuando se renderiza dentro de
    /// `CalendarTabView`, apps 3.1). nil = sin botón de alternar.
    var switchAction: (() -> Void)? = nil
    @State private var viewModel = SeasonViewModel()
    @State private var placeholderItem: PlaceholderModalItem?
    @State private var pendingDefaultFilter: Constants.CategoryFilter? = nil
    @State private var loadingOneDayRaceId: String?
    @State private var oneDayRaceDayId: String?
    @State private var loadingStageRaceId: String?
    @State private var stageRaceNavigationId: String?
    /// Índice de la página (mes) visible en el TabView.
    @State private var currentMonthIndex: Int = 0
    @AppStorage("defaultFilter") private var storedDefaultFilter: String = ""
    @State private var localeService = LocaleService.shared

    var body: some View {
        VStack(spacing: 0) {
            // Filtros de categoría
            categoryFilterBar

            // Pills de mes — sincronizan con el TabView
            if !viewModel.racesByMonth.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(viewModel.racesByMonth.enumerated()), id: \.element.month) { idx, group in
                            let isSelected = currentMonthIndex == idx
                            let label = group.month == 0 ? localeService.t("Todos", "All") : DateFormatting.shortMonthName(group.month)
                            Button {
                                Haptics.play(.navigation)
                                currentMonthIndex = idx
                            } label: {
                                Text(label)
                                    .font(.caption)
                                    // No seleccionado en Normal (no Medium), para casar con
                                    // los chips de filtro: solo el seleccionado lleva peso.
                                    .fontWeight(isSelected ? .semibold : .regular)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    // Azul de marca suave (15%) + texto azul cuando activo.
                                    .background(isSelected ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemBackground))
                                    .foregroundStyle(isSelected ? Color.accentColor : Color(.secondaryLabel))
                                    .clipShape(Capsule())
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                            .accessibilityLabel("Ir a \(label)")
                            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 2)
                    .padding(.bottom, 4)
                }
            }

            if viewModel.isFromCache {
                OfflineBanner(ageLabel: viewModel.cacheAgeLabel)
            }

            if viewModel.isLoading {
                LoadingView(message: localeService.t("Cargando temporada...", "Loading season..."), branded: true)
            } else if viewModel.isUncachedOffline {
                VStack(spacing: 16) {
                    EmptyStateView(
                        icon: "icloud.slash",
                        title: localeService.t("Temporada no disponible offline", "Season not available offline"),
                        subtitle: localeService.t("Esta temporada no está guardada en tu dispositivo. Se cargará automáticamente cuando recuperes la conexión.", "This season is not saved on your device. It will load automatically when you regain connection.")
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    Button {
                        Task { await viewModel.loadSeason() }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.clockwise")
                            Text(localeService.t("Reintentar", "Retry"))
                        }
                        .font(.subheadline)
                        .fontWeight(.medium)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityHint(localeService.t("Intenta cargar los datos de nuevo", "Try loading data again"))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = viewModel.error {
                ErrorView(message: error) {
                    Task { await viewModel.loadSeason() }
                }
            } else if viewModel.racesByMonth.isEmpty {
                EmptyStateView(
                    icon: "calendar.badge.exclamationmark",
                    title: localeService.t("Sin carreras", "No races"),
                    subtitle: localeService.t("No hay carreras que coincidan con los filtros seleccionados.", "No races match the selected filters.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                TabView(selection: $currentMonthIndex) {
                    ForEach(Array(viewModel.racesByMonth.enumerated()), id: \.element.month) { idx, group in
                        monthPageView(
                            month: group.month,
                            races: group.races
                        )
                        .tag(idx)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .onChange(of: currentMonthIndex) { _, _ in
                    Haptics.play(.navigation)
                }
                // El pager (y el scroll de cada página) llega hasta el borde
                // inferior de la pantalla, por DEBAJO de la tab bar flotante de
                // iOS 26: las cards pasan traslúcidas bajo la barra "Liquid
                // Glass" en vez de cortarse en su borde, y el sistema añade el
                // content inset para que el último ítem quede por encima de la
                // barra. Mismo comportamiento que Resultados.
                .ignoresSafeArea(.container, edges: .bottom)
            }
        }
        .onAppear {
            AnalyticsService.shared.logScreenView("season", parameters: [
                "year": String(viewModel.year),
                "category_filter": viewModel.activeFilter.rawValue,
                "country_code": viewModel.activeCountry,
            ])
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            // En iOS 26 el ToolbarItem en .topBarLeading envuelve su contenido en
            // una cápsula de Liquid Glass con tinte de acento propio que PISA el
            // `.background`/`.foregroundStyle` del label — de ahí que el botón
            // «País» inactivo saliera azul sólido en vez de accent-dim, aunque
            // `.buttonStyle(.plain)` sí desactive el estilo de botón. La cápsula
            // la pinta el propio TOOLBAR ITEM, no el botón, así que `.plain` no
            // basta: hay que ocultar su fondo compartido con
            // `.sharedBackgroundVisibility(.hidden)` (iOS 26+) para que manden las
            // cápsulas propias del año/país.
            if #available(iOS 26, *) {
                ToolbarItem(placement: .topBarLeading) {
                    seasonFiltersContent
                }
                .sharedBackgroundVisibility(.hidden)
            } else {
                ToolbarItem(placement: .topBarLeading) {
                    seasonFiltersContent
                }
            }
            // Toggle Temporada→Mes (solo dentro de la pestaña Calendario; las
            // acciones propias de Temporada van en topBarLeading).
            if let switchAction {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.play(.navigation)
                        switchAction()
                    } label: {
                        Image(systemName: "calendar")
                    }
                    .accessibilityLabel(localeService.t("Cambiar a vista de mes", "Switch to month view"))
                }
            }
        }
        .onChange(of: viewModel.year) { _, _ in
            currentMonthIndex = 0
            Task { await viewModel.loadSeason() }
        }
        .navigationDestination(item: $oneDayRaceDayId) { dayId in
            StageDetailView(raceDayId: dayId)
        }
        .navigationDestination(item: $stageRaceNavigationId) { raceId in
            RaceDetailView(raceId: raceId)
        }
        .navigationDestination(for: ChampionshipsRoute.self) { _ in
            ChampionshipsView()
        }
        .placeholderModal(item: $placeholderItem)
        .task { await viewModel.loadSeason() }
        .onChange(of: viewModel.isLoading) { _, newValue in
            if !newValue && !viewModel.racesByMonth.isEmpty {
                AccessibilityAnnouncement.announce(LocaleService.t("Temporada \(viewModel.year) cargada", "Season \(viewModel.year) loaded"))
                currentMonthIndex = bestMonthIndex()
            }
        }
        .onChange(of: viewModel.activeFilter) { _, _ in
            syncMonthIndex()
        }
        .onChange(of: viewModel.activeCountry) { _, _ in
            syncMonthIndex()
        }
        .onChange(of: storedDefaultFilter) { _, newValue in
            if let filter = Constants.CategoryFilter(rawValue: newValue) {
                viewModel.activeFilter = filter
            }
        }
        .alert(
            (pendingDefaultFilter?.rawValue == storedDefaultFilter)
                ? localeService.t("Quitar filtro por defecto", "Remove default filter")
                : localeService.t("Filtro por defecto", "Default filter"),
            isPresented: Binding(get: { pendingDefaultFilter != nil }, set: { if !$0 { pendingDefaultFilter = nil } }),
            presenting: pendingDefaultFilter
        ) { filter in
            if filter.rawValue == storedDefaultFilter {
                Button(localeService.t("Quitar", "Remove"), role: .destructive) {
                    viewModel.clearDefaultFilter()
                    pendingDefaultFilter = nil
                }
            } else {
                Button(localeService.t("Establecer", "Set")) {
                    viewModel.setDefaultFilter(filter)
                    pendingDefaultFilter = nil
                }
            }
            Button(localeService.t("Cancelar", "Cancel"), role: .cancel) { pendingDefaultFilter = nil }
        } message: { filter in
            if filter.rawValue == storedDefaultFilter {
                Text(localeService.t(
                    "Se eliminará «\(filter.label)» como filtro predeterminado y se mostrarán todas las categorías.",
                    "«\(filter.label)» will be removed as the default filter and all categories will be shown."
                ))
            } else {
                Text(localeService.t(
                    "El filtro «\(filter.label)» se aplicará como predeterminado en Hoy, Mes y Temporada.",
                    "The filter «\(filter.label)» will be applied as default in Today, Month and Season."
                ))
            }
        }
    }

    @ViewBuilder
    private var categoryFilterBar: some View {
        if #available(iOS 26.0, *) {
            // En iOS 27 Beta, ScrollEdgeEffectView se extiende bajo la barra
            // superior y absorbe los toques de esta primera fila en hardware.
            categoryFilterScrollView
                .scrollEdgeEffectHidden()
        } else {
            categoryFilterScrollView
        }
    }

    private var categoryFilterScrollView: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Constants.CategoryFilter.allCases) { filter in
                    SeasonFilterChip(
                        filter: filter,
                        isActive: viewModel.activeFilter == filter,
                        activeFilter: viewModel.activeFilter,
                        pinnedRawValue: storedDefaultFilter,
                        onTap: {
                            if viewModel.activeFilter == filter {
                                Haptics.play(.primaryAction)
                                pendingDefaultFilter = filter
                            } else {
                                Haptics.play(.selection)
                                viewModel.activeFilter = filter
                            }
                        }
                    )
                }
            }
            .padding(.horizontal)
            .padding(.top, 4)
            .padding(.bottom, 2)
        }
    }

    // MARK: - Month page

    /// Un elemento de la lista de Temporada: una carrera real o la fila sintética
    /// de Campeonatos Nacionales (que colapsa todas las CN, como en la vista de
    /// Mes y la web).
    private enum SeasonRow: Identifiable {
        case race(Race)
        case championships
        var id: String {
            switch self {
            case .race(let r): return r.id
            case .championships: return "__championships__"
            }
        }
    }

    /// Intercala la fila de Campeonatos (si procede) entre las carreras de un mes,
    /// ordenada por la fecha de inicio de la semana de Campeonatos. Solo se inserta
    /// en el mes que contiene esa semana (junio).
    private func rows(for races: [Race], month: Int) -> [SeasonRow] {
        var items = races.map { SeasonRow.race($0) }
        guard viewModel.hasChampionships, month == viewModel.championshipsMonth else {
            return items
        }
        let champDate = viewModel.championshipsSortDate
        // Posición = primera carrera cuya fecha de inicio es posterior a la semana
        // de Campeonatos (las carreras ya vienen ordenadas por startDate).
        let insertAt = races.firstIndex { ($0.startDate ?? "") > champDate } ?? races.count
        items.insert(.championships, at: insertAt)
        return items
    }

    @ViewBuilder
    private func monthPageView(month: Int, races: [Race]) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if month == 0 {
                    // Página "Todos": todas las carreras filtradas agrupadas por
                    // mes con su propia cabecera. Respeta el mismo orden que
                    // las páginas mensuales individuales.
                    ForEach(allPageGroups(from: races), id: \.month) { group in
                        Text(DateFormatting.formatMonthYear(year: viewModel.year, month: group.month - 1))
                            .font(.title3)
                            .fontWeight(.bold)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal)
                            .padding(.top, 16)
                            .padding(.bottom, 8)
                            .accessibilityAddTraits(.isHeader)

                        ForEach(rows(for: group.races, month: group.month)) { row in
                            seasonRowView(row)
                                .padding(.horizontal)
                                .padding(.bottom, 2)
                        }
                    }
                } else {
                    // Cabecera del mes dentro de la página
                    Text(DateFormatting.formatMonthYear(year: viewModel.year, month: month - 1))
                        .font(.title3)
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.top, 16)
                        .padding(.bottom, 8)
                        .accessibilityAddTraits(.isHeader)

                    ForEach(rows(for: races, month: month)) { row in
                        seasonRowView(row)
                            .padding(.horizontal)
                            .padding(.bottom, 6)
                    }
                }

                Color.clear.frame(height: 16)
            }
        }
        .accessibilityIdentifier("season_race_list")
    }

    /// Cápsulas de Año + País del toolbar (topBarLeading). Extraído para poder
    /// aplicar `.sharedBackgroundVisibility(.hidden)` (iOS 26+) al ToolbarItem
    /// sin duplicar el contenido en cada rama de disponibilidad.
    @ViewBuilder
    private var seasonFiltersContent: some View {
        HStack(spacing: 8) {
            Menu {
                Picker(localeService.t("Año", "Year"), selection: $viewModel.year) {
                    ForEach(viewModel.availableYears, id: \.self) { year in
                        Text(String(year)).tag(year)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "calendar")
                    Text(String(viewModel.year))
                }
                .font(.caption)
                .fontWeight(.medium)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Año \(viewModel.year)")
            .accessibilityHint("Pulsa dos veces para cambiar de año")
            .accessibilityIdentifier(AccessibilityID.yearPicker)
            .accessibilityInputLabels(["Año", "Cambiar año", "Selector de año"])

            Menu {
                Picker(localeService.t("País", "Country"), selection: $viewModel.activeCountry) {
                    Text(localeService.t("Todos los países", "All countries")).tag("all")
                    ForEach(viewModel.availableCountries, id: \.code) { country in
                        Text(country.label).tag(country.code)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "globe")
                    Text(viewModel.activeCountry == "all" ? localeService.t("País", "Country") : viewModel.activeCountry.uppercased())
                }
                .font(.caption)
                .fontWeight(.medium)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                // Idéntico al selector de año «2026» de al lado: fondo azul
                // sólido + contenido blanco, SIN estado condicional. El aspecto
                // "accent-dim con texto azul" para el estado inactivo hacía que
                // en claro el texto+icono salieran del mismo color que el fondo
                // (invisibles) y en oscuro discordaran con el pill de al lado.
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(viewModel.activeCountry == "all" ? localeService.t("Todos los países", "All countries") : "\(localeService.t("País", "Country")): \(AccessibilityCountryNames.name(for: viewModel.activeCountry) ?? viewModel.activeCountry)")
            .accessibilityHint("Pulsa dos veces para filtrar por país")
            .accessibilityIdentifier(AccessibilityID.countryPicker)
            .accessibilityInputLabels(["País", "Filtrar país", "Selector de país"])
        }
    }

    /// Agrupa las carreras de la página "Todos" por mes calendario, ordenadas.
    private func allPageGroups(from races: [Race]) -> [(month: Int, races: [Race])] {
        let grouped = Dictionary(grouping: races) { race -> Int in
            guard let sd = race.startDate, let date = DateFormatting.date(from: sd) else { return 0 }
            return Calendar.current.component(.month, from: date)
        }
        return grouped.keys.sorted().compactMap { m in
            guard m > 0, let list = grouped[m] else { return nil }
            return (month: m, races: list)
        }
    }

    @ViewBuilder
    private func seasonRowView(_ row: SeasonRow) -> some View {
        switch row {
        case .race(let race):
            raceRowView(race: race)
        case .championships:
            NavigationLink(value: ChampionshipsRoute()) {
                SeasonChampionshipsRow()
            }
            .buttonStyle(.plain)
            .simultaneousGesture(TapGesture().onEnded { Haptics.play(.navigation) })
        }
    }

    // MARK: - Race row

    @ViewBuilder
    private func raceRowView(race: Race) -> some View {
        if race.isOneDay {
            Button {
                Haptics.play(.navigation)
                Task { await handleOneDayRaceTap(race) }
            } label: {
                SeasonRaceRow(
                    race: race,
                    displayName: displayName(for: race),
                    showFemale: showFemaleIndicator(for: race),
                    isLoading: loadingOneDayRaceId == race.id
                )
            }
            .buttonStyle(.plain)
            .disabled(loadingOneDayRaceId == race.id)
            .id(race.id)
            .accessibilityLabel(AccessibilityRaceDescription.seasonRaceLabel(race: race))
            .accessibilityHint("Pulsa dos veces para ver el detalle")
        } else {
            Button {
                Haptics.play(.navigation)
                Task { await handleStageRaceTap(race) }
            } label: {
                SeasonRaceRow(
                    race: race,
                    displayName: displayName(for: race),
                    showFemale: showFemaleIndicator(for: race),
                    isLoading: loadingStageRaceId == race.id
                )
            }
            .buttonStyle(.plain)
            .disabled(loadingStageRaceId == race.id)
            .id(race.id)
            .accessibilityLabel(AccessibilityRaceDescription.seasonRaceLabel(race: race))
            .accessibilityHint("Pulsa dos veces para ver las etapas")
        }
    }

    // MARK: - Month index helpers

    /// Índice del mes que debería mostrarse al cargar o cambiar de año.
    /// Regla: seleccionamos el mes en curso por defecto (no "Todos") siempre
    /// que esté presente. Si no lo está (fuera de año / colapsado por país
    /// con <5 carreras), caemos al primer mes real disponible; si tampoco
    /// hay meses reales, seleccionamos "Todos".
    private func bestMonthIndex() -> Int {
        let months = viewModel.racesByMonth.map(\.month)
        guard !months.isEmpty else { return 0 }

        // Solo existe "Todos" (colapsado por país con <5 carreras).
        if months == [0] { return 0 }

        // Índice del primer mes real (después de "Todos").
        let firstRealIdx = months.firstIndex(where: { $0 > 0 }) ?? 0

        guard viewModel.year == Calendar.current.component(.year, from: Date()) else {
            return firstRealIdx
        }

        let current = Calendar.current.component(.month, from: Date())
        if let idx = months.firstIndex(of: current) { return idx }
        if let idx = months.firstIndex(where: { $0 > current && $0 > 0 }) { return idx }
        return firstRealIdx
    }

    /// Tras cambiar filtro o país: intenta mantener el mes actual; si ya no existe, salta al mejor.
    /// Cuando el sistema colapsa a solo "Todos" (país con <5 carreras) saltamos
    /// a "Todos" obligatoriamente. En el resto de casos, si el mes visible
    /// sigue existiendo lo mantenemos — "Todos" (0) también cuenta como
    /// existente y se respeta la elección del usuario.
    private func syncMonthIndex() {
        let months = viewModel.racesByMonth.map(\.month)
        guard !months.isEmpty else {
            currentMonthIndex = 0
            return
        }
        let visibleMonth = currentMonthIndex < viewModel.racesByMonth.count
            ? viewModel.racesByMonth[currentMonthIndex].month
            : nil
        if let m = visibleMonth, let newIdx = months.firstIndex(of: m) {
            currentMonthIndex = newIdx
            return
        }
        currentMonthIndex = bestMonthIndex()
    }

    // MARK: - Display helpers

    private func displayName(for race: Race) -> String {
        let filter = viewModel.activeFilter
        if (filter == .wwt || filter == .female), race.isFemale {
            return RaceLogic.cleanFeminineDisplayName(race.localizedName)
        }
        return race.localizedName
    }

    private func showFemaleIndicator(for race: Race) -> Bool {
        let filter = viewModel.activeFilter
        if filter == .wwt || filter == .female { return false }
        return RaceLogic.shouldShowFemaleIndicator(race)
    }

    // MARK: - One-day race async loading

    private func handleOneDayRaceTap(_ race: Race) async {
        loadingOneDayRaceId = race.id
        do {
            let days = try await SupabaseService.shared.raceDays(byRaceId: race.id)
            if let first = days.first {
                oneDayRaceDayId = first.id
            } else {
                placeholderItem = PlaceholderModalItem(race: race, raceDay: nil, websiteUrl: race.websiteUrl)
            }
        } catch {
            placeholderItem = PlaceholderModalItem(race: race, raceDay: nil, websiteUrl: race.websiteUrl)
        }
        loadingOneDayRaceId = nil
    }

    private func handleStageRaceTap(_ race: Race) async {
        loadingStageRaceId = race.id
        do {
            let days = try await SupabaseService.shared.raceDays(byRaceId: race.id)
            if days.isEmpty {
                placeholderItem = PlaceholderModalItem(race: race, raceDay: nil, websiteUrl: race.websiteUrl)
            } else {
                stageRaceNavigationId = race.id
            }
        } catch {
            placeholderItem = PlaceholderModalItem(race: race, raceDay: nil, websiteUrl: race.websiteUrl)
        }
        loadingStageRaceId = nil
    }
}

// MARK: - Championships row

/// Fila sintética "Campeonatos Nacionales" de la semana 22-28 jun: colapsa todas
/// las CN de la temporada en una sola entrada que enlaza a la pantalla de
/// Campeonatos. Espejo de `MonthChampionshipsRow` (Mes) y de la fila inyectada en
/// `js/temporada.js`.
private struct SeasonChampionshipsRow: View {
    // Azul suave del rediseño (= CAMP.ACCENT de la web).
    private let accent = Color(hex: "1a73e8")

    var body: some View {
        CCCard(
            accent: accent,
            accentAlpha: 0.04,
            cornerRadius: 14,
            showShadow: false
        ) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(accent.opacity(0.12))
                    Image("GlobeEuropeAfrica")
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 17, height: 17)
                        .foregroundStyle(accent)
                }
                .frame(width: 28, height: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(ChampionshipsConfig.title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .lineLimit(1)
                    CategoryBadge(category: "CN")
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 10)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ChampionshipsConfig.title)
        .accessibilityHint(LocaleService.t("Pulsa dos veces para ver los campeonatos nacionales", "Double tap to see the national championships"))
    }
}

// MARK: - Season race row

/// Fila de carrera en la vista de temporada.
private struct SeasonRaceRow: View {
    let race: Race
    var displayName: String
    var showFemale: Bool = false
    var isLoading: Bool = false

    private var raceColor: Color {
        if let hex = race.colorHex, !hex.isEmpty {
            return Color(hex: hex)
        }
        return .gray
    }

    var body: some View {
        // Tarjeta con tono de carrera (CCCard) — mismo lenguaje que Hoy y Mes.
        CCCard(
            accent: raceColor,
            accentAlpha: 0.04,
            cornerRadius: 14,
            showShadow: false
        ) {
            HStack(spacing: 10) {
                RaceLogo(race.logoUrl, size: 28)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        if race.hideFlag != true {
                            CountryFlag(countryCode: race.countryCode)
                        }
                        Text(displayName)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .lineLimit(1)

                        if showFemale {
                            Text("♀")
                                .font(.caption)
                                .foregroundStyle(AppTheme.green)
                        }
                    }

                    HStack(spacing: 6) {
                        CategoryBadge(category: race.uciCategory)

                        Text(DateFormatting.formatDateRange(start: race.startDate, end: race.endDate))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 0)

                if isLoading {
                    ProgressView()
                        .scaleEffect(0.7)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 10)
        }
        .opacity(race.isCancelled ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
    }
}

// MARK: - Filter chip

/// Chip de filtro de categoría para SeasonView.
private struct SeasonFilterChip: View {
    let filter: Constants.CategoryFilter
    let isActive: Bool
    let activeFilter: Constants.CategoryFilter
    let pinnedRawValue: String
    let onTap: () -> Void

    private enum PinDisplay { case filled, outline, hidden }

    private var pinDisplay: PinDisplay {
        if filter == .all || activeFilter == .all { return .hidden }
        let pinned = Constants.CategoryFilter(rawValue: pinnedRawValue)
        if let p = pinned, p != .all, p == filter { return .filled }
        if filter == activeFilter { return .outline }
        return .hidden
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 4) {
                Text(filter.label)
                    .fontWeight(isActive ? .semibold : .regular)
                switch pinDisplay {
                case .filled:
                    Image(systemName: "pin.fill")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                case .outline:
                    Image(systemName: "pin")
                        .font(.system(size: 10))
                        .foregroundStyle(Color.accentColor)
                        .opacity(0.55)
                case .hidden:
                    EmptyView()
                }
            }
            .font(.caption)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            // Activo en azul de marca suave (15%) + texto azul — mismo gesto que el
            // cintillo "Hoy" y el día seleccionado, en vez del azul sólido + blanco.
            .background(isActive ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemBackground))
            .foregroundStyle(isActive ? Color.accentColor : Color(.secondaryLabel))
            .clipShape(Capsule())
            .frame(minHeight: 44)
        }
        // Mantener el Button estándar: los estilos primitivos basados en
        // Gesture siguen perdiendo el toque frente al pager en iOS 27.
        .buttonStyle(.plain)
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
        .accessibilityLabel(pinDisplay == .filled
            ? "\(LocaleService.t("Filtro", "Filter")) \(filter.label), \(LocaleService.t("fijado como predeterminado", "set as default"))"
            : "\(LocaleService.t("Filtro", "Filter")) \(filter.label)")
        .accessibilityHint(isActive
            ? LocaleService.t("Filtro activo. Actívalo de nuevo para establecerlo como filtro por defecto.", "Active filter. Activate it again to set it as the default filter.")
            : LocaleService.t("Pulsa dos veces para filtrar por \(filter.label).", "Double tap to filter by \(filter.label)."))
        .accessibilityIdentifier(AccessibilityID.filterButton(filter.rawValue))
    }
}
