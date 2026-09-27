import Foundation

struct CxCached<T> {
    let data: T
    let offline: Bool
}

@MainActor
protocol CxStore {
    func month(_ key: String) async -> [CxRace]?
    func saveMonth(_ races: [CxRace], key: String) async
    func knownMonths() async -> [String]
    func detail(_ id: String) async -> CxDetail?
    func saveDetail(_ detail: CxDetail) async
    func detailId(forSlug slug: String) async -> String?
    func allDetails() async -> [CxDetail]
}

@MainActor
struct CxDiskStore: CxStore {
    let cache: CacheManager

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
        return CxCached(data: rows.filter { !CyclocrossPresentation.isHidden($0) }, offline: true)
    }

    func month(season: String, month: CxMonth) async throws -> CxCached<[CxRace]> {
        guard month.isActive, month.season == season else { throw CxRepositoryError.invalidMonth }
        do {
            // La caché guarda el mes completo; el idioma se aplica al leer.
            let rows = try await remote.cxMonth(season: season, month: month)
            await store.saveMonth(rows, key: season + ":" + month.key)
            return CxCached(data: rows.filter { !CyclocrossPresentation.isHidden($0) }, offline: false)
        } catch {
            if Task.isCancelled || error is CancellationError { throw error }
            if let cached = await cachedMonth(season: season, month: month) { return cached }
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

    func nextDate(season: String, date: String, tournamentId: String? = nil) async throws -> String? {
        do {
            let hidden = CyclocrossPresentation.hiddenClasses
            if let tournamentId { return try await remote.cxTournamentNextDate(season: season, date: date, tournamentId: tournamentId, excluding: hidden) }
            return try await remote.cxNextDate(season: season, date: date, excluding: hidden)
        }
        catch {
            if Task.isCancelled || error is CancellationError { throw error }
            var dates: [String] = []
            for key in await store.knownMonths() where key.hasPrefix(season + ":") {
                for race in await store.month(key) ?? [] where !race.isCancelled && !CyclocrossPresentation.isHidden(race) && (tournamentId == nil || race.tournamentId == tournamentId) {
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
        for key in await store.knownMonths() {
            for race in await store.month(key) ?? [] {
                for value in [race.logoUrl, race.tournament?.logoUrl].compactMap({ $0 }) {
                    if let url = URL(string: value) { urls.insert(url) }
                }
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
