import Foundation

/// Lógica pura de las clasificaciones UCI in-house — port literal de
/// `UciResultsLogic.kt` (Android), que a su vez portó los helpers de
/// `js/resultados.js`. Sin dependencias de SwiftUI: todo es testeable
/// con XCTest (ver `UciResultsLogicTests`).
///
/// Aquí vive: normalización de tiempos/gaps, puntos, IRM (DNF/DNS/OTL/DSQ), la
/// detección y colapso de CRE, y la construcción de las filas individuales (con
/// el gap efectivo ya resuelto). El "m.t." dinámico al filtrar por equipo lo
/// decide la UI sobre las filas VISIBLES (igual que `applyTeamFilter` en la web).
enum UciResultsLogic {

    /// Orden de las pestañas de clasificación.
    static let classOrder = ["stage", "gc", "points", "kom", "youth", "teams"]

    /// Etiquetas IRM (no clasificados). Fuente única, espejo de `js/uci-irm.js`.
    static func irmLabel(_ code: String?, isEn: Bool) -> String {
        guard let code, !code.isEmpty else { return "" }
        switch code {
        case "DNF", "ABD": return isEn ? "DNF" : "ABN"   // ABD = variante UCI de DNF
        case "DNS": return isEn ? "DNS" : "NS"
        case "OTL": return isEn ? "OTL" : "FC"
        case "DSQ": return isEn ? "DSQ" : "EXP"
        default: return code   // fallback si la UCI introduce un código nuevo
        }
    }

    /// ¿El código `irm` marca a quien NO completó la prueba (abandono / no salida /
    /// fuera de control / descalificación)? Estos códigos sobre el rank 1 significan
    /// que ese puesto es espurio (el ganador real es el primer clasificado SIN irm).
    /// Se opone a códigos de "ruido" como LAP (doblada), que la UCI cuelga a veces de
    /// la propia ganadora — esos NO descalifican. Espejo de `isAbandonIrm` en uci-irm.js.
    static func isAbandonIrm(_ code: String?) -> Bool {
        guard let code, !code.isEmpty else { return false }
        return abandonCodes.contains(code)
    }

    private static let abandonCodes: Set<String> = ["DNF", "ABD", "DNS", "OTL", "DSQ"]

    // ── Tiempos / gaps (port de resultados.js L44–72) ──────────────────────

