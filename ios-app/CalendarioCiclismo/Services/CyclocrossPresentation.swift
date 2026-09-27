import Foundation

struct CxReplayLink: Identifiable {
    var id: String { url.absoluteString }
    let title: String
    let url: URL
}

struct CxMediaSelection {
    let tv: [CxBroadcast]
    let revive: [CxReplayLink]
    let hasHiddenTV: Bool
    let showsLiveTV: Bool
}
enum CxCategoryCardState { case time, awaiting, results, cancelled }

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
    private static func finishSeconds(_ row: CxResult?) -> Double? {
        let seconds = UciResultsLogic.tttToSeconds(row?.timeText) ?? row?.timeSeconds.map(Double.init)
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
            value = UciResultsLogic.cleanTimeText(row.timeText ?? CyclocrossLogic.duration(row.timeSeconds))
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
    static func programmeMedia(_ detail: CxDetail, allowedGroups: Set<String>, showAll: Bool = false) -> CxMediaSelection {
        let selections = detail.race.categories.filter { CxDetailSelection.actualCategories(detail).contains($0.category) }
            .map { categoryMedia(detail, category: $0, allowedGroups: allowedGroups, showAll: showAll) }
        var tvKeys = Set<String>(), replayKeys = Set<String>()
        return CxMediaSelection(tv: selections.flatMap(\.tv).filter { tvKeys.insert("\(link($0.url)?.absoluteString ?? $0.id)|\($0.country ?? "ALL")|\($0.channel ?? "")").inserted },
            revive: selections.flatMap(\.revive).filter { replayKeys.insert($0.url.absoluteString).inserted },
            hasHiddenTV: selections.contains { $0.showsLiveTV && $0.hasHiddenTV }, showsLiveTV: selections.contains { $0.showsLiveTV })
    }
    static func categoryMedia(_ detail: CxDetail, category: CxCategory, allowedGroups: Set<String>, showAll: Bool = false) -> CxMediaSelection {
        categoryMedia(race: detail.race, category: category, broadcasts: detail.broadcasts,
            hasResults: ["official", "provisional"].contains(category.resultsStatus) && detail.results.contains { $0.category == category.category }, allowedGroups: allowedGroups, showAll: showAll)
    }
    static func categoryMedia(race: CxRace, category: CxCategory, allowedGroups: Set<String>) -> CxMediaSelection {
        categoryMedia(race: race, category: category, broadcasts: race.broadcasts ?? [],
            hasResults: ["official", "provisional"].contains(category.resultsStatus), allowedGroups: allowedGroups)
    }
    private static func categoryMedia(race: CxRace, category: CxCategory, broadcasts sourceBroadcasts: [CxBroadcast], hasResults: Bool, allowedGroups: Set<String>, showAll: Bool = false) -> CxMediaSelection {
        func applies(_ code: String?) -> Bool { code == nil || code == "" || code == category.category }
        let cancelled = race.isCancelled || category.isCancelled
        let applicable = sourceBroadcasts.filter { applies($0.category) }.sorted { $0.sortOrder < $1.sortOrder }
        var keys = Set<String>()
        let broadcasts = applicable.filter { row in
            keys.insert("\(link(row.url)?.absoluteString ?? row.id)|\(row.country ?? "ALL")|\(row.channel ?? "")").inserted
        }
        let regional = broadcasts.filter { RaceLogic.broadcastMatchesRegion($0.country, allowedGroups: allowedGroups) }
        let showsLiveTV = !cancelled && !hasResults && !broadcasts.isEmpty
        var replay: [(order: Int, link: CxReplayLink)] = []
        if hasResults || cancelled {
            replay = applicable.filter {
                RaceLogic.broadcastMatchesRegion($0.country, allowedGroups: allowedGroups) && ($0.showInRevive || !cancelled && $0.isSporza)
            }.compactMap { row in
                link(row.url).map { (row.sortOrder, CxReplayLink(title: row.channel ?? "TV", url: $0)) }
            }
        }
        var urls = Set<String>()
        let revive = replay.sorted { $0.order < $1.order }.map(\.link).filter { urls.insert($0.id).inserted }
        return CxMediaSelection(tv: showsLiveTV ? (showAll ? broadcasts : regional) : [], revive: revive,
            hasHiddenTV: regional.count < broadcasts.count, showsLiveTV: showsLiveTV)
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
