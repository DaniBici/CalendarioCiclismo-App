import Foundation

struct CxTournament: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let nameEn: String?
    let slug: String
    let colorHex: String?
    let logoUrl: String?
    let pointsScheme: CxPointsScheme?
    let seasonKey: String?
}

struct CxPointsScheme: Codable, Sendable {
    let categories: [String: CxPointsCategory]?
}

struct CxPointsCategory: Codable, Sendable {
    let mode: String?
    let extras: CxPointsExtras?
}
struct CxPointsExtras: Codable, Sendable { let derived: CxPointsDerived? }
struct CxPointsDerived: Codable, Sendable { let fromCategory: String? }
struct CxStandingState: Codable, Sendable {
    let category: String
    let status: String
    let roundIds: [String]
    /// Desglose por ronda de la general calculada; nil si falta o no se
    /// puede decodificar (no invalida el estado).
    var breakdown: [CxStandingBreakdownEntry]? = nil
}

extension CxStandingState {
    enum CodingKeys: String, CodingKey { case category, status, roundIds, breakdown }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        category = try values.decode(String.self, forKey: .category)
        status = try values.decode(String.self, forKey: .status)
        roundIds = try values.decode([String].self, forKey: .roundIds)
        breakdown = (try? values.decodeIfPresent([CxStandingBreakdownEntry].self, forKey: .breakdown)) ?? nil
    }
}

/// Fila del desglose de una general por puntos: aportación de cada ronda.
struct CxStandingBreakdownEntry: Codable, Sendable {
    let globalRiderId: String
    let eligible: Bool?
    let rounds: [CxStandingRound]
}

struct CxStandingRound: Codable, Sendable {
    let raceId: String
    /// Puntos de la ronda; el motor los publica como decimal en texto ("40").
    let points: Double?
    let retained: Bool?
    let missing: Bool?
    let sourceRank: Int?

    enum CodingKeys: String, CodingKey { case raceId, points, retained, missing, sourceRank }

    init(raceId: String, points: Double?, retained: Bool? = nil, missing: Bool? = nil, sourceRank: Int? = nil) {
        self.raceId = raceId
        self.points = points
        self.retained = retained
        self.missing = missing
        self.sourceRank = sourceRank
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        raceId = try values.decode(String.self, forKey: .raceId)
        if let number = try? values.decodeIfPresent(Double.self, forKey: .points) {
            points = number
        } else if let text = try? values.decodeIfPresent(String.self, forKey: .points) {
            points = Double(text.trimmingCharacters(in: .whitespaces))
        } else {
            points = nil
        }
        retained = try? values.decodeIfPresent(Bool.self, forKey: .retained)
        missing = try? values.decodeIfPresent(Bool.self, forKey: .missing)
        sourceRank = try? values.decodeIfPresent(Int.self, forKey: .sourceRank)
    }
}

/// Carrera de un torneo reducida a lo que necesitan las columnas de ronda de
/// la general: enlace a la ficha y nombre accesible.
struct CxRaceRef: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let nameEn: String?
    let raceClass: String

    enum CodingKeys: String, CodingKey {
        case id, name, nameEn
        case raceClass = "class"
    }
}

/// Generales publicadas de un torneo para su página de serie.
struct CxTournamentStandings: Sendable {
    let pointsScheme: CxPointsScheme?
    let states: [CxStandingState]
    let standings: [CxStanding]
    let teams: [CxTeam]
    let races: [CxRaceRef]
}

/// Fila mínima para numerar las rondas de un torneo; espejo del select ligero web.
struct CxRoundEntry: Codable, Sendable {
    let dateKey: String?
    let startTimeUtc: String?
}

struct CxRoundRow: Codable, Sendable {
    let id: String
    let tournamentId: String?
    let dateKey: String
    let seasonKey: String?
    var isCancelled: Bool? = nil
    let cx_race_categories: [CxRoundEntry]
    enum CodingKeys: String, CodingKey {
        case id, tournamentId, dateKey, seasonKey, isCancelled
        case cx_race_categories = "cx_race_categories"
    }
}

/// Número de prueba de una carrera dentro de su torneo (1-indexado).
struct CxRound: Equatable, Sendable {
    let n: Int
    let total: Int
}

struct CxCategory: Codable, Sendable, Identifiable {
    var id: String { category }
    let category: String
    let startTimeUtc: String?
    let dateKey: String?
    let sortOrder: Int
    let isCancelled: Bool
    let resultsStatus: String
    let winnerName: String?
    let durationFormat: String?
    let durationRuleVersion: String?
    let durationMinutes: Int?
    let durationRuleSourceUrl: String?
    let startlistImportedAt: String?
}

/// Documento de carrera CX (Libro de Ruta / Mapa); espejo de la tabla `assets`
/// con `"cxRaceId"`. Los campos son opcionales para tolerar payloads parciales.
struct CxAsset: Codable, Sendable, Identifiable {
    var id: String { id_ ?? type ?? url ?? "" }
    let id_: String?
    let type: String?
    let url: String?

    enum CodingKeys: String, CodingKey { case id_ = "id", type, url }
}

