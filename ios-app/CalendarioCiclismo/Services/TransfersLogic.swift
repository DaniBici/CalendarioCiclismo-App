import Foundation

/// Lógica pura de la pantalla de Fichajes (apps 4.0) — espejo 1:1 de
/// `TransfersLogic.kt` (Android) y `js/fichajes.js` (web). Testeada en
/// `TransfersLogicTests`.
///
/// Reglas de producto (decisión Dani):
///  - El feed lista SOLO confirmaciones; los rumores y las dudas no aparecen en
///    él. Tampoco los movimientos con la fecha oculta (`dateVisible=false`,
///    mig. 123): la carga inicial del mercado mete de golpe anuncios de hace
///    semanas que llenarían el feed de días viejos, pero SÍ deben contar en el
///    detalle de equipo.
///  - En el detalle de equipo, una salida registrada (confirmada O rumoreada)
///    saca al corredor de "continúan" y lo pinta en "se marchan" (con badge
///    Rumor si procede); en el destino aparece en "llegan · Rumor".
///  - Cuarta situación: una renovación EN DUDA (`status='doubt'`, solo válido en
///    `type='renewal'`) = no se sabe si sigue. Saca al corredor de "continúan" y
///    lo lleva a su sección "En duda" (2ª, antes de se marchan/llegan). Una duda
///    sobre ir a OTRO equipo no es esto: eso es un fichaje con `status='rumor'`.
///  - El contrato de una renovación registrada gana al `contractUntil` de la
///    ficha; una renovación rumoreada marca la fila de "continúan" como Rumor.
///    Una DUDA no toca el contrato (no es un hecho: no puede pisar el de la ficha).
enum TransfersLogic {

    /// Temporada del mercado activo. Al abrir el mercado 2028, subir aquí
    /// (y en Android + web).
    static let marketSeason = 2027

    /// Las 4 divisiones del mercado, en el orden de los botones.
    static let divisions = ["WT", "PT", "WWT", "PRW"]

    /// Género de la tabla riders_* por división (para cargar la plantilla).
    static func divisionGender(_ category: String?) -> String? {
        switch category {
        case "WT", "PT", "CT", "NTM", "CLUBM": return "male"
        case "WWT", "PRW", "CTW", "NTW", "CLUBW": return "female"
        default: return nil
        }
    }

    /// Payload de la carga inicial (lo monta `SupabaseService+Transfers`).
    struct MarketData {
        let transfers: [RiderTransfer]
        let seasons: [TeamSeason]
        let ridersById: [String: TransferRider]
        /// teamId → nombre en la temporada del mercado (destino de un fichaje).
        let teamNameById: [String: String]
        /// teamId → nombre en la temporada en curso (origen: el equipo que el
        /// corredor deja, que se llama como se llama ESTA temporada).
        var teamNamePrev: [String: String] = [:]
        /// teamId → fila team_seasons de la temporada EN CURSO (2026). Sus colores
        /// son los "antiguos" que se muestran mientras la chapa del mercado está
        /// oculta. Un equipo NUEVO (nacido en la temporada del mercado) no tiene
        /// entrada aquí → chapa vacía (mig. 129).
        var prevSeasonsByTeamId: [String: TeamSeason] = [:]
    }

    /// Lado del movimiento del que se pide el nombre de un equipo.
    enum TeamSide { case from, to }

    /// Chapa EFECTIVA de un equipo del mercado (decisión Dani 2026-07-18):
    ///  - Colores del mercado PUBLICADOS (`badgeVisible == true`) → la fila del
    ///    mercado (2027).
    ///  - Sin publicar pero el equipo YA existía la temporada anterior → su fila
    ///    ANTERIOR (2026): los colores que la gente ya conoce, hasta que se
    ///    anuncie el kit.
    ///  - Sin publicar y SIN identidad anterior (equipo nacido este año) → nil
    ///    (chapa vacía).
    static func badgeSeason(for season: TeamSeason, prev: [String: TeamSeason]) -> TeamSeason? {
        if season.badgeVisible == true { return season }
        return prev[season.teamId]
    }

