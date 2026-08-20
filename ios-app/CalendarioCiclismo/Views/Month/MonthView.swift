import SwiftUI

/// Vista de calendario mensual — equivalente a `mes.html` + `mes.js`.
/// Muestra un mes por página con deslizamiento horizontal entre meses (como SeasonView).
struct MonthView: View {
    /// Acción del toggle Mes↔Temporada (solo cuando se renderiza dentro de
    /// `CalendarTabView`, apps 3.1). nil = sin botón de alternar.
    var switchAction: (() -> Void)? = nil
    @State private var viewModel = MonthViewModel()
    @State private var currentMonthIndex: Int = Calendar.current.component(.month, from: Date()) - 1
    @State private var placeholderItem: PlaceholderModalItem?
    @State private var pendingDefaultFilter: Constants.CategoryFilter? = nil
    @State private var scrolledToTodayForMonth: String? = nil
    /// Incrementa para forzar scroll-to-today desde el botón "Hoy".
    @State private var scrollToTodayTrigger = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("defaultFilter") private var storedDefaultFilter: String = ""
    @State private var localeService = LocaleService.shared

    var body: some View {
        VStack(spacing: 0) {
            // Filtros de categoría
            categoryFilterBar

            // Pills de mes — sincronizan con el TabView
            ScrollViewReader { pillProxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(0..<12, id: \.self) { idx in
                            let isSelected = currentMonthIndex == idx
                            Button {
                                currentMonthIndex = idx
                            } label: {
                                Text(DateFormatting.shortMonthName(idx + 1))
                                    .font(.caption)
                                    // No seleccionado en Normal (no Medium), para casar con
                                    // los chips de filtro: solo el seleccionado lleva peso.
                                    .fontWeight(isSelected ? .semibold : .regular)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    // Azul de marca suave (15%) + texto azul cuando activo.
                                    .background(isSelected ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemBackground))
                                    .foregroundStyle(isSelected ? Color.accentColor : Color(.secondaryLabel))
                                    // Cápsula redondeada, igual que las pills de mes de Temporada.
                                    .clipShape(Capsule())
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                            .id(idx)
                            .accessibilityLabel("Ir a \(DateFormatting.shortMonthName(idx + 1))")
                            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 2)
                    .padding(.bottom, 4)
                }
                .onChange(of: currentMonthIndex) { _, newValue in
                    viewModel.month = newValue + 1
                    Haptics.play(.navigation)
                    withAnimation {
                        pillProxy.scrollTo(newValue, anchor: .center)
                    }
                }
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        pillProxy.scrollTo(currentMonthIndex, anchor: .center)
                    }
                }
            }

            if viewModel.isFromCache {
                OfflineBanner(ageLabel: viewModel.cacheAgeLabel)
            }

            if viewModel.isLoading && viewModel.allRaceDays.isEmpty {
                LoadingView(
                    message: localeService.t("Cargando calendario...", "Loading calendar..."),
                    branded: true
                )
            } else if viewModel.isUncachedOffline {
                VStack(spacing: 16) {
                    EmptyStateView(
                        icon: "icloud.slash",
                        title: localeService.t("Datos no disponibles offline", "Data not available offline"),
                        subtitle: localeService.t("Este año no está guardado en tu dispositivo. Se cargará automáticamente cuando recuperes la conexión.", "This year is not saved on your device. It will load automatically when you regain connection.")
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    Button {
                        Task { await viewModel.loadYear() }
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
                    Task { await viewModel.loadYear() }
                }
            } else {
                TabView(selection: $currentMonthIndex) {
                    ForEach(0..<12, id: \.self) { idx in
                        monthPageContent(monthNum: idx + 1)
                            .tag(idx)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
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
            AnalyticsService.shared.logScreenView("month", parameters: [
                "year": String(viewModel.year),
                "category_filter": viewModel.activeFilter.rawValue,
            ])
        }
        .navigationTitle(localeService.t("Calendario", "Calendar"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            if viewModel.availableYears.count > 1 {
                ToolbarItem(placement: .topBarLeading) {
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
                        // Cápsula, igual que el picker de año de Temporada.
                        .clipShape(Capsule())
                    }
                    .accessibilityLabel("Año \(viewModel.year)")
                    .accessibilityHint("Pulsa dos veces para cambiar de año")
                    .accessibilityIdentifier(AccessibilityID.yearPicker)
                    .accessibilityInputLabels(["Año", "Cambiar año", "Selector de año"])
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    Button(localeService.t("Hoy", "Today")) {
                        Haptics.play(.navigation)
                        let cal = Calendar.current
                        let todayYear = cal.component(.year, from: Date())
                        let todayMonth = cal.component(.month, from: Date())

                        if todayYear != viewModel.year {
                            viewModel.year = todayYear
                        }
                        scrolledToTodayForMonth = nil
                        scrollToTodayTrigger += 1
                        currentMonthIndex = todayMonth - 1
                        viewModel.month = todayMonth
                    }
                    .font(.subheadline)
                    .accessibilityHint("Navega al mes actual")
                    .accessibilityIdentifier(AccessibilityID.todayButton)
                    .accessibilityInputLabels(["Hoy", "Ir a hoy", "Mes actual"])

                    // Toggle Mes→Temporada (solo dentro de la pestaña Calendario).
                    if let switchAction {
                        Button {
                            Haptics.play(.navigation)
                            switchAction()
                        } label: {
                            Image(systemName: "list.bullet.rectangle")
                        }
                        .accessibilityLabel(localeService.t("Cambiar a vista de temporada", "Switch to season view"))
                    }
                }
            }
        }
        .navigationDestination(for: String.self) { dateKey in
            TodayView(initialDateKey: dateKey, initialFilter: viewModel.activeFilter)
        }
        .navigationDestination(for: RaceDay.self) { raceDay in
            StageDetailView(raceDayId: raceDay.id)
        }
        .navigationDestination(for: ChampionshipsRoute.self) { _ in
            ChampionshipsView()
        }
        .placeholderModal(item: $placeholderItem)
        .onChange(of: storedDefaultFilter) { _, newValue in
            if let filter = Constants.CategoryFilter(rawValue: newValue) {
                viewModel.activeFilter = filter
            }
        }
        .onChange(of: viewModel.year) { _, _ in
            currentMonthIndex = 0
            Task { await viewModel.loadYear() }
        }
        .task { await viewModel.loadYear() }
        .onChange(of: viewModel.isLoading) { _, newValue in
            if !newValue && !viewModel.allRaceDays.isEmpty {
                AccessibilityAnnouncement.announce(LocaleService.t("\(viewModel.title(forMonth: currentMonthIndex + 1)) cargado", "\(viewModel.title(forMonth: currentMonthIndex + 1)) loaded"))
            }
        }
        .onChange(of: viewModel.allRaceDays.isEmpty) { _, isEmpty in
            guard !isEmpty else { return }
            let cal = Calendar.current
            let isCurrentYear = viewModel.year == cal.component(.year, from: Date())
            let todayMonth = cal.component(.month, from: Date())
            if isCurrentYear && currentMonthIndex == todayMonth - 1 {
                scrollToTodayTrigger += 1
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
                    MonthFilterChip(
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

    // MARK: - Auto-scroll to today

    private func performScrollToToday(proxy: ScrollViewProxy, monthNum: Int, currentDay: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            if reduceMotion {
                proxy.scrollTo("schedule-\(monthNum)-\(currentDay)", anchor: .top)
            } else {
                withAnimation {
                    proxy.scrollTo("schedule-\(monthNum)-\(currentDay)", anchor: .top)
                }
            }
        }
    }

    // MARK: - Month page content

    @ViewBuilder
    private func monthPageContent(monthNum: Int) -> some View {
        let daysByDate = viewModel.daysByDate(forMonth: monthNum)
        let cal = Calendar(identifier: .iso8601)
        let firstDay = cal.date(from: DateComponents(year: viewModel.year, month: monthNum, day: 1)) ?? Date()
        let daysInMonth = cal.range(of: .day, in: .month, for: firstDay)?.count ?? 30
        let todayKey = DateFormatting.todayKey()
        let currentDay = Calendar.current.component(.day, from: Date())
        let isCurrentMonth = viewModel.year == Calendar.current.component(.year, from: Date())
            && monthNum == Calendar.current.component(.month, from: Date())

        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Text(viewModel.title(forMonth: monthNum))
                        .font(.title3)
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 12)
                        .padding(.bottom, 4)
                        .accessibilityAddTraits(.isHeader)

                    ForEach(1...daysInMonth, id: \.self) { day in
                        let dateKey = String(format: "%04d-%02d-%02d", viewModel.year, monthNum, day)
                        let dayRaces = daysByDate[dateKey] ?? []
                        let isToday = dateKey == todayKey
                        let isChampDay = viewModel.year == ChampionshipsConfig.year
                            && ChampionshipsConfig.dates.contains(dateKey)

                        MonthScheduleDaySection(
                            day: day,
                            dateKey: dateKey,
                            isToday: isToday,
                            raceDays: dayRaces,
                            isChampDay: isChampDay,
                            raceMap: viewModel.raceMap,
                            activeFilter: viewModel.activeFilter,
                            onPlaceholderTap: { race, rd in
                                placeholderItem = PlaceholderModalItem(race: race, raceDay: rd)
                            }
                        )
                        .id("schedule-\(monthNum)-\(day)")
                    }

                    Color.clear.frame(height: 16)
                }
                .padding(.horizontal)
            }
            .accessibilityIdentifier(AccessibilityID.monthScheduleList)
            .onAppear {
                let monthKey = "\(viewModel.year)-\(monthNum)"
                if isCurrentMonth && scrolledToTodayForMonth != monthKey && !viewModel.allRaceDays.isEmpty {
                    scrolledToTodayForMonth = monthKey
                    performScrollToToday(proxy: proxy, monthNum: monthNum, currentDay: currentDay)
                }
            }
            .onChange(of: scrollToTodayTrigger) { _, _ in
                if isCurrentMonth {
                    let monthKey = "\(viewModel.year)-\(monthNum)"
                    scrolledToTodayForMonth = monthKey
                    performScrollToToday(proxy: proxy, monthNum: monthNum, currentDay: currentDay)
                }
            }
        }
    }

}

// MARK: - Schedule view components

/// Sección de un día en la vista de agenda mensual.
private struct MonthScheduleDaySection: View {
    let day: Int
    let dateKey: String
    let isToday: Bool
    let raceDays: [RaceDay]
    /// Día de la semana de Campeonatos (22-28 jun): muestra la fila sintética.
    var isChampDay: Bool = false
    let raceMap: [String: Race]
    let activeFilter: Constants.CategoryFilter
    var onPlaceholderTap: ((Race, RaceDay) -> Void)?

    /// Un día puede tener `raceDays` vacío (todas eran CN y se filtraron) pero
    /// seguir teniendo contenido: la fila sintética de Campeonatos.
    private var hasContent: Bool { !raceDays.isEmpty || isChampDay }

    private static var weekdayFormatter: DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: LocaleService.isEnglish ? "en_US" : "es_ES")
        f.dateFormat = "EEEE"
        return f
    }

    private var weekdayName: String {
        guard let date = DateFormatting.date(from: dateKey) else { return "" }
        let name = Self.weekdayFormatter.string(from: date)
        return name.prefix(1).uppercased() + name.dropFirst()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Cabecera del día
            HStack(alignment: .center, spacing: 8) {
                Text("\(day)")
                    .font(.title3)
                    .fontWeight(isToday ? .bold : .medium)
                    .foregroundStyle(isToday ? .white : Color.accentColor)
                    .frame(width: 34, height: 34)
                    .background {
                        if isToday {
                            Circle().fill(Color.accentColor)
                        }
                    }

                Text(weekdayName)
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)

                Spacer()
            }
            .padding(.top, 12)
            .padding(.bottom, hasContent ? 6 : 10)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel("\(day), \(weekdayName)\(isToday ? ", \(LocaleService.t("hoy", "today"))" : "")\(hasContent ? "" : ", \(LocaleService.t("sin carreras", "no races"))")")

            // Filas de carreras
            if !hasContent {
                Text(LocaleService.t("Sin carreras", "No races"))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 46)
                    .padding(.bottom, 8)
            } else {
                // Separación entre tarjetas (antes 2pt para filas planas).
                VStack(spacing: 6) {
                    // Fila sintética de Campeonatos Nacionales, primero (espejo web
                    // y Android: la fila va por delante de las carreras del día).
                    if isChampDay {
                        NavigationLink(value: ChampionshipsRoute()) {
                            MonthChampionshipsRow()
                        }
                        .buttonStyle(.plain)
                        .simultaneousGesture(TapGesture().onEnded {
                            Haptics.play(.navigation)
                        })
                    }
                    ForEach(raceDays, id: \.id) { rd in
                        if rd.isRestDay {
                            // La jornada cancelada SÍ navega a su ficha (paridad
                            // con la vista de competición, Android y la web). La
                            // de DESCANSO no: no tiene ficha que abrir.
                            MonthScheduleRaceRow(raceDay: rd, raceMap: raceMap, activeFilter: activeFilter)
                                .accessibilityIdentifier(AccessibilityID.raceCard(rd.id))
                        } else if rd.editorialStatus == "placeholder",
                                  let raceId = rd.raceId,
                                  let race = raceMap[raceId] {
                            Button {
                                Haptics.play(.navigation)
                                onPlaceholderTap?(race, rd)
                            } label: {
                                MonthScheduleRaceRow(raceDay: rd, raceMap: raceMap, activeFilter: activeFilter)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Sin información detallada, pulsa dos veces para ver más")
                            .accessibilityIdentifier(AccessibilityID.raceCard(rd.id))
                        } else {
                            NavigationLink(value: rd) {
                                MonthScheduleRaceRow(raceDay: rd, raceMap: raceMap, activeFilter: activeFilter)
                            }
                            .buttonStyle(.plain)
                            .simultaneousGesture(TapGesture().onEnded {
                                Haptics.play(.navigation)
                            })
                            .accessibilityHint("Pulsa dos veces para ver el detalle de la jornada")
                            .accessibilityIdentifier(AccessibilityID.raceCard(rd.id))
                        }
                    }
                }
                .padding(.bottom, 6)
            }

            Divider()
        }
    }
}

