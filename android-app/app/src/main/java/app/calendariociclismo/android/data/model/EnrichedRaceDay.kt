package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/**
 * Datos completos de un día: jornadas con su carrera, emisiones y assets anotados.
 * Equivalente a `DayData` / `EnrichedRaceDay` en el iOS.
 */
@Serializable
data class DayData(
    val raceDays: List<EnrichedRaceDay>,
    val raceMap: Map<String, Race>,
    val featuredRaceIds: Set<String> = emptySet(),
)

@Serializable
data class FeaturedRaceSelection(
    val dateKey: String,
    val raceId: String,
    val manual: Boolean,
)

@Serializable
data class EnrichedRaceDay(
    val raceDay: RaceDay,
    val race: Race? = null,
    val broadcasts: List<Broadcast> = emptyList(),
    val assets: List<Asset> = emptyList(),
    val isPlaceholder: Boolean = false,
) {
    val id: String get() = raceDay.id
}
