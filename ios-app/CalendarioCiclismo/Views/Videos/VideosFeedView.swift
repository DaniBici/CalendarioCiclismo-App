import SwiftUI

/// Disciplina de la sección Vídeos.
enum VideosFeedDiscipline: String, CaseIterable, Identifiable {
    case cyclocross, road
    var id: String { rawValue }
}

/// Estado de la sección Vídeos (docs/plans/videos-5-2.md, fase 5): carretera
/// desde `video_feed_days` y ciclocross desde la temporada en curso, cada una
/// con su ventana de 14 días anclada a su último día con vídeos y «Cargar más
/// carreras» hasta el principio de la temporada.
@MainActor
@Observable
final class VideosFeedStore {
    var discipline: VideosFeedDiscipline
    private(set) var roadDays: [VideoFeedDay] = []
    private(set) var cxRaces: [CxRace] = []
    private(set) var cxRounds: [String: CxRound] = [:]
    private(set) var fromKey: [VideosFeedDiscipline: String] = [:]
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var hasLoaded = false
    var error: String?
    private(set) var todayKey: String
    @ObservationIgnored private var roadTodayVisible: Bool
    /// Cambian con cada modificación de los datos de origen de cada disciplina.
    /// Las entradas y los días se derivan de ellos y se memorizan: la vista los
    /// lee en cada evaluación de su cuerpo y recalcularlos congelaba el hilo
    /// principal.
    private(set) var roadRevision = 0
    private(set) var cxRevision = 0
    /// Destacadas de carretera (`día|carrera`) y de ciclocross (`cx_race_featured`): encabezan su
    /// día, como en Hoy.
    @ObservationIgnored private var roadFeatured: Set<String> = []
    @ObservationIgnored private var cxFeatured: Set<String> = []
    @ObservationIgnored private var roadMemo: EntriesMemo?
    @ObservationIgnored private var cxMemo: EntriesMemo?
    @ObservationIgnored private var daysMemo: DaysMemo?

    private struct EntriesMemo {
        let revision: Int
        let groups: Set<String>
        let english: Bool
        let entries: [VideoFeedEntry]
    }

    private struct DaysMemo {
        let discipline: VideosFeedDiscipline
        let revision: Int
        let from: String?
        let groups: Set<String>
        let english: Bool
        let days: [VideoFeedDayGroup]
    }

    init() {
        let now = DateFormatting.todayKey()
        let visible = RoadTodayAvailability.isVisible(today: now)
        todayKey = now
        roadTodayVisible = visible
        // Ciclocross primero mientras la portada es Ciclocross; Carretera el resto del año.
        discipline = visible ? .road : .cyclocross
    }

    /// Reevalúa la fecha local y la disponibilidad de Hoy de carretera: si se
    /// cruza la frontera estacional, cambia la disciplina activa de Vídeos
    /// automáticamente sin reiniciar la app.
    @discardableResult
    func syncDayState() -> (dayChanged: Bool, disciplineChanged: Bool) {
        let nowKey = DateFormatting.todayKey()
        let visible = RoadTodayAvailability.isVisible(today: nowKey)
        let dayChanged = nowKey != todayKey
        let disciplineChanged = visible != roadTodayVisible
        if dayChanged {
            todayKey = nowKey
            daysMemo = nil
        }
        if disciplineChanged {
            roadTodayVisible = visible
            discipline = visible ? .road : .cyclocross
        }
        return (dayChanged, disciplineChanged)
    }

    private var cxSeason: String {
        CxMonth(year: Int(todayKey.prefix(4)) ?? 2026, month: Int(todayKey.dropFirst(5).prefix(2)) ?? 1).season
    }

    private var cxSeasonStart: String {
        CyclocrossLogic.seasonBounds(cxSeason)?.first ?? ResultsFeedLogic.seasonStart
    }

    func seasonStart(_ discipline: VideosFeedDiscipline) -> String {
        discipline == .road ? ResultsFeedLogic.seasonStart : cxSeasonStart
    }

