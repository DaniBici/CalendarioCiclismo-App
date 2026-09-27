package app.calendariociclismo.android

import app.calendariociclismo.android.data.model.TeamSeason
import app.calendariociclismo.android.data.model.asTeam
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TeamSeasonTest {
    @Test
    fun `materializa una identidad historica sin fila base publica`() {
        val team = TeamSeason(
            teamId = "hist",
            year = 2021,
            name = "Equipo 2021",
            category = "CT",
            badgeTorsoCenter = "#123456",
        ).asTeam()

        assertEquals("hist", team?.id)
        assertEquals("Equipo 2021", team?.name)
        assertEquals("#123456", team?.badgeTorsoCenter)
        assertEquals("#000000", team?.badgeShorts)
        assertTrue(team?.hasVisibleBadge == true)
    }

    @Test
    fun `no inventa una identidad sin nombre de temporada`() {
        assertNull(TeamSeason(teamId = "hist", year = 2021).asTeam())
    }
}
