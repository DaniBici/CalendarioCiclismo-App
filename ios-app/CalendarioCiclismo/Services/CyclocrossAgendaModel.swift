import Foundation
import Observation

/// Fila de la página de torneo: cabecera de día y pruebas de ese día.
enum CxAgendaRow: Identifiable {
    case day(String)
    case race(CxRace, String)
    var id: String {
        switch self {
        case .day(let date): "day:" + date
        case .race(let race, let date): "race:" + date + ":" + race.id
        }
    }
}

/// Datos de ciclocross de una temporada. Sin torneo alimenta la pestaña
/// Ciclocross, una vista Hoy de día único; con torneo, la página de torneo
/// con todas sus pruebas en una lista.
@MainActor @Observable
final class CyclocrossAgendaModel {
    private let repo: CyclocrossRepository
    let tournamentId: String?
    private let todayOverride: String?
    private var today: String { todayOverride ?? Self.todayKey() }
    private var revision = 0
    private(set) var cache: [CxMonth: CxCached<[CxRace]>] = [:]
    /// Meses de la temporada abierta (los siete tras `open`).
    private(set) var months: [CxMonth] = []
    private(set) var season: String
    private(set) var busy = false
    // Distingue el pull-to-refresh (indicador del sistema) de las cargas de
    // apertura (pantalla de carga), igual que Hoy en carretera.
    private(set) var isRefreshing = false
    private(set) var error: String?
    // Numeración n/total por torneo de la temporada (insignia de ronda).
    private(set) var rounds: [String: CxRound] = [:]
    /// Página de torneo: fecha a la que desplazar la lista tras abrirla.
    var jumpDate: String?
    /// Filtro de la agenda (Todas/Big/Pro/España). Se aplica sobre los datos
    /// en memoria, sin recargar.
    private(set) var filter: CxAgendaFilter = .all
    /// Filtro fijado como predeterminado de la agenda CX (chincheta). Clave
    /// propia de esta vista, independiente del predeterminado de Hoy.
    private(set) var pinnedFilter: CxAgendaFilter = .all
    private static let defaultFilterKey = "cx_default_filter"

    /// Carreras de la temporada sin duplicados (una prueba que cruza de mes
    /// llega en las consultas de ambos meses), limitadas al torneo si lo hay.
    private(set) var seasonRaces: [CxRace] = []
    /// Días con carreras del filtro activo.
    private(set) var raceDays: [String] = []
    /// Día mostrado en la pestaña Ciclocross.
    private(set) var dateKey: String
    /// La temporada ya tiene datos en caché o terminó su primera carga.
    private(set) var hasLoaded = false
    /// El usuario eligió día: las cargas posteriores ya no recolocan la
    /// apertura.
    private var userNavigated = false
    /// Último día mostrado como «hoy», para el auto-avance de medianoche.
    private var lastTodayKey: String

