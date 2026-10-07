package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.ElevationPoint
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/** Cifras de un tramo del perfil entre dos puntos kilométricos. */
data class ProfileSegmentStats(
    val from: Double,
    val to: Double,
    val distance: Double,
    val ascent: Double,
    val descent: Double,
    val startAlt: Double,
    val endAlt: Double,
    val gradient: Double,
)

/**
 * Medición de un tramo del perfil: distancia, desnivel positivo y negativo
 * acumulados y pendiente media. Los extremos se interpolan sobre la polilínea;
 * los vértices intermedios se recorren en orden.
 *
 * Paridad: `js/stage/profile-segment.js` e iOS `ProfileSegment.swift`.
 */
object ProfileSegment {

    fun stats(
        points: List<ElevationPoint>,
        kmA: Double,
        kmB: Double,
        interpolateAlt: (Double) -> Double,
    ): ProfileSegmentStats? {
        if (points.size < 2) return null
        val from = min(kmA, kmB)
        val to = max(kmA, kmB)
        val distance = to - from
        if (!(distance > 0)) return null
        val altitudes = ArrayList<Double>()
        altitudes += interpolateAlt(from)
        for (point in points) if (point.km > from && point.km < to) altitudes += point.alt.toDouble()
        altitudes += interpolateAlt(to)
        var ascent = 0.0
        var descent = 0.0
        for (i in 1 until altitudes.size) {
            val diff = altitudes[i] - altitudes[i - 1]
            if (diff > 0) ascent += diff else descent -= diff
        }
        val startAlt = altitudes.first()
        val endAlt = altitudes.last()
        return ProfileSegmentStats(
            from = from,
            to = to,
            distance = distance,
            ascent = ascent,
            descent = descent,
            startAlt = startAlt,
            endAlt = endAlt,
            gradient = (endAlt - startAlt) / (distance * 1000) * 100,
        )
    }

    /** Altitud interpolada linealmente sobre la polilínea (extremos fijos). */
    fun interpolateAlt(points: List<ElevationPoint>, km: Double): Double {
        if (points.isEmpty()) return 0.0
        if (km <= points.first().km) return points.first().alt.toDouble()
        if (km >= points.last().km) return points.last().alt.toDouble()
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            if (km >= a.km && km <= b.km) {
                val span = b.km - a.km
                if (abs(span) < 1e-9) return a.alt.toDouble()
                return a.alt + (km - a.km) / span * (b.alt - a.alt)
            }
        }
        return points.last().alt.toDouble()
    }

    /** Kilómetros con un decimal como máximo: «88,2», «12» (EN «88.2»). */
    fun formatKm(km: Double, english: Boolean = LocaleHolder.shouldShowEnglishContent): String {
        val tenths = (abs(km) * 10).roundToLong()
        val sign = if (km < 0 && tenths > 0) "-" else ""
        val integer = sign + group(tenths / 10, english)
        val decimal = tenths % 10
        return if (decimal == 0L) integer else integer + (if (english) "." else ",") + decimal
    }

    /** Metros redondeados con separador de millares: «1.250» (EN «1,250»). */
    fun formatMeters(meters: Double, english: Boolean = LocaleHolder.shouldShowEnglishContent): String {
        val rounded = meters.roundToLong()
        val grouped = group(abs(rounded), english)
        return if (rounded < 0) "-$grouped" else grouped
    }

    /** Pendiente con un decimal y signo menos tipográfico: «6,8», «−2,1». */
    fun formatGradient(gradient: Double, english: Boolean = LocaleHolder.shouldShowEnglishContent): String {
        val raw = String.format(java.util.Locale.US, "%.1f", gradient)
        val localized = if (english) raw else raw.replace('.', ',')
        return localized.replace('-', '−')
    }

    private fun group(value: Long, english: Boolean): String {
        val sep = if (english) ',' else '.'
        return value.toString().reversed().chunked(3).joinToString(sep.toString()).reversed()
    }
}
