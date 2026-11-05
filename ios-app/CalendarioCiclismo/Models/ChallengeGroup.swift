import Foundation

/// Agrupación de carreras de un día (tabla `challenge_groups`), p. ej. la
/// Challenge Mallorca, o de las pruebas de un campeonato
/// (`SeasonChallengeLogic.championshipGroups`). Temporada la presenta en una
/// sola fila, como la web (`js/temporada.js`).
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
    /// Campeonatos y Juegos, sin las CN de la pantalla de Campeonatos, con la
    /// forma de un challenge: `entries` los muestra en una fila desplegable
    /// si tienen al menos dos pruebas visibles. Un país con pruebas a ambos lados
    /// de la ventana de la pantalla forma un grupo por cada lado. Espejo de
    /// `_buildChampionshipGroups` en `js/temporada.js`.
    static func championshipGroups(races: [Race]) -> [ChallengeGroup] {
        let candidates = races.filter { isGroupedEvent($0) && !ChampionshipsConfig.isOnChampionshipsScreen($0) }
        let byEvent = Dictionary(grouping: candidates) { race -> String in
            let afterScreen = ChampionshipsConfig.isChampionship(race)
                && (race.startDate?.dropFirst(5) ?? "") > ChampionshipsConfig.queryEnd.dropFirst(5)
            return "\(race.year ?? 0)-\(race.uciCategory ?? "")-\(championshipBaseName(race.name))\(afterScreen ? "-2" : "")"
        }
        return byEvent.map { key, members in
            let first = members[0]
            return ChallengeGroup(
                id: key,
                name: championshipBaseName(first.localizedName),
                gender: members.allSatisfy { $0.gender == first.gender } ? first.gender : nil,
                year: first.year,
                uciCategory: first.uciCategory,
                countryCode: first.countryCode,
                colorHex: first.colorHex,
                logoUrl: first.logoUrl,
                raceIds: members.map(\.id)
            )
        }
    }

    /// Pruebas que se agrupan: campeonatos continentales, mundiales y nacionales,
    /// y las que llevan «Panamericano» o «Juegos» en el nombre.
    private static func isGroupedEvent(_ race: Race) -> Bool {
        ["CC", "CN", "WC"].contains(race.uciCategory ?? "")
            || race.name.range(of: #"\b(?:panamericanos?|juegos)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Nombre del campeonato sin la prueba: «Campeonato de Asia CRI femenino» →
    /// «Campeonato de Asia»; «Asian Championships - Women's Elite ITT» → «Asian
    /// Championships».
    private static func championshipBaseName(_ name: String) -> String {
        name.replacingOccurrences(of: #"\s+(?:-\s|(?:CRI|CRE|línea|[Mm]en's|[Ww]omen's)\b).*$"#, with: "", options: .regularExpression)
    }

    /// Nombre de una prueba bajo la fila de su grupo: en un campeonato, solo la
    /// prueba («CRI femenina», «Línea sub23 masculina», «Women's Elite ITT»). El
    /// nombre completo se recorta y todas las filas se verían iguales. El género
    /// concuerda con la modalidad.
    static func nameInGroup(_ race: Race) -> String {
        let name = race.localizedName
        guard isGroupedEvent(race) else { return name }
        let event = String(name.dropFirst(championshipBaseName(name).count))
            .replacingOccurrences(of: #"^\s+(?:-\s+)?"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "femenino", with: "femenina")
            .replacingOccurrences(of: "masculino", with: "masculina")
        return event.prefix(1).uppercased() + event.dropFirst()
    }

    /// Pruebas visibles de cada challenge (id → carreras por fecha y nombre).
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
        return result.filter { $0.value.count > 1 }.mapValues { members in
            members.sorted { (($0.startDate ?? ""), $0.name) < (($1.startDate ?? ""), $1.name) }
        }
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
