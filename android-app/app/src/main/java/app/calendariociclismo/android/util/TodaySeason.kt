package app.calendariociclismo.android.util

/**
 * Último día de la temporada de carretera en Hoy, por año natural. Desde el
 * día siguiente y hasta el 31 de diciembre de ese año, Hoy no muestra ni
 * permite alcanzar fechas posteriores: el selector termina en este día y la
 * vista se queda en él. Un año sin entrada no tiene límite.
 * Espejo de `js/services/today-season.js` y de `TodaySeason` en iOS.
 */
object TodaySeason {
    val lastDayByYear: Map<Int, String> = mapOf(
        2026 to "2026-10-18",
    )

    /** Último día navegable según la fecha local actual, o null. */
    fun lastDay(today: String = DateFormatting.todayKey()): String? =
        today.take(4).toIntOrNull()?.let { lastDayByYear[it] }

    /** La propia fecha o, si lo supera, el último día de temporada. */
    fun clamp(dateKey: String, today: String = DateFormatting.todayKey()): String {
        val last = lastDay(today) ?: return dateKey
        return if (dateKey > last) last else dateKey
    }

    fun contains(dateKey: String, today: String = DateFormatting.todayKey()): Boolean {
        val last = lastDay(today) ?: return true
        return dateKey <= last
    }
}
