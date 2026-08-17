package app.calendariociclismo.android.data.prefs

import androidx.annotation.StringRes
import app.calendariociclismo.android.R

/**
 * Preferencia regional seleccionada por el usuario en Ajustes → Región.
 *
 * Equivalente a `RegionService.RegionPreference` en iOS. Determina qué
 * grupos de [Broadcast.country] son visibles en la UI.
 *
 * - [SPAIN] es el baseline gratuito heredado de 1.4.4 — `ALL + ES + EUROPA`.
 *   Cualquier instalación pre-2.0 que actualice mantiene este valor por
 *   defecto y sigue viendo lo mismo de siempre.
 * - Todas las opciones son gratuitas desde 4.3.
 *
 * El mapping de cada región a los grupos `broadcasts.country` permitidos
 * vive en [allowedBroadcastGroups]. Los broadcasts sin `country` se tratan
 * como globales en [app.calendariociclismo.android.util.RaceLogic.filterBroadcastsByRegion].
 */
enum class RegionPreference(@StringRes val labelRes: Int) {
    SPAIN(R.string.region_spain),
    EUROPE(R.string.region_europe),
    AMERICAS(R.string.region_americas),
    ASIA(R.string.region_asia),
    AFRICA(R.string.region_africa),
    ALL(R.string.region_all);

    /**
     * Conjunto de valores `broadcasts.country` que son visibles cuando esta
     * preferencia está activa. Los broadcasts sin `country` se consideran
     * globales y se muestran siempre (compatibilidad con datos antiguos).
     */
    val allowedBroadcastGroups: Set<String>
        get() = when (this) {
            SPAIN -> setOf("ALL", "EUROPA", "ES")
            EUROPE -> setOf(
                "ALL", "EUROPA",
                "ES", "PT", "FR", "BE", "NL", "IT",
                "DE_AT_CH", "UK_IE", "SCANDI", "EE",
            )
            AMERICAS -> setOf("ALL", "NORTEAM", "LATAM")
            ASIA -> setOf("ALL", "ASIAPAC", "MENA")
            AFRICA -> setOf("ALL", "AFRICA", "MENA")
            ALL -> setOf(
                "ALL", "EUROPA",
                "ES", "PT", "FR", "BE", "NL", "IT",
                "DE_AT_CH", "UK_IE", "SCANDI", "EE",
                "NORTEAM", "LATAM",
                "ASIAPAC", "MENA",
                "AFRICA",
            )
        }

    /**
     * Grupos finos `broadcasts.country` que el usuario puede elegir como
     * "país preferido" dentro de este bucket. Se usan para sobrescribir la
     * detección automática por TZ al afinar `tv_start`.
     *
     * SPAIN solo expone ES (un único grupo fino, sin elección). ALL no
     * expone sub-selector — usa la TZ siempre (usuario itinerante). El
     * resto exponen los grupos finos relevantes.
     *
     * Paridad con `RegionPreference.availableCountryGroups` en iOS.
     */
    val availableCountryGroups: List<String>
        get() = when (this) {
            SPAIN -> listOf("ES")
            EUROPE -> listOf("ES", "PT", "FR", "BE", "NL", "IT",
                "DE_AT_CH", "UK_IE", "SCANDI", "EE")
            AMERICAS -> listOf("NORTEAM", "LATAM")
            ASIA -> listOf("ASIAPAC", "MENA")
            AFRICA -> listOf("AFRICA", "MENA")
            ALL -> emptyList()
        }

    companion object {
        /** Parser tolerante: cualquier valor desconocido vuelve a [SPAIN]. */
        fun fromStorage(raw: String?): RegionPreference =
            runCatching { raw?.let { valueOf(it) } }.getOrNull() ?: SPAIN
    }
}