    /// Marcador de "baja sin destino conocido" en el texto libre de destino.
    static let unknownDest = "?"

    /// Un FICHAJE REAL: corredor que cambia de equipo (`transfer` con destino
    /// conocido). Las renovaciones, retiradas y fines de contrato sin destino
    /// (`transfer` con `toTeamName='?'`) NO son fichajes → fuera del feed.
    static func isRealSigning(_ x: RiderTransfer) -> Bool {
        x.type == "transfer" && (x.toTeamId != nil || (x.toTeamName != nil && x.toTeamName != unknownDest))
    }

    /// Feed público: solo FICHAJES confirmados CON fecha visible, cronológico
    /// inverso. `dateVisible=false` es un flag de publicación, no una fecha
    /// ausente: el movimiento sigue contando en el detalle de equipo.
    static func confirmedFeed(_ transfers: [RiderTransfer]) -> [RiderTransfer] {
        transfers.filter { $0.status == "confirmed" && $0.dateVisible && isRealSigning($0) }
            .sorted {
                let dateA = $0.announcedAt ?? ""
                let dateB = $1.announcedAt ?? ""
                if dateA != dateB { return dateA > dateB }
                // En una misma fecha, primero el mercado de la próxima temporada
                // y después los fichajes efectivos de mitad de temporada.
                if $0.midSeason != $1.midSeason { return !$0.midSeason }
                return ($0.createdAt ?? "") > ($1.createdAt ?? "")
            }
    }

    /// Feed público de renovaciones confirmadas con fecha visible.
    static func renewalFeed(_ transfers: [RiderTransfer]) -> [RiderTransfer] {
        transfers.filter { $0.status == "confirmed" && $0.dateVisible && $0.type == "renewal" }
            .sorted {
                let a = ($0.announcedAt ?? "", $0.createdAt ?? "")
                let b = ($1.announcedAt ?? "", $1.createdAt ?? "")
                return a > b
            }
    }

    /// Corte del feed "Últimas confirmaciones": hasta `maxDays` fechas distintas
    /// O `maxItems` fichajes, lo que se alcance antes (el feed viene ordenado
    /// cronológico inverso). No hay "cargar más": el mercado completo se ve por
    /// equipo.
    static let feedMaxDays = 5
    static let feedMaxItems = 8
    static func limitedFeed(_ feed: [RiderTransfer]) -> [RiderTransfer] {
        var out: [RiderTransfer] = []
        var lastDay: String? = nil
        var daysShown = 0
        for x in feed {
            let day = x.announcedAt ?? ""
            let newDay = day != lastDay
            if newDay && daysShown >= feedMaxDays { break }
            if out.count >= feedMaxItems { break }
            if newDay { lastDay = day; daysShown += 1 }
            out.append(x)
        }
        return out
    }

    /// Agrupa el feed por día de anuncio conservando el orden de entrada.
    static func groupByDay(_ feed: [RiderTransfer]) -> [(day: String, moves: [RiderTransfer])] {
        var out: [(day: String, moves: [RiderTransfer])] = []
        for t in feed {
            let key = t.announcedAt ?? ""
            if let last = out.last, last.day == key {
                out[out.count - 1].moves.append(t)
            } else {
                out.append((day: key, moves: [t]))
            }
        }
        return out
    }

    /// Equipos de una división, alfabético.
    static func divisionTeams(_ seasons: [TeamSeason], division: String) -> [TeamSeason] {
        seasons.filter { $0.category == division }
            .sorted { ($0.name ?? "").lowercased() < ($1.name ?? "").lowercased() }
    }

    /// Fila de la sección "continúan".
    struct StayingRow: Identifiable {
        let rider: TransferRider
        let contractUntil: Int?
        let isRumor: Bool
        var id: String { rider.id }
    }

