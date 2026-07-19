package app.calendariociclismo.android

import app.calendariociclismo.android.data.model.RiderProfile
import app.calendariociclismo.android.data.model.RiderTransfer
import app.calendariociclismo.android.data.model.TeamSeason
import app.calendariociclismo.android.util.TransfersLogic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests de la lógica pura de Fichajes (apps 4.0) — espejo de las reglas de
 * `js/fichajes.js` (web) verificadas en navegador con datos reales.
 */
class TransfersLogicTest {

    private fun transfer(
        id: String,
        riderId: String,
        type: String = "transfer",
        status: String = "confirmed",
        from: String? = null,
        to: String? = null,
        contractUntil: Int? = null,
        announcedAt: String? = "2026-07-10",
        createdAt: String? = null,
        dateVisible: Boolean = true,
    ) = RiderTransfer(
        id = id, season = 2027, riderId = riderId, riderGender = "male",
        fromTeamId = from, toTeamId = to, type = type, status = status,
        contractUntil = contractUntil, announcedAt = announcedAt, createdAt = createdAt,
        dateVisible = dateVisible,
    )

    private fun rider(id: String, last: String, contractUntil: Int? = null) = RiderProfile(
        id = id, firstName = "Test", lastName = last, nationality = "es",
        currentTeamId = "team_a", contractUntil = contractUntil,
    )

    // ── Feed ──────────────────────────────────────────────────────

    @Test
    fun feedExcludesRumors() {
        val feed = TransfersLogic.confirmedFeed(
            listOf(
                transfer("t1", "r1", status = "confirmed", to = "team_b"),
                transfer("t2", "r2", status = "rumor", to = "team_b"),
            )
        )
        assertEquals(listOf("t1"), feed.map { it.id })
    }

    @Test
    fun feedSortsReverseChronological() {
        val feed = TransfersLogic.confirmedFeed(
            listOf(
                transfer("old", "r1", announcedAt = "2026-07-01", to = "team_b"),
                transfer("new", "r2", announcedAt = "2026-07-12", to = "team_b"),
                transfer("mid", "r3", announcedAt = "2026-07-05", to = "team_b"),
            )
        )
        assertEquals(listOf("new", "mid", "old"), feed.map { it.id })
    }

    @Test
    fun groupByDayKeepsOrderAndGroups() {
        val feed = listOf(
            transfer("a", "r1", announcedAt = "2026-07-12", to = "team_b"),
            transfer("b", "r2", announcedAt = "2026-07-12", to = "team_b"),
            transfer("c", "r3", announcedAt = "2026-07-10", to = "team_b"),
        )
        val grouped = TransfersLogic.groupByDay(feed)
        assertEquals(2, grouped.size)
        assertEquals("2026-07-12", grouped[0].first)
        assertEquals(2, grouped[0].second.size)
        assertEquals("2026-07-10", grouped[1].first)
    }

    // ── Divisiones ────────────────────────────────────────────────

    @Test
    fun divisionTeamsFiltersAndSortsAlphabetically() {
        val seasons = listOf(
            TeamSeason(teamId = "b", year = 2027, name = "Movistar", category = "WT"),
            TeamSeason(teamId = "a", year = 2027, name = "Alpecin", category = "WT"),
            TeamSeason(teamId = "c", year = 2027, name = "Lidl-Trek Women", category = "WWT"),
        )
        val wt = TransfersLogic.divisionTeams(seasons, "WT")
        assertEquals(listOf("Alpecin", "Movistar"), wt.map { it.name })
    }

    // ── Detalle de equipo ─────────────────────────────────────────

    @Test
    fun confirmedDepartureRemovesFromStaying() {
        val roster = listOf(rider("r1", "Uno"), rider("r2", "Dos"))
        val moves = listOf(transfer("t1", "r1", from = "team_a", to = "team_b"))
        val detail = TransfersLogic.teamDetail(moves, roster, "team_a")
        assertEquals(listOf("r2"), detail.staying.map { it.rider.id })
        assertEquals(listOf("t1"), detail.departures.map { it.id })
    }