/// Fila sintética "Campeonatos Nacionales" de la semana 22-28 jun: colapsa todas
/// las CN del día en una sola entrada que enlaza a la pantalla de Campeonatos.
/// Espejo de `champRowHtml()` de `js/calendario-mes.js` y de `MonthChampionshipsRow`
/// de Android.
private struct MonthChampionshipsRow: View {
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
                // Hueco del logo (las CN colapsadas no tienen logo único), con un
                // globo terráqueo centrado en Europa/África como marca de
                // Campeonatos (varios países). SVG prefabricado (Twemoji 1F30D,
                // CC-BY 4.0) monocromo, teñido con el accent — el MISMO asset que
                // Android (ic_globe_europe_africa).
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

/// Fila simplificada de carrera en la vista de agenda mensual.
private struct MonthScheduleRaceRow: View {
    let raceDay: RaceDay
    let raceMap: [String: Race]
    let activeFilter: Constants.CategoryFilter

    private var race: Race? {
        raceDay.raceId.flatMap { raceMap[$0] }
    }

    private var isFemaleFilterActive: Bool { activeFilter == .female || activeFilter == .wwt }

    private var displayRaceName: String {
        let fallback = LocaleService.t("Carrera", "Race")
        guard let race else { return fallback }
        return isFemaleFilterActive && race.isFemale
            ? RaceLogic.cleanFeminineDisplayName(race.localizedName)
            : race.localizedName
    }

