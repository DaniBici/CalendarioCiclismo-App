package app.calendariociclismo.android.util

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

/**
 * Disciplina inicial de Hoy, Resultados y Vídeos según la fecha civil local.
 * Cada año es Ciclocross desde el día siguiente a la Chrono des Nations (el
 * tercer domingo de octubre: 18-10-2026, 17-10-2027) hasta el domingo anterior
 * al primer lunes del año siguiente (el de 2027 es el 4 de enero); el resto del
 * año, Ruta. El primer periodo empieza el 19 de octubre de 2026. Sin ediciones
 * anuales. Espejo de `RoadTodayAvailability` en iOS y de `cyclocrossHome` en la
 * web.
 */
object RoadTodayAvailability {
    val FIRST_CYCLOCROSS_DAY: LocalDate = LocalDate.of(2026, 10, 19)

    /** Tercer domingo de octubre de [year]: día de la Chrono des Nations. */
    fun chronoDesNationsDay(year: Int): LocalDate =
        LocalDate.of(year, 10, 1).with(TemporalAdjusters.dayOfWeekInMonth(3, DayOfWeek.SUNDAY))

    /** Primer lunes de enero de [year]: día en que se vuelve a Ruta. */
    fun firstMondayOfYear(year: Int): LocalDate =
        LocalDate.of(year, 1, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))

    /** True si, en `today`, la disciplina inicial es Ciclocross. */
    fun isCyclocrossPeriod(today: LocalDate = LocalDate.now()): Boolean {
        if (today.isBefore(FIRST_CYCLOCROSS_DAY)) return false
        return if (today.monthValue >= 7) today.isAfter(chronoDesNationsDay(today.year))
        else today.isBefore(firstMondayOfYear(today.year))
    }

    /** True si Hoy de carretera es la pestaña inicial. */
    fun isVisible(today: LocalDate = LocalDate.now()): Boolean = !isCyclocrossPeriod(today)
}
