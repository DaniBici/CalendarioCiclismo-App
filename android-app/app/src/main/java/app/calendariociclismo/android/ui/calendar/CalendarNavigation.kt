package app.calendariociclismo.android.ui.calendar

import kotlinx.coroutines.flow.MutableStateFlow

/** Temporada pedida por el cintillo; `SeasonScreen` la aplica y la limpia. */
object CalendarNavigation {
    val pendingSeasonYear = MutableStateFlow<Int?>(null)
}
