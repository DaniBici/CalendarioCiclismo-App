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
    private let todayKey = DateFormatting.todayKey()
    /// Cambian con cada modificación de los datos de origen de cada disciplina.
    /// Las entradas y los días se derivan de ellos y se memorizan: la vista los
    /// lee en cada evaluación de su cuerpo y recalcularlos congelaba el hilo
    /// principal.
    private(set) var roadRevision = 0
    private(set) var cxRevision = 0
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
        // Ciclocross primero mientras la portada es Ciclocross; Carretera el resto del año.
        discipline = RoadTodayAvailability.isVisible() ? .road : .cyclocross
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
        let entries = VideosFeedLogic.roadEntries(roadDays, allowedGroups: groups)
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
        case .cyclocross: result = VideosFeedLogic.days(cxEntries, fromKey: from, toKey: todayKey, cxRaces: cxRaces)
        }
        daysMemo = DaysMemo(discipline: active, revision: revision, from: from, groups: groups, english: english, days: result)
        return result
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
            roadRevision &+= 1
            error = nil
            hasLoaded = true
        } catch {
            if error is CancellationError { return }
            self.error = LocaleService.t("No se han podido cargar los vídeos.", "Videos could not be loaded.")
        }
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
        cxRevision &+= 1
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

            if !store.hasLoaded && store.error == nil {
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
        }
        .navigationDestination(for: StageVideosRoute.self) { route in
            StageDetailView(raceDayId: route.raceDayId, raceIdHint: route.raceId, titleHint: route.title, initialSection: "videos")
        }
        .navigationDestination(for: CxDestination.self) { destination in
            CxRaceDetailView(raceId: destination.raceId, anchor: destination.anchor, titleHint: destination.title)
        }
        .safariSheet(url: $safariURL)
        .task { if !store.hasLoaded { await store.load() } }
        // GA4: `videos` (Carretera) y `videos_cx` (Ciclocross), al abrir y en
        // cada cambio de disciplina, como `results_feed` / `results_feed_cx`.
        .onAppear { logScreen() }
        .onChange(of: store.discipline) { _, _ in logScreen() }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                let days = store.days
                if days.isEmpty {
                    EmptyStateView(
                        icon: "play.rectangle",
                        title: localeService.t("Sin vídeos", "No videos"),
                        subtitle: store.discipline == .cyclocross
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
