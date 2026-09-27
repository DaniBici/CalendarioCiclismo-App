import Foundation

/// Textos y estados derivados en el instante de cada entrada del timeline.
struct WidgetText: Sendable {
    let english: Bool

    init(locale: String) { english = locale == "en" }

    func t(_ es: String, _ en: String) -> String { english ? en : es }

    var locale: Locale { Locale(identifier: english ? "en_GB" : "es_ES") }

    func time(_ date: Date?) -> String? {
        guard let date else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "es_ES")
        formatter.timeZone = .current
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    /// «mañana», «sáb 4 oct» / «tomorrow», «Sat 4 Oct».
    func day(_ key: String, relativeTo now: Date) -> String {
        guard let date = WidgetDates.date(fromKey: key) else { return key }
        let calendar = Calendar.current
        if calendar.isDate(date, inSameDayAs: now) { return t("hoy", "today") }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: tomorrow) {
            return t("mañana", "tomorrow")
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = .current
        formatter.setLocalizedDateFormatFromTemplate("EEEdMMM")
        return formatter.string(from: date)
    }

    func distance(_ km: Double?) -> String? {
        guard let km, km > 0 else { return nil }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.maximumFractionDigits = km.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 1
        return (formatter.string(from: NSNumber(value: km)) ?? "\(km)") + " km"
    }
}

/// Estado temporal de una carrera en el instante de la entrada.
enum WidgetRaceState: Equatable {
    case cancelled, rest, results, awaiting, live, scheduled
}

extension WidgetItem {
    func raceState(at now: Date) -> WidgetRaceState {
        if state == "cancelled" { return .cancelled }
        if state == "rest" { return .rest }
        if isCX { return cxState(at: now) }
        if hasResults == true { return .results }
        if raceStatus == "finished" { return .awaiting }
        if let finishUtc, now >= finishUtc { return .awaiting }
        if raceStatus == "running" { return .live }
        if let startUtc, now >= startUtc { return .live }
        return .scheduled
    }

    private func cxState(at now: Date) -> WidgetRaceState {
        let active = (sessions ?? []).filter { $0.cancelled != true }
        guard !active.isEmpty else { return startUtc.map { now >= $0 ? .awaiting : .scheduled } ?? .scheduled }
        if active.allSatisfy({ $0.hasResults == true }) { return .results }
        if active.contains(where: { $0.isLive(at: now) }) { return .live }
        if active.contains(where: { session in session.hasResults != true && (session.startUtc.map { $0 > now } ?? true) }) {
            return active.contains(where: { $0.hasResults == true }) ? .live : .scheduled
        }
        return .awaiting
    }

    /// Sesiones CX que se muestran: las élite si existen; si no, todas.
    var displaySessions: [WidgetSession] {
        let active = (sessions ?? []).filter { $0.cancelled != true }
        let elite = active.filter { $0.elite == true }
        return elite.isEmpty ? active : elite
    }

    /// Instantes en los que cambia la presentación (entradas del timeline).
    var transitionDates: [Date] {
        var dates = [startUtc, finishUtc, tv?.startUtc].compactMap { $0 }
        for session in sessions ?? [] {
            dates.append(contentsOf: [session.startUtc, session.finishUtc].compactMap { $0 })
        }
        return dates
    }
}

extension WidgetSession {
    /// Sin duración verificada, una manga se considera en curso una hora.
    func isLive(at now: Date) -> Bool {
        guard hasResults != true, cancelled != true, let startUtc, now >= startUtc else { return false }
        return now < (finishUtc ?? startUtc.addingTimeInterval(3600))
    }
}

/// Distintivo de la columna derecha de cada fila.
struct WidgetBadge: Equatable {
    let symbol: String?
    let text: String
    let emphasized: Bool
    /// Destino propio del distintivo (texto en directo); nil = el de la fila.
    var url: URL? = nil
}

extension WidgetItem {
    /// Distintivo de las carreras no terminadas. Espejo de `TVBadge` (Hoy):
    /// «Live texto» solo con texto en directo; en el resto, el estado de TV.
    func badge(at now: Date, text: WidgetText) -> WidgetBadge? {
        switch raceState(at: now) {
        case .cancelled:
            return WidgetBadge(symbol: "xmark.circle", text: text.t("Anulada", "Cancelled"), emphasized: false)
        case .rest, .results:
            return nil
        case .awaiting:
            return WidgetBadge(symbol: "flag.checkered", text: text.time(finishUtc) ?? text.t("Meta", "Finish"), emphasized: false)
        case .live, .scheduled:
            return tvBadge(at: now, text: text)
        }
    }

    private var tvStatus: String? { tv?.status }

    /// Sin TV accesible: el texto en directo sustituye al distintivo de TV.
    private var liveTextReplacesTV: Bool {
        guard liveTextURL != nil else { return false }
        switch tvStatus {
        case nil, "none", "unavailable_es", "pending": return true
        default: return false
        }
    }

