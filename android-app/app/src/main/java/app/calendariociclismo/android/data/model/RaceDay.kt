package app.calendariociclismo.android.data.model

import app.calendariociclismo.android.util.LocaleHolder
import kotlinx.serialization.Serializable

/**
 * Etapa o jornada de una carrera (tabla `race_days` en Supabase).
 *
 * Port literal de [RaceDay.swift][ios-app/CalendarioCiclismo/Models/RaceDay.swift].
 *
 * `stageSuffix` no viene de la DB; lo asigna `RaceLogic.annotateDoubleSectors`
 * cuando se detectan dobles sectores.
 */
@Serializable
data class RaceDay(
    val id: String,
    val raceId: String? = null,
    val dateKey: String,        // YYYY-MM-DD
    val date: String? = null,
    val slug: String? = null,
    val isRestDay: Boolean = false,
    val isCancelledDay: Boolean = false,
    val stageNumber: Int? = null,
    val startLocation: String? = null,
    val finishLocation: String? = null,
    val startLocationEn: String? = null,
    val finishLocationEn: String? = null,
    val distanceKm: Double? = null,
    val primaryType: String? = null,
    val secondaryType: String? = null,
    val neutralStartTimeUtc: String? = null,
    val estimatedFinishTimeUtc: String? = null,
    val tvStatus: String? = null,
    val description: String? = null,
    val bonuses: String? = null,
    val notes: String? = null,
    /**
     * Traducciones EN guardadas en el JSONB `translations` (migración 027).
     * Estructura: `translations.en.{description,bonuses,notes}.value`.
     * Las columnas top-level `descriptionEn`/`bonusesEn`/`notesEn` NO existen
     * en la DB; la única fuente de verdad para esos campos en inglés es este
     * JSONB (igual que en la web).
     */
    val translations: RaceDayTranslations? = null,
    val editorialStatus: String = "published",
    val hasAssets: Boolean = false,
    val updatedAt: String? = null,
    /**
     * Override puramente cosmético del país de la jornada (ISO-2). Si está
     * presente reemplaza la bandera mostrada al usuario en las vistas de Hoy,
     * Agenda y Jornada; nunca se usa en filtros de país (esos siguen mirando
     * `Race.countryCode`) ni en la vista de competición.
     */
    val countryCode: String? = null,
    val elevationProfile: ElevationProfile? = null,
    val profileSummits: List<ProfileSummit>? = null,
    val profileWaypoints: List<ProfileWaypoint>? = null,
    val profileNotViewable: Boolean = false,
    /**
     * URL del GPX crudo del recorrido para el mapa interactivo (bucket público
     * `route-gpx` de Supabase Storage; migración 105/106). NULL = la etapa no
     * tiene mapa. La traza se parsea en cliente (`RouteMapLogic.parseGpx`); los
     * marcadores de `profileSummits`/`profileWaypoints` se proyectan por km
     * sobre ella. Independiente de `elevationProfile` (puede haber uno sin otro).
     */
    val routeGpxUrl: String? = null,
) {
    @kotlinx.serialization.Transient
    var stageSuffix: String? = null

    /** `true` cuando la UI está en inglés (`LocaleHolder.current.language == "en"`). */
    private val isEnglish: Boolean
        get() = LocaleHolder.current.language == "en"

    /** Descripción en el idioma activo. Cae al texto ES si no hay traducción EN. */
    val localizedDescription: String?
        get() {
            if (isEnglish) {
                val en = translations?.en?.description?.value
                if (!en.isNullOrEmpty()) return en
            }
            return description
        }

    /** Bonificaciones en el idioma activo. Cae al texto ES si no hay traducción EN. */
    val localizedBonuses: String?
        get() {
            if (isEnglish) {
                val en = translations?.en?.bonuses?.value
                if (!en.isNullOrEmpty()) return en
            }
            return bonuses
        }

    /** Notas en el idioma activo. Cae al texto ES si no hay traducción EN. */
    val localizedNotes: String?
        get() {
            if (isEnglish) {
                val en = translations?.en?.notes?.value
                if (!en.isNullOrEmpty()) return en
            }
            return notes
        }

    /**
     * `true` cuando la descripción EN proviene de traducción automática
     * (`status != "manual"`) y el usuario está viendo la app en inglés. Se
     * usa para mostrar el aviso "AI translated from Spanish, might contain
     * errors" igual que en la web.
     */
    val isDescriptionAutoTranslated: Boolean
        get() {
            if (!isEnglish) return false
            val st = translations?.en?.description?.status ?: return false
            return st != "manual"
        }

    val isPublished: Boolean get() = editorialStatus == "published"

    val hasElevationProfile: Boolean
        get() = elevationProfile != null && !profileNotViewable && elevationProfile.points.size >= 2

    /** Etiqueta de etapa: "Prólogo"/"Prologue", "Etapa 3"/"Stage 3", etc. */
    val stageLabel: String
        get() {
            val n = stageNumber ?: return ""
            val base = if (n == 0) LocaleHolder.t("Prólogo", "Prologue")
                       else LocaleHolder.t("Etapa $n", "Stage $n")
            val suffix = stageSuffix ?: return base
            return if (n == 0) "$base $suffix" else "$base$suffix"
        }

    /** Etiqueta corta: "Pról"/"Pro", "E3"/"S3", "E1A"/"S1A" (doble sector). */
    val stageLabelShort: String
        get() {
            val n = stageNumber ?: return ""
            val base = if (n == 0) LocaleHolder.t("Pról", "Pro")
                       else LocaleHolder.t("E$n", "S$n")
            return "$base${stageSuffix.orEmpty()}"
        }

    /** Ciudad de salida en el idioma activo. Cae a ES si no hay traducción EN. */
    val localizedStartLocation: String?
        get() = if (isEnglish) startLocationEn?.takeUnless { it.isEmpty() } ?: startLocation
                else startLocation

    /** Ciudad de meta en el idioma activo. Cae a ES si no hay traducción EN. */
    val localizedFinishLocation: String?
        get() = if (isEnglish) finishLocationEn?.takeUnless { it.isEmpty() } ?: finishLocation
                else finishLocation

    /**
     * Sede a efectos del campeonato: la META si existe (más representativa de la
     * ciudad sede), si no la SALIDA. Localizada (EN con respaldo a ES).
     */
    val championshipVenue: String?
        get() = localizedFinishLocation?.takeUnless { it.isEmpty() }
            ?: localizedStartLocation?.takeUnless { it.isEmpty() }

    /** Recorrido: "Ciudad A > Ciudad B" o el nombre único si solo hay uno. */
    val routeDescription: String?
        get() {
            val start = localizedStartLocation?.takeUnless { it.isEmpty() }
            val finish = localizedFinishLocation?.takeUnless { it.isEmpty() }
            return when {
                start != null && finish != null ->
                    if (start == finish) start else "$start > $finish"
                start != null -> start
                finish != null -> finish
                else -> null
            }
        }

    /** True cuando solo hay ciudad de salida (salida = meta). */
    val isSingleCity: Boolean
        get() {
            val start = localizedStartLocation?.takeUnless { it.isEmpty() }
            val finish = localizedFinishLocation?.takeUnless { it.isEmpty() }
            if (start == null || start.isEmpty()) return false
            return finish == null || finish == start
        }

    /** Distancia formateada: "174,5 km" (ES) / "174.5 km" (EN). El separador
     *  decimal sigue el IDIOMA DE CONTENIDO (no el locale del dispositivo), igual
     *  que la web (toLocaleString es-ES/en-GB) y que el desnivel de abajo. */
    val distanceFormatted: String?
        get() {
            val km = distanceKm ?: return null
            val str = if (km % 1.0 == 0.0) {
                "%.0f".format(km)
            } else {
                val raw = String.format(java.util.Locale.US, "%.1f", km)   // siempre con '.'
                if (LocaleHolder.shouldShowEnglishContent) raw else raw.replace('.', ',')
            }
            return "$str km"
        }

    /** Desnivel positivo formateado: "+2.500m" (ES) / "+2,500m" (EN), redondeado a la decena.
     *  El separador de miles sigue el IDIOMA DE CONTENIDO (no el locale del
     *  dispositivo ni el chrome de la UI), igual que el kilometraje de arriba:
     *  un dispositivo en inglés con la app en ES debe ver la coma del contenido. */
    val elevationGainFormatted: String?
        get() {
            val gain = elevationProfile?.elevationGain ?: return null
            val rounded = (gain / 10) * 10
            val sep = if (LocaleHolder.shouldShowEnglishContent) ',' else '.'
            val formatted = rounded.toString()
                .reversed()
                .chunked(3)
                .joinToString(sep.toString())
                .reversed()
            return "+${formatted} m"
        }
}

