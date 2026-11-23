package app.calendariociclismo.android.ui.calendar

import app.calendariociclismo.android.util.RoadTodayAvailability
import java.time.LocalDate
import java.time.YearMonth

/** Mes con el que abre el Calendario (Mes y Temporada): el mes en curso o, de
 *  octubre a diciembre con la temporada de carretera cerrada, enero del año
 *  siguiente. Espejo de `DateFormatting.calendarStart` en iOS. */
object CalendarStart {
    fun initial(today: LocalDate = LocalDate.now()): YearMonth =
        if (RoadTodayAvailability.isCyclocrossPeriod(today) && today.monthValue >= 7) {
            YearMonth.of(today.year + 1, 1)
        } else {
            YearMonth.from(today)
        }
}
