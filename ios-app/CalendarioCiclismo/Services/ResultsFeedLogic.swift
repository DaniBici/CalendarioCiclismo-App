import Foundation

/// Lógica pura del feed "Últimos resultados" (pestaña Resultados, apps 3.1).
/// Espejo 1:1 de `js/resultados-feed.js` (`fetchEntries` + `cmpEntries`) y de
/// `util/ResultsFeedLogic.kt` (Android). Sin dependencias de SwiftUI ni de red:
/// todo es testeable con XCTest (ver `ResultsFeedLogicTests`).
///
/// Reglas de las filas (espec Dani 2026-06-11):
///  · Etapas de vueltas y pruebas de un día (estas SIN etiqueta) + las
///    GENERALES FINALES de las vueltas, pegadas a su carrera y POR DELANTE
///    de la etapa correspondiente.
///  · Dentro de cada día, el MISMO orden canónico que las cards de Hoy
///    (grandes vueltas → nivel pro → género → categoría UCI → hora → nombre).
///  · stageDate puede venir NULL (volcados PDF, migración 090) → la fecha se
///    resuelve por raceDayId→race_days.dateKey o por las fechas de la carrera.
///  · Sin resultados in-house pero jornada concluida y FC/PCS → fila con los
///    enlaces externos; se convierte sola cuando el cron vuelque.

/// Tipo de entrada del feed: clasificación in-house o fallback FC/PCS.
enum FeedEntryKind: String {
    case inhouse
    case ext
}

/// Una fila del feed. Nombres espejo de la versión Android (`FeedEntry` en
/// `util/ResultsFeedLogic.kt`): kind/isGcFinal/date/race/stageNumber/rd/
/// stageRefId/winner (+ subOrder/sortTime, internos de la ordenación).
struct FeedEntry: Identifiable, Hashable {
    /// Clave de deduplicación (espejo de `_k` en la web). También sirve de id
    /// estable para SwiftUI (única en todo el feed por construcción).
    let key: String
    let kind: FeedEntryKind
    /// True solo en la entrada propia de la general final de una vuelta
    /// (las pruebas de un día NO la llevan, como en la web).
    var isGcFinal: Bool = false
    /// Fecha YYYY-MM-DD ya resuelta (stageDate → jornada → fechas de carrera).
    let date: String
    let race: Race
    /// nil = general final / prueba de un día (sin etiqueta de etapa).
    let stageNumber: Int?
    /// 0 = general final (POR DELANTE de la etapa de su carrera), 1 = resto.
    let subOrder: Int
    /// Jornada asociada (recorrido/km/tipos/hora). nil en las generales finales.
    let rd: RaceDay?
    /// id de `race_uci_stages` — para resolver el ganador canónico (capa de datos).
    var stageRefId: String?
    /// Ganador (crudo de la fuente; la capa de datos lo refina a nombre canónico).
    var winner: String = ""
    /// Hora de salida POR CARRERA-DÍA, precomputada (espejo de `_sortTime`).
    /// ⚠️ Sin ella el comparador no es transitivo: una general (sin rd)
    /// compararía 999999 contra la hora real de otras carreras y rompería la
    /// adyacencia con su etapa (vueltas que acaban el mismo día se entrelazan).
    var sortTime: Double = 999999
    /// Bookkeeping interno de pruebas de un día: ¿la entrada ya viene de la
    /// 'gc' FINAL? (espejo de `_finalGc`; permite que la fila `stage` previa
    /// sea sustituida por la final cuando llega).
    var oneDayFinalGc: Bool = false

    var id: String { key }
}

enum ResultsFeedLogic {

    /// Tamaño de la ventana del feed (días) — espejo de `WINDOW_DAYS`.
    static let windowDays = 14
    /// Tope de "Cargar más" — espejo de `SEASON_START`.
    static let seasonStart = "2026-01-01"

    // MARK: - Helpers de fechas de la ventana

    /// dateKey desplazado n días (espejo de `addDays` en la web).
    static func addDays(_ dateKey: String, _ n: Int) -> String {
        DateFormatting.dayOffset(from: dateKey, by: n) ?? dateKey
    }

