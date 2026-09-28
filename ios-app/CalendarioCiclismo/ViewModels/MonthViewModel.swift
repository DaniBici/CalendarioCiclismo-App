import Foundation

/// ViewModel para la vista de calendario mensual — equivalente a `js/mes.js`.
/// Carga únicamente el mes seleccionado y conserva una caché independiente por mes.
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
    /// Indica que el mes no está cacheado y no hay conexión para descargarlo.
    var isUncachedOffline = false
    private var loadedMonthKey: String?

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

                let catA = RaceLogic.raceCategoryRank(rA)
                let catB = RaceLogic.raceCategoryRank(rB)
                if catA != catB { return catA < catB }

                let genA = RaceLogic.genderRank(rA?.gender)
                let genB = RaceLogic.genderRank(rB?.gender)
                if genA != genB { return genA < genB }

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

    /// Compatible con la caché per-month de OfflineManager.
    private struct PerMonthCache: Codable {
        let raceDays: [RaceDay]
        let races: [Race]
    }

    // MARK: - Data loading

    /// Carga las jornadas y carreras que se solapan con el mes seleccionado.
    func loadMonth(force: Bool = false) async {
        let requestedKey = String(format: "%04d-%02d", year, month)
        guard force || loadedMonthKey != requestedKey else { return }
        isLoading = true
        error = nil
        isUncachedOffline = false
        allRaceDays = []
        races = []
        isFromCache = false
        cacheAgeLabel = nil

        let cache = CacheManager.shared
        let cacheKey = CacheManager.monthKey(year: year, month: month)
        let calendar = Calendar(identifier: .iso8601)
        let firstOfMonth = calendar.date(from: DateComponents(year: year, month: month, day: 1)) ?? Date()
        let daysInMonth = calendar.range(of: .day, in: .month, for: firstOfMonth)?.count ?? 30
        let startKey = "\(requestedKey)-01"
        let endKey = String(format: "%@-%02d", requestedKey, daysInMonth)

        if let cached: PerMonthCache = await cache.load(PerMonthCache.self, forKey: cacheKey) {
            guard isCurrentRequest(requestedKey) else { return }
            allRaceDays = displayDays(
                publishedDays: cached.raceDays,
                races: cached.races,
                startKey: startKey,
                endKey: endKey
            )
            races = cached.races
            loadedMonthKey = requestedKey
            isFromCache = true
            cacheAgeLabel = await cache.ageLabel(forKey: cacheKey)
            isLoading = false
        }

        do {
            let (publishedDays, loadedRaces) = try await SupabaseService.shared.calendarMonthData(
                from: startKey,
                to: endKey
            )
            guard isCurrentRequest(requestedKey) else { return }
            races = loadedRaces
            allRaceDays = displayDays(
                publishedDays: publishedDays,
                races: loadedRaces,
                startKey: startKey,
                endKey: endKey
            )
            loadedMonthKey = requestedKey
            isFromCache = false
            cacheAgeLabel = nil

            // La caché compartida conserva solo jornadas publicadas; los
            // placeholders se regeneran con las carreras vigentes.
            await cache.save(PerMonthCache(raceDays: publishedDays, races: races), forKey: cacheKey)
        } catch {
            if allRaceDays.isEmpty, isCurrentRequest(requestedKey) {
                isUncachedOffline = true
            }
        }
        if isCurrentRequest(requestedKey) { isLoading = false }
    }

    private func isCurrentRequest(_ requestedKey: String) -> Bool {
        requestedKey == String(format: "%04d-%02d", year, month)
    }

    private func displayDays(
        publishedDays: [RaceDay],
        races: [Race],
        startKey: String,
        endKey: String
    ) -> [RaceDay] {
        let coveredRaceIds = Set(publishedDays.compactMap(\.raceId))
        var allDays = publishedDays
        let calendar = Calendar(identifier: .iso8601)

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
                let dateKey = DateFormatting.toDateKey(cursor)
                if RaceLogic.isRaceDay(race: race, dateKey: dateKey) {
                    allDays.append(RaceDay(
                        id: "ph-\(race.id)-\(dateKey)",
                        raceId: race.id,
                        dateKey: dateKey,
                        slug: nil,
                        isRestDay: false,
                        isCancelledDay: false,
                        stageNumber: RaceLogic.theoreticalStageNumber(race: race, dateKey: dateKey),
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
                guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
                cursor = next
            }
        }

        RaceLogic.annotateDoubleSectors(&allDays)
        return allDays
    }

    /// Navega al mes y año actuales y recarga el intervalo correspondiente.
    func goToCurrentMonth() {
        let cal = Calendar.current
        let newYear = cal.component(.year, from: Date())
        let newMonth = cal.component(.month, from: Date())
        month = newMonth
        year = newYear
        loadedMonthKey = nil
        Task { await loadMonth() }
    }

    /// Cambia de año y recarga datos.
    func setYear(_ newYear: Int) {
        guard newYear != year else { return }
        year = newYear
        loadedMonthKey = nil
        Task { await loadMonth() }
    }
}