struct CxRace: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let nameEn: String?
    let slug: String
    let slugEn: String?
    let seasonKey: String
    let dateKey: String
    let endDateKey: String?
    let raceClass: String
    let countryCode: String?
    let venue: String?
    let tournamentId: String?
    let colorHex: String?
    let logoUrl: String?
    let websiteUrl: String?
    let timezone: String?
    let isCancelled: Bool
    let assets: [CxAsset]?
    let tournament: CxTournament?
    let categories: [CxCategory]

    enum CodingKeys: String, CodingKey {
        case id, name, nameEn, slug, slugEn, seasonKey, dateKey, endDateKey
        case raceClass = "class"
        case countryCode, venue, tournamentId, colorHex, logoUrl, websiteUrl, timezone, isCancelled
        case assets
        case tournament = "cx_tournaments"
        case categories = "cx_race_categories"
    }
}

struct CxStartlistRider: Codable, Sendable, Identifiable {
    let id: String
    let raceId: String
    let category: String
    let bib: String?
    let firstName: String
    let lastName: String
    let countryCode: String?
    let teamId: String?
    let globalRiderId: String?
    let sortOrder: Int
}

/// Identidad cromática alineada con carretera (teams). Los campos son
/// opcionales para decodificar cachés anteriores; los ausentes equivalen a la
/// paleta neutra de la base de datos, que no produce chapa visible.
struct CxTeam: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let uciCode: String
    let colorHex: String
    let countryCode: String?
    let headerBg: String?
    let headerText: String?
    let badgeTorsoCenter: String?
    let badgeTorsoSides: String?
    let badgeInnerCircle: String?
    let badgeShorts: String?
    let nameAliases: [String]?

    /// Equipo en el modelo de carretera: resultados, generales y dorsales CX
    /// usan `findMatchingTeam`, `hasVisibleBadge` y `TeamColorBands` de ruta.
    /// Los colores ausentes toman la paleta neutra de la base de datos.
    var roadTeam: Team {
        Team(id: id, name: name,
             badgeTorsoCenter: badgeTorsoCenter ?? "#ffffff",
             badgeTorsoSides: badgeTorsoSides ?? "#000000",
             badgeShorts: badgeShorts ?? "#000000",
             badgeInnerCircle: badgeInnerCircle,
             headerBg: headerBg ?? "#1f2937",
             headerText: headerText ?? "#ffffff",
             nameAliases: nameAliases?.joined(separator: "\n"))
    }
}

struct CxResult: Codable, Sendable, Identifiable {
    let id: Int64
    let raceId: String
    let category: String
    let rank: Int?
    let rankText: String?
    let bib: String?
    let riderDisplay: String
    let teamName: String?
    let isoCode2: String?
    let timeText: String?
    let gapText: String?
    let points: Double?
    let bonusPoints: Double?
    let timeSeconds: Int64?
    let bonusSeconds: Int?
    let irm: String?
    let sortOrder: Int
}

struct CxStanding: Codable, Sendable, Identifiable {
    let id: String
    let tournamentId: String
    let seasonKey: String
    let category: String
    let rank: Int
    let riderDisplay: String
    let teamName: String?
    let isoCode2: String?
    let points: Double?
    let timeSeconds: Int64?
    /// Identidad del corredor para casar la fila con el desglose por ronda.
    var globalRiderId: String? = nil
    var sortOrder: Int? = nil
}

struct CxBroadcast: Codable, Sendable, Identifiable {
    let id: String
    let raceId: String
    let category: String?
    let channel: String?
    let startTimeUtc: String?
    let url: String?
    let note: String?
    let country: String?
    let sortOrder: Int
    let showInRevive: Bool
    let isSporza: Bool

    enum CodingKeys: String, CodingKey {
        case id, raceId, category, channel, startTimeUtc, url, note, country, sortOrder, showInRevive, isSporza
    }

    // Los indicadores de emisión toleran su ausencia (paridad con los valores
    // por defecto de Android y con `showInRevive` opcional de carretera):
    // un payload parcial o una caché anterior no deben impedir abrir la ficha.
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        raceId = try values.decode(String.self, forKey: .raceId)
        category = try values.decodeIfPresent(String.self, forKey: .category)
        channel = try values.decodeIfPresent(String.self, forKey: .channel)
        startTimeUtc = try values.decodeIfPresent(String.self, forKey: .startTimeUtc)
        url = try values.decodeIfPresent(String.self, forKey: .url)
        note = try values.decodeIfPresent(String.self, forKey: .note)
        country = try values.decodeIfPresent(String.self, forKey: .country)
        sortOrder = try values.decodeIfPresent(Int.self, forKey: .sortOrder) ?? 0
        showInRevive = try values.decodeIfPresent(Bool.self, forKey: .showInRevive) ?? false
        isSporza = try values.decodeIfPresent(Bool.self, forKey: .isSporza) ?? false
    }
}

struct CxVideo: Codable, Sendable, Identifiable {
    let id: String
    let raceId: String
    let category: String?
    let title: String
    let titleEn: String?
    let url: String
    let sortOrder: Int
}

struct CxDetail: Codable, Sendable {
    let race: CxRace
    let startlist: [CxStartlistRider]
    let results: [CxResult]
    let broadcasts: [CxBroadcast]
    let videos: [CxVideo]
    let teams: [CxTeam]
    let standings: [CxStanding]
    var standingsState: [CxStandingState]? = nil
    var assets: [CxAsset]? = nil
    /// Carreras publicadas del torneo: cabeceras de las columnas de ronda.
    var tournamentRaces: [CxRaceRef]? = nil
}
