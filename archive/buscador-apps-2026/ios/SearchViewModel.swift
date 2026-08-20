import Foundation

/// Resultado de búsqueda con indicación de dónde se encontró.
struct SearchResult: Identifiable {
    let race: Race
    let matchLocation: MatchLocation?
    /// ID de la jornada que coincide (para navegar directamente a ella en vueltas por etapas).
    let matchedRaceDayId: String?
    /// Para carreras de un día: id de su jornada única. Permite que el resultado
    /// navegue a la jornada (no a competición, que no tiene lista de etapas).
    let oneDayRaceDayId: String?

    var id: String { race.id }

    enum MatchLocation: String {
        case startCity = "Salida"
        case finishCity = "Meta"
        case startAndFinish = "Salida y meta"
        case description = "En descripción"
    }
}

/// Resultado del buscador — carrera con su relevancia (`score`). Las carreras que
/// casan por NOMBRE son fuertes (weak=0); las que casan solo por una ubicación de
/// etapa son débiles (weak=1) y caen al final a igual score.
struct SearchHit: Identifiable {
    let result: SearchResult
    let score: Int
    let weak: Int

    var id: String { "race:\(result.id)" }
}

/// ViewModel para la vista de búsqueda — equivalente a `js/buscar.js`.
@MainActor
@Observable
final class SearchViewModel {
    var query: String = ""
    var allRaces: [Race] = []
    var isLoading = false
    var error: String?

    /// Máximo de resultados en la lista.
    private let maxCombined = 12

    /// Texto extra por carrera (ciudades y descripciones de sus jornadas).
    private var raceDayTextByRaceId: [String: String] = [:]
    /// Datos de jornadas para determinar dónde se encontró.
    private var raceDaysByRaceId: [String: [RaceDay]] = [:]

    /// Normaliza texto para búsqueda (sin tildes, minúsculas).
    private func normalize(_ str: String) -> String {
        str.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9\\s]", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// Puntuación por substring (espejo de `score()` en js/buscar.js): match al
    /// inicio = 3, tras un espacio = 2, en cualquier otro lugar = 1, sin match = 0.
    private func scoreText(_ text: String?, _ q: String) -> Int {
        let t = normalize(text ?? "")
        guard let range = t.range(of: q) else { return 0 }
        if range.lowerBound == t.startIndex { return 3 }
        if t.contains(" \(q)") { return 2 }
        return 1
    }

    /// Resultados por relevancia: las carreras que casan solo por ubicación de
    /// etapa caen al final.
    var results: [SearchHit] {
        let q = normalize(query)
        guard q.count >= 2 else { return [] }

        let terms = q.split(separator: " ").map(String.init)

        // ── Carreras ──────────────────────────────────────────────
        let raceHits: [SearchHit] = allRaces.compactMap { race in
            let raceHaystack = normalize([
                race.name,
                race.originalName ?? "",
                race.slug ?? "",
                race.countryCode ?? "",
                race.uciCategory ?? ""
            ].joined(separator: " "))

            let fullHaystack = normalize([
                raceHaystack,
                raceDayTextByRaceId[race.id] ?? ""
            ].joined(separator: " "))

            guard terms.allSatisfy({ fullHaystack.contains($0) }) else { return nil }

            let matchLocation: SearchResult.MatchLocation?
            let matchedRaceDayId: String?
            let matchedName: Bool
            if terms.allSatisfy({ raceHaystack.contains($0) }) {
                matchLocation = nil
                matchedRaceDayId = nil
                matchedName = true
            } else {
                let match = findMatchLocation(raceId: race.id, terms: terms)
                matchLocation = match?.location
                matchedRaceDayId = match?.raceDayId
                matchedName = false
            }

            let oneDayRaceDayId: String? = race.isOneDay
                ? raceDaysByRaceId[race.id]?.first?.id
                : nil

            let result = SearchResult(
                race: race,
                matchLocation: matchLocation,
                matchedRaceDayId: matchedRaceDayId,
                oneDayRaceDayId: oneDayRaceDayId
            )
            let s = matchedName ? scoreText(race.name, q) : 0
            return SearchHit(result: result, score: s, weak: matchedName ? 0 : 1)
        }

        // ── Orden por relevancia ──────────────────────────────────
        return raceHits.sorted { a, b in
            if a.score != b.score { return a.score > b.score }
            if a.weak != b.weak { return a.weak < b.weak }
            return hitSortKey(a) < hitSortKey(b)
        }.prefix(maxCombined).map { $0 }
    }

    /// Desempate estable a igual score/weak (por nivel pro + fecha).
    private func hitSortKey(_ hit: SearchHit) -> String {
        let r = hit.result
        let lvl = RaceLogic.proLevel(category: r.race.uciCategory, name: r.race.name, country: r.race.countryCode)
        return String(format: "0:%02d:%@", lvl, r.race.startDate ?? "")
    }

    private func findMatchLocation(raceId: String, terms: [String]) -> (location: SearchResult.MatchLocation, raceDayId: String)? {
        guard let days = raceDaysByRaceId[raceId] else { return nil }

        for rd in days {
            let startNorm = rd.startLocation.map { normalize($0) } ?? ""
            let finishNorm = rd.finishLocation.map { normalize($0) } ?? ""
            let descNorm = rd.description.map { normalize($0) } ?? ""

            let matchesStart = !startNorm.isEmpty && terms.contains(where: { startNorm.contains($0) })
            let matchesFinish = !finishNorm.isEmpty && terms.contains(where: { finishNorm.contains($0) })
            let matchesDesc = !descNorm.isEmpty && terms.contains(where: { descNorm.contains($0) })

            if matchesStart && (rd.finishLocation == nil || rd.finishLocation?.isEmpty == true) {
                return (.startAndFinish, rd.id)
            }
            if matchesStart { return (.startCity, rd.id) }
            if matchesFinish { return (.finishCity, rd.id) }
            if matchesDesc { return (.description, rd.id) }
        }
        return nil
    }

    func loadRaces() async {
        guard allRaces.isEmpty else { return }
        isLoading = true
        error = nil
        do {
            let year = Calendar.current.component(.year, from: Date())
            async let racesResult = SupabaseService.shared.racesByYear(year)
            async let raceDaysResult = SupabaseService.shared.raceDaysForSearch(year: year)

            let (races, loadedRaceDays) = try await (racesResult, raceDaysResult)
            allRaces = races
            var raceDays = loadedRaceDays

            // Detectar dobles sectores
            RaceLogic.annotateDoubleSectors(&raceDays)

            // Agrupar texto de jornadas por raceId
            var textMap: [String: [String]] = [:]
            var daysMap: [String: [RaceDay]] = [:]
            for rd in raceDays {
                guard let raceId = rd.raceId else { continue }
                var parts: [String] = []
                if let s = rd.startLocation { parts.append(s) }
                if let f = rd.finishLocation { parts.append(f) }
                if let d = rd.description { parts.append(d) }
                if !parts.isEmpty {
                    textMap[raceId, default: []].append(contentsOf: parts)
                }
                daysMap[raceId, default: []].append(rd)
            }
            raceDayTextByRaceId = textMap.mapValues { $0.joined(separator: " ") }
            raceDaysByRaceId = daysMap
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
