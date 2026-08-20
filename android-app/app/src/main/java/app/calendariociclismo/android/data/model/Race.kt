package app.calendariociclismo.android.data.model

import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.LocaleHolder
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.util.concurrent.TimeUnit

/**
 * Carrera profesional de ciclismo (tabla `races` en Supabase).
 *
 * Port literal de [Race.swift][ios-app/CalendarioCiclismo/Models/Race.swift].
 */
@Serializable
data class Race(
    val id: String,
    val name: String,
    val nameEn: String? = null,
    val abbrev: String? = null,
    val uciCategory: String? = null,
    val gender: String? = null,
    val raceFormat: String? = null,
    val countryCode: String? = null,
    val colorHex: String? = null,
    val logoUrl: String? = null,
    val websiteUrl: String? = null,
    val fcId: Int? = null,
    val pcsSlug: String? = null,
    val hideFlag: Boolean = false,
    val isGrandTour: Boolean = false,
    val isNoClickable: Boolean = false,
    val isCancelled: Boolean = false,
    val startDate: String? = null, // YYYY-MM-DD
    val endDate: String? = null,   // YYYY-MM-DD
    val year: Int? = null,
    val slug: String? = null,
    val originalName: String? = null,
    val startlistImportedAt: String? = null,
    val startlistProvisional: Boolean = false,
    val enrichedStartlist: Boolean? = null,
    @SerialName("createdAt") val createdAt: String? = null,
) {
    val isStageRace: Boolean get() = raceFormat == "stage_race"
    val isOneDay: Boolean get() = raceFormat == "one_day"
    val isFemale: Boolean get() = gender == "female"

    /** Nombre localizado: muestra `nameEn` si la app está en inglés o si el
     *  dispositivo está configurado en un idioma no español. */
    val localizedName: String
        get() {
            if (LocaleHolder.shouldShowEnglishContent) {
                val en = nameEn
                if (!en.isNullOrEmpty()) return en
            }
            return name
        }

    /** Duración en días de la carrera (incluye ambos extremos). */
    val durationDays: Int?
        get() {
            val start = startDate?.let { DateFormatting.parseDateKey(it) } ?: return null
            val end = endDate?.let { DateFormatting.parseDateKey(it) } ?: return null
            val diff = TimeUnit.MILLISECONDS.toDays(end.time - start.time).toInt()
            return diff + 1
        }
}
