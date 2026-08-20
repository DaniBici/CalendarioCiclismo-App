package app.calendariociclismo.android.util

import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.StringReader
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Punto de la traza GPX: coordenada + km acumulado (haversine) + altitud opcional. */
data class RoutePoint(val lat: Double, val lon: Double, val km: Double, val ele: Double?)

/** Coordenada simple (resultado de proyectar un km sobre la traza). */
data class LatLng(val lat: Double, val lon: Double)

/**
 * Lógica pura del mapa del recorrido — espejo 1:1 de `RouteMapLogic.swift` (iOS),
 * a su vez portado de `js/mapa-pub.js` (web, Leaflet). Sin estado, sin Compose ni
 * Android UI → testeable con JUnit (ver `RouteMapLogicTest`).
 *
 * ⚠️ SIN segmentación de la traza: los GPX de ASO (fragmentados, que requerían
 * cortar en `<trkseg>` y en saltos > 1 km) se retiraron; los GPX limpios son
 * trazas continuas → una sola lista de puntos y una sola polilínea. Si en el
 * futuro reaparecieran saltos reales, habría que reintroducir la segmentación.
 */
object RouteMapLogic {

    // Ventana de búsqueda (km de GPX) alrededor del km escalado para el snap.
    const val SNAP_WINDOW_KM = 2.5
    // 1 m de diferencia de altitud pesa como SNAP_KM_PENALTY km de desvío en el
    // score; alto = prioriza estar cerca del km esperado, bajo = prioriza clavar
    // la altitud. 8 da buen equilibrio (verificado en el circuito de Montjuïc).
    const val SNAP_KM_PENALTY = 8.0

    // ── Haversine ──────────────────────────────────────────────────

