package app.calendariociclismo.android

import app.calendariociclismo.android.data.model.RiderProfile
import app.calendariociclismo.android.data.model.RiderTransfer
import app.calendariociclismo.android.util.TransfersLogic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reglas de Fichajes que deciden qué es un fichaje o una renovación confirmados
 * y en qué sección del detalle de equipo aparece cada corredor, con su contrato.
 */
class TransfersLogicTest {

    private fun transfer(
        id: String,
        riderId: String,
        type: String = "transfer",
        status: String = "confirmed",
        from: String? = null,
        to: String? = null,
        toName: String? = null,
        contractUntil: Int? = null,
        announcedAt: String? = "2026-07-10",
        createdAt: String? = null,
        dateVisible: Boolean = true,
        midSeason: Boolean = false,
    ) = RiderTransfer(
        id = id, season = 2027, riderId = riderId, riderGender = "male",
        fromTeamId = from, toTeamId = to, toTeamName = toName, type = type, status = status,
        contractUntil = contractUntil, announcedAt = announcedAt, createdAt = createdAt,
        dateVisible = dateVisible, midSeason = midSeason,
    )

    private fun rider(id: String, last: String, contractUntil: Int? = null, currentTeamId: String? = "team_a") = RiderProfile(
        id = id, firstName = "Test", lastName = last, nationality = "es",
        currentTeamId = currentTeamId, contractUntil = contractUntil,
    )

    // ── Feed ──────────────────────────────────────────────────────

    @Test
    fun feedShowsOnlyRealSignings() {
        // Solo fichajes reales confirmados (transfer con destino conocido). Fuera:
        // renovaciones, retiradas, fines de contrato sin destino (to='?'), rumores,
        // dudas y movimientos con fecha oculta (mig. 123: la carga inicial del
        // mercado no debe llenar el feed de anuncios viejos).
        val feed = TransfersLogic.confirmedFeed(
            listOf(
                transfer("sign", "r1", type = "transfer", to = "team_b"),
                transfer("renew", "r2", type = "renewal", to = "team_a"),
                transfer("retire", "r3", type = "retirement", from = "team_a"),
                transfer("end", "r4", type = "transfer", from = "team_a", toName = "?"),
                transfer("rumor", "r5", status = "rumor", to = "team_b"),
                transfer("doubt", "r6", type = "renewal", status = "doubt", to = "team_a"),
                transfer("hidden", "r7", to = "team_b", dateVisible = false),
            )
        )
        assertEquals(listOf("sign"), feed.map { it.id })
    }

    @Test
    fun renewalFeedShowsOnlyConfirmedVisibleRenewals() {
        val feed = TransfersLogic.renewalFeed(
            listOf(
                transfer("renew", "r1", type = "renewal", to = "team_a"),
                transfer("sign", "r2", type = "transfer", to = "team_b"),
                transfer("rumor", "r3", type = "renewal", status = "rumor", to = "team_a"),
                transfer("hidden", "r4", type = "renewal", to = "team_a", dateVisible = false),
            )
        )
        assertEquals(listOf("renew"), feed.map { it.id })
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
    fun contractEndSeparatesFromDepartures() {
        // Fin de contrato sin destino (transfer to='?') → sección "Terminan
        // contrato". Un fichaje con destino y una retirada → "Se marchan".
        val roster = listOf(rider("r1", "Fin"), rider("r2", "Ficha"), rider("r3", "Retira"))
        val moves = listOf(
            transfer("end", "r1", type = "transfer", from = "team_a", toName = "?"),
            transfer("sign", "r2", type = "transfer", from = "team_a", to = "team_b"),
            transfer("retire", "r3", type = "retirement", from = "team_a"),
        )
        val detail = TransfersLogic.teamDetail(moves, roster, "team_a")
        assertEquals(listOf("end"), detail.contractEnds.map { it.id })
        assertEquals(setOf("sign", "retire"), detail.departures.map { it.id }.toSet())
        assertTrue(detail.staying.isEmpty())   // los tres dejan el equipo
    }

    @Test
    fun stayingOnlyIncludesRidersFrom2026Roster() {
        // Continúan = solo quien YA estaba en el equipo (currentTeamId=team_a).
        // Un fichaje de fuera tiene afiliación (está en el roster 2027) pero su
        // currentTeamId es otro equipo → NO continúa (va a "Llegan").
        val roster = listOf(
            rider("stay", "Local", currentTeamId = "team_a"),
            rider("newbie", "Fichaje", currentTeamId = "team_x"),
        )
        val detail = TransfersLogic.teamDetail(emptyList(), roster, "team_a")
        assertEquals(listOf("stay"), detail.staying.map { it.rider.id })
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

    // ── Fecha oculta (mig. 123) ───────────────────────────────────

    /** Fuera del feed, pero SÍ cuenta en el detalle de equipo: es como se puebla el mercado. */
    @Test
    fun hiddenDateMoveStillCountsInTeamDetail() {
        val moves = listOf(
            transfer("t1", "r1", from = "team_a", to = "team_b", dateVisible = false)
        )
        val detail = TransfersLogic.teamDetail(moves, listOf(rider("r1", "Uno")), "team_a")
        assertEquals(listOf("t1"), detail.departures.map { it.id })
        assertTrue(detail.staying.isEmpty())   // sale de "continúan" igual
    }

    @Test
    fun midSeasonMoveDoesNotAppearAsNextMarketArrivalButKeepsRealRosterContract() {
        // El fichaje de agosto es informativo en el feed. Si más adelante se
        // registra contrato 2027+ en la afiliación, el corredor continúa; no
        // debe aparecer simultáneamente como una llegada del mercado.
        val moves = listOf(transfer("mid", "r1", from = "team_old", to = "team_a", midSeason = true))
        val detail = TransfersLogic.teamDetail(moves, listOf(rider("r1", "Uno", contractUntil = 2029)), "team_a")
        assertTrue(detail.arrivals.isEmpty())
        assertEquals(listOf("r1"), detail.staying.map { it.rider.id })
    }

    // ── Duda del corredor (mig. 123) ──────────────────────────────

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
}
