package app.calendariociclismo.android.util

import java.time.LocalDate

/** Pestañas de la sección Resultados. */
enum class ResultsSection { CYCLOCROSS, ROAD, RANKING }

/**
 * Pestañas visibles, pestaña inicial y etiqueta de la de carretera:
 * con [roadLabelShort] se rotula «Carretera»; sin él, «Últimos resultados».
 */
data class ResultsSectionsLayout(
    val sections: List<ResultsSection>,
    val initial: ResultsSection,
    val roadLabelShort: Boolean,
)

/**
 * Regla de pestañas de Resultados según la fecha civil local:
 * - Hoy de carretera oculta ([RoadTodayAvailability]): Ciclocross, Carretera
 *   y Ránking UCI, con Ciclocross inicial.
 * - Desde que Hoy vuelve (1 de enero de 2027): Últimos resultados y Ránking
 *   UCI, como antes del cambio.
 * Espejo de la regla de la web y de iOS.
 */
object ResultsSections {
    fun layout(today: LocalDate = LocalDate.now()): ResultsSectionsLayout = when {
        !RoadTodayAvailability.isVisible(today) -> ResultsSectionsLayout(
            listOf(ResultsSection.CYCLOCROSS, ResultsSection.ROAD, ResultsSection.RANKING),
            ResultsSection.CYCLOCROSS,
            roadLabelShort = true,
        )
        else -> ResultsSectionsLayout(
            listOf(ResultsSection.ROAD, ResultsSection.RANKING),
            ResultsSection.ROAD,
            roadLabelShort = false,
        )
    }
}
