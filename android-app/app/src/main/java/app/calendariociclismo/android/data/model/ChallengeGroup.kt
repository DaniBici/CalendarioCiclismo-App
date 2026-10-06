package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/**
 * Agrupación de carreras de un día (tabla `challenge_groups`), p. ej. la
 * Challenge Mallorca. Temporada la presenta en una sola fila, como la web
 * (`js/temporada.js`).
 */
@Serializable
data class ChallengeGroup(
    val id: String,
    val name: String,
    val slug: String? = null,
    val gender: String? = null,
    val year: Int? = null,
    val uciCategory: String? = null,
    val countryCode: String? = null,
    val colorHex: String? = null,
    val logoUrl: String? = null,
    val raceIds: List<String>? = null,
)
