import Foundation
import Supabase

/// Jornada de carretera de la RPC `video_feed_days` (docs/plans/videos-5-2.md,
/// fase 5): jornadas con vídeos propios o, con clasificaciones propias, con
/// emisiones de Revive (`broadcasts` vacío sin ellas).
struct VideoFeedDay: Decodable, Sendable, Identifiable {
    struct RaceInfo: Decodable, Sendable {
        let id: String
        let name: String
        let nameEn: String?
        let countryCode: String?
        let gender: String?
        let raceFormat: String?
        let uciCategory: String?
        let isGrandTour: Bool?
        let logoUrl: String?
    }

    struct Item: Decodable, Sendable {
        let id: String
        let kind: String?
        let title: String?
        let titleEn: String?
        let channel: String?
        let url: String?
        let embeddable: Bool?
        let country: String?
        let sortOrder: Int?
        let showInRevive: Bool?
    }

    let id: String
    let raceId: String?
    let dateKey: String
    let stageNumber: Int?
    let stageSuffix: String?
    let isCancelledDay: Bool?
    let distanceKm: Double?
    let primaryType: String?
    let countryCode: String?
    let neutralStartTimeUtc: String?
    let race: RaceInfo?
    let videos: [Item]
    let broadcasts: [Item]
}

/// Tarjeta de la sección Vídeos: una carrera (jornada de carretera o prueba CX
/// en un día) con sus vídeos en el orden de la regla común y, después, las
/// emisiones de Revive que no están en ellos. Sin vídeos, `full` es la emisión
/// del botón «Emisión ↗» y la tarjeta no se despliega.
struct VideoFeedEntry: Identifiable {
    let id: String
    let date: String
    let name: String
    let subtitle: String
    let logoUrl: String?
    let countryCode: String?
    let placeholderLogo: Bool
    let oneDay: Bool
    let rows: [StageVideoLogic.Entry]
    /// Con vídeos o con varias emisiones de Revive, la tarjeta se despliega;
    /// sin vídeos y con una sola emisión, lleva su botón (`full`).
    let expandable: Bool
    let full: (url: URL, label: String)?
    let stageRoute: StageVideosRoute?
    let cxRoute: CxDestination?
    /// Carrera de origen, para los filtros de Hoy (carretera o ciclocross).
    var roadRace: VideoFeedDay.RaceInfo? = nil
    var cxRace: CxRace? = nil
}

struct VideoFeedDayGroup: Identifiable {
    let date: String
    let entries: [VideoFeedEntry]
    var id: String { date }
}

/// Entradas de la sección Vídeos, espejo de `js/services/video-feed-entries.js`.
enum VideosFeedLogic {
    /// Días de la ventana inicial, anclada al último día con vídeos.
    static let windowDays = 14
    /// Días que añade «Cargar más carreras».
    static let moreDays = 7

    static func shift(_ key: String, days: Int) -> String {
        guard let date = DateFormatting.date(from: key),
              let shifted = Calendar(identifier: .gregorian).date(byAdding: .day, value: days, to: date) else { return key }
        return DateFormatting.toDateKey(shifted)
    }

    /// Fila de Revive en el acordeón: rótulo de la emisión completa
    /// (`title` nil: «Emisión de la etapa/carrera») y su canal.
    private static func reviveRow(id: String, url: String, channel: String?, embeddable: Bool?, title: String? = nil) -> StageVideoLogic.Entry {
        StageVideoLogic.Entry(id: "revive-\(id)", kind: "full", title: title, titleEn: title, channel: channel, url: url,
                              embeddable: embeddable, country: nil, sortOrder: 0, converted: title == nil)
    }

    // MARK: Carretera

