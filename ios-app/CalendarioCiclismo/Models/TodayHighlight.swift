import Foundation

/// Destacado del cintillo "Hoy" (tabla `today_highlights`).
/// Gestionado desde panel admin. Cada entrada apunta a una jornada, startlist u orden de salida.
struct TodayHighlight: Codable, Identifiable, Hashable {
    let id: String
    let position: Int
    let targetType: String           // "raceDay" | "startlist" | "startOrder"
    let raceId: String?
    let raceDayId: String?
    let customTitle: String?
    let customTitleEn: String?
    let customDetail: String?
    let customDetailEn: String?
    let visibleFrom: String?         // YYYY-MM-DD
    let visibleUntil: String?        // YYYY-MM-DD
    let updatedAt: String?

    var localizedTitle: String? {
        if LocaleService.isEnglish, let en = customTitleEn, !en.isEmpty { return en }
        return customTitle
    }
    var localizedDetail: String? {
        if LocaleService.isEnglish, let en = customDetailEn, !en.isEmpty { return en }
        return customDetail
    }
}

/// Tipo de destino al que apunta una entrada del cintillo.
enum TodayHighlightTarget {
    case stage(raceDayId: String)
    case race(raceId: String)
    case startlist(raceId: String)
    case startOrder(raceDayId: String)
    case championships
    case transfers

    init?(highlight: TodayHighlight) {
        switch highlight.targetType {
        case "raceDay":      if let id = highlight.raceDayId { self = .stage(raceDayId: id); return }
        case "race":         if let id = highlight.raceId    { self = .race(raceId: id); return }
        case "startlist":    if let id = highlight.raceId    { self = .startlist(raceId: id); return }
        case "startOrder":   if let id = highlight.raceDayId { self = .startOrder(raceDayId: id); return }
        case "championships": self = .championships; return
        case "transfers":     self = .transfers; return
        default: break
        }
        return nil
    }
}

/// Vista renderizable de un destacado, con la carrera y jornada ya resueltas.
/// `race` es nil para destinos sin carrera (modo Campeonatos).
struct TodayHighlightView: Identifiable {
    let highlight: TodayHighlight
    let race: Race?
    let raceDay: RaceDay?

    var id: String { highlight.id }
    var target: TodayHighlightTarget? { TodayHighlightTarget(highlight: highlight) }
    var isChampionships: Bool { highlight.targetType == "championships" }
    var isTransfers: Bool { highlight.targetType == "transfers" }

    var title: String {
        if let t = highlight.localizedTitle, !t.isEmpty { return t }
        if let race { return race.localizedName }
        if isChampionships { return ChampionshipsConfig.title }
        if isTransfers { return LocaleService.t("Mercado de Fichajes", "Transfer market") }
        return ""
    }

    /// Texto de detalle: usa customDetail; si no, deriva un detalle automático (Hoy/Mañana/fecha).
    var detail: String {
        if let custom = highlight.localizedDetail, !custom.isEmpty { return custom }
        if isChampionships {
            return DateFormatting.formatDateRange(start: ChampionshipsConfig.rangeStart, end: ChampionshipsConfig.rangeEnd)
        }
        let today = DateFormatting.todayKey()
        let calendar = Calendar(identifier: .gregorian)
        if let raceDay {
            if raceDay.dateKey == today { return LocaleService.t("Hoy", "Today") }
            if let now = DateFormatting.date(from: today),
               let tomorrow = calendar.date(byAdding: .day, value: 1, to: now),
               DateFormatting.toDateKey(tomorrow) == raceDay.dateKey {
                return LocaleService.t("Mañana", "Tomorrow")
            }
            return DateFormatting.formatDateShort(raceDay.dateKey)
        }
        // Sin jornada (startlist sin fecha asociada): usar fecha de la carrera
        return race?.startDate ?? ""
    }

    /// URL del logo de la carrera — nil para Campeonatos (se muestra un icono).
    var logoUrl: String? { race?.logoUrl }
    /// Color de marca hex de la carrera, si lo hay.
    var accentHex: String? { race?.colorHex }
}
