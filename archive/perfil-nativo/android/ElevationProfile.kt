package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

@Serializable
data class ElevationProfile(
    val distance: Double,
    val elevationGain: Int? = null,
    val elevationLoss: Int? = null,
    val minElevation: Int? = null,
    val maxElevation: Int? = null,
    val points: List<ElevationPoint> = emptyList(),
)

@Serializable
data class ElevationPoint(val km: Double, val alt: Int)

@Serializable
data class ProfileSummit(
    val name: String? = null,
    val km: Double,
    val altitude: Int? = null,
    val category: String? = null,
    val side: String? = null,
)

@Serializable
data class ProfileWaypoint(
    val name: String? = null,
    val km: Double,
    val type: String,
    val lengthKm: Double? = null,
)