    /// Inicio de la ventana inicial: hoy − (windowDays − 1), nunca antes del
    /// arranque de temporada.
    static func initialFromKey(todayKey: String = DateFormatting.todayKey()) -> String {
        let from = addDays(todayKey, -(windowDays - 1))
        return from < seasonStart ? seasonStart : from
    }

    /// Siguiente inicio de ventana al pulsar "Cargar más" (clava en seasonStart).
    static func extendedFromKey(_ fromKey: String) -> String {
        let next = addDays(fromKey, -windowDays)
        return next < seasonStart ? seasonStart : next
    }

    // MARK: - Ganador

    /// La UCI publica las etapas canceladas con una pseudo-fila "Cancelled Race"
    /// como ganadora (pseudo-ficha race-cancelled del catálogo) → sin trofeo.
    static func cleanWinner(_ name: String?) -> String {
        guard let name, !name.isEmpty else { return "" }
        if name.range(of: "cancel", options: .caseInsensitive) != nil { return "" }
        return name
    }

    // MARK: - Construcción de entradas

    /// Clave (carrera × etapa); nil = clasificación final (espejo de `key()`).
    static func stageEntryKey(raceId: String, stageNumber: Int?) -> String {
        "\(raceId)#\(stageNumber.map(String.init) ?? "final")"
    }

