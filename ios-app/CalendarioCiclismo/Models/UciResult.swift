import Foundation

/// Resultados in-house UCI (tablas `race_uci_stages` / `race_uci_results`,
/// migraciones 081/082). Port literal de los modelos de Android
/// (`data/model/UciResult.kt`) y del comportamiento de la web (`js/resultados.js`).
///
/// La fila de resultado guarda solo el dorsal + el dato; el CORREDOR se
/// reconstruye por dorsal contra la startlist curada (`startlist_riders_resolved`),
/// igual que en la web. `riderDisplay` es el fallback cuando el dorsal no casa.
///
/// Solo se muestran las clasificaciones `keepForWeb=true` (clasificación de etapa
/// + GC del día + generales acumuladas de puntos/montaña/jóvenes/equipos).

/// Cabecera de una (etapa × clasificación) — fila de `race_uci_stages`.
struct RaceUciStage: Codable, Identifiable, Hashable {
    let id: String
    let raceId: String
    let raceDayId: String?
    let classKind: String            // stage | gc | points | kom | youth | teams
    let eventName: String?
    let isTeamEvent: Bool
    let stageNumber: Int?            // 0 = prólogo, nil = clasificación final
    let isFinalClassification: Bool
    let keepForWeb: Bool
    let rowCount: Int
    let raceType: String?            // RaceTypeCode de DataRide ("ITT" = crono individual)
    /// Fecha de la etapa (YYYY-MM-DD). Puede venir NULL (volcados PDF, migración
    /// 090) → el feed de resultados la resuelve vía raceDayId/fechas de carrera.
    let stageDate: String?
    /// Ganador crudo de la fuente (la pantalla lo refina por dorsal; el feed lo
    /// usa como fallback cuando no resuelve el nombre canónico).
    let winnerName: String?

    // ── Campos SINTÉTICOS (etapa cancelada) — no existen en BD ─────────────
    // Los pone UciResultsLogic.applyCancelledStages. Fuera de CodingKeys: ni se
    // piden ni se mandan a PostgREST.
    /// Marcador de la pestaña "Etapa" de una jornada cancelada: sin filas, el
    /// render lo pinta como aviso de cancelación.
    var isCancelledStage: Bool = false
    /// General ARRASTRADA: nº de la etapa de la que vienen estas filas (la
    /// cancelada no movió la clasificación). El render lo avisa.
    var carriedFromStage: Int?
    /// Sufijo de sector (A/B) de la etapa arrastrada, para el aviso ("tras la 3A").
    var carriedFromSuffix: String?

    private enum CodingKeys: String, CodingKey {
        case id, raceId, raceDayId, classKind, eventName, isTeamEvent
        case stageNumber, isFinalClassification, keepForWeb, rowCount, raceType
        case stageDate, winnerName
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        raceId = try c.decode(String.self, forKey: .raceId)
        raceDayId = try c.decodeIfPresent(String.self, forKey: .raceDayId)
        classKind = try c.decode(String.self, forKey: .classKind)
        eventName = try c.decodeIfPresent(String.self, forKey: .eventName)
        isTeamEvent = try c.decodeIfPresent(Bool.self, forKey: .isTeamEvent) ?? false
        stageNumber = try c.decodeIfPresent(Int.self, forKey: .stageNumber)
        isFinalClassification = try c.decodeIfPresent(Bool.self, forKey: .isFinalClassification) ?? false
        keepForWeb = try c.decodeIfPresent(Bool.self, forKey: .keepForWeb) ?? false
        rowCount = try c.decodeIfPresent(Int.self, forKey: .rowCount) ?? 0
        raceType = try c.decodeIfPresent(String.self, forKey: .raceType)
        stageDate = try c.decodeIfPresent(String.self, forKey: .stageDate)
        winnerName = try c.decodeIfPresent(String.self, forKey: .winnerName)
    }

    init(
        id: String, raceId: String, raceDayId: String? = nil, classKind: String,
        eventName: String? = nil, isTeamEvent: Bool = false, stageNumber: Int? = nil,
        isFinalClassification: Bool = false, keepForWeb: Bool = false, rowCount: Int = 0,
        raceType: String? = nil, stageDate: String? = nil, winnerName: String? = nil,
        isCancelledStage: Bool = false, carriedFromStage: Int? = nil, carriedFromSuffix: String? = nil
    ) {
        self.id = id
        self.raceId = raceId
        self.raceDayId = raceDayId
        self.classKind = classKind
        self.eventName = eventName
        self.isTeamEvent = isTeamEvent
        self.stageNumber = stageNumber
        self.isFinalClassification = isFinalClassification
        self.keepForWeb = keepForWeb
        self.rowCount = rowCount
        self.raceType = raceType
        self.stageDate = stageDate
        self.winnerName = winnerName
        self.isCancelledStage = isCancelledStage
        self.carriedFromStage = carriedFromStage
        self.carriedFromSuffix = carriedFromSuffix
    }
}

/// Fila de clasificación — fila de `race_uci_results` (filtrada por `stageRef`).
struct RaceUciResultRow: Codable, Hashable {
    let stageRef: String
    let raceId: String
    let rank: Int?                   // nil si DNF/DNS/OTL/DSQ
    let rankText: String?
    let bib: String?                 // dorsal (TEXT en la BD; parsear a Int)
    let riderDisplay: String?
    let globalRiderId: String?
    /// Override MANUAL de equipo (mig. 112), fijado desde el panel. Cuando no es
    /// nil, gana a la resolución por dorsal/globalRiderId en el render.
    let teamId: String?
    let resultValue: String?
    let timeText: String?
    let gapText: String?
    let points: Int?
    /// Puntos UCI derivados de carrera + clasificación + puesto. Double permite
    /// las centésimas del reparto de una CRE o de un ex-aequo.
    let uciPoints: Double?
    let irm: String?                 // DNF | DNS | OTL | DSQ
    let sortOrder: Int

