import Foundation

struct CxReplayLink: Identifiable {
    var id: String { url.absoluteString }
    let title: String
    let url: URL
}

/// Estado de una categoría de la ficha para TV y Revive. `code` nil es la
/// pseudocategoría de una carrera sin categorías.
struct CxMediaCategory: Equatable {
    let code: String?
    let dateKey: String
    let start: Date?
    let cancelled: Bool
    let hasResults: Bool
    let concludedAt: Date
    let concluded: Bool
    var live: Bool { !cancelled && !hasResults && !concluded }
    /// Admite Revive. El paso del tiempo sin resultados no lo activa.
    var finished: Bool { hasResults || cancelled }
}

/// Bloque de la lista de TV: filas sin categoría (sin encabezado) o filas de
/// una categoría en directo.
struct CxTVGroup: Identifiable {
    var id: String { category ?? "" }
    let category: String?
    let rows: [CxBroadcast]
}

struct CxMediaSelection {
    /// Bloques de TV en directo con el filtro regional aplicado.
    let tv: [CxTVGroup]
    let revive: [CxReplayLink]
    /// Hay filas de TV en directo fuera de la región del usuario.
    let hasHiddenTV: Bool
    /// La lista de TV en directo (todas las regiones) no está vacía.
    let showsLiveTV: Bool
    var tvRows: [CxBroadcast] { tv.flatMap(\.rows) }
    /// Hay TV en directo, pero ninguna fila visible con el filtro actual.
    var showsRegionEmpty: Bool { showsLiveTV && tv.isEmpty }
}
enum CxCategoryCardState { case time, awaiting, results, cancelled }

/// Celda de total de una general: puntos, o tiempo del líder y diferencia
/// del resto.
struct CxStandingValue: Equatable {
    let text: String
    let kind: UciResultsLogic.ValueKind
}

/// Celda de una ronda en el desglose de la general.
struct CxRoundCell: Equatable {
    let text: String
    /// Resultado descartado (no computa en el total).
    let dropped: Bool
}

/// Cabecera de una columna de ronda: número de ronda del torneo y, si la
/// carrera es visible, su nombre (etiqueta accesible) y el enlace a su ficha.
struct CxRoundHeader: Equatable, Identifiable {
    var id: String { raceId }
    let raceId: String
    let label: String
    let title: String?
    let linked: Bool
}

/// Desglose por ronda de una general por puntos calculada automáticamente.
struct CxStandingsBreakdown {
    let roundIds: [String]
    let riders: [String: [String: CxStandingRound]]

    @MainActor func cells(_ row: CxStanding) -> [CxRoundCell] {
        let rounds = row.globalRiderId.flatMap { riders[$0] } ?? [:]
        return roundIds.map { CyclocrossPresentation.roundCell(rounds[$0]) }
    }
}

/// Filtros de la agenda de ciclocross, con la presentación de Hoy en Carretera:
/// Todas · Big (Mundial, Copa del Mundo, Continental y los torneos Superprestige,
/// X2O y HG Cross) · Pro (todo salvo las nacionales) · España (pruebas en
/// España, UCI o no).
enum CxAgendaFilter: String, CaseIterable, Identifiable {
    case all, big, pro, spain
    var id: String { rawValue }
    @MainActor var label: String {
        switch self {
        case .all: return CyclocrossPresentation.t("Todas", "All")
        case .big: return "Big"
        case .pro: return "Pro"
        case .spain: return CyclocrossPresentation.t("España", "Spain")
        }
    }
}