    @Test
    fun rumoredDepartureAlsoRemovesFromStayingAndFlagsRumor() {
        // Regla Dani: el rumor de salida pasa al corredor a baja·Rumor (y a
        // alta·Rumor en el destino) — deja de listarse en "continúan".
        val roster = listOf(rider("r1", "Uno"))
        val moves = listOf(transfer("t1", "r1", status = "rumor", from = "team_a", to = "team_b"))
        val detailA = TransfersLogic.teamDetail(moves, roster, "team_a")
        assertTrue(detailA.staying.isEmpty())
        assertEquals("rumor", detailA.departures.single().status)
        val detailB = TransfersLogic.teamDetail(moves, emptyList(), "team_b")
        assertEquals("rumor", detailB.arrivals.single().status)
    }

    @Test
    fun retirementCountsAsDeparture() {
        val roster = listOf(rider("r1", "Uno"))
        val moves = listOf(transfer("t1", "r1", type = "retirement", from = "team_a"))
        val detail = TransfersLogic.teamDetail(moves, roster, "team_a")
        assertTrue(detail.staying.isEmpty())
        assertEquals("retirement", detail.departures.single().type)
    }

    @Test
    fun renewalContractWinsOverProfileAndRumorFlagsRow() {
        val roster = listOf(rider("r1", "Uno", contractUntil = 2027), rider("r2", "Dos", contractUntil = 2027))
        val moves = listOf(
            transfer("t1", "r1", type = "renewal", to = "team_a", contractUntil = 2029),
            transfer("t2", "r2", type = "renewal", status = "rumor", to = "team_a", contractUntil = 2030),
        )
        val detail = TransfersLogic.teamDetail(moves, roster, "team_a")
        val byId = detail.staying.associateBy { it.rider.id }
        assertEquals(2029, byId["r1"]?.contractUntil)
        assertFalse(byId["r1"]!!.isRumor)
        assertEquals(2030, byId["r2"]?.contractUntil)
        assertTrue(byId["r2"]!!.isRumor)
    }

    @Test
    fun stayingFallsBackToProfileContract() {
        val roster = listOf(rider("r1", "Uno", contractUntil = 2028))
        val detail = TransfersLogic.teamDetail(emptyList(), roster, "team_a")
        assertEquals(2028, detail.staying.single().contractUntil)
        assertFalse(detail.staying.single().isRumor)
    }

    @Test
    fun stayingSortsByLastName() {
        val roster = listOf(rider("r1", "Zubeldia"), rider("r2", "Aular"))
        val detail = TransfersLogic.teamDetail(emptyList(), roster, "team_a")
        assertEquals(listOf("r2", "r1"), detail.staying.map { it.rider.id })
    }

    // ── Etiquetas de equipo ───────────────────────────────────────

    @Test
    fun teamLabelPrefersCatalogThenFreeTextThenUnknown() {
        val names = mapOf("team_a" to "Movistar 2027")
        assertEquals("Movistar 2027", TransfersLogic.teamLabel("team_a", null, names, "?"))
        assertEquals("Júnior X", TransfersLogic.teamLabel(null, "Júnior X", names, "?"))
        assertEquals("?", TransfersLogic.teamLabel(null, null, names, "?"))
    }

    @Test
    fun teamLabelUsesCurrentSeasonNameForOriginAndMarketNameForDestination() {
        // Mismo equipo, renombrado para el mercado: de dónde sale un corredor
        // se lee con el nombre de la temporada en curso; a dónde va, con el nuevo.
        val names = mapOf("team_a" to "Nuevo Sponsor 2027")
        val namesPrev = mapOf("team_a" to "Viejo Sponsor 2026")
        assertEquals(
            "Viejo Sponsor 2026",
            TransfersLogic.teamLabel("team_a", null, names, "?", TransfersLogic.TeamSide.FROM, namesPrev)
        )
        assertEquals(
            "Nuevo Sponsor 2027",
            TransfersLogic.teamLabel("team_a", null, names, "?", TransfersLogic.TeamSide.TO, namesPrev)
        )
    }

