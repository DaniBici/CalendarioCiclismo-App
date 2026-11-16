import Foundation

/// Vídeos de una jornada de carretera. Espejo de `js/services/stage-videos.js`
/// (web) y `StageVideoLogic.kt` (Android); docs/plans/videos-5-2.md.
///
/// - Emisión convertida: emisión de Revive de la jornada con clasificaciones
///   propias, de YouTube con vídeo fijo y `embeddable` distinto de `false`.
///   Pasa a Vídeos como «Emisión de la etapa/carrera» (tipo `full`) y sale de
///   Revive.
/// - Orden: emisión completa, resumen, último kilómetro y el resto; dentro de
///   cada tipo, `sortOrder` (en `full`, primero `race_day_videos` y después las
///   convertidas). El mismo vídeo (ID de YouTube o URL normalizada) aparece una
///   vez; se conserva la fila de `race_day_videos`.
enum StageVideoLogic {
    static let kindRank: [String: Int] = ["full": 0, "summary": 1, "last_km": 2, "other": 3]

    struct Entry: Identifiable, Hashable, Sendable {
        let id: String
        let kind: String
        /// `nil` en las emisiones convertidas: el rótulo depende del formato de la carrera.
        let title: String?
        let titleEn: String?
        let channel: String?
        let url: String
        let embeddable: Bool?
        let country: String?
        let sortOrder: Int
        let converted: Bool
    }

    struct MediaState: Sendable {
        let entries: [Entry]
        /// Emisiones de Revive que no están en Vídeos.
        let revive: [Broadcast]
        /// Clasificaciones propias y alguna emisión de Revive con enlace.
        let hasRevive: Bool
    }

