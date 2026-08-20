package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import android.graphics.Paint
import android.graphics.Typeface
import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.ProfileSummit
import app.calendariociclismo.android.data.model.ProfileWaypoint
import kotlinx.coroutines.delay
import kotlin.math.max
import kotlin.math.min

private val SUMMIT_COLOR  = Color(0xFFC53030)
/** Color neutro de la porción aún "no recorrida" cuando se muestra progreso. */
private val PROGRESS_BASE = Color(0xFF999999)
private val COLOR_SPRINT  = Color(0xFF0F9D58)
private val COLOR_BONUS   = Color(0xFFF9AB00)
private val COLOR_SPLIT   = Color(0xFF00838F)
private val COLOR_COBBLE  = Color(0xFFB0B0B0)
private val COLOR_STERRA  = Color(0xFFC8A870)

private val SUPPORTED_WAYPOINT_TYPES = setOf(
    "intermediate_sprint", "bonus_sprint", "intermediate_split",
    "cobblestone", "sterrato",
)

private fun waypointColor(type: String): Color = when (type) {
    "intermediate_sprint" -> COLOR_SPRINT
    "bonus_sprint"        -> COLOR_BONUS
    "intermediate_split"  -> COLOR_SPLIT
    "cobblestone"         -> COLOR_COBBLE
    "sterrato"            -> COLOR_STERRA
    else                  -> Color(0xFF8E9099)
}

/**
 * Mini-perfil de elevación compacto para racecards de "Hoy".
 *
 * Renderiza la silueta de altimetría más indicadores circulares sobre la
 * curva: summits (rojo) + waypoints (sprint, bonif., split, pavé, sterrato).
 *
 * Escala Y idéntica a `js/elevation-profile.js` → `buildElevationSparkline`:
 * `padding = max(100, 300 - range·0.1)`, `yMin = max(0, minAlt - padding)`,
 * `yMax = maxAlt + padding`. Esta referencia común evita exagerar el relieve
 * en las apps frente a la web.
 *
 * Sin etiquetas, sin grid, sin interactividad.
 */