    /// Fila de la sección "en duda". `rider` puede ser nil si el corredor ya no
    /// está en la plantilla y no se pudo hidratar su ficha → se cae al riderId.
    struct DoubtRow: Identifiable {
        let rider: TransferRider?
        let riderId: String
        let contractUntil: Int?
        var id: String { riderId }
    }

    struct TeamDetail {
        let staying: [StayingRow]
        let doubtful: [DoubtRow]
        let contractEnds: [RiderTransfer]
        let arrivals: [RiderTransfer]
        let departures: [RiderTransfer]
    }

    /// Un "fin de contrato sin destino": acaba contrato sin equipo conocido
    /// (`transfer` con `toTeamName='?'` y sin `toTeamId`) → sección "Terminan
    /// contrato", no "Se marchan".
    static func isContractEnd(_ x: RiderTransfer) -> Bool {
        x.type == "transfer" && x.toTeamId == nil && x.toTeamName == unknownDest
    }

    /// Deriva las secciones del detalle de equipo. `roster` = plantilla 2027
    /// MATERIALIZADA (rider_team_affiliations year=market), con el contractUntil
    /// de la afiliación. Los cambios de equipo ya no tienen afiliación aquí (no
    /// entran en el roster); las dudas SÍ (siguen afiliadas) y se separan a su
    /// bucket. Orden de secciones: continúan → en duda → terminan contrato →
    /// llegan → se marchan.
    static func teamDetail(
        transfers: [RiderTransfer],
        roster: [TransferRider],
        teamId: String,
        ridersById: [String: TransferRider] = [:],
        categoryByTeamId: [String: String] = [:],
        teamNameById: [String: String] = [:]
    ) -> TeamDetail {
        // Los fichajes efectivos durante la temporada se muestran en el feed,
        // pero no forman parte del mercado de la plantilla siguiente.
        let marketTransfers = transfers.filter { !$0.midSeason }
        // Llegan (fichajes): primero los CONFIRMADOS, luego los rumores; dentro
        // de cada grupo, alfabético por apellido.
        func arrivalName(_ x: RiderTransfer) -> String {
            let r = ridersById[x.riderId]
            return "\(r?.lastName ?? "") \(r?.firstName ?? "")".lowercased()
        }
        func arrivalKey(_ x: RiderTransfer) -> (Int, String) {
            (x.status == "rumor" ? 1 : 0, arrivalName(x))
        }
        let arrivals = marketTransfers.filter { $0.type == "transfer" && $0.toTeamId == teamId }
            .sorted { a, b in
                let ka = arrivalKey(a), kb = arrivalKey(b)
                if ka.0 != kb.0 { return ka.0 < kb.0 }
                return ka.1 < kb.1
            }
        let allDepartures = marketTransfers.filter {
            ($0.type == "transfer" || $0.type == "retirement") && $0.fromTeamId == teamId
        }
        // Fin de contrato sin destino → su propia sección (alfabético por
        // apellido); el resto (fichaje con destino o retirada) se marcha.
        func riderKey(_ x: RiderTransfer) -> String {
            let r = ridersById[x.riderId]
            return "\(r?.lastName ?? "") \(r?.firstName ?? "")".lowercased()
        }
        let contractEnds = allDepartures.filter { isContractEnd($0) }
            .sorted { riderKey($0) < riderKey($1) }
        // Se marchan: por categoría del destino (WT→WWT→PT→PRW→resto), luego
        // alfabético por nombre del equipo; los retiros al final.
        let catRank = ["WT": 0, "WWT": 1, "PT": 2, "PRW": 3]
        func depKey(_ x: RiderTransfer) -> (Int, Int, String) {
            if x.type == "retirement" { return (1, 99, "") }
            let cat = x.toTeamId.flatMap { categoryByTeamId[$0] }
            let rank = cat.flatMap { catRank[$0] } ?? 90
            let name = x.toTeamId.flatMap { teamNameById[$0] } ?? (x.toTeamName ?? "")
            return (0, rank, name.lowercased())
        }
        let departures = allDepartures.filter { !isContractEnd($0) }
            .sorted { a, b in
                let ka = depKey(a), kb = depKey(b)
                if ka.0 != kb.0 { return ka.0 < kb.0 }
                if ka.1 != kb.1 { return ka.1 < kb.1 }
                return ka.2 < kb.2
            }
        // Renovación más reciente por corredor (transfers llega en orden desc).
        // Las EN DUDA van a su propio bucket: no anotan contrato ni "continúan".
        var renewalsByRider: [String: RiderTransfer] = [:]
        var doubtsByRider: [String: RiderTransfer] = [:]
        for t in marketTransfers where t.type == "renewal" && t.toTeamId == teamId {
            if t.status == "doubt" {
                if doubtsByRider[t.riderId] == nil { doubtsByRider[t.riderId] = t }
            } else if renewalsByRider[t.riderId] == nil {
                renewalsByRider[t.riderId] = t
            }
        }

        // "Continúan" = solo quien YA estaba en el equipo en la temporada en
        // curso (currentTeamId = equipo). Un fichaje de fuera también tiene
        // afiliación al año del mercado, pero su currentTeamId es otro equipo →
        // va a "Llegan", no aquí.
        // "gone" = toda salida (fichaje, retirada Y fin de contrato): nadie de
        // ellos continúa.
        let gone = Set(allDepartures.map(\.riderId))
        let staying = roster.filter { $0.currentTeamId == teamId && !gone.contains($0.id) && doubtsByRider[$0.id] == nil }
            .map { rider -> StayingRow in
                let renewal = renewalsByRider[rider.id]
                return StayingRow(
                    rider: rider,
                    contractUntil: renewal?.contractUntil ?? rider.contractUntil,
                    isRumor: renewal?.status == "rumor"
                )
            }
            // Por año de contrato DESC (2030 → … → sin año al final), alfabético
            // como desempate.
            .sorted { a, b in
                if a.contractUntil != b.contractUntil {
                    return (a.contractUntil ?? 0) > (b.contractUntil ?? 0)
                }
                let ka = "\(a.rider.lastName ?? "") \(a.rider.firstName ?? "")".lowercased()
                let kb = "\(b.rider.lastName ?? "") \(b.rider.firstName ?? "")".lowercased()
                return ka < kb
            }

        // En duda: la ficha de la plantilla manda; si el corredor ya no está en
        // ella, se pinta con lo que haya (nombre del movimiento en la UI).
        let byId = Dictionary(uniqueKeysWithValues: roster.map { ($0.id, $0) })
        let doubtful = doubtsByRider.values
            .filter { !gone.contains($0.riderId) }
            .map { t in
                DoubtRow(rider: byId[t.riderId], riderId: t.riderId, contractUntil: byId[t.riderId]?.contractUntil)
            }
            .sorted { a, b in
                let ka = a.rider.map { "\($0.lastName ?? "") \($0.firstName ?? "")" } ?? a.riderId
                let kb = b.rider.map { "\($0.lastName ?? "") \($0.firstName ?? "")" } ?? b.riderId
                return ka.lowercased() < kb.lowercased()
            }

        return TeamDetail(staying: staying, doubtful: doubtful, contractEnds: contractEnds, arrivals: arrivals, departures: departures)
    }

    /// Nombre a mostrar de un equipo referenciado (catálogo > texto libre > fallback).
    /// `side`: `.from` = el equipo que el corredor deja, con el nombre de la
    /// temporada en curso; `.to` = aquel con el que va a correr, con el de la
    /// temporada del mercado.
    static func teamLabel(
        teamId: String?,
        freeText: String?,
        names: [String: String],
        unknownLabel: String,
        side: TeamSide = .to,
        namesPrev: [String: String] = [:]
    ) -> String {
        if let id = teamId {
            let primary = side == .from ? namesPrev : names
            let fallback = side == .from ? names : namesPrev
            return primary[id] ?? fallback[id] ?? id
        }
        if let text = freeText, !text.isEmpty { return text }
        return unknownLabel
    }
}
