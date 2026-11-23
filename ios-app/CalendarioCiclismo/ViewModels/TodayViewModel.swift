import Foundation
import SwiftUI

/// Disciplina inicial de Hoy, Resultados y Vídeos según el día civil local:
/// cada año es Ciclocross desde el día siguiente a la Chrono des Nations (el
/// tercer domingo de octubre: 18-10-2026, 17-10-2027) hasta el domingo anterior
/// al primer lunes del año siguiente (el de 2027 es el 4 de enero); el resto del
/// año, Ruta. El primer periodo empieza el 19 de octubre de 2026. Sin
/// ediciones anuales. Espejo de `RoadTodayAvailability` en Android y de
/// `cyclocrossHome` en la web.
enum RoadTodayAvailability {
    static let firstCyclocrossDay = "2026-10-19"

    /// Día de la semana (0 = domingo) del día 1 del mes, calendario gregoriano.
    private static func weekdayOfFirst(year: Int, month: Int) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = calendar.date(from: DateComponents(year: year, month: month, day: 1))!
        return calendar.component(.weekday, from: date) - 1
    }

    /// Tercer domingo de octubre de `year`: día de la Chrono des Nations.
    static func chronoDesNationsDay(year: Int) -> String {
        let day = 1 + (7 - weekdayOfFirst(year: year, month: 10)) % 7 + 14
        return String(format: "%04d-10-%02d", year, day)
    }

    /// Primer lunes de enero de `year`: día en que se vuelve a Ruta.
    static func firstMondayOfYear(year: Int) -> String {
        let day = 1 + (8 - weekdayOfFirst(year: year, month: 1)) % 7
        return String(format: "%04d-01-%02d", year, day)
    }

    /// Valores (`Tab.value`) de cada sección; identidad estable con
    /// independencia de la posición, coincidente con `DeepLink.tab`.
    /// 5 y 6 corresponden a los enlaces retirados `subscribe` y `notifications`.
    static let todayTab = 0, resultsTab = 1, transfersTab = 2, cyclocrossTab = 3, calendarTab = 4, videosTab = 7

    /// True si, en `today` (YYYY-MM-DD), la disciplina inicial es Ciclocross.
    static func isCyclocrossPeriod(today: String = DateFormatting.todayKey()) -> Bool {
        guard today >= firstCyclocrossDay,
              let year = Int(today.prefix(4)), let month = Int(today.dropFirst(5).prefix(2)) else { return false }
        return month >= 7 ? today > chronoDesNationsDay(year: year) : today < firstMondayOfYear(year: year)
    }

    /// Fuera de ese periodo Hoy abre en Ruta.
    static func isVisible(today: String = DateFormatting.todayKey()) -> Bool {
        !isCyclocrossPeriod(today: today)
    }

    /// Pestañas en el orden de la barra, todo el año (docs/plans/videos-5-2.md,
    /// D1): Hoy (agenda de Ciclocross y Hoy de carretera con el conmutador
    /// «CX | Ruta»), Resultados, Vídeos, Fichajes y Calendario.
    static let tabs = [cyclocrossTab, resultsTab, videosTab, transfersTab, calendarTab]

    static let initialTab = cyclocrossTab

    /// Pantalla de portada para las invitaciones a contribuir y a valorar la
    /// app: Hoy o, mientras está retirada, la agenda de Ciclocross.
    static func homeScreenName(today: String = DateFormatting.todayKey()) -> String {
        isVisible(today: today) ? "today" : "cyclocross"
    }
}

