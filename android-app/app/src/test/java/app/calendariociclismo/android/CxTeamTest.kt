package app.calendariociclismo.android

import app.calendariociclismo.android.data.model.CxResult
import app.calendariociclismo.android.data.model.CxStanding
import app.calendariociclismo.android.data.model.CxTeam
import app.calendariociclismo.android.util.CxPresentation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import java.util.Locale
import org.junit.Test

class CxTeamTest {
    @Test
    fun `chapas CX con paleta por defecto no se muestran`() {
        val defaultTeam = CxTeam(
            id = "cx-default", name = "Equipo", uciCode = "EQU", colorHex = "#ffffff",
            badgeTorsoCenter = "#ffffff", badgeTorsoSides = "#000000", badgeShorts = "#000000",
        )
        val curatedTeam = defaultTeam.copy(badgeTorsoCenter = "#e30613")
        val innerTeam = defaultTeam.copy(badgeInnerCircle = "#ffd700")

        assertEquals(false, defaultTeam.hasVisibleBadge)
        assertEquals(true, curatedTeam.hasVisibleBadge)
        assertEquals(true, innerTeam.hasVisibleBadge)
    }

    @Test
    fun `resultados y generales CX casan el equipo por nombre o alias`() {
        val team = CxTeam(
            id = "t1", name = "Crelan - Corendon", uciCode = "CRC", colorHex = "#ff6600",
            badgeTorsoCenter = "#ff6600", badgeTorsoSides = "#002f6c", badgeShorts = "#002f6c",
            nameAliases = listOf("Crelan-Corendon"),
        )
        val teams = listOf(team.roadTeam)
        val result = CxResult(id = 1, raceId = "r", category = "ME", rank = 1, riderDisplay = "Rider", teamName = "Crelan-Corendon")
        assertEquals("t1", CxPresentation.resultRows(listOf(result), Locale.UK, teams).first().team?.id)
        val standing = CxStanding(id = "s", tournamentId = "t", seasonKey = "2026-27", category = "ME", rank = 1,
            riderDisplay = "Rider", teamName = "Crelan - Corendon", points = 50.0)
        assertEquals("t1", CxPresentation.standingRow(standing, "points", Locale.UK, teams).team?.id)
        assertNull(CxPresentation.standingRow(standing, "points", Locale.UK).team)
    }
}
