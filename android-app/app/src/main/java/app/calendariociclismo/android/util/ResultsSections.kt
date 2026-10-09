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
 * Regla de pestañas de Resultados: Últimos resultados y Ránking UCI, con la
 * de carretera inicial. La pestaña Ciclocross queda fuera de la 5.0.14 y
 * vuelve con la 5.0.15, junto con Hoy de carretera oculta. Espejo de iOS.
 */
object ResultsSections {
    @Suppress("UNUSED_PARAMETER")
    fun layout(today: LocalDate = LocalDate.now()): ResultsSectionsLayout = ResultsSectionsLayout(
        listOf(ResultsSection.ROAD, ResultsSection.RANKING),
        ResultsSection.ROAD,
        roadLabelShort = false,
    )
}
