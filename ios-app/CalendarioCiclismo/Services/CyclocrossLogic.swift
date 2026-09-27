import Foundation

enum CxTemporalState: String, Sendable {
    case unknown, scheduled, live, estimatedFinished, cancelled
}

struct CxTiming: Sendable {
    let temporalState: CxTemporalState
    let resultsStatus: String
    let estimatedEnd: Date?
}

struct CxMonth: Codable, Sendable, Hashable, Comparable {
    let year: Int
    let month: Int
    var key: String { String(format: "%04d-%02d", year, month) }
    var firstDate: String { key + "-01" }
    var lastDate: String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let date = calendar.date(from: DateComponents(year: year, month: month, day: 1))!
        return String(format: "%@-%02d", key, calendar.range(of: .day, in: .month, for: date)!.count)
    }
    var next: CxMonth { month == 12 ? CxMonth(year: year + 1, month: 1) : CxMonth(year: year, month: month + 1) }
    var previous: CxMonth { month == 1 ? CxMonth(year: year - 1, month: 12) : CxMonth(year: year, month: month - 1) }
    var isActive: Bool { (8...12).contains(month) || (1...2).contains(month) }
    var season: String { String(format: "%04d-%02d", month <= 2 ? year - 1 : year, (month <= 2 ? year : year + 1) % 100) }
    static func < (lhs: CxMonth, rhs: CxMonth) -> Bool { lhs.key < rhs.key }
}

enum CyclocrossLogic {
    static let categories = ["ME", "WE", "MU", "WU", "MJ", "WJ"]
    static let classes = ["CM", "CDM", "CC", "C1", "C2", "CN", "NAC"]
    static let durationVersion = "2026-07-01"

    static func offlineMonths(at date: Date = Date()) -> [CxMonth] {
        let calendar = Calendar.current
        let current = CxMonth(year: calendar.component(.year, from: date), month: calendar.component(.month, from: date))
        let opening = current.isActive ? current : CxMonth(year: current.year, month: 8)
        return [opening, opening.next].filter { $0.isActive && $0.season == opening.season }
    }

    static func categories(on date: String, race: CxRace) -> [CxCategory] {
        race.categories.filter { categories.contains($0.category) && dateInSeason(date, season: race.seasonKey) && ($0.dateKey ?? race.dateKey) == date }
            .sorted { categories.firstIndex(of: $0.category)! < categories.firstIndex(of: $1.category)! }
    }

    static func dates(_ race: CxRace) -> [String] {
        let dates = race.categories.isEmpty ? [race.dateKey] : Array(Set(race.categories.filter { categories.contains($0.category) }.map { $0.dateKey ?? race.dateKey })).sorted()
        return dates.filter { dateInSeason($0, season: race.seasonKey) }
    }

    static func dateInSeason(_ date: String, season: String) -> Bool {
        guard let year = Int(date.prefix(4)), let month = Int(date.dropFirst(5).prefix(2)) else { return false }
        let value = CxMonth(year: year, month: month)
        return value.isActive && value.season == season
    }

    static func raceInSeason(_ race: CxRace) -> Bool {
        dateInSeason(race.dateKey, season: race.seasonKey) && (race.endDateKey.map { dateInSeason($0, season: race.seasonKey) } ?? true)
    }

    /// Documento de carrera (Libro de Ruta o Mapa) cargado en el panel.
    static func hasDocuments(_ race: CxRace) -> Bool {
        let docs = ["technicalGuide", "map"]
        return race.assets?.contains { doc in
            doc.url?.isEmpty == false && doc.type.map { docs.contains($0) } == true
        } ?? false
    }

    /// La ficha se abre desde el calendario con la carga mínima completa (un
    /// documento y algún horario) o si alguna de las pruebas ya publicó sus
    /// clasificaciones.
    static func raceOpen(_ race: CxRace) -> Bool {
        hasDocuments(race) && race.categories.contains { $0.startTimeUtc != nil } || hasClassifications(race)
    }

