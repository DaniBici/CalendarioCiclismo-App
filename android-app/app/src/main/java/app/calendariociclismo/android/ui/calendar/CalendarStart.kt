package app.calendariociclismo.android.ui.calendar

import java.time.LocalDate
import java.time.YearMonth

/** Mes con el que abre el Calendario (Mes y Temporada). Terminada la
 *  temporada de carretera 2026, el Calendario abre en 2027. Espejo de
 *  `DateFormatting.calendarStart` en iOS. */
object CalendarStart {
    val EARLIEST: YearMonth = YearMonth.of(2027, 1)

    /** Mes en curso o, si es anterior a [EARLIEST], ese mes. */
    fun initial(today: LocalDate = LocalDate.now()): YearMonth =
        maxOf(YearMonth.from(today), EARLIEST)
}