    @MainActor
    static func roadEntries(_ days: [VideoFeedDay], allowedGroups: Set<String>, featured: Set<String> = []) -> [VideoFeedEntry] {
        days.compactMap { day -> (VideoFeedDay, VideoFeedEntry)? in
            guard let race = day.race else { return nil }
            let broadcasts = day.broadcasts.map { item in
                Broadcast(id: item.id, raceDayId: day.id, channel: item.channel, startTimeUtc: nil, url: item.url, note: nil,
                          sortOrder: item.sortOrder, showInRevive: item.showInRevive, country: item.country, embeddable: item.embeddable)
            }
            let videos = day.videos.compactMap { item -> RaceDayVideo? in
                guard let url = item.url, let title = item.title else { return nil }
                return RaceDayVideo(id: item.id, raceDayId: day.id, kind: item.kind ?? "other", title: title, titleEn: item.titleEn,
                                    channel: item.channel, url: url, embeddable: item.embeddable, country: item.country, sortOrder: item.sortOrder)
            }
            let media = StageVideoLogic.mediaState(
                broadcasts: RaceLogic.filterBroadcastsByRegion(broadcasts, allowedGroups: allowedGroups),
                videos: StageVideoLogic.filterByRegion(videos, allowedGroups: allowedGroups),
                hasResults: !day.broadcasts.isEmpty, isCancelled: day.isCancelledDay == true)
            let revive = media.revive.filter { !($0.url ?? "").isEmpty }
            guard !media.entries.isEmpty || !revive.isEmpty else { return nil }
            let oneDay = race.raceFormat == "one_day"
            let name = LocaleService.isEnglish ? (race.nameEn.flatMap { $0.isEmpty ? nil : $0 } ?? race.name) : race.name
            let expandable = !media.entries.isEmpty || revive.count > 1
            let fullBroadcast = expandable ? nil : StageVideoLogic.cardReviveBroadcast(revive)
            let full = fullBroadcast.flatMap { b in URL(string: b.url ?? "").map { ($0, broadcastLabel(b.channel)) } }
            let rows = media.entries + revive.map { reviveRow(id: $0.id, url: $0.url ?? "", channel: $0.channel, embeddable: $0.embeddable) }
            let entry = VideoFeedEntry(
                id: "road-\(day.id)", date: day.dateKey, name: name, subtitle: roadSubtitle(day),
                logoUrl: race.logoUrl, countryCode: day.countryCode ?? race.countryCode, placeholderLogo: race.uciCategory != "CN",
                oneDay: oneDay, rows: rows, expandable: expandable, full: full,
                stageRoute: StageVideosRoute(raceDayId: day.id, raceId: day.raceId, title: name), cxRoute: nil, roadRace: race)
            return (day, entry)
        }
        .sorted { compareRoad($0.0, $1.0, featured: featured) }
        .map(\.1)
    }

    /// «Emisión» o «Emisión · <canal>».
    static func broadcastLabel(_ channel: String?) -> String {
        let base = LocaleService.t("Emisión", "Broadcast")
        guard let channel, !channel.isEmpty else { return base }
        return "\(base) · \(channel)"
    }

    /// Etapa, distancia: «Etapa 5 · 182 km»; un día, solo la distancia.
    @MainActor
    private static func roadSubtitle(_ day: VideoFeedDay) -> String {
        var parts: [String] = []
        if let n = day.stageNumber, day.race?.raceFormat != "one_day" {
            parts.append(n == 0 ? LocaleService.t("Prólogo", "Prologue") : "\(LocaleService.t("Etapa", "Stage")) \(n)\(day.stageSuffix ?? "")")
        }
        if let km = day.distanceKm, km > 0 {
            let formatter = NumberFormatter()
            formatter.locale = Locale(identifier: LocaleService.isEnglish ? "en_GB" : "es_ES")
            formatter.maximumFractionDigits = 1
            parts.append("\(formatter.string(from: NSNumber(value: km)) ?? "\(km)") km")
        }
        return parts.joined(separator: " · ")
    }

    /// Clave de una carrera destacada de carretera en un día (`featured_races_for_dates`).
    static func featuredKey(dateKey: String, raceId: String?) -> String { "\(dateKey)|\(raceId ?? "")" }

    /// Orden canónico de Hoy entre carreras: destacadas (corona del panel) primero, gran
    /// vuelta, categoría, género, hora de salida y nombre (espejo de `compareRoad`).
    private static func compareRoad(_ a: VideoFeedDay, _ b: VideoFeedDay, featured: Set<String>) -> Bool {
        let fa = featured.contains(featuredKey(dateKey: a.dateKey, raceId: a.race?.id))
        let fb = featured.contains(featuredKey(dateKey: b.dateKey, raceId: b.race?.id))
        if fa != fb { return fa }
        let ga = a.race?.isGrandTour == true ? 0 : 1, gb = b.race?.isGrandTour == true ? 0 : 1
        if ga != gb { return ga < gb }
        let ca = RaceLogic.categoryRank(category: a.race?.uciCategory, name: a.race?.name, country: a.race?.countryCode)
        let cb = RaceLogic.categoryRank(category: b.race?.uciCategory, name: b.race?.name, country: b.race?.countryCode)
        if ca != cb { return ca < cb }
        let sa = RaceLogic.genderRank(a.race?.gender), sb = RaceLogic.genderRank(b.race?.gender)
        if sa != sb { return sa < sb }
        let ta = a.neutralStartTimeUtc ?? "~", tb = b.neutralStartTimeUtc ?? "~"
        if ta != tb { return ta < tb }
        return (a.race?.name ?? "") < (b.race?.name ?? "")
    }

