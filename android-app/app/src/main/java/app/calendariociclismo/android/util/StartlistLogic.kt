package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.StartlistRider
import app.calendariociclismo.android.data.model.StartlistTeam

/**
 * Lógica pura de las startlists. Espejo de `js/inscritos.js` (web) y de
 * `StartlistViewModel.fetchTeams` (iOS) — cambios SIEMPRE en paralelo.
 */
object StartlistLogic {

    /**
     * Orden de equipos por el dorsal del PRIMER corredor (mínimo dorsal > 0):
     * el `sortOrder` de BD es el orden de inserción del panel ("al tuntún"),
     * así que el orden canónico lo imponen los dorsales en cliente. Equipos
     * sin ningún dorsal → al final, conservando `sortOrder` entre ellos
     * (una startlist entera sin dorsales queda como hasta ahora).
     */
    fun teamsByFirstDorsal(
        teams: List<StartlistTeam>,
        riders: List<StartlistRider>,
    ): List<StartlistTeam> {
        val firstDorsal = riders
            .filter { (it.dorsal ?: 0) > 0 }
            .groupBy { it.teamId }
            .mapValues { (_, rs) -> rs.minOf { it.dorsal!! } }
        return teams.sortedWith(
            compareBy({ firstDorsal[it.id] ?: Int.MAX_VALUE }, { it.sortOrder })
        )
    }
}
