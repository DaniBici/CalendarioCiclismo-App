package app.calendariociclismo.android.util

import androidx.annotation.StringRes
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.prefs.RegionPreference
import java.util.TimeZone

/**
 * Detecta la región sugerida para el usuario a partir de la zona horaria del
 * dispositivo. Port simplificado de `_COUNTRY_TZ_MAP` y `_extracontinentalGroup`
 * en `js/shared.js`.
 *
 * El criterio agrupa los grupos finos de broadcasts.country en los 5 buckets
 * de [RegionPreference] (excluyendo [RegionPreference.ALL], que solo se elige
 * manualmente). El sexto bucket [RegionPreference.SPAIN] se usa como fallback
 * cuando la TZ no permite afinar más allá de "Europa".
 */
object RegionDetector {

    /** Zonas horarias que cubren España (incluye Canarias y Ceuta). */
    private val SPAIN_TZS = setOf(
        "Europe/Madrid", "Atlantic/Canary", "Africa/Ceuta",
    )

    /**
     * Zonas horarias europeas que no empiezan por `Europe/` ni `Africa/Ceuta`
     * (Atlántico Norte y Atlántico oeste). Todas se tratan como EUROPE.
     */
    private val EUROPE_EXTRA_TZS = setOf(
        "Atlantic/Azores", "Atlantic/Madeira", "Atlantic/Faroe",
        "Atlantic/Reykjavik", "Arctic/Longyearbyen",
    )

    /**
     * Devuelve la [RegionPreference] sugerida según la TZ del dispositivo.
     * Nunca devuelve [RegionPreference.ALL] (esa solo se elige manualmente).
     * Si la TZ no encaja en ningún bucket, vuelve a [RegionPreference.SPAIN]
     * (preserva el baseline gratuito).
     */
    fun suggestedRegion(timeZoneId: String = TimeZone.getDefault().id): RegionPreference {
        if (timeZoneId in SPAIN_TZS) return RegionPreference.SPAIN
        if (timeZoneId.startsWith("Europe/") || timeZoneId in EUROPE_EXTRA_TZS) {
            return RegionPreference.EUROPE
        }
        if (timeZoneId.startsWith("America/") || timeZoneId == "Pacific/Honolulu") {
            return RegionPreference.AMERICAS
        }
        if (timeZoneId.startsWith("Asia/") ||
            timeZoneId.startsWith("Pacific/") ||
            timeZoneId.startsWith("Australia/") ||
            timeZoneId == "Indian/Christmas" ||
            timeZoneId == "Indian/Cocos"
        ) {
            return RegionPreference.ASIA
        }
        if (timeZoneId.startsWith("Africa/")) return RegionPreference.AFRICA
        return RegionPreference.SPAIN
    }

    // ─── Grupo fino para auto_dispatch `tv_start` ───────────────────

    /**
     * Mapa TZ → grupo `broadcasts.country` fino (paridad con
     * `_COUNTRY_TZ_MAP` en `js/shared.js` y `fineTimeZoneMap` en
     * `RegionService.swift`). Solo cubre Europa fina; el resto se
     * resuelve por prefijo en [detectedCountryGroup].
     */
    private val FINE_TZ_MAP: Map<String, String> = mapOf(
        // ES
        "Europe/Madrid" to "ES", "Atlantic/Canary" to "ES", "Africa/Ceuta" to "ES",
        // PT
        "Europe/Lisbon" to "PT", "Atlantic/Azores" to "PT", "Atlantic/Madeira" to "PT",
        // FR
        "Europe/Paris" to "FR", "Europe/Monaco" to "FR",
        // BE / NL
        "Europe/Brussels" to "BE",
        "Europe/Amsterdam" to "NL",
        // IT
        "Europe/Rome" to "IT", "Europe/Vatican" to "IT",
        "Europe/San_Marino" to "IT", "Europe/Malta" to "IT",
        // DE / AT / CH
        "Europe/Berlin" to "DE_AT_CH", "Europe/Busingen" to "DE_AT_CH",
        "Europe/Vienna" to "DE_AT_CH",
        "Europe/Zurich" to "DE_AT_CH", "Europe/Vaduz" to "DE_AT_CH",
        // UK / IE
        "Europe/London" to "UK_IE", "Europe/Belfast" to "UK_IE", "Europe/Guernsey" to "UK_IE",
        "Europe/Jersey" to "UK_IE", "Europe/Isle_of_Man" to "UK_IE", "Europe/Gibraltar" to "UK_IE",
        "Europe/Dublin" to "UK_IE",
        // Nórdicos
        "Europe/Copenhagen" to "SCANDI", "Atlantic/Faroe" to "SCANDI",
        "Europe/Oslo" to "SCANDI", "Arctic/Longyearbyen" to "SCANDI",
        "Europe/Stockholm" to "SCANDI",
        "Europe/Helsinki" to "SCANDI", "Europe/Mariehamn" to "SCANDI",
        "Atlantic/Reykjavik" to "SCANDI",
        // Europa del Este (EE)
        "Europe/Warsaw" to "EE", "Europe/Prague" to "EE", "Europe/Bratislava" to "EE",
        "Europe/Ljubljana" to "EE", "Europe/Zagreb" to "EE", "Europe/Budapest" to "EE",
        "Europe/Bucharest" to "EE", "Europe/Sofia" to "EE", "Europe/Tallinn" to "EE",
        "Europe/Riga" to "EE", "Europe/Vilnius" to "EE", "Europe/Belgrade" to "EE",
        "Europe/Sarajevo" to "EE", "Europe/Skopje" to "EE", "Europe/Podgorica" to "EE",
        "Europe/Tirane" to "EE", "Europe/Chisinau" to "EE", "Europe/Kiev" to "EE",
        "Europe/Kyiv" to "EE", "Europe/Uzhgorod" to "EE", "Europe/Zaporozhye" to "EE",
        "Europe/Simferopol" to "EE", "Europe/Minsk" to "EE",
        "Europe/Athens" to "EE", "Asia/Nicosia" to "EE", "Europe/Nicosia" to "EE",
        "Europe/Istanbul" to "EE", "Asia/Istanbul" to "EE", "Turkey" to "EE",
    )

