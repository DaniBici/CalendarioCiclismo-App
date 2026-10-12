import Foundation

struct CxCached<T> {
    let data: T
    let offline: Bool
}

extension CxCached: Sendable where T: Sendable {}

@MainActor
protocol CxStore {
    func month(_ key: String) async -> [CxRace]?
    func saveMonth(_ races: [CxRace], key: String) async
    func knownMonths() async -> [String]
    /// Índice de temporada y carreras de un día (Hoy de Ciclocross): no
    /// figuran entre los meses conocidos.
    func today(_ key: String) async -> [CxRace]?
    func saveToday(_ races: [CxRace], key: String) async
    func detail(_ id: String) async -> CxDetail?
    func saveDetail(_ detail: CxDetail) async
    func detailId(forSlug slug: String) async -> String?
    func allDetails() async -> [CxDetail]
}

extension CxStore {
    func today(_ key: String) async -> [CxRace]? { await month(key) }
    func saveToday(_ races: [CxRace], key: String) async { await saveMonth(races, key: key) }
}

@MainActor
struct CxDiskStore: CxStore {
    let cache: CacheManager

    func today(_ key: String) async -> [CxRace]? { await cache.load([CxRace].self, forKey: "cx_today:" + key) }
    func saveToday(_ races: [CxRace], key: String) async { await cache.save(races, forKey: "cx_today:" + key) }

    func month(_ key: String) async -> [CxRace]? { await cache.load([CxRace].self, forKey: "cx_month:" + key) }
    func knownMonths() async -> [String] { await cache.load([String].self, forKey: "cx_month_index") ?? [] }
    func saveMonth(_ races: [CxRace], key: String) async {
        await cache.save(races, forKey: "cx_month:" + key)
        var keys = await knownMonths()
        if !keys.contains(key) { keys.append(key) }
        await cache.save(keys.sorted(), forKey: "cx_month_index")
    }
    func detail(_ id: String) async -> CxDetail? { await cache.load(CxDetail.self, forKey: "cx_detail:" + id) }
    func detailId(forSlug slug: String) async -> String? {
        let index = await cache.load([String: String].self, forKey: "cx_slug_index") ?? [:]
        return index[slug]
    }
    func allDetails() async -> [CxDetail] {
        let index = await cache.load([String: String].self, forKey: "cx_slug_index") ?? [:]
        var details: [CxDetail] = []
        for id in Set(index.values) {
            if let detail = await detail(id) { details.append(detail) }
        }
        return details
    }
    func saveDetail(_ detail: CxDetail) async {
        await cache.save(detail, forKey: "cx_detail:" + detail.race.id)
        var index = await cache.load([String: String].self, forKey: "cx_slug_index") ?? [:]
        index = index.filter { $0.value != detail.race.id }
        index[detail.race.slug] = detail.race.id
        if let slug = detail.race.slugEn { index[slug] = detail.race.id }
        await cache.save(index, forKey: "cx_slug_index")
    }
}

@MainActor
final class CyclocrossRepository {
    static let shared = CyclocrossRepository(remote: SupabaseService.shared, store: CxDiskStore(cache: .shared))
    private let remote: any CxRemote
    private let store: any CxStore

    init(remote: any CxRemote, store: any CxStore) {
        self.remote = remote
        self.store = store
    }

    func cachedMonth(season: String, month: CxMonth) async -> CxCached<[CxRace]>? {
        guard month.isActive, month.season == season else { return nil }
        guard let rows = await store.month(season + ":" + month.key) else { return nil }
        return CxCached(data: rows.filter { CyclocrossPresentation.listedInAgenda($0) }, offline: true)
    }

    func month(season: String, month: CxMonth) async throws -> CxCached<[CxRace]> {
        guard month.isActive, month.season == season else { throw CxRepositoryError.invalidMonth }
        do {
            // La caché guarda el mes completo; el idioma y las cancelaciones se
            // aplican al leer.
            let rows = try await remote.cxMonth(season: season, month: month)
            await store.saveMonth(rows, key: season + ":" + month.key)
            return CxCached(data: rows.filter { CyclocrossPresentation.listedInAgenda($0) }, offline: false)
        } catch {
            if Task.isCancelled || error is CancellationError { throw error }
            if let cached = await cachedMonth(season: season, month: month) { return cached }
            throw error
        }
    }

