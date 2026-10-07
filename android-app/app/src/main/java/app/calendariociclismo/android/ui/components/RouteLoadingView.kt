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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import android.os.SystemClock
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.theme.CCText
import kotlinx.coroutines.delay

/**
 * Perfil de carga compartido por los estados de espera y el splash propio.
 * Espejo de `AnimatedRouteProfile` en iOS (LoadingView.swift): usa una copia
 * local del perfil de la etapa 20 de La Vuelta 2026 y es deliberadamente
 * local, sin red.
 */
@Composable
fun AnimatedRouteProfile(
    modifier: Modifier = Modifier,
    lineColor: Color = MaterialTheme.colorScheme.primary,
    fillColor: Color = lineColor.copy(alpha = 0.16f),
    riderColor: Color = lineColor,
) {
    val context = LocalContext.current
    // Equivalente Android de Reducir movimiento: animaciones del sistema en 0.
    val reduceMotion = remember {
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }
    // Ciclo de 5,2 s idéntico a iOS: el recorrido se traza en 4,6 s y se
    // funde durante los 0,6 s restantes antes de repetir.
    val transition = rememberInfiniteTransition(label = "routeLoading")
    val rawCycle by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(CYCLE_MILLIS, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "routeCycle",
    )
    val cycleSeconds = rawCycle * CYCLE_SECONDS
    val progress = if (reduceMotion) 1f else (cycleSeconds / TRACE_SECONDS).coerceAtMost(1f)
    val traceAlpha = if (reduceMotion) 1f else ((CYCLE_SECONDS - cycleSeconds) / FADE_SECONDS).coerceIn(0f, 1f)

    Canvas(modifier = modifier.clearAndSetSemantics { }) {
        val points = routePoints.map { Offset(it.x * size.width, it.y * size.height) }
        if (points.size < 2) return@Canvas

        val profile = smoothProfile(points)
        val fill = Path().apply {
            addPath(profile)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        drawPath(
            fill,
            brush = Brush.verticalGradient(
                colors = listOf(fillColor, fillColor.copy(alpha = FILL_BOTTOM_ALPHA)),
                startY = 0f,
                endY = size.height,
            ),
        )
        drawPath(
            profile,
            color = lineColor.copy(alpha = lineColor.alpha * BASELINE_ALPHA),
            style = Stroke(width = 1.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
        )

        // La línea y el marcador usan la misma curva, sin recortar el círculo.
        val measure = PathMeasure()
        measure.setPath(profile, false)
        val travelled = Path()
        measure.getSegment(0f, measure.length * progress, travelled, true)
        drawPath(
            travelled,
            color = lineColor.copy(alpha = lineColor.alpha * HALO_ALPHA * traceAlpha),
            style = Stroke(width = 7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
        drawPath(
            travelled,
            color = lineColor.copy(alpha = lineColor.alpha * traceAlpha),
            style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
        )

        if (reduceMotion) return@Canvas
        val rider = measure.getPosition(measure.length * progress)
        if (rider == Offset.Unspecified) return@Canvas
        drawCircle(
            color = lineColor.copy(alpha = lineColor.alpha * RIDER_HALO_ALPHA * traceAlpha),
            radius = 9.dp.toPx(),
            center = rider,
        )
        drawCircle(
            color = riderColor.copy(alpha = riderColor.alpha * traceAlpha),
            radius = 3.5f.dp.toPx(),
            center = rider,
        )
    }
}

/**
 * Tiempos de la pantalla de carga, espejo de `js/page-loading.js` e iOS
 * `LoadingTiming`: la animación solo aparece en cargas lentas y, una vez
 * visible, se mantiene un mínimo para no parpadear.
 */
object LoadingTiming {
    /** Espera antes de mostrar el rótulo y el perfil (`REVEAL_MS`). */
    const val REVEAL_MILLIS = 400L
    /** Permanencia mínima una vez visible (`MIN_SHOW_MS`). */
    const val MIN_SHOW_MILLIS = 300L

    /**
     * Tiempo que la pantalla de carga sigue visible cuando el contenido ya está
     * listo, según lo transcurrido desde que empezó la espera. Una carga rápida
     * (sin animación visible) no espera nada.
     */
    fun remainingHold(elapsedMillis: Long): Long {
        if (elapsedMillis < REVEAL_MILLIS) return 0L
        return (REVEAL_MILLIS + MIN_SHOW_MILLIS - elapsedMillis).coerceAtLeast(0L)
    }
}

/**
 * Estado visible de una carga inicial: `true` mientras [isLoading] y, si la
 * animación llegó a verse, durante el resto de [LoadingTiming.MIN_SHOW_MILLIS].
 * El llamador pinta [RouteLoadingView] mientras devuelva `true`.
 */
@Composable
fun rememberLoadingVisible(isLoading: Boolean): Boolean {
    var visible by remember { mutableStateOf(isLoading) }
    var startedAt by remember { mutableLongStateOf(if (isLoading) SystemClock.uptimeMillis() else 0L) }
    LaunchedEffect(isLoading) {
        if (isLoading) {
            if (!visible) {
                startedAt = SystemClock.uptimeMillis()
                visible = true
            }
            return@LaunchedEffect
        }
        if (!visible) return@LaunchedEffect
        val hold = LoadingTiming.remainingHold(SystemClock.uptimeMillis() - startedAt)
        if (hold > 0) delay(hold)
        visible = false
    }
    return visible || isLoading
}

/**
 * Pantalla de carga del contenido. La barra superior y la navegación quedan
 * visibles: la vista ocupa solo el área de contenido. El rótulo y el perfil
 * aparecen tras [LoadingTiming.REVEAL_MILLIS]; antes solo se ve el fondo.
 *
 * [title] nombra lo que se carga (la pantalla, la carrera o la jornada; en Hoy,
 * «Carreras de hoy»), sin repetir la marca de la cabecera; con título, la
 * segunda línea dice «Cargando…». Sin título, [message] es la única línea.
 * `showProfile=false` retira el perfil inferior (ciclocross).
 */
@Composable
fun RouteLoadingView(
    message: String,
    modifier: Modifier = Modifier,
    showProfile: Boolean = true,
    title: String? = null,
) {
    var revealed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(LoadingTiming.REVEAL_MILLIS)
        revealed = true
    }
    val alpha by animateFloatAsState(
        targetValue = if (revealed) 1f else 0f,
        animationSpec = tween(durationMillis = 250),
        label = "loadingReveal",
    )
    val loadingLine = if (title == null) message else stringResource(R.string.loading)
    Column(
        modifier = modifier
            .fillMaxSize()
            .alpha(alpha)
            .semantics { contentDescription = listOfNotNull(title, loadingLine).joinToString(". ") },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Zona central independiente: el perfil no puede cruzarse con el
        // rótulo aunque la pantalla sea baja.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        ) {
            if (title != null) {
                Text(
                    text = title,
                    style = CCText.S20,
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                )
            }
            Text(
                text = loadingLine,
                style = CCText.S14,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            if (!showProfile) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .padding(top = 4.dp)
                        .size(20.dp),
                    strokeWidth = 2.dp,
                )
            }
        }
        if (showProfile) {
            AnimatedRouteProfile(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(150.dp),
            )
        }
    }
}

private data class RoutePoint(val x: Float, val y: Float)

// La Vuelta 2026, etapa 20: La Calahorra → Collado del Alguacil (186,8 km).
// 350 muestras del perfil publicado: la-vuelta-2026-etapa-20.
// Distancia normalizada a 0…1; altitud 683…1884 m dentro de la franja 0,86…0,14.
// Copia local para que el arranque no dependa de una consulta de red.
private val routePoints = listOf(
    RoutePoint(0.00000f, 0.56085f), RoutePoint(0.00289f, 0.56025f), RoutePoint(0.00573f, 0.55905f),
    RoutePoint(0.00862f, 0.55785f), RoutePoint(0.01146f, 0.55545f), RoutePoint(0.01435f, 0.54766f),
    RoutePoint(0.01718f, 0.54646f), RoutePoint(0.02007f, 0.54586f), RoutePoint(0.02291f, 0.53507f),
    RoutePoint(0.02580f, 0.52248f), RoutePoint(0.02864f, 0.51709f), RoutePoint(0.03153f, 0.51948f),
    RoutePoint(0.03437f, 0.52428f), RoutePoint(0.03726f, 0.52668f), RoutePoint(0.04010f, 0.52308f),
    RoutePoint(0.04299f, 0.52008f), RoutePoint(0.04582f, 0.51828f), RoutePoint(0.04872f, 0.52308f),
    RoutePoint(0.05155f, 0.53027f), RoutePoint(0.05444f, 0.53987f), RoutePoint(0.05728f, 0.55066f),
    RoutePoint(0.06017f, 0.56025f), RoutePoint(0.06306f, 0.56385f), RoutePoint(0.06590f, 0.56565f),
    RoutePoint(0.06879f, 0.57344f), RoutePoint(0.07163f, 0.58003f), RoutePoint(0.07452f, 0.58543f),
    RoutePoint(0.07736f, 0.59202f), RoutePoint(0.08025f, 0.59982f), RoutePoint(0.08308f, 0.60461f),
    RoutePoint(0.08597f, 0.60881f), RoutePoint(0.08881f, 0.61301f), RoutePoint(0.09170f, 0.61660f),
    RoutePoint(0.09454f, 0.62140f), RoutePoint(0.09743f, 0.62500f), RoutePoint(0.10027f, 0.62739f),
    RoutePoint(0.10316f, 0.62799f), RoutePoint(0.10600f, 0.62979f), RoutePoint(0.10889f, 0.64238f),
    RoutePoint(0.11172f, 0.66336f), RoutePoint(0.11461f, 0.67415f), RoutePoint(0.11745f, 0.69454f),
    RoutePoint(0.12034f, 0.70713f), RoutePoint(0.12323f, 0.70893f), RoutePoint(0.12607f, 0.71432f),
    RoutePoint(0.12896f, 0.72271f), RoutePoint(0.13180f, 0.72391f), RoutePoint(0.13469f, 0.72152f),
    RoutePoint(0.13753f, 0.72571f), RoutePoint(0.14042f, 0.72751f), RoutePoint(0.14325f, 0.72811f),
    RoutePoint(0.14615f, 0.72691f), RoutePoint(0.14898f, 0.72391f), RoutePoint(0.15187f, 0.71972f),
    RoutePoint(0.15471f, 0.70953f), RoutePoint(0.15760f, 0.69873f), RoutePoint(0.16044f, 0.71492f),
    RoutePoint(0.16333f, 0.73291f), RoutePoint(0.16617f, 0.73890f), RoutePoint(0.16906f, 0.73291f),
    RoutePoint(0.17190f, 0.71792f), RoutePoint(0.17479f, 0.70233f), RoutePoint(0.17768f, 0.68734f),
    RoutePoint(0.18051f, 0.67356f), RoutePoint(0.18340f, 0.67236f), RoutePoint(0.18624f, 0.66816f),
    RoutePoint(0.18913f, 0.65437f), RoutePoint(0.19197f, 0.64598f), RoutePoint(0.19486f, 0.65197f),
    RoutePoint(0.19770f, 0.64658f), RoutePoint(0.20059f, 0.64238f), RoutePoint(0.20343f, 0.65737f),
    RoutePoint(0.20632f, 0.67475f), RoutePoint(0.20915f, 0.67415f), RoutePoint(0.21204f, 0.67176f),
    RoutePoint(0.21488f, 0.68495f), RoutePoint(0.21777f, 0.68555f), RoutePoint(0.22061f, 0.67775f),
    RoutePoint(0.22350f, 0.67176f), RoutePoint(0.22634f, 0.66336f), RoutePoint(0.22923f, 0.65677f),
    RoutePoint(0.23207f, 0.64838f), RoutePoint(0.23496f, 0.63998f), RoutePoint(0.23785f, 0.62859f),
    RoutePoint(0.24069f, 0.61840f), RoutePoint(0.24358f, 0.60461f), RoutePoint(0.24641f, 0.58843f),
    RoutePoint(0.24930f, 0.56804f), RoutePoint(0.25214f, 0.55425f), RoutePoint(0.25503f, 0.54406f),
    RoutePoint(0.25787f, 0.53627f), RoutePoint(0.26076f, 0.52968f), RoutePoint(0.26360f, 0.52248f),
    RoutePoint(0.26649f, 0.51409f), RoutePoint(0.26933f, 0.49670f), RoutePoint(0.27222f, 0.49910f),
    RoutePoint(0.27505f, 0.51289f), RoutePoint(0.27794f, 0.53387f), RoutePoint(0.28078f, 0.55066f),
    RoutePoint(0.28367f, 0.54946f), RoutePoint(0.28651f, 0.54646f), RoutePoint(0.28940f, 0.55965f),
    RoutePoint(0.29224f, 0.57104f), RoutePoint(0.29513f, 0.57943f), RoutePoint(0.29802f, 0.58963f),
    RoutePoint(0.30086f, 0.60221f), RoutePoint(0.30375f, 0.61540f), RoutePoint(0.30658f, 0.62320f),
    RoutePoint(0.30948f, 0.63459f), RoutePoint(0.31231f, 0.63039f), RoutePoint(0.31520f, 0.63219f),
    RoutePoint(0.31804f, 0.62679f), RoutePoint(0.32093f, 0.62320f), RoutePoint(0.32377f, 0.63579f),
    RoutePoint(0.32666f, 0.65257f), RoutePoint(0.32950f, 0.66097f), RoutePoint(0.33239f, 0.67895f),
    RoutePoint(0.33522f, 0.68674f), RoutePoint(0.33812f, 0.69454f), RoutePoint(0.34095f, 0.70713f),
    RoutePoint(0.34384f, 0.72691f), RoutePoint(0.34668f, 0.74609f), RoutePoint(0.34957f, 0.76528f),
    RoutePoint(0.35241f, 0.77307f), RoutePoint(0.35530f, 0.77847f), RoutePoint(0.35819f, 0.78206f),
    RoutePoint(0.36103f, 0.78626f), RoutePoint(0.36392f, 0.78926f), RoutePoint(0.36676f, 0.78986f),
    RoutePoint(0.36965f, 0.79346f), RoutePoint(0.37248f, 0.79885f), RoutePoint(0.37537f, 0.80425f),
    RoutePoint(0.37821f, 0.81084f), RoutePoint(0.38110f, 0.81684f), RoutePoint(0.38394f, 0.81923f),
    RoutePoint(0.38683f, 0.81684f), RoutePoint(0.38967f, 0.82163f), RoutePoint(0.39256f, 0.82463f),
    RoutePoint(0.39540f, 0.82523f), RoutePoint(0.39829f, 0.82703f), RoutePoint(0.40112f, 0.83302f),
    RoutePoint(0.40401f, 0.84082f), RoutePoint(0.40685f, 0.84441f), RoutePoint(0.40974f, 0.85161f),
    RoutePoint(0.41263f, 0.85700f), RoutePoint(0.41547f, 0.86000f), RoutePoint(0.41836f, 0.86000f),
    RoutePoint(0.42120f, 0.85341f), RoutePoint(0.42409f, 0.84861f), RoutePoint(0.42693f, 0.84921f),
    RoutePoint(0.42982f, 0.84441f), RoutePoint(0.43266f, 0.84022f), RoutePoint(0.43555f, 0.83542f),
    RoutePoint(0.43838f, 0.83302f), RoutePoint(0.44127f, 0.83002f), RoutePoint(0.44411f, 0.81384f),
    RoutePoint(0.44700f, 0.79166f), RoutePoint(0.44984f, 0.78087f), RoutePoint(0.45273f, 0.78866f),
    RoutePoint(0.45557f, 0.78626f), RoutePoint(0.45846f, 0.78206f), RoutePoint(0.46130f, 0.76588f),
    RoutePoint(0.46419f, 0.72931f), RoutePoint(0.46702f, 0.69574f), RoutePoint(0.46991f, 0.66276f),
    RoutePoint(0.47281f, 0.63339f), RoutePoint(0.47564f, 0.60042f), RoutePoint(0.47853f, 0.57044f),
    RoutePoint(0.48137f, 0.54526f), RoutePoint(0.48426f, 0.52188f), RoutePoint(0.48710f, 0.49610f),
    RoutePoint(0.48999f, 0.47092f), RoutePoint(0.49283f, 0.44035f), RoutePoint(0.49572f, 0.41757f),
    RoutePoint(0.49855f, 0.42536f), RoutePoint(0.50145f, 0.41757f), RoutePoint(0.50428f, 0.38160f),
    RoutePoint(0.50717f, 0.40678f), RoutePoint(0.51001f, 0.42956f), RoutePoint(0.51290f, 0.45054f),
    RoutePoint(0.51574f, 0.46193f), RoutePoint(0.51863f, 0.47752f), RoutePoint(0.52147f, 0.49790f),
    RoutePoint(0.52436f, 0.51709f), RoutePoint(0.52719f, 0.53987f), RoutePoint(0.53009f, 0.56385f),
    RoutePoint(0.53298f, 0.58663f), RoutePoint(0.53581f, 0.61001f), RoutePoint(0.53870f, 0.63039f),
    RoutePoint(0.54154f, 0.64778f), RoutePoint(0.54443f, 0.65557f), RoutePoint(0.54727f, 0.66456f),
    RoutePoint(0.55016f, 0.68854f), RoutePoint(0.55300f, 0.71432f), RoutePoint(0.55589f, 0.73950f),
    RoutePoint(0.55873f, 0.76468f), RoutePoint(0.56162f, 0.78926f), RoutePoint(0.56445f, 0.80784f),
    RoutePoint(0.56734f, 0.81564f), RoutePoint(0.57018f, 0.82403f), RoutePoint(0.57307f, 0.83182f),
    RoutePoint(0.57591f, 0.83482f), RoutePoint(0.57880f, 0.83842f), RoutePoint(0.58164f, 0.84201f),
    RoutePoint(0.58453f, 0.84441f), RoutePoint(0.58737f, 0.83782f), RoutePoint(0.59026f, 0.83482f),
    RoutePoint(0.59315f, 0.84142f), RoutePoint(0.59599f, 0.83902f), RoutePoint(0.59888f, 0.83362f),
    RoutePoint(0.60171f, 0.82823f), RoutePoint(0.60460f, 0.82643f), RoutePoint(0.60744f, 0.82403f),
    RoutePoint(0.61033f, 0.81204f), RoutePoint(0.61317f, 0.79166f), RoutePoint(0.61606f, 0.77667f),
    RoutePoint(0.61890f, 0.77907f), RoutePoint(0.62179f, 0.77727f), RoutePoint(0.62463f, 0.77547f),
    RoutePoint(0.62752f, 0.76528f), RoutePoint(0.63035f, 0.73470f), RoutePoint(0.63324f, 0.69993f),
    RoutePoint(0.63608f, 0.66636f), RoutePoint(0.63897f, 0.63099f), RoutePoint(0.64181f, 0.60221f),
    RoutePoint(0.64470f, 0.57104f), RoutePoint(0.64759f, 0.54466f), RoutePoint(0.65043f, 0.52068f),
    RoutePoint(0.65332f, 0.49430f), RoutePoint(0.65616f, 0.46973f), RoutePoint(0.65905f, 0.43735f),
    RoutePoint(0.66188f, 0.40918f), RoutePoint(0.66478f, 0.41097f), RoutePoint(0.66761f, 0.41277f),
    RoutePoint(0.67050f, 0.38160f), RoutePoint(0.67334f, 0.39599f), RoutePoint(0.67623f, 0.42057f),
    RoutePoint(0.67907f, 0.44215f), RoutePoint(0.68196f, 0.46013f), RoutePoint(0.68480f, 0.47212f),
    RoutePoint(0.68769f, 0.49131f), RoutePoint(0.69052f, 0.50809f), RoutePoint(0.69342f, 0.53147f),
    RoutePoint(0.69625f, 0.55366f), RoutePoint(0.69914f, 0.57704f), RoutePoint(0.70198f, 0.60042f),
    RoutePoint(0.70487f, 0.62200f), RoutePoint(0.70776f, 0.64418f), RoutePoint(0.71060f, 0.66756f),
    RoutePoint(0.71349f, 0.68914f), RoutePoint(0.71633f, 0.71252f), RoutePoint(0.71922f, 0.73470f),
    RoutePoint(0.72206f, 0.75629f), RoutePoint(0.72495f, 0.78027f), RoutePoint(0.72778f, 0.80065f),
    RoutePoint(0.73067f, 0.79885f), RoutePoint(0.73351f, 0.78566f), RoutePoint(0.73640f, 0.77787f),
    RoutePoint(0.73924f, 0.75988f), RoutePoint(0.74213f, 0.73590f), RoutePoint(0.74497f, 0.71012f),
    RoutePoint(0.74786f, 0.68974f), RoutePoint(0.75070f, 0.68435f), RoutePoint(0.75359f, 0.67715f),
    RoutePoint(0.75642f, 0.65737f), RoutePoint(0.75931f, 0.64298f), RoutePoint(0.76215f, 0.62320f),
    RoutePoint(0.76504f, 0.62320f), RoutePoint(0.76793f, 0.62200f), RoutePoint(0.77077f, 0.62380f),
    RoutePoint(0.77366f, 0.62859f), RoutePoint(0.77650f, 0.60881f), RoutePoint(0.77939f, 0.60042f),
    RoutePoint(0.78223f, 0.61241f), RoutePoint(0.78512f, 0.62739f), RoutePoint(0.78796f, 0.64298f),
    RoutePoint(0.79085f, 0.63459f), RoutePoint(0.79368f, 0.62080f), RoutePoint(0.79657f, 0.58963f),
    RoutePoint(0.79941f, 0.55246f), RoutePoint(0.80230f, 0.51589f), RoutePoint(0.80514f, 0.48411f),
    RoutePoint(0.80803f, 0.45294f), RoutePoint(0.81087f, 0.42716f), RoutePoint(0.81376f, 0.40198f),
    RoutePoint(0.81660f, 0.37620f), RoutePoint(0.81949f, 0.35402f), RoutePoint(0.82232f, 0.33424f),
    RoutePoint(0.82521f, 0.31206f), RoutePoint(0.82810f, 0.29047f), RoutePoint(0.83094f, 0.27669f),
    RoutePoint(0.83383f, 0.28028f), RoutePoint(0.83667f, 0.30366f), RoutePoint(0.83956f, 0.32525f),
    RoutePoint(0.84240f, 0.33724f), RoutePoint(0.84529f, 0.34443f), RoutePoint(0.84813f, 0.35282f),
    RoutePoint(0.85102f, 0.37021f), RoutePoint(0.85385f, 0.38759f), RoutePoint(0.85675f, 0.40978f),
    RoutePoint(0.85958f, 0.43136f), RoutePoint(0.86247f, 0.45114f), RoutePoint(0.86531f, 0.46373f),
    RoutePoint(0.86820f, 0.47992f), RoutePoint(0.87104f, 0.49970f), RoutePoint(0.87393f, 0.51948f),
    RoutePoint(0.87677f, 0.54346f), RoutePoint(0.87966f, 0.56684f), RoutePoint(0.88255f, 0.59142f),
    RoutePoint(0.88539f, 0.61301f), RoutePoint(0.88828f, 0.63519f), RoutePoint(0.89111f, 0.65737f),
    RoutePoint(0.89400f, 0.68075f), RoutePoint(0.89684f, 0.70293f), RoutePoint(0.89973f, 0.72631f),
    RoutePoint(0.90257f, 0.74909f), RoutePoint(0.90546f, 0.77187f), RoutePoint(0.90830f, 0.79765f),
    RoutePoint(0.91119f, 0.80125f), RoutePoint(0.91403f, 0.79286f), RoutePoint(0.91692f, 0.78266f),
    RoutePoint(0.91975f, 0.77067f), RoutePoint(0.92264f, 0.74849f), RoutePoint(0.92548f, 0.72331f),
    RoutePoint(0.92837f, 0.69754f), RoutePoint(0.93121f, 0.68794f), RoutePoint(0.93410f, 0.68195f),
    RoutePoint(0.93694f, 0.66816f), RoutePoint(0.93983f, 0.65137f), RoutePoint(0.94272f, 0.63639f),
    RoutePoint(0.94556f, 0.62020f), RoutePoint(0.94845f, 0.63039f), RoutePoint(0.95128f, 0.62500f),
    RoutePoint(0.95418f, 0.62919f), RoutePoint(0.95701f, 0.62200f), RoutePoint(0.95990f, 0.59562f),
    RoutePoint(0.96274f, 0.56565f), RoutePoint(0.96563f, 0.53567f), RoutePoint(0.96847f, 0.50689f),
    RoutePoint(0.97136f, 0.47752f), RoutePoint(0.97420f, 0.44874f), RoutePoint(0.97709f, 0.41517f),
    RoutePoint(0.97993f, 0.38100f), RoutePoint(0.98282f, 0.34683f), RoutePoint(0.98565f, 0.31505f),
    RoutePoint(0.98854f, 0.28148f), RoutePoint(0.99138f, 0.24671f), RoutePoint(0.99427f, 0.21134f),
    RoutePoint(0.99711f, 0.17537f), RoutePoint(1.00000f, 0.14000f),
)

// Duraciones del ciclo de carga, en segundos y milisegundos, alineadas con iOS.
private const val CYCLE_SECONDS = 5.2f
private const val TRACE_SECONDS = 4.6f
private const val FADE_SECONDS = 0.6f
private const val CYCLE_MILLIS = 5_200

// Alfas del perfil, espejo de las opacidades de LoadingView.swift en iOS.
private const val FILL_BOTTOM_ALPHA = 0.08f
private const val BASELINE_ALPHA = 0.28f
private const val HALO_ALPHA = 0.10f
private const val RIDER_HALO_ALPHA = 0.14f

/**
 * Curva suavizada equivalente a `smoothProfile` en iOS: cuadráticas hasta el
 * punto medio entre muestra y muestra, con la última muestra como control final.
 */
private fun smoothProfile(points: List<Offset>): Path {
    val path = Path()
    val first = points.firstOrNull() ?: return path
    val last = points.lastOrNull() ?: return path
    path.moveTo(first.x, first.y)
    for (index in 1 until points.size) {
        val previous = points[index - 1]
        val current = points[index]
        val midpoint = Offset((previous.x + current.x) / 2f, (previous.y + current.y) / 2f)
        path.quadraticBezierTo(previous.x, previous.y, midpoint.x, midpoint.y)
    }
    path.quadraticBezierTo(last.x, last.y, last.x, last.y)
    return path
}