/// ViewModel para la vista de agenda del día — equivalente a `js/app.js`.
@MainActor
@Observable
final class TodayViewModel {
    var dateKey: String = DateFormatting.todayKey()
    var items: [EnrichedRaceDay] = []
    var allRaces: [Race] = []
    var isLoading = false
    var error: String?
    /// Orden de la agenda, recordado (`road_sort_mode`).
    var sortMode: SortMode = SortMode(rawValue: UserDefaults.standard.string(forKey: "road_sort_mode") ?? "") ?? .category {
        didSet { UserDefaults.standard.set(sortMode.rawValue, forKey: "road_sort_mode") }
    }
    var nextDayWithRaces: String?
    /// Hoy sin carreras visibles y a punto de saltar al siguiente día con
    /// carreras (a veces del año siguiente, que hay que descargar): la vista
    /// mantiene la pantalla de carga en lugar de mostrar el estado vacío.
    var isResolvingJump = false
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
            // «Cat. UCI», como en la web: «Categoría» es el desplegable del filtro.
            case .category:   return LocaleService.t("Cat. UCI", "UCI Cat.")
            case .tvTime:     return LocaleService.t("Hora TV", "TV time")
            case .finishTime: return LocaleService.t("Hora de meta", "Finish time")
            }
        }
    }

    /// Filtros de carretera, recordados y compartidos con Mes y Temporada
    /// (`RaceFilterStore`).
    var filter: RoadRaceFilter { RaceFilterStore.shared.road }

    /// Items filtrados y ordenados.
    var displayItems: [EnrichedRaceDay] {
        let filtered = filter.apply(items)
        return RaceLogic.sortTodayAgenda(filtered, sortMode: sortMode, featuredRaceIds: featuredRaceIds)
    }

    var dateLabel: String {
        DateFormatting.formatDateLabel(dateKey)
    }

    var isToday: Bool {
        dateKey == DateFormatting.todayKey()
    }

    /// Día al que lleva «Hoy»: la fecha actual.
    var currentDayKey: String {
        DateFormatting.todayKey()
    }

    var isShowingCurrentDay: Bool {
        dateKey == currentDayKey
    }

    // Última fecha local que se mostró COMO "hoy". Permite distinguir "el usuario
    // está en hoy y ha cruzado la medianoche local" (→ auto-avanzar) de "navegó a
    // otro día a mano" (→ no tocar). Se sincroniza cuando el día mostrado es hoy.
    private var lastTodayKey: String = DateFormatting.todayKey()

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
        // Al cambiar de día, un día de la caché sin carreras visibles no se
        // pinta como vacío hasta saber si la red lo deja o salta a otro.
        isResolvingJump = !retainsContent

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

        // 2. Intentar actualizar desde red. El día y las carreras del año son
        // independientes: salen a la vez. Ambas peticiones se comparten con la
        // precarga del arranque si siguen en vuelo o acaban de resolverse.
        let year = Int(dateKey.prefix(4)) ?? 2026
        let yearKey = CacheManager.yearRacesKey(year)
        let racesAge = await cache.age(forKey: yearKey)
        guard dateKey == capturedKey, generation == loadGeneration else { return }
        let needsRaces = forceRaceRefresh || allRaces.isEmpty || allRaces.first?.year != year || (racesAge ?? .infinity) >= 3600
        if needsRaces, allRaces.isEmpty, let cachedRaces: [Race] = await cache.load([Race].self, forKey: yearKey) {
            guard dateKey == capturedKey, generation == loadGeneration else { return }
            allRaces = cachedRaces
        }
        let service = SupabaseService.shared
        async let yearRacesReq: Result<[Race], Error>? = needsRaces
            ? Self.capture { try await service.racesByYear(year, forceNetwork: forceRaceRefresh) }
            : nil
        do {
            let data = try await service.loadDayComplete(dateKey: capturedKey, forceNetwork: forceRaceRefresh)
            guard dateKey == capturedKey, generation == loadGeneration else { return }
            // Construir la respuesta fuera del estado visible. Durante un pull
            // refresh hay placeholders en `items`; sustituirlos antes de acabar
            // la consulta anual los hace desaparecer mientras la petición sigue
            // pendiente y los pierde definitivamente si esa petición falla.
            var refreshedItems = data.raceDays
            let refreshedFeaturedRaceIds = data.featuredRaceIds

            // Carreras del año para placeholders
            switch await yearRacesReq {
            case .success(let freshRaces)?:
                guard dateKey == capturedKey, generation == loadGeneration else { return }
                allRaces = freshRaces
                await cache.save(freshRaces, forKey: yearKey)
            case .failure(let error)?:
                guard dateKey == capturedKey, generation == loadGeneration else { return }
                if Task.isCancelled { throw error }
                // Una respuesta anual fallida no invalida la instantánea
                // local: conservarla permite reconstruir las tarjetas
                // placeholder y mostrar el día recién descargado.
            case nil:
                break
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
            // Sin carreras visibles y sin más días en este año: busca en el siguiente.
            if displayItems.isEmpty, nextDayWithRaces == nil {
                isResolvingJump = true
                await includeFollowingYear()
                guard dateKey == capturedKey, generation == loadGeneration else { return }
                nextDayWithRaces = nextDayMatchingFilter(after: dateKey)
                if nextDayWithRaces == nil { isResolvingJump = false }
            }

            // Sin carreras visibles (con o sin filtros), salta siempre al
            // siguiente día que las tenga.
            if displayItems.isEmpty, let next = nextDayWithRaces {
                isResolvingJump = true
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
                isResolvingJump = false
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
        isResolvingJump = false
        isLoading = false
        isNetworkLoading = false
    }

    /// Pre-cachea días cercanos al día mostrado (no solo hoy) en background:
    /// -1, +1, +2 completos; +3…+7 solo si hay carreras UWT o WWT. Hasta
    /// `prefetchConcurrency` días a la vez.
    private func prefetchNearbyDays() {
        let racesSnapshot = allRaces
        let anchor = dateKey
        Task.detached(priority: .utility) {
            let targets: [String] = ([-1] + Array(1...7)).compactMap { offset in
                guard let targetDate = DateFormatting.dayOffset(from: anchor, by: offset) else { return nil }
                // +3…+7: solo prefetchear si hay alguna carrera UWT/WWT ese día
                if offset >= 3 {
                    let hasTopRace = racesSnapshot.contains { race in
                        guard !race.isCancelled else { return false }
                        let cat = race.uciCategory ?? ""
                        let isTopTier = cat == "1.UWT" || cat == "2.UWT" || cat == "1.WWT" || cat == "2.WWT"
                        return isTopTier && RaceLogic.isRaceDay(race: race, dateKey: targetDate)
                    }
                    guard hasTopRace else { return nil }
                }
                return targetDate
            }
            await withTaskGroup(of: Void.self) { group in
                var pending = targets[...]
                func addNext() {
                    guard let targetDate = pending.popFirst() else { return }
                    group.addTask {
                        let key = CacheManager.dayKey(targetDate)
                        // Solo pre-cachear si no hay datos recientes (< 1 hora)
                        if let age = await CacheManager.shared.age(forKey: key), age < 3600 { return }
                        // Fallo silencioso en prefetch
                        guard let data = try? await SupabaseService.shared.loadDayComplete(dateKey: targetDate) else { return }
                        await CacheManager.shared.save(data, forKey: key)
                    }
                }
                for _ in 0..<Self.prefetchConcurrency { addNext() }
                while await group.next() != nil { addNext() }
            }
        }
    }

    /// Días que el pre-cacheo descarga a la vez.
    private nonisolated static let prefetchConcurrency = 3

    /// Resultado de una petición sin propagar el error.
    private static func capture<T: Sendable>(
        _ operation: @MainActor @Sendable () async throws -> T
    ) async -> Result<T, Error> {
        do { return .success(try await operation()) } catch { return .failure(error) }
    }

    func goToDate(_ newDate: String) {
        dateKey = newDate
        Task { await loadDay() }
    }

    func goToToday() async {
        await navigate(to: currentDayKey)
    }

    func goToPreviousDay() async {
        let earliest = DateFormatting.earliestRoadDate
        guard dateKey > earliest else { return }
        var found = previousDayMatchingFilter(before: dateKey)
        if found == nil, (Int(dateKey.prefix(4)) ?? 0) - 1 >= (Int(earliest.prefix(4)) ?? 0) {
            await includePreviousYear()
            found = previousDayMatchingFilter(before: dateKey)
        }
        if let prev = found ?? DateFormatting.previousDay(dateKey), prev >= earliest {
            await navigate(to: prev)
        }
    }

    func goToNextDay() async {
        var found = nextDayMatchingFilter(after: dateKey)
        if found == nil {
            await includeFollowingYear()
            found = nextDayMatchingFilter(after: dateKey)
        }
        if let next = found ?? DateFormatting.nextDay(dateKey) {
            await navigate(to: next)
        }
    }

    /// Navega a otra fecha para la animación de Hoy (mismo patrón que el cambio
    /// de mes de Ciclocross): mantiene el contenido saliente en pantalla y
    /// cambia a la caché del día destino en cuanto está disponible; el refresco
    /// de red continúa después sin pantalla de carga. Sin caché cae a la carga
    /// normal (pantalla de marca durante la entrada).
    func navigate(to newDate: String) async {
        dateKey = newDate
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

    /// Carreras de los años contiguos al mostrado, cargadas solo cuando el año
    /// mostrado no tiene más días que cumplan el filtro en ese sentido. Las
    /// fechas son absolutas: unirlas a `allRaces` nunca produce un día falso.
    private var followingYearRaces: [Race] = []
    private var followingYearOf: Int?
    private var previousYearRaces: [Race] = []
    private var previousYearOf: Int?

    /// Carga las carreras del año siguiente para que la búsqueda del próximo
    /// día con carreras cruce el cambio de año.
    func includeFollowingYear() async {
        guard let year = Int(dateKey.prefix(4)), followingYearOf != year,
              let races = await adjacentYearRaces(year + 1) else { return }
        followingYearRaces = races
        followingYearOf = year
    }

    /// Ídem hacia atrás: día anterior más allá del 1 de enero.
    func includePreviousYear() async {
        guard let year = Int(dateKey.prefix(4)), previousYearOf != year,
              let races = await adjacentYearRaces(year - 1) else { return }
        previousYearRaces = races
        previousYearOf = year
    }

    private func adjacentYearRaces(_ year: Int) async -> [Race]? {
        let cache = CacheManager.shared
        let key = CacheManager.yearRacesKey(year)
        if let fresh = try? await SupabaseService.shared.racesByYear(year) {
            await cache.save(fresh, forKey: key)
            return fresh
        }
        return await cache.load([Race].self, forKey: key)
    }

    /// Busca el siguiente día con carreras que coincidan con el filtro activo.
    /// Escanea hasta 400 días hacia delante (con el año siguiente si se cargó).
    func nextDayMatchingFilter(after dateKey: String) -> String? {
        guard !allRaces.isEmpty else { return nil }
        var candidate = dateKey
        for _ in 0..<400 {
            guard let next = DateFormatting.nextDay(candidate) else { break }
            candidate = next
            if hasMatchingRaces(on: candidate, filter: filter) {
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
        for _ in 0..<400 {
            guard let prev = DateFormatting.previousDay(candidate) else { break }
            candidate = prev
            if hasMatchingRaces(on: candidate, filter: filter) {
                return candidate
            }
        }
        return nil
    }

    /// Comprueba si hay carreras que coincidan con el filtro en un día dado.
    private func hasMatchingRaces(on dateKey: String, filter: RoadRaceFilter) -> Bool {
        (allRaces + followingYearRaces + previousYearRaces).contains { race in
            guard !race.isCancelled else { return false }
            guard RaceLogic.isRaceDay(race: race, dateKey: dateKey) else { return false }
            return filter.matches(race)
        }
    }
}
