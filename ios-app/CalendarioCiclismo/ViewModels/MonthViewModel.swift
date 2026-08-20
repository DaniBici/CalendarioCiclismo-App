import Foundation

/// ViewModel para la vista de calendario mensual — equivalente a `js/mes.js`.
/// Carga todos los race_days del año para permitir scroll horizontal entre meses.
@MainActor
@Observable
final class MonthViewModel {
    var year: Int = Calendar.current.component(.year, from: Date())
    var month: Int = Calendar.current.component(.month, from: Date()) // 1-12
    var allRaceDays: [RaceDay] = []
    var races: [Race] = []
    var isLoading = false
    var error: String?
    var activeFilter: Constants.CategoryFilter = .all
    /// Indica que los datos mostrados provienen de la caché offline.
    var isFromCache = false
    /// Texto legible con la antigüedad de la caché (ej: "Hace 2 h").
    var cacheAgeLabel: String?
    /// Indica que el año no está cacheado y no hay conexión para descargarlo.
    var isUncachedOffline = false
    private var loadedYear: Int?

    init() {
        if let raw = UserDefaults.standard.string(forKey: "defaultFilter"),
           let stored = Constants.CategoryFilter(rawValue: raw) {
            activeFilter = stored
        }
    }

    func setDefaultFilter(_ filter: Constants.CategoryFilter) {
        activeFilter = filter
        UserDefaults.standard.set(filter.rawValue, forKey: "defaultFilter")
    }

    func clearDefaultFilter() {
        activeFilter = .all
        UserDefaults.standard.removeObject(forKey: "defaultFilter")
    }

    /// Años disponibles para el selector.
    var availableYears: [Int] {
        let current = Calendar.current.component(.year, from: Date())
        return Array((2026...max(2026, current + 1)).reversed())
    }

    /// Título para un mes específico: "Abril de 2026".
    func title(forMonth m: Int) -> String {
        DateFormatting.formatMonthYear(year: year, month: m - 1) // month-1 porque formatMonthYear usa 0-based
    }

    /// Mapa de carreras por ID.
    var raceMap: [String: Race] {
        Dictionary(uniqueKeysWithValues: races.map { ($0.id, $0) })
    }