@Composable
fun MiniElevationProfile(
    profile: ElevationProfile,
    tint: Color,
    modifier: Modifier = Modifier,
    height: Dp = 22.dp,
    summits: List<ProfileSummit> = emptyList(),
    waypoints: List<ProfileWaypoint> = emptyList(),
    /**
     * Tipo primario de la etapa. Se conserva por compatibilidad de llamadas;
     * la escala vertical es común para todos los tipos, igual que en la web.
     */
    primaryType: String? = null,
    /**
     * Horas (epoch ms) de salida y llegada. Cuando ambas existen y no es
     * contrarreloj, activan el relleno temporal: la silueta se pinta gris y se
     * tiñe de izquierda a derecha según el % de tiempo transcurrido, con
     * auto-refresco cada 60 s (paridad con la web).
     */
    startTimeMs: Long? = null,
    endTimeMs: Long? = null,
    /** CRI/CRE: el reloj de pelotón no representa un avance único → sin relleno. */
    isTimeTrial: Boolean = false,
    /** Competición iguala una crono sin horario a una jornada en línea; Hoy no. */
    usesLineFallbackWithoutTimeTrialSchedule: Boolean = false,
    /** Fuerza 100% cuando la tarjeta ya muestra Resultados o Revive. */
    forceCompleted: Boolean = false,
) {
    // Reloj que avanza cada 60 s mientras la etapa está en curso. `remember`
    // y `LaunchedEffect` se invocan siempre (las condiciones van dentro) para
    // no romper las reglas de composición.
    val nowState = remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(startTimeMs, endTimeMs, isTimeTrial) {
        if (startTimeMs == null || endTimeMs == null || endTimeMs <= startTimeMs || isTimeTrial) {
            return@LaunchedEffect
        }
        while (true) {
            nowState.value = System.currentTimeMillis()
            if (nowState.value >= endTimeMs) break
            delay(60_000L)
        }
    }
    val progress: Float? = when {
        // CRI/CRE: siempre 0% (silueta gris, sin teñir). Cada corredor o equipo
        // sale en un momento distinto, así que un único reloj de salida→llegada
        // no representa el avance (paridad con la web).
        forceCompleted -> 1f
        // Hoy conserva el gris de las cronos sin horario. Competición puede
        // optar por el fallback teñido de una jornada en línea en ese caso.
        isTimeTrial && (!usesLineFallbackWithoutTimeTrialSchedule ||
            (startTimeMs != null && endTimeMs != null)) -> 0f
        startTimeMs != null && endTimeMs != null && endTimeMs > startTimeMs ->
            ((nowState.value - startTimeMs).toFloat() / (endTimeMs - startTimeMs).toFloat()).coerceIn(0f, 1f)
        else -> null
    }

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .clearAndSetSemantics { }
    ) {
        val pts = profile.points
        if (pts.size < 2) return@Canvas

        // Paridad con iOS: buscar extremos en lugar de asumir orden.
        val xMin = pts.minOf { it.km }
        val xMax = pts.maxOf { it.km }
        if (xMax <= xMin) return@Canvas

        val indicatorRadius = 6.dp.toPx()
        // La silueta llega a sangre por el ancho [0, width]. Un mínimo de padding
        // superior evita que el trazo del pico se recorte arriba, y un padding
        // inferior deja una franja libre sobre el borde de abajo para que la
        // silueta no quede pegada al borde de la tarjeta. Los indicadores tienen
        // su propio clamp.
        // `bottomPad` eleva la BASELINE de la curva: el valor más bajo de la
        // silueta no se aplasta contra el borde, sino que se mantiene a
        // `bottomPad` del fondo. El relleno (fill) SÍ baja hasta el borde
        // inferior real (suelo de color hasta el borde, sin hueco) y el clip de
        // progreso lo tiñe igual → el suelo avanza de color con la barra.
        val topPad = 1f
        val bottomPad = 3.dp.toPx()
        val plotW = max(1f, size.width)
        val plotH = max(1f, size.height - topPad - bottomPad)

        val minAlt = (profile.minElevation?.toDouble()
            ?: pts.minOf { it.alt.toDouble() })
        val maxAlt = (profile.maxElevation?.toDouble()
            ?: pts.maxOf { it.alt.toDouble() })
        // Misma escala que el miniperfil web, para todos los tipos de etapa.
        val range = maxAlt - minAlt
        val padding = max(100.0, 300.0 - range * 0.1)
        val yMin = max(0.0, minAlt - padding)
        val yMax = maxAlt + padding
        val yRange = max(yMax - yMin, 1.0)

        fun project(km: Double, alt: Double): Offset {
            val xRatio = (km - xMin) / (xMax - xMin)
            val yRatio = (alt - yMin) / yRange
            return Offset(
                x = (plotW * xRatio).toFloat(),
                y = (topPad + plotH * (1.0 - yRatio)).toFloat(),
            )
        }

        fun clampIndicator(pt: Offset): Offset {
            // La silueta llega a sangre, pero los círculos del indicador se
            // mantienen dentro del canvas para no recortarse contra los bordes.
            val r = indicatorRadius + 1f
            return Offset(pt.x.coerceIn(r, size.width - r), pt.y.coerceIn(r, size.height - r))
        }

        fun interpAlt(km: Double): Double {
            if (km <= pts.first().km) return pts.first().alt.toDouble()
            if (km >= pts.last().km)  return pts.last().alt.toDouble()
            for (i in 0 until pts.size - 1) {
                val p0 = pts[i]; val p1 = pts[i + 1]
                if (km in p0.km..p1.km) {
                    val span = p1.km - p0.km
                    if (span <= 0) return p0.alt.toDouble()
                    val t = (km - p0.km) / span
                    return p0.alt + t * (p1.alt - p0.alt)
                }
            }
            return pts.last().alt.toDouble()
        }

        fun pointAt(index: Int): Offset = project(pts[index].km, pts[index].alt.toDouble())

        // Fill
        val fillPath = Path().apply {
            val first = pointAt(0)
            moveTo(first.x, size.height)
            lineTo(first.x, first.y)
            for (i in 1 until pts.size) {
                val p = pointAt(i)
                lineTo(p.x, p.y)
            }
            val last = pointAt(pts.size - 1)
            lineTo(last.x, size.height)
            close()
        }
        // Trazo principal
        val strokePath = Path().apply {
            val first = pointAt(0)
            moveTo(first.x, first.y)
            for (i in 1 until pts.size) {
                val p = pointAt(i)
                lineTo(p.x, p.y)
            }
        }

        if (progress != null) {
            // Base gris (silueta completa) + porción teñida recortada al
            // % transcurrido: el relleno avanza de izquierda a derecha.
            drawPath(fillPath, color = PROGRESS_BASE.copy(alpha = 0.28f))
            drawPath(strokePath, color = PROGRESS_BASE.copy(alpha = 0.5f), style = Stroke(width = 1.4f))
            clipRect(left = 0f, top = 0f, right = size.width * progress, bottom = size.height) {
                drawPath(fillPath, color = tint.copy(alpha = 0.20f))
                drawPath(strokePath, color = tint.copy(alpha = 0.95f), style = Stroke(width = 1.4f))
            }
        } else {
            drawPath(fillPath, color = tint.copy(alpha = 0.15f))
            drawPath(strokePath, color = tint.copy(alpha = 0.85f), style = Stroke(width = 1.4f))
        }

        // Indicadores: summits primero, luego waypoints (mismo orden que iOS).
        for (summit in summits) {
            val summitKm = summit.km ?: continue
            if (summitKm < xMin || summitKm > xMax) continue
            val alt = interpAlt(summitKm)
            val center = clampIndicator(project(summitKm, alt))
            drawSummitIndicator(center, indicatorRadius, summit.category)
        }
        for (wp in waypoints) {
            if (wp.type !in SUPPORTED_WAYPOINT_TYPES) continue
            val wpKm = wp.km ?: continue
            if (wpKm < xMin || wpKm > xMax) continue
            val alt = interpAlt(wpKm)
            val center = clampIndicator(project(wpKm, alt))
            drawWaypointIndicator(center, indicatorRadius, wp.type)
        }
    }
}

