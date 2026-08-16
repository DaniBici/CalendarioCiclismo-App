import Foundation

/// ViewModel para la vista de temporada — equivalente a `js/temporada.js`.
@MainActor
@Observable
final class SeasonViewModel {
    var year: Int = Calendar.current.component(.year, from: Date())
    var races: [Race] = []
    var isLoading = false
    var error: String?
    var activeFilter: Constants.CategoryFilter = .all
    var activeCountry: String = "all"

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
    /// Indica que los datos mostrados provienen de la caché offline.
    var isFromCache = false
    /// Texto legible con la antigüedad de la caché (ej: "Hace 2 h").
    var cacheAgeLabel: String?
    /// Indica que la temporada no está cacheada y no hay conexión para descargarla.
    var isUncachedOffline = false

    /// Años disponibles para el selector.
    var availableYears: [Int] {
        let current = Calendar.current.component(.year, from: Date())
        return Array((2026...max(2026, current + 1)).reversed())
    }

    /// Países únicos en las carreras cargadas (para el selector), normalizados (como en web).
    /// Excluye los Campeonatos Nacionales: se muestran colapsados en una sola fila
    /// y no deben poblar el selector de país (espejo de `js/temporada.js`).
    var availableCountries: [(code: String, label: String)] {
        let normalized = Set(races.compactMap { race -> String? in
            guard !ChampionshipsConfig.isChampionship(race),
                  let cc = race.countryCode, !cc.isEmpty else { return nil }
            let lower = cc.lowercased()
            return lower.hasPrefix("es-") ? "es" : lower
        })
        let mapped: [(code: String, label: String)] = normalized.compactMap { code in
            let flag = countryFlag(code)
            let name = countryName(code)
            return (code: code, label: "\(flag) \(name)")
        }
        return mapped.sorted { a, b in
            countryName(a.code).compare(countryName(b.code), locale: Locale(identifier: "es_ES")) == .orderedAscending
        }
    }

    /// Umbral por debajo del cual, con un país activo, se colapsan todos los
    /// meses y solo se ofrece la vista "Todos" (month = 0).
    static let collapseCountryThreshold = 5

    /// Carreras filtradas por categoría y país, ordenadas por fecha de inicio.
    /// Compartidas por `racesByMonth` y `shouldCollapseToAll`.
    ///
    /// Los Campeonatos Nacionales (`uciCategory == "CN"`) se EXCLUYEN aquí: en su
    /// lugar la vista inyecta una única fila sintética "Campeonatos Nacionales"
    /// que enlaza a la pantalla de Campeonatos (igual que la vista de Mes y la
    /// web). El indicador de si hay que inyectarla es `hasChampionships`.
    private var filteredRaces: [Race] {
        races
            .filter {
                !($0.isCancelled)
                    && !ChampionshipsConfig.isChampionship($0)
                    && RaceLogic.matchesCategory($0, filter: activeFilter)
                    && matchesCountry($0)
            }
            .sorted { ($0.startDate ?? "") < ($1.startDate ?? "") }
    }

    /// `true` si hay que mostrar la fila sintética de Campeonatos Nacionales:
    /// el año cargado es el de Campeonatos, existe al menos una prueba CN y no se
    /// está filtrando por un país concreto (la fila enlaza a TODOS los
    /// campeonatos, así que no tiene sentido dentro de un único país). Espejo de
    /// la inyección tras el filtro de `js/temporada.js`.
    var hasChampionships: Bool {
        guard year == ChampionshipsConfig.year, activeCountry == "all" else { return false }
        return races.contains { ChampionshipsConfig.isChampionship($0) && !$0.isCancelled }
    }

    /// Fecha de orden de la fila sintética de Campeonatos (inicio de la semana de
    /// Campeonatos), para intercalarla entre las carreras por fecha.
    var championshipsSortDate: String { ChampionshipsConfig.rangeStart }

    /// Mes calendario (1-12) en el que cae la semana de Campeonatos.
    var championshipsMonth: Int {
        DateFormatting.date(from: ChampionshipsConfig.rangeStart)
            .map { Calendar.current.component(.month, from: $0) } ?? 6
    }

    /// `true` cuando hay un país activo y el total de carreras filtradas es
    /// menor que el umbral: el sistema oculta los meses y solo muestra "Todos".
    var shouldCollapseToAll: Bool {
        guard activeCountry != "all" else { return false }
        let count = filteredRaces.count
        return count > 0 && count < Self.collapseCountryThreshold
    }

    /// Grupos para el pager de meses.
    /// - El primer grupo siempre es "Todos" (month = 0) cuando hay carreras.
    /// - Si `shouldCollapseToAll`, es el único grupo.
    /// - Si no, le siguen los meses reales (1-12) ordenados.
    var racesByMonth: [(month: Int, races: [Race])] {
        let filtered = filteredRaces
        guard !filtered.isEmpty else { return [] }

        let allEntry = (month: 0, races: filtered)
        if shouldCollapseToAll { return [allEntry] }

        let grouped = Dictionary(grouping: filtered) { race -> Int in
            guard let sd = race.startDate, let date = DateFormatting.date(from: sd) else { return 0 }
            return Calendar.current.component(.month, from: date)
        }

        let monthly: [(month: Int, races: [Race])] = grouped.keys.sorted().compactMap { month in
            guard month > 0, let races = grouped[month] else { return nil }
            return (month: month, races: races)
        }

        return [allEntry] + monthly
    }

    func loadSeason() async {
        isLoading = true
        error = nil
        isUncachedOffline = false

        // Limpiar datos de la temporada anterior para no mostrar datos obsoletos
        races = []
        isFromCache = false
        cacheAgeLabel = nil

        let cache = CacheManager.shared
        let cacheKey = CacheManager.seasonKey(year)

        // 1. Cargar desde caché primero
        if let cached: [Race] = await cache.load([Race].self, forKey: cacheKey) {
            races = cached
            isFromCache = true
            cacheAgeLabel = await cache.ageLabel(forKey: cacheKey)
            isLoading = false
        }

        // 2. Intentar actualizar desde red
        do {
            races = try await SupabaseService.shared.racesByYear(year)
            isFromCache = false
            cacheAgeLabel = nil
            await cache.save(races, forKey: cacheKey)
        } catch {
            if races.isEmpty {
                isUncachedOffline = true
            }
        }
        isLoading = false
    }

    private func matchesCountry(_ race: Race) -> Bool {
        guard activeCountry != "all" else { return true }
        let cc = (race.countryCode ?? "").lowercased()
        let filter = activeCountry.lowercased()
        // Normalize Spain sub-regions
        if filter == "es" { return cc == "es" || cc.hasPrefix("es-") }
        if cc.hasPrefix("es-") { return filter == "es" }
        return cc == filter
    }

    private func countryFlag(_ code: String) -> String {
        let base = code.hasPrefix("es-") ? "es" : code
        let scalar = base.uppercased().unicodeScalars.compactMap {
            Unicode.Scalar(127397 + $0.value)
        }
        return String(scalar.map(Character.init))
    }

    private func countryName(_ code: String) -> String {
        let normalized = code.hasPrefix("es-") ? "ES" : code.uppercased()
        return Locale(identifier: "es_ES").localizedString(forRegionCode: normalized) ?? code.uppercased()
    }
}
