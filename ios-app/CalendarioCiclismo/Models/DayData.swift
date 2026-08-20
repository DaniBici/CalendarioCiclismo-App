import Foundation

/// Datos completos de un día: jornadas con su carrera, emisiones y assets anotados.
struct DayData: Codable {
    let raceDays: [EnrichedRaceDay]
    let raceMap: [String: Race]
}

/// Una jornada enriquecida con su carrera asociada, emisiones y assets.
struct EnrichedRaceDay: Codable, Identifiable, Hashable {
    let raceDay: RaceDay
    let race: Race?
    let broadcasts: [Broadcast]
    let assets: [Asset]

    /// Si es un placeholder (carrera sin etapa publicada para ese día).
    var isPlaceholder: Bool = false

    var id: String { raceDay.id }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    // `RaceDay.==` y `Race.==` comparan solo por `id`. Aquí comparamos los
    // campos que SwiftUI necesita ver cambiados para re-renderizar RaceCardView:
    // `updatedAt` cubre la mayoría de actualizaciones del panel, pero km/salida/
    // llegada y horas pueden editarse sin que ese campo cambie (importaciones
    // batch, scripts), por eso se comparan también de forma explícita.
    static func == (lhs: EnrichedRaceDay, rhs: EnrichedRaceDay) -> Bool {
        guard lhs.raceDay.id == rhs.raceDay.id,
              lhs.isPlaceholder == rhs.isPlaceholder,
              lhs.race?.id == rhs.race?.id else { return false }
        let l = lhs.raceDay, r = rhs.raceDay
        return l.updatedAt == r.updatedAt
            && l.distanceKm == r.distanceKm
            && l.startLocation == r.startLocation
            && l.finishLocation == r.finishLocation
            && l.neutralStartTimeUtc == r.neutralStartTimeUtc
            && l.estimatedFinishTimeUtc == r.estimatedFinishTimeUtc
            && l.tvStatus == r.tvStatus
            && l.primaryType == r.primaryType
            && l.secondaryType == r.secondaryType
            && l.isRestDay == r.isRestDay
            && l.isCancelledDay == r.isCancelledDay
            && l.stageNumber == r.stageNumber
            && lhs.broadcasts == rhs.broadcasts
            && lhs.assets == rhs.assets
    }

    enum CodingKeys: String, CodingKey {
        case raceDay, race, broadcasts, assets, isPlaceholder
    }
}