    /// La carrera ya ha salido y la emisión aún no ha empezado: el texto en
    /// directo acompaña a la TV (`showLiveTextAlongside` de Hoy).
    private func liveTextAlongside(at now: Date) -> Bool {
        guard liveTextURL != nil, !liveTextReplacesTV,
              let start = startUtc, now >= start,
              let tvStart = tv?.startUtc else { return false }
        return now < tvStart
    }

    func tvBadge(at now: Date, text: WidgetText) -> WidgetBadge? {
        let liveText = WidgetBadge(symbol: "text.bubble", text: text.t("Live texto", "Live text"),
                                   emphasized: (startUtc.map { now >= $0 } ?? false), url: liveTextURL)
        if liveTextReplacesTV || liveTextAlongside(at: now) { return liveText }
        switch tvStatus {
        case "time":
            guard let tvStart = tv?.startUtc else { return WidgetBadge(symbol: "tv", text: "TV", emphasized: false) }
            if now >= tvStart { return WidgetBadge(symbol: "tv", text: "Live", emphasized: true) }
            if let start = startUtc, tvStart <= start {
                return WidgetBadge(symbol: "tv", text: text.t("Íntegra", "Full Race"), emphasized: false)
            }
            return WidgetBadge(symbol: "tv", text: text.time(tvStart) ?? "TV", emphasized: false)
        case "confirmed":
            return WidgetBadge(symbol: "tv", text: "TV", emphasized: false)
        case "pending":
            return WidgetBadge(symbol: "tv", text: text.t("Sin confirmar", "Unconfirmed"), emphasized: false)
        case "unavailable_es":
            return text.english ? nil : WidgetBadge(symbol: "tv.slash", text: "No TV España", emphasized: false)
        case "none":
            return WidgetBadge(symbol: "tv.slash", text: text.t("Sin TV", "No TV"), emphasized: false)
        default:
            return nil
        }
    }

    /// Carrera terminada con clasificación: mismos accesos que Hoy.
    func finishedActions(at now: Date) -> (results: URL?, revive: URL?)? {
        guard raceState(at: now) == .results else { return nil }
        let results = resultsURL
        let revive = reviveURL
        return results == nil && revive == nil ? nil : (results, revive)
    }

    /// Segunda línea de las filas compactas. Sin spoilers: nunca incluye
    /// ganadores ni líderes.
    func detailLine(at now: Date, text: WidgetText) -> String {
        switch raceState(at: now) {
        case .rest:
            return text.t("Jornada de descanso", "Rest day")
        case .cancelled:
            return [stageLabel, text.t("Jornada anulada", "Cancelled")].compactMap { $0 }.joined(separator: " · ")
        default:
            if isCX { return cxScheduleLine(at: now, text: text) }
            return [stageLabel, typeLabel].compactMap { $0 }.joined(separator: " · ")
        }
    }

    private func cxScheduleLine(at now: Date, text: WidgetText) -> String {
        let parts = displaySessions.map { session -> String in
            if session.hasResults == true { return "\(session.category) " + text.t("terminada", "finished") }
            if session.isLive(at: now) { return "\(session.category) " + text.t("en curso", "live") }
            return [session.category, text.time(session.startUtc)].compactMap { $0 }.joined(separator: " ")
        }
        let line = parts.joined(separator: " · ")
        return line.isEmpty ? (tournament ?? category ?? "") : line
    }

    /// Descripción para VoiceOver.
    func accessibilityText(at now: Date, text: WidgetText) -> String {
        var parts = [name, detailLine(at: now, text: text)]
        if let badge = badge(at: now, text: text) {
            if raceState(at: now) == .scheduled, tv?.status == "time", badge.symbol == "tv", badge.text.contains(":") {
                parts.append(text.t("TV a las ", "TV at ") + badge.text)
            } else {
                parts.append(badge.text)
            }
        }
        if let actions = finishedActions(at: now) {
            if actions.results != nil { parts.append(text.t("Resultados disponibles", "Results available")) }
            if actions.revive != nil { parts.append(text.t("Revive la carrera", "Relive the race")) }
        }
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// Icono SF Symbol del tipo de etapa.
func widgetStageIcon(_ primaryType: String?) -> String? {
    switch primaryType {
    case "flat": "arrow.right"
    case "rolling": "point.topleft.down.to.point.bottomright.curvepath"
    case "cotas": "triangle"
    case "medium_mountain": "mountain.2"
    case "high_mountain", "summit_finish", "uphill_finish", "monopuerto", "chrono_climb": "mountain.2.fill"
    case "itt", "ttt": "stopwatch"
    case "cobbles": "square.grid.3x3.topleft.filled"
    case "sterrato": "road.lanes"
    default: nil
    }
}