    private enum CodingKeys: String, CodingKey {
        case stageRef, raceId, rank, rankText, bib, riderDisplay, globalRiderId
        case teamId, resultValue, timeText, gapText, points, uciPoints, irm, sortOrder
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stageRef = try c.decode(String.self, forKey: .stageRef)
        raceId = try c.decode(String.self, forKey: .raceId)
        rank = try c.decodeIfPresent(Int.self, forKey: .rank)
        rankText = try c.decodeIfPresent(String.self, forKey: .rankText)
        bib = try c.decodeIfPresent(String.self, forKey: .bib)
        riderDisplay = try c.decodeIfPresent(String.self, forKey: .riderDisplay)
        globalRiderId = try c.decodeIfPresent(String.self, forKey: .globalRiderId)
        teamId = try c.decodeIfPresent(String.self, forKey: .teamId)
        resultValue = try c.decodeIfPresent(String.self, forKey: .resultValue)
        timeText = try c.decodeIfPresent(String.self, forKey: .timeText)
        gapText = try c.decodeIfPresent(String.self, forKey: .gapText)
        points = try c.decodeIfPresent(Int.self, forKey: .points)
        uciPoints = try c.decodeIfPresent(Double.self, forKey: .uciPoints)
        irm = try c.decodeIfPresent(String.self, forKey: .irm)
        sortOrder = try c.decodeIfPresent(Int.self, forKey: .sortOrder) ?? 0
    }

    init(
        stageRef: String, raceId: String, rank: Int? = nil, rankText: String? = nil,
        bib: String? = nil, riderDisplay: String? = nil, globalRiderId: String? = nil,
        teamId: String? = nil,
        resultValue: String? = nil, timeText: String? = nil, gapText: String? = nil,
        points: Int? = nil, uciPoints: Double? = nil, irm: String? = nil, sortOrder: Int = 0
    ) {
        self.stageRef = stageRef
        self.raceId = raceId
        self.rank = rank
        self.rankText = rankText
        self.bib = bib
        self.riderDisplay = riderDisplay
        self.globalRiderId = globalRiderId
        self.teamId = teamId
        self.resultValue = resultValue
        self.timeText = timeText
        self.gapText = gapText
        self.points = points
        self.uciPoints = uciPoints
        self.irm = irm
        self.sortOrder = sortOrder
    }

    /// Dorsal numérico (la UCI puede traer bibs de equipo no numéricos en CRE).
    var dorsalInt: Int? { bib.flatMap { Int($0) } }
}

/// Vista `startlist_riders_resolved`: nombre/país canónicos desde
/// riders_men/women vía `globalRiderId`, con el snapshot de fallback. `teamId`
/// es el **PK** de `startlist_teams` (no la ref canónica a `teams`).
///
/// Es un DTO propio (no el de StartlistViewModel) porque aquí necesitamos
/// `globalRiderId` para reconstruir el corredor por dorsal en los resultados.
struct StartlistRiderResolved: Codable {
    let dorsal: Int?
    let firstName: String?
    let lastName: String?
    let countryCode: String?
    let teamId: String?              // PK de startlist_teams
    let globalRiderId: String?
}

/// Corredor reconstruido por dorsal (nombre + bandera + equipo + chapa).
struct ResolvedRider: Hashable {
    let name: String
    let countryCode: String
    let teamName: String
    let team: Team?                  // equipo canónico (para la chapa); nil si no casó
    /// id de la ficha (riders_men/women). `var` con default para que los
    /// inits existentes (tests) sigan compilando.
    var globalRiderId: String? = nil

    static func == (lhs: ResolvedRider, rhs: ResolvedRider) -> Bool {
        lhs.name == rhs.name && lhs.countryCode == rhs.countryCode
            && lhs.teamName == rhs.teamName && lhs.team?.id == rhs.team?.id
            && lhs.globalRiderId == rhs.globalRiderId
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(name)
        hasher.combine(teamName)
    }
}

/// Estado "fuera de carrera" de un corredor (abandono/no-salida/fuera de control/
/// descalificación), tomado de su etapa más reciente con `irm`.
struct RiderOut: Hashable {
    let irm: String                  // DNF | DNS | OTL | DSQ
    let stageNumber: Int?            // etapa donde quedó fuera (nil en one-day)
}

/// Payload de la carga inicial de la pantalla de resultados. Las filas de cada
/// clasificación se cargan luego, on-demand, por `stageRef` (`loadResultRows`).
struct UciResultsData {
    let race: Race
    let stages: [RaceUciStage]
    let byDorsal: [Int: ResolvedRider]
    /// Equipos canónicos de la startlist — para casar por NOMBRE las filas de la
    /// pestaña Equipos (riderDisplay crudo de la fuente, sin dorsal).
    let raceTeams: [Team]
    /// RaceDay de la etapa activa por defecto (para el header tipo perfil).
    let raceDay: RaceDay?
    /// TODAS las jornadas publicadas de la carrera (con countryCode/ruta/…). El
    /// header resuelve la jornada de la etapa activa de aquí — por `raceDayId` y,
    /// si el volcado no lo trajo, por `stageNumber` — sin más red y aplicando el
    /// override de país por jornada. Vacío en el caso degenerado sin jornadas.
    var raceDays: [RaceDay] = []
    /// Dobles sectores: raceDayId → sufijo ('A'/'B') y stageNumber sectorizados.
    /// La pantalla agrupa las clasificaciones con esto para separar 3A de 3B.
    var sectorSuffixByRaceDayId: [String: String] = [:]
    var sectoredStageNumbers: Set<Int> = []
}
