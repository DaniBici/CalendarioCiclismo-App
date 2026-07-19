import Foundation

/// Una fila de la guía simplificada de horarios de paso.
struct GuideRow: Identifiable {
    let km: Double
    let kmToGo: Double?
    /// start | climb_foot | summit | intermediate_sprint | bonus_sprint |
    /// intermediate_split | cobblestone | sterrato | town | finish
    let type: String
    let label: String?
    let category: String?
    let timeUtc: String?
    let isEstimated: Bool

    var id: String { "\(km)-\(type)" }
}

/// Construye la guía simplificada de horarios de paso por los puntos
/// destacados de una jornada. Función pura.
///
/// Las horas manuales (del rutómetro) viajan en `timeUtc` dentro de cada
/// `ProfileSummit`/`ProfileWaypoint`. Salida y llegada usan los horarios de
/// la jornada. Las horas que no vienen en el rutómetro se ESTIMAN por
/// interpolación lineal por km entre las horas conocidas (anclas).
///
/// Mantener en PARIDAD con `js/simplified-guide.js` y
/// `android-app/.../util/SimplifiedGuide.kt`.
enum SimplifiedGuide {

    private struct MutableRow {
        var km: Double
        var kmToGo: Double?
        var type: String
        var label: String?
        var category: String?
        var timeUtc: String?
        var isEstimated: Bool
    }

    private static func round1(_ x: Double) -> Double { (x * 10).rounded() / 10 }

    private static func parseSeconds(_ iso: String?) -> Double? {
        guard let iso else { return nil }
        return DateFormatting.parseISO(iso)?.timeIntervalSince1970
    }

    /// Crea un serializador ISO UTC. Se crea por invocación porque
    /// `ISO8601DateFormatter` (NSObject) no es thread-safe — mismo criterio
    /// que `DateFormatting.makeISOFormatter`.
    private static func makeISOOut() -> ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }

    // Redondea al minuto y serializa a ISO UTC (las horas de rutómetro son HH:mm).
    private static func isoFromSeconds(_ secs: Double) -> String {
        let rounded = (secs / 60).rounded() * 60
        return makeISOOut().string(from: Date(timeIntervalSince1970: rounded))
    }

    // Paridad con `js/perfil-pub.js`: en CRI/CRE se muestran los puntos
    // intermedios; en el resto, los sprints. Pavé/sterrato/localidad siempre.
    private static func isWaypointVisible(_ type: String, isTimeTrial: Bool) -> Bool {
        switch type {
        case "kom": return false
        case "intermediate_sprint", "bonus_sprint": return !isTimeTrial
        case "intermediate_split": return isTimeTrial
        default: return true
        }
    }

    static func build(
        distanceKm: Double?,
        neutralStartTimeUtc: String?,
        estimatedFinishTimeUtc: String?,
        summits: [ProfileSummit],
        waypoints: [ProfileWaypoint],
        primaryType: String?
    ) -> [GuideRow] {
        let isTimeTrial = primaryType == "itt" || primaryType == "ttt"
        var rows: [MutableRow] = []

        // — Salida (km 0) —
        if let start = neutralStartTimeUtc {
            rows.append(MutableRow(km: 0, kmToGo: nil, type: "start", label: nil,
                                   category: nil, timeUtc: start, isEstimated: false))
        }

        // — Puertos: pie (estimado) + cima (manual si la hubiera) —
        for s in summits {
            guard let km = s.km else { continue }
            if let startKm = s.startKm, startKm < km {
                rows.append(MutableRow(km: startKm, kmToGo: nil, type: "climb_foot",
                                       label: s.name, category: s.category,
                                       timeUtc: s.footTimeUtc, isEstimated: s.footTimeUtc == nil))
            }
            rows.append(MutableRow(km: km, kmToGo: nil, type: "summit", label: s.name,
                                   category: s.category, timeUtc: s.timeUtc,
                                   isEstimated: s.timeUtc == nil))
        }

        // — Waypoints —
        for w in waypoints {
            guard let km = w.km else { continue }
            guard isWaypointVisible(w.type, isTimeTrial: isTimeTrial) else { continue }
            rows.append(MutableRow(km: km, kmToGo: nil, type: w.type, label: w.name,
                                   category: nil, timeUtc: w.timeUtc,
                                   isEstimated: w.timeUtc == nil))
        }

        // — Llegada (km = distancia) —
        if let finish = estimatedFinishTimeUtc, let dist = distanceKm {
            rows.append(MutableRow(km: dist, kmToGo: nil, type: "finish", label: nil,
                                   category: nil, timeUtc: finish, isEstimated: false))
        }

        // — Orden por km (estable: pie < cima por construcción) —
        rows = rows.enumerated()
            .sorted { $0.element.km != $1.element.km ? $0.element.km < $1.element.km : $0.offset < $1.offset }
            .map { $0.element }

        // — Deduplicar mismo km y tipo (tol. 0.05 km) —
        var deduped: [MutableRow] = []
        for r in rows {
            if var prev = deduped.last, prev.type == r.type, abs(prev.km - r.km) < 0.05 {
                if prev.timeUtc == nil, r.timeUtc != nil {
                    prev = r
                    deduped[deduped.count - 1] = prev
                }
                continue
            }
            deduped.append(r)
        }

        // — kmToGo —
        for i in deduped.indices {
            if let dist = distanceKm { deduped[i].kmToGo = round1(dist - deduped[i].km) }
        }

        // — Interpolación de horas faltantes (no en CRI/CRE) —
        if !isTimeTrial {
            let anchors: [(km: Double, secs: Double)] = deduped.compactMap { r in
                guard let secs = parseSeconds(r.timeUtc) else { return nil }
                return (r.km, secs)
            }
            if anchors.count >= 2 {
                for i in deduped.indices where deduped[i].timeUtc == nil {
                    let km = deduped[i].km
                    var prev: (km: Double, secs: Double)?
                    var next: (km: Double, secs: Double)?
                    for a in anchors {
                        if a.km <= km, prev == nil || a.km > prev!.km { prev = a }
                        if a.km >= km, next == nil || a.km < next!.km { next = a }
                    }
                    if let prev, let next, next.km > prev.km {
                        let t = (km - prev.km) / (next.km - prev.km)
                        deduped[i].timeUtc = isoFromSeconds(prev.secs + t * (next.secs - prev.secs))
                        deduped[i].isEstimated = true
                    }
                }
            }
        }

        return deduped.map {
            GuideRow(km: $0.km, kmToGo: $0.kmToGo, type: $0.type, label: $0.label,
                     category: $0.category, timeUtc: $0.timeUtc, isEstimated: $0.isEstimated)
        }
    }

    /// True si la jornada tiene guía que merezca enseñarse. Es **opt-in**:
    /// solo si el editor introdujo al menos UNA hora real del rutómetro en un
    /// punto intermedio (cima/waypoint). Las horas interpoladas no bastan.
    static func hasGuide(_ rows: [GuideRow]) -> Bool {
        rows.contains { $0.type != "start" && $0.type != "finish"
            && $0.timeUtc != nil && !$0.isEstimated }
    }
}
