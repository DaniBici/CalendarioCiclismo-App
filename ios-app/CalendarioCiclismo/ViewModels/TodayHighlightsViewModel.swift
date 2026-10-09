import Foundation

@MainActor
@Observable
final class TodayHighlightsViewModel {
    var items: [TodayHighlightView] = []
    var dismissedHash: String?
    var isLoading = false

    /// Sección del cintillo: "road" (Hoy y carretera) o "cx" (agenda Ciclocross).
    /// Cada scope tiene su propio contenido editorial y su propio dismiss.
    let scope: String
    private var dismissKey: String { scope == "cx" ? "cc_giro_dismissed_hash_cx" : "cc_giro_dismissed_hash" }

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

    init(scope: String = "road") {
        self.scope = scope == "cx" ? "cx" : "road"
        self.dismissedHash = UserDefaults.standard.string(forKey: scope == "cx" ? "cc_giro_dismissed_hash_cx" : "cc_giro_dismissed_hash")
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
                .eq("scope", value: scope)
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

            let cxIds = Array(Set(highlights.filter { $0.targetType == "cxRace" }.compactMap { $0.cxRaceId }))
            let cxTournamentIds = Array(Set(highlights.filter { $0.targetType == "cxTournament" }.compactMap { $0.cxTournamentId }))
            let service = SupabaseService.shared

            // En paralelo, pero cada petición captura su propio resultado:
            // `async let` con `try await` en tupla enmascaraba qué fetch fallaba
            // si la decodificación de Race/RaceDay rompía. El cintillo solo
            // pinta la fecha y la ruta de la jornada: columnas de lista.
            async let racesReq = Self.capture { try await service.races(byIds: Array(raceIds)) }
            async let raceDaysReq = Self.capture {
                try await service.raceDays(byIds: Array(raceDayIds), columns: SupabaseService.raceDayCoreColumns)
            }
            // Un fallo de CX no elimina los destacados de carretera ya resueltos.
            async let cxRowsReq: [CxRace] = (try? await service.cxRaces(byIds: cxIds)) ?? []
            async let cxTournamentsReq: [CxTournament] = (try? await service.cxTournaments(byIds: cxTournamentIds)) ?? []
            async let visibleTournamentsReq: Set<String> = CyclocrossRepository.shared.visibleTournamentIds(cxTournamentIds)

            let rs: [Race]
            switch await racesReq {
            case .success(let value): rs = value
            case .failure(let error):
                print("[TodayHighlights] races(byIds:) FAILED - \(error)")
                self.items = []
                return
            }
            let rds: [RaceDay]
            switch await raceDaysReq {
            case .success(let value): rds = value
            case .failure(let error):
                print("[TodayHighlights] raceDays(byIds:) FAILED - \(error)")
                self.items = []
                return
            }

            var racesById = Dictionary(uniqueKeysWithValues: rs.map { ($0.id, $0) })
            let rdsById   = Dictionary(uniqueKeysWithValues: rds.map { ($0.id, $0) })

            // Si vino solo raceDayId, traer carrera padre
            let parentRaceIds = Set(rds.compactMap { $0.raceId })
            let missing = parentRaceIds.subtracting(racesById.keys)
            if !missing.isEmpty {
                let extra: [Race] = try await service.races(byIds: Array(missing))
                for r in extra { racesById[r.id] = r }
            }

            // En inglés se descartan las carreras nacionales y los torneos solo
            // nacionales (CyclocrossPresentation.hiddenClasses).
            let cxRows = await cxRowsReq.filter { !CyclocrossPresentation.isHidden($0) }
            var cxTournamentRows = await cxTournamentsReq
            if !CyclocrossPresentation.hiddenClasses.isEmpty {
                let visible = await visibleTournamentsReq
                cxTournamentRows = cxTournamentRows.filter { visible.contains($0.id) }
            }
            guard !Task.isCancelled else { return }
            let cxById = Dictionary(uniqueKeysWithValues: cxRows.map { ($0.id, $0) })
            let cxTournamentById = Dictionary(uniqueKeysWithValues: cxTournamentRows.map { ($0.id, $0) })
            let resolved = highlights.compactMap { h -> TodayHighlightView? in
                if h.targetType == "cxRace" { return TodayHighlightView.cx(highlight: h, race: h.cxRaceId.flatMap { cxById[$0] }) }
                if h.targetType == "cxTournament" { return TodayHighlightView.cxTournament(highlight: h, tournament: h.cxTournamentId.flatMap { cxTournamentById[$0] }) }
                let rd = h.raceDayId.flatMap { rdsById[$0] }
                let race: Race? = {
                    if let rid = h.raceId { return racesById[rid] }
                    if let rdRaceId = rd?.raceId { return racesById[rdRaceId] }
                    return nil
                }()
                // Campeonatos, Fichajes y Calendario: destinos sin carrera (pantalla nativa).
                if h.targetType == "championships" || h.targetType == "transfers" {
                    return TodayHighlightView(highlight: h, race: nil, raceDay: nil)
                }
                if h.targetType == "season" {
                    return h.seasonYear == nil ? nil : TodayHighlightView(highlight: h, race: nil, raceDay: nil)
                }
                guard let race else {
                    print("[TodayHighlights] DROP \(h.id) - no race resolved (raceId=\(h.raceId ?? "nil") raceDayId=\(h.raceDayId ?? "nil"))")
                    return nil
                }
                return TodayHighlightView(highlight: h, race: race, raceDay: rd)
            }
            print("[TodayHighlights] resolved \(resolved.count) items / shouldShow=\(dismissedHash != contentHashFor(items: resolved))")
            self.items = resolved
        } catch {
            print("[TodayHighlights] load() outer catch - \(error)")
            self.items = []
        }
    }

    /// Resultado de una petición sin propagar el error, para diagnosticar
    /// cada consulta por separado aunque se lancen en paralelo.
    private static func capture<T: Sendable>(
        _ operation: @MainActor @Sendable () async throws -> T
    ) async -> Result<T, Error> {
        do { return .success(try await operation()) } catch { return .failure(error) }
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
