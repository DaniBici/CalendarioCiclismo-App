package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.CxCategory
import app.calendariociclismo.android.data.model.CxRace
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class CxResultsFeedLogicTest {
    @Before fun spanish() { LocaleHolder.current = Locale("es", "ES") }

    private fun race(id: String, raceClass: String, date: String, vararg categories: CxCategory, cancelled: Boolean = false) =
        CxRace(id, "Carrera $id", slug = id, seasonKey = "2026-27", dateKey = date, raceClass = raceClass,
            isCancelled = cancelled, categories = categories.toList())

    private fun result(code: String, date: String, winner: String? = "Ganador $code", status: String = "official") =
        CxCategory(code, dateKey = date, resultsStatus = status, winnerName = winner)

    @Test fun `agrupa por dia en cronologia inversa y reparte las categorias por dia`() {
        val twoDays = race("dos", "C1", "2026-11-01",
            result("WJ", "2026-11-01"), result("ME", "2026-11-02"), result("WE", "2026-11-01"), result("MU", "2026-11-02", status = "pending"))
        val days = CxResultsFeedLogic.days(listOf(twoDays), "2026-27")
        assertEquals(listOf("2026-11-02", "2026-11-01"), days.map { it.date })
        assertEquals(listOf("ME"), days[0].entries.single().categories.map { it.category })
        assertEquals(listOf("WE", "WJ"), days[1].entries.single().categories.map { it.category })
    }

    @Test fun `solo categorias publicadas con ganador y carreras listadas de la temporada`() {
        val day = "2026-10-12"
        val races = listOf(
            race("sin-ganador", "C2", day, result("ME", day, winner = null), result("WE", day, winner = "Cancelled")),
            race("pendiente", "C2", day, result("ME", day, status = "pending")),
            race("provisional", "C2", day, result("ME", day, status = "provisional")),
            race("cancelada", "C1", day, result("ME", day), cancelled = true),
            race("otra-temporada", "C1", day, result("ME", day)).copy(seasonKey = "2025-26"),
        )
        val days = CxResultsFeedLogic.days(races, "2026-27")
        assertEquals(listOf("provisional"), days.single().entries.map { it.race.id })
    }
}
