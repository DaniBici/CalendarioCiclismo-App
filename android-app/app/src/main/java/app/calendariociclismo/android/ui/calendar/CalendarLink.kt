package app.calendariociclismo.android.ui.calendar

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.calendariociclismo.android.util.Constants

/**
 * Año, filtro y mes compartidos por Temporada y la agenda en la maqueta ancha
 * de [CalendarScreen]. Temporada lleva los selectores de año y filtro; el mes
 * se mueve desde cualquiera de las dos vistas.
 */
@Stable
class CalendarLink {
    var year by mutableIntStateOf(CalendarStart.initial().year)
    var category by mutableStateOf(Constants.CategoryFilter.ALL)
    /** Mes visible de 1 a 12. «Todos» de Temporada no lo modifica. */
    var month by mutableIntStateOf(CalendarStart.initial().monthValue)
}