    /// Jornadas del mes indicado (publicadas + placeholders), filtradas por categoría,
    /// ordenadas por categoría UCI y agrupadas por dateKey.
    func daysByDate(forMonth m: Int) -> [String: [RaceDay]] {
        let monthPrefix = String(format: "%04d-%02d", year, m)
        let map = raceMap
        var filtered: [RaceDay]
        if activeFilter == .all {
            filtered = allRaceDays.filter { $0.dateKey.hasPrefix(monthPrefix) }
        } else {
            filtered = allRaceDays.filter { rd in
                guard rd.dateKey.hasPrefix(monthPrefix) else { return false }
                guard let raceId = rd.raceId, let race = map[raceId] else { return false }
                return RaceLogic.matchesCategory(race, filter: activeFilter)
            }
        }
        // En Mes, NINGUNA CN se muestra suelta, independientemente de la fecha:
        // los Campeonatos se representan SOLO por la fila sintética "Campeonatos
        // Nacionales" de la semana 22-28 jun (la inserta la vista en esos días).
        // Paridad EXACTA con la web (`js/calendario-mes.js`: `if (cat === 'CN')
        // return false` en `passesCategoryFilter`, sin condición de fecha). Antes
        // iOS solo ocultaba las CN dentro del rango 22-28 → las CN de junio fuera
        // de esas fechas se colaban como filas sueltas.
        filtered = filtered.filter { rd in
            rd.raceId.flatMap { map[$0]?.uciCategory } != "CN"
        }
        // Agrupar por fecha y ordenar cada grupo por categoría UCI (como mes.js)
        var grouped = Dictionary(grouping: filtered, by: \.dateKey)
        for (key, days) in grouped {
            grouped[key] = days.sorted { a, b in
                let rA = a.raceId.flatMap { map[$0] }
                let rB = b.raceId.flatMap { map[$0] }

                // Placeholders al final
                let phA = a.editorialStatus == "placeholder" ? 1 : 0
                let phB = b.editorialStatus == "placeholder" ? 1 : 0
                if phA != phB { return phA < phB }

                // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría.
                if let cn = ChampionshipsConfig.compare(rA, a, rB, b), cn != 0 {
                    return cn < 0
                }

                let lvlA = RaceLogic.proLevel(category: rA?.uciCategory, name: rA?.name, country: rA?.countryCode)
                let lvlB = RaceLogic.proLevel(category: rB?.uciCategory, name: rB?.name, country: rB?.countryCode)
                if lvlA != lvlB { return lvlA < lvlB }

                let genA = RaceLogic.genderRank(rA?.gender)
                let genB = RaceLogic.genderRank(rB?.gender)
                if genA != genB { return genA < genB }

                let catA = RaceLogic.uciRank(category: rA?.uciCategory, name: rA?.name, country: rA?.countryCode)
                let catB = RaceLogic.uciRank(category: rB?.uciCategory, name: rB?.name, country: rB?.countryCode)
                if catA != catB { return catA < catB }

                // Doble sector (misma carrera, mismo día): la etapa MÁS TEMPRANA
                // primero. Desempate por hora de salida; si falta, por el sufijo
                // A/B (asignado en orden cronológico por annotateDoubleSectors).
                let tA = a.neutralStartTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) } ?? Double.greatestFiniteMagnitude
                let tB = b.neutralStartTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) } ?? Double.greatestFiniteMagnitude
                if tA != tB { return tA < tB }
                let sfxA = a.stageSuffix ?? "", sfxB = b.stageSuffix ?? ""
                if sfxA != sfxB { return sfxA < sfxB }

                return (rA?.name ?? "").localizedCompare(rB?.name ?? "") == .orderedAscending
            }
        }
        return grouped
    }

    // MARK: - Cache

    private struct YearMonthCache: Codable {
        let raceDays: [RaceDay]
        let races: [Race]
    }

    /// Compatible con la caché per-month de OfflineManager.
    private struct PerMonthCache: Codable {
        let raceDays: [RaceDay]
        let races: [Race]
    }

    // MARK: - Data loading

    /// Carga todos los race_days y carreras del año.
    func loadYear() async {
        guard loadedYear != year else { return }
        isLoading = true
        error = nil
        isUncachedOffline = false

        // Limpiar datos del año anterior
        allRaceDays = []
        races = []
        isFromCache = false
        cacheAgeLabel = nil

        let cache = CacheManager.shared
        let cacheKey = "monthview_\(year)"

        // 1. Intentar caché a nivel de año
        if let cached: YearMonthCache = await cache.load(YearMonthCache.self, forKey: cacheKey) {
            var cachedDays = cached.raceDays
            RaceLogic.annotateDoubleSectors(&cachedDays)
            allRaceDays = cachedDays
            races = cached.races
            loadedYear = year
            isFromCache = true
            cacheAgeLabel = await cache.ageLabel(forKey: cacheKey)
            isLoading = false
        }

        // 2. Si no hay caché de año, intentar cachés per-month (OfflineManager o sesiones previas)
        if allRaceDays.isEmpty {
            var combinedDays: [RaceDay] = []
            var fallbackRaces: [Race] = []
            for m in 1...12 {
                let monthCacheKey = CacheManager.monthKey(year: year, month: m)
                if let monthCached: PerMonthCache = await cache.load(PerMonthCache.self, forKey: monthCacheKey) {
                    combinedDays.append(contentsOf: monthCached.raceDays)
                    if fallbackRaces.isEmpty {
                        fallbackRaces = monthCached.races
                    }
                }
            }
            if !combinedDays.isEmpty {
                RaceLogic.annotateDoubleSectors(&combinedDays)
                allRaceDays = combinedDays
                races = fallbackRaces
                loadedYear = year
                isFromCache = true
                cacheAgeLabel = await cache.ageLabel(forKey: CacheManager.monthKey(year: year, month: month))
                isLoading = false
            }
        }

        // 3. Intentar actualizar desde red
        do {
            let startKey = "\(year)-01-01"
            let endKey = "\(year)-12-31"

            async let daysResult = SupabaseService.shared.raceDays(from: startKey, to: endKey)
            async let racesResult = SupabaseService.shared.racesByYear(year)

            let (publishedDays, loadedRaces) = try await (daysResult, racesResult)
            races = loadedRaces

            // Generar placeholders para carreras sin race_days publicados
            let coveredRaceIds = Set(publishedDays.compactMap(\.raceId))
            var allDays = publishedDays
            let cal = Calendar(identifier: .iso8601)

            for race in races {
                guard !race.isCancelled else { continue }
                guard let raceStart = race.startDate, let raceEnd = race.endDate else { continue }
                guard !coveredRaceIds.contains(race.id) else { continue }
                guard raceEnd >= startKey, raceStart <= endKey else { continue }

                let overlapStart = max(raceStart, startKey)
                let overlapEnd = min(raceEnd, endKey)

                guard var cursor = DateFormatting.date(from: overlapStart),
                      let end = DateFormatting.date(from: overlapEnd) else { continue }

                while cursor <= end {
                    let dk = DateFormatting.toDateKey(cursor)
                    if RaceLogic.isRaceDay(race: race, dateKey: dk) {
                        let stageNum = RaceLogic.theoreticalStageNumber(race: race, dateKey: dk)
                        allDays.append(RaceDay(
                            id: "ph-\(race.id)-\(dk)",
                            raceId: race.id,
                            dateKey: dk,
                            slug: nil,
                            isRestDay: false,
                            isCancelledDay: false,
                            stageNumber: stageNum,
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
                            editorialStatus: "placeholder",
                            hasAssets: false,
                            updatedAt: nil,
                            countryCode: nil
                        ))
                    }
                    guard let next = cal.date(byAdding: .day, value: 1, to: cursor) else { break }
                    cursor = next
                }
            }

            // Detectar dobles sectores
            RaceLogic.annotateDoubleSectors(&allDays)

            allRaceDays = allDays
            loadedYear = year
            isFromCache = false
            cacheAgeLabel = nil

            // Guardar en caché a nivel de año
            await cache.save(YearMonthCache(raceDays: allDays, races: races), forKey: cacheKey)
        } catch {
            // Si ya teníamos datos de caché, no sobreescribir con error
            if allRaceDays.isEmpty {
                isUncachedOffline = true
            }
        }
        isLoading = false
    }

    /// Navega al mes y año actuales. Si el año cambió, recarga datos.
    func goToCurrentMonth() {
        let cal = Calendar.current
        let newYear = cal.component(.year, from: Date())
        let newMonth = cal.component(.month, from: Date())
        month = newMonth
        if newYear != year {
            year = newYear
            loadedYear = nil
            Task { await loadYear() }
        }
    }

    /// Cambia de año y recarga datos.
    func setYear(_ newYear: Int) {
        guard newYear != year else { return }
        year = newYear
        loadedYear = nil
        Task { await loadYear() }
    }
}
