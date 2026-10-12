package app.calendariociclismo.android.util

import app.calendariociclismo.android.util.ResultsSection.CYCLOCROSS
import app.calendariociclismo.android.util.ResultsSection.RANKING
import app.calendariociclismo.android.util.ResultsSection.ROAD
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ResultsSectionsTest {
    private val returnDate: LocalDate = RoadTodayAvailability.RETURN_DATE

    private fun layout(date: LocalDate) = ResultsSections.layout(date)

    @Test fun `con Hoy oculta Ciclocross encabeza y es la inicial`() {
        val value = layout(returnDate.minusDays(1))
        assertEquals(listOf(CYCLOCROSS, ROAD, RANKING), value.sections)
        assertEquals(CYCLOCROSS, value.initial)
        assertTrue(value.roadLabelShort)
    }

    @Test fun `desde la fecha de regreso de Hoy vuelven las dos pestanas de siempre`() {
        val dates = listOf(
            returnDate,
            returnDate.plusDays(1),
            returnDate.plusMonths(1),
            returnDate.plusYears(1),
        )
        for (date in dates) {
            val value = layout(date)
            assertEquals(date.toString(), listOf(ROAD, RANKING), value.sections)
            assertEquals(date.toString(), ROAD, value.initial)
            assertFalse(date.toString(), value.roadLabelShort)
        }
    }
}
