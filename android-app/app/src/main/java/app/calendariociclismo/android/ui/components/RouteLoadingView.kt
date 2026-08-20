package app.calendariociclismo.android.ui.components

import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.DirectionsBike
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Perfil de ruta animado, inspirado en la carga de la web. Es deliberadamente
 * local: el arranque y los estados de carga nunca dependen de la red.
 */
@Composable
fun AnimatedRouteProfile(
    modifier: Modifier = Modifier,
    lineColor: Color = MaterialTheme.colorScheme.primary,
    fillColor: Color = lineColor.copy(alpha = 0.12f),
    riderColor: Color = lineColor,
) {
    val context = LocalContext.current
    val reduceMotion = remember {
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }
    val transition = rememberInfiniteTransition(label = "routeLoading")
    val rawProgress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2_600, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "routeProgress",
    )
    val progress = if (reduceMotion) 1f else rawProgress

    Canvas(modifier = modifier.clearAndSetSemantics { }) {
        val points = routePoints.map { Offset(it.x * size.width, it.y * size.height) }
        if (points.size < 2) return@Canvas

        val profile = Path().apply {
            moveTo(points.first().x, points.first().y)
            points.drop(1).forEach { lineTo(it.x, it.y) }
        }
        val fill = Path().apply {
            addPath(profile)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        drawPath(fill, color = fillColor)
        clipRect(right = size.width * progress) {
            drawPath(profile, color = lineColor, style = Stroke(width = 3.dp.toPx()))
        }

        if (!reduceMotion) {
            val rider = routePointAt(progress, points)
            drawCircle(color = riderColor, radius = 6.dp.toPx(), center = rider)
            drawCircle(color = Color.White.copy(alpha = 0.92f), radius = 2.dp.toPx(), center = rider)
        }
    }
}

/** Pantalla de carga de marca para esperas iniciales de contenido completo. */
@Composable
fun RouteLoadingView(
    message: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .semantics { contentDescription = message },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Zona central independiente: el perfil no puede cruzarse con la
        // identidad del cargador aunque la pantalla sea baja.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(bottom = 12.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.CalendarMonth,
                    contentDescription = null,
                    modifier = Modifier.size(28.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Icon(
                    imageVector = Icons.Filled.DirectionsBike,
                    contentDescription = null,
                    modifier = Modifier.size(32.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        AnimatedRouteProfile(
            modifier = Modifier
                .fillMaxWidth()
                .height(150.dp),
        )
    }
}

private data class RoutePoint(val x: Float, val y: Float)

// Perfil simplificado y neutro; conserva el ritmo de una jornada de montaña
// sin asociar el loading a una carrera concreta ni inflar el binario.
private val routePoints = listOf(
    RoutePoint(0f, .78f), RoutePoint(.06f, .74f), RoutePoint(.14f, .66f),
    RoutePoint(.22f, .72f), RoutePoint(.31f, .48f), RoutePoint(.40f, .36f),
    RoutePoint(.48f, .58f), RoutePoint(.58f, .70f), RoutePoint(.66f, .44f),
    RoutePoint(.74f, .24f), RoutePoint(.81f, .38f), RoutePoint(.88f, .20f),
    RoutePoint(.94f, .46f), RoutePoint(1f, .34f),
)

private fun routePointAt(progress: Float, points: List<Offset>): Offset {
    val x = progress.coerceIn(0f, 1f) * points.last().x
    val end = points.indexOfFirst { it.x >= x }.let { if (it <= 0) 1 else it }
    val start = points[end - 1]
    val finish = points[end]
    val local = ((x - start.x) / (finish.x - start.x)).coerceIn(0f, 1f)
    return Offset(
        x = x,
        y = start.y + (finish.y - start.y) * local,
    )
}
