package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.ProfileSummit
import app.calendariociclismo.android.data.model.ProfileWaypoint
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.roundToLong

/** Una fila de la guía simplificada de horarios de paso. */
data class GuideRow(
    val km: Double,
    val kmToGo: Double?,
    // start | climb_foot | summit | intermediate_sprint | bonus_sprint |
    // intermediate_split | cobblestone | sterrato | town | finish
    val type: String,
    val label: String?,
    val category: String?,
    val timeUtc: String?,
    val isEstimated: Boolean,
    val secondaryType: String? = null,
    val secondaryLabel: String? = null,
)

/**
 * Construye la guía simplificada de horarios de paso por los puntos
 * destacados de una jornada. Función pura.
 *
 * Las horas manuales (del rutómetro) viajan en `timeUtc` dentro de cada
 * [ProfileSummit]/[ProfileWaypoint]. Salida y llegada usan los horarios de la
 * jornada. Las horas que no vienen en el rutómetro se ESTIMAN por
 * interpolación lineal por km entre las horas conocidas (anclas).
 *
 * Mantener en PARIDAD con `js/simplified-guide.js` y
 * `ios-app/.../Services/SimplifiedGuide.swift`.
 */
object SimplifiedGuide {

    private val isoOut: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    private fun round1(x: Double): Double = Math.round(x * 10).toDouble() / 10

    private fun parseSeconds(iso: String?): Double? =
        iso?.let { DateFormatting.parseIso(it)?.toEpochMilli()?.toDouble()?.div(1000.0) }

    // Redondea al minuto y serializa a ISO UTC (las horas de rutómetro son HH:mm).
    private fun isoFromSeconds(secs: Double): String {
        val rounded = (secs / 60).roundToLong() * 60
        return isoOut.format(java.time.Instant.ofEpochSecond(rounded))
    }

    // Paridad con `js/perfil-pub.js`.
    private fun isWaypointVisible(type: String, isTimeTrial: Boolean): Boolean = when (type) {
        "kom" -> false
        "intermediate_sprint", "bonus_sprint" -> !isTimeTrial
        "intermediate_split" -> isTimeTrial
        else -> true
    }

    private data class Tmp(
        val km: Double,
        var kmToGo: Double?,
        val type: String,
        val label: String?,
        val category: String?,
        var timeUtc: String?,
        var isEstimated: Boolean,
        var secondaryType: String? = null,
        var secondaryLabel: String? = null,
    )