    init(repo: CyclocrossRepository = .shared, today: String? = nil, tournamentId: String? = nil) {
        self.tournamentId = tournamentId
        self.repo = repo
        let civil = today ?? Self.todayKey()
        self.todayOverride = today
        let month = CxMonth(year: Int(civil.prefix(4))!, month: Int(civil.dropFirst(5).prefix(2))!)
        season = month.season
        let opening = CyclocrossLogic.clamp(civil, season: month.season)
        dateKey = opening
        lastTodayKey = opening
        if tournamentId == nil, let stored = UserDefaults.standard.string(forKey: Self.defaultFilterKey),
           let value = CxAgendaFilter(rawValue: stored) {
            pinnedFilter = value
            filter = value
        }
    }
    /// Fija el filtro predeterminado de la agenda CX y lo aplica.
    func setDefaultFilter(_ value: CxAgendaFilter) {
        pinnedFilter = value
        UserDefaults.standard.set(value.rawValue, forKey: Self.defaultFilterKey)
        selectFilter(value)
    }
    /// Quita el filtro predeterminado de la agenda CX.
    func clearDefaultFilter() {
        pinnedFilter = .all
        UserDefaults.standard.removeObject(forKey: Self.defaultFilterKey)
        selectFilter(.all)
    }
    /// Cambia el filtro conservando el día; con Todas, un día vacío avanza al
    /// siguiente con carreras.
    func selectFilter(_ value: CxAgendaFilter) {
        filter = value
        rebuild()
        settle(on: dateKey)
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
    var offline: Bool { cache.values.contains { $0.offline } }

    // MARK: - Pestaña Ciclocross (día único)

    /// «Hoy» de la agenda: la fecha local acotada a la temporada.
    var agendaToday: String { CyclocrossLogic.clamp(today, season: season) }
    var isShowingCurrentDay: Bool { dateKey == agendaToday }
    private var filteredRaces: [CxRace] {
        tournamentId == nil ? seasonRaces.filter { CyclocrossPresentation.matchesFilter($0, filter: filter) } : seasonRaces
    }
    /// Carreras del día mostrado con el filtro activo.
    var dayRaces: [CxRace] { CyclocrossLogic.races(on: dateKey, races: filteredRaces) }
    var nextDayWithRaces: String? { raceDays.first { $0 > dateKey } }
    var firstDay: String? { CyclocrossLogic.seasonBounds(season)?.first }
    var lastDay: String? { CyclocrossLogic.seasonBounds(season)?.last }
    var canGoToPreviousDay: Bool { CyclocrossLogic.stepDay(from: dateKey, forward: false, raceDays: raceDays, season: season) != nil }
    var canGoToNextDay: Bool { CyclocrossLogic.stepDay(from: dateKey, forward: true, raceDays: raceDays, season: season) != nil }

    func goToPreviousDay() { step(forward: false) }
    func goToNextDay() { step(forward: true) }
    func goToToday() { navigate(to: agendaToday) }
    func navigate(to date: String) {
        userNavigated = true
        settle(on: date)
    }
    private func step(forward: Bool) {
        guard let target = CyclocrossLogic.stepDay(from: dateKey, forward: forward, raceDays: raceDays, season: season) else { return }
        navigate(to: target)
    }
    /// Muestra `date` dentro de la temporada; con Todas, un día vacío avanza
    /// al siguiente con carreras (auto-navegación de Hoy).
    private func settle(on date: String) {
        guard tournamentId == nil else { return }
        dateKey = CyclocrossLogic.clamp(date, season: season)
        if filter == .all, dayRaces.isEmpty, let next = nextDayWithRaces { dateKey = next }
        if dateKey == agendaToday { lastTodayKey = dateKey }
    }
    /// Tras una carga: sin navegación del usuario, el día de apertura (hoy o
    /// el siguiente día con carreras del filtro); con ella, el día elegido.
    private func resolveDay() {
        guard tournamentId == nil else { return }
        if userNavigated {
            settle(on: dateKey)
        } else {
            dateKey = CyclocrossLogic.openingDay(today: agendaToday, raceDays: raceDays)
            lastTodayKey = agendaToday
        }
    }
    /// Auto-avance de medianoche: si el día mostrado era el «hoy» anterior y la
    /// fecha local cambió, pasa al nuevo día; la navegación manual se respeta.
    /// Un cambio de temporada reabre la agenda.
    func advanceIfNewLocalDay() async {
        guard tournamentId == nil, hasLoaded else { return }
        let current = CxMonth(year: Int(today.prefix(4))!, month: Int(today.dropFirst(5).prefix(2))!).season
        if current != season {
            await open(current)
            return
        }
        let now = agendaToday
        if dateKey == now { lastTodayKey = now; return }
        guard dateKey == lastTodayKey else { return }
        lastTodayKey = now
        settle(on: now)
    }

    // MARK: - Página de torneo

    var rows: [CxAgendaRow] {
        CyclocrossLogic.raceDays(seasonRaces).flatMap { date in
            [CxAgendaRow.day(date)] + CyclocrossLogic.races(on: date, races: seasonRaces).map { .race($0, date) }
        }
    }

    // MARK: - Carga

    func open(_ selectedSeason: String) async {
        if tournamentId == nil, selectedSeason == season, hasLoaded { return }
        revision += 1
        let generation = revision
        season = selectedSeason
        cache = [:]
        rebuild()
        error = nil
        busy = true
        jumpDate = nil
        hasLoaded = false
        userNavigated = false
        defer { if generation == revision { busy = false } }
        guard !allowed.isEmpty else { error = CyclocrossPresentation.t("Temporada inválida", "Invalid season"); months = []; return }
        months = allowed
        // Primero la caché local, para mostrar el día sin esperar a la red.
        for month in allowed {
            guard let cached = await repo.cachedMonth(season: selectedSeason, month: month) else { continue }
            guard generation == revision else { return }
            cache[month] = cached
        }
        guard generation == revision else { return }
        if !cache.isEmpty {
            rebuild()
            resolveDay()
            hasLoaded = true
        }
        do {
            let failure = try await loadMonths(allowed, generation: generation)
            guard generation == revision else { return }
            if cache.isEmpty, let failure { self.error = failure.localizedDescription }
            rebuild()
            resolveDay()
            hasLoaded = true
            if let tournamentId {
                let current = CxMonth(year: Int(today.prefix(4))!, month: Int(today.dropFirst(5).prefix(2))!)
                let opening = allowed.contains(current) ? current : allowed[0]
                let next = try await repo.nextDate(season: selectedSeason, date: opening.firstDate, tournamentId: tournamentId)
                guard generation == revision else { return }
                jumpDate = next ?? today
            }
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            if generation == revision { self.error = error.localizedDescription }
        }
    }
    func retry() async { await refresh() }

    /// Consulta las rondas con caducidad; el refresco manual fuerza su renovación.
    func loadRounds(force: Bool = false) async {
        let selectedSeason = season
        let fresh = await repo.rounds(season: selectedSeason, force: force)
        if selectedSeason == season { rounds = fresh }
    }
    /// Descarga los meses a la vez. Devuelve el primer fallo sin respaldo en
    /// caché y propaga la cancelación.
    private func loadMonths(_ targets: [CxMonth], generation: Int) async throws -> Error? {
        let selectedSeason = season
        let tasks = targets.map { month in
            Task { @MainActor () -> Error? in
                do {
                    let fresh = try await repo.month(season: selectedSeason, month: month)
                    if generation == revision { cache[month] = fresh }
                    return nil
                } catch { return error }
            }
        }
        let failures = await withTaskCancellationHandler {
            var failures: [Error] = []
            for task in tasks { if let failure = await task.value { failures.append(failure) } }
            return failures
        } onCancel: {
            tasks.forEach { $0.cancel() }
        }
        if let cancelled = failures.first(where: { $0 is CancellationError }) { throw cancelled }
        if Task.isCancelled { throw CancellationError() }
        return failures.first
    }
    /// Recarga sin pantalla de carga. `visibleMonthOnly` limita la consulta al
    /// mes del día mostrado (refresco periódico de la pestaña Ciclocross).
    func refresh(forceArtwork: Bool = true, visibleMonthOnly: Bool = false) async {
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
        let visible = CxMonth(year: Int(dateKey.prefix(4))!, month: Int(dateKey.dropFirst(5).prefix(2))!)
        let targets = visibleMonthOnly && tournamentId == nil && months.contains(visible) ? [visible] : months
        do {
            let failure = try await loadMonths(targets, generation: generation)
            guard generation == revision else { return }
            if cache.isEmpty, let failure { self.error = failure.localizedDescription }
            rebuild()
            resolveDay()
            if !cache.isEmpty { hasLoaded = true }
            await loadRounds(force: forceArtwork)
        }
        catch { if generation == revision && !Task.isCancelled && !(error is CancellationError) { self.error = error.localizedDescription } }
    }
    /// Recalcula las carreras de la temporada y los días con carreras del
    /// filtro activo a partir de la caché por mes.
    private func rebuild() {
        var byId: [String: CxRace] = [:]
        var order: [String] = []
        for month in allowed {
            for race in cache[month]?.data ?? [] where tournamentId == nil || race.tournamentId == tournamentId {
                if byId[race.id] == nil { order.append(race.id) }
                byId[race.id] = race
            }
        }
        seasonRaces = order.compactMap { byId[$0] }
        raceDays = CyclocrossLogic.raceDays(filteredRaces)
    }
}