    /** Distancia en km entre dos coordenadas (radio terrestre 6371 km). */
    fun haversineKm(aLat: Double, aLon: Double, bLat: Double, bLon: Double): Double {
        val r = 6371.0
        fun toRad(x: Double) = x * Math.PI / 180.0
        val dLat = toRad(bLat - aLat)
        val dLon = toRad(bLon - aLon)
        val h = sin(dLat / 2) * sin(dLat / 2) +
            cos(toRad(aLat)) * cos(toRad(bLat)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * asin(min(1.0, sqrt(h)))
    }

    // ── GPX parsing ────────────────────────────────────────────────

    /**
     * Parsea un GPX crudo a una lista plana de [RoutePoint] con km acumulado por
     * haversine en el orden del fichero. Usa `<trkpt>`; si no hay, cae a
     * `<rtept>` (mismo fallback que la web). Devuelve [] si no hay puntos.
     */
    fun parseGpx(xml: String): List<RoutePoint> {
        val raw = parseTrackPoints(xml)
        if (raw.isEmpty()) return emptyList()

        val points = ArrayList<RoutePoint>(raw.size)
        var cum = 0.0
        var prev: RawPoint? = null
        for (p in raw) {
            if (prev != null) cum += haversineKm(prev.lat, prev.lon, p.lat, p.lon)
            points.add(RoutePoint(p.lat, p.lon, cum, p.ele))
            prev = p
        }
        return points
    }

    private data class RawPoint(val lat: Double, val lon: Double, val ele: Double?)

    /** Extrae los `<trkpt>`/`<rtept>` (lat, lon, ele?) en orden de aparición. */
    private fun parseTrackPoints(xml: String): List<RawPoint> {
        val trkpts = ArrayList<RawPoint>()
        val rtepts = ArrayList<RawPoint>()
        try {
            val factory = XmlPullParserFactory.newInstance()
            factory.isNamespaceAware = false
            val parser = factory.newPullParser()
            parser.setInput(StringReader(xml))

            var curLat: Double? = null
            var curLon: Double? = null
            var curEle: Double? = null
            var curKind: Int = 0 // 0 = ninguno, 1 = trk, 2 = rte
            var inEle = false
            val eleText = StringBuilder()

            var event = parser.eventType
            while (event != XmlPullParser.END_DOCUMENT) {
                when (event) {
                    XmlPullParser.START_TAG -> {
                        when (parser.name.lowercase()) {
                            "trkpt", "rtept" -> {
                                curKind = if (parser.name.lowercase() == "trkpt") 1 else 2
                                curLat = parser.getAttributeValue(null, "lat")?.toDoubleOrNull()
                                curLon = parser.getAttributeValue(null, "lon")?.toDoubleOrNull()
                                curEle = null
                            }
                            "ele" -> { inEle = true; eleText.setLength(0) }
                        }
                    }
                    XmlPullParser.TEXT -> {
                        if (inEle) eleText.append(parser.text)
                    }
                    XmlPullParser.END_TAG -> {
                        when (parser.name.lowercase()) {
                            "ele" -> {
                                inEle = false
                                curEle = eleText.toString().trim().toDoubleOrNull()
                            }
                            "trkpt", "rtept" -> {
                                val lat = curLat; val lon = curLon
                                if (lat != null && lon != null && lat.isFinite() && lon.isFinite()) {
                                    val rp = RawPoint(lat, lon, curEle)
                                    if (curKind == 1) trkpts.add(rp) else rtepts.add(rp)
                                }
                                curKind = 0; curLat = null; curLon = null; curEle = null
                            }
                        }
                    }
                }
                event = parser.next()
            }
        } catch (_: Exception) {
            return emptyList()
        }
        // Preferir trkpt; si el GPX solo trae rtept, usar esos.
        return if (trkpts.isNotEmpty()) trkpts else rtepts
    }

    // ── Projection ─────────────────────────────────────────────────

    /**
     * Proyecta un km de carrera (escalado a la longitud real del GPX) a [LatLng].
     * Escalado proporcional `officialKm/officialTotal × gpxTotal` + interpolación
     * lineal entre los dos vértices que rodean el km objetivo.
     */
    fun kmToLatLng(points: List<RoutePoint>, officialKm: Double, officialTotal: Double): LatLng? {
        val last = points.lastOrNull() ?: return null
        val gpxTotal = last.km
        val targetKm = if (officialTotal > 0) (officialKm / officialTotal) * gpxTotal else officialKm
        var i = 1
        while (i < points.size) {
            if (points[i].km >= targetKm) {
                val a = points[i - 1]; val b = points[i]
                val span = if (b.km - a.km == 0.0) 1e-9 else b.km - a.km
                val f = (targetKm - a.km) / span
                return LatLng(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f)
            }
            i++
        }
        return LatLng(last.lat, last.lon)
    }

    /**
     * Proyecta un punto-clave COMBINANDO km y altitud. En circuitos repetidos
     * (mismo lugar pasado N veces) el escalado proporcional puro desvía cada
     * pasada; si conocemos la altitud (`altTarget`), buscamos el punto del GPX
     * que mejor case la altitud DENTRO de una ventana de km → cada pasada hace
     * snap a SU cima real. Sin altitud o sin `ele` en el GPX → fallback al
     * escalado proporcional ([kmToLatLng]), que va bien en lineales.
     */
    fun markerLatLng(
        points: List<RoutePoint>,
        officialKm: Double,
        officialTotal: Double,
        altTarget: Double?,
    ): LatLng? {
        val last = points.lastOrNull() ?: return null
        // Fallback al escalado proporcional si no hay altitud objetivo o el GPX
        // no trae cotas. Tras este guard, `altTarget` es no-null (smart-cast).
        if (altTarget == null || points.none { it.ele != null }) {
            return kmToLatLng(points, officialKm, officialTotal)
        }
        val gpxTotal = last.km
        val center = if (officialTotal > 0) (officialKm / officialTotal) * gpxTotal else officialKm
        var best: RoutePoint? = null
        var bestScore = Double.POSITIVE_INFINITY
        for (p in points) {
            val ele = p.ele ?: continue
            val dKm = abs(p.km - center)
            if (dKm > SNAP_WINDOW_KM) continue
            val score = abs(ele - altTarget) + dKm * SNAP_KM_PENALTY
            if (score < bestScore) { bestScore = score; best = p }
        }
        return best?.let { LatLng(it.lat, it.lon) }
            ?: kmToLatLng(points, officialKm, officialTotal)
    }
}
