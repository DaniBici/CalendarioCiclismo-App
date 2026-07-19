import Foundation

/// Un país en la rejilla del Modo Campeonatos: bandera + sede + sus pruebas
/// emparejadas con su jornada (`EnrichedRaceDay`) por slot.
/// Equivalente a `byCountry[cc]` en `js/campeonatos.js`.
struct ChampionshipCountry: Identifiable, Hashable {
    let countryCode: String
    let hostCity: String?
    /// Pruebas presentes para este país, indexadas por slot.
    let slots: [ChampionshipsConfig.Slot: EnrichedRaceDay]

    var id: String { countryCode }

    /// Slots visibles bajo un filtro, en el orden fijo de columna. El filtro
    /// `today` no restringe por slot sino por fecha (la jornada del día en curso).
    func visibleSlots(filter: ChampionshipsConfig.Filter) -> [ChampionshipsConfig.Slot] {
        if filter == .today {
            let today = DateFormatting.todayKey()
            return ChampionshipsConfig.Slot.allCases.filter { slots[$0]?.raceDay.dateKey == today }
        }
        let allowed = Set(filter.slots)
        return ChampionshipsConfig.Slot.allCases.filter { allowed.contains($0) && slots[$0] != nil }
    }
}
