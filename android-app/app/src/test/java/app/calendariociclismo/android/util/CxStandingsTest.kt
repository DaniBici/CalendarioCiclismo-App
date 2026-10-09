package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.*
import java.util.Locale
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class CxStandingsTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val matcher = UciResultsLogic.TeamMatcher(emptyList())
    private fun standing(id: String, rank: Int, category: String = "ME", timeSeconds: Long? = null, points: Double? = null, rider: String? = null) =
        CxStanding(id, "t", "2026-27", category, rank, "Rider $id", points = points, timeSeconds = timeSeconds, globalRiderId = rider)

    @Test fun `diferencias de tiempo en formato prensa y misma marca`() {
        assertEquals("+45\"", CxPresentation.standingGap(45, english = false))
        assertEquals("+1'45\"", CxPresentation.standingGap(105, english = false))
        assertEquals("+1:02:03", CxPresentation.standingGap(3723, english = false))
        assertEquals("m.t.", CxPresentation.standingGap(0, english = false))
        assertEquals("s.t.", CxPresentation.standingGap(0, english = true))
    }

    @Test fun `general por tiempo muestra el total del lider y la diferencia del resto`() {
        val rows = listOf(standing("c", 3, timeSeconds = 7305), standing("a", 1, timeSeconds = 7200), standing("b", 2, timeSeconds = 7200),
            standing("d", 4, timeSeconds = null))
        val vm = CxPresentation.standingRows(rows, "time", Locale("es"), matcher)
        assertEquals(listOf(1, 2, 3, 4), vm.map { it.rank })
        assertEquals(UciResultsLogic.ValueKind.WINNER_TIME, vm[0].valueKind)
        assertEquals("2:00:00", vm[0].valueText)
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vm[1].valueKind)
        assertEquals("m.t.", vm[1].valueText)
        assertEquals("+1'45\"", vm[2].valueText)
        assertEquals("-", vm[3].valueText)
        assertEquals("s.t.", CxPresentation.standingRows(rows, "time", Locale.UK, matcher)[1].valueText)
        assertEquals(UciResultsLogic.ValueKind.POINTS, CxPresentation.standingRows(rows, "points", Locale.UK, matcher)[0].valueKind)
    }

    @Test fun `desglose por ronda tolera puntos en texto o numero y tacha los descartados`() {
        val state = json.decodeFromString<CxStandingState>("""{"category":"ME","status":"ready","roundIds":["r1","r2","r3","r4"],
            "breakdown":[{"globalRiderId":"g1","eligible":true,"rounds":[{"raceId":"r1","points":"40","retained":true,"sourceRank":1},
            {"raceId":"r2","points":12.5,"retained":false},{"raceId":"r3","points":"0"},{"raceId":"r4","points":30,"missing":true}]},
            {"globalRiderId":"g2","rounds":"roto"},{"sinId":true}]}""")
        assertEquals(listOf("g1"), state.breakdown.map { it.globalRiderId })
        assertEquals(40.0, state.breakdown[0].rounds[0].points!!, 0.0)
        val breakdown = CxPresentation.standingsBreakdown(state, "points", Locale("es"))!!
        assertEquals(listOf(CxRoundCell("40", false), CxRoundCell("12,5", true), CxRoundCell("-", false), CxRoundCell("-", false)),
            breakdown.cells(standing("a", 1, rider = "g1")))
        assertEquals(List(4) { CxRoundCell("-", false) }, breakdown.cells(standing("b", 2, rider = "desconocido")))
        assertEquals(List(4) { CxRoundCell("-", false) }, breakdown.cells(standing("c", 3)))
        assertNull(CxPresentation.standingsBreakdown(state.copy(status = "manual"), "points", Locale("es")))
        assertNull(CxPresentation.standingsBreakdown(state, "time", Locale("es")))
        assertNull(CxPresentation.standingsBreakdown(state.copy(breakdown = emptyList()), "points", Locale("es")))
        // La caché guarda el desglose y un JSON antiguo sin él sigue decodificando.
        assertEquals(state, json.decodeFromString<CxStandingState>(json.encodeToString(state)))
        assertEquals(emptyList<CxBreakdownEntry>(), json.decodeFromString<CxStandingState>("""{"category":"ME","status":"ready","roundIds":["r1"]}""").breakdown)
        assertEquals(emptyList<CxBreakdownEntry>(), json.decodeFromString<CxStandingState>("""{"category":"ME","status":"ready","breakdown":null}""").breakdown)
    }

    @Test fun `cabecera de ronda usa el numero del torneo o su posicion`() {
        assertEquals("#4", CxPresentation.roundHeader("r1", 0, mapOf("r1" to CxRound(4, 8))))
        assertEquals("#2", CxPresentation.roundHeader("r2", 1, emptyMap()))
    }

    @Test fun `generales del torneo sin la condicion de ronda de la ficha`() {
        val rows = listOf(standing("a", 1, "WE"), standing("b", 1, "ME"), standing("c", 1, "MU"), standing("d", 1, "WU"))
        val states = listOf(CxStandingState("ME", "ready", listOf("otra")), CxStandingState("WE", "manual"), CxStandingState("MU", "needs_review"),
            CxStandingState("MJ", "ready"))
        assertEquals(listOf("ME", "WE", "WU"), CxPresentation.tournamentGeneralCategories(rows, states))
        assertTrue(CxPresentation.tournamentGeneralCategories(emptyList(), states).isEmpty())
    }
}
