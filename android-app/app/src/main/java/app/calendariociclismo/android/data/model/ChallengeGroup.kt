package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/**
 * Agrupación temática de carreras (tabla `challenge_groups`).
 */
@Serializable
data class ChallengeGroup(
    val id: String,
    val name: String,
    val slug: String? = null,
    val description: String? = null,
    val year: Int? = null,
)
