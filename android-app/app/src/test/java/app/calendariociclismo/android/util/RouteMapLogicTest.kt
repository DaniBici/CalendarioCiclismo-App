package app.calendariociclismo.android.util

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Tests de la lógica pura del mapa del recorrido. Espejo 1:1 de
 * `RouteMapLogicTests.swift` (iOS), a su vez portado de `js/mapa-pub.js`.
 *
 * Robolectric: `parseGpx` usa `XmlPullParser`, cuya factory no tiene
 * implementación en la JVM pura de JUnit (devolvería lista vacía). Robolectric
 * aporta el runtime de Android donde `XmlPullParser` sí existe — igual que en la
 * app real. Los tests de proyección/haversine no lo necesitan, pero la clase va
 * entera bajo el runner por simplicidad.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35]) // Robolectric 4.14.1 soporta hasta API 35; la app compila contra 36.
class RouteMapLogicTest {

    // ── haversineKm ────────────────────────────────────────────────

    @Test
    fun haversineUnGradoDeLatitudSonUnos111Km() {
        // 1° de latitud ≈ 111.19 km en el meridiano.
        val d = RouteMapLogic.haversineKm(0.0, 0.0, 1.0, 0.0)
        assertEquals(111.19, d, 0.5)
    }

    @Test
    fun haversineMismoPuntoEsCero() {
        assertEquals(0.0, RouteMapLogic.haversineKm(40.4, -3.7, 40.4, -3.7), 1e-9)
    }

    // ── parseGpx ───────────────────────────────────────────────────

    @Test
    fun parseGpxBasicoAcumulaKmYConservaEle() {
        val xml = """
            <gpx><trk><trkseg>
              <trkpt lat="0" lon="0"><ele>10</ele></trkpt>
              <trkpt lat="0" lon="1"><ele>20</ele></trkpt>
              <trkpt lat="0" lon="2"><ele>30</ele></trkpt>
            </trkseg></trk></gpx>
        """.trimIndent()
        val pts = RouteMapLogic.parseGpx(xml)
        assertEquals(3, pts.size)
        assertEquals(0.0, pts[0].km, 1e-9)
        assertTrue(pts[1].km > pts[0].km)
        assertTrue(pts[2].km > pts[1].km)
        val expectedTotal = RouteMapLogic.haversineKm(0.0, 0.0, 0.0, 1.0) +
            RouteMapLogic.haversineKm(0.0, 1.0, 0.0, 2.0)
        assertEquals(expectedTotal, pts[2].km, 0.01)
        assertEquals(10.0, pts[0].ele!!, 1e-9)
        assertEquals(30.0, pts[2].ele!!, 1e-9)
    }

    @Test
    fun parseGpxFallbackARtept() {
        val xml = """
            <gpx><rte>
              <rtept lat="0" lon="0"/>
              <rtept lat="0" lon="1"/>
            </rte></gpx>
        """.trimIndent()
        val pts = RouteMapLogic.parseGpx(xml)
        assertEquals(2, pts.size)
        assertNull(pts[0].ele)
    }

    @Test
    fun parseGpxSinEleDejaEleNull() {
        val xml = """
            <gpx><trk><trkseg>
              <trkpt lat="0" lon="0"/>
              <trkpt lat="0" lon="1"/>
            </trkseg></trk></gpx>
        """.trimIndent()
        val pts = RouteMapLogic.parseGpx(xml)
        assertEquals(2, pts.size)
        assertTrue(pts.all { it.ele == null })
    }

    @Test
    fun parseGpxVacioDevuelveVacio() {
        assertTrue(RouteMapLogic.parseGpx("<gpx></gpx>").isEmpty())
        assertTrue(RouteMapLogic.parseGpx("no es xml").isEmpty())
    }

    @Test
    fun parseGpxTrkptTienePrioridadSobreRtept() {
        val xml = """
            <gpx>
              <rte><rtept lat="10" lon="10"/></rte>
              <trk><trkseg>
                <trkpt lat="0" lon="0"/>
                <trkpt lat="0" lon="1"/>
              </trkseg></trk>
            </gpx>
        """.trimIndent()
        val pts = RouteMapLogic.parseGpx(xml)
        assertEquals(2, pts.size)
        assertEquals(0.0, pts[0].lat, 1e-9) // del trk, no del rte
    }