    // MARK: Ciclocross

    /// Una entrada por prueba y día con vídeos o Revive: la fecha de cada vídeo
    /// o emisión es la de su categoría o, sin categoría, la de la prueba.
    @MainActor
    static func cxEntries(_ races: [CxRace], allowedGroups: Set<String>, rounds: [String: CxRound]) -> [VideoFeedEntry] {
        var out: [VideoFeedEntry] = []
        for race in races where !race.isCancelled {
            // Categorías con resultados publicados: la agenda trae el estado,
            // no las filas, y Revive pide resultados en la categoría (como la web).
            let published = race.categories.filter { ["official", "provisional"].contains($0.resultsStatus) }.map { category in
                CxResult(id: 0, raceId: race.id, category: category.category, rank: nil, rankText: nil, bib: nil, riderDisplay: "",
                         teamName: nil, isoCode2: nil, timeText: nil, gapText: nil, points: nil, bonusPoints: nil,
                         timeSeconds: nil, bonusSeconds: nil, irm: nil, sortOrder: 0)
            }
            let detail = CxDetail(race: race, startlist: [], results: published, broadcasts: race.broadcasts ?? [],
                                  videos: race.videos ?? [], teams: [], standings: [])
            let broadcastIds = Set((race.broadcasts ?? []).map(\.id))
            let videos = CyclocrossPresentation.videos(detail, allowedGroups: allowedGroups)
            let revive = CyclocrossPresentation.programmeMedia(detail, allowedGroups: allowedGroups).revive
            guard !videos.isEmpty || !revive.isEmpty else { continue }
            let dateOf: (String?) -> String = { code in
                guard let code, let category = race.categories.first(where: { $0.category == code }) else { return race.dateKey }
                return category.dateKey ?? race.dateKey
            }
            // Cada vídeo lleva su clave de orden: si es una emisión convertida
            // en «Carrera completa» y el rango de su categoría canónica.
            var byDate: [String: (videos: [(row: StageVideoLogic.Entry, converted: Bool, rank: Int)], revive: [StageVideoLogic.Entry], full: CxReplayLink?)] = [:]
            for video in videos {
                let title = LocaleService.isEnglish ? (video.titleEn.flatMap { $0.isEmpty ? nil : $0 } ?? video.title) : video.title
                let converted = broadcastIds.contains(video.id)
                let kind = converted ? "full" : cxVideoKind(video.title)
                let row = StageVideoLogic.Entry(id: video.id, kind: kind, title: title, titleEn: title, channel: video.channel,
                                                url: video.url, embeddable: nil, country: nil, sortOrder: video.sortOrder, converted: false)
                byDate[dateOf(video.category), default: ([], [], nil)].videos.append((row: row, converted: converted, rank: CyclocrossPresentation.categoryRank(video.category)))
            }
            for link in revive {
                let title = link.category.map { LocaleService.t("Carrera completa " + CyclocrossPresentation.category($0), CyclocrossPresentation.category($0) + " full race") }
                    ?? LocaleService.t("Retransmisión completa", "Full broadcast")
                let row = reviveRow(id: link.id, url: link.url.absoluteString, channel: link.title, embeddable: nil, title: title)
                let date = dateOf(link.category)
                byDate[date, default: ([], [], nil)].revive.append(row)
                if byDate[date]?.full == nil { byDate[date]?.full = link }
            }
            let round = rounds[race.id]
            let subtitle = cxSubtitle(race, round: round)
            for (date, lists) in byDate {
                let expandable = !lists.videos.isEmpty || lists.revive.count > 1
                let full = expandable ? nil : lists.full.map { ($0.url, broadcastLabel($0.title)) }
                // Orden de los vídeos del día (decisión de Dani, 2026-11-14): las
                // emisiones convertidas en «Carrera completa» al final; delante,
                // por categoría canónica (ME, WE, MU, WU, MJ, WJ) y, dentro de
                // cada una, por tipo (carrera completa, resumen, meta, resto) y
                // el orden de la ficha. Las filas de Revive ya llegan por categoría.
                let videos = lists.videos.enumerated().sorted { a, b in
                    let left = (a.element.converted ? 1 : 0, a.element.rank, StageVideoLogic.kindRank[a.element.row.kind] ?? 3, a.offset)
                    let right = (b.element.converted ? 1 : 0, b.element.rank, StageVideoLogic.kindRank[b.element.row.kind] ?? 3, b.offset)
                    return left < right
                }.map { $0.element.row }
                out.append(VideoFeedEntry(
                    id: "cx-\(race.id)-\(date)", date: date, name: CyclocrossPresentation.name(race), subtitle: subtitle,
                    logoUrl: CyclocrossPresentation.logo(race), countryCode: race.countryCode, placeholderLogo: race.raceClass != "CN",
                    oneDay: true, rows: videos + lists.revive, expandable: expandable, full: full,
                    stageRoute: nil, cxRoute: CxDestination(raceId: race.id, anchor: "videos", title: CyclocrossPresentation.name(race)), cxRace: race))
            }
        }
        return out
    }

