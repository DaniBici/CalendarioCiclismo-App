import Foundation
import Observation

enum CxAgendaRow: Identifiable {
    case day(String)
    case race(CxRace, String)
    /// Mes sin pruebas. `filtered` = había pruebas sin filtro y el filtro activo
    /// las quitó todas (mensaje de filtro), frente a un mes realmente vacío.
    case empty(CxMonth, filtered: Bool)
    var id: String {
        switch self {
        case .day(let date): "day:" + date
        case .race(let race, let date): "race:" + date + ":" + race.id
        case .empty(let month, _): "empty:" + month.key
        }
    }
}

@MainActor @Observable
final class CyclocrossAgendaModel {
    private let repo: CyclocrossRepository
    let tournamentId: String?
    private let todayOverride: String?
    private var today: String { todayOverride ?? Self.todayKey() }
    private var revision = 0
    private(set) var cache: [CxMonth: CxCached<[CxRace]>] = [:]
    private(set) var months: [CxMonth] = []
    private(set) var activeMonth: CxMonth?
    private var pendingMonth: CxMonth?
    private(set) var season: String
    private(set) var busy = false
    // Distingue el pull-to-refresh (indicador del sistema) de las cargas de
    // mes/apertura (ProgressView superior), igual que Hoy en carretera.
    private(set) var isRefreshing = false
    private(set) var error: String?
    // Numeración n/total por torneo de la temporada (insignia de ronda).
    private(set) var rounds: [String: CxRound] = [:]
    var jumpDate: String?
    /// Filtro de la agenda (Todas/Big/Pro/España). Se aplica sobre la caché
    /// local, sin recargar datos.
    var filter: CxAgendaFilter = .all
    /// Filtro fijado como predeterminado de la agenda CX (chincheta). Clave
    /// propia de esta vista, independiente del predeterminado de Hoy.
    private(set) var pinnedFilter: CxAgendaFilter = .all
    private static let defaultFilterKey = "cx_default_filter"