// ─────────── Elevation payload (lazy fetch) ───────────

/**
 * Payload mínimo de elevación para carga diferida en `loadDayComplete`.
 * Solo contiene `id` + los 4 campos JSONB pesados.
 */
@Serializable
data class RaceDayElevationData(
    val id: String,
    val elevationProfile: ElevationProfile? = null,
    val profileSummits: List<ProfileSummit>? = null,
    val profileWaypoints: List<ProfileWaypoint>? = null,
    val profileNotViewable: Boolean = false,
)

/** Devuelve una copia con los datos de elevación reemplazados por los del payload. */
fun RaceDay.applyingElevation(elev: RaceDayElevationData): RaceDay {
    val updated = copy(
        elevationProfile = elev.elevationProfile,
        profileSummits = elev.profileSummits,
        profileWaypoints = elev.profileWaypoints,
        profileNotViewable = elev.profileNotViewable,
    )
    updated.stageSuffix = stageSuffix
    return updated
}

/**
 * Espejo del JSONB `race_days.translations` (migración 027). En la app solo
 * consumimos el sub-objeto `en`. Cada campo tiene `value` (texto traducido)
 * y `status` (`manual`, `auto`, `stale`, `pending`).
 */
@Serializable
data class RaceDayTranslations(
    val en: RaceDayTranslationFields? = null,
)

@Serializable
data class RaceDayTranslationFields(
    val description: RaceDayTranslationEntry? = null,
    val bonuses: RaceDayTranslationEntry? = null,
    val notes: RaceDayTranslationEntry? = null,
)

@Serializable
data class RaceDayTranslationEntry(
    val value: String? = null,
    val status: String? = null,
)
