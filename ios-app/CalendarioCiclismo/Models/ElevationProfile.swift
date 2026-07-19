import Foundation

struct ElevationProfile: Codable {
    let distance: Double
    let elevationGain: Int?
    let elevationLoss: Int?
    let minElevation: Int?
    let maxElevation: Int?
    let points: [ElevationPoint]
}

struct ElevationPoint: Codable {
    let km: Double
    let alt: Int
}

/// Cima o puerto sobre el perfil. `km` es opcional para tolerar registros
/// incompletos: si una fila queda en DB con `km: null`, el decode no rompe
/// (lo que antes provocaba un fallo en cascada en `loadDayComplete` y la
/// pantalla "Hoy" mostraba "datos no disponibles offline"). Los consumidores
/// deben filtrar `km == nil` antes de pintar.
struct ProfileSummit: Codable, Identifiable {
    var id: String { "\(km ?? -1)-\(name ?? "")" }
    let name: String?
    let km: Double?
    let altitude: Int?
    let category: String?
    let side: String?
    let startKm: Double?
    /// Hora de paso por la cima (ISO 8601 UTC), introducida desde el rutómetro.
    /// Opcional: si falta, la guía de horarios la estima por interpolación.
    let timeUtc: String?
    /// Hora de paso por el pie del puerto (ISO 8601 UTC) del rutómetro.
    /// Opcional: si falta, el pie se estima por interpolación.
    let footTimeUtc: String?

    /// Longitud y pendiente media derivadas del GPX. Devuelve nil si
    /// startKm no está fijado o si es inconsistente.
    func climbStats(points: [ElevationPoint]) -> (lengthKm: Double, avgGradient: Double)? {
        guard let km, let start = startKm, start < km, points.count >= 2 else { return nil }

        func interp(_ k: Double) -> Double {
            if k <= points.first!.km { return Double(points.first!.alt) }
            if k >= points.last!.km  { return Double(points.last!.alt) }
            for i in 0..<(points.count - 1) {
                let p0 = points[i], p1 = points[i + 1]
                if k >= p0.km && k <= p1.km {
                    let span = p1.km - p0.km
                    if span <= 0 { return Double(p0.alt) }
                    let t = (k - p0.km) / span
                    return Double(p0.alt) + t * Double(p1.alt - p0.alt)
                }
            }
            return Double(points.last!.alt)
        }

        let summitAlt = altitude.map(Double.init) ?? interp(min(km, points.last!.km))
        let startAlt  = interp(start)
        let length    = km - start
        guard length > 0 else { return nil }
        let gradient = ((summitAlt - startAlt) / (length * 1000)) * 100
        return (length, gradient)
    }
}

/// Waypoint del perfil (sprint, paso intermedio, sector empedrado, etc.).
/// `km` opcional por el mismo motivo que en `ProfileSummit`.
struct ProfileWaypoint: Codable, Identifiable {
    var id: String { "\(km ?? -1)-\(type)" }
    let name: String?
    let km: Double?
    let type: String
    let lengthKm: Double?
    /// Hora de paso (ISO 8601 UTC) del rutómetro. Opcional (se estima si falta).
    let timeUtc: String?
}
