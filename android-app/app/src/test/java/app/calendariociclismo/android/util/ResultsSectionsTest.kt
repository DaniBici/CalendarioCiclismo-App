package app.calendariociclismo.android.util

import app.calendariociclismo.android.util.ResultsSection.RANKING
import app.calendariociclismo.android.util.ResultsSection.ROAD
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ResultsSectionsTest {
    @Test fun `Resultados muestra Ultimos resultados y Ranking UCI en cualquier fecha`() {
        for (date in listOf("2026-10-09", "2026-12-31", "2027-01-01", "2027-10-19")) {
            val value = ResultsSections.layout(LocalDate.parse(date))
            assertEquals(date, listOf(ROAD, RANKING), value.sections)
            assertEquals(date, ROAD, value.initial)
            assertFalse(date, value.roadLabelShort)
        }
    }
}
