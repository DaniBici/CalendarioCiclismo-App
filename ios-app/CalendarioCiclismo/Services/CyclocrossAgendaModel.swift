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
    /// Hoy de Ciclocross (sin torneo): índice ligero de la temporada y detalle
    /// de los días consultados, como Hoy de carretera con las carreras del año
    /// y el día mostrado. Las pruebas de un día sustituyen a las del índice.
    private var index: CxCached<[CxRace]>?
    private var dayDetails: [String: CxCached<[CxRace]>] = [:]
    private var dayTask: Task<Void, Never>?
    /// Orden de lanzamiento de las recargas de Hoy: solo la última aplica.
    private var refreshSequence = 0
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
    /// Orden del día mostrado (Categoría, Hora TV, Hora de meta), en memoria
    /// como en Hoy de carretera.
    var sort: CxAgendaSort = .category

    /// Carreras de la temporada sin duplicados (una prueba que cruza de mes
    /// llega en las consultas de ambos meses), limitadas al torneo si lo hay.
    private(set) var seasonRaces: [CxRace] = []
    /// Días con carreras del filtro activo.
    private(set) var raceDays: [String] = []
    /// Pruebas destacadas (`cx_race_featured`): encabezan su día.
    private(set) var featured: Set<String> = []
    /// Día mostrado en la pestaña Ciclocross.
    private(set) var dateKey: String
    /// La temporada ya tiene datos en caché o terminó su primera carga.
    private(set) var hasLoaded = false
    /// Hoy puede pintarse: con datos o, sin ninguno, con el error de la carga.
    /// Barra de fechas, orden y lista aparecen a la vez.
    var isAgendaReady: Bool { hasLoaded || (!busy && error != nil) }
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
        let previous = dateKey
        settle(on: dateKey)
        if dateKey != previous { loadDayInBackground() }
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
    var offline: Bool {
        cache.values.contains { $0.offline } || index?.offline == true || dayDetails.values.contains { $0.offline }
    }

    // MARK: - Pestaña Ciclocross (día único)

    /// «Hoy» de la agenda: la fecha local acotada a la temporada.
    var agendaToday: String { CyclocrossLogic.clamp(today, season: season) }
    var isShowingCurrentDay: Bool { dateKey == agendaToday }
    private var filteredRaces: [CxRace] {
        tournamentId == nil ? seasonRaces.filter { CyclocrossPresentation.matchesFilter($0, filter: filter) } : seasonRaces
    }
    /// Carreras del día mostrado con el filtro y el orden activos.
    var dayRaces: [CxRace] {
        guard sort != .category else { return CyclocrossLogic.races(on: dateKey, races: filteredRaces, featured: featured) }
        return CyclocrossPresentation.agendaRaces(on: dateKey, races: filteredRaces, featured: featured, sort: sort,
                                                  allowedGroups: RegionService.shared.allowedBroadcastGroups)
    }
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
        let previous = dateKey
        settle(on: date)
        if dateKey != previous { loadDayInBackground() }
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
        loadDayInBackground()
    }

    // MARK: - Página de torneo

    var rows: [CxAgendaRow] {
        CyclocrossLogic.raceDays(seasonRaces).flatMap { date in
            [CxAgendaRow.day(date)] + CyclocrossLogic.races(on: date, races: seasonRaces, featured: featured).map { .race($0, date) }
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
        if tournamentId == nil {
            await openToday(generation: generation)
            return
        }
        // Primero la caché local, para mostrar el día sin esperar a la red.
        for month in allowed {
            guard let cached = await repo.cachedMonth(season: selectedSeason, month: month) else { continue }
            guard generation == revision else { return }
            cache[month] = cached
        }
        // Destacadas de la última lectura: la lista de la caché sale ya en su
        // orden y la red no la recoloca.
        featured = await repo.cachedFeaturedRaceIds()
        guard generation == revision else { return }
        // Con la temporada completa en caché la numeración de rondas sale ya
        // completa y el día se pinta con ella; con meses ausentes sería parcial
        // y se espera a la red.
        if cache.count == allowed.count {
            if rounds.isEmpty { rounds = localRounds() }
            rebuild()
            resolveDay()
            hasLoaded = true
        }
        // Meses, destacadas y rondas llegan a la vez y se aplican juntos; un
        // fallo de destacadas deja el orden canónico.
        do {
            let outcome = try await download(allowed, forceRounds: false, generation: generation)
            guard apply(outcome, generation: generation) else { return }
            if cache.isEmpty, let failure = outcome.failure { self.error = failure.localizedDescription }
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

    // MARK: - Hoy de Ciclocross: índice de la temporada y día mostrado

    /// Apertura de Hoy. Primero la caché local (índice y día de apertura); la
    /// red trae a la vez el índice, el día, las destacadas y las rondas, y
    /// después, si la apertura recae en otro día, ese día. La primera pintura
    /// (`hasLoaded`) lleva siempre el día de apertura con su detalle.
    private func openToday(generation: Int) async {
        let selectedSeason = season
        // Destacadas de la última lectura: el día pintado desde la caché sale
        // ya en su orden y la red no lo recoloca.
        featured = await repo.cachedFeaturedRaceIds()
        guard generation == revision else { return }
        if let cached = await repo.cachedIndex(season: selectedSeason) {
            guard generation == revision else { return }
            index = cached
            rebuild()
            resolveDay()
            if rounds.isEmpty { rounds = localRounds() }
        }
        if let cachedDay = await repo.cachedDay(season: selectedSeason, dateKey: dateKey) {
            guard generation == revision else { return }
            dayDetails[dateKey] = cachedDay
            rebuild()
        }
        guard generation == revision else { return }
        // La caché se pinta solo completa: índice y detalle del día de
        // apertura. Con el índice solo, las tarjetas saldrían sin documentos,
        // emisiones ni dorsales y cambiarían al llegar el detalle.
        if index != nil, dayDetails[dateKey] != nil { hasLoaded = true }
        do {
            let requested = dateKey
            let outcome = try await downloadToday(day: requested, includeIndex: true, forceRounds: false)
            guard applyToday(outcome, day: requested, generation: generation) else { return }
            if index == nil, dayDetails.isEmpty, let failure = outcome.failure { self.error = failure.localizedDescription }
            rebuild()
            resolveDay()
            // Sin pintura previa, el día de apertura que fija el índice de red
            // (hoy sin carreras) se pinta ya con su detalle.
            let painted = hasLoaded
            if !painted, dateKey != requested {
                await loadDay(dateKey, generation: generation)
                guard generation == revision else { return }
            }
            hasLoaded = index != nil || dayDetails[requested] != nil
            if painted, dateKey != requested { await loadDay(dateKey, generation: generation) }
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            if generation == revision { self.error = error.localizedDescription }
        }
    }

    /// Resultado de una descarga de Hoy, aún sin aplicar.
    private struct TodayDownload {
        var index: CxCached<[CxRace]>?
        var day: CxCached<[CxRace]>?
        var failure: Error?
        var featured: Set<String> = []
        var rounds: [String: CxRound] = [:]
    }

    /// Descarga a la vez el día, el índice de la temporada (si `includeIndex`),
    /// las destacadas y la numeración de rondas. Un fallo del índice o del día
    /// conserva lo que ya hubiera; la cancelación se propaga.
    private func downloadToday(day: String, includeIndex: Bool, forceRounds: Bool) async throws -> TodayDownload {
        let selectedSeason = season
        let repo = self.repo
        async let featuredValue = repo.featuredRaceIds()
        async let roundsValue = repo.rounds(season: selectedSeason, force: forceRounds)
        async let dayValue = Self.capture { try await repo.day(season: selectedSeason, dateKey: day) }
        async let indexValue = Self.captureIndex(includeIndex) { try await repo.seasonIndex(season: selectedSeason) }
        var result = TodayDownload()
        result.featured = await featuredValue
        result.rounds = await roundsValue
        switch await dayValue {
        case .success(let value): result.day = value
        case .failure(let value): result.failure = value
        }
        switch await indexValue {
        case .success(let value)?: result.index = value
        case .failure(let value)?: result.failure = result.failure ?? value
        case nil: break
        }
        if Task.isCancelled { throw CancellationError() }
        if let failure = result.failure as? CancellationError { throw failure }
        return result
    }

    private static func capture<T>(_ work: () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await work()) } catch { return .failure(error) }
    }

    private static func captureIndex(_ enabled: Bool, _ work: () async throws -> CxCached<[CxRace]>) async -> Result<CxCached<[CxRace]>, Error>? {
        guard enabled else { return nil }
        return await capture(work)
    }

    /// Aplica la descarga de Hoy de una vez: índice, día, destacadas y rondas.
    /// `false` si la carga ya no es la vigente.
    private func applyToday(_ download: TodayDownload, day: String, generation: Int) -> Bool {
        guard generation == revision else { return false }
        if let fresh = download.index {
            index = fresh
            // El índice recién descargado es más reciente que el detalle de
            // los demás días: se descartan y se vuelven a pedir al visitarlos.
            dayDetails = dayDetails.filter { $0.key == day }
        }
        if let fresh = download.day { dayDetails[day] = fresh }
        featured = download.featured
        rounds = download.rounds.isEmpty ? localRounds() : download.rounds
        return true
    }

    /// Carga el día mostrado tras navegar (flechas, gesto, filtro, medianoche).
    private func loadDayInBackground() {
        guard tournamentId == nil, hasLoaded else { return }
        let target = dateKey
        let generation = revision
        dayTask?.cancel()
        dayTask = Task { await loadDay(target, generation: generation) }
    }

    /// Detalle de un día: primero la copia local y después la red, sin pantalla
    /// de carga. Un fallo conserva lo mostrado.
    private func loadDay(_ target: String, generation: Int) async {
        if dayDetails[target] == nil, let cached = await repo.cachedDay(season: season, dateKey: target) {
            guard generation == revision else { return }
            dayDetails[target] = cached
            rebuild()
        }
        do {
            let fresh = try await repo.day(season: season, dateKey: target)
            guard generation == revision, !Task.isCancelled else { return }
            dayDetails[target] = fresh
            rebuild()
        } catch {
            // Sin red ni copia local el día se muestra con el índice.
        }
    }

    /// Resultado de una descarga de la temporada, aún sin aplicar.
    private struct Download {
        var months: [(CxMonth, CxCached<[CxRace]>)] = []
        var failure: Error?
        var featured: Set<String> = []
        var rounds: [String: CxRound] = [:]
    }

    /// Descarga a la vez los meses, las destacadas y la numeración de rondas.
    /// Devuelve el primer fallo de los meses sin respaldo en caché y propaga la
    /// cancelación.
    private func download(_ targets: [CxMonth], forceRounds: Bool, generation: Int) async throws -> Download {
        let selectedSeason = season
        let repo = self.repo
        async let featuredValue = repo.featuredRaceIds()
        async let roundsValue = repo.rounds(season: selectedSeason, force: forceRounds)
        // Cada tarea devuelve solo su resultado y el mes se empareja por
        // posición: con la optimización de Release, el `CxMonth` devuelto en
        // una tupla desde `Task` llegaba como 0000-00 y la caché nunca se
        // actualizaba hasta relanzar la app.
        let tasks = targets.map { month in
            Task { @MainActor () -> Result<CxCached<[CxRace]>, Error> in
                do { return .success(try await repo.month(season: selectedSeason, month: month)) }
                catch { return .failure(error) }
            }
        }
        let outcomes = await withTaskCancellationHandler {
            var values: [(CxMonth, Result<CxCached<[CxRace]>, Error>)] = []
            for (month, task) in zip(targets, tasks) { values.append((month, await task.value)) }
            return values
        } onCancel: {
            tasks.forEach { $0.cancel() }
        }
        var result = Download()
        result.featured = await featuredValue
        result.rounds = await roundsValue
        for (month, outcome) in outcomes {
            switch outcome {
            case .success(let fresh): result.months.append((month, fresh))
            case .failure(let value):
                if value is CancellationError { throw value }
                result.failure = result.failure ?? value
            }
        }
        if Task.isCancelled { throw CancellationError() }
        return result
    }

    /// Aplica una descarga en un solo paso: carreras, destacadas y rondas
    /// cambian a la vez. Sin numeración de red se conserva la calculada con
    /// las carreras. `false` si la carga ya no es la vigente.
    private func apply(_ download: Download, generation: Int) -> Bool {
        guard generation == revision else { return false }
        for (month, fresh) in download.months { cache[month] = fresh }
        featured = download.featured
        rounds = download.rounds.isEmpty ? localRounds() : download.rounds
        return true
    }

    /// Numeración n/total calculada con los meses en caché; completa solo con
    /// la temporada entera.
    private func localRounds() -> [String: CxRound] {
        if tournamentId == nil { return CyclocrossLogic.tournamentRounds(races: index?.data ?? [], season: season) }
        return CyclocrossLogic.tournamentRounds(races: allowed.flatMap { cache[$0]?.data ?? [] }, season: season)
    }

    /// Recarga sin pantalla de carga. En Hoy descarga el día mostrado y, salvo
    /// con `visibleDayOnly` (latido de la pestaña Ciclocross), el índice de la
    /// temporada; la página de torneo vuelve a leer todos los meses.
    func refresh(forceArtwork: Bool = true, visibleDayOnly: Bool = false) async {
        guard !months.isEmpty else { return }
        // El tirón del usuario en Hoy no se descarta porque haya una carga en
        // curso (apertura o latido): se lanza igualmente y prevalece su
        // resultado. El latido y la página de torneo no se solapan.
        if busy, tournamentId != nil || !forceArtwork { return }
        refreshSequence &+= 1
        let sequence = refreshSequence
        let generation = revision
        busy = true
        isRefreshing = true
        if forceArtwork { ImageRefresh.shared.refresh() }
        error = nil
        defer {
            isRefreshing = false
            if generation == revision { busy = false }
        }
        if tournamentId == nil {
            await refreshToday(forceRounds: forceArtwork, includeIndex: !visibleDayOnly, generation: generation, sequence: sequence)
            return
        }
        do {
            let outcome = try await download(months, forceRounds: forceArtwork, generation: generation)
            guard apply(outcome, generation: generation) else { return }
            if cache.isEmpty, let failure = outcome.failure { self.error = failure.localizedDescription }
            rebuild()
            resolveDay()
            if !cache.isEmpty { hasLoaded = true }
        }
        catch {
            if generation == revision && !Task.isCancelled && !(error is CancellationError) { self.error = error.localizedDescription }
        }
    }

    private func refreshToday(forceRounds: Bool, includeIndex: Bool, generation: Int, sequence: Int) async {
        let requested = dateKey
        do {
            let outcome = try await downloadToday(day: requested, includeIndex: includeIndex, forceRounds: forceRounds)
            // Una recarga posterior (el tirón tras un latido) ya la sustituye.
            guard sequence == refreshSequence,
                  applyToday(outcome, day: requested, generation: generation) else { return }
            if index == nil, dayDetails.isEmpty, let failure = outcome.failure { self.error = failure.localizedDescription }
            rebuild()
            resolveDay()
            if index != nil || dayDetails[requested] != nil { hasLoaded = true }
            if dateKey != requested { await loadDay(dateKey, generation: generation) }
        } catch {
            if generation == revision && !Task.isCancelled && !(error is CancellationError) { self.error = error.localizedDescription }
        }
    }
    /// Recalcula las carreras de la temporada y los días con carreras del
    /// filtro activo a partir de la caché por mes.
    private func rebuild() {
        var byId: [String: CxRace] = [:]
        var order: [String] = []
        func add(_ race: CxRace) {
            if byId[race.id] == nil { order.append(race.id) }
            byId[race.id] = race
        }
        if tournamentId == nil {
            // Índice de la temporada con el detalle de los días consultados
            // (documentos, emisiones) sobre las mismas pruebas.
            for race in index?.data ?? [] { add(race) }
            for key in dayDetails.keys.sorted() {
                for race in dayDetails[key]?.data ?? [] { add(race) }
            }
        } else {
            for month in allowed {
                for race in cache[month]?.data ?? [] where race.tournamentId == tournamentId { add(race) }
            }
        }
        seasonRaces = order.compactMap { byId[$0] }
        raceDays = CyclocrossLogic.raceDays(filteredRaces)
    }
}

