package app.calendariociclismo.android.data.prefs

import androidx.annotation.StringRes
import app.calendariociclismo.android.R

/**
 * Tipos de notificación push expuestos al usuario en Ajustes.
 *
 * Equivalente a `NotificationCategoryService.NotificationCategory` en iOS.
 * El [storageValue] coincide con el valor `category` del Edge Function
 * `send-push` y con el CHECK de `push_subscription_categories.category`.
 *
 * - [GENERAL] es el baseline gratuito heredado de 1.4.4 — anuncios y
 *   novedades del equipo. NUNCA se puede desactivar (regla "no degradar
 *   lo gratis": cubre todo lo que recibía la app gratuita).
 * - [RACE_START], [TV_START] y [RESULTS] también son gratuitas desde 4.3.
 */
enum class NotificationCategoryPreference(
    val storageValue: String,
    @StringRes val labelRes: Int,
    @StringRes val descriptionRes: Int,
) {
    GENERAL(
        storageValue = "general",
        labelRes = R.string.notification_category_general,
        descriptionRes = R.string.notification_category_general_description,
    ),
    RACE_START(
        storageValue = "race_start",
        labelRes = R.string.notification_category_race_start,
        descriptionRes = R.string.notification_category_race_start_description,
    ),
    TV_START(
        storageValue = "tv_start",
        labelRes = R.string.notification_category_tv_start,
        descriptionRes = R.string.notification_category_tv_start_description,
    ),
    RESULTS(
        storageValue = "results",
        labelRes = R.string.notification_category_results,
        descriptionRes = R.string.notification_category_results_description,
    );

    companion object {
        /** Conjunto inicial mientras no haya nada persistido en DataStore. */
        val DEFAULT_ENABLED: Set<NotificationCategoryPreference> = setOf(GENERAL)

        /** Parser tolerante: ignora valores desconocidos. */
        fun fromStorage(raw: String?): Set<NotificationCategoryPreference> {
            if (raw.isNullOrEmpty()) return DEFAULT_ENABLED
            val parsed = raw.split(",")
                .mapNotNull { v -> entries.firstOrNull { it.storageValue == v.trim() } }
                .toSet()
            // GENERAL siempre presente (no degradar lo gratis).
            return parsed + GENERAL
        }

        /** Serialización CSV para persistencia en DataStore. */
        fun toStorage(set: Set<NotificationCategoryPreference>): String {
            val ordered = entries.filter { set.contains(it) }
            return ordered.joinToString(",") { it.storageValue }
        }

        /** Lista ordenada de storageValues — input para la RPC server. */
        fun toRawList(set: Set<NotificationCategoryPreference>): List<String> =
            entries.filter { set.contains(it) }.map { it.storageValue }
    }
}