    fun build(
        distanceKm: Double?,
        neutralStartTimeUtc: String?,
        estimatedFinishTimeUtc: String?,
        summits: List<ProfileSummit>,
        waypoints: List<ProfileWaypoint>,
        primaryType: String?,
        realStartTimeUtc: String? = null,
    ): List<GuideRow> {
        val isTimeTrial = primaryType == "itt" || primaryType == "ttt"
        val rows = mutableListOf<Tmp>()

        // — Salida (km 0): salida real si existe; si no, neutralizada —
        val startTimeUtc = realStartTimeUtc ?: neutralStartTimeUtc
        if (startTimeUtc != null) {
            rows.add(Tmp(0.0, null, "start", null, null, startTimeUtc, false))
        }

        // — Puertos: pie (estimado) + cima (manual si la hubiera) —
        for (s in summits) {
            val km = s.km ?: continue
            val startKm = s.startKm
            if (startKm != null && startKm < km) {
                rows.add(Tmp(startKm, null, "climb_foot", s.name, s.category, s.footTimeUtc, s.footTimeUtc == null))
            }
            rows.add(Tmp(km, null, "summit", s.name, s.category, s.timeUtc, s.timeUtc == null))
        }

        // — Waypoints —
        for (w in waypoints) {
            val km = w.km ?: continue
            if (!isWaypointVisible(w.type, isTimeTrial)) continue
            rows.add(Tmp(km, null, w.type, w.name, null, w.timeUtc, w.timeUtc == null))
        }

        // — Llegada (km = distancia) —
        // Existe aunque falte la hora prevista para poder combinarla con una
        // cima o waypoint del kilómetro final.
        if (distanceKm != null) {
            rows.add(Tmp(distanceKm, null, "finish", null, null, estimatedFinishTimeUtc, estimatedFinishTimeUtc == null))
        }

        // — Orden por km (estable: pie < cima por construcción) —
        val sorted = rows.sortedWith(compareBy { it.km })

        // — Deduplicar mismo km y tipo (tol. 0.05 km) —
        val deduped = mutableListOf<Tmp>()
        for (r in sorted) {
            val prev = deduped.lastOrNull()
            if (prev != null && prev.type == r.type && abs(prev.km - r.km) < 0.05) {
                if (prev.timeUtc == null && r.timeUtc != null) deduped[deduped.size - 1] = r
                continue
            }
            deduped.add(r)
        }

        // — Fusionar anotaciones en el mismo km EXACTO —
        // La meta tiene prioridad como acompañante de una cima o waypoint. Si
        // no coincide con ninguno, se conserva la fusión cima + waypoint.
        // Se mantiene un único punto con dos iconos, sin tolerancia decimal.
        val merged = mutableListOf<Tmp>()
        val consumed = mutableSetOf<Int>()
        fun isMergeableWaypoint(type: String): Boolean =
            type !in setOf("start", "finish", "climb_foot", "summit")
        for (index in deduped.indices) {
            if (index in consumed) continue
            val row = deduped[index]
            if (row.type == "summit" || isMergeableWaypoint(row.type)) {
                val finishIndex = deduped.indices.firstOrNull { candidateIndex ->
                    candidateIndex != index && candidateIndex !in consumed &&
                        deduped[candidateIndex].type == "finish" &&
                        deduped[candidateIndex].km == row.km
                }
                val waypointIndex = if (row.type == "summit") {
                    deduped.indices.firstOrNull { candidateIndex ->
                        candidateIndex != index && candidateIndex !in consumed &&
                            isMergeableWaypoint(deduped[candidateIndex].type) &&
                            deduped[candidateIndex].km == row.km
                    }
                } else null
                val companionIndex = finishIndex ?: waypointIndex
                if (companionIndex != null) {
                    val companion = deduped[companionIndex]
                    row.secondaryType = companion.type
                    row.secondaryLabel = companion.label
                    if (row.timeUtc == null && companion.timeUtc != null) {
                        row.timeUtc = companion.timeUtc
                        // La hora estimada de meta no convierte el punto en
                        // un ancla manual ni activa por sí sola la guía.
                        if (companion.type != "finish") {
                            row.isEstimated = companion.isEstimated
                        }
                    }
                    consumed += companionIndex
                }
            }
            merged += row
        }

        // — kmToGo —
        if (distanceKm != null) {
            for (r in merged) r.kmToGo = round1(distanceKm - r.km)
        }

        // — Interpolación de horas faltantes (no en CRI/CRE) —
        if (!isTimeTrial) {
            val anchors = merged.mapNotNull { r ->
                val secs = parseSeconds(r.timeUtc) ?: return@mapNotNull null
                r.km to secs
            }
            if (anchors.size >= 2) {
                for (r in merged) {
                    if (r.timeUtc != null) continue
                    var prev: Pair<Double, Double>? = null
                    var next: Pair<Double, Double>? = null
                    for (a in anchors) {
                        if (a.first <= r.km && (prev == null || a.first > prev!!.first)) prev = a
                        if (a.first >= r.km && (next == null || a.first < next!!.first)) next = a
                    }
                    val p = prev; val n = next
                    if (p != null && n != null && n.first > p.first) {
                        val t = (r.km - p.first) / (n.first - p.first)
                        r.timeUtc = isoFromSeconds(p.second + t * (n.second - p.second))
                        r.isEstimated = true
                    }
                }
            }
        }

        return merged.map {
            GuideRow(
                km = it.km,
                kmToGo = it.kmToGo,
                type = it.type,
                label = it.label,
                category = it.category,
                timeUtc = it.timeUtc,
                isEstimated = it.isEstimated,
                secondaryType = it.secondaryType,
                secondaryLabel = it.secondaryLabel,
            )
        }
    }

    /** True si la jornada tiene guía que merezca enseñarse. Es **opt-in**:
     *  solo si el editor introdujo al menos UNA hora real del rutómetro en un
     *  punto intermedio (cima/waypoint). Las horas interpoladas no bastan. */
    fun hasGuide(rows: List<GuideRow>): Boolean =
        rows.any { it.type != "start" && it.type != "finish" && it.timeUtc != null && !it.isEstimated }
}
