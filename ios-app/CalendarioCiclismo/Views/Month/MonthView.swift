import SwiftUI

/// Vista de calendario mensual — equivalente a `mes.html` + `mes.js`.
/// Muestra un mes por página con deslizamiento horizontal entre meses (como SeasonView).
struct MonthView: View {
    /// Acción del toggle Mes↔Temporada (solo cuando se renderiza dentro de
    /// `CalendarTabView`, apps 3.1). nil = sin botón de alternar.
    var switchAction: (() -> Void)? = nil
    var embedded = false
    @State private var viewModel = MonthViewModel()
    @State private var currentMonthIndex: Int = DateFormatting.calendarStart().month - 1
    @State private var placeholderItem: PlaceholderModalItem?
    @State private var pendingDefaultFilter: Constants.CategoryFilter? = nil
    @State private var scrolledToTodayForMonth: String? = nil
    /// Incrementa para forzar scroll-to-today desde el botón "Hoy".
    @State private var scrollToTodayTrigger = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    /// Ancho de la página del mes: decide las dos columnas de carreras.
    @State private var pageWidth: CGFloat = 0
    @AppStorage("defaultFilter") private var storedDefaultFilter: String = ""
    @State private var localeService = LocaleService.shared

    var body: some View {
        VStack(spacing: 0) {
            if embedded {
                HStack(spacing: 10) {
                    Text(localeService.t("Agenda", "Agenda"))
                        .ccFont(.s16, weight: .semibold)
                    Spacer()
                    if viewModel.availableYears.count > 1 {
                        Menu {
                            Picker(localeService.t("Año", "Year"), selection: $viewModel.year) {
                                ForEach(viewModel.availableYears, id: \.self) { year in
                                    Text(String(year)).tag(year)
                                }
                            }
                        } label: {
                            Label(String(viewModel.year), systemImage: "calendar")
                                .ccFont(.s13, weight: .semibold)
                        }
                    }
                    Button(localeService.t("Hoy", "Today")) { goToCurrentMonth() }
                        .ccFont(.s13, weight: .semibold)
                }
                .padding(.horizontal)
                .frame(minHeight: 44)
            }
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
                                CalendarMonthChipLabel(
                                    label: DateFormatting.shortMonthName(idx + 1),
                                    isSelected: isSelected
                                )
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
                    Task { await viewModel.loadMonth() }
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
                LoadingView(branded: true, title: localeService.t("Calendario", "Calendar"))
            } else if viewModel.isUncachedOffline {
                VStack(spacing: 16) {
                    EmptyStateView(
                        icon: "icloud.slash",
                        title: localeService.t("Datos no disponibles offline", "Data not available offline"),
                        subtitle: localeService.t("Este mes no está guardado en tu dispositivo. Se cargará automáticamente cuando recuperes la conexión.", "This month is not saved on your device. It will load automatically when you regain connection.")
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    Button {
                        Task { await viewModel.loadMonth(force: true) }
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
                    Task { await viewModel.loadMonth(force: true) }
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
        .background(AppTheme.background.ignoresSafeArea())
        .onAppear {
            AnalyticsService.shared.logScreenView("month", parameters: [
                "year": String(viewModel.year),
                "category_filter": viewModel.activeFilter.rawValue,
            ])
        }
        .navigationTitle(localeService.t("Calendario", "Calendar"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !embedded, viewModel.availableYears.count > 1 {
                ToolbarItem(placement: .topBarLeading) {
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
            }
            if !embedded {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    Button(localeService.t("Hoy", "Today")) {
                        goToCurrentMonth()
                    }
                    .ccFont(.s14)
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
        }
        .placeholderModal(item: $placeholderItem)
        .onChange(of: storedDefaultFilter) { _, newValue in
            if let filter = Constants.CategoryFilter(rawValue: newValue) {
                viewModel.activeFilter = filter
            }
        }
        .onChange(of: viewModel.year) { _, _ in
            currentMonthIndex = 0
            viewModel.month = 1
            Task { await viewModel.loadMonth() }
        }
        .task { await viewModel.loadMonth() }
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

    private func goToCurrentMonth() {
        Haptics.play(.navigation)
        let cal = Calendar.current
        let todayYear = cal.component(.year, from: Date())
        let todayMonth = cal.component(.month, from: Date())
        if todayYear != viewModel.year { viewModel.year = todayYear }
        scrolledToTodayForMonth = nil
        scrollToTodayTrigger += 1
        currentMonthIndex = todayMonth - 1
        viewModel.month = todayMonth
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
        // Pantalla ancha: carreras del día en dos columnas bajo su rótulo.
        let columns = AdaptiveLayoutPolicy.feedColumns(
            width: max(0, pageWidth - 32),
            isRegular: horizontalSizeClass == .regular
        )

        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Text(viewModel.title(forMonth: monthNum))
                        .ccFont(.s20, weight: .bold)
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
                            columns: columns,
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
            .background(AppTheme.background)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { pageWidth = $0 }
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

/// Elemento de la lista de un día: la fila sintética de Campeonatos o una
/// jornada.
private enum MonthDayItem: Identifiable {
    case championships
    case raceDay(RaceDay)

    var id: String {
        switch self {
        case .championships: return "__championships__"
        case .raceDay(let rd): return rd.id
        }
    }
}

/// Sección de un día en la vista de agenda mensual: el rótulo del día encima y
/// sus carreras debajo (en dos columnas en pantalla ancha), como
/// `.cal-day` de `css/calendario.css`.
private struct MonthScheduleDaySection: View {
    let day: Int
    let dateKey: String
    let isToday: Bool
    let raceDays: [RaceDay]
    /// Día de la semana de Campeonatos (22-28 jun): muestra la fila sintética.
    var isChampDay: Bool = false
    var columns: Int = 1
    let raceMap: [String: Race]
    let activeFilter: Constants.CategoryFilter
    var onPlaceholderTap: ((Race, RaceDay) -> Void)?

    /// Un día puede tener `raceDays` vacío (todas eran CN y se filtraron) pero
    /// seguir teniendo contenido: la fila sintética de Campeonatos.
    private var hasContent: Bool { !raceDays.isEmpty || isChampDay }

    /// Fila sintética de Campeonatos Nacionales, primero (espejo web y
    /// Android: la fila va por delante de las carreras del día).
    private var items: [MonthDayItem] {
        (isChampDay ? [.championships] : []) + raceDays.map { .raceDay($0) }
    }

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
            // Rótulo del día en gris, como las fechas de Resultados y Fichajes;
            // el día de hoy conserva el círculo de acento.
            HStack(alignment: .center, spacing: 8) {
                Text("\(day)")
                    .ccFont(.s14, weight: isToday ? .bold : .semibold)
                    .foregroundStyle(isToday ? Color.white : AppTheme.textMuted)
                    .frame(width: 34, height: 34)
                    .background {
                        if isToday {
                            Circle().fill(Color.accentColor)
                        }
                    }

                Text(weekdayName)
                    .ccFont(.s13, weight: .semibold)
                    .foregroundStyle(AppTheme.textMuted)

                Spacer()
            }
            .padding(.top, 10)
            .padding(.bottom, 6)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel("\(day), \(weekdayName)\(isToday ? ", \(LocaleService.t("hoy", "today"))" : "")\(hasContent ? "" : ", \(LocaleService.t("sin carreras", "no races"))")")

            if !hasContent {
                Text(LocaleService.t("Sin carreras", "No races"))
                    .ccFont(.s12)
                    .foregroundStyle(AppTheme.textDim)
                    .padding(.leading, 42)
                    .padding(.bottom, 8)
            } else {
                // Rejilla de una o dos columnas: las tarjetas de una misma fila
                // comparten altura.
                Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                    ForEach(AdaptiveLayoutPolicy.rows(items, columns: columns)) { row in
                        GridRow {
                            ForEach(row.items) { item in
                                itemView(item)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            }
                            if row.items.count < columns {
                                Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                            }
                        }
                    }
                }
                .padding(.bottom, 8)
            }
        }
    }

    @ViewBuilder
    private func itemView(_ item: MonthDayItem) -> some View {
        switch item {
        case .championships:
            NavigationLink(value: ChampionshipsRoute()) {
                MonthChampionshipsRow()
            }
            .buttonStyle(CalendarPressStyle(cornerRadius: AppTheme.Radius.surface))
            .simultaneousGesture(TapGesture().onEnded {
                Haptics.play(.navigation)
            })
        case .raceDay(let rd):
            raceView(rd)
        }
    }

    @ViewBuilder
    private func raceView(_ rd: RaceDay) -> some View {
        if rd.isRestDay {
            // La jornada cancelada SÍ navega a su ficha (paridad con la vista de
            // competición, Android y la web). La de DESCANSO no: no tiene ficha
            // que abrir.
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
            .buttonStyle(CalendarPressStyle(cornerRadius: AppTheme.Radius.surface))
            .accessibilityHint("Sin información detallada, pulsa dos veces para ver más")
            .accessibilityIdentifier(AccessibilityID.raceCard(rd.id))
        } else {
            NavigationLink(value: rd) {
                MonthScheduleRaceRow(raceDay: rd, raceMap: raceMap, activeFilter: activeFilter)
            }
            .buttonStyle(CalendarPressStyle(cornerRadius: AppTheme.Radius.surface))
            .simultaneousGesture(TapGesture().onEnded {
                Haptics.play(.navigation)
            })
            .accessibilityHint("Pulsa dos veces para ver el detalle de la jornada")
            .accessibilityIdentifier(AccessibilityID.raceCard(rd.id))
        }
    }
}

/// Fila sintética "Campeonatos Nacionales" de la semana 22-28 jun: colapsa todas
/// las CN del día en una sola entrada que enlaza a la pantalla de Campeonatos.
/// Espejo de `champRowHtml()` de `js/calendario-mes.js` y de `MonthChampionshipsRow`
/// de Android.
private struct MonthChampionshipsRow: View {
    var body: some View {
        CCCard {
            HStack(spacing: 10) {
                CalendarChampionshipsMark()

                VStack(alignment: .leading, spacing: 2) {
                    Text(ChampionshipsConfig.title)
                        .ccFont(.s14, weight: .medium)
                        .fixedSize(horizontal: false, vertical: true)
                    CategoryBadge(category: "CN")
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ChampionshipsConfig.title)
        .accessibilityHint(LocaleService.t("Pulsa dos veces para ver los campeonatos nacionales", "Double tap to see the national championships"))
    }
}

/// Fila de carrera en la vista de agenda mensual: superficie de tarjeta sin
/// tinte (`.cal-race` de `css/calendario.css`). Nombre completo en varias
/// líneas, con la bandera alineada con la primera; CRI/CRE como etiqueta de
/// tipo de etapa.
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

    /// Descanso y jornada sin información: se atenúa lo decorativo (logo,
    /// bandera, chevron) y el texto conserva su color.
    private var dimsDecoration: Bool {
        raceDay.isRestDay || raceDay.editorialStatus == "placeholder"
    }

    /// Tipo CRI/CRE: la misma etiqueta de color que en Hoy.
    private var timeTrialType: String? {
        guard let primary = raceDay.primaryType, primary == "itt" || primary == "ttt" else { return nil }
        return primary
    }

    var body: some View {
        CCCard {
            HStack(spacing: 10) {
                RaceLogo(race?.logoUrl, size: 28)
                    .opacity(dimsDecoration ? 0.65 : 1)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        if race?.hideFlag != true || raceDay.countryCode != nil {
                            CountryFlag(countryCode: raceDay.countryCode ?? race?.countryCode)
                                .opacity(dimsDecoration ? 0.65 : 1)
                                // Centro de la bandera a media altura de la
                                // primera línea del nombre.
                                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 5 }
                        }
                        nameLine
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if !raceDay.isRestDay && !raceDay.isCancelledDay {
                        HStack(spacing: 6) {
                            CategoryBadge(category: race?.uciCategory)
                                .fixedSize()

                            if let timeTrialType {
                                StageTypeBadge(primaryType: timeTrialType, secondaryType: nil)
                                    .fixedSize()
                            }

                            if !raceDay.stageLabelShort.isEmpty {
                                Text(raceDay.stageLabelShort)
                                    .ccFont(.s12, weight: .semibold)
                                    .foregroundStyle(AppTheme.textMuted)
                                    .fixedSize()
                            }

                            if race?.isOneDay != true, let route = raceDay.routeDescription {
                                Text(route)
                                    .ccFont(.s12)
                                    .foregroundStyle(AppTheme.textMuted)
                                    .lineLimit(1)
                            }
                        }
                    }
                }

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .opacity(dimsDecoration ? 0.65 : 1)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        // Solo se atenúa la CARRERA cancelada (no se corre en absoluto). Una
        // JORNADA cancelada no: su aviso ya lo dice y su ficha sigue siendo
        // accesible. Paridad con Hoy, la web y Android.
        .opacity(race?.isCancelled == true ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(scheduleRaceAccessibilityLabel)
    }

    /// Nombre completo (pasa a otra línea en lugar de cortarse), con el
    /// símbolo femenino y el aviso de descanso o cancelación a continuación.
    private var nameLine: some View {
        let name = Text(displayRaceName)
            .foregroundStyle(raceDay.isRestDay ? AppTheme.textMuted : AppTheme.textPrimary)
        let female = Text(showFemaleIndicator ? " ♀" : "").foregroundStyle(AppTheme.green)
        let note: Text
        if raceDay.isRestDay {
            note = Text("  · \(LocaleService.t("Descanso", "Rest day"))").foregroundStyle(AppTheme.textMuted)
        } else if raceDay.isCancelledDay {
            note = Text("  · \(LocaleService.t("Cancelada", "Cancelled"))").foregroundStyle(AppTheme.red)
        } else {
            note = Text("")
        }
        return Text("\(name)\(female)\(note)")
            .ccFont(.s14, weight: .medium)
            .fixedSize(horizontal: false, vertical: true)
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
            if let timeTrialType {
                parts.append(RaceLogic.typeLabel(timeTrialType))
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