    /** Set de TZs MENA (Norte de África + Oriente Medio). */
    private val MENA_TZS = setOf(
        "Africa/Cairo", "Africa/Algiers", "Africa/Tunis",
        "Africa/Casablanca", "Africa/El_Aaiun", "Africa/Tripoli",
        "Africa/Khartoum",
        "Asia/Riyadh", "Asia/Dubai", "Asia/Qatar", "Asia/Kuwait",
        "Asia/Bahrain", "Asia/Muscat", "Asia/Baghdad", "Asia/Tehran",
        "Asia/Jerusalem", "Asia/Tel_Aviv", "Asia/Beirut",
        "Asia/Damascus", "Asia/Amman", "Asia/Aden",
        "Asia/Hebron", "Asia/Gaza",
    )

    /** TZs de América del Norte (NORTEAM). El resto de America cae en LATAM. */
    private val NORTEAM_TZS = setOf(
        "America/New_York", "America/Chicago", "America/Denver",
        "America/Los_Angeles", "America/Phoenix", "America/Anchorage",
        "America/Adak", "America/Toronto", "America/Vancouver",
        "America/Edmonton", "America/Winnipeg", "America/Halifax",
        "America/St_Johns", "America/Detroit", "America/Indianapolis",
        "America/Boise", "America/Juneau", "Pacific/Honolulu",
        "America/Regina",
    )

    /**
     * Devuelve el grupo fino `broadcasts.country` para la TZ del device,
     * o `null` si no hay match (TZ rara, Europa no cubierta por grupo fino,
     * etc.). El cron usa ese valor para filtrar broadcasts en `tv_start`;
     * si es null cae al bucket continental por `region`.
     *
     * Paridad con `_detectUserGroup` en `js/shared.js` y `detectedCountryGroup`
     * en `RegionService.swift`. Mantener sincronizado.
     */
    fun detectedCountryGroup(timeZoneId: String = TimeZone.getDefault().id): String? {
        FINE_TZ_MAP[timeZoneId]?.let { return it }
        if (timeZoneId in MENA_TZS) return "MENA"
        if (timeZoneId in NORTEAM_TZS) return "NORTEAM"
        if (timeZoneId.startsWith("America/")) return "LATAM"
        if (timeZoneId.startsWith("Africa/")) return "AFRICA"
        if (timeZoneId.startsWith("Asia/") ||
            timeZoneId.startsWith("Pacific/") ||
            timeZoneId.startsWith("Australia/") ||
            timeZoneId == "Indian/Christmas" ||
            timeZoneId == "Indian/Cocos"
        ) return "ASIAPAC"
        return null
    }

    // ─── Etiquetas humanas para el sub-selector de país ─────────────

    /**
     * String resource para mostrar el nombre humano del grupo fino
     * `broadcasts.country` en la UI. Devuelve `null` para grupos desconocidos
     * (en ese caso el caller debería mostrar el código tal cual).
     */
    @StringRes
    fun countryGroupLabelRes(group: String): Int? = when (group) {
        "ES" -> R.string.country_group_es
        "PT" -> R.string.country_group_pt
        "FR" -> R.string.country_group_fr
        "BE" -> R.string.country_group_be
        "NL" -> R.string.country_group_nl
        "IT" -> R.string.country_group_it
        "DE_AT_CH" -> R.string.country_group_de_at_ch
        "UK_IE" -> R.string.country_group_uk_ie
        "SCANDI" -> R.string.country_group_scandi
        "EE" -> R.string.country_group_ee
        "NORTEAM" -> R.string.country_group_norteam
        "LATAM" -> R.string.country_group_latam
        "ASIAPAC" -> R.string.country_group_asiapac
        "MENA" -> R.string.country_group_mena
        "AFRICA" -> R.string.country_group_africa
        else -> null
    }

    /** Emoji decorativo del grupo fino. Hardcoded, paridad con iOS. */
    fun countryGroupEmoji(group: String): String = when (group) {
        "ES" -> "🇪🇸"
        "PT" -> "🇵🇹"
        "FR" -> "🇫🇷"
        "BE" -> "🇧🇪"
        "NL" -> "🇳🇱"
        "IT" -> "🇮🇹"
        "DE_AT_CH" -> "🇩🇪"
        "UK_IE" -> "🇬🇧"
        "SCANDI" -> "🇸🇪"
        "EE" -> "🇵🇱"
        "NORTEAM" -> "🇺🇸"
        "LATAM" -> "🌎"
        "ASIAPAC" -> "🌏"
        "MENA" -> "🌍"
        "AFRICA" -> "🌍"
        else -> "🏳️"
    }
}