private fun DrawScope.drawSummitIndicator(center: Offset, radius: Float, category: String?) {
    // Fondo rojo
    drawCircle(color = SUMMIT_COLOR, radius = radius, center = center)
    drawCircle(color = Color.White, radius = radius, center = center, style = Stroke(width = 0.8f))

    // Glifo: categoría o triángulo para montañas sin cat / 'M'
    val glyph = if (!category.isNullOrEmpty() && category != "M") category else "▲"
    val fontSize = if (glyph.length >= 2) radius * 0.95f else radius * 1.25f

    val paint = Paint().apply {
        color = android.graphics.Color.WHITE
        textSize = fontSize
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textAlign = Paint.Align.CENTER
        isAntiAlias = true
    }
    val textY = center.y - (paint.ascent() + paint.descent()) / 2f
    drawContext.canvas.nativeCanvas.drawText(glyph, center.x, textY, paint)
}

private fun DrawScope.drawWaypointIndicator(center: Offset, radius: Float, type: String) {
    val color = waypointColor(type)
    drawCircle(color = color, radius = radius, center = center)
    drawCircle(color = Color.White, radius = radius, center = center, style = Stroke(width = 0.8f))

    val (glyph, textColor, sizeMultiplier) = when (type) {
        "intermediate_sprint" -> Triple("S", android.graphics.Color.WHITE, 1.25f)
        "bonus_sprint"        -> Triple("B", android.graphics.Color.BLACK, 1.25f)
        "intermediate_split"  -> Triple("⏱", android.graphics.Color.WHITE, 1.15f)
        "cobblestone"         -> Triple("◆", android.graphics.Color.WHITE, 1.15f)
        "sterrato"            -> Triple("●", android.graphics.Color.WHITE, 0.9f)
        else                  -> return
    }

    val paint = Paint().apply {
        setColor(textColor)
        textSize = radius * sizeMultiplier
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textAlign = Paint.Align.CENTER
        isAntiAlias = true
    }
    val textY = center.y - (paint.ascent() + paint.descent()) / 2f
    drawContext.canvas.nativeCanvas.drawText(glyph, center.x, textY, paint)
}
