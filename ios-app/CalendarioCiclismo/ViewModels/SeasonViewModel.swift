import Foundation

/// ViewModel para la vista de temporada — equivalente a `js/temporada.js`.
@MainActor
@Observable
final class SeasonViewModel {
    /// Un año posterior al actual abre en su primer mes con carreras
    /// (`SeasonView.bestMonth`).
    var year: Int = DateFormatting.calendarStart().year
    var races: [Race] = []
    /// Challenges del año (`challenge_groups`): sus pruebas se agrupan en una fila.
    var challengeGroups: [ChallengeGroup] = []
    /// Arranca en `true`: la primera imagen es la pantalla de carga, no una
    /// temporada vacía.
    var isLoading = true
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
    /// Año cuyas carreras muestra la pantalla; la vista lo observa para situar el
    /// mes visible al publicarse una temporada nueva sin pasar por la carga.
    private(set) var displayedYear: Int?
    /// Año descargado de la red en esta pantalla; evita recargarlo al volver a
    /// ella.
    private var loadedYear: Int?
    /// `true` tras la primera carga de esta pantalla: los cambios de año
    /// posteriores muestran la caché de inmediato en lugar de la pantalla de
    /// carga.
    private var hasCompletedInitialLoad = false

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
                !ChampionshipsConfig.isChampionship($0)
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
        return [allEntry] + groupedByMonth(filtered)
    }

    /// Carreras por mes (1-12), ordenados. Las pruebas de un challenge van al
    /// mes de la primera, donde se muestra su fila.
    func groupedByMonth(_ races: [Race]) -> [(month: Int, races: [Race])] {
        let groupingDates = SeasonChallengeLogic.groupingStartDates(races: races, groups: challengeGroups)
        let grouped = Dictionary(grouping: races) { race -> Int in
            guard let sd = groupingDates[race.id] ?? race.startDate, let date = DateFormatting.date(from: sd) else { return 0 }
            return Calendar.current.component(.month, from: date)
        }
        return grouped.keys.sorted().compactMap { month in
            guard month > 0, let races = grouped[month] else { return nil }
            return (month: month, races: races)
        }
    }

    /// Carga la temporada del año seleccionado.
    ///
    /// Primera carga de la pantalla (o `force`) con red: pantalla de carga
    /// hasta la respuesta remota, aunque haya caché. Cambios de año posteriores
    /// con red: caché inmediata sin rótulo mientras la red refresca. Sin red:
    /// caché con banner. El banner también aparece cuando la petición falla y
    /// hay contenido, y nunca mientras la red está en vuelo.
    func loadSeason(force: Bool = false) async {
        let requestedYear = year
        guard force || loadedYear != requestedYear else { return }
        let startedAt = Date()
        let isInitialLoad = force || !hasCompletedInitialLoad
        error = nil
        isUncachedOffline = false

        let cache = CacheManager.shared
        let cacheKey = CacheManager.seasonKey(requestedYear)
        let challengesKey = CacheManager.seasonChallengesKey(requestedYear)

        // La caché se lee antes de tocar el estado: un cambio de año con caché
        // no pasa por la pantalla de carga ni por una temporada vacía.
        let cachedChallenges: [ChallengeGroup]? = await cache.load([ChallengeGroup].self, forKey: challengesKey)
        let cachedRaces: [Race]? = await cache.load([Race].self, forKey: cacheKey)
        guard requestedYear == year else { return }
        let presentation = CachePresentation.resolve(
            isOnline: NetworkMonitor.shared.isOnline,
            isInitialLoad: isInitialLoad
        )
        switch (cachedRaces, presentation) {
        case let (cachedRaces?, .silent):
            races = cachedRaces
            challengeGroups = cachedChallenges ?? []
            isFromCache = false
            cacheAgeLabel = nil
            displayedYear = requestedYear
            isLoading = false
        case let (cachedRaces?, .offline):
            races = cachedRaces
            challengeGroups = cachedChallenges ?? []
            isFromCache = true
            cacheAgeLabel = await cache.ageLabel(forKey: cacheKey)
            guard requestedYear == year else { return }
            displayedYear = requestedYear
            isLoading = false
        default:
            races = []
            challengeGroups = []
            isFromCache = false
            cacheAgeLabel = nil
            isLoading = true
        }
        let showsLoader = isLoading

        // Challenges y carreras son independientes: salen a la vez.
        let service = SupabaseService.shared
        async let groupsReq = try? service.challengeGroups(year: requestedYear)
        async let racesReq = service.racesByYear(requestedYear)
        // Sin challenges la temporada se muestra igual, con las pruebas sueltas.
        let groups = await groupsReq
        do {
            let loadedRaces = try await racesReq
            guard requestedYear == year else { return }
            if showsLoader {
                // Una respuesta inmediata no deja la pantalla de carga en un
                // parpadeo: se mantiene su permanencia mínima.
                await LoadingTiming.holdImmediate(since: startedAt)
                guard requestedYear == year else { return }
            }
            if let groups {
                challengeGroups = groups
                await cache.save(groups, forKey: challengesKey)
            }
            races = loadedRaces
            isFromCache = false
            cacheAgeLabel = nil
            loadedYear = requestedYear
            displayedYear = requestedYear
            await cache.save(loadedRaces, forKey: cacheKey)
        } catch {
            guard requestedYear == year else { return }
            if Task.isCancelled || error is CancellationError {
                // El usuario salió de la pantalla con la red en vuelo: no hay
                // constancia de falta de conexión.
                loadedYear = nil
                isLoading = false
                return
            }
            if races.isEmpty, let cachedRaces {
                races = cachedRaces
                challengeGroups = cachedChallenges ?? []
                displayedYear = requestedYear
            }
            if races.isEmpty {
                isUncachedOffline = true
            } else {
                isFromCache = true
                cacheAgeLabel = await cache.ageLabel(forKey: cacheKey)
                loadedYear = nil
            }
        }
        hasCompletedInitialLoad = true
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
