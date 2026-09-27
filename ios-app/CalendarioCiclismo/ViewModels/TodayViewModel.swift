import Foundation
import SwiftUI

/// Último día de la temporada de carretera en Hoy, por año natural. Desde el
/// día siguiente y hasta el 31 de diciembre de ese año, Hoy no muestra ni
/// permite alcanzar fechas posteriores: el selector termina en este día y la
/// vista se queda en él. Un año sin entrada no tiene límite.
/// Espejo de `js/services/today-season.js` y de `TodaySeason` en Android.
enum TodaySeason {
    static let lastDayByYear: [Int: String] = [
        2026: "2026-10-18",
    ]

    /// Último día navegable según la fecha local actual, o nil.
    static func lastDay(today: String = DateFormatting.todayKey()) -> String? {
        guard let year = Int(today.prefix(4)) else { return nil }
        return lastDayByYear[year]
    }

    /// La propia fecha o, si lo supera, el último día de temporada.
    static func clamp(_ dateKey: String, today: String = DateFormatting.todayKey()) -> String {
        guard let last = lastDay(today: today), dateKey > last else { return dateKey }
        return last
    }

    static func contains(_ dateKey: String, today: String = DateFormatting.todayKey()) -> Bool {
        guard let last = lastDay(today: today) else { return true }
        return dateKey <= last
    }
}

/// ViewModel para la vista de agenda del día — equivalente a `js/app.js`.
@MainActor
@Observable
final class TodayViewModel {
    var dateKey: String = TodaySeason.clamp(DateFormatting.todayKey())
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
    var featuredRaceIds: Set<String> = []
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

    static func shouldRenderAsFeatured(_ isFeatured: Bool, sortMode: SortMode) -> Bool {
        sortMode == .category && isFeatured
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
    }

