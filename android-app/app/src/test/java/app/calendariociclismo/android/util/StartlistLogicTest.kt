package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.StartlistTeam
import org.junit.Assert.assertEquals
import org.junit.Test

class StartlistLogicTest {

    @Test
    fun `estados sin equipo no cuentan como formacion`() {
        listOf("Individual", "Private Member", "Sin equipo", "UN", "Un-Attached Leinster")
            .forEach { name ->
                assertEquals(
                    true,
                    StartlistTeam(id = name, raceId = "r", teamName = name).isNoTeamPlaceholder,
                )
            }
        assertEquals(
            false,
            StartlistTeam(id = "linked", raceId = "r", teamName = "Individual", teamId = "team_x")
                .isNoTeamPlaceholder,
        )
    }
}