    /// Construye las entradas del feed a partir de los datos crudos, resuelve
    /// fechas, aplica el filtro de ventana, precomputa la hora por carrera-día
    /// y devuelve la lista YA ORDENADA (cronología inversa + orden canónico).
    /// Espejo de `fetchEntries` en la web sin la capa de red (el ganador
    /// canónico lo refina después la capa de datos).
    ///
    /// - Parameter isConcluded: gate del fallback FC/PCS — en producción,
    ///   `RaceLogic.shouldShowResults` (el mismo que gobierna el trofeo de las
    ///   cards); inyectable para que los tests no dependan del reloj.
    static func buildEntries(
        stages: [RaceUciStage],
        raceDays: [RaceDay],
        races: [Race],
        fromKey: String,
        toKey: String,
        isConcluded: (RaceDay, Race) -> Bool
    ) -> [FeedEntry] {
        let rdById = Dictionary(uniqueKeysWithValues: raceDays.map { ($0.id, $0) })
        // Jornadas por carrera, preservando el orden de llegada (el fallback de
        // las pruebas de un día toma la primera, como la web).
        var rdsByRace: [String: [RaceDay]] = [:]
        for rd in raceDays {
            guard let raceId = rd.raceId else { continue }
            rdsByRace[raceId, default: []].append(rd)
        }
        // Jornada por (raceId, stageNumber): fallback cuando la clasificación
        // in-house NO trae `raceDayId` (el volcado precedió a la creación de la
        // jornada → race_uci_stages.raceDayId NULL; documentado en el runbook de saneo).
        // Sin él, la bandera/ruta de la etapa caen al país de la CARRERA e
        // ignoran el override por jornada (p. ej. Giro della Valle d'Aosta et1,
        // disputada en Francia, con race_days.countryCode = 'FR').
        // ⚠️ Un doble sector (3A/3B) comparte stageNumber → aquí ganaría uno
        //    arbitrario; no importa: ambos sectores son mismo día y país, y esta
        //    rama solo actúa si falta raceDayId (el camino normal los separa).
        var rdByRaceStage: [String: RaceDay] = [:]
        for rd in raceDays {
            guard let raceId = rd.raceId, let sn = rd.stageNumber else { continue }
            let k = "\(raceId)#\(sn)"
            if rdByRaceStage[k] == nil { rdByRaceStage[k] = rd }
        }
        let raceById = Dictionary(uniqueKeysWithValues: races.map { ($0.id, $0) })

        // ── Entradas in-house ──────────────────────────────────────────
        // Claves de TODAS las clasificaciones volcadas (antes del filtro de
        // fecha): el fallback FC/PCS no debe duplicar lo que ya tiene volcado.
        let inhouseKeys = Set(stages.map { stageEntryKey(raceId: $0.raceId, stageNumber: $0.stageNumber) })
        var entries: [FeedEntry] = []
        var seen = Set<String>()
        var indexByKey: [String: Int] = [:]

        // Jornada de una clasificación: por raceDayId → por (raceId,stageNumber)
        // si el volcado no trajo raceDayId → la única/primera jornada de la
        // carrera (un día). Fuente única para `entryRd` y `entryDate`.
        func rdFor(_ s: RaceUciStage, _ race: Race) -> RaceDay? {
            if let rdId = s.raceDayId, let rd = rdById[rdId] { return rd }
            if let sn = s.stageNumber, let rd = rdByRaceStage["\(s.raceId)#\(sn)"] { return rd }
            return race.raceFormat == "one_day" ? rdsByRace[race.id]?.first : nil
        }
        // Fecha real de una clasificación: stageDate → jornada → fechas de carrera.
        func entryDate(_ s: RaceUciStage, _ race: Race) -> String? {
            if let d = s.stageDate { return d }
            if let rd = rdFor(s, race) { return rd.dateKey }
            return race.raceFormat == "one_day" ? race.startDate : race.endDate
        }
        // Jornada de una clasificación (recorrido/km/tipos/hora/país).
        func entryRd(_ s: RaceUciStage, _ race: Race) -> RaceDay? {
            rdFor(s, race)
        }

        for s in stages {
            guard let race = raceById[s.raceId] else { continue }
            guard let date = entryDate(s, race), date >= fromKey, date <= toKey else { continue }
            let isOneDay = race.raceFormat == "one_day"
            let isFinalGc = s.classKind == "gc" && (s.isFinalClassification || s.stageNumber == nil)

            if isOneDay {
                // Una sola entrada por prueba de un día: final 'gc' preferida.
                let k = "\(s.raceId)#oneday"
                if seen.contains(k) {
                    if isFinalGc, let idx = indexByKey[k], !entries[idx].oneDayFinalGc {
                        let w = cleanWinner(s.winnerName)
                        if !w.isEmpty { entries[idx].winner = w }
                        entries[idx].oneDayFinalGc = true
                        entries[idx].stageRefId = s.id
                    }
                    continue
                }
                // 'gc' no-final de un día (GC del día) se ignora.
                if s.classKind == "gc" && !isFinalGc { continue }
                seen.insert(k)
                indexByKey[k] = entries.count
                entries.append(FeedEntry(
                    key: k, kind: .inhouse, date: date, race: race,
                    stageNumber: nil, subOrder: 1, rd: entryRd(s, race),
                    stageRefId: s.id, winner: cleanWinner(s.winnerName),
                    oneDayFinalGc: isFinalGc
                ))
            } else if isFinalGc {
                // General final de una vuelta: entrada propia, POR DELANTE de la
                // etapa de su carrera (subOrder 0 < 1; cmpEntries la pega a su carrera).
                let k = "\(s.raceId)#gcfinal"
                guard !seen.contains(k) else { continue }
                seen.insert(k)
                entries.append(FeedEntry(
                    key: k, kind: .inhouse, isGcFinal: true, date: date, race: race,
                    stageNumber: nil, subOrder: 0, rd: nil,
                    stageRefId: s.id, winner: cleanWinner(s.winnerName)
                ))
            } else if s.classKind == "stage", let sn = s.stageNumber {
                let k = stageEntryKey(raceId: s.raceId, stageNumber: sn)
                guard !seen.contains(k) else { continue }
                seen.insert(k)
                entries.append(FeedEntry(
                    key: k, kind: .inhouse, date: date, race: race,
                    stageNumber: sn, subOrder: 1, rd: entryRd(s, race),
                    stageRefId: s.id, winner: cleanWinner(s.winnerName)
                ))
            }
            // gc por etapa de una vuelta (GC del día) → NO es entrada.
        }

        // ── Fallback FC/PCS: jornadas concluidas SIN volcado in-house ─────
        for rd in raceDays {
            if rd.isRestDay || rd.isCancelledDay { continue }
            guard let raceId = rd.raceId, let race = raceById[raceId] else { continue }
            guard race.fcId != nil || race.pcsSlug != nil else { continue }
            let isOneDay = race.raceFormat == "one_day"
            let covered = inhouseKeys.contains(stageEntryKey(raceId: raceId, stageNumber: rd.stageNumber))
                || (isOneDay && (inhouseKeys.contains(stageEntryKey(raceId: raceId, stageNumber: nil))
                    || seen.contains("\(raceId)#oneday")))
            if covered { continue }
            guard isConcluded(rd, race) else { continue }
            entries.append(FeedEntry(
                key: "ext#\(rd.id)", kind: .ext, date: rd.dateKey, race: race,
                stageNumber: isOneDay ? nil : rd.stageNumber, subOrder: 1, rd: rd
            ))
        }

        assignSortTimes(&entries)
        return sortedEntries(entries)
    }