    func clearDefaultFilter() {
        pinnedFilter = .all
        activeFilter = .all
        UserDefaults.standard.removeObject(forKey: "defaultFilter")
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

    /// Items filtrados y ordenados.
    var displayItems: [EnrichedRaceDay] {
        let filtered = RaceLogic.filterByCategory(items, category: activeFilter)
        return filtered.sorted { a, b in
            let af = Self.shouldRenderAsFeatured(a.race.map { featuredRaceIds.contains($0.id) } ?? false, sortMode: sortMode)
            let bf = Self.shouldRenderAsFeatured(b.race.map { featuredRaceIds.contains($0.id) } ?? false, sortMode: sortMode)
            if af != bf { return af }
            switch sortMode {
            case .category: return RaceLogic.sortByCategory(a, b)
            case .tvTime: return RaceLogic.sortByTvTime(a, b)
            case .finishTime: return RaceLogic.sortByFinishTime(a, b)
            }
        }
    }

    var dateLabel: String {
        DateFormatting.formatDateLabel(dateKey)
    }

    var isToday: Bool {
        dateKey == DateFormatting.todayKey()
    }

    /// Día al que lleva «Hoy»: la fecha actual o, tras el cierre de temporada,
    /// el último día navegable.
    var currentDayKey: String {
        TodaySeason.clamp(DateFormatting.todayKey())
    }

    var isShowingCurrentDay: Bool {
        dateKey == currentDayKey
    }

    /// False en el último día de temporada: no hay día siguiente navegable.
    var canGoToNextDay: Bool {
        DateFormatting.nextDay(dateKey).map { TodaySeason.contains($0) } ?? false
    }

    // Última fecha local que se mostró COMO "hoy". Permite distinguir "el usuario
    // está en hoy y ha cruzado la medianoche local" (→ auto-avanzar) de "navegó a
    // otro día a mano" (→ no tocar). Se sincroniza cuando el día mostrado es hoy.
    private var lastTodayKey: String = TodaySeason.clamp(DateFormatting.todayKey())

    // Auto-avance de medianoche: si el día mostrado seguía siendo el "hoy" anterior
    // y la fecha local ya cambió, salta al nuevo hoy. Si el usuario navegó a otro
    // día, NO se le mueve. Lo invocan los ciclos de refresco / vuelta a primer plano.
    func advanceIfNewLocalDay() {
        let nowKey = currentDayKey
        if dateKey == nowKey { lastTodayKey = nowKey; return }   // ya estamos en hoy
        guard dateKey == lastTodayKey else { return }            // navegación manual: respetar
        lastTodayKey = nowKey
        goToDate(nowKey)
    }

    /// Recarga el día ya visible sin sustituir su contenido por una pantalla de
    /// carga. Es la semántica del pull-to-refresh y de los refrescos silenciosos
    /// al volver a primer plano: el indicador nativo acompaña a las cards, no
    /// las reemplaza.
    func refreshDay(force: Bool = false) async {
        if force { ImageRefresh.shared.refresh() }
        await loadDay(preservingContent: true, forceRaceRefresh: force)
    }

    /// Carga un día. Al navegar sí se limpia el contenido anterior; al refrescar
    /// el mismo día se conserva hasta que llegue una respuesta nueva.
    func loadDay(preservingContent: Bool = false, forceRaceRefresh: Bool = false) async {
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
            featuredRaceIds = cached.featuredRaceIds
            isFromCache = true
            cacheAgeLabel = await cache.ageLabel(forKey: cacheKey)
            isLoading = false
        }

        // 2. Intentar actualizar desde red
        do {
            let data = try await SupabaseService.shared.loadDayComplete(dateKey: dateKey)
            guard dateKey == capturedKey, generation == loadGeneration else { return }
            // Construir la respuesta fuera del estado visible. Durante un pull
            // refresh hay placeholders en `items`; sustituirlos antes de acabar
            // la consulta anual los hace desaparecer mientras la petición sigue
            // pendiente y los pierde definitivamente si esa petición falla.
            var refreshedItems = data.raceDays
            let refreshedFeaturedRaceIds = data.featuredRaceIds

            // Cargar todas las carreras del año para placeholders
            let year = Int(dateKey.prefix(4)) ?? 2026
            let yearKey = CacheManager.yearRacesKey(year)
            let racesAge = await cache.age(forKey: yearKey)
            guard dateKey == capturedKey, generation == loadGeneration else { return }
            if forceRaceRefresh || allRaces.isEmpty || allRaces.first?.year != year || (racesAge ?? .infinity) >= 3600 {
                if allRaces.isEmpty, let cachedRaces: [Race] = await cache.load([Race].self, forKey: yearKey) {
                    guard dateKey == capturedKey, generation == loadGeneration else { return }
                    allRaces = cachedRaces
                }
                do {
                    let freshRaces = try await SupabaseService.shared.racesByYear(year)
                    guard dateKey == capturedKey, generation == loadGeneration else { return }
                    allRaces = freshRaces
                    await cache.save(freshRaces, forKey: yearKey)
                } catch {
                    guard dateKey == capturedKey, generation == loadGeneration else { return }
                    if Task.isCancelled { throw error }
                    // Una respuesta anual fallida no invalida la instantánea
                    // local: conservarla permite reconstruir las tarjetas
                    // placeholder y mostrar el día recién descargado.
                }
            }

            // Añadir placeholders para carreras sin etapa publicada
            let coveredIds = Set(refreshedItems.compactMap(\.raceDay.raceId))
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
                refreshedItems.append(enriched)
            }

            // Guardar en caché el resultado completo del día (con placeholders)
            let relevantRaceIds = Set(refreshedItems.compactMap { $0.race?.id })
            let relevantRaces = allRaces.filter { relevantRaceIds.contains($0.id) }
            let fullData = DayData(
                raceDays: refreshedItems,
                raceMap: Dictionary(uniqueKeysWithValues: relevantRaces.map { ($0.id, $0) }),
                featuredRaceIds: refreshedFeaturedRaceIds
            )
            await cache.save(fullData, forKey: cacheKey)
            guard dateKey == capturedKey, generation == loadGeneration else { return }

            // Publicar la lista completa de una vez, ya con placeholders.
            items = refreshedItems
            featuredRaceIds = refreshedFeaturedRaceIds
            isFromCache = false
            cacheAgeLabel = nil
            refreshToken &+= 1
            lastNetworkLoadAt = Date()

            // Pre-cachear +1 y +2 en background
            prefetchNearbyDays()

            // Buscar siguiente día con carreras (respetando filtro activo)
            nextDayWithRaces = nextDayMatchingFilter(after: dateKey)

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

    /// Pre-cachea días cercanos al día mostrado (no solo hoy) en background:
    /// -1, +1, +2 completos; +3…+7 solo si hay carreras UWT o WWT.
    private func prefetchNearbyDays() {
        let racesSnapshot = allRaces
        let anchor = dateKey
        Task.detached(priority: .utility) {
            for offset in ([-1] + Array(1...7)) {
                guard let targetDate = DateFormatting.dayOffset(from: anchor, by: offset) else { continue }

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
    func applyDateForChampLock(_ requestedDate: String) {
        // Ninguna ruta de navegación (flechas, gestos, selector, deep links)
        // supera el último día de temporada.
        let newDate = TodaySeason.clamp(requestedDate)
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

    func goToToday() async {
        await navigate(to: currentDayKey)
    }

    func goToPreviousDay() async {
        if let prev = previousDayMatchingFilter(before: dateKey) {
            await navigate(to: prev)
        } else if let prev = DateFormatting.previousDay(dateKey) {
            await navigate(to: prev)
        }
    }

    func goToNextDay() async {
        guard canGoToNextDay else { return }
        if let next = nextDayMatchingFilter(after: dateKey) {
            await navigate(to: next)
        } else if let next = DateFormatting.nextDay(dateKey) {
            await navigate(to: next)
        }
    }

    /// Navega a otra fecha para la animación de Hoy (mismo patrón que el cambio
    /// de mes de Ciclocross): mantiene el contenido saliente en pantalla y
    /// cambia a la caché del día destino en cuanto está disponible; el refresco
    /// de red continúa después sin pantalla de carga. Sin caché cae a la carga
    /// normal (pantalla de marca durante la entrada).
    func navigate(to newDate: String) async {
        applyDateForChampLock(newDate)
        let key = CacheManager.dayKey(dateKey)
        if let cached: DayData = await CacheManager.shared.load(DayData.self, forKey: key) {
            items = cached.raceDays
            featuredRaceIds = cached.featuredRaceIds
            isFromCache = true
            // Marcamos la red en vuelo ANTES del primer await (ageLabel): cada
            // await contra CacheManager es una suspensión real del actor y en
            // esa ventana SwiftUI puede pintar un frame. Si isNetworkLoading
            // seguiera en false, el banner "Sin conexión"
            // (isFromCache && !isNetworkLoading) destellaría un frame.
            isNetworkLoading = true
            refreshToken &+= 1
            cacheAgeLabel = await CacheManager.shared.ageLabel(forKey: key)
            hasLoaded = true
            isUncachedOffline = false
            error = nil
        } else {
            items = []
        }
        await loadDay(preservingContent: !items.isEmpty)
    }

    // MARK: - Filter-aware day scanning

    /// Busca el siguiente día con carreras que coincidan con el filtro activo.
    /// Escanea hasta 180 días hacia delante, sin pasar del último día de temporada.
    func nextDayMatchingFilter(after dateKey: String) -> String? {
        guard !allRaces.isEmpty else { return nil }
        var candidate = dateKey
        for _ in 0..<180 {
            guard let next = DateFormatting.nextDay(candidate), TodaySeason.contains(next) else { break }
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

    /// Comprueba si hay carreras que coincidan con el filtro en un día dado.
    private func hasMatchingRaces(on dateKey: String, filter: Constants.CategoryFilter) -> Bool {
        allRaces.contains { race in
            guard !race.isCancelled else { return false }
            guard RaceLogic.isRaceDay(race: race, dateKey: dateKey) else { return false }
            return RaceLogic.matchesCategory(race, filter: filter)
        }
    }
}
