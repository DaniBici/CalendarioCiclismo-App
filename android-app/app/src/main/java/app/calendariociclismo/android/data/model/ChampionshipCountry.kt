package app.calendariociclismo.android.data.model

import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.DateFormatting

/**
 * Un país en la rejilla del Modo Campeonatos: bandera + sede + sus pruebas
 * emparejadas con su jornada (`EnrichedRaceDay`) por slot.
 * Equivalente a `byCountry[cc]` en `js/campeonatos.js`.
 */
data class ChampionshipCountry(
    val countryCode: String,
    val hostCity: String?,
    val slots: Map<ChampionshipsConfig.Slot, EnrichedRaceDay>,
) {
    /** Slots visibles bajo un filtro, en el orden fijo de columna. El filtro
     *  `TODAY` no restringe por slot sino por fecha (la jornada del día en curso). */
    fun visibleSlots(filter: ChampionshipsConfig.Filter): List<ChampionshipsConfig.Slot> {
        if (filter == ChampionshipsConfig.Filter.TODAY) {
            val today = DateFormatting.todayKey()
            return ChampionshipsConfig.Slot.values().filter { slots[it]?.raceDay?.dateKey == today }
        }
        val allowed = filter.slots.toSet()
        return ChampionshipsConfig.Slot.values().filter { it in allowed && slots[it] != null }
    }
}
