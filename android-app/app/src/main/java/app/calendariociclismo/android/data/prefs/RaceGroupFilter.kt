package app.calendariociclismo.android.data.prefs

import androidx.annotation.StringRes
import app.calendariociclismo.android.R

/**
 * Filtros predefinidos de grupo para notificaciones de carreras.
 *
 * Equivalente a `RaceFollowService.GroupFilter` en iOS.
 * [storageValue] coincide con el `filterKey` del CHECK constraint en
 * `push_race_filters` y con los valores devueltos por `get_race_filter_keys`.
 */
enum class RaceGroupFilter(
    val storageValue: String,
    @StringRes val labelRes: Int,
) {
    WT_MALE("wt_male", R.string.race_filter_wt_male),
    WT_FEMALE("wt_female", R.string.race_filter_wt_female),
    GRAND_TOURS("grand_tours", R.string.race_filter_grand_tours),
    PRO_MALE("pro_male", R.string.race_filter_pro_male),
    PRO_FEMALE("pro_female", R.string.race_filter_pro_female);

    companion object {
        fun fromStorage(raw: String?): Set<RaceGroupFilter> {
            if (raw.isNullOrEmpty()) return emptySet()
            return raw.split(",")
                .mapNotNull { v -> entries.firstOrNull { it.storageValue == v.trim() } }
                .toSet()
        }

        fun toStorage(set: Set<RaceGroupFilter>): String =
            entries.filter { set.contains(it) }.joinToString(",") { it.storageValue }

        fun toRawList(set: Set<RaceGroupFilter>): List<String> =
            entries.filter { set.contains(it) }.map { it.storageValue }
    }
}
