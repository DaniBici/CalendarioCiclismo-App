import Foundation
import SwiftUI
import WidgetKit

/// ViewModel para la vista de agenda del día — equivalente a `js/app.js`.
@MainActor
@Observable
final class TodayViewModel {
    var dateKey: String = DateFormatting.todayKey()
    var items: [EnrichedRaceDay] = []
    var allRaces: [Race] = []
    var isLoading = false
    var error: String?
    var activeFilter: Constants.CategoryFilter = .all
    var sortMode: SortMode = .category
    var nextDayWithRaces: String?
    var hasLoaded = false
    /// Indica que los datos mostrados provienen de la caché offline.
    var isFromCache = false
    /// Texto legible con la antigüedad de la caché (ej: "Hace 2 h").
    var cacheAgeLabel: String?
    /// Indica que el día no está cacheado y no hay conexión para descargarlo.
    var isUncachedOffline = false
    /// Fecha de la última carga exitosa desde red.
    var lastNetworkLoadAt: Date?
    /// True mientras hay una petición de red en curso. La vista lo usa para
    /// suprimir el OfflineBanner durante la ventana en que la caché ya se ha
    /// mostrado pero la red aún no ha respondido.
    var isNetworkLoading = false
    /// Token que se incrementa con cada respuesta de red fresca. Combinado con
    /// el item.id en el .id() de cada card, garantiza que SwiftUI destruya y
    /// recree las vistas en lugar de reutilizar instancias con datos obsoletos.
    var refreshToken: Int = 0
    /// Identifica la última carga solicitada. Las respuestas de peticiones
    /// anteriores no deben poder repintar un día que el usuario ya abandonó ni
    /// apagar el indicador de una recarga más reciente.
    private var loadGeneration = 0

    enum SortMode: String, CaseIterable {
        case category = "category"
        case tvTime = "tvTime"
        case finishTime = "finishTime"

        var label: String {
            switch self {
            case .category:   return LocaleService.t("Categoría", "Category")
            case .tvTime:     return LocaleService.t("Hora TV", "TV time")
            case .finishTime: return LocaleService.t("Hora meta", "Finish time")
            }
        }
    }

    /// Pin del usuario (UserDefaults), independiente del filtro mostrado. Dentro
    /// de la ventana de Campeonatos no se aplica; fuera, gobierna `activeFilter`.
    private var pinnedFilter: Constants.CategoryFilter = .all
    /// Filtro elegido manualmente DENTRO de la ventana (o nil). Se descarta al
    /// salir → "fuera funciona normal" (se restaura el pin del usuario).
    private var champManualFilter: Constants.CategoryFilter?

    /// `true` si la jornada mostrada cae en la ventana de Campeonatos (22-28 jun).
    var isChampWeekLock: Bool { ChampionshipsConfig.isChampWeekFilterLock(today: dateKey) }

    init() {
        if let raw = UserDefaults.standard.string(forKey: "defaultFilter"),
           let stored = Constants.CategoryFilter(rawValue: raw) {
            pinnedFilter = stored
        }
        // El bloqueo se evalúa contra la JORNADA MOSTRADA (al arrancar = hoy), no
        // contra una fecha fija. Dentro de la ventana → Masculino forzado; fuera →
        // el pin del usuario.
        activeFilter = ChampionshipsConfig.isChampWeekFilterLock(today: dateKey)
            ? ChampionshipsConfig.champWeekHoyDefault
            : pinnedFilter
    }

    func setDefaultFilter(_ filter: Constants.CategoryFilter) {
        pinnedFilter = filter
        activeFilter = filter
        UserDefaults.standard.set(filter.rawValue, forKey: "defaultFilter")
        refreshWidgetForFilterChange()
    }

    func clearDefaultFilter() {
        pinnedFilter = .all
        activeFilter = .all
        UserDefaults.standard.removeObject(forKey: "defaultFilter")
        refreshWidgetForFilterChange()
    }

    /// Registra un cambio MANUAL de filtro hecho desde la vista. Dentro de la
    /// ventana de Campeonatos el cambio es contextual (se recuerda para esos días
    /// pero no altera el pin del usuario).
    func selectFilter(_ filter: Constants.CategoryFilter) {
        if isChampWeekLock { champManualFilter = filter }
        activeFilter = filter
    }

