package app.calendariociclismo.android.data.prefs

/**
 * Modo de seguimiento de carreras para notificaciones push.
 *
 * Equivalente a `RaceFollowService.FollowMode` en iOS.
 *
 * - [FOLLOW_ALL]     → comportamiento pre-2.0: recibe notificaciones de TODAS las carreras.
 *                      No hay filas en `push_race_subscriptions` ni `push_race_filters`.
 * - [FOLLOW_RACES]   → solo carreras seguidas individualmente.
 * - [FOLLOW_FILTERS] → solo carreras que encajen en los filtros de grupo activos.
 */
enum class RaceFollowMode(val storageValue: String) {
    FOLLOW_ALL("follow_all"),
    FOLLOW_RACES("follow_races"),
    FOLLOW_FILTERS("follow_filters");

    companion object {
        fun fromStorage(raw: String?): RaceFollowMode =
            entries.firstOrNull { it.storageValue == raw } ?: FOLLOW_ALL
    }
}
