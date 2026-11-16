package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/**
 * Vídeo de una jornada de carretera (tabla `race_day_videos`): emisión completa,
 * resumen, último kilómetro u otro, en YouTube o en otra plataforma. Reglas de
 * presentación en `StageVideoLogic` (espejo de `js/services/stage-videos.js`).
 */
@Serializable
data class RaceDayVideo(
    val id: String,
    val raceDayId: String,
    val kind: String,
    val title: String,
    val titleEn: String? = null,
    val channel: String? = null,
    val url: String,
    val embeddable: Boolean? = null,
    val country: String? = null,
    val sortOrder: Int = 0,
)
