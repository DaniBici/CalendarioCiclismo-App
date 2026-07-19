package app.calendariociclismo.android.ui.startlist

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.data.model.Team
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Chapa ciclista SVG renderizada en Compose.
 * Réplica fiel del SVG web `buildTeamBadgeSvg` (js/shared.js).
 */
@Composable
fun TeamBadgeComposable(team: Team, size: Int = 24) {
    Canvas(modifier = Modifier.size(size.dp)) {
        // OJO: usar size.width (píxeles físicos del DrawScope), no el parámetro
        // `size` (dp). Si dibujamos con dp como si fueran px, en pantallas
        // densidad 3x la chapa ocupa 1/3 del Canvas → "liliputiense".
        val s = this.size.minDimension
        val cx = s / 2
        val cy = s / 2
        // rOuter casi = radio total (1px de margen al stroke); rInner mantiene
        // la proporción del SVG web (rInner / rOuter ≈ 0.38 / 0.48 = 0.792).
        val rOuter = s * 0.49f
        val rInner = rOuter * 0.792f
        val stripeW = rInner * 1.4f
        val divideY = cy + rInner * 0.4f
        val innerCy = cy - rInner * 0.35f
        val innerR = rInner * 0.22f

        val sides = 22
        val polygonPoints = mutableListOf<Offset>()
        for (i in 0 until sides) {
            val angle = (2 * PI * i) / sides - PI / 2
            val x = cx + rOuter * cos(angle).toFloat()
            val y = cy + rOuter * sin(angle).toFloat()
            polygonPoints.add(Offset(x, y))
        }

        val torsoCenter = parseColor(team.badgeTorsoCenter, Color.White)
        val torsoSides = parseColor(team.badgeTorsoSides, Color(0xFF111111))
        val shorts = parseColor(team.badgeShorts, Color(0xFF111111))
        val innerColor = team.badgeInnerCircle?.let { parseColor(it, Color.Gray) }

        // Polígono exterior (chapa) — fondo gris con borde más oscuro
        drawPolygonFill(polygonPoints, Color(0xFF8a8d91))
        drawPolygonStroke(polygonPoints, Color(0xFF5f6266), strokeWidth = s * 0.02f)

        // Interior recortado al círculo
        val clipPath = Path().apply {
            addOval(
                androidx.compose.ui.geometry.Rect(
                    Offset(cx - rInner, cy - rInner),
                    Size(rInner * 2, rInner * 2)
                )
            )
        }
        clipPath(clipPath) {
            // Pantalones (mitad inferior)
            drawRect(
                color = shorts,
                topLeft = Offset(0f, divideY),
                size = Size(s, s - divideY + 1f)
            )
            // Torso laterales (toda la mitad superior)
            drawRect(
                color = torsoSides,
                topLeft = Offset(0f, 0f),
                size = Size(s, divideY)
            )
            // Franja central del torso
            drawRect(
                color = torsoCenter,
                topLeft = Offset(cx - stripeW / 2, 0f),
                size = Size(stripeW, divideY)
            )
            // Círculo interior opcional (escudo / pecho)
            if (innerColor != null) {
                drawCircle(
                    color = innerColor,
                    radius = innerR,
                    center = Offset(cx, innerCy)
                )
            }
            // Línea divisoria torso/pantalón
            drawLine(
                color = Color.Black.copy(alpha = 0.22f),
                start = Offset(0f, divideY),
                end = Offset(s, divideY),
                strokeWidth = s * 0.025f
            )
        }

        // Borde sutil del círculo interior
        drawCircle(
            color = Color.Black.copy(alpha = 0.25f),
            radius = rInner,
            center = Offset(cx, cy),
            style = Stroke(width = s * 0.018f)
        )
    }
}

private fun parseColor(colorStr: String, default: Color): Color {
    return try {
        Color(android.graphics.Color.parseColor(colorStr))
    } catch (e: Exception) {
        default
    }
}

private fun DrawScope.drawPolygonFill(points: List<Offset>, color: Color) {
    val path = androidx.compose.ui.graphics.Path().apply {
        if (points.isNotEmpty()) {
            moveTo(points[0].x, points[0].y)
            for (i in 1 until points.size) {
                lineTo(points[i].x, points[i].y)
            }
            close()
        }
    }
    drawPath(path, color = color)
}

private fun DrawScope.drawPolygonStroke(
    points: List<Offset>,
    color: Color,
    strokeWidth: Float
) {
    val path = androidx.compose.ui.graphics.Path().apply {
        if (points.isNotEmpty()) {
            moveTo(points[0].x, points[0].y)
            for (i in 1 until points.size) {
                lineTo(points[i].x, points[i].y)
            }
            close()
        }
    }
    drawPath(
        path,
        color = color,
        style = androidx.compose.ui.graphics.drawscope.Stroke(width = strokeWidth)
    )
}