    var roadEntries: [VideoFeedEntry] {
        let groups = RegionService.shared.allowedBroadcastGroups
        let english = LocaleService.isEnglish
        if let memo = roadMemo, memo.revision == roadRevision, memo.groups == groups, memo.english == english {
            return memo.entries
        }
        let entries = VideosFeedLogic.roadEntries(roadDays, allowedGroups: groups, featured: roadFeatured)
        roadMemo = EntriesMemo(revision: roadRevision, groups: groups, english: english, entries: entries)
        return entries
    }

    var cxEntries: [VideoFeedEntry] {
        let groups = RegionService.shared.allowedBroadcastGroups
        let english = LocaleService.isEnglish
        if let memo = cxMemo, memo.revision == cxRevision, memo.groups == groups, memo.english == english {
            return memo.entries
        }
        let entries = VideosFeedLogic.cxEntries(cxRaces, allowedGroups: groups, rounds: cxRounds)
        cxMemo = EntriesMemo(revision: cxRevision, groups: groups, english: english, entries: entries)
        return entries
    }

    /// Días de la vista activa en orden cronológico inverso.
    var days: [VideoFeedDayGroup] {
        let groups = RegionService.shared.allowedBroadcastGroups
        let english = LocaleService.isEnglish
        let active = discipline
        let from = fromKey[active]
        let revision = active == .road ? roadRevision : cxRevision
        if let memo = daysMemo, memo.discipline == active, memo.revision == revision, memo.from == from,
           memo.groups == groups, memo.english == english {
            return memo.days
        }
        let result: [VideoFeedDayGroup]
        switch active {
        case .road: result = VideosFeedLogic.days(roadEntries, fromKey: from, toKey: todayKey)
        case .cyclocross: result = VideosFeedLogic.days(cxEntries, fromKey: from, toKey: todayKey, cxRaces: cxRaces, cxFeatured: cxFeatured)
        }
        daysMemo = DaysMemo(discipline: active, revision: revision, from: from, groups: groups, english: english, days: result)
        return result
    }

    /// Días con las carreras que pasan los filtros de Hoy y Calendario (los mismos, por
    /// disciplina); un día sin carreras que pasen no aparece.
    var filteredDays: [VideoFeedDayGroup] {
        let result = days
        let filters = RaceFilterStore.shared
        let road = filters.road, cx = filters.cx
        guard discipline == .road ? road.isActive : cx.isActive else { return result }
        return result.compactMap { group in
            let kept = group.entries.filter { entry in
                if discipline == .road, let race = entry.roadRace { return road.matches(category: race.uciCategory, name: race.name, gender: race.gender) }
                if discipline == .cyclocross, let race = entry.cxRace { return cx.matches(race) }
                return true
            }
            return kept.isEmpty ? nil : VideoFeedDayGroup(date: group.date, entries: kept)
        }
    }

    var filtersActive: Bool {
        let filters = RaceFilterStore.shared
        return discipline == .road ? filters.road.isActive : filters.cx.isActive
    }