    /// ID de YouTube con vídeo fijo (`watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/`).
    /// Mismo criterio que `CyclocrossPresentation.youtubeVideoId`, sin aislamiento de actor.
    nonisolated static func youtubeId(_ url: String?) -> String? {
        guard let value = url?.trimmingCharacters(in: .whitespacesAndNewlines),
              let parsed = URL(string: value), parsed.scheme?.lowercased() == "https",
              let host = parsed.host?.lowercased() else { return nil }
        let parts = parsed.pathComponents.filter { $0 != "/" }
        let id: String?
        if host == "youtu.be", parts.count == 1 { id = parts[0] }
        else if ["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].contains(host) {
            if parts == ["watch"] { id = URLComponents(url: parsed, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "v" })?.value }
            else if parts.count == 2, ["live", "shorts", "embed"].contains(parts[0]) { id = parts[1] }
            else { id = nil }
        } else { id = nil }
        guard let id, id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else { return nil }
        return id
    }

    /// Identidad de un vídeo: ID de YouTube o URL sin protocolo, www, fragmento ni barra final.
    static func videoKey(_ url: String?) -> String {
        guard let url else { return "" }
        if let id = youtubeId(url) { return "yt:\(id)" }
        guard let components = URLComponents(string: url.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = components.host?.lowercased() else { return url.trimmingCharacters(in: .whitespacesAndNewlines) }
        var path = components.path
        while path.hasSuffix("/") { path.removeLast() }
        let query = components.percentEncodedQuery.map { "?\($0)" } ?? ""
        let bareHost = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        return "\(bareHost)\(path)\(query)"
    }

    static func isConvertible(_ broadcast: Broadcast) -> Bool {
        guard let url = broadcast.url, !url.isEmpty else { return false }
        return broadcast.embeddable != false && youtubeId(url) != nil
    }

    /// Emisiones convertidas de la jornada, en su orden.
    static func convertedBroadcasts(_ broadcasts: [Broadcast], hasResults: Bool, isCancelled: Bool) -> [Broadcast] {
        guard hasResults else { return [] }
        return RaceLogic.reviveBroadcasts(from: sorted(broadcasts), isCancelled: isCancelled).filter(isConvertible)
    }

    private static func sorted(_ broadcasts: [Broadcast]) -> [Broadcast] {
        broadcasts.enumerated().sorted { a, b in
            let sa = a.element.sortOrder ?? 0, sb = b.element.sortOrder ?? 0
            return sa != sb ? sa < sb : a.offset < b.offset
        }.map(\.element)
    }

    /// Vídeos de la jornada en el orden de presentación.
    static func entries(broadcasts: [Broadcast], videos: [RaceDayVideo], hasResults: Bool, isCancelled: Bool) -> [Entry] {
        let own = videos.filter { !$0.url.isEmpty }.map { video in
            Entry(id: video.id, kind: kindRank[video.kind] != nil ? video.kind : "other", title: video.title, titleEn: video.titleEn,
                  channel: video.channel, url: video.url, embeddable: video.embeddable, country: video.country,
                  sortOrder: video.sortOrder ?? 0, converted: false)
        }
        let converted = convertedBroadcasts(broadcasts, hasResults: hasResults, isCancelled: isCancelled).map { broadcast in
            Entry(id: broadcast.id, kind: "full", title: nil, titleEn: nil, channel: broadcast.channel, url: broadcast.url ?? "",
                  embeddable: broadcast.embeddable, country: broadcast.country, sortOrder: broadcast.sortOrder ?? 0, converted: true)
        }
        let ordered = (own + converted).enumerated().sorted { a, b in
            let x = a.element, y = b.element
            let rx = kindRank[x.kind] ?? 3, ry = kindRank[y.kind] ?? 3
            if rx != ry { return rx < ry }
            if x.converted != y.converted { return !x.converted }
            if x.sortOrder != y.sortOrder { return x.sortOrder < y.sortOrder }
            return a.offset < b.offset
        }.map(\.element)
        var seen = Set<String>()
        return ordered.filter { seen.insert(videoKey($0.url)).inserted }
    }

    /// Vídeos y Revive de la jornada.
    static func mediaState(broadcasts: [Broadcast], videos: [RaceDayVideo], hasResults: Bool, isCancelled: Bool) -> MediaState {
        let list = entries(broadcasts: broadcasts, videos: videos, hasResults: hasResults, isCancelled: isCancelled)
        let keys = Set(list.map { videoKey($0.url) })
        let revive = RaceLogic.reviveBroadcasts(from: sorted(broadcasts), isCancelled: isCancelled)
            .filter { !keys.contains(videoKey($0.url)) }
        return MediaState(entries: list, revive: revive,
                          hasRevive: hasResults && revive.contains { !($0.url ?? "").isEmpty })
    }

    /// Emisión que abre Revive en la tarjeta terminada: redes sociales antes
    /// que el resto, después `sortOrder`.
    static func cardReviveBroadcast(_ broadcasts: [Broadcast]) -> Broadcast? {
        func social(_ url: String?) -> Int {
            let u = (url ?? "").lowercased()
            return u.contains("youtube.com") || u.contains("youtu.be") || u.contains("facebook.com") ? 0 : 1
        }
        return broadcasts.filter(RaceLogic.isReviveBroadcast).enumerated().sorted { a, b in
            let sa = social(a.element.url), sb = social(b.element.url)
            if sa != sb { return sa < sb }
            let oa = a.element.sortOrder ?? 0, ob = b.element.sortOrder ?? 0
            return oa != ob ? oa < ob : a.offset < b.offset
        }.first?.element
    }

    /// Destinos de la tarjeta terminada: `hasVideos` (vídeos propios distintos
    /// de Revive: la tarjeta lleva al panel Vídeos) y `revive` (la emisión
    /// íntegra). Con los dos, menú «Vídeos» / «Completa».
    static func cardActions(broadcasts: [Broadcast], videos: [RaceDayVideo]) -> (hasVideos: Bool, revive: Broadcast?) {
        let revive = cardReviveBroadcast(broadcasts).flatMap { ($0.url ?? "").isEmpty ? nil : $0 }
        let reviveKey = revive.map { videoKey($0.url) }
        let hasVideos = videos.contains { !$0.url.isEmpty && videoKey($0.url) != reviveKey }
        return (hasVideos, revive)
    }

    /// Vídeos visibles con los grupos regionales del usuario.
    static func filterByRegion(_ videos: [RaceDayVideo], allowedGroups: Set<String>) -> [RaceDayVideo] {
        videos.filter { RaceLogic.broadcastMatchesRegion($0.country, allowedGroups: allowedGroups) }
            .sorted { ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0) }
    }

    /// Rótulo del vídeo: las emisiones convertidas, según el formato de la carrera.
    static func title(_ entry: Entry, oneDay: Bool, english: Bool) -> String {
        if entry.converted {
            return english ? (oneDay ? "Race broadcast" : "Stage broadcast") : (oneDay ? "Emisión de la carrera" : "Emisión de la etapa")
        }
        return english ? (entry.titleEn ?? entry.title ?? "") : (entry.title ?? "")
    }

    /// Reproductor integrado: YouTube con `embeddable` distinto de `false`. El
    /// resto se abre fuera, como las emisiones.
    static func embeddedYouTubeId(_ entry: Entry) -> String? {
        entry.embeddable == false ? nil : youtubeId(entry.url)
    }

    /// Plataforma del enlace externo («RTVE Play ↗»): nombre conocido o el dominio.
    static func platformLabel(_ url: String) -> String {
        guard let host = URLComponents(string: url)?.host?.lowercased() else { return "" }
        let known: [(String, String)] = [
            ("rtve.es", "RTVE Play"), ("etbon.eus", "ETB On"), ("eitb.eus", "ETB On"), ("raiplay.it", "RaiPlay"),
            ("rtbf.be", "Auvio"), ("hbomax.com", "HBO Max"), ("max.com", "HBO Max"), ("sporza.be", "Sporza"), ("vrt.be", "VRT MAX"),
            ("rtp.pt", "RTP Play"), ("3cat.cat", "3Cat"), ("ccma.cat", "3Cat"), ("youtube.com", "YouTube"), ("youtu.be", "YouTube"), ("facebook.com", "Facebook"),
            ("fb.watch", "Facebook"), ("instagram.com", "Instagram"), ("x.com", "X"), ("twitter.com", "X"), ("tiktok.com", "TikTok"),
        ]
        if let match = known.first(where: { host == $0.0 || host.hasSuffix(".\($0.0)") }) { return match.1 }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
