import Foundation

@MainActor
@Observable
final class TodayHighlightsViewModel {
    var items: [TodayHighlightView] = []
    var dismissedHash: String?
    var isLoading = false

    private let dismissKey = "cc_giro_dismissed_hash"

    /// Hash determinista del contenido actual. Si cambia, reaparece el cintillo
    /// aunque el usuario lo hubiera cerrado.
    var contentHash: String {
        items
            .map { "\($0.highlight.id):\($0.highlight.targetType):\($0.highlight.position):\($0.highlight.updatedAt ?? "")" }
            .joined(separator: "|")
    }

    var shouldShow: Bool {
        guard !items.isEmpty else { return false }
        return dismissedHash != contentHash
    }

    init() {
        self.dismissedHash = UserDefaults.standard.string(forKey: dismissKey)
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            // visibleFrom / visibleUntil son TIMESTAMPTZ — comparamos contra "ahora"
            // con precisión al segundo. Filtramos en cliente porque PostgREST con
            // ISO strings + nulls a través de .or() es frágil al escaping.
            let all: [TodayHighlight] = try await SupabaseService.shared.client
                .from("today_highlights")
                .select()
                .order("position", ascending: true)
                .execute()
                .value
            print("[TodayHighlights] fetched \(all.count) total rows")

            let now = Date()
            let isoParser = ISO8601DateFormatter()
            isoParser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let isoParserNoFrac = ISO8601DateFormatter()
            isoParserNoFrac.formatOptions = [.withInternetDateTime]
            func parse(_ s: String?) -> Date? {
                guard let s, !s.isEmpty else { return nil }
                return isoParser.date(from: s) ?? isoParserNoFrac.date(from: s)
            }
            let highlights = all.filter { h in
                let from = parse(h.visibleFrom)
                let until = parse(h.visibleUntil)
                let afterFrom = from.map { $0 <= now } ?? true
                let beforeUntil = until.map { $0 >= now } ?? true
                return afterFrom && beforeUntil
            }
            print("[TodayHighlights] \(highlights.count) visible right now")

            guard !highlights.isEmpty else {
                self.items = []
                return
            }

            // Resolver raceId y raceDayId
            let raceIds   = Set(highlights.compactMap { $0.raceId })
            let raceDayIds = Set(highlights.compactMap { $0.raceDayId })

            // Cargados secuencialmente — `async let` con `try await` en tuple
            // enmascaraba qué fetch fallaba si la decodificación de Race/RaceDay
            // rompía. Secuencial + try independiente da mejor diagnóstico.
            let rs: [Race]
            do {
                rs = try await SupabaseService.shared.races(byIds: Array(raceIds))
            } catch {
                print("[TodayHighlights] races(byIds:) FAILED — \(error)")
                self.items = []
                return
            }
            let rds: [RaceDay]
            do {
                rds = try await SupabaseService.shared.raceDays(byIds: Array(raceDayIds))
            } catch {
                print("[TodayHighlights] raceDays(byIds:) FAILED — \(error)")
                self.items = []
                return
            }

            var racesById = Dictionary(uniqueKeysWithValues: rs.map { ($0.id, $0) })
            let rdsById   = Dictionary(uniqueKeysWithValues: rds.map { ($0.id, $0) })

            // Si vino solo raceDayId, traer carrera padre
            let parentRaceIds = Set(rds.compactMap { $0.raceId })
            let missing = parentRaceIds.subtracting(racesById.keys)
            if !missing.isEmpty {
                let extra: [Race] = try await SupabaseService.shared.races(byIds: Array(missing))
                for r in extra { racesById[r.id] = r }
            }

            let resolved = highlights.compactMap { h -> TodayHighlightView? in
                let rd = h.raceDayId.flatMap { rdsById[$0] }
                let race: Race? = {
                    if let rid = h.raceId { return racesById[rid] }
                    if let rdRaceId = rd?.raceId { return racesById[rdRaceId] }
                    return nil
                }()
                // Campeonatos y Fichajes: destinos sin carrera (pantalla nativa).
                if h.targetType == "championships" || h.targetType == "transfers" {
                    return TodayHighlightView(highlight: h, race: nil, raceDay: nil)
                }
                guard let race else {
                    print("[TodayHighlights] DROP \(h.id) — no race resolved (raceId=\(h.raceId ?? "nil") raceDayId=\(h.raceDayId ?? "nil"))")
                    return nil
                }
                return TodayHighlightView(highlight: h, race: race, raceDay: rd)
            }
            print("[TodayHighlights] resolved \(resolved.count) items / shouldShow=\(dismissedHash != contentHashFor(items: resolved))")
            self.items = resolved
        } catch {
            print("[TodayHighlights] load() outer catch — \(error)")
            self.items = []
        }
    }

    private func contentHashFor(items: [TodayHighlightView]) -> String {
        items
            .map { "\($0.highlight.id):\($0.highlight.targetType):\($0.highlight.position):\($0.highlight.updatedAt ?? "")" }
            .joined(separator: "|")
    }

    func dismiss() {
        dismissedHash = contentHash
        UserDefaults.standard.set(contentHash, forKey: dismissKey)
    }
}
