import Foundation

/// Agrupación de carreras de un día (tabla `challenge_groups`), p. ej. la
/// Challenge Mallorca. Temporada la presenta en una sola fila, como la web
/// (`js/temporada.js`).
struct ChallengeGroup: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    var gender: String? = nil
    var year: Int? = nil
    var uciCategory: String? = nil
    var countryCode: String? = nil
    var colorHex: String? = nil
    var logoUrl: String? = nil
    var raceIds: [String]? = nil
}

/// Entrada de la lista de Temporada: una carrera o un challenge con sus
/// pruebas visibles (al menos dos).
enum SeasonEntry: Identifiable {
    case race(Race)
    case challenge(ChallengeGroup, [Race])

    var id: String {
        switch self {
        case .race(let race): race.id
        case .challenge(let group, _): "challenge-\(group.id)"
        }
    }

    var startDate: String? {
        switch self {
        case .race(let race): race.startDate
        case .challenge(_, let races): races.first?.startDate
        }
    }
}

enum SeasonChallengeLogic {
    /// Pruebas visibles de cada challenge (id → carreras en el orden recibido).
    /// Un challenge con una sola prueba visible no se agrupa.
    static func members(races: [Race], groups: [ChallengeGroup]) -> [String: [Race]] {
        var groupIdByRace: [String: String] = [:]
        for group in groups {
            for raceId in group.raceIds ?? [] { groupIdByRace[raceId] = group.id }
        }
        var result: [String: [Race]] = [:]
        for race in races {
            if let groupId = groupIdByRace[race.id] { result[groupId, default: []].append(race) }
        }
        return result.filter { $0.value.count > 1 }
    }

    /// Sustituye las pruebas de cada challenge (carreras ordenadas por fecha)
    /// por una sola entrada en la posición de la primera.
    static func entries(races: [Race], groups: [ChallengeGroup]) -> [SeasonEntry] {
        let membersByGroup = members(races: races, groups: groups)
        guard !membersByGroup.isEmpty else { return races.map(SeasonEntry.race) }
        let groupsById = Dictionary(uniqueKeysWithValues: groups.map { ($0.id, $0) })
        var groupIdByRace: [String: String] = [:]
        for (groupId, members) in membersByGroup {
            for race in members { groupIdByRace[race.id] = groupId }
        }
        var emitted = Set<String>()
        var result: [SeasonEntry] = []
        for race in races {
            guard let groupId = groupIdByRace[race.id], let group = groupsById[groupId] else {
                result.append(.race(race))
                continue
            }
            if emitted.insert(groupId).inserted {
                result.append(.challenge(group, membersByGroup[groupId] ?? []))
            }
        }
        return result
    }

    /// Fecha que ordena cada carrera por meses: la de la primera prueba de su
    /// challenge, para que el grupo no se reparta entre dos meses.
    static func groupingStartDates(races: [Race], groups: [ChallengeGroup]) -> [String: String] {
        var result: [String: String] = [:]
        for members in members(races: races, groups: groups).values {
            guard let first = members.compactMap(\.startDate).min() else { continue }
            for race in members { result[race.id] = first }
        }
        return result
    }
}