    init(repo: CyclocrossRepository = .shared, today: String? = nil, tournamentId: String? = nil) {
        self.tournamentId = tournamentId
        self.repo = repo
        let civil = today ?? Self.todayKey()
        self.todayOverride = today
        let month = CxMonth(year: Int(civil.prefix(4))!, month: Int(civil.dropFirst(5).prefix(2))!)
        season = month.season
        if tournamentId == nil, let stored = UserDefaults.standard.string(forKey: Self.defaultFilterKey),
           let value = CxAgendaFilter(rawValue: stored) {
            pinnedFilter = value
            filter = value
        }
    }
    /// Fija el filtro predeterminado de la agenda CX y lo aplica.
    func setDefaultFilter(_ value: CxAgendaFilter) {
        pinnedFilter = value
        filter = value
        UserDefaults.standard.set(value.rawValue, forKey: Self.defaultFilterKey)
    }
    /// Quita el filtro predeterminado de la agenda CX.
    func clearDefaultFilter() {
        pinnedFilter = .all
        filter = .all
        UserDefaults.standard.removeObject(forKey: Self.defaultFilterKey)
    }
    static func todayKey() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }
    static func seasonMonths(_ season: String) -> [CxMonth] {
        guard let year = Int(season.prefix(4)), CxMonth(year: year, month: 8).season == season else { return [] }
        return (8...12).map { CxMonth(year: year, month: $0) } + [CxMonth(year: year + 1, month: 1), CxMonth(year: year + 1, month: 2)]
    }
    var allowed: [CxMonth] { Self.seasonMonths(season) }
    var canPrevious: Bool { !busy && activeMonth != nil && activeMonth != allowed.first }
    var canNext: Bool { !busy && activeMonth != nil && activeMonth != allowed.last }
    var offline: Bool { cache.values.contains { $0.offline } }
    var rows: [CxAgendaRow] {
        months.flatMap { month in
            var rows: [CxAgendaRow] = []
            guard let monthRaces = cache[month]?.data else { return rows }
            let allRaces = monthRaces.filter { tournamentId == nil || $0.tournamentId == tournamentId }
            let races = tournamentId == nil ? allRaces.filter { CyclocrossPresentation.matchesFilter($0, filter: filter) } : allRaces
            let dates = Set(races.flatMap { CyclocrossLogic.dates($0) }).sorted().filter { $0.hasPrefix(month.key) }
            if dates.isEmpty {
                if tournamentId == nil {
                    let unfilteredDates = Set(allRaces.flatMap { CyclocrossLogic.dates($0) }).filter { $0.hasPrefix(month.key) }
                    rows.append(.empty(month, filtered: !unfilteredDates.isEmpty))
                }
                return rows
            }
            for date in dates {
                rows.append(.day(date))
                rows.append(contentsOf: CyclocrossLogic.races(on: date, races: races).map { .race($0, date) })
            }
            return rows
        }
    }
    func open(_ selectedSeason: String) async {
        if selectedSeason == season, let activeMonth, cache[activeMonth] != nil { return }
        revision += 1
        let generation = revision
        season = selectedSeason
        cache = [:]
        error = nil
        busy = true
        jumpDate = nil
        pendingMonth = nil
        defer { if generation == revision { busy = false } }
        guard let first = allowed.first else { error = CyclocrossPresentation.t("Temporada inválida", "Invalid season"); months = []; return }
        let current = CxMonth(year: Int(today.prefix(4))!, month: Int(today.dropFirst(5).prefix(2))!)
        // Página de torneo: todas sus pruebas de la temporada en una sola lista,
        // sin selector de meses. La agenda general conserva el controlador mensual.
        if tournamentId != nil {
            months = allowed
            activeMonth = nil
            do {
                var firstFailure: Error?
                for month in allowed {
                    do { try await load(month, generation: generation) }
                    catch {
                        if Task.isCancelled || error is CancellationError { throw error }
                        if firstFailure == nil { firstFailure = error }
                    }
                    guard generation == revision else { return }
                }
                if cache.isEmpty, let firstFailure { self.error = firstFailure.localizedDescription }
                let opening = allowed.contains(current) ? current : first
                let next = try await repo.nextDate(season: selectedSeason, date: opening.firstDate, tournamentId: tournamentId)
                guard generation == revision else { return }
                jumpDate = next ?? today
            } catch {
                guard !Task.isCancelled, !(error is CancellationError) else { return }
                if generation == revision { self.error = error.localizedDescription }
            }
            return
        }
        let opening = allowed.contains(current) ? current : first
        months = [opening]
        activeMonth = opening
        do {
            try await load(opening, generation: generation)
            let date = current == opening ? today : opening.firstDate
            let next = try await repo.nextDate(season: selectedSeason, date: date, tournamentId: tournamentId)
            guard generation == revision else { return }
            if let next, let year = Int(next.prefix(4)), let month = Int(next.dropFirst(5).prefix(2)) {
                let target = CxMonth(year: year, month: month)
                if allowed.contains(target), target != opening {
                    try await load(target, generation: generation)
                    guard generation == revision else { return }
                    months = [target]
                    activeMonth = target
                }
            }
            jumpDate = next.flatMap { CyclocrossLogic.dateInSeason($0, season: selectedSeason) && $0 >= date ? $0 : nil } ?? date
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            if generation == revision { self.error = error.localizedDescription }
        }
    }
    func selectMonth(_ target: CxMonth) async {
        guard !busy, target != activeMonth, allowed.contains(target) else { return }
        let generation = revision
        busy = true
        error = nil
        pendingMonth = target
        defer { if generation == revision { busy = false } }
        do {
            if cache[target] == nil { try await load(target, generation: generation) }
            guard generation == revision else { return }
            months = [target]
            activeMonth = target
            pendingMonth = nil
            jumpDate = target.firstDate
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            if generation == revision { self.error = error.localizedDescription }
        }
    }
    func retry() async {
        if let pendingMonth { await selectMonth(pendingMonth) }
        else { await refresh() }
    }

    /// Consulta las rondas con caducidad; el refresco manual fuerza su renovación.
    func loadRounds(force: Bool = false) async {
        let selectedSeason = season
        let fresh = await repo.rounds(season: selectedSeason, force: force)
        if selectedSeason == season { rounds = fresh }
    }
    private func load(_ month: CxMonth, generation: Int, preservingContent: Bool = false) async throws {
        let selectedSeason = season
        if !preservingContent, let cached = await repo.cachedMonth(season: selectedSeason, month: month), generation == revision { cache[month] = cached }
        guard generation == revision else { return }
        let fresh = try await repo.month(season: selectedSeason, month: month)
        if generation == revision { cache[month] = fresh }
    }
    func refresh(forceArtwork: Bool = true) async {
        guard !busy, !months.isEmpty else { return }
        let generation = revision
        busy = true
        isRefreshing = true
        if forceArtwork { ImageRefresh.shared.refresh() }
        error = nil
        defer {
            isRefreshing = false
            if generation == revision { busy = false }
        }
        do {
            for month in months {
                try await load(month, generation: generation, preservingContent: true)
                guard generation == revision else { return }
            }
            await loadRounds(force: forceArtwork)
        }
        catch { if generation == revision && !Task.isCancelled && !(error is CancellationError) { self.error = error.localizedDescription } }
    }
}