    /// Tipo de un vídeo CX (carrera completa, resumen, meta y el resto):
    /// `cx_videos` no guarda el tipo y sale de la convención de títulos de
    /// cc-cx-carreras («Carrera completa …», «Resumen …», «Meta …»). Espejo de
    /// `cxVideoKind` (web).
    nonisolated static func cxVideoKind(_ title: String) -> String {
        let value = title.trimmingCharacters(in: .whitespaces).lowercased()
        if value.hasPrefix("carrera completa") || value.hasPrefix("retransmisión completa") { return "full" }
        if value.hasPrefix("resumen") { return "summary" }
        if value == "meta" || value.hasPrefix("meta ") { return "last_km" }
        return "other"
    }

    /// Torneo, manga n/total y sede, como la fila CX de Resultados.
    @MainActor
    private static func cxSubtitle(_ race: CxRace, round: CxRound?) -> String {
        var parts: [String] = []
        if let tournament = race.tournament {
            parts.append(LocaleService.shared.t(tournament.name, tournament.nameEn ?? tournament.name))
        }
        if let round, round.total > 1 { parts.append("\(round.n)/\(round.total)") }
        if let venue = race.venue?.trimmingCharacters(in: .whitespaces), !venue.isEmpty, venue != CyclocrossPresentation.name(race) {
            parts.append(venue)
        }
        return parts.joined(separator: " · ")
    }

    /// Días de [fromKey, toKey] en orden cronológico inverso; ciclocross en el
    /// orden de la agenda (`CyclocrossLogic.races(on:)`).
    static func days(_ entries: [VideoFeedEntry], fromKey: String?, toKey: String, cxRaces: [CxRace] = [], cxFeatured: Set<String> = []) -> [VideoFeedDayGroup] {
        let inWindow = entries.filter { (fromKey == nil || $0.date >= fromKey!) && $0.date <= toKey }
        let dates = Set(inWindow.map(\.date)).sorted(by: >)
        return dates.map { date in
            var list = inWindow.filter { $0.date == date }
            if !cxRaces.isEmpty {
                let order = CyclocrossLogic.races(on: date, races: cxRaces, featured: cxFeatured).map(\.id)
                func rank(_ entry: VideoFeedEntry) -> Int {
                    guard let id = entry.cxRoute?.raceId else { return Int.max }
                    return order.firstIndex(of: id) ?? Int.max
                }
                list = list.enumerated().sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }.map(\.element)
            }
            return VideoFeedDayGroup(date: date, entries: list)
        }
    }
}

extension SupabaseService {
    private struct VideoFeedParams: Encodable, Sendable {
        let p_from: String?
        let p_to: String
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            // El ancla (sin fecha inicial) envía el nulo explícito.
            try container.encode(p_from, forKey: .p_from)
            try container.encode(p_to, forKey: .p_to)
        }
        enum CodingKeys: String, CodingKey { case p_from, p_to }
    }

    /// Jornadas de carretera de [from, to]; con `from` nil, solo el último día
    /// con contenido hasta `to`.
    func videoFeedDays(from: String?, to: String) async throws -> [VideoFeedDay] {
        try await client.rpc("video_feed_days", params: VideoFeedParams(p_from: from, p_to: to)).execute().value
    }
}