    /// Sincroniza el pin del usuario cuando cambia desde otra pantalla. Solo se
    /// refleja en el filtro mostrado si la jornada actual no está bloqueada.
    func syncPinnedFilter(_ filter: Constants.CategoryFilter) {
        pinnedFilter = filter
        if !isChampWeekLock { activeFilter = filter }
    }

    private func refreshWidgetForFilterChange() {
        guard isToday, !items.isEmpty else { return }
        let widgetFiltered = RaceLogic.filterByCategory(items, category: activeFilter)
        let capturedNextKey = nextDayWithRaces
        let capturedDateKey = dateKey
        let capturedRaceName = nextRaceName(for: capturedNextKey)
        Task { @MainActor in
            let (nextBroadcast, nextTvStatus) = await fetchNextRaceInfo(nextDateKey: capturedNextKey)
            writeWidgetPayload(items: widgetFiltered, nextDateKey: capturedNextKey, nextRaceName: capturedRaceName, nextRaceBroadcastStartTimeUtc: nextBroadcast, nextRaceTvStatus: nextTvStatus, dateKey: capturedDateKey)
        }
    }

    /// Items filtrados y ordenados.
    var displayItems: [EnrichedRaceDay] {
        let filtered = RaceLogic.filterByCategory(items, category: activeFilter)
        return filtered.sorted { a, b in
            switch sortMode {
            case .category: RaceLogic.sortByCategory(a, b)
            case .tvTime: RaceLogic.sortByTvTime(a, b)
            case .finishTime: RaceLogic.sortByFinishTime(a, b)
            }
        }
    }

    var dateLabel: String {
        DateFormatting.formatDateLabel(dateKey)
    }

    var isToday: Bool {
        dateKey == DateFormatting.todayKey()
    }

    // Última fecha local que se mostró COMO "hoy". Permite distinguir "el usuario
    // está en hoy y ha cruzado la medianoche local" (→ auto-avanzar) de "navegó a
    // otro día a mano" (→ no tocar). Se sincroniza cuando el día mostrado es hoy.
    private var lastTodayKey: String = DateFormatting.todayKey()

    // Auto-avance de medianoche: si el día mostrado seguía siendo el "hoy" anterior
    // y la fecha local ya cambió, salta al nuevo hoy. Si el usuario navegó a otro
    // día, NO se le mueve. Lo invocan los ciclos de refresco / vuelta a primer plano.
    func advanceIfNewLocalDay() {
        let nowKey = DateFormatting.todayKey()
        if dateKey == nowKey { lastTodayKey = nowKey; return }   // ya estamos en hoy
        guard dateKey == lastTodayKey else { return }            // navegación manual: respetar
        lastTodayKey = nowKey
        goToDate(nowKey)
    }

    /// Recarga el día ya visible sin sustituir su contenido por una pantalla de
    /// carga. Es la semántica del pull-to-refresh y de los refrescos silenciosos
    /// al volver a primer plano: el indicador nativo acompaña a las cards, no
    /// las reemplaza.
    func refreshDay() async {
        await loadDay(preservingContent: true)
    }

