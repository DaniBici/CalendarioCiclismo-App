import SwiftUI

/// Vista de temporada completa — equivalente a `temporada.html` + `temporada.js`.
/// Muestra un mes por página con deslizamiento horizontal entre meses.
struct SeasonView: View {
    /// Acción del toggle Temporada↔Mes (solo cuando se renderiza dentro de
    /// `CalendarTabView`, apps 3.1). nil = sin botón de alternar.
    var switchAction: (() -> Void)? = nil
    var embedded = false
    var onOpenStage: ((String) -> Void)?
    var onOpenRace: ((Race) -> Void)?
    @State private var viewModel = SeasonViewModel()
    @State private var placeholderItem: PlaceholderModalItem?
    @State private var pendingDefaultFilter: Constants.CategoryFilter? = nil
    @State private var loadingOneDayRaceId: String?
    @State private var loadingStageRaceId: String?
    /// Challenges desplegados (muestran sus pruebas bajo la fila del grupo).
    @State private var expandedChallengeIds: Set<String> = []
    /// Mes visible en el TabView (1-12; 0 = "Todos"). Selección por mes y no
    /// por índice: al filtrar cambian las páginas disponibles y un índice
    /// pasaría a señalar otro mes.
    @State private var currentMonth: Int = 0
    @AppStorage("defaultFilter") private var storedDefaultFilter: String = ""
    @State private var localeService = LocaleService.shared
    @State private var notifications = NotificationManager.shared