    /// Carreras del índice local de la temporada en curso.
    private func currentSeasonIndexRaces() async -> [CxRace] {
        let today = CyclocrossAgendaModel.todayKey()
        let month = CxMonth(year: Int(today.prefix(4)) ?? 2000, month: Int(today.dropFirst(5).prefix(2)) ?? 1)
        return await store.today("index:" + month.season) ?? []
    }

    /// Índice ligero de la temporada: lectura local.
    func cachedIndex(season: String) async -> CxCached<[CxRace]>? {
        guard let rows = await store.today("index:" + season) else { return nil }
        return CxCached(data: rows.filter { CyclocrossPresentation.listedInAgenda($0) }, offline: true)
    }

    /// Índice ligero de la temporada (días con carreras, filtros y
    /// numeración); ante un fallo de red conserva la última copia local.
    func seasonIndex(season: String) async throws -> CxCached<[CxRace]> {
        guard CyclocrossAgendaModel.seasonMonths(season).isEmpty == false else { throw CxRepositoryError.invalidMonth }
        do {
            let rows = try await remote.cxSeasonIndex(season: season)
            await store.saveToday(rows, key: "index:" + season)
            return CxCached(data: rows.filter { CyclocrossPresentation.listedInAgenda($0) }, offline: false)
        } catch {
            if Task.isCancelled || error is CancellationError { throw error }
            if let cached = await cachedIndex(season: season) { return cached }
            throw error
        }
    }

    /// Carreras de un día guardadas localmente.
    func cachedDay(season: String, dateKey: String) async -> CxCached<[CxRace]>? {
        guard CyclocrossLogic.dateInSeason(dateKey, season: season),
              let rows = await store.today("day:" + season + ":" + dateKey) else { return nil }
        return CxCached(data: rows.filter { CyclocrossPresentation.listedInAgenda($0) }, offline: true)
    }

    /// Carreras con alguna categoría el `dateKey`, con documentos y
    /// emisiones; ante un fallo de red conserva la copia local del día.
    func day(season: String, dateKey: String) async throws -> CxCached<[CxRace]> {
        guard CyclocrossLogic.dateInSeason(dateKey, season: season) else { throw CxRepositoryError.invalidMonth }
        do {
            let rows = try await remote.cxDay(season: season, dateKey: dateKey)
            await store.saveToday(rows, key: "day:" + season + ":" + dateKey)
            return CxCached(data: rows.filter { CyclocrossPresentation.listedInAgenda($0) }, offline: false)
        } catch {
            if Task.isCancelled || error is CancellationError { throw error }
            if let cached = await cachedDay(season: season, dateKey: dateKey) { return cached }
            throw error
        }
    }

    func cachedDetail(id: String) async -> CxCached<CxDetail>? {
        guard let value = await store.detail(id), CyclocrossLogic.raceInSeason(value.race) else { return nil }
        return CxCached(data: value, offline: true)
    }

    func detail(id: String) async throws -> CxCached<CxDetail>? {
        do {
            guard let value = try await remote.cxDetail(id: id), CyclocrossLogic.raceInSeason(value.race) else { return nil }
            await store.saveDetail(value)
            return CxCached(data: value, offline: false)
        } catch {
            if Task.isCancelled || error is CancellationError { throw error }
            if let cached = await cachedDetail(id: id) { return cached }
            throw error
        }
    }

    func raceId(forSlug slug: String) async throws -> String? {
        do { return try await remote.cxRaceForSlug(slug)?.id }
        catch {
            if Task.isCancelled || error is CancellationError { throw error }
            if let id = await store.detailId(forSlug: slug) { return id }
            for key in await store.knownMonths() {
                if let race = await store.month(key)?.first(where: { $0.slug == slug || $0.slugEn == slug }) { return race.id }
            }
            if let race = await currentSeasonIndexRaces().first(where: { $0.slug == slug || $0.slugEn == slug }) { return race.id }
            throw error
        }
    }

    /// Resolución slug → torneo para los App Links de página de serie.
    func tournament(forSlug slug: String) async -> CxTournament? {
        try? await remote.cxTournamentForSlug(slug)
    }