@MainActor
enum CyclocrossPresentation {
    static func categoryCardState(race: CxRace, category: CxCategory, at: Date) -> CxCategoryCardState {
        if race.isCancelled || category.isCancelled { return .cancelled }
        if ["official", "provisional"].contains(category.resultsStatus) { return .results }
        guard CyclocrossLogic.timing(race: race, category: category, at: at).temporalState == .estimatedFinished else { return .time }
        return awaitsResults(race) ? .awaiting : .time
    }
    /// La espera de resultados solo se muestra en pruebas con servidor de
    /// resultados inmediato: Mundiales (CM), Continentales (CC) y Copa del Mundo
    /// (CDM), más las pruebas de los torneos Copa del Mundo, Superprestige y X2O.
    /// El resto de carreras nacionales no hacen esperar: sus resultados llegan
    /// por la UCI más tarde o no se publican.
    static func awaitsResults(_ race: CxRace) -> Bool {
        if ["CM", "CC", "CDM"].contains(race.raceClass) { return true }
        guard let tournament = race.tournament else { return false }
        let identity = (tournament.slug + " " + tournament.name).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return identity.contains("superprestige") || identity.contains("x2o")
            || identity.contains("worldcup") || identity.contains("copadelmundo")
    }
    /// Clases de carrera ocultas con la app en inglés: la categoría nacional
    /// española (y los futuros calendarios nacionales) está dirigida al público
    /// hispanohablante. Espejo de `CxPresentation.hiddenClasses` (Android) y de
    /// `cxHiddenClasses` (web).
    nonisolated static var hiddenClasses: [String] { LocaleService.isEnglish ? ["NAC"] : [] }
    nonisolated static func isHidden(_ race: CxRace) -> Bool { hiddenClasses.contains(race.raceClass) }
    /// Aviso al abrir en inglés una carrera o un torneo solo nacional.
    static let spanishAudienceNotice = "This content is intended for Spanish-speaking audiences, mainly in Spain. Switch the app to Spanish to view it."
    /// Filtro de la agenda CX (Todos/Big/Pro/España).
    static func matchesFilter(_ race: CxRace, filter: CxAgendaFilter) -> Bool {
        switch filter {
        case .all: return true
        case .spain: return (race.countryCode ?? "").lowercased().hasPrefix("es")
        case .pro: return !["CN", "NAC"].contains(race.raceClass)
        case .big:
            if ["CM", "CDM", "CC"].contains(race.raceClass) { return true }
            guard let tournament = race.tournament else { return false }
            let identity = (tournament.slug + " " + tournament.name).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
                .lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
            return ["superprestige", "x2o", "worldcup", "copadelmundo", "exactcross", "hgcross"].contains { identity.contains($0) }
        }
    }
    /// Una prueba sin ningún horario asociado usa badges en vez de cuadros.
    static func usesCategoryBadges(race: CxRace, categories: [CxCategory], at: Date) -> Bool {
        !categories.isEmpty && categories.allSatisfy {
            $0.startTimeUtc == nil && categoryCardState(race: race, category: $0, at: at) == .time
        }
    }
    static func t(_ es: String, _ en: String) -> String { LocaleService.shared.t(es, en) }
    static func name(_ race: CxRace) -> String { LocaleService.shared.current.rawValue == "en" ? race.nameEn.flatMap { $0.isEmpty ? nil : $0 } ?? race.name : race.name }
    static func title(_ video: CxVideo) -> String { LocaleService.shared.current.rawValue == "en" ? video.titleEn.flatMap { $0.isEmpty ? nil : $0 } ?? video.title : video.title }
    static func category(_ code: String) -> String {
        switch code {
        case "ME": t("Elite masculina", "Men Elite")
        case "WE": t("Elite femenina", "Women Elite")
        case "MU": t("Sub-23 masculina", "Men Under 23")
        case "WU": t("Sub-23 femenina", "Women Under 23")
        case "MJ": t("Júnior masculina", "Men Junior")
        case "WJ": t("Júnior femenina", "Women Junior")
        default: code
        }
    }
    static func logo(_ race: CxRace) -> String? { link(race.logoUrl)?.absoluteString ?? link(race.tournament?.logoUrl)?.absoluteString }
    static func color(_ race: CxRace) -> String? {
        func valid(_ hex: String?) -> String? { hex.flatMap { $0.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil ? $0 : nil } }
        if let tournament = race.tournament {
            if let color = valid(tournament.colorHex) { return color }
            let identity = (tournament.slug + " " + tournament.name).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
                .lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
            if identity.contains("superprestige") { return "#FFC600" }
            if identity.contains("x2o") { return "#00A8C7" }
            if identity.contains("worldcup") || identity.contains("copadelmundo") { return "#8B173D" }
            if identity.contains("copadeespana") || identity.contains("copaespana") { return "#D71920" }
            if identity.contains("exactcross") || identity.contains("hgcross") { return "#E6342A" }
            if identity.contains("coupedefrance") || identity.contains("copadefrancia") { return "#0055A4" }
            if identity.contains("swisscyclocrosscup") || identity.contains("swisscxcup") { return "#D52B1E" }
            if identity.contains("toitoi") || identity.contains("hsfsystem") { return "#E87524" }
            if identity.contains("nationaltrophy") { return "#6B3FA0" }
            if identity.contains("uscx") { return "#233C78" }
            if identity.contains("girodelleregioni") || identity.contains("giroregioni") || identity.contains("giroditalia") { return "#E94B8A" }
            if identity.contains("tacadeportugal") || identity.contains("tacaportugal") { return "#008657" }
        }
        return valid(race.colorHex)
    }
    static func raceClass(_ code: String) -> String { code == "NAC" ? t("Nac", "Nat") : code }
    static func date(_ key: String, format: String = "d MMMM yyyy") -> String {
        guard let value = CyclocrossLogic.instant(key + "T12:00:00Z") else { return key }
        let formatter = DateFormatter()
        formatter.locale = LocaleService.shared.current.locale
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = format
        return formatter.string(from: value)
    }
    static func localTime(_ utc: String?) -> String? {
        guard let value = CyclocrossLogic.instant(utc) else { return nil }
        return localTime(value, format: "HH:mm")
    }
    static func localTime(_ date: Date, format: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = LocaleService.shared.current.locale
        formatter.timeZone = .current
        formatter.dateFormat = format
        return formatter.string(from: date)
    }
    static func status(_ race: CxRace, _ category: CxCategory, at: Date) -> String {
        let timing = CyclocrossLogic.timing(race: race, category: category, at: at)
        if timing.temporalState == .cancelled { return t("Cancelada", "Cancelled") }
        if category.resultsStatus == "official" { return t("Resultado", "Result") }
        if category.resultsStatus == "provisional" { return t("Provisional", "Provisional") }
        switch timing.temporalState {
        case .live: return t("En curso", "In progress")
        case .estimatedFinished: return t("Pendiente", "Pending")
        default: return localTime(category.startTimeUtc) ?? "—"
        }
    }
    static func number(_ value: Double?) -> String {
        guard let value else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = LocaleService.shared.current.locale
        formatter.maximumFractionDigits = 3
        return formatter.string(from: NSNumber(value: value)) ?? "—"
    }
    /// Vueltas acreditadas por LAP o por su unidad explícita; nunca son un tiempo.
    static func lapsLost(_ row: CxResult) -> Int? {
        guard row.irm == "LAP" || (row.gapText ?? "").range(of: "LAPS?", options: [.caseInsensitive, .regularExpression]) != nil else { return nil }
        for candidate in [row.gapText, row.irm == "LAP" ? row.timeText : nil] {
            let text = (candidate ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
                .replacingOccurrences(of: "^@\\s*", with: "", options: .regularExpression)
            let pattern = row.irm == "LAP" ? "^-?\\s*([1-9]\\d*)(?:\\s*LAPS?)?$" : "^-?\\s*([1-9]\\d*)\\s*LAPS?$"
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
                  let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
                  let range = Range(match.range(at: 1), in: text), let laps = Int(text[range]) else { continue }
            return laps
        }
        return nil
    }
    /// DataRide expresa algunos tiempos inferiores a una hora como MM:SS:00
    /// (`isCxExactSubhourDataRideTime` en `js/cx/time.js`).
    static func dataRideSubhourSeconds(_ text: String?) -> Double? {
        let value = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: "^(?:0[1-9]|[1-5]\\d):[0-5]\\d:00$", options: .regularExpression) != nil else { return nil }
        let parts = value.split(separator: ":").compactMap { Double($0) }
        return parts[0] * 60 + parts[1]
    }
    /// Como la web: `timeSeconds` ya resuelve el formato de la fuente; el
    /// texto solo se interpreta cuando falta.
    private static func finishSeconds(_ row: CxResult?) -> Double? {
        let seconds = row?.timeSeconds.map(Double.init) ?? dataRideSubhourSeconds(row?.timeText) ?? UciResultsLogic.tttToSeconds(row?.timeText)
        return seconds.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
    }
    static func resultValue(_ row: CxResult) -> String { resultRow(row).valueText }
    static func resultRows(_ rows: [CxResult], teams: [Team] = []) -> [UciResultsLogic.ResultRowVM] {
        resultRows(rows, matcher: UciResultsLogic.TeamMatcher(teams: teams))
    }
    static func resultRows(_ rows: [CxResult], matcher: UciResultsLogic.TeamMatcher) -> [UciResultsLogic.ResultRowVM] {
        let winnerSeconds = finishSeconds(rows.first { $0.rank == 1 && ($0.irm ?? "").isEmpty })
        var head = true
        return rows.sorted { ($0.rank ?? Int.max, $0.sortOrder) < ($1.rank ?? Int.max, $1.sortOrder) }.map { row in
            let vm = resultRow(row, winnerSeconds: winnerSeconds, head: head, matcher: matcher)
            if row.rank != 1 && vm.valueKind != .sameTime { head = false }
            return vm
        }
    }
    static func resultRow(_ row: CxResult, winnerSeconds: Double? = nil, head: Bool = true, teams: [Team] = []) -> UciResultsLogic.ResultRowVM {
        resultRow(row, winnerSeconds: winnerSeconds, head: head, matcher: UciResultsLogic.TeamMatcher(teams: teams))
    }
    private static func resultRow(_ row: CxResult, winnerSeconds: Double?, head: Bool, matcher: UciResultsLogic.TeamMatcher) -> UciResultsLogic.ResultRowVM {
        let isEn = LocaleService.shared.current.rawValue == "en"
        let irm = (row.irm ?? "").isEmpty ? nil : row.irm
        let seconds = finishSeconds(row), laps = lapsLost(row)
        var gap = (row.gapText ?? "").isEmpty ? nil : row.gapText
        if irm == nil && laps == nil && row.rank != 1 {
            if let gapSeconds = UciResultsLogic.tttToSeconds(gap?.replacingOccurrences(of: "^\\+", with: "", options: .regularExpression)),
               let winnerSeconds, gapSeconds.truncatingRemainder(dividingBy: 1) != 0 {
                gap = UciResultsLogic.secondsToGap((winnerSeconds + gapSeconds).rounded(.down) - winnerSeconds.rounded(.down))
            }
            if gap == nil, let seconds, let winnerSeconds, seconds >= winnerSeconds {
                gap = UciResultsLogic.secondsToGap(seconds.rounded(.down) - winnerSeconds.rounded(.down))
            }
        }
        let formattedGap = UciResultsLogic.formatGap(gap) ?? ""
        let kind: UciResultsLogic.ValueKind, value: String
        if let irm, irm != "LAP" { kind = .empty; value = "" }
        else if let laps { kind = .raw; value = isEn ? "-\(laps) \(laps == 1 ? "lap" : "laps")" : "-\(laps) \(laps == 1 ? "vuelta" : "vueltas")" }
        else if irm == "LAP" { kind = .raw; value = t("vuelta perdida", "lap lost") }
        else if row.rank != 1 && !formattedGap.isEmpty {
            kind = head && formattedGap == "+0\"" ? .sameTime : .gap
            value = kind == .sameTime ? "" : formattedGap
        } else if seconds != nil {
            kind = row.rank == 1 ? .winnerTime : .raw
            value = dataRideSubhourSeconds(row.timeText) != nil ? UciResultsLogic.secondsToAbsText(seconds)
                : UciResultsLogic.cleanTimeText(row.timeText ?? CyclocrossLogic.duration(row.timeSeconds))
        } else { kind = .empty; value = "" }
        let rank = UciResultsLogic.isAbandonIrm(irm) ? nil : row.rank
        let badge = rank == nil ? (irm.map { UciResultsLogic.irmLabel($0, isEn: isEn) } ?? row.rankText ?? "–") : nil
        return UciResultsLogic.ResultRowVM(rank: rank, rankBadge: badge, isOut: rank == nil, riderName: row.riderDisplay,
            countryCode: row.isoCode2 ?? "", teamName: row.teamName ?? "", team: matcher.match(row.teamName), uciPoints: row.points,
            valueKind: kind, valueText: value, rowGap: kind == .gap && value != "+0\"" ? value : "")
    }
    static func standingRow(_ row: CxStanding, mode: String, teams: [Team] = []) -> UciResultsLogic.ResultRowVM {
        standingRow(row, mode: mode, matcher: UciResultsLogic.TeamMatcher(teams: teams))
    }
    static func standingRow(_ row: CxStanding, mode: String, matcher: UciResultsLogic.TeamMatcher) -> UciResultsLogic.ResultRowVM {
        classificationRow(rank: row.rank, badge: nil, rider: row.riderDisplay, country: row.isoCode2, team: row.teamName, matcher: matcher,
                          points: nil, kind: mode == "points" ? .points : row.rank == 1 ? .winnerTime : .raw,
                          value: mode == "time" ? CyclocrossLogic.duration(row.timeSeconds) : number(row.points))
    }
    // MARK: - Generales de torneo

