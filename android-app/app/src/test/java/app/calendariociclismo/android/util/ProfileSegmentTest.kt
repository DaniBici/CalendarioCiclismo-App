package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.ElevationPoint
import org.junit.Assert.assertEquals
import org.junit.Test

class ProfileSegmentTest {

    private val points = listOf(
        ElevationPoint(0.0, 100),
        ElevationPoint(10.0, 600),
        ElevationPoint(20.0, 300),
        ElevationPoint(30.0, 500),
    )
    private val interpolateAlt: (Double) -> Double = { km -> ProfileSegment.interpolateAlt(points, km) }

    @Test
    fun `acumula subidas y bajadas con extremos interpolados`() {
        val stats = ProfileSegment.stats(points, 5.0, 25.0, interpolateAlt)!!
        assertEquals(20.0, stats.distance, 1e-9)
        assertEquals(350.0, stats.startAlt, 1e-9)
        assertEquals(400.0, stats.endAlt, 1e-9)
        assertEquals(350.0, stats.ascent, 1e-9)
        assertEquals(300.0, stats.descent, 1e-9)
        assertEquals(0.25, stats.gradient, 1e-9)
    }
}
