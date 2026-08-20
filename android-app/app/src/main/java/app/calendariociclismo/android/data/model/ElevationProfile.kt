package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

@Serializable
data class ElevationProfile(
    val distance: Double,
    val elevationGain: Int? = null,
    val elevationLoss: Int? = null,
    val minElevation: Int? = null,
    val maxElevation: Int? = null,
    val points: List<ElevationPoint> = emptyList(),
)

@Serializable
data class ElevationPoint(val km: Double, val alt: Int)

/**
 * Cima o puerto sobre el perfil. `km` es opcional para tolerar registros
 * incompletos: si una fila queda en DB con `km: null`, el decode no rompe
 * (lo que antes provocaba un fallo en cascada al cargar el día y la
 * pantalla "Hoy" mostraba "datos no disponibles offline"). Los consumidores
 * deben filtrar `km == null` antes de pintar.
 */
@Serializable
data class ProfileSummit(
    val name: String? = null,
    val km: Double? = null,
    val altitude: Int? = null,
    val category: String? = null,
    val side: String? = null,
    val startKm: Double? = null,
    // Hora de paso por la cima (ISO 8601 UTC) del rutómetro. Opcional: si
    // falta, la guía de horarios la estima por interpolación.
    val timeUtc: String? = null,
    // Hora de paso por el pie del puerto (ISO 8601 UTC) del rutómetro.
    // Opcional: si falta, el pie se estima por interpolación.
    val footTimeUtc: String? = null,
) {
    /**
     * Longitud y pendiente media derivadas del GPX. Devuelve null si
     * km/startKm no están fijados o si los datos son inconsistentes.
     */
    fun climbStats(points: List<ElevationPoint>): ClimbStats? {
        val summitKm = km ?: return null
        val start = startKm ?: return null
        if (start >= summitKm || points.size < 2) return null

        fun interp(k: Double): Double {
            if (k <= points.first().km) return points.first().alt.toDouble()
            if (k >= points.last().km)  return points.last().alt.toDouble()
            for (i in 0 until points.size - 1) {
                val p0 = points[i]; val p1 = points[i + 1]
                if (k in p0.km..p1.km) {
                    val span = p1.km - p0.km
                    if (span <= 0) return p0.alt.toDouble()
                    val t = (k - p0.km) / span
                    return p0.alt + t * (p1.alt - p0.alt)
                }
            }
            return points.last().alt.toDouble()
        }

        val summitAlt = altitude?.toDouble() ?: interp(minOf(summitKm, points.last().km))
        val startAlt  = interp(start)
        val length    = summitKm - start
        if (length <= 0.0) return null
        val gradient  = ((summitAlt - startAlt) / (length * 1000.0)) * 100.0
        return ClimbStats(length, gradient, (summitAlt - startAlt).toInt())
    }

    data class ClimbStats(val lengthKm: Double, val avgGradient: Double, val gainMeters: Int)
}

/**
 * Waypoint del perfil (sprint, paso intermedio, sector empedrado, etc.).
 * `km` opcional por el mismo motivo que en `ProfileSummit`.
 */
@Serializable
data class ProfileWaypoint(
    val name: String? = null,
    val km: Double? = null,
    val type: String,
    val lengthKm: Double? = null,
    // Hora de paso (ISO 8601 UTC) del rutómetro. Opcional (se estima si falta).
    val timeUtc: String? = null,
)