    /// Estados de `resultsStatus` con clasificación publicada.
    static func hasClassifications(_ race: CxRace) -> Bool {
        race.categories.contains { publishedResultsStatuses.contains($0.resultsStatus) }
    }

    private static let publishedResultsStatuses: Set<String> = ["official", "provisional"]

    static func races(on date: String, races: [CxRace]) -> [CxRace] {
        races.filter { dates($0).contains(date) }.sorted { lhs, rhs in
            let lClass = classes.firstIndex(of: lhs.raceClass) ?? classes.count
            let rClass = classes.firstIndex(of: rhs.raceClass) ?? classes.count
            if lClass != rClass { return lClass < rClass }
            let lTime = agendaTime(on: date, race: lhs)
            let rTime = agendaTime(on: date, race: rhs)
            if lTime != rTime { return lTime < rTime }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    /// Hora de la categoría programada de mayor rango, según `categories`.
    private static func agendaTime(on date: String, race: CxRace) -> Date {
        for category in categories(on: date, race: race) where !category.isCancelled {
            if let time = instant(category.startTimeUtc) { return time }
        }
        return .distantFuture
    }

    static func instant(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    static func timing(race: CxRace, category: CxCategory, at: Date = Date()) -> CxTiming {
        let verified = category.durationRuleVersion == durationVersion &&
            (category.durationFormat == "individual" || (category.durationFormat == "WE_WJ" && ["WE", "WJ"].contains(category.category)))
        let start = instant(category.startTimeUtc)
        var end: Date?
        if verified, let start, let minutes = category.durationMinutes, minutes > 0 {
            end = start.addingTimeInterval(Double(minutes) * 60)
        }
        let state: CxTemporalState
        if race.isCancelled || category.isCancelled { state = .cancelled }
        else if let start, let end { state = at < start ? .scheduled : (at < end ? .live : .estimatedFinished) }
        else { state = .unknown }
        return CxTiming(temporalState: state, resultsStatus: category.resultsStatus, estimatedEnd: end)
    }

    static func duration(_ seconds: Int64?) -> String {
        guard let seconds, seconds >= 0 else { return "—" }
        return String(format: "%lld:%02lld:%02lld", seconds / 3600, seconds / 60 % 60, seconds % 60)
    }

    // MARK: - Numeración de rondas por torneo (n/total)

    /// Clave de orden de una carrera con el contrato de generales CX:
    /// coalesce(fecha de categoría, fecha de carrera), hora de salida con nulos
    /// al final y race.id. Una carrera con varias categorías cuenta como una
    /// sola ronda y se ordena por su primera manga válida.
    private static func roundKey(_ row: CxRoundRow, season: String) -> (String, Date, String) {
        var entries = row.cx_race_categories.map { ($0.dateKey ?? row.dateKey, instant($0.startTimeUtc) ?? .distantFuture) }
            .filter { dateInSeason($0.0, season: season) }
        if entries.isEmpty { entries = [(row.dateKey, .distantFuture)] }
        let first = entries.min { lhs, rhs in lhs.0 != rhs.0 ? lhs.0 < rhs.0 : lhs.1 < rhs.1 } ?? (row.dateKey, .distantFuture)
        return (first.0, first.1, row.id)
    }

    /// Número de prueba por carrera y torneo. Las canceladas conservan su
    /// número; sin torneo o fuera de temporada no se numeran.
    static func tournamentRounds(_ rows: [CxRoundRow], season: String) -> [String: CxRound] {
        var groups: [String: [CxRoundRow]] = [:]
        for row in rows where !(row.tournamentId ?? "").isEmpty && row.seasonKey == season && dateInSeason(row.dateKey, season: season) {
            groups[row.tournamentId!, default: []].append(row)
        }
        var rounds: [String: CxRound] = [:]
        for group in groups.values {
            let ordered = group.sorted { roundKey($0, season: season) < roundKey($1, season: season) }
            for (index, row) in ordered.enumerated() { rounds[row.id] = CxRound(n: index + 1, total: ordered.count) }
        }
        return rounds
    }
}
