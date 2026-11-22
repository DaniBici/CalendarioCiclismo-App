package app.calendariociclismo.android.ui.calendar

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue

/**
 * Año y mes compartidos por Temporada y la agenda en la maqueta ancha de
 * [CalendarScreen]. Temporada lleva el selector de año y los filtros (estos,
 * compartidos por AppPreferences); el mes se mueve desde cualquiera de las dos
 * vistas.
 */
@Stable
class CalendarLink {
    var year by mutableIntStateOf(CalendarStart.initial().year)
    /** Mes visible de 1 a 12. «Todos» de Temporada no lo modifica. */
    var month by mutableIntStateOf(CalendarStart.initial().monthValue)
}