    /// `false` si, en el idioma activo, todas las carreras del torneo están
    /// ocultas (torneo solo nacional en inglés). Sin conexión se muestra.
    func tournamentIsVisible(_ tournamentId: String) async -> Bool {
        let hidden = CyclocrossPresentation.hiddenClasses
        guard !hidden.isEmpty else { return true }
        return (try? await remote.cxTournamentHasRaces(tournamentId: tournamentId, excluding: hidden)) ?? true
    }

    /// Variante por lotes de `tournamentIsVisible`. Sin conexión se muestran todos.
    func visibleTournamentIds(_ tournamentIds: [String]) async -> Set<String> {
        let hidden = CyclocrossPresentation.hiddenClasses
        guard !hidden.isEmpty else { return Set(tournamentIds) }
        return (try? await remote.cxTournamentIdsWithRaces(tournamentIds, excluding: hidden)) ?? Set(tournamentIds)
    }

    /// Generales de la página de torneo; ante un fallo de red se conserva la
    /// última respuesta de la sesión.
    private var standingsCache: [String: CxTournamentStandings] = [:]

    func tournamentStandings(tournamentId: String, season: String) async throws -> CxTournamentStandings {
        let key = tournamentId + ":" + season
        do {
            let value = try await remote.cxTournamentStandings(tournamentId: tournamentId, season: season)
            standingsCache[key] = value
            return value
        } catch {
            if Task.isCancelled || error is CancellationError { throw error }
            if let cached = standingsCache[key] { return cached }
            throw error
        }
    }

    // Numeración n/total por temporada, con caducidad y respaldo ante fallos.
    private var roundsCache: [String: [String: CxRound]] = [:]
    private var roundsSavedAt: [String: Date] = [:]

    func rounds(season: String, force: Bool = false) async -> [String: CxRound] {
        if !force, let cached = roundsCache[season], let savedAt = roundsSavedAt[season], Date().timeIntervalSince(savedAt) < 3600 { return cached }
        guard let value = try? await remote.cxSeasonRounds(season: season) else { return roundsCache[season] ?? [:] }
        roundsCache[season] = value
        roundsSavedAt[season] = Date()
        return value
    }

    /// Última lectura correcta de las destacadas en la sesión.
    private var featuredCache: Set<String>?

    /// Pruebas destacadas. Un fallo conserva la última lectura de la sesión o,
    /// sin ella, ninguna (orden canónico); nunca interrumpe la carga.
    func featuredRaceIds() async -> Set<String> {
        do {
            let value = try await remote.cxFeaturedRaceIds()
            featuredCache = value
            return value
        } catch {
            return featuredCache ?? []
        }
    }

    /// Siguiente fecha con pruebas del torneo; sin conexión, la caché por mes.
    func nextDate(season: String, date: String, tournamentId: String) async throws -> String? {
        do {
            return try await remote.cxTournamentNextDate(season: season, date: date, tournamentId: tournamentId, excluding: CyclocrossPresentation.hiddenClasses)
        }
        catch {
            if Task.isCancelled || error is CancellationError { throw error }
            var dates: [String] = []
            for key in await store.knownMonths() where key.hasPrefix(season + ":") {
                for race in await store.month(key) ?? [] where CyclocrossPresentation.listedInAgenda(race) && race.tournamentId == tournamentId {
                    dates.append(contentsOf: race.categories.isEmpty ? [race.dateKey] : race.categories.filter { !$0.isCancelled }.map { $0.dateKey ?? race.dateKey })
                }
            }
            return dates.filter { $0 >= date && CyclocrossLogic.dateInSeason($0, season: season) }.min()
        }
    }

    func prepareOfflineMonth(_ month: CxMonth) async throws {
        for race in try await self.month(season: month.season, month: month).data {
            _ = try await detail(id: race.id)
        }
    }

    func artworkURLs() async -> Set<URL> {
        var urls = Set<URL>()
        var races: [CxRace] = await currentSeasonIndexRaces()
        for key in await store.knownMonths() { races.append(contentsOf: await store.month(key) ?? []) }
        for race in races {
            for value in [race.logoUrl, race.tournament?.logoUrl].compactMap({ $0 }) {
                if let url = URL(string: value) { urls.insert(url) }
            }
        }
        for detail in await store.allDetails() {
            for value in [detail.race.logoUrl, detail.race.tournament?.logoUrl].compactMap({ $0 }) {
                if let url = URL(string: value) { urls.insert(url) }
            }
        }
        return urls
    }
}

enum CxRepositoryError: Error { case invalidMonth }
