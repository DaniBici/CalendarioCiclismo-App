package app.calendariociclismo.android.ui.today

import app.calendariociclismo.android.data.model.*
import app.calendariociclismo.android.util.CxPresentation
import java.util.Locale
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class CxHighlightTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val race = CxRace("cx-1", "Prueba local", nameEn = "Local race", slug = "prueba", seasonKey = "2026-27", dateKey = "2027-01-31", raceClass = "CM", categories = listOf(CxCategory("ME")))

    @Test fun `cintillo CX usa destino propio y conserva compatibilidad de los documentos anteriores`() {
        val highlight = json.decodeFromString<TodayHighlight>("""{"id":"highlight-1","targetType":"cxRace","cxRaceId":"cx-1"}""")
        val item = HighlightItem.forCx(highlight, race)!!
        assertNull(item.race); assertNull(item.raceDay)
        assertEquals("cx-1", item.cxRace?.id)
        assertEquals("Local race", item.title(true))
        assertEquals("Prueba local", item.title(false))
        assertNull(HighlightItem.forCx(highlight, null))
        assertNull(HighlightItem.forCx(highlight, race.copy(id = "otro")))
        val old = json.decodeFromString<TodayHighlight>("""{"id":"old","targetType":"race","raceId":"cx-1"}""")
        assertNull(old.cxRaceId)
        assertNull(HighlightItem.forCx(old, race))
    }

    @Test fun `el cintillo CX resuelve el torneo como destino propio`() {
        val tournament = CxTournament("t1", "Copa del Mundo", nameEn = "World Cup", slug = "world-cup", seasonKey = "2026-27", logoUrl = "https://example.org/series.png")
        val highlight = json.decodeFromString<TodayHighlight>("""{"id":"highlight-t","targetType":"cxTournament","cxTournamentId":"t1"}""")
        val item = HighlightItem.forCxTournament(highlight, tournament)!!
        assertEquals("world-cup", item.cxTournament?.slug)
        assertEquals("Copa del Mundo", item.title(false))
        assertEquals("World Cup", item.title(true))
        assertEquals("2026-27", item.detailFallback(false, "2026-09-13", "2026-09-14"))
        assertEquals("https://example.org/series.png", item.logoUrl)
        assertNull(HighlightItem.forCxTournament(highlight, null))
        assertNull(HighlightItem.forCxTournament(highlight, tournament.copy(id = "otro")))
    }

    @Test fun `el cintillo no muestra fechas de marzo a julio ni finales fuera de ventana`() {
        val highlight = TodayHighlight("highlight-1", targetType = "cxRace", cxRaceId = race.id)
        for (month in 3..7) assertNull(HighlightItem.forCx(highlight, race.copy(dateKey = "2027-0$month-15")))
        assertNull(HighlightItem.forCx(highlight, race.copy(endDateKey = "2027-03-01")))
    }

    @Test fun `las generales usan solo la unidad configurada y WU derivada no genera manga`() {
        val tournament = CxTournament("x2o", "X2O", slug = "x2o", pointsScheme = json.parseToJsonElement("""{"categories":{"ME":{"mode":"time"},"WU":{"mode":"points"}}}""") as kotlinx.serialization.json.JsonObject)
        val configured = race.copy(tournament = tournament)
        val standing = json.decodeFromString<CxStanding>("""{"id":"standing-1","tournamentId":"x2o","seasonKey":"2026-27","category":"ME","rank":1,"riderDisplay":"Corredor local","points":99,"timeSeconds":90061}""")
        assertEquals("time", CxPresentation.standingMode(configured, "ME"))
        assertEquals("25:01:01", CxPresentation.standingValue(standing, "time", Locale.ROOT))
        assertEquals("99", CxPresentation.standingValue(standing, "points", Locale.ROOT))
        assertEquals("—", CxPresentation.standingValue(standing.copy(timeSeconds = null), "time", Locale.ROOT))
        assertEquals("—", CxPresentation.standingValue(standing, null, Locale.ROOT))
        assertNull(CxPresentation.standingMode(configured, "WE"))
        assertEquals(listOf("ME"), CxPresentation.generalCategories(CxDetail(configured, standings = listOf(standing))))
        assertEquals(listOf("ME", "WU"), CxPresentation.generalCategories(CxDetail(configured, standings = listOf(standing, standing.copy(id = "standing-wu", category = "WU")))))
        assertFalse(configured.categories.any { it.category == "WU" })
    }
}