    /// "H:MM:SS" | "MM:SS" | "SS" → segundos (o nil si no parsea).
    static func timeToSeconds(_ txt: String?) -> Int? {
        guard let txt, !txt.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        var acc = 0
        for part in txt.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false) {
            guard let n = Int(part) else { return nil }
            acc = acc * 60 + n
        }
        return acc
    }

    /// segundos → gap con la convención de la prensa ciclista (PCS):
    ///   <1min → +SS"   ·   <1h → +M'SS"   ·   ≥1h → +H:MM:SS
    static func secondsToGap(_ sec: Int?) -> String? {
        guard let sec, sec >= 0 else { return nil }
        let h = sec / 3600
        let m = (sec % 3600) / 60
        let s = sec % 60
        let ss = String(format: "%02d", s)
        if h > 0 { return "+\(h):\(String(format: "%02d", m)):\(ss)" }
        if m > 0 { return "+\(m)'\(ss)\"" }
        return "+\(s)\""
    }

    /// Variante decimal: segundos ENTEROS siempre (regla de carretera: el tiempo
    /// oficial se trunca al segundo). El floor también mata el error flotante de
    /// derivar con decimales. Espejo del `Math.floor` de `secondsToGap` web.
    static func secondsToGap(_ sec: Double?) -> String? {
        guard let sec, sec >= 0 else { return nil }
        return secondsToGap(Int(sec.rounded(.down)))
    }

    /// Normaliza un gap al formato de prensa. La UCI publica los gaps con ':'
    /// como separador y SIN unidades ("+41"=41s, "+1:56"=1m56s, "+35:09"=35m09s,
    /// "+1:02:41"=1h02m41s) → re-emitir como +SS"/+M'SS"/+H:MM:SS. Si ya trae las
    /// marcas de prensa (' o ") se devuelve tal cual. Decimal-aware (como el
    /// timeToSeconds de la web): un gap decimal suelto se trunca ("+36.98"→+36").
    static func formatGap(_ gap: String?) -> String? {
        guard let gap, !gap.trimmingCharacters(in: .whitespaces).isEmpty else { return gap }
        let t = gap.trimmingCharacters(in: .whitespaces)
        if t.contains("'") || t.contains("\"") { return t }
        let raw = t.hasPrefix("+") ? String(t.dropFirst()) : t
        if let sec = tttToSeconds(raw) { return secondsToGap(sec) }
        return t
    }

    /// segundos → tiempo absoluto "H:MM:SS" (inverso de timeToSeconds; sin '+').
    static func secondsToTimeText(_ sec: Int?) -> String {
        guard let sec, sec >= 0 else { return "" }
        let h = sec / 3600
        let m = (sec % 3600) / 60
        let s = sec % 60
        return "\(h):\(String(format: "%02d", m)):\(String(format: "%02d", s))"
    }

    // ── CRI: presentación de tiempos truncados (port de resultados.js L83–114) ──

    /// Limpia un tiempo absoluto para PRESENTACIÓN: recorta el bloque de horas a
    /// cero ("0:06:36"/"00:30:36" → "6:36"/"30:36"), el cero a la izquierda del
    /// primer bloque y los DECIMALES enteros fuera ("1:04.869" → "1:04"): en
    /// carretera el tiempo oficial se cuenta en segundos enteros (truncado). La UCI
    /// publica los tiempos con formatos muy dispares (visto en las CRI del backfill).
    static func cleanTimeText(_ txt: String?) -> String {
        guard let txt else { return "" }
        var t = txt.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return "" }
        t = t.replacingOccurrences(of: "^0+:(?=\\d)", with: "", options: .regularExpression)   // fuera "0:"/"00:"
        t = t.replacingOccurrences(of: "^0(?=\\d:)", with: "", options: .regularExpression)    // "06:36" → "6:36"
        t = t.replacingOccurrences(of: "\\.\\d+$", with: "", options: .regularExpression)      // decimales fuera
        return t
    }

    /// segundos → tiempo absoluto ("6:36" · "45:53" · "1:05:05"): sin horas a cero
    /// y en segundos ENTEROS (truncado, regla de carretera).
    static func secondsToAbsText(_ sec: Double?) -> String {
        guard let sec, sec >= 0 else { return "" }
        let s0 = Int(sec.rounded(.down))
        let h = s0 / 3600
        let m = (s0 % 3600) / 60
        let s = s0 % 60
        let ss = String(format: "%02d", s)
        return h > 0 ? "\(h):\(String(format: "%02d", m)):\(ss)" : "\(m):\(ss)"
    }

    /// segundos (enteros) → tiempo absoluto en NOTACIÓN DE PRENSA: 20'52" (sub-hora;
    /// ≥1h sigue el mismo escalón H:MM:SS que secondsToGap). Para el tiempo del
    /// ganador de una CRI: "20:52.99" → 20'52" (truncado, segundos enteros).
    static func secondsToPressTime(_ sec: Double?) -> String {
        guard let sec, sec >= 0 else { return "" }
        let s0 = Int(sec.rounded(.down))
        let h = s0 / 3600
        let m = (s0 % 3600) / 60
        let s = s0 % 60
        if h > 0 { return "\(h):\(String(format: "%02d", m)):\(String(format: "%02d", s))" }
        return "\(m)'\(String(format: "%02d", s))\""
    }

    /// CRI: señal doble — RaceTypeCode 'ITT' de DataRide en la etapa, o primaryType
    /// 'itt' de la jornada (cubre las CRI de UN DÍA, que llegan con el bloque final
    /// SIN raceType — p. ej. campeonatos CRI: classKind 'gc' + stageNumber nil — Y
    /// las que DataRide etiqueta mal, caso Tour of the Gila: IRR en todas). Aplica a
    /// la clasificación de la etapa (o la final de un día); la GC del día y las
    /// acumuladas siguen la lógica normal. Presentación (espec Dani 2026-06-10):
    /// EXACTAMENTE como una etapa en línea — ganador con su tiempo OFICIAL (truncado
    /// a segundos enteros, notación de prensa 20'52") y el resto con su diferencia
    /// sobre los enteros (+1") y m.t. cuando el tiempo truncado coincide con el de
    /// arriba: 20:52.99/20:53.00/20:53.05 → 20'52" / +1" / m.t. Espejo de la web.
    static func isIttStage(
        classKind: String,
        isTeams: Bool,
        stageRaceType: String?,
        raceDayPrimaryType: String?,
        stageNumber: Int?,
        isOneDay: Bool
    ) -> Bool {
        let isTimeClass = !isPointsClass(classKind) && !isTeams
        return isTimeClass
            && (stageRaceType == "ITT" || raceDayPrimaryType == "itt")
            && (classKind == "stage" || (classKind == "gc" && stageNumber == nil && isOneDay))
    }

    /// Valor de puntos: `points` o, si nil, un entero en resultValue/timeText.
    static func points(of row: RaceUciResultRow) -> Int? {
        if let p = row.points { return p }
        if let rv = row.resultValue.flatMap({ Int($0.trimmingCharacters(in: .whitespaces)) }) { return rv }
        return row.timeText.flatMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    }

    static func isPointsClass(_ classKind: String) -> Bool {
        classKind == "points" || classKind == "kom"
    }

    // ── Etapa CANCELADA: aviso + generales de la etapa anterior ────────────

    /// Jornada mínima que necesita `applyCancelledStages` — evita depender del
    /// modelo completo de RaceDay en la lógica pura (y en los tests).
    struct StageDay {
        let id: String
        let stageNumber: Int?
        let dateKey: String?
        let isCancelledDay: Bool
        let isRestDay: Bool
        var neutralStartTimeUtc: String?

        init(id: String, stageNumber: Int?, dateKey: String?, isCancelledDay: Bool,
             isRestDay: Bool, neutralStartTimeUtc: String? = nil) {
            self.id = id
            self.stageNumber = stageNumber
            self.dateKey = dateKey
            self.isCancelledDay = isCancelledDay
            self.isRestDay = isRestDay
            self.neutralStartTimeUtc = neutralStartTimeUtc
        }
    }

    // ── Dobles sectores (etapa partida 3A/3B) ──────────────────────────────
    // Dos jornadas del mismo día comparten el MISMO entero stageNumber; se
    // distinguen por la hora de salida (A = la más temprana). Cada clasificación
    // lleva el raceDayId de SU sector → así 3A y 3B no se mezclan. Espejo de
    // `sectorSuffixMap`/`resultStageEntryKey` de js/services/races.js.

    /// raceDayId → sufijo ('A'/'B'…) y conjunto de stageNumber que son doble sector.
    static func sectorSuffixMap(_ days: [StageDay]) -> (suffixByDayId: [String: String], sectoredNums: Set<Int>) {
        var groups: [String: [StageDay]] = [:]
        for d in days {
            guard let sn = d.stageNumber, !d.isRestDay else { continue }
            groups["\(d.dateKey ?? "")|\(sn)", default: []].append(d)
        }
        let suffixes = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        var suffixByDayId: [String: String] = [:]
        var sectoredNums: Set<Int> = []
        for grp in groups.values where grp.count >= 2 {
            let sorted = grp.sorted {
                ($0.neutralStartTimeUtc ?? "\u{FFFF}", $0.id) < ($1.neutralStartTimeUtc ?? "\u{FFFF}", $1.id)
            }
            for (i, d) in sorted.enumerated() {
                suffixByDayId[d.id] = i < suffixes.count ? String(suffixes[i]) : ""
            }
            if let sn = grp.first?.stageNumber { sectoredNums.insert(sn) }
        }
        return (suffixByDayId, sectoredNums)
    }

    /// Clave de agrupación sector-consciente: "final" | "3" | "3A".
    static func resultStageEntryKey(_ stageNumber: Int?, _ raceDayId: String?,
                                    _ suffixByDayId: [String: String], _ sectoredNums: Set<Int>) -> String {
        guard let n = stageNumber else { return "final" }
        let sfx = (sectoredNums.contains(n) && raceDayId != nil) ? (suffixByDayId[raceDayId!] ?? "") : ""
        return "\(n)\(sfx)"
    }

    /// Descompone una clave de entrada en (stageNumber, sufijo).
    static func parseResultStageKey(_ key: String) -> (stageNumber: Int?, suffix: String) {
        if key == "final" { return (nil, "") }
        var digits = ""
        var letters = ""
        for ch in key {
            if ch.isNumber { digits.append(ch) } else { letters.append(ch) }
        }
        guard let n = Int(digits) else { return (nil, "") }
        return (n, letters)
    }

    /// Una etapa CANCELADA no se corrió: sus propias clasificaciones (si el cron
    /// llegó a volcar algo antes de la cancelación) NO se muestran, y su pantalla
    /// se sintetiza — marcador de "Etapa" (que el render pinta como aviso de
    /// cancelación) + las generales de la ETAPA ANTERIOR, porque la clasificación
    /// no se movió. Sin etapa anterior con datos → solo el marcador.
    ///
    /// 100% PRESENTACIONAL: las mismas filas (mismo id de clasificación), no se
    /// vuelca ni se duplica nada. Espejo de `js/resultados.js` y de Android.
    ///
    /// La "etapa anterior" es la anterior EN ORDEN CRONOLÓGICO (dateKey, luego
    /// hora de salida) saltando descansos y otras canceladas. Eso cubre solo la
    /// regla de los dobles sectores (la anterior de un sector B es su A; la del
    /// día siguiente a un doble sector es el B): `stageNumber` es el MISMO entero
    /// en A y B, así que solo el orden cronológico los distingue.
    static func applyCancelledStages(
        _ stages: [RaceUciStage],
        days: [StageDay],
        raceId: String = ""
    ) -> [RaceUciStage] {
        let cancelled = days.filter { $0.isCancelledDay && !$0.isRestDay && $0.stageNumber != nil }
        guard !cancelled.isEmpty else { return stages }
        // Orden canónico: cronológico (dateKey, luego hora de salida). En un doble
        // sector esto ya distingue A de B aunque compartan stageNumber.
        let raced = days.filter { !$0.isRestDay }.sorted {
            ($0.dateKey ?? "", $0.neutralStartTimeUtc ?? "") < ($1.dateKey ?? "", $1.neutralStartTimeUtc ?? "")
        }
        let (suffixByDayId, sectoredNums) = sectorSuffixMap(days)
        func keyOf(_ st: RaceUciStage) -> String {
            resultStageEntryKey(st.stageNumber, st.raceDayId, suffixByDayId, sectoredNums)
        }
        let cancelledDayIds = Set(cancelled.map { $0.id })
        // stageNumbers de canceladas NO sectorizadas (para el volcado sin raceDayId).
        let cancelledPlainNums = Set(cancelled.filter { $0.stageNumber.map { !sectoredNums.contains($0) } ?? false }
            .compactMap { $0.stageNumber })
        // La cancelada NO aporta sus propias clasificaciones: se descartan por
        // raceDayId (el SECTOR concreto) y, si el volcado no lo tiene, por
        // stageNumber SOLO cuando ese número no es doble sector.
        let kept = stages.filter { st in
            if let rd = st.raceDayId, cancelledDayIds.contains(rd) { return false }
            if st.raceDayId == nil, let sn = st.stageNumber, cancelledPlainNums.contains(sn) { return false }
            return true
        }
        var synthesized: [RaceUciStage] = []
        for day in cancelled {
            guard let num = day.stageNumber else { continue }
            // Marcador de la pestaña "Etapa" (sin filas: lo pinta el aviso). id por
            // raceDayId → único aunque dos sectores del mismo número se cancelen.
            synthesized.append(RaceUciStage(
                id: "cancelled-\(day.id)",
                raceId: stages.first?.raceId ?? raceId,
                raceDayId: day.id,
                classKind: "stage",
                stageNumber: num,
                keepForWeb: true,
                isCancelledStage: true
            ))
            // Etapa/sector anterior EN CARRERA (la del B es su A), en orden cronológico.
            guard let idx = raced.firstIndex(where: { $0.id == day.id }) else { continue }
            guard let prevDay = raced[..<idx].last(where: { !$0.isCancelledDay && $0.stageNumber != nil }) else { continue }
            let prevKey = resultStageEntryKey(prevDay.stageNumber, prevDay.id, suffixByDayId, sectoredNums)
            let prevSfx = (prevDay.stageNumber.map { sectoredNums.contains($0) } ?? false)
                ? (suffixByDayId[prevDay.id] ?? "") : ""
            // Las copias se re-atribuyen al SECTOR cancelado (stageNumber + raceDayId
            // de la cancelada, criterio de agrupación) pero CONSERVAN su `id`: las
            // filas se piden por `id` → sigue leyendo las de la etapa anterior.
            for st in kept where keyOf(st) == prevKey && st.classKind != "stage" {
                synthesized.append(RaceUciStage(
                    id: st.id,
                    raceId: st.raceId,
                    raceDayId: day.id,
                    classKind: st.classKind,
                    eventName: st.eventName,
                    isTeamEvent: st.isTeamEvent,
                    stageNumber: num,
                    isFinalClassification: st.isFinalClassification,
                    keepForWeb: st.keepForWeb,
                    rowCount: st.rowCount,
                    raceType: st.raceType,
                    stageDate: st.stageDate,
                    winnerName: st.winnerName,
                    carriedFromStage: prevDay.stageNumber,
                    carriedFromSuffix: prevSfx
                ))
            }
        }
        return kept + synthesized
    }

    // ── Detección de CRE (crono por equipos) — port de L550–565 ────────────

    /// La UCI publica la etapa de CRE como "Stage Classification" listando TODOS
    /// los corredores agrupados por equipo. Hay que colapsarla a una fila por
    /// equipo. No nos fiamos de `isTeamEvent` (la UCI lo marca true en TODAS las
    /// clasificaciones de una etapa CRE). Señal = classKind='stage' (o 'gc' final
    /// de un día — caso CRE de carrera de un día, variante C) + jornada CRE en
    /// nuestro catálogo (primaryType='ttt'), corroborado por la estructura
    /// (ranks compartidos [A] o muchos rank=nil entre clasificados [B]).
    static func isTttStage(
        rows: [RaceUciResultRow],
        classKind: String,
        isTeams: Bool,
        raceDayPrimaryType: String?,
        stageNumber: Int? = nil,
        isOneDay: Bool = false,
        stageRaceType: String? = nil
    ) -> Bool {
        let isEligibleKind = classKind == "stage" ||
            (classKind == "gc" && stageNumber == nil && isOneDay)
        if isTeams || !isEligibleKind { return false }
        // Una jornada CRI (primaryType='itt') NUNCA es una crono por equipos: aunque
        // tenga ex aequo reales (varios corredores con el mismo tiempo al cronómetro →
        // mismo puesto), no se colapsa por equipos. Sin este guard, ≥3 empates en una
        // CRI disparan la rama estructural `sharedRanks >= 3` y la pintan como CRE.
        if raceDayPrimaryType == "itt" || stageRaceType == "ITT" { return false }
        let classified = rows.filter { ($0.irm ?? "").isEmpty }
        // [A] nº de puestos con ≥2 corredores.
        var rankCounts: [Int: Int] = [:]
        for r in classified { if let rank = r.rank { rankCounts[rank, default: 0] += 1 } }
        let sharedRanks = rankCounts.values.filter { $0 >= 2 }.count
        // [B] compañeros sin rank.
        let nullRanks = classified.filter { $0.rank == nil }.count
        let structural = sharedRanks >= 2 || nullRanks >= 2
        let dayIsTtt = raceDayPrimaryType == "ttt"
        // Con el tipo de jornada curado basta la estructura; sin él, exigir una
        // estructura MUY marcada para no colapsar una crono individual con empates.
        return structural && (dayIsTtt || sharedRanks >= 3 || nullRanks >= 6)
    }

    // ── Colapso de CRE a una fila por equipo — port de renderTttStage L400 ──

    struct TttRiderRow: Hashable {
        let name: String
        let countryCode: String
        let timeText: String?
        let uciPoints: Double?
        let irm: String?
    }

    struct TttTeamRow {
        let rank: Int?
        let teamName: String
        let team: Team?
        let teamTimeText: String?
        /// Puntos UCI de la fila líder del equipo; nil hasta que lleguen datos.
        let uciPoints: Double?
        /// Tiempo del equipo en segundos (centésimas truncadas al comparar).
        let teamSecs: Double?
        let riders: [TttRiderRow]
    }

    /// "M:SS.cc" | "H:MM:SS.cc" | "SS.cc" → segundos float (conserva centésimas).
    static func tttToSeconds(_ txt: String?) -> Double? {
        guard let txt, !txt.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        var acc = 0.0
        for part in txt.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false) {
            guard let n = Double(part) else { return nil }
            acc = acc * 60 + n
        }
        return acc
    }

    /// Gap entre dos tiempos de equipo, TRUNCANDO a segundos enteros antes de
    /// restar (la clasificación oficial cuenta segundos enteros).
    static func tttGapBetween(teamSecs: Double?, winnerSecs: Double?) -> String? {
        guard let teamSecs, let winnerSecs else { return nil }
        return secondsToGap(Int(teamSecs) - Int(winnerSecs))
    }

    /// Agrupa las filas de una CRE por equipo (cubre las dos variantes UCI):
    ///   A) todos los corredores del equipo comparten el rank del equipo;
    ///   B) solo el líder trae rank, los compañeros van con rank=nil detrás.
    /// Recorre EN ORDEN (sortOrder) y abre equipo nuevo cuando el rank CAMBIA.
    /// El equipo de cada fila se resuelve por dorsal (lo más fiable); si no hay
    /// startlist (byDorsal vacío), se cae al arrastre por rank.
    static func collapseTtt(
        rows: [RaceUciResultRow],
        byDorsal: [Int: ResolvedRider],
        isEn: Bool,
        byRider: [String: ResolvedRider] = [:],
        /// Override manual de equipo (mig. 112): el teamId del líder define el
        /// equipo de la fila colapsada, ganando a la resolución por dorsal.
        byTeamOverride: [String: Team] = [:]
    ) -> [TttTeamRow] {
        final class Group {
            var lead: RaceUciResultRow?
            var riders: [RaceUciResultRow] = []
        }
        var order: [String] = []
        var byKey: [String: Group] = [:]
        var prevRank: Int?
        var fallbackKey = 0
        var firstSeen = true

        for r in rows {
            let fromSl = r.dorsalInt.flatMap { byDorsal[$0] }
            if r.rank != nil && (firstSeen || r.rank != prevRank) { fallbackKey += 1 }
            firstSeen = false
            let teamName = fromSl?.teamName ?? ""
            let key = teamName.isEmpty ? "__grp\(fallbackKey)" : teamName
            let g: Group
            if let existing = byKey[key] {
                g = existing
            } else {
                g = Group()
                byKey[key] = g
                order.append(key)
            }
            if g.lead == nil && r.rank != nil { g.lead = r }
            g.riders.append(r)
            if let rank = r.rank { prevRank = rank }
        }

        return order.compactMap { key -> TttTeamRow? in
            guard let g = byKey[key], let lead = g.lead ?? g.riders.first else { return nil }
            let fromSl = lead.dorsalInt.flatMap { byDorsal[$0] }
            let overrideTeam = lead.teamId.flatMap { byTeamOverride[$0] }
            let slTeamName = fromSl?.teamName ?? ""
            return TttTeamRow(
                rank: g.lead?.rank,
                teamName: overrideTeam?.name
                    ?? (slTeamName.isEmpty ? (lead.riderDisplay ?? "") : slTeamName),
                team: overrideTeam ?? fromSl?.team,
                teamTimeText: g.lead?.timeText,
                uciPoints: g.lead?.uciPoints,
                teamSecs: g.lead.flatMap { tttToSeconds($0.timeText) },
                riders: g.riders.map { r in
                    let fs = r.dorsalInt.flatMap { byDorsal[$0] }
                    // Sin casar por dorsal → ficha por globalRiderId (bandera + nombre
                    // + enlace), igual que la web en las sub-filas de la CRE.
                    let fr = fs == nil ? r.globalRiderId.flatMap { byRider[$0] } : nil
                    let rider = fs ?? fr
                    let fsName = rider?.name ?? ""
                    return TttRiderRow(
                        name: fsName.isEmpty ? (r.riderDisplay ?? "") : fsName,
                        countryCode: rider?.countryCode ?? "",
                        timeText: r.timeText,
                        uciPoints: r.uciPoints,
                        irm: r.irm
                    )
                }
            )
        }
    }

    /// Tiempo del equipo ganador (rank 1) para calcular gaps de CRE.
    static func tttWinnerSecs(_ teamRows: [TttTeamRow]) -> Double? {
        teamRows.first { $0.rank == 1 && $0.teamSecs != nil }?.teamSecs
    }

    // ── Matching de equipos por nombre (espejo de js/shared.js) ────────────

    /// Stopwords de nombre de equipo (las EFECTIVAS de `TEAM_STOPWORDS` en
    /// shared.js: los tokens llegan ya en minúsculas y sin acentos, así que las
    /// entradas acentuadas del set JS — 'féminin'/'féminine' — y '&' son inertes
    /// y no se portan).
    private static let teamStopwords: Set<String> = [
        "pro", "procycling", "cycling", "team", "teams", "squad", "uci", "worldteam",
        "wt", "women", "womens", "feminin", "femenino",
        "continental", "development", "presented", "by", "the", "de", "la", "el", "of", "and",
    ]

    /// Normaliza un nombre de equipo para matching: minúsculas, sin acentos,
    /// solo letras/números, sin stopwords comunes. Port de `normalizeTeamName`.
    static func normalizeTeamName(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "" }
        // NFD + strip de marcas combinantes (U+0300–U+036F), como la web.
        let decomposed = s.lowercased().decomposedStringWithCanonicalMapping
        let stripped = String(String.UnicodeScalarView(
            decomposed.unicodeScalars.filter { !(0x0300...0x036F).contains($0.value) }
        ))
        let base = stripped
            .replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        guard !base.isEmpty else { return "" }
        return base.split(separator: " ")
            .map(String.init)
            .filter { !$0.isEmpty && !teamStopwords.contains($0) }
            .joined(separator: " ")
    }

    /// Busca en `teams` el equipo que corresponde al nombre crudo `teamName`
    /// (p. ej. "TEAM VISMA | LEASE A BIKE" de Tissot/UCI). Estrategia: coincidencia
    /// exacta normalizada (name + nameAliases) → subcadena. Port de `findMatchingTeam`.
    static func findMatchingTeam(_ teamName: String?, teams: [Team]) -> Team? {
        guard let teamName, !teamName.isEmpty, !teams.isEmpty else { return nil }
        let target = normalizeTeamName(teamName)
        guard !target.isEmpty else { return nil }
        func namesOf(_ t: Team) -> [String] {
            ([t.name] + (t.nameAliases ?? "").components(separatedBy: "\n"))
                .map { normalizeTeamName($0) }
                .filter { !$0.isEmpty }
        }
        for t in teams where namesOf(t).contains(target) {
            return t
        }
        // Fallback: contención (al menos 4 caracteres para evitar ruido).
        if target.count >= 4 {
            for t in teams {
                let names = namesOf(t).filter { $0.count >= 4 }
                if names.contains(where: { $0 == target || $0.contains(target) || target.contains($0) }) {
                    return t
                }
            }
        }
        return nil
    }

    // ── Filas individuales (etapa/general/jóvenes/puntos/montaña) ──────────

    /// Tipo del valor de la celda de resultado.
    enum ValueKind {
        case winnerTime, gap, sameTime, points, raw, empty
    }

    /// Una fila individual ya resuelta para la UI. El gap "crudo" (rowGap) se
    /// usa para recalcular m.t. al filtrar por equipo.
    struct ResultRowVM {
        let rank: Int?
        /// Texto a mostrar en la columna # cuando no hay rank (IRM o "–").
        let rankBadge: String?
        let isOut: Bool            // tiene IRM de abandono (DNF/DNS/OTL/DSQ)
        let riderName: String
        let countryCode: String
        let teamName: String
        let team: Team?
        /// Columna opcional entre identidad y resultado; nil no reserva espacio.
        let uciPoints: Double?
        let valueKind: ValueKind
        /// Valor a pintar (tiempo del ganador, gap, puntos, o crudo).
        let valueText: String
        /// Gap real de la fila (para el m.t. dinámico). Vacío si no aplica.
        let rowGap: String
    }

    /// Construye las filas individuales de una clasificación NO-CRE, resolviendo
    /// el corredor por dorsal y el gap efectivo (port de la lógica de
    /// `renderClassification` en resultados.js L568–724, sin el filtro por equipo).
    ///
    /// La UCI publica los tiempos de forma inconsistente; se normalizan dos casos
    /// (solo en clasificaciones por tiempo, y solo si NO viene gapText):
    ///   A) TIEMPOS ABSOLUTOS → gap = tiempo − ganador.
    ///   B) GAPS DISFRAZADOS: el rank 1 trae su tiempo total, el resto el gap en
    ///      HH:MM:SS sin '+'. Señal: algún rank>1 con timeText < ganador.
    static func buildIndividualRows(
        rows: [RaceUciResultRow],
        classKind: String,
        isTeams: Bool,
        byDorsal: [Int: ResolvedRider],
        isEn: Bool,
        raceTeams: [Team] = [],
        /// CRI (ver `isIttStage`): el ganador sale en notación de prensa truncada
        /// (20'52"); el resto fluye por el pipeline normal de gaps/m.t.
        isItt: Bool = false,
        /// Fallback por globalRiderId para las filas que NO casan por dorsal
        /// (carreras SIN startlist: campeonatos nacionales y demás volcados
        /// in-house sin inscritos curados) → bandera + equipo actual + ficha,
        /// igual que `byRider` en la web. Vacío = comportamiento previo.
        byRider: [String: ResolvedRider] = [:],
        /// Override MANUAL de equipo (mig. 112): teamId → equipo canónico. Cuando
        /// la fila trae teamId, GANA a la resolución por dorsal/globalRiderId.
        byTeamOverride: [String: Team] = [:]
    ) -> [ResultRowVM] {
        let isPts = isPointsClass(classKind)
        let isTimeClass = !isPts && !isTeams

        // El rank 1 puede traer un `irm`. Hay que distinguir dos cosas opuestas:
        //   · RUIDO (p. ej. irm='LAP' = doblada): la corredora SÍ ganó; la UCI cuelga
        //     el código por error. Caso real: Dwars door de Westhoek 2026 — la ganadora
        //     llegó con LAP y SIN timeText. Debe encabezar como ganadora.
        //   · ABANDONO real (DNF/DNS/OTL/DSQ/ABD): ese rank 1 es espurio (no compitió);
        //     el ganador real es el primer clasificado SIN irm. Caso real: Vuelta a
        //     Colombia Femenina — rank 1 con DNS, el tiempo de cabeza es el del rank 2.
        // → `winnerIndex` solo cuenta como ganadora si su irm NO es de abandono.
        // (Swift no tiene identidad de referencia en structs → se compara por índice.)
        // ¿Esta fila marca "mismo tiempo que la ganadora"? Mira el gap publicado y,
        // si no lo hay, el tiempo absoluto (cuando los gaps se derivan). Se usa para
        // delimitar el bloque de cabeza; el gap final se formatea más abajo.
        func isZeroGapRow(_ r: RaceUciResultRow, winnerSec: Double?, deriveGaps: Bool) -> Bool {
            let raw = (r.gapText ?? "").trimmingCharacters(in: .whitespaces)
            if !raw.isEmpty {
                let v = raw.hasPrefix("+") ? String(raw.dropFirst()) : raw
                return (tttToSeconds(v) ?? -1) == 0
            }
            guard deriveGaps, let ws = winnerSec, let sec = tttToSeconds(r.timeText) else { return false }
            return sec.rounded(.down) == ws.rounded(.down)
        }
        let rank1Index = rows.firstIndex { $0.rank == 1 }
        let winnerIndex: Int? = rank1Index.flatMap { isAbandonIrm(rows[$0].irm) ? nil : $0 }
        // Clasificado a efectos de TIEMPO: el ganador (ruido aparte) o cualquier fila
        // con puesto sin irm. Un rank 1 con abandono NO cuenta.
        func isRankedFinisher(_ i: Int) -> Bool {
            (winnerIndex != nil && i == winnerIndex) || (rows[i].rank != nil && (rows[i].irm ?? "").isEmpty)
        }
        // Si el ganador no trae timeText (el LAP de arriba), el tiempo de cabeza es el
        // MENOR de los clasificados: el grueso del grupo que cruzó con él marca 00:00:00
        // → winnerSec=0 y los gaps se derivan bien. En Colombia, ese mínimo es el rank 2.
        // Tiempos en Double vía tttToSeconds (espejo del timeToSeconds de la web,
        // donde Number() conserva decimales): las CRI cortas publican décimas/
        // centésimas ("20:52.99") que el parser entero no entiende. El gap oficial
        // se calcula sobre los enteros TRUNCANDO cada tiempo antes de restar.
        let minFinisherSec: Double? = isTimeClass
            ? rows.indices.filter { isRankedFinisher($0) }.compactMap { tttToSeconds(rows[$0].timeText) }.min()
            : nil

        let winnerSec: Double? = isTimeClass
            ? (tttToSeconds(winnerIndex.map { rows[$0].timeText } ?? nil) ?? minFinisherSec)
            : nil
        let allTimed = isTimeClass && winnerSec != nil
            && !rows.contains { !($0.gapText ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
            && rows.indices
                .filter { rows[$0].rank != nil && $0 != winnerIndex && (rows[$0].irm ?? "").isEmpty }
                .allSatisfy { tttToSeconds(rows[$0].timeText) != nil }
        let gapsDisguised = allTimed && rows.indices.contains {
            rows[$0].rank != nil && $0 != winnerIndex && (rows[$0].irm ?? "").isEmpty
                && (tttToSeconds(rows[$0].timeText) ?? .greatestFiniteMagnitude) < winnerSec!
        }
        let deriveGaps = allTimed && !gapsDisguised

        // Último índice del BLOQUE DE CABEZA: las filas que llegaron con la ganadora,
        // contiguas desde el rank 1. Una fila con gap 0 FUERA de ese bloque no cruzó
        // con el grupo: es una REASIGNACIÓN DE COMISARIOS (incidente en los últimos
        // 3 km → se le acredita el tiempo del grupo con el que rodaba, pero conserva
        // su puesto por orden de llegada; UCI 2.6.027). Caso real: Baloise Ladies Tour
        // 2026 et.5, Manly 97ª con el tiempo de la ganadora.
        // Esas filas NUNCA se colapsan a "m.t.": el m.t. es una abreviatura que sólo
        // significa algo dentro de un grupo contiguo en meta, y aquí mentiría sobre
        // cómo terminó. Se pinta su gap explícito (+0" incluido).
        let headBlockEnd: Int = {
            guard isTimeClass else { return -1 }
            // Ancla = el primer CLASIFICADO real. Normalmente es winnerIndex; si el rank 1
            // es un abandono espurio (DNS), el cabeza es el primer clasificado sin irm,
            // que marca el tiempo de referencia (mismo criterio que minFinisherSec).
            guard let w = rows.indices.first(where: { isRankedFinisher($0) }) else { return -1 }
            var last = w
            var i = w + 1
            while i < rows.count {
                // Los abandonos van al final y no rompen el bloque si aún no empezaron.
                guard rows[i].rank != nil, (rows[i].irm ?? "").isEmpty else { break }
                if !isZeroGapRow(rows[i], winnerSec: winnerSec, deriveGaps: deriveGaps) { break }
                last = i
                i += 1
            }
            return last
        }()

        return rows.indices.map { i in
            let r = rows[i]
            let fromSl = r.dorsalInt.flatMap { byDorsal[$0] }
            // Sin casar por dorsal (carrera sin startlist): caer al enriquecido por
            // globalRiderId (bandera + equipo actual + ficha de riders_*). nil si la
            // fila no tiene ficha (corredor amateur fuera del catálogo).
            let fromRider = fromSl == nil ? r.globalRiderId.flatMap { byRider[$0] } : nil
            let resolved = fromSl ?? fromRider
            // Pestaña Equipos: la fila ES un equipo (riderDisplay = nombre crudo de
            // la fuente, sin dorsal) → se casa por NOMBRE contra los equipos
            // canónicos de la startlist para chapa + nombre del catálogo (espejo
            // de la web). Sin casar → el crudo de la fuente, sin chapa.
            let matchedTeam = isTeams ? findMatchingTeam(r.riderDisplay, teams: raceTeams) : nil
            // Override manual de equipo (panel): gana a dorsal/globalRiderId. No
            // aplica en la pestaña Equipos (la fila ES un equipo, casado por nombre).
            let overrideTeam = isTeams ? nil : r.teamId.flatMap { byTeamOverride[$0] }
            // Nombre: startlist (curado) → ficha por globalRiderId (orden natural) →
            // riderDisplay (fallback de la fuente). La ficha gana al riderDisplay para
            // que las CN sin startlist no muestren el "APELLIDO Nombre" crudo de la UCI.
            let slName = resolved?.name ?? ""
            let riderName = matchedTeam?.name
                ?? (slName.isEmpty ? (r.riderDisplay ?? "") : slName)
            let teamName = overrideTeam?.name ?? (resolved?.teamName ?? "")
            let cc = resolved?.countryCode ?? ""

            let isWinner = winnerIndex != nil && i == winnerIndex
            // Un rank 1 con abandono real es espurio: a efectos de render se trata
            // como cualquier abandono (etiqueta en #, celda vacía), NO como puesto.
            let isRealAbandon = isAbandonIrm(r.irm)

            // Gap efectivo: el de la UCI, o el normalizado. El ganador (winnerIndex)
            // nunca recibe gap aquí (ni siquiera con un irm de ruido).
            var effGap = r.gapText
            // Gap publicado CON décimas ("+36.98", Tour of the Gila): el gap oficial
            // en segundos enteros se deriva de los TIEMPOS truncados — floor(ganador
            // + gap) − floor(ganador) —, NO truncando el gap (20:52.99 y 20:53.00 son
            // +1", no +0"). Con gaps enteros el resultado es idéntico → no se toca.
            if let g = effGap, !g.trimmingCharacters(in: .whitespaces).isEmpty,
               let winnerSec, r.rank != nil, !isWinner, (r.irm ?? "").isEmpty {
                var raw = g.trimmingCharacters(in: .whitespaces)
                if raw.hasPrefix("+") { raw = String(raw.dropFirst()) }
                if let gs = tttToSeconds(raw), gs.truncatingRemainder(dividingBy: 1) != 0 {
                    effGap = secondsToGap((winnerSec + gs).rounded(.down) - winnerSec.rounded(.down))
                }
            }
            if (effGap ?? "").trimmingCharacters(in: .whitespaces).isEmpty,
               r.rank != nil, !isWinner, (r.irm ?? "").isEmpty,
               let sec = tttToSeconds(r.timeText) {
                // El gap oficial se calcula sobre tiempos TRUNCADOS a segundos
                // enteros, truncando CADA tiempo antes de restar (cronos con
                // décimas: 20:52.99 y 20:53.00 → 20:52 y 20:53 → +1", no +0").
                // deriveGaps ⇒ winnerSec != nil (allTimed lo garantiza).
                if deriveGaps {
                    effGap = secondsToGap(sec.rounded(.down) - (winnerSec ?? 0).rounded(.down))
                } else if gapsDisguised {
                    effGap = secondsToGap(sec)
                }
            }
            effGap = formatGap(effGap)

            var rowGap = ""
            let kind: ValueKind
            let value: String
            if !(r.irm ?? "").isEmpty && !isWinner {
                // Abandono real (o cualquier irm que NO sea el ganador) → celda vacía.
                kind = .empty; value = ""
            } else if isPts {
                let pts = points(of: r)
                kind = .points; value = pts.map(String.init) ?? (r.resultValue ?? "")
            } else if isWinner {
                // Tiempo de la ganadora: el suyo si lo trae; si la UCI lo omitió
                // (caso LAP), el tiempo de cabeza derivado SOLO si es significativo
                // (>0). En una carrera de un día sin tiempo absoluto el cabeza es
                // 00:00:00 → no inventamos un "0" ni rotulamos nada: celda vacía.
                // cleanTimeText: la UCI publica "00:30:36"/"0:06:36" → "30:36"/"6:36".
                // CRI: el tiempo del ganador va en notación de prensa y TRUNCADO a
                // segundos enteros ("20:52.99" → 20'52"); el resto de la fila fluye
                // por el MISMO pipeline de gaps/m.t. que una etapa en línea.
                let winIttSec = isItt ? (tttToSeconds(r.timeText) ?? winnerSec ?? -1).rounded(.down) : -1
                var wt: String
                if isItt && winIttSec >= 0 {
                    wt = secondsToPressTime(winIttSec)
                } else {
                    wt = cleanTimeText(r.timeText)
                    if wt.isEmpty {
                        wt = winnerSec.flatMap { $0 > 0 ? secondsToAbsText($0) : nil } ?? ""
                    }
                }
                if wt.isEmpty { kind = .empty; value = "" } else { kind = .winnerTime; value = wt }
            } else if let g = effGap, !g.isEmpty, g == "+0\"", i <= headBlockEnd {
                kind = .sameTime; value = ""
            } else if let g = effGap, !g.isEmpty {
                rowGap = g; kind = .gap; value = g
            } else {
                kind = .raw; value = r.timeText ?? (r.resultValue ?? "")
            }

            // Columna #: un abandono real se rotula con su etiqueta corta AUNQUE la UCI
            // le haya dejado un rank (rank 1 con DNS → "NS", no "1"). Un rank con irm de
            // ruido (LAP en el ganador) conserva su número. Sin rank ni irm → guion.
            let rankBadge: String?
            if isRealAbandon {
                rankBadge = irmLabel(r.irm, isEn: isEn)
            } else if r.rank != nil {
                rankBadge = nil
            } else if !(r.irm ?? "").isEmpty {
                rankBadge = irmLabel(r.irm, isEn: isEn)
            } else {
                rankBadge = r.rankText ?? "–"
            }
            // El número de puesto se anula para un abandono real (mostramos su etiqueta).
            let rankNum = isRealAbandon ? nil : r.rank

            return ResultRowVM(
                rank: rankNum,
                rankBadge: rankBadge,
                isOut: isRealAbandon,
                riderName: riderName,
                countryCode: cc,
                teamName: teamName,
                team: isTeams ? matchedTeam : (overrideTeam ?? resolved?.team),
                uciPoints: r.uciPoints,
                valueKind: kind,
                valueText: value,
                rowGap: rowGap
            )
        }
    }

    /// Equipos presentes en una clasificación individual (para el filtro),
    /// ordenados alfabéticamente (case-insensitive), como la web. Cae a `byRider`
    /// (globalRiderId) cuando la fila no casa por dorsal (CN sin startlist).
    static func teamsInClass(
        rows: [RaceUciResultRow],
        byDorsal: [Int: ResolvedRider],
        byRider: [String: ResolvedRider] = [:],
        byTeamOverride: [String: Team] = [:]
    ) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for r in rows {
            let override = r.teamId.flatMap { byTeamOverride[$0]?.name }
            let fromSl = r.dorsalInt.flatMap { byDorsal[$0] }
            let fromRider = fromSl == nil ? r.globalRiderId.flatMap { byRider[$0] } : nil
            guard let teamName = override ?? (fromSl ?? fromRider)?.teamName, !teamName.isEmpty else { continue }
            if seen.insert(teamName).inserted { out.append(teamName) }
        }
        return out.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }
}
