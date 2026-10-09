package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.CxCategory
import app.calendariociclismo.android.data.model.CxRace

/**
 * Pestaña Ciclocross de Resultados: pruebas CX de la temporada con al menos
 * una categoría con resultados publicados (`official` o `provisional`) y
 * ganador, agrupadas por día en cronología inversa. Una prueba con categorías
 * en días distintos aparece en cada día con las categorías de ese día.
 */
object CxResultsFeedLogic {
    /** Prueba de un día con sus categorías con resultados, en orden ME…WJ. */
    data class Entry(val race: CxRace, val date: String, val categories: List<CxCategory>)

    data class Day(val date: String, val entries: List<Entry>)

    private val publishedStatuses = setOf("official", "provisional")

    fun hasWinner(category: CxCategory): Boolean =
        category.resultsStatus in publishedStatuses && ResultsFeedLogic.cleanWinner(category.winnerName).isNotBlank()

    /** Días con resultados, del más reciente al más antiguo; dentro de cada
     *  día, el orden de la agenda CX ([CyclocrossLogic.racesOn]). */
    fun days(races: List<CxRace>, season: String): List<Day> {
        val listed = races.filter { it.seasonKey == season && CxPresentation.listedInAgenda(it) }.distinctBy { it.id }
        val byDate = linkedMapOf<String, MutableList<Entry>>()
        for (race in listed) {
            for (date in CyclocrossLogic.dates(race)) {
                val categories = CyclocrossLogic.categoriesOn(race, date).filter(::hasWinner)
                if (categories.isNotEmpty()) byDate.getOrPut(date) { mutableListOf() }.add(Entry(race, date, categories))
            }
        }
        return byDate.keys.sortedDescending().map { date ->
            val entries = byDate.getValue(date)
            val order = CyclocrossLogic.racesOn(entries.map { it.race }, date).map { it.id }
            Day(date, entries.sortedBy { order.indexOf(it.race.id) })
        }
    }
}