    @Test
    fun teamLabelFallsBackToTheOtherSeasonWhenOnlyOneHasTheTeam() {
        // Continental sin fila en el mercado: el origen cae al nombre que haya.
        val onlyMarket = mapOf("team_b" to "Solo 2027")
        assertEquals(
            "Solo 2027",
            TransfersLogic.teamLabel("team_b", null, onlyMarket, "?", TransfersLogic.TeamSide.FROM, emptyMap())
        )
        val onlyPrev = mapOf("team_c" to "Solo 2026")
        assertEquals(
            "Solo 2026",
            TransfersLogic.teamLabel("team_c", null, emptyMap(), "?", TransfersLogic.TeamSide.TO, onlyPrev)
        )
    }

    @Test
    fun divisionGenderMapsCategories() {
        assertEquals("male", TransfersLogic.divisionGender("WT"))
        assertEquals("female", TransfersLogic.divisionGender("WWT"))
        assertEquals("male", TransfersLogic.divisionGender("PT"))
        assertEquals("female", TransfersLogic.divisionGender("PRW"))
        assertEquals(null, TransfersLogic.divisionGender(null))
    }

    // ── Fecha oculta (mig. 123) ───────────────────────────────────

    /** La carga inicial del mercado no debe llenar el feed de anuncios viejos. */
    @Test
    fun feedExcludesHiddenDateMoves() {
        val feed = TransfersLogic.confirmedFeed(
            listOf(
                transfer("t1", "r1", to = "team_b", dateVisible = true),
                transfer("t2", "r2", to = "team_b", dateVisible = false),
            )
        )
        assertEquals(listOf("t1"), feed.map { it.id })
    }

    /** Pero SÍ cuenta en el detalle de equipo: es como se puebla el mercado. */
    @Test
    fun hiddenDateMoveStillCountsInTeamDetail() {
        val moves = listOf(
            transfer("t1", "r1", from = "team_a", to = "team_b", dateVisible = false)
        )
        val detail = TransfersLogic.teamDetail(moves, listOf(rider("r1", "Uno")), "team_a")
        assertEquals(listOf("t1"), detail.departures.map { it.id })
        assertTrue(detail.staying.isEmpty())   // sale de "continúan" igual
    }

    // ── Duda del corredor (mig. 123) ──────────────────────────────

    @Test
    fun feedExcludesDoubts() {
        val feed = TransfersLogic.confirmedFeed(
            listOf(
                transfer("t1", "r1", type = "renewal", status = "doubt", to = "team_a"),
                transfer("t2", "r2", to = "team_b"),
            )
        )
        assertEquals(listOf("t2"), feed.map { it.id })
    }

    /** Una renovación en duda saca al corredor de "continúan" y lo lleva a "en duda". */
    @Test
    fun doubtMovesRiderOutOfStaying() {
        val moves = listOf(
            transfer("t1", "r1", type = "renewal", status = "doubt", to = "team_a")
        )
        val roster = listOf(rider("r1", "Dudoso"), rider("r2", "Seguro"))
        val detail = TransfersLogic.teamDetail(moves, roster, "team_a")

        assertEquals(listOf("r2"), detail.staying.map { it.rider.id })
        assertEquals(listOf("r1"), detail.doubtful.map { it.riderId })
        assertEquals("Dudoso", detail.doubtful.first().rider?.lastName)
    }

