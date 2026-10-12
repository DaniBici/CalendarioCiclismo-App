package app.calendariociclismo.android.util

import app.calendariociclismo.android.ui.navigation.Routes
import org.junit.Assert.assertEquals
import org.junit.Test

class RoadTodayAvailabilityTest {
    @Test fun `barra empieza en Ciclocross sin Hoy y recupera el orden con Hoy`() {
        assertEquals(listOf(Routes.CYCLOCROSS, Routes.RESULTS_FEED, Routes.TRANSFERS, Routes.CALENDAR), Routes.mainTabs(todayVisible = false))
        assertEquals(Routes.CYCLOCROSS, Routes.home(todayVisible = false))
        assertEquals(listOf(Routes.TODAY, Routes.RESULTS_FEED, Routes.TRANSFERS, Routes.CYCLOCROSS, Routes.CALENDAR), Routes.mainTabs(todayVisible = true))
        assertEquals(Routes.TODAY, Routes.home(todayVisible = true))
    }
}