    private var showFemaleIndicator: Bool {
        !isFemaleFilterActive && RaceLogic.shouldShowFemaleIndicator(race)
    }

    private var raceColor: Color {
        if let hex = race?.colorHex, !hex.isEmpty {
            return Color(hex: hex)
        }
        return .gray
    }

    /// True si el tipo de etapa es CRI (itt) o CRE (ttt).
    private var isTimeTrial: Bool {
        raceDay.primaryType == "itt" || raceDay.primaryType == "ttt"
    }

    /// Etiqueta corta de etapa con tipo CRI/CRE entre paréntesis si aplica.
    private var stageLabelWithType: String {
        let label = raceDay.stageLabelShort
        if isTimeTrial, let primary = raceDay.primaryType {
            let typeLabel = RaceLogic.typeLabel(primary)
            return label.isEmpty ? "(\(typeLabel))" : "\(label) (\(typeLabel))"
        }
        return label
    }

    var body: some View {
        // Tarjeta con tono de carrera (CCCard) — mismo lenguaje que Hoy.
        CCCard(
            accent: raceColor,
            accentAlpha: 0.04,
            cornerRadius: 14,
            showShadow: false
        ) {
            HStack(spacing: 10) {
                RaceLogo(race?.logoUrl, size: 28)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        if race?.hideFlag != true || raceDay.countryCode != nil {
                            CountryFlag(countryCode: raceDay.countryCode ?? race?.countryCode)
                        }
                        Text(displayRaceName)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .lineLimit(1)

                        if showFemaleIndicator {
                            Text("♀")
                                .font(.caption)
                                .foregroundStyle(AppTheme.green)
                        }

                        if raceDay.isRestDay {
                            Text("· \(LocaleService.t("Descanso", "Rest day"))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if raceDay.isCancelledDay {
                            Text("· \(LocaleService.t("Cancelada", "Cancelled"))")
                                .font(.caption)
                                .foregroundStyle(AppTheme.red)
                        }
                    }

                    if !raceDay.isRestDay && !raceDay.isCancelledDay {
                        HStack(spacing: 6) {
                            CategoryBadge(category: race?.uciCategory)

                            if !stageLabelWithType.isEmpty {
                                Text(stageLabelWithType)
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .foregroundStyle(.secondary)
                            }

                            if race?.isOneDay != true, let route = raceDay.routeDescription {
                                Text(route)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
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
        // Solo se atenúa la CARRERA cancelada (no se corre en absoluto). Una
        // JORNADA cancelada no: su aviso ya lo dice y su ficha sigue siendo
        // accesible. Paridad con Hoy, la web y Android.
        .opacity(race?.isCancelled == true ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(scheduleRaceAccessibilityLabel)
    }

    private var scheduleRaceAccessibilityLabel: String {
        var parts: [String] = []
        if let race {
            parts.append(race.localizedName)
            if race.isCancelled { parts.append("cancelada") }
            if let catDesc = AccessibilityCategoryLabel.description(for: race.uciCategory) {
                parts.append(catDesc)
            }
        }
        if raceDay.isRestDay {
            parts.append("jornada de descanso")
        } else if raceDay.isCancelledDay {
            parts.append("etapa cancelada")
        } else {
            if !raceDay.stageLabelShort.isEmpty {
                parts.append(raceDay.stageLabelShort)
            }
            if let route = raceDay.routeDescription {
                parts.append(route)
            }
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Filter chip

/// Chip de filtro de categoría para MonthView.
/// Extraído en struct propio para que el type-checker de Swift no se ahogue
/// con la cadena de modificadores + gestures + accesibilidad inline.
private struct MonthFilterChip: View {
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
