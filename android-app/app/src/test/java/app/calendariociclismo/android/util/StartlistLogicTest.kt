package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.StartlistRider
import app.calendariociclismo.android.data.model.StartlistTeam
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Orden de equipos por el dorsal del primer corredor. Espejo de la regla de
 * `js/inscritos.js` (web) y `StartlistViewModel` (iOS).
 */
class StartlistLogicTest {

    private fun team(id: String, sortOrder: Int) =
        StartlistTeam(id = id, raceId = "r", teamName = id, sortOrder = sortOrder)

    private fun rider(teamId: String, dorsal: Int?) =
        StartlistRider(id = "$teamId-$dorsal", teamId = teamId, raceId = "r", dorsal = dorsal)

    @Test
    fun `ordena por el minimo dorsal del equipo, no por sortOrder`() {
        // En BD entraron al tuntún: sortOrder dice C, A, B; los dorsales dicen A(1), B(11), C(21).
        val teams = listOf(team("C", 0), team("A", 1), team("B", 2))
        val riders = listOf(
            rider("C", 21), rider("C", 22),
            rider("A", 2), rider("A", 1),     // desordenados: manda el MÍNIMO
            rider("B", 11),
        )
        val sorted = StartlistLogic.teamsByFirstDorsal(teams, riders)
        assertEquals(listOf("A", "B", "C"), sorted.map { it.id })
    }

    @Test
    fun `equipos sin dorsal van al final conservando sortOrder`() {
        val teams = listOf(team("sin2", 5), team("conDorsal", 9), team("sin1", 3))
        val riders = listOf(
            rider("conDorsal", 7),
            rider("sin1", null), rider("sin1", 0),   // 0 y null = sin dorsal
            rider("sin2", null),
        )
        val sorted = StartlistLogic.teamsByFirstDorsal(teams, riders)
        assertEquals(listOf("conDorsal", "sin1", "sin2"), sorted.map { it.id })
    }

    @Test
    fun `startlist entera sin dorsales mantiene el orden del panel`() {
        val teams = listOf(team("x", 1), team("y", 2), team("z", 3))
        val riders = listOf(rider("x", 0), rider("y", null), rider("z", 0))
        val sorted = StartlistLogic.teamsByFirstDorsal(teams, riders)
        assertEquals(listOf("x", "y", "z"), sorted.map { it.id })
    }

    @Test
    fun `equipo sin corredores va al final`() {
        val teams = listOf(team("vacio", 0), team("lleno", 1))
        val riders = listOf(rider("lleno", 31))
        val sorted = StartlistLogic.teamsByFirstDorsal(teams, riders)
        assertEquals(listOf("lleno", "vacio"), sorted.map { it.id })
    }

    @Test
    fun `el dorsal 0 placeholder no cuenta como primer dorsal`() {
        // Si el equipo A tiene un 0 colado, su clave es el primer dorsal REAL (40),
        // no el 0 — debe ir detrás de B(12).
        val teams = listOf(team("A", 0), team("B", 1))
        val riders = listOf(rider("A", 0), rider("A", 40), rider("B", 12))
        val sorted = StartlistLogic.teamsByFirstDorsal(teams, riders)
        assertEquals(listOf("B", "A"), sorted.map { it.id })
    }
}