    /// Carga un día. Al navegar sí se limpia el contenido anterior; al refrescar
    /// el mismo día se conserva hasta que llegue una respuesta nueva.
    func loadDay(preservingContent: Bool = false) async {
        loadGeneration &+= 1
        let generation = loadGeneration
        let capturedKey = dateKey
        let retainsContent = preservingContent && !items.isEmpty

        isLoading = !retainsContent
        if !retainsContent {
            items = []
            isFromCache = false
            cacheAgeLabel = nil
            nextDayWithRaces = nil
        }
        error = nil
        hasLoaded = true
        isUncachedOffline = false
        isNetworkLoading = true

        // Captura la fecha para la que empezamos esta carga. Si el usuario navega
        // a otra fecha mientras esperamos la red o la caché, los tasks concurrentes
        // de fechas anteriores devolverían datos obsoletos que sobreescriben el
        // estado de la fecha actual — el guard al final de cada await los descarta.
        let cache = CacheManager.shared
        let cacheKey = CacheManager.dayKey(dateKey)

        // 1. Intentar cargar desde caché para mostrar datos mientras llega la red
        if !retainsContent, let cached: DayData = await cache.load(DayData.self, forKey: cacheKey) {
            guard dateKey == capturedKey, generation == loadGeneration else { return }
            items = cached.raceDays
            isFromCache = true
            cacheAgeLabel = await cache.ageLabel(forKey: cacheKey)
            isLoading = false
        }

        // 2. Intentar actualizar desde red
        do {
            let data = try await SupabaseService.shared.loadDayComplete(dateKey: dateKey)
            guard dateKey == capturedKey, generation == loadGeneration else { return }
            items = data.raceDays
            isFromCache = false
            cacheAgeLabel = nil
            refreshToken &+= 1
            lastNetworkLoadAt = Date()

            // Cargar todas las carreras del año para placeholders
            let year = Int(dateKey.prefix(4)) ?? 2026
            if allRaces.isEmpty {
                let yearKey = CacheManager.yearRacesKey(year)
                if let cachedRaces: [Race] = await cache.load([Race].self, forKey: yearKey) {
                    guard dateKey == capturedKey, generation == loadGeneration else { return }
                    allRaces = cachedRaces
                }
                allRaces = try await SupabaseService.shared.racesByYear(year)
                guard dateKey == capturedKey, generation == loadGeneration else { return }
                await cache.save(allRaces, forKey: yearKey)
            }

            // Añadir placeholders para carreras sin etapa publicada
            let coveredIds = Set(items.compactMap(\.raceDay.raceId))
            let placeholders = allRaces.filter { race in
                guard !race.isCancelled,
                      !coveredIds.contains(race.id),
                      (race.year ?? 0) == year else { return false }
                return RaceLogic.isRaceDay(race: race, dateKey: dateKey)
            }

            for race in placeholders {
                let theoreticalStage = RaceLogic.theoreticalStageNumber(race: race, dateKey: dateKey)
                var enriched = EnrichedRaceDay(
                    raceDay: RaceDay(
                        id: "ph-\(race.id)-\(dateKey)",
                        raceId: race.id,
                        dateKey: dateKey,
                        slug: nil,
                        isRestDay: false,
                        isCancelledDay: false,
                        stageNumber: theoreticalStage,
                        startLocation: nil,
                        finishLocation: nil,
                        distanceKm: nil,
                        primaryType: nil,
                        secondaryType: nil,
                        neutralStartTimeUtc: nil,
                        estimatedFinishTimeUtc: nil,
                        tvStatus: nil,
                        description: nil,
                        bonuses: nil,
                        notes: nil,
                        editorialStatus: "published",
                        hasAssets: false,
                        updatedAt: nil,
                        countryCode: nil
                    ),
                    race: race,
                    broadcasts: [],
                    assets: []
                )
                enriched.isPlaceholder = true
                items.append(enriched)
            }

            // Guardar en caché el resultado completo del día (con placeholders)
            let relevantRaceIds = Set(items.compactMap { $0.race?.id })
            let relevantRaces = allRaces.filter { relevantRaceIds.contains($0.id) }
            let fullData = DayData(
                raceDays: items,
                raceMap: Dictionary(uniqueKeysWithValues: relevantRaces.map { ($0.id, $0) })
            )
            await cache.save(fullData, forKey: cacheKey)

            // Pre-cachear +1 y +2 en background
            prefetchNearbyDays()

            // Buscar siguiente día con carreras (respetando filtro activo)
            nextDayWithRaces = nextDayMatchingFilter(after: dateKey)

            // Actualizar snapshot del widget si estamos viendo hoy, respetando filtro activo
            if isToday {
                let widgetFiltered = RaceLogic.filterByCategory(items, category: activeFilter)
                let (nextBroadcast, nextTvStatus) = await fetchNextRaceInfo(nextDateKey: nextDayWithRaces)
                writeWidgetPayload(items: widgetFiltered, nextDateKey: nextDayWithRaces, nextRaceName: nextRaceName(for: nextDayWithRaces), nextRaceBroadcastStartTimeUtc: nextBroadcast, nextRaceTvStatus: nextTvStatus, dateKey: dateKey)
            }

            // Auto-navegar si no hay items visibles. Solo con el filtro "Todas"
            // (evita saltos sorpresa cuando el usuario filtra a propósito), CON UNA
            // EXCEPCIÓN: dentro de la ventana de Campeonatos el filtro Masculino
            // está FORZADO (no lo eligió el usuario) y los días 22-23 no tienen
            // carreras → se auto-avanza igual al siguiente día con carreras
            // masculinas (el escaneo respeta el filtro activo, sin bucle).
            let champLock = ChampionshipsConfig.isChampWeekFilterLock(today: dateKey)
            if (activeFilter == .all || champLock), displayItems.isEmpty, let next = nextDayWithRaces {
                isLoading = false
                isNetworkLoading = false
                goToDate(next)
                return
            }
        } catch {
            // Tarea cancelada (usuario navegó a otra vista mientras la red estaba
            // en vuelo): la caché ya está en `items` y `isFromCache = true`, pero
            // NO sabemos si hay conexión — no hay motivo para mostrar el banner
            // "Sin conexión". Reseteamos el estado para que el banner no se quede
            // pegado al volver a esta vista.
            guard dateKey == capturedKey, generation == loadGeneration else { return }
            if Task.isCancelled {
                isFromCache = false
                isLoading = false
                isNetworkLoading = false
                return
            }
            // Si ya teníamos datos de caché, no sobreescribir con error.
            // Descartar si el usuario navegó a otra fecha mientras esperábamos red.
            if items.isEmpty {
                isUncachedOffline = true
            }
        }
        isLoading = false
        isNetworkLoading = false
    }