/// Datos de la pestaña Ciclocross de Resultados: carreras de la temporada en
/// curso por meses, con la caché del repositorio como primera lectura.
@MainActor @Observable
final class CxResultsFeedModel {
    private let repo: CyclocrossRepository
    private let todayOverride: String?
    private var today: String { todayOverride ?? CyclocrossAgendaModel.todayKey() }
    private var revision = 0
    private var cache: [CxMonth: [CxRace]] = [:]
    /// Pruebas destacadas: encabezan su día en el feed.
    private var featured: Set<String> = []
    private(set) var season: String
    private(set) var hasLoaded = false
    private(set) var isLoading = false
    /// Orden de lanzamiento de las descargas: solo la última aplica.
    private var fetchSequence = 0
    private(set) var error: String?
    /// Días con resultados, en cronología inversa.
    private(set) var days: [CxResultsFeedDay] = []
    /// Numeración n/total de las pruebas de la temporada por id de carrera:
    /// la misma fuente que la tarjeta de Hoy de Ciclocross.
    private(set) var rounds: [String: CxRound] = [:]
    /// Ventana mostrada, como el feed de carretera: 14 días hasta hoy;
    /// «Cargar más» la amplía otros 14.
    static let windowDays = 14
    private(set) var windowStart: String = ""
    var visibleDays: [CxResultsFeedDay] { days.filter { $0.date >= windowStart } }
    var canLoadMore: Bool { days.contains { $0.date < windowStart } }
    func loadMore() { windowStart = Self.shift(windowStart, by: -Self.windowDays) }
    private static func shift(_ key: String, by days: Int) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: key),
              let moved = formatter.calendar.date(byAdding: .day, value: days, to: date) else { return key }
        return formatter.string(from: moved)
    }

    init(repo: CyclocrossRepository = .shared, today: String? = nil) {
        self.repo = repo
        self.todayOverride = today
        season = Self.season(of: today ?? CyclocrossAgendaModel.todayKey())
        windowStart = Self.shift(today ?? CyclocrossAgendaModel.todayKey(), by: -(Self.windowDays - 1))
    }

    private static func season(of date: String) -> String {
        CxMonth(year: Int(date.prefix(4)) ?? 2000, month: Int(date.dropFirst(5).prefix(2)) ?? 1).season
    }

    private var months: [CxMonth] { CyclocrossAgendaModel.seasonMonths(season) }

    /// Primera carga (caché y después red). Un cambio de temporada la repite.
    /// Carreras, destacadas y numeración de rondas se publican juntas: la
    /// primera lista sale de la caché con la última lectura de destacadas y la
    /// numeración calculada de ella, y la respuesta de red las sustituye en un
    /// solo paso.
    func load() async {
        let current = Self.season(of: today)
        if hasLoaded, current == season { return }
        revision += 1
        let generation = revision
        season = current
        cache = [:]
        days = []
        rounds = [:]
        hasLoaded = false
        error = nil
        isLoading = true
        defer { if generation == revision { isLoading = false } }
        for month in months {
            guard let cached = await repo.cachedMonth(season: current, month: month) else { continue }
            guard generation == revision else { return }
            cache[month] = cached.data
        }
        featured = await repo.cachedFeaturedRaceIds()
        guard generation == revision else { return }
        // Con la temporada completa en caché la numeración sale ya completa;
        // con meses ausentes sería parcial y se espera a la red.
        if cache.count == months.count {
            rounds = Self.localRounds(cache, months: months, season: current)
            rebuild()
            hasLoaded = true
        }
        await fetch(months, forceRounds: false, generation: generation)
    }

    /// Recarga sin pantalla de carga. `forceRounds` renueva también la
    /// numeración de rondas (gesto de recarga); al volver a la pestaña se
    /// respeta su caducidad. `windowOnly` limita la descarga a los meses de la
    /// ventana mostrada (latido de 60 s con la pestaña visible).
    func refresh(forceRounds: Bool = true, windowOnly: Bool = false) async {
        guard hasLoaded || error != nil else { return }
        // El tirón del usuario (`forceRounds`) no se descarta porque haya una
        // carga en curso (latido o reaparición): se lanza igualmente y
        // prevalece su resultado.
        if isLoading, !forceRounds { return }
        if Self.season(of: today) != season {
            await load()
            return
        }
        let generation = revision
        isLoading = true
        defer { if generation == revision { isLoading = false } }
        let targets = windowOnly
            ? months.filter { $0.lastDate >= windowStart && $0.firstDate <= today }
            : months
        await fetch(targets.isEmpty ? months : targets, forceRounds: forceRounds, generation: generation)
    }

    private static func localRounds(_ cache: [CxMonth: [CxRace]], months: [CxMonth], season: String) -> [String: CxRound] {
        CyclocrossLogic.tournamentRounds(races: months.flatMap { cache[$0] ?? [] }, season: season)
    }

    /// Descarga a la vez los meses, las destacadas y la numeración de rondas y
    /// las aplica en un solo paso. Un mes fallido conserva lo que había; sin
    /// numeración de red se conserva la calculada con las carreras.
    private func fetch(_ targets: [CxMonth], forceRounds: Bool, generation: Int) async {
        fetchSequence &+= 1
        let sequence = fetchSequence
        let selectedSeason = season
        let repo = self.repo
        async let featuredValue = repo.featuredRaceIds()
        async let roundsValue = repo.rounds(season: selectedSeason, force: forceRounds)
        // Mes emparejado por posición, como en `download`: la tupla devuelta
        // desde `Task` perdía el mes en Release.
        let tasks = targets.map { month in
            Task { @MainActor () -> Result<[CxRace], Error> in
                do { return .success(try await repo.month(season: selectedSeason, month: month).data) }
                catch { return .failure(error) }
            }
        }
        var failure: Error?
        let outcomes = await withTaskCancellationHandler {
            var values: [(CxMonth, Result<[CxRace], Error>)] = []
            for (month, task) in zip(targets, tasks) { values.append((month, await task.value)) }
            return values
        } onCancel: {
            tasks.forEach { $0.cancel() }
        }
        let freshFeatured = await featuredValue
        let freshRounds = await roundsValue
        guard generation == revision, sequence == fetchSequence, !Task.isCancelled else { return }
        for (month, outcome) in outcomes {
            switch outcome {
            case .success(let races): cache[month] = races
            case .failure(let value): if !(value is CancellationError) { failure = failure ?? value }
            }
        }
        featured = freshFeatured
        rounds = freshRounds.isEmpty ? Self.localRounds(cache, months: months, season: selectedSeason) : freshRounds
        rebuild()
        if cache.isEmpty, let failure {
            error = failure.localizedDescription
        } else {
            error = nil
            hasLoaded = true
        }
    }

    private func rebuild() {
        let races = months.flatMap { cache[$0] ?? [] }
        days = CxResultsFeedLogic.days(races: races, season: season, featured: featured)
    }
}