    // ── kmToLatLng (caso lineal) ───────────────────────────────────

    @Test
    fun kmToLatLngProyectaPorEscaladoEInterpolacion() {
        // Traza recta: lat crece linealmente con la longitud.
        val pts = ArrayList<RoutePoint>()
        var cum = 0.0
        var prev: Pair<Double, Double>? = null
        for (i in 0..10) {
            val lat = i.toDouble()
            val lon = 0.0
            if (prev != null) cum += RouteMapLogic.haversineKm(prev.first, prev.second, lat, lon)
            pts.add(RoutePoint(lat, lon, cum, null))
            prev = lat to lon
        }
        // officialTotal=100; pedir el km 50 → mitad de la traza → lat ≈ 5.
        val mid = RouteMapLogic.kmToLatLng(pts, 50.0, 100.0)
        assertNotNull(mid)
        assertEquals(5.0, mid!!.lat, 0.05)
        assertEquals(0.0, mid.lon, 1e-9)

        val start = RouteMapLogic.kmToLatLng(pts, 0.0, 100.0)
        assertEquals(0.0, start!!.lat, 0.05)
        val end = RouteMapLogic.kmToLatLng(pts, 100.0, 100.0)
        assertEquals(10.0, end!!.lat, 0.05)
    }

    @Test
    fun kmToLatLngVacioDevuelveNull() {
        assertNull(RouteMapLogic.kmToLatLng(emptyList(), 10.0, 100.0))
    }

    // ── markerLatLng (snap por altitud, circuito) ──────────────────

    @Test
    fun markerLatLngSnapEligeLaPasadaConAltitudMasCercana() {
        val pts = ArrayList<RoutePoint>()
        var cum = 0.0
        var prev: Pair<Double, Double>? = null
        fun push(lat: Double, lon: Double, ele: Double) {
            if (prev != null) cum += RouteMapLogic.haversineKm(prev!!.first, prev!!.second, lat, lon)
            pts.add(RoutePoint(lat, lon, cum, ele))
            prev = lat to lon
        }
        // Pasada 1 (altitudes bajas 100..130).
        push(0.000, 0.0, 100.0)
        push(0.001, 0.0, 110.0)
        push(0.002, 0.0, 120.0)
        push(0.003, 0.0, 130.0)
        // Pasada 2 (altitudes altas 300..360).
        push(0.004, 0.0, 300.0)
        push(0.005, 0.0, 330.0)
        push(0.006, 0.0, 360.0)

        val total = pts.last().km
        val officialKm = total * 0.5
        val ll = RouteMapLogic.markerLatLng(pts, officialKm, total, 350.0)
        assertNotNull(ll)
        val chosen = pts.firstOrNull { it.lat == ll!!.lat && it.lon == ll.lon }
        assertNotNull(chosen)
        assertTrue((chosen!!.ele ?: 0.0) >= 300.0)
    }

    @Test
    fun markerLatLngSinEleCaeEnKmToLatLng() {
        val pts = ArrayList<RoutePoint>()
        var cum = 0.0
        var prev: Pair<Double, Double>? = null
        for (i in 0..10) {
            val lat = i.toDouble()
            if (prev != null) cum += RouteMapLogic.haversineKm(prev.first, prev.second, lat, 0.0)
            pts.add(RoutePoint(lat, 0.0, cum, null))
            prev = lat to 0.0
        }
        val viaMarker = RouteMapLogic.markerLatLng(pts, 50.0, 100.0, 200.0)
        val viaKm = RouteMapLogic.kmToLatLng(pts, 50.0, 100.0)
        assertEquals(viaKm, viaMarker)
    }

    @Test
    fun markerLatLngConAltTargetNullCaeEnKmToLatLng() {
        val pts = listOf(
            RoutePoint(0.0, 0.0, 0.0, 100.0),
            RoutePoint(1.0, 0.0, RouteMapLogic.haversineKm(0.0, 0.0, 1.0, 0.0), 200.0),
        )
        val viaMarker = RouteMapLogic.markerLatLng(pts, 0.0, 0.0, null)
        val viaKm = RouteMapLogic.kmToLatLng(pts, 0.0, 0.0)
        assertEquals(viaKm, viaMarker)
    }
}
