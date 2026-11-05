package app.calendariociclismo.android.util

import org.junit.Assert.*
import org.junit.Test

/** Proyección de los puntos clave del perfil sobre la traza del mapa del recorrido. */
class RouteMapLogicTest {

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
}