    var body: some View {
        VStack(spacing: 0) {
            if embedded {
                HStack(spacing: 10) {
                    Text(localeService.t("Calendario", "Calendar"))
                        .ccFont(.s16, weight: .semibold)
                    Spacer()
                    // Menús nativos con estilo de botón con borde: fuera de la
                    // barra no tienen la cápsula de la barra.
                    yearMenu
                    countryMenu
                }
                .buttonStyle(.bordered)
                .padding(.horizontal)
                .frame(minHeight: 44)
            }
            // Filtros de categoría
            categoryFilterBar

            // Pills de mes — sincronizan con el TabView
            if !viewModel.racesByMonth.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(viewModel.racesByMonth, id: \.month) { group in
                            let isSelected = currentMonth == group.month
                            let label = group.month == 0 ? localeService.t("Todos", "All") : DateFormatting.shortMonthName(group.month)
                            Button {
                                Haptics.play(.navigation)
                                currentMonth = group.month
                            } label: {
                                CalendarMonthChipLabel(label: label, isSelected: isSelected)
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
                LoadingView(branded: true, title: localeService.t("Temporada", "Season"))
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
                        .ccFont(.s14, weight: .medium)
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
                TabView(selection: $currentMonth) {
                    ForEach(viewModel.racesByMonth, id: \.month) { group in
                        monthPageView(
                            month: group.month,
                            races: group.races
                        )
                        .tag(group.month)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .onChange(of: currentMonth) { _, _ in
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
        .background(AppTheme.background.ignoresSafeArea())
        .onAppear {
            AnalyticsService.shared.logScreenView("season", parameters: [
                "year": String(viewModel.year),
                "category_filter": viewModel.activeFilter.rawValue,
                "country_code": viewModel.activeCountry,
            ])
        }
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle(localeService.t("Calendario", "Calendar"))
        .toolbar {
            // Año a la izquierda, como en Mes; país y cambio de vista a la
            // derecha. Menús nativos: el fondo es la cápsula de la barra.
            if !embedded {
                ToolbarItem(placement: .topBarLeading) {
                    yearMenu
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    countryMenu
                    if let switchAction {
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
        }
        .onChange(of: viewModel.year) { _, _ in
            currentMonth = 0
            Task { await viewModel.loadSeason() }
        }
        .onChange(of: notifications.pendingSeasonYear) { _, _ in
            applyPendingSeasonYear()
        }
        .placeholderModal(item: $placeholderItem)
        .task {
            // Apertura desde el cintillo con otro año: carga onChange(of: year).
            if let year = notifications.pendingSeasonYear, year != viewModel.year {
                applyPendingSeasonYear()
                return
            }
            notifications.pendingSeasonYear = nil
            await viewModel.loadSeason()
        }
        .onChange(of: viewModel.isLoading) { _, newValue in
            if !newValue && !viewModel.racesByMonth.isEmpty {
                AccessibilityAnnouncement.announce(LocaleService.t("Temporada \(viewModel.year) cargada", "Season \(viewModel.year) loaded"))
                currentMonth = bestMonth()
            }
        }
        .onChange(of: viewModel.activeFilter) { _, _ in
            syncMonth()
        }
        .onChange(of: viewModel.activeCountry) { _, _ in
            syncMonth()
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

    /// Un elemento de la lista de Temporada: una carrera real, un challenge
    /// (sus pruebas en una fila, como la web) o la fila sintética de
    /// Campeonatos Nacionales (que colapsa todas las CN, como en la vista de
    /// Mes y la web).
    private enum SeasonRow: Identifiable {
        case entry(SeasonEntry)
        case championships
        var id: String {
            switch self {
            case .entry(let entry): return entry.id
            case .championships: return "__championships__"
            }
        }
    }

    /// Agrupa los challenges e intercala la fila de Campeonatos (si procede)
    /// entre las carreras de un mes, ordenada por la fecha de inicio de la
    /// semana de Campeonatos. Solo se inserta en el mes que contiene esa semana
    /// (junio).
    private func rows(for races: [Race], month: Int) -> [SeasonRow] {
        let entries = SeasonChallengeLogic.entries(races: races, groups: viewModel.challengeGroups)
        var items = entries.map { SeasonRow.entry($0) }
        guard viewModel.hasChampionships, month == viewModel.championshipsMonth else {
            return items
        }
        let champDate = viewModel.championshipsSortDate
        // Posición = primera entrada cuya fecha de inicio es posterior a la semana
        // de Campeonatos (las carreras ya vienen ordenadas por startDate).
        let insertAt = entries.firstIndex { ($0.startDate ?? "") > champDate } ?? entries.count
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
                        monthSection(month: group.month, races: group.races)
                    }
                } else {
                    monthSection(month: month, races: races)
                }

                Color.clear.frame(height: 16)
            }
            .padding(.horizontal)
        }
        .background(AppTheme.background)
        .accessibilityIdentifier("season_race_list")
    }

    /// Un mes: rótulo en gris (13 seminegrita, como las demás fechas de grupo)
    /// y sus carreras en una sola superficie de tarjeta, con las filas
    /// separadas por un filete (`.temporada-races` de la web).
    @ViewBuilder
    private func monthSection(month: Int, races: [Race]) -> some View {
        Text(DateFormatting.formatMonthYear(year: viewModel.year, month: month - 1))
            .ccFont(.s13, weight: .semibold)
            .foregroundStyle(AppTheme.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 16)
            .padding(.bottom, 8)
            .accessibilityAddTraits(.isHeader)

        let items = rows(for: races, month: month)
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider() }
                seasonRowView(row)
            }
        }
        .ccCardSurface()
    }

    /// Selector de año de la barra (menú nativo).
    private var yearMenu: some View {
        Menu {
            Picker(localeService.t("Año", "Year"), selection: $viewModel.year) {
                ForEach(viewModel.availableYears, id: \.self) { year in
                    Text(String(year)).tag(year)
                }
            }
        } label: {
            CalendarSelectorLabel(icon: "calendar", label: String(viewModel.year))
        }
        .accessibilityLabel("Año \(viewModel.year)")
        .accessibilityHint("Pulsa dos veces para cambiar de año")
        .accessibilityIdentifier(AccessibilityID.yearPicker)
        .accessibilityInputLabels(["Año", "Cambiar año", "Selector de año"])
    }

    /// Selector de país de la barra (menú nativo).
    private var countryMenu: some View {
        Menu {
            Picker(localeService.t("País", "Country"), selection: $viewModel.activeCountry) {
                Text(localeService.t("Todos los países", "All countries")).tag("all")
                ForEach(viewModel.availableCountries, id: \.code) { country in
                    Text(country.label).tag(country.code)
                }
            }
        } label: {
            CalendarSelectorLabel(
                icon: "globe",
                label: viewModel.activeCountry == "all" ? localeService.t("País", "Country") : viewModel.activeCountry.uppercased()
            )
        }
        .accessibilityLabel(viewModel.activeCountry == "all" ? localeService.t("Todos los países", "All countries") : "\(localeService.t("País", "Country")): \(AccessibilityCountryNames.name(for: viewModel.activeCountry) ?? viewModel.activeCountry)")
        .accessibilityHint("Pulsa dos veces para filtrar por país")
        .accessibilityIdentifier(AccessibilityID.countryPicker)
        .accessibilityInputLabels(["País", "Filtrar país", "Selector de país"])
    }

    /// Agrupa las carreras de la página "Todos" por mes calendario, ordenadas.
    private func allPageGroups(from races: [Race]) -> [(month: Int, races: [Race])] {
        viewModel.groupedByMonth(races)
    }

    @ViewBuilder
    private func seasonRowView(_ row: SeasonRow) -> some View {
        switch row {
        case .entry(.race(let race)):
            raceRowView(race: race)
        case .entry(.challenge(let group, let races)):
            challengeRowView(group: group, races: races)
        case .championships:
            NavigationLink(value: ChampionshipsRoute()) {
                SeasonChampionshipsRow()
            }
            .buttonStyle(CalendarPressStyle())
            .simultaneousGesture(TapGesture().onEnded { Haptics.play(.navigation) })
        }
    }

    // MARK: - Challenge row

    /// Fila del challenge: al pulsarla despliega sus pruebas, cada una con su
    /// navegación habitual.
    @ViewBuilder
    private func challengeRowView(group: ChallengeGroup, races: [Race]) -> some View {
        let expanded = expandedChallengeIds.contains(group.id)
        VStack(spacing: 0) {
            Button {
                Haptics.play(.selection)
                withAnimation(.easeInOut(duration: 0.2)) {
                    if expanded { expandedChallengeIds.remove(group.id) } else { expandedChallengeIds.insert(group.id) }
                }
            } label: {
                SeasonChallengeRow(
                    group: group,
                    races: races,
                    displayName: challengeDisplayName(group),
                    showFemale: showFemaleIndicator(for: group),
                    expanded: expanded
                )
            }
            .buttonStyle(CalendarPressStyle())
            .accessibilityLabel("\(group.name), \(races.count) \(localeService.t("carreras", "races"))")
            .accessibilityValue(expanded ? localeService.t("Desplegado", "Expanded") : localeService.t("Plegado", "Collapsed"))
            .accessibilityHint(localeService.t("Pulsa dos veces para ver sus carreras", "Double tap to show its races"))

            if expanded {
                ForEach(races) { race in
                    Divider().padding(.leading, 16)
                    raceRowView(race: race)
                        .padding(.leading, 16)
                }
            }
        }
    }

    private func challengeDisplayName(_ group: ChallengeGroup) -> String {
        let filter = viewModel.activeFilter
        if (filter == .wwt || filter == .female), group.gender == "female" {
            return RaceLogic.cleanFeminineDisplayName(group.name)
        }
        return group.name
    }

    private func showFemaleIndicator(for group: ChallengeGroup) -> Bool {
        let filter = viewModel.activeFilter
        if filter == .wwt || filter == .female { return false }
        return group.gender == "female" && !RaceLogic.nameImpliesFemale(group.name)
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
                    showFemale: showFemaleIndicator(for: race)
                )
            }
            .buttonStyle(CalendarPressStyle())
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
                    showFemale: showFemaleIndicator(for: race)
                )
            }
            .buttonStyle(CalendarPressStyle())
            .disabled(loadingStageRaceId == race.id)
            .id(race.id)
            .accessibilityLabel(AccessibilityRaceDescription.seasonRaceLabel(race: race))
            .accessibilityHint("Pulsa dos veces para ver las etapas")
        }
    }

    // MARK: - Month helpers

    /// Mes que debería mostrarse al cargar o cambiar de año (0 = "Todos").
    /// Regla: seleccionamos el mes en curso por defecto (no "Todos") siempre
    /// que esté presente. Si no lo está (fuera de año / colapsado por país
    /// con <5 carreras), caemos al primer mes real disponible; si tampoco
    /// hay meses reales, seleccionamos "Todos".
    private func bestMonth() -> Int {
        let months = viewModel.racesByMonth.map(\.month)
        // Primer mes real (después de "Todos"); 0 si solo existe "Todos".
        let firstReal = months.first(where: { $0 > 0 }) ?? 0

        guard viewModel.year == Calendar.current.component(.year, from: Date()) else {
            return firstReal
        }

        let current = Calendar.current.component(.month, from: Date())
        if months.contains(current) { return current }
        return months.first(where: { $0 > current }) ?? firstReal
    }

    /// Temporada pedida por el cintillo. Un año distinto recarga vía
    /// onChange(of: year) y se sitúa en su primer mes; el mismo año vuelve al
    /// mes de referencia.
    private func applyPendingSeasonYear() {
        guard let year = notifications.pendingSeasonYear else { return }
        notifications.pendingSeasonYear = nil
        if viewModel.year != year {
            viewModel.year = year
        } else if !viewModel.racesByMonth.isEmpty {
            currentMonth = bestMonth()
        }
    }

    /// Tras cambiar filtro o país: mantiene el mes visible si sigue existiendo
    /// ("Todos" incluido); si no, salta al mejor. Cuando el sistema colapsa a
    /// solo "Todos" (país con <5 carreras) el mes visible desaparece y se
    /// salta a "Todos". Sin carreras se conserva el mes para recuperarlo al
    /// relajar el filtro.
    private func syncMonth() {
        let months = viewModel.racesByMonth.map(\.month)
        guard !months.isEmpty, !months.contains(currentMonth) else { return }
        currentMonth = bestMonth()
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
        if race.isCancelled {
            placeholderItem = PlaceholderModalItem(race: race, raceDay: nil, websiteUrl: race.websiteUrl)
            return
        }
        loadingOneDayRaceId = race.id
        do {
            let days = try await SupabaseService.shared.raceDays(byRaceId: race.id)
            if let first = days.first {
                onOpenStage?(first.id)
            } else {
                placeholderItem = PlaceholderModalItem(race: race, raceDay: nil, websiteUrl: race.websiteUrl)
            }
        } catch {
            placeholderItem = PlaceholderModalItem(race: race, raceDay: nil, websiteUrl: race.websiteUrl)
        }
        loadingOneDayRaceId = nil
    }

    private func handleStageRaceTap(_ race: Race) async {
        if race.isCancelled {
            placeholderItem = PlaceholderModalItem(race: race, raceDay: nil, websiteUrl: race.websiteUrl)
            return
        }
        loadingStageRaceId = race.id
        do {
            let days = try await SupabaseService.shared.raceDays(byRaceId: race.id)
            if days.isEmpty {
                placeholderItem = PlaceholderModalItem(race: race, raceDay: nil, websiteUrl: race.websiteUrl)
            } else {
                onOpenRace?(race)
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
    var body: some View {
        SeasonRowLayout(
            countryCode: nil,
            showFlag: false,
            logo: { CalendarChampionshipsMark() },
            name: { Text(ChampionshipsConfig.title).ccFont(.s14, weight: .medium) },
            dates: "",
            category: "CN",
            trailing: { SeasonRowChevron() }
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ChampionshipsConfig.title)
        .accessibilityHint(LocaleService.t("Pulsa dos veces para ver los campeonatos nacionales", "Double tap to see the national championships"))
    }
}

// MARK: - Season race row

/// Disposición común de una fila de Temporada (`.t-race`): bandera, logotipo,
/// nombre completo (pasa a otra línea en lugar de cortarse), fechas y
/// categoría. Sin superficie propia: la tarjeta es la del mes.
private struct SeasonRowLayout<Logo: View, Name: View, Trailing: View>: View {
    let countryCode: String?
    var showFlag = true
    @ViewBuilder var logo: () -> Logo
    @ViewBuilder var name: () -> Name
    let dates: String
    let category: String?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 10) {
            if showFlag {
                CountryFlag(countryCode: countryCode)
            }

            logo()

            // Una sola línea por fila: el nombre se recorta antes que partir la
            // fila en dos.
            name()
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 6) {
                if !dates.isEmpty {
                    Text(dates)
                        .ccFont(.s13, weight: .semibold)
                        .foregroundStyle(AppTheme.textMuted)
                        .lineLimit(1)
                }
                CategoryBadge(category: category)
            }
            .fixedSize(horizontal: true, vertical: false)

            trailing()
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SeasonRowChevron: View {
    var expanded = false

    var body: some View {
        Image(systemName: "chevron.right")
            .font(.caption)
            .foregroundStyle(.tertiary)
            .rotationEffect(.degrees(expanded ? 90 : 0))
            .accessibilityHidden(true)
    }
}

/// Nombre de carrera con el símbolo femenino a continuación.
@MainActor private func seasonRowName(_ name: String, showFemale: Bool, cancelled: Bool = false) -> some View {
    let title = Text(name).strikethrough(cancelled)
    let female = Text(showFemale ? " ♀" : "").foregroundStyle(AppTheme.green)
    return Text("\(title)\(female)").ccFont(.s14, weight: .medium)
}

/// Fila de carrera en la vista de temporada.
private struct SeasonRaceRow: View {
    let race: Race
    var displayName: String
    var showFemale: Bool = false

    var body: some View {
        SeasonRowLayout(
            countryCode: race.countryCode,
            showFlag: race.hideFlag != true,
            logo: { RaceLogo(race.logoUrl, size: 28) },
            name: { seasonRowName(displayName, showFemale: showFemale, cancelled: race.isCancelled) },
            dates: DateFormatting.formatDateRange(start: race.startDate, end: race.endDate),
            category: race.uciCategory,
            // Sin indicador de carga al pulsar: la navegación llega en cuanto
            // se resuelve la jornada.
            trailing: { SeasonRowChevron() }
        )
        .opacity(race.isCancelled ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
    }
}

/// Fila de un challenge: mismo diseño que `SeasonRaceRow`, con las fechas
/// de la primera a la última prueba y un chevron que gira al desplegar.
private struct SeasonChallengeRow: View {
    let group: ChallengeGroup
    let races: [Race]
    var displayName: String
    var showFemale: Bool = false
    var expanded: Bool = false

    private var dateRange: String {
        let start = races.compactMap(\.startDate).min()
        let end = races.compactMap { $0.endDate ?? $0.startDate }.max()
        return DateFormatting.formatDateRange(start: start, end: end)
    }

    var body: some View {
        SeasonRowLayout(
            countryCode: group.countryCode,
            logo: { RaceLogo(group.logoUrl, size: 28) },
            name: { seasonRowName(displayName, showFemale: showFemale) },
            dates: dateRange,
            category: group.uciCategory ?? races.first?.uciCategory,
            trailing: { SeasonRowChevron(expanded: expanded) }
        )
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
            CalendarFilterChipLabel(
                label: filter.label,
                isActive: isActive,
                pinFilled: pinDisplay == .filled,
                pinOutline: pinDisplay == .outline
            )
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
