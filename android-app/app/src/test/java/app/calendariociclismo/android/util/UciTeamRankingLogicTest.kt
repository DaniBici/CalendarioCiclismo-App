package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.UciTeamRankingRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UciTeamRankingLogicTest {
    private fun row(rank: Int, category: String, gender: String = "male") =
        UciTeamRankingRow(
            gender = gender,
            rank = rank,
            uciTeamId = rank.toLong(),
            teamId = "team-$rank",
            teamCategory = category,
            sourceName = "TEAM $rank",
            displayName = "Team $rank",
            countryCode = "ES",
            points = 100.0,
            rankingDate = "2026-07-28",
            sourceUrl = "https://dataride.uci.ch",
        )

    @Test
    fun `las invitaciones masculinas cuentan ProTeams no puestos absolutos`() {
        val result = UciTeamRankingLogic.decorate(
            listOf(
                row(1, "WT"), row(8, "PT"), row(9, "WT"), row(15, "PT"),
                row(18, "PT"), row(21, "PT"), row(22, "PT"),
            ),
            "male",
        ).filter { it.row.teamCategory == "PT" }

        assertEquals(
            listOf(
                UciTeamRankingTier.ALL_WORLD_TOUR,
                UciTeamRankingTier.ALL_WORLD_TOUR,
                UciTeamRankingTier.ALL_WORLD_TOUR,
                UciTeamRankingTier.PRO_SERIES,
                UciTeamRankingTier.PRO_SERIES,
            ),
            result.map { it.invitationTier },
        )
        assertTrue(result.first().explanation(false).contains("y a todas las pruebas UCI ProSeries"))
    }

    @Test
    fun `solo un ProTeam fuera del top 30 queda excluido de Grandes Vueltas`() {
        val result = UciTeamRankingLogic.decorate(
            listOf(row(30, "PT"), row(31, "PT"), row(40, "CT")),
            "male",
        )

        assertEquals(listOf(false, true, false), result.map { it.grandTourExcluded })
        assertTrue(result[1].explanation(false).contains("top-30"))
        assertTrue(result[1].explanation(false).contains("2027"))
    }

    @Test
    fun `dos mejores Womens ProTeams`() {
        val result = UciTeamRankingLogic.decorate(
            listOf(
                row(1, "WWT", "female"),
                row(12, "PRW", "female"),
                row(15, "PRW", "female"),
                row(16, "PRW", "female"),
            ),
            "female",
        )

        assertEquals(
            listOf(
                UciTeamRankingTier.WORLD_TOUR,
                UciTeamRankingTier.WOMENS_WORLD_TOUR,
                UciTeamRankingTier.WOMENS_WORLD_TOUR,
                UciTeamRankingTier.STANDARD,
            ),
            result.map { it.invitationTier },
        )
        assertTrue(!result[1].explanation(false).contains("ProSeries"))
    }
}