    var canLoadMore: Bool { (fromKey[discipline] ?? "") > seasonStart(discipline) }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let anchor = SupabaseService.shared.videoFeedDays(from: nil, to: todayKey)
            async let cx: Void = loadCx()
            let anchorDays = try await anchor
            try? await cx
            let roadLatest = anchorDays.map(\.dateKey).filter { $0 <= todayKey }.max() ?? todayKey
            let cxLatest = cxEntries.map(\.date).filter { $0 <= todayKey }.max() ?? todayKey
            let roadFrom = fromKey[.road] ?? VideosFeedLogic.shift(roadLatest, days: -(VideosFeedLogic.windowDays - 1))
            fromKey[.road] = max(roadFrom, ResultsFeedLogic.seasonStart)
            fromKey[.cyclocross] = fromKey[.cyclocross] ?? max(VideosFeedLogic.shift(cxLatest, days: -(VideosFeedLogic.windowDays - 1)), cxSeasonStart)
            roadDays = try await SupabaseService.shared.videoFeedDays(from: fromKey[.road], to: todayKey)
            roadFeatured = await loadRoadFeatured(for: roadDays.map(\.dateKey))
            roadRevision &+= 1
            error = nil
            hasLoaded = true
        } catch {
            if error is CancellationError { return }
            self.error = LocaleService.t("No se han podido cargar los vídeos.", "Videos could not be loaded.")
        }
    }

    /// Carreras destacadas de carretera en esos días; sin red, sin destacadas.
    private func loadRoadFeatured(for dateKeys: [String]) async -> Set<String> {
        let keys = Array(Set(dateKeys)).sorted()
        guard !keys.isEmpty, let selections = try? await SupabaseService.shared.featuredRaces(for: keys) else { return [] }
        return Set(selections.map { VideosFeedLogic.featuredKey(dateKey: $0.dateKey, raceId: $0.raceId) })
    }

    private func loadCx() async throws {
        let season = cxSeason
        let months = CyclocrossAgendaModel.seasonMonths(season).filter { $0.firstDate <= todayKey }
        var seen = Set<String>()
        var races: [CxRace] = []
        try await withThrowingTaskGroup(of: [CxRace].self) { group in
            for month in months {
                group.addTask { try await SupabaseService.shared.cxMonth(season: season, month: month) }
            }
            for try await rows in group {
                for race in rows where seen.insert(race.id).inserted && CyclocrossPresentation.listedInAgenda(race) {
                    races.append(race)
                }
            }
        }
        cxRaces = races.sorted { ($0.dateKey, $0.id) < ($1.dateKey, $1.id) }
        cxRounds = (try? await SupabaseService.shared.cxSeasonRounds(season: season)) ?? [:]
        cxFeatured = await CyclocrossRepository.shared.featuredRaceIds()
        cxRevision &+= 1
    }

    /// Mínimo de días con vídeos que pasan los filtros: si la ventana deja menos, se
    /// amplía hacia atrás hasta alcanzarlo o llegar al principio de la temporada.
    static let minDays = 15

    private struct FillKey: Equatable {
        let discipline: VideosFeedDiscipline
        let road: RoadRaceFilter
        let cx: CxRaceFilter
    }

    private var fillKey: FillKey {
        FillKey(discipline: discipline, road: RaceFilterStore.shared.road, cx: RaceFilterStore.shared.cx)
    }

    /// Disciplina y filtros con los que la ampliación se detuvo antes del mínimo
    /// (sin red o sin avance): con ellos se muestra la lista tal cual.
    private var stalledFill: FillKey?
    @ObservationIgnored private var fillTask: Task<Void, Never>?

    /// La lista aún no llega al mínimo y se está ampliando: la vista muestra la carga
    /// en lugar de una lista que crecería a saltos.
    var needsFill: Bool {
        hasLoaded && canLoadMore && stalledFill != fillKey && filteredDays.count < Self.minDays
    }

    /// Las ampliaciones se encadenan: una nueva (otro filtro u otra disciplina) espera a
    /// la anterior y no se cancela con la tarea de la vista.
    func ensureMinDays() async {
        let previous = fillTask
        let task = Task { [weak self] in
            await previous?.value
            await self?.fillToMinDays()
        }
        fillTask = task
        await task.value
    }

    private func fillToMinDays() async {
        var rounds = 0
        while hasLoaded, filteredDays.count < Self.minDays, canLoadMore, rounds < 60 {
            let before = fromKey[discipline]
            await loadMore()
            rounds += 1
            if fromKey[discipline] == before { break }
        }
        if hasLoaded, filteredDays.count < Self.minDays, canLoadMore { stalledFill = fillKey }
    }

    /// Semanas anteriores de la vista activa hasta encontrar algún día con
    /// carreras o llegar al principio de la temporada.
    func loadMore() async {
        let current = discipline
        guard !isLoadingMore, var from = fromKey[current] else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let start = seasonStart(current)
        while from > start {
            let older = max(VideosFeedLogic.shift(from, days: -VideosFeedLogic.moreDays), start)
            let to = VideosFeedLogic.shift(from, days: -1)
            var found = false
            if current == .road {
                guard let rows = try? await SupabaseService.shared.videoFeedDays(from: older, to: to) else { return }
                roadDays += rows
                roadFeatured.formUnion(await loadRoadFeatured(for: rows.map(\.dateKey)))
                roadRevision &+= 1
                found = !VideosFeedLogic.roadEntries(rows, allowedGroups: RegionService.shared.allowedBroadcastGroups).isEmpty
            } else {
                found = cxEntries.contains { $0.date >= older && $0.date <= to }
            }
            from = older
            fromKey[current] = older
            if found { break }
        }
    }
}