    /** Una duda NO pisa el contrato de la ficha (no es un hecho). */
    @Test
    fun doubtDoesNotOverrideContract() {
        val moves = listOf(
            transfer("t1", "r1", type = "renewal", status = "doubt", to = "team_a", contractUntil = 2030)
        )
        val roster = listOf(rider("r1", "Dudoso", contractUntil = 2027))
        val detail = TransfersLogic.teamDetail(moves, roster, "team_a")
        // El de la FICHA, nunca el 2030 de la duda.
        assertEquals(2027, detail.doubtful.first().contractUntil)
    }

    /** Una renovación confirmada sigue mandando sobre el contrato de la ficha. */
    @Test
    fun confirmedRenewalStillOverridesContract() {
        val moves = listOf(
            transfer("t1", "r1", type = "renewal", to = "team_a", contractUntil = 2030)
        )
        val detail = TransfersLogic.teamDetail(moves, listOf(rider("r1", "Uno", contractUntil = 2027)), "team_a")
        assertEquals(2030, detail.staying.first().contractUntil)
        assertFalse(detail.staying.first().isRumor)
    }

    /** Una salida registrada gana a la duda: no puede estar en ambas listas. */
    @Test
    fun departureWinsOverDoubt() {
        val moves = listOf(
            transfer("t1", "r1", type = "renewal", status = "doubt", to = "team_a"),
            transfer("t2", "r1", from = "team_a", to = "team_b"),
        )
        val detail = TransfersLogic.teamDetail(moves, listOf(rider("r1", "Uno")), "team_a")
        assertEquals(listOf("t2"), detail.departures.map { it.id })
        assertTrue(detail.doubtful.isEmpty())
        assertTrue(detail.staying.isEmpty())
    }

    /** Dudas ordenadas por apellido, como el resto de secciones. */
    @Test
    fun doubtfulSortedByLastName() {
        val moves = listOf(
            transfer("t1", "r1", type = "renewal", status = "doubt", to = "team_a"),
            transfer("t2", "r2", type = "renewal", status = "doubt", to = "team_a"),
        )
        val roster = listOf(rider("r1", "Zabala"), rider("r2", "Alonso"))
        val detail = TransfersLogic.teamDetail(moves, roster, "team_a")
        assertEquals(listOf("r2", "r1"), detail.doubtful.map { it.riderId })
    }

    // ── Chapa efectiva (colores 2027 / antiguos / vacío) ────────────

    private fun badgeSeasonRow(teamId: String, year: Int, badgeVisible: Boolean, torso: String) =
        TeamSeason(teamId = teamId, year = year, name = "T", category = "WT",
            badgeVisible = badgeVisible, badgeTorsoCenter = torso)

    /** Chapa publicada → colores de la temporada del mercado (2027). */
    @Test
    fun badgeSeasonPublishedUsesMarketColors() {
        val market = badgeSeasonRow("a", 2027, badgeVisible = true, torso = "#new")
        val prev = mapOf("a" to badgeSeasonRow("a", 2026, badgeVisible = true, torso = "#old"))
        assertEquals("#new", TransfersLogic.badgeSeason(market, prev)?.badgeTorsoCenter)
    }

    /** Chapa oculta + equipo preexistente → colores antiguos (2026). */
    @Test
    fun badgeSeasonHiddenExistingUsesPrevColors() {
        val market = badgeSeasonRow("a", 2027, badgeVisible = false, torso = "#new")
        val prev = mapOf("a" to badgeSeasonRow("a", 2026, badgeVisible = true, torso = "#old"))
        assertEquals("#old", TransfersLogic.badgeSeason(market, prev)?.badgeTorsoCenter)
    }

    /** Chapa oculta + equipo nuevo (sin fila 2026) → sin chapa. */
    @Test
    fun badgeSeasonHiddenNewTeamIsNull() {
        val market = badgeSeasonRow("a", 2027, badgeVisible = false, torso = "#new")
        assertNull(TransfersLogic.badgeSeason(market, emptyMap()))
    }
}
