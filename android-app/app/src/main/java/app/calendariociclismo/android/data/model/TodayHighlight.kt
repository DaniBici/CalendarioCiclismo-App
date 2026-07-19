package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/**
 * Destacado del cintillo "Hoy" (tabla `today_highlights`).
 * Editado desde panel admin. Cada entrada apunta a una jornada, startlist u orden de salida.
 */
@Serializable
data class TodayHighlight(
    val id: String,
    val position: Int = 0,
    val targetType: String,                 // "raceDay" | "startlist" | "startOrder"
    val raceId: String? = null,
    val raceDayId: String? = null,
    val customTitle: String? = null,
    val customTitleEn: String? = null,
    val customDetail: String? = null,
    val customDetailEn: String? = null,
    val visibleFrom: String? = null,
    val visibleUntil: String? = null,
    val updatedAt: String? = null,
)