/// Sección Vídeos: días con cabecera y una tarjeta por carrera que se
/// despliega hacia abajo con el acordeón de vídeos de la jornada (el primero
/// abierto, sin reproducción automática). Sin vídeos pero con Revive, la
/// tarjeta lleva el botón «Emisión ↗» y no se despliega. Plegada, la tarjeta
/// muestra solo la carrera y una flecha hacia abajo.
private struct VideosFilterKey: Equatable {
    let road: RoadRaceFilter
    let cx: CxRaceFilter
    let discipline: VideosFeedDiscipline
}

struct VideosFeedView: View {
    @State private var store = VideosFeedStore()
    @State private var openId: String?
    @State private var safariURL: URL?
    @State private var localeService = LocaleService.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            Picker(localeService.t("Disciplina", "Discipline"), selection: Binding(
                get: { store.discipline },
                set: { store.discipline = $0; openId = nil; Haptics.play(.selection) }
            )) {
                Text(localeService.t("Ciclocross", "Cyclocross")).tag(VideosFeedDiscipline.cyclocross)
                Text(localeService.t("Carretera", "Road")).tag(VideosFeedDiscipline.road)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 8)
            .accessibilityIdentifier(AccessibilityID.videosDisciplinePicker)

            if (!store.hasLoaded && store.error == nil) || store.needsFill {
                LoadingView(branded: true, title: localeService.t("Vídeos", "Videos"))
            } else if let error = store.error, !store.hasLoaded {
                ErrorView(message: error) { Task { await store.load() } }
            } else {
                list
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(localeService.t("Vídeos", "Videos"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Marca de CC arriba a la izquierda, como Resultados.
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
            // «Filtros»: la misma selección de Hoy, Calendario y Últimos resultados.
            ToolbarItem(placement: .topBarTrailing) {
                if store.discipline == .cyclocross {
                    CxFiltersMenu { isActive in filtersSymbol(isActive) }
                } else {
                    RoadFiltersMenu { isActive in filtersSymbol(isActive) }
                }
            }
        }
        .navigationDestination(for: StageVideosRoute.self) { route in
            StageDetailView(raceDayId: route.raceDayId, raceIdHint: route.raceId, titleHint: route.title, initialSection: "videos")
        }
        .navigationDestination(for: CxDestination.self) { destination in
            CxRaceDetailView(raceId: destination.raceId, anchor: destination.anchor, titleHint: destination.title)
        }
        .safariSheet(url: $safariURL)
        .task {
            if store.syncDayState().disciplineChanged { openId = nil }
            if !store.hasLoaded { await store.load() }
            await store.ensureMinDays()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            let change = store.syncDayState()
            if change.disciplineChanged { openId = nil }
            if change.dayChanged && store.hasLoaded {
                Task {
                    await store.load()
                    await store.ensureMinDays()
                }
            }
        }
        // Con los filtros de Hoy o al cambiar de disciplina, la lista se amplía hasta
        // tener al menos 15 días con vídeos.
        .task(id: VideosFilterKey(road: RaceFilterStore.shared.road, cx: RaceFilterStore.shared.cx, discipline: store.discipline)) {
            await store.ensureMinDays()
        }
        // GA4: `videos` (Carretera) y `videos_cx` (Ciclocross), al abrir y en
        // cada cambio de disciplina, como `results_feed` / `results_feed_cx`.
        .onAppear {
            let change = store.syncDayState()
            if change.disciplineChanged { openId = nil }
            logScreen()
            if change.dayChanged && store.hasLoaded {
                Task {
                    await store.load()
                    await store.ensureMinDays()
                }
            }
        }
        .onChange(of: store.discipline) { _, _ in logScreen() }
    }

    private func filtersSymbol(_ isActive: Bool) -> some View {
        Image(systemName: isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                let days = store.filteredDays
                if days.isEmpty {
                    EmptyStateView(
                        icon: "play.rectangle",
                        title: localeService.t("Sin vídeos", "No videos"),
                        subtitle: store.filtersActive
                            ? localeService.t("No hay vídeos con estos filtros en este periodo.", "No videos match these filters in this period.")
                            : store.discipline == .cyclocross
                                ? localeService.t("No hay vídeos de ciclocross en este periodo.", "No cyclocross videos in this period.")
                                : localeService.t("No hay vídeos de carretera en este periodo.", "No road videos in this period.")
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, minHeight: 320)
                }
                ForEach(days) { day in
                    Text(DateFormatting.formatDateLongContent(day.date))
                        .ccFont(.s13, weight: .semibold)
                        .foregroundStyle(.secondary)
                        .padding(.top, day.id == days.first?.id ? 0 : 10)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(day.entries) { entry in
                        VideoFeedCard(entry: entry, isOpen: openId == entry.id, onToggle: {
                            withAnimation(.easeInOut(duration: 0.2)) { openId = openId == entry.id ? nil : entry.id }
                        }, onExternal: open)
                    }
                }
                if store.canLoadMore {
                    loadMoreButton
                }
            }
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .refreshable { await store.load() }
    }

    /// Mismo botón que «Cargar más resultados» de Últimos resultados.
    private var loadMoreButton: some View {
        HStack {
            Spacer()
            Button {
                Haptics.play(.primaryAction)
                Task { await store.loadMore() }
            } label: {
                if store.isLoadingMore {
                    ProgressView()
                } else {
                    Text(localeService.t("Cargar más carreras", "Load more races"))
                        .ccFont(.s14, weight: .semibold)
                }
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
            .disabled(store.isLoadingMore)
            Spacer()
        }
        .padding(.vertical, 12)
    }

    private func logScreen() {
        AnalyticsService.shared.logScreenView(store.discipline == .road ? "videos" : "videos_cx")
    }

    private func open(_ url: URL) {
        NativeAppLinkOpener.openIfInstalled(url) { safariURL = url }
    }
}

/// Tarjeta de una carrera en la sección Vídeos.
private struct VideoFeedCard: View {
    let entry: VideoFeedEntry
    let isOpen: Bool
    let onToggle: () -> Void
    let onExternal: (URL) -> Void

    var body: some View {
        CCCard {
            VStack(spacing: 0) {
                if entry.expandable {
                    Button {
                        Haptics.play(.selection)
                        onToggle()
                    } label: {
                        header {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.tertiary)
                                .accessibilityHidden(true)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isOpen ? [.isSelected] : [])
                    .accessibilityHint(LocaleService.t("Muestra los vídeos", "Shows the videos"))
                    if isOpen {
                        Divider()
                        StageVideoList(entries: entry.rows, oneDay: entry.oneDay, onExternal: onExternal)
                        Divider()
                        destinationLink
                    }
                } else if let full = entry.full {
                    header {
                        Button("\(LocaleService.t("Emisión", "Broadcast")) ↗") {
                            AnalyticsService.shared.logEvent("video_open", parameters: ["platform": StageVideoList.platformKey(full.url.absoluteString), "video_kind": "full"])
                            onExternal(full.url)
                        }
                        .stagePanelAction()
                        .accessibilityLabel(full.label)
                    }
                }
            }
        }
    }

    private func header<Accessory: View>(@ViewBuilder accessory: () -> Accessory) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(spacing: 3) {
                RaceLogo(entry.logoUrl, size: 36, placeholder: entry.placeholderLogo)
                CountryFlag(countryCode: entry.countryCode, width: 18)
            }
            .frame(width: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.name)
                    .ccFont(.s16, weight: .semibold)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if !entry.subtitle.isEmpty {
                    Text(entry.subtitle)
                        .ccFont(.s13)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            Spacer(minLength: 8)
            accessory()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var destinationLink: some View {
        let label = entry.cxRoute != nil
            ? LocaleService.t("Ir a la prueba", "Go to race")
            : (entry.oneDay ? LocaleService.t("Ir a la carrera", "Go to race") : LocaleService.t("Ir a la etapa", "Go to stage"))
        Group {
            if let route = entry.stageRoute {
                NavigationLink(value: route) { linkLabel(label) }
            } else if let route = entry.cxRoute {
                NavigationLink(value: route) { linkLabel(label) }
            }
        }
        .buttonStyle(.plain)
    }

    private func linkLabel(_ text: String) -> some View {
        HStack {
            Text("\(text) ›").ccFont(.s13, weight: .semibold).foregroundStyle(Color.accentColor)
            Spacer()
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}