    /// Pre-cachea días cercanos en background:
    /// -1, +1, +2 completos; +3…+7 solo si hay carreras UWT o WWT.
    private func prefetchNearbyDays() {
        guard dateKey == DateFormatting.todayKey() else { return }
        let racesSnapshot = allRaces
        let today = DateFormatting.todayKey()
        Task.detached(priority: .utility) {
            for offset in ([-1] + Array(1...7)) {
                guard let targetDate = DateFormatting.dayOffset(from: today, by: offset) else { continue }

                // +3…+7: solo prefetchear si hay alguna carrera UWT/WWT ese día
                if offset >= 3 {
                    let hasTopRace = racesSnapshot.contains { race in
                        guard !race.isCancelled else { return false }
                        let cat = race.uciCategory ?? ""
                        let isTopTier = cat == "1.UWT" || cat == "2.UWT" || cat == "1.WWT" || cat == "2.WWT"
                        return isTopTier && RaceLogic.isRaceDay(race: race, dateKey: targetDate)
                    }
                    guard hasTopRace else { continue }
                }

                let key = CacheManager.dayKey(targetDate)
                // Solo pre-cachear si no hay datos recientes (< 1 hora)
                if let age = await CacheManager.shared.age(forKey: key), age < 3600 { continue }
                do {
                    let data = try await SupabaseService.shared.loadDayComplete(dateKey: targetDate)
                    await CacheManager.shared.save(data, forKey: key)
                } catch {
                    // Fallo silencioso en prefetch
                }
            }
        }
    }

    /// Ajusta `dateKey` y `activeFilter` según el bloqueo de Campeonatos de la
    /// jornada destino (entrar/salir de la ventana). NO dispara la carga.
    func applyDateForChampLock(_ newDate: String) {
        let wasLock = ChampionshipsConfig.isChampWeekFilterLock(today: dateKey)
        let nowLock = ChampionshipsConfig.isChampWeekFilterLock(today: newDate)
        if nowLock && !wasLock {
            // Entramos → Masculino forzado (o el manual previo de esta sesión).
            activeFilter = champManualFilter ?? ChampionshipsConfig.champWeekHoyDefault
        } else if !nowLock && wasLock {
            // Salimos → restaurar el pin del usuario; olvidar el manual de ventana.
            champManualFilter = nil
            activeFilter = pinnedFilter
        }
        dateKey = newDate
    }

    func goToDate(_ newDate: String) {
        applyDateForChampLock(newDate)
        Task { await loadDay() }
    }

    func goToToday() {
        goToDate(DateFormatting.todayKey())
    }

    func goToPreviousDay() {
        if let prev = previousDayMatchingFilter(before: dateKey) {
            goToDate(prev)
        } else if let prev = DateFormatting.previousDay(dateKey) {
            goToDate(prev)
        }
    }

    func goToNextDay() {
        if let next = nextDayMatchingFilter(after: dateKey) {
            goToDate(next)
        } else if let next = DateFormatting.nextDay(dateKey) {
            goToDate(next)
        }
    }

    // MARK: - Filter-aware day scanning

    /// Busca el siguiente día con carreras que coincidan con el filtro activo.
    /// Escanea hasta 180 días hacia delante.
    func nextDayMatchingFilter(after dateKey: String) -> String? {
        guard !allRaces.isEmpty else { return nil }
        var candidate = dateKey
        for _ in 0..<180 {
            guard let next = DateFormatting.nextDay(candidate) else { break }
            candidate = next
            if hasMatchingRaces(on: candidate, filter: activeFilter) {
                return candidate
            }
        }
        return nil
    }

