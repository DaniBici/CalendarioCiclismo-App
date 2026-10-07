package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.ElevationPoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Espejo de `js/__tests__/profile-segment.test.js`. */
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

    @Test
    fun `admite el tramo marcado de derecha a izquierda`() {
        assertEquals(5.0, ProfileSegment.stats(points, 25.0, 5.0, interpolateAlt)!!.from, 1e-9)
    }

    @Test
    fun `descarta un tramo sin longitud`() {
        assertNull(ProfileSegment.stats(points, 12.0, 12.0, interpolateAlt))
    }

    @Test
    fun `formatea cifras de la lectura segun el idioma de contenido`() {
        assertEquals("88,2", ProfileSegment.formatKm(88.24, english = false))
        assertEquals("12", ProfileSegment.formatKm(12.04, english = false))
        assertEquals("88.2", ProfileSegment.formatKm(88.24, english = true))
        assertEquals("1.250", ProfileSegment.formatMeters(1249.6, english = false))
        assertEquals("1,250", ProfileSegment.formatMeters(1250.0, english = true))
        assertEquals("939", ProfileSegment.formatMeters(939.2, english = false))
        assertEquals("−2,1", ProfileSegment.formatGradient(-2.06, english = false))
        assertEquals("6.8", ProfileSegment.formatGradient(6.75, english = true))
    }
}
