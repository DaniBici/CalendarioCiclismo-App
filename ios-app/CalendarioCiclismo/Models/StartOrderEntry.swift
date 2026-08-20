import Foundation

/// Entrada de orden de salida (tabla `start_order_entries`).
/// Se usa en CRI/CRE (contrarreloj individual / por equipos) para mostrar la hora
/// de salida de cada corredor en orden de dorsal/clasificación.
struct StartOrderEntry: Codable, Identifiable, Hashable {
    let id: String
    let raceDayId: String
    let sortOrder: Int
    let dorsal: Int
    let startTime: String       // "HH:MM" o "HH:MM:SS" en hora local de la carrera
    let riderId: String?
    let riderName: String?
    let teamName: String?
    let countryCode: String?
}

/// Subset de RaceDay que necesitamos para el header + filtros del orden de salida.
/// `start_order_entries` por sí solo no trae los arrays TT/GC ni el timezone;
/// se cargan de race_days vía este DTO.
struct StartOrderRaceDay: Codable {
    let id: String
    let raceId: String?
    let date: String?
    let dateKey: String?
    let slug: String?
    let slugEn: String?
    let stageNumber: Int?
    let primaryType: String?
    let startLocation: String?
    let finishLocation: String?
    let startLocationEn: String?
    let finishLocationEn: String?
    let distanceKm: Double?
    let timezone: String?
    let startOrderTtDorsals: [Int]?
    let startOrderGcDorsals: [Int]?

    /// Fecha de referencia para convertir la hora local de la carrera. `dateKey`
    /// es el campo canónico y NUNCA es null; `date` es legacy y puede faltar
    /// (cuando faltaba, la conversión de huso se saltaba y se mostraba la hora cruda).
    var effectiveDate: String? { dateKey ?? date }
}