    /// Busca el día anterior con carreras que coincidan con el filtro activo.
    /// Escanea hasta 180 días hacia atrás.
    func previousDayMatchingFilter(before dateKey: String) -> String? {
        guard !allRaces.isEmpty else { return nil }
        var candidate = dateKey
        for _ in 0..<180 {
            guard let prev = DateFormatting.previousDay(candidate) else { break }
            candidate = prev
            if hasMatchingRaces(on: candidate, filter: activeFilter) {
                return candidate
            }
        }
        return nil
    }

    /// Info de TV de la jornada concreta que nextRaceName() devolvería para esa fecha.
    /// Usa el mismo race ID para garantizar coherencia entre nombre y datos de TV.
    func fetchNextRaceInfo(nextDateKey: String?) async -> (broadcastTime: String?, tvStatus: String?) {
        guard let key = nextDateKey else { return (nil, nil) }
        guard let nextRace = allRaces.first(where: { race in
            guard !race.isCancelled else { return false }
            guard RaceLogic.isRaceDay(race: race, dateKey: key) else { return false }
            return RaceLogic.matchesCategory(race, filter: activeFilter)
        }) else { return (nil, nil) }
        guard let cached: DayData = await CacheManager.shared.load(DayData.self, forKey: CacheManager.dayKey(key)) else { return (nil, nil) }
        guard let enriched = cached.raceDays.first(where: { $0.race?.id == nextRace.id && !$0.isPlaceholder }) else { return (nil, nil) }
        let broadcastTime = enriched.broadcasts
            .filter { !($0.channel?.isEmpty ?? true) }
            .compactMap { $0.startTimeUtc }
            .sorted()
            .first
        return (broadcastTime, enriched.raceDay.tvStatus)
    }

    /// Nombre de la primera carrera del filtro activo en la fecha dada.
    func nextRaceName(for dateKey: String?) -> String? {
        guard let key = dateKey else { return nil }
        return allRaces.first { race in
            guard !race.isCancelled else { return false }
            guard RaceLogic.isRaceDay(race: race, dateKey: key) else { return false }
            return RaceLogic.matchesCategory(race, filter: activeFilter)
        }?.name
    }

    /// Comprueba si hay carreras que coincidan con el filtro en un día dado.
    private func hasMatchingRaces(on dateKey: String, filter: Constants.CategoryFilter) -> Bool {
        allRaces.contains { race in
            guard !race.isCancelled else { return false }
            guard RaceLogic.isRaceDay(race: race, dateKey: dateKey) else { return false }
            return RaceLogic.matchesCategory(race, filter: filter)
        }
    }
}

// MARK: - Widget payload types + writer
// Accesibles desde OfflineManager (mismo módulo) y CalendarioCiclismoApp.

struct WidgetPayloadData: Codable {
    let payloadVersion: Int
    let generatedAtUtc: String
    let dateKey: String
    let items: [WidgetPayloadItem]
    let overflowCount: Int
    let specialState: WidgetSpecialState?
    let nextRaceDateKey: String?
    let nextRaceName: String?
    let nextRaceBroadcastStartTimeUtc: String?
    let nextRaceTvStatus: String?
}

struct WidgetPayloadItem: Codable {
    let raceDayId: String
    let raceId: String
    let raceName: String
    let countryCode: String?
    let uciCategory: String?
    let gender: String?
    let stageLabel: String
    let startLocation: String?
    let finishLocation: String?
    let startTimeUtc: String?
    let estimatedFinishTimeUtc: String?
    let primaryType: String?
    let distanceKm: Double?
    let typeLabel: String?
    let hasLiveText: Bool?
    let channels: [String]
    let broadcastStartTimeUtc: String?
    let tvStatus: String?
}

struct WidgetSpecialState: Codable {
    let kind: String
    let raceName: String
    let countryCode: String?
}

private let _widgetAppGroupID      = "group.app.calendariociclismo"
private let _widgetPayloadFilename = "widget_today_payload.json"