    /// Orden de una general: puesto y, a igualdad, orden de publicación.
    static func rankSorted(_ rows: [CxStanding]) -> [CxStanding] {
        rows.sorted { ($0.rank, $0.sortOrder ?? 0) < ($1.rank, $1.sortOrder ?? 0) }
    }
    /// Modo de la general: el configurado en el reglamento o, sin él, tiempo
    /// si alguna fila lo trae.
    static func standingMode(scheme: CxPointsScheme?, category: String, rows: [CxStanding]) -> String {
        if let mode = scheme?.categories?[category]?.mode, ["points", "time"].contains(mode) { return mode }
        return rows.contains { $0.timeSeconds != nil } ? "time" : "points"
    }
    /// Categorías con general en la página de torneo: filas publicadas y, si
    /// hay estado, listo o manual. Sin la condición de ronda de la ficha.
    static func tournamentGeneralCategories(standings: [CxStanding], states: [CxStandingState]) -> [String] {
        CyclocrossLogic.categories.filter { code in
            guard standings.contains(where: { $0.category == code }) else { return false }
            guard let state = states.first(where: { $0.category == code }) else { return true }
            return ["ready", "manual"].contains(state.status)
        }
    }
    /// Diferencia con el líder de una general por tiempo, en formato prensa;
    /// 0 es «m.t.» («s.t.» en inglés).
    static func standingGap(_ seconds: Int64, isEn: Bool) -> String {
        seconds == 0 ? (isEn ? "s.t." : "m.t.") : UciResultsLogic.secondsToGap(Int(seconds)) ?? ""
    }
    /// Columna de total, en el orden de `rankSorted`: puntos, o tiempo total
    /// del líder y diferencia del resto.
    static func standingValues(_ rows: [CxStanding], mode: String, isEn: Bool) -> [(row: CxStanding, value: CxStandingValue)] {
        let sorted = rankSorted(rows)
        guard mode == "time" else {
            return sorted.map { ($0, CxStandingValue(text: number($0.points), kind: .points)) }
        }
        let leader = sorted.first, base = leader?.timeSeconds
        return sorted.enumerated().map { index, row in
            let total = CyclocrossLogic.duration(row.timeSeconds)
            if index == 0 { return (row, CxStandingValue(text: total, kind: .winnerTime)) }
            guard let base, let seconds = row.timeSeconds, seconds >= base else { return (row, CxStandingValue(text: total, kind: .gap)) }
            let gap = seconds - base
            return (row, CxStandingValue(text: standingGap(gap, isEn: isEn), kind: gap == 0 ? .sameTime : .gap))
        }
    }
    /// Desglose por ronda: solo en generales por puntos calculadas (estado
    /// listo con desglose). Una general manual no conserva un desglose
    /// coherente con sus totales.
    static func standingsBreakdown(state: CxStandingState?, mode: String) -> CxStandingsBreakdown? {
        guard mode == "points", let state, state.status == "ready", let entries = state.breakdown, !entries.isEmpty,
              !state.roundIds.isEmpty else { return nil }
        let riders = Dictionary(entries.map { entry in
            (entry.globalRiderId, Dictionary(entry.rounds.map { ($0.raceId, $0) }, uniquingKeysWith: { _, last in last }))
        }, uniquingKeysWith: { _, last in last })
        return CxStandingsBreakdown(roundIds: state.roundIds, riders: riders)
    }
    /// Celda de una ronda: sus puntos; «-» si falta, no la disputó o no
    /// puntuó. Un resultado descartado se presenta tachado.
    static func roundCell(_ round: CxStandingRound?) -> CxRoundCell {
        guard let round, round.missing != true, let points = round.points, points.isFinite, points != 0 else {
            return CxRoundCell(text: "-", dropped: false)
        }
        return CxRoundCell(text: number(points), dropped: round.retained == false)
    }
    /// Cabeceras de ronda: «#n» con el número de ronda del torneo (o la
    /// posición en el desglose); carreras ocultas o desconocidas sin enlace.
    static func roundHeaders(_ roundIds: [String], rounds: [String: CxRound], races: [CxRaceRef]) -> [CxRoundHeader] {
        let byId = Dictionary(races.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let isEn = LocaleService.shared.current.rawValue == "en"
        return roundIds.enumerated().map { index, id in
            let label = "#\(rounds[id]?.n ?? index + 1)"
            guard let race = byId[id], !hiddenClasses.contains(race.raceClass) else {
                return CxRoundHeader(raceId: id, label: label, title: nil, linked: false)
            }
            let title = isEn ? race.nameEn.flatMap { $0.isEmpty ? nil : $0 } ?? race.name : race.name
            return CxRoundHeader(raceId: id, label: label, title: title, linked: true)
        }
    }
    private static func classificationRow(rank: Int?, badge: String?, rider: String, country: String?, team: String?, matcher: UciResultsLogic.TeamMatcher, points: Double?,
                                          kind: UciResultsLogic.ValueKind, value: String) -> UciResultsLogic.ResultRowVM {
        UciResultsLogic.ResultRowVM(rank: rank, rankBadge: badge, isOut: rank == nil, riderName: rider, countryCode: country ?? "",
                                   teamName: team ?? "", team: matcher.match(team), uciPoints: points, valueKind: kind, valueText: value, rowGap: "")
    }
    static func link(_ value: String?) -> URL? {
        guard let value, let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.host != nil else { return nil }
        return url
    }
    static func youtubeVideoId(_ value: String?) -> String? {
        guard let url = link(value), url.scheme == "https", let host = url.host?.lowercased() else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        let id: String?
        if host == "youtu.be", parts.count == 1 { id = parts[0] }
        else if ["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].contains(host) {
            if parts == ["watch"] { id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "v" })?.value }
            else if parts.count == 2, ["live", "shorts", "embed"].contains(parts[0]) { id = parts[1] }
            else { id = nil }
        } else { id = nil }
        guard let id, id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else { return nil }
        return id
    }
    static func videos(_ detail: CxDetail) -> [CxVideo] {
        let categories = Set(CxDetailSelection.actualCategories(detail))
        var seen = Set<String>()
        return detail.videos.sorted { $0.sortOrder < $1.sortOrder }.filter { row in
            guard row.category.map({ categories.contains($0) || $0.isEmpty }) ?? true,
                  let id = youtubeVideoId(row.url) else { return false }
            return seen.insert(id).inserted
        }
    }
    static func tournamentRoundTotal(_ tournamentId: String, races: [CxRace], rounds: [String: CxRound]) -> Int {
        races.filter { $0.tournamentId == tournamentId }
            .compactMap { rounds[$0.id]?.total }
            .max() ?? 0
    }
    // MARK: - TV y Revive

    /// Estado para los medios de cada categoría real de la ficha, en el orden
    /// del programa: fecha, hora de salida (sin hora al final) y orden CX. Una
    /// carrera sin categorías produce una única pseudocategoría (`code` nil).
    static func mediaCategories(_ detail: CxDetail, at now: Date) -> [CxMediaCategory] {
        let race = detail.race
        let actual = CxDetailSelection.actualCategories(detail)
        guard !actual.isEmpty else {
            let concludedAt = CyclocrossLogic.concludedAt(race: race, category: nil)
            return [CxMediaCategory(code: nil, dateKey: race.endDateKey ?? race.dateKey, start: nil, cancelled: race.isCancelled, hasResults: false,
                                    concludedAt: concludedAt, concluded: now >= concludedAt)]
        }
        let states = actual.compactMap { code -> CxMediaCategory? in
            guard let category = race.categories.first(where: {
                $0.category == code && CyclocrossLogic.dateInSeason($0.dateKey ?? race.dateKey, season: race.seasonKey)
            }) else { return nil }
            let concludedAt = CyclocrossLogic.concludedAt(race: race, category: category)
            return CxMediaCategory(code: code, dateKey: category.dateKey ?? race.dateKey, start: CyclocrossLogic.instant(category.startTimeUtc),
                cancelled: race.isCancelled || category.isCancelled,
                hasResults: ["official", "provisional"].contains(category.resultsStatus) && detail.results.contains { $0.category == code },
                concludedAt: concludedAt, concluded: now >= concludedAt)
        }
        return states.sorted { lhs, rhs in
            if lhs.dateKey != rhs.dateKey { return lhs.dateKey < rhs.dateKey }
            let left = lhs.start ?? .distantFuture, right = rhs.start ?? .distantFuture
            if left != right { return left < right }
            return (CyclocrossLogic.categories.firstIndex(of: lhs.code ?? "") ?? 0) < (CyclocrossLogic.categories.firstIndex(of: rhs.code ?? "") ?? 0)
        }
    }

    /// Una fila aplica a una categoría si no tiene categoría o coincide con
    /// ella; a la pseudocategoría solo le aplican las filas sin categoría.
    private static func applies(_ row: CxBroadcast, to category: CxMediaCategory) -> Bool {
        let code = row.category ?? ""
        return code.isEmpty || code == category.code
    }

    /// TV en directo y Revive de la ficha: filas y mensaje vacío salen de
    /// esta selección; la vista no vuelve a filtrar.
    static func programmeMedia(_ detail: CxDetail, allowedGroups: Set<String>, showAll: Bool = false, at now: Date = Date()) -> CxMediaSelection {
        let categories = mediaCategories(detail, at: now)
        // Filas con URL http(s) válida, por orden de publicación.
        let rows = detail.broadcasts.filter { link($0.url) != nil }
            .sorted { ($0.sortOrder, $0.id) < ($1.sortOrder, $1.id) }
        let live = categories.filter(\.live)
        let liveRows = rows.filter { row in live.contains { applies(row, to: $0) } }
        // La misma URL en dos categorías distintas no se colapsa.
        var keys = Set<String>()
        let tvRows = liveRows.filter { row in
            let country = row.country.flatMap { $0.isEmpty ? nil : $0 } ?? "ALL"
            return keys.insert("\(row.category ?? "")|\(link(row.url)?.absoluteString ?? "")|\(country)|\(row.channel ?? "")").inserted
        }
        let regional = tvRows.filter { RaceLogic.broadcastMatchesRegion($0.country, allowedGroups: allowedGroups) }
        let visible = showAll ? tvRows : regional
        var groups: [CxTVGroup] = []
        let common = visible.filter { ($0.category ?? "").isEmpty }
        if !common.isEmpty { groups.append(CxTVGroup(category: nil, rows: common)) }
        for category in live {
            guard let code = category.code else { continue }
            let block = visible.filter { $0.category == code }
            if !block.isEmpty { groups.append(CxTVGroup(category: code, rows: block)) }
        }
        // Revive: filas de la región que aplican a una categoría concluida con
        // resultados o cancelada; nunca una fila que siga en directo.
        let liveIds = Set(liveRows.map(\.id))
        let finished = categories.filter(\.finished)
        var urls = Set<String>()
        let revive = rows.filter { row in
            !liveIds.contains(row.id) && RaceLogic.broadcastMatchesRegion(row.country, allowedGroups: allowedGroups)
                && finished.contains { category in
                    guard applies(row, to: category) else { return false }
                    if category.cancelled { return row.showInRevive }
                    return row.showInRevive || row.isSporza
                        || RaceLogic.isReviveLink(channel: row.channel, url: link(row.url)?.absoluteString, showInRevive: row.showInRevive)
                }
        }.compactMap { row in link(row.url).map { CxReplayLink(title: row.channel ?? "TV", url: $0) } }
            .filter { urls.insert($0.id).inserted }
        return CxMediaSelection(tv: groups, revive: revive, hasHiddenTV: regional.count < tvRows.count, showsLiveTV: !tvRows.isEmpty)
    }
    static func usesDarkChipText(_ hex: String) -> Bool {
        guard let rgb = Int(hex.replacingOccurrences(of: "#", with: ""), radix: 16) else { return false }
        let channels = [Double(rgb >> 16 & 255), Double(rgb >> 8 & 255), Double(rgb & 255)].map {
            let c = $0 / 255
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179
    }
}
