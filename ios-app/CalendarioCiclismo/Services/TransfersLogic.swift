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
    static let divisions = ["WT", "WWT", "PT", "PRW"]

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

    /// Feed público: solo confirmados CON fecha visible, cronológico inverso.
    /// `dateVisible=false` es un flag de publicación en el feed, no una fecha
    /// ausente: el movimiento sigue contando en el detalle de equipo.
    static func confirmedFeed(_ transfers: [RiderTransfer]) -> [RiderTransfer] {
        transfers.filter { $0.status == "confirmed" && $0.dateVisible }
            .sorted {
                let a = ($0.announcedAt ?? "", $0.createdAt ?? "")
                let b = ($1.announcedAt ?? "", $1.createdAt ?? "")
                return a > b
            }
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
        let arrivals: [RiderTransfer]
        let departures: [RiderTransfer]
    }

    /// Deriva las secciones del detalle de equipo. `roster` = plantilla actual
    /// (riders con currentTeamId = equipo). Las retiradas cuentan como salida
    /// (bloque "se marchan", sin destino). Orden de secciones en pantalla:
    /// continúan → en duda → se marchan → llegan.
    static func teamDetail(
        transfers: [RiderTransfer],
        roster: [TransferRider],
        teamId: String
    ) -> TeamDetail {
        let arrivals = transfers.filter { $0.type == "transfer" && $0.toTeamId == teamId }
        let departures = transfers.filter {
            ($0.type == "transfer" || $0.type == "retirement") && $0.fromTeamId == teamId
        }
        // Renovación más reciente por corredor (transfers llega en orden desc).
        // Las EN DUDA van a su propio bucket: no anotan contrato ni "continúan".
        var renewalsByRider: [String: RiderTransfer] = [:]
        var doubtsByRider: [String: RiderTransfer] = [:]
        for t in transfers where t.type == "renewal" && t.toTeamId == teamId {
            if t.status == "doubt" {
                if doubtsByRider[t.riderId] == nil { doubtsByRider[t.riderId] = t }
            } else if renewalsByRider[t.riderId] == nil {
                renewalsByRider[t.riderId] = t
            }
        }

        let gone = Set(departures.map(\.riderId))
        let staying = roster.filter { !gone.contains($0.id) && doubtsByRider[$0.id] == nil }
            .sorted {
                "\($0.lastName ?? "") \($0.firstName ?? "")".lowercased()
                    < "\($1.lastName ?? "") \($1.firstName ?? "")".lowercased()
            }
            .map { rider -> StayingRow in
                let renewal = renewalsByRider[rider.id]
                return StayingRow(
                    rider: rider,
                    contractUntil: renewal?.contractUntil ?? rider.contractUntil,
                    isRumor: renewal?.status == "rumor"
                )
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

        return TeamDetail(staying: staying, doubtful: doubtful, arrivals: arrivals, departures: departures)
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