    /// Hora de salida POR CARRERA-DÍA (mínimo `neutralStartTimeUtc` de las
    /// jornadas de esa carrera ese día), asignada a TODAS sus entradas —
    /// consistente entre la general final y la etapa de la misma carrera
    /// (ver el aviso de transitividad en `FeedEntry.sortTime`).
    static func assignSortTimes(_ entries: inout [FeedEntry]) {
        var timeByRaceDay: [String: Double] = [:]
        for e in entries {
            guard let ts = e.rd?.neutralStartTimeUtc,
                  let t = DateFormatting.timestampToSeconds(ts) else { continue }
            let k = "\(e.date)#\(e.race.id)"
            if let prev = timeByRaceDay[k], prev <= t { continue }
            timeByRaceDay[k] = t
        }
        for i in entries.indices {
            entries[i].sortTime = timeByRaceDay["\(entries[i].date)#\(entries[i].race.id)"] ?? 999999
        }
    }

    /// Cronología inversa; dentro del día, orden canónico de carreras (las
    /// generales finales pegadas a su carrera y por delante).
    static func sortedEntries(_ entries: [FeedEntry]) -> [FeedEntry] {
        entries.sorted { a, b in
            if a.date != b.date { return a.date > b.date }
            return compareEntries(a, b) < 0
        }
    }

    // MARK: - Orden canónico dentro del día

    /// Orden canónico de carreras dentro del día (espejo de `cmpEntries` en la
    /// web ≈ `_sortByCategory` de app.js sin los criterios que aquí no aplican:
    /// placeholders/mini-perfil). Misma carrera → la general final SIEMPRE por
    /// delante de su etapa. El desempate horario usa la hora POR CARRERA-DÍA
    /// (`sortTime`, precomputada), nunca el rd de la entrada.
    /// Devuelve <0 si `a` va antes, >0 si va después, 0 si empatan.
    static func compareEntries(_ a: FeedEntry, _ b: FeedEntry) -> Int {
        if a.race.id == b.race.id { return a.subOrder - b.subOrder }
        let rA = a.race, rB = b.race

        // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría
        // (espejo de `cmpEntries` en resultados-feed.js). El rd da el primaryType para
        // el slot; las CN son siempre de un día, así que su rd no es nil (la general
        // final, única entrada sin rd, nunca es CN). Si faltara, se cae al genérico.
        if let rdA = a.rd, let rdB = b.rd,
           let cn = ChampionshipsConfig.compare(rA, rdA, rB, rdB), cn != 0 {
            return cn
        }

        let gt = RaceLogic.grandTourRank(rA) - RaceLogic.grandTourRank(rB)
        if gt != 0 { return gt }

        let lvlA = RaceLogic.proLevel(category: rA.uciCategory, name: rA.name, country: rA.countryCode)
        let lvlB = RaceLogic.proLevel(category: rB.uciCategory, name: rB.name, country: rB.countryCode)
        if lvlA != lvlB { return lvlA < lvlB ? -1 : 1 }

        let gen = RaceLogic.genderRank(rA.gender) - RaceLogic.genderRank(rB.gender)
        if gen != 0 { return gen }

        let catA = RaceLogic.uciRank(category: rA.uciCategory, name: rA.name, country: rA.countryCode)
        let catB = RaceLogic.uciRank(category: rB.uciCategory, name: rB.name, country: rB.countryCode)
        if catA != catB { return catA < catB ? -1 : 1 }

        if a.sortTime != b.sortTime { return a.sortTime < b.sortTime ? -1 : 1 }

        switch rA.name.compare(rB.name) {
        case .orderedAscending: return -1
        case .orderedDescending: return 1
        case .orderedSame: return 0
        }
    }
}
