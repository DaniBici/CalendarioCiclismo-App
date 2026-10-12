package app.calendariociclismo.android.util

import java.time.LocalDate

/**
 * Disponibilidad de la pestaña Hoy de carretera: oculta hasta [RETURN_DATE]
 * según la fecha civil local; desde ese día vuelve a ser la pestaña inicial.
 * Espejo de `RoadTodayAvailability` en iOS.
 */
object RoadTodayAvailability {
    val RETURN_DATE: LocalDate = LocalDate.of(2027, 1, 1)

    fun isVisible(today: LocalDate = LocalDate.now()): Boolean = !today.isBefore(RETURN_DATE)
}
