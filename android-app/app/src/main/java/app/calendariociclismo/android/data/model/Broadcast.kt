package app.calendariociclismo.android.data.model

import app.calendariociclismo.android.util.DateFormatting
import kotlinx.serialization.Serializable

/** Emisión de TV/streaming de una etapa (tabla `broadcasts`). */
@Serializable
data class Broadcast(
    val id: String,
    val raceDayId: String,
    val channel: String? = null,
    val startTimeUtc: String? = null,
    val url: String? = null,
    val note: String? = null,
    val sortOrder: Int = 0,
    val showInRevive: Boolean = false,
    val country: String? = null,
    /** Inserción permitida en YouTube (oEmbed): `false` impide el reproductor y la conversión a «Emisión de la etapa». */
    val embeddable: Boolean? = null,
) {
    /** Hora de inicio formateada en la zona horaria del dispositivo (HH:mm). */
    val startTimeLocal: String?
        get() = startTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
}