/// Construye el JSON del widget a partir de los EnrichedRaceDay del día.
/// Función top-level accesible por TodayViewModel y OfflineManager.
func writeWidgetPayload(items: [EnrichedRaceDay], nextDateKey: String?, nextRaceName: String? = nil, nextRaceBroadcastStartTimeUtc: String? = nil, nextRaceTvStatus: String? = nil, dateKey: String) {
    let iso = ISO8601DateFormatter()

    let activeItems = items.filter { !$0.raceDay.isRestDay && !$0.raceDay.isCancelledDay && !$0.isPlaceholder }
    let sorted = activeItems.sorted { RaceLogic.sortByCategory($0, $1) }
    let topItems = sorted
    let overflowCount = 0

    let widgetItems = topItems.map { enriched -> WidgetPayloadItem in
        let rd   = enriched.raceDay
        let race = enriched.race

        let countryCode: String?
        if let c = rd.countryCode, !c.isEmpty {
            countryCode = c
        } else if race?.hideFlag == false {
            countryCode = race?.countryCode
        } else {
            countryCode = nil
        }

        let label: String
        if let n = rd.stageNumber {
            if rd.primaryType == "itt" {
                label = n == 0 ? "CRI · Prólogo" : "CRI · Etapa \(n)\(rd.stageSuffix ?? "")"
            } else {
                let base = n == 0 ? "Prólogo" : "Etapa \(n)"
                label = "\(base)\(rd.stageSuffix ?? "")"
            }
        } else {
            label = rd.primaryType == "itt" ? "CRI" : ""
        }

        let channels = enriched.broadcasts
            .filter { !($0.channel?.isEmpty ?? true) }
            .sorted { ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0) }
            .prefix(2)
            .compactMap { $0.channel }

        let broadcastStartTimeUtc = enriched.broadcasts
            .filter { !($0.channel?.isEmpty ?? true) }
            .compactMap { $0.startTimeUtc }
            .sorted()
            .first

        return WidgetPayloadItem(
            raceDayId:              rd.id,
            raceId:                 race?.id ?? rd.raceId ?? rd.id,
            raceName:               race?.name ?? "",
            countryCode:            countryCode,
            uciCategory:            race?.uciCategory,
            gender:                 race?.gender,
            stageLabel:             label,
            startLocation:          rd.startLocation,
            finishLocation:         rd.finishLocation,
            startTimeUtc:           rd.neutralStartTimeUtc,
            estimatedFinishTimeUtc: rd.estimatedFinishTimeUtc,
            primaryType:            rd.primaryType,
            distanceKm:             rd.distanceKm,
            typeLabel:              {
                // ITT ya encoda "CRI" en stageLabel; no duplicar
                guard let p = rd.primaryType, !p.isEmpty, p != "itt" else { return nil }
                let lbl = RaceLogic.resolveTypeLabel(primary: p, secondary: rd.secondaryType, countryCode: race?.countryCode)
                return lbl.isEmpty ? nil : lbl
            }(),
            hasLiveText:            enriched.assets.contains { $0.type == "live_text" },
            channels:               Array(channels),
            broadcastStartTimeUtc:  broadcastStartTimeUtc,
            tvStatus:               rd.tvStatus
        )
    }

    // Solo mostrar en solitario si tiene TV confirmada (con o sin hora)
    let filteredItems = widgetItems.count == 1 && widgetItems[0].channels.isEmpty && widgetItems[0].tvStatus != "confirmed"
        ? []
        : widgetItems

    var specialState: WidgetSpecialState?
    if activeItems.isEmpty, !items.isEmpty, let first = items.first {
        let kind = first.raceDay.isRestDay ? "rest_day" : "cancelled"
        specialState = WidgetSpecialState(
            kind:        kind,
            raceName:    first.race?.name ?? "",
            countryCode: first.race?.countryCode
        )
    }

    let payload = WidgetPayloadData(
        payloadVersion:  1,
        generatedAtUtc:  iso.string(from: Date()),
        dateKey:         dateKey,
        items:           filteredItems,
        overflowCount:   overflowCount,
        specialState:    specialState,
        nextRaceDateKey:                nextDateKey,
        nextRaceName:                   nextRaceName,
        nextRaceBroadcastStartTimeUtc:  nextRaceBroadcastStartTimeUtc,
        nextRaceTvStatus:               nextRaceTvStatus
    )

    guard let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: _widgetAppGroupID
    ) else { return }
    let cacheDir = container.appendingPathComponent("Caches")
    try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    let fileURL = cacheDir.appendingPathComponent(_widgetPayloadFilename)
    guard let data = try? JSONEncoder().encode(payload) else { return }
    try? data.write(to: fileURL, options: Data.WritingOptions.atomic)
    WidgetCenter.shared.reloadTimelines(ofKind: "TodayCyclingWidget")
}
