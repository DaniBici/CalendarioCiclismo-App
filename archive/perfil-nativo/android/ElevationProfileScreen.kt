package app.calendariociclismo.android.ui.stage

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import app.calendariociclismo.android.data.model.ElevationPoint
import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.ProfileSummit
import app.calendariociclismo.android.data.model.ProfileWaypoint
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.rememberApp
import kotlin.math.abs
import kotlin.math.roundToInt

// ─── Colores ──────────────────────────────────────────────────────

private val ColorSummit = Color(0xFFC53030)
private val ColorBonusSprint = Color(0xFFF9AB00)
private val ColorSprint = Color(0xFF0F9D58)
private val ColorSplit = Color(0xFF00838F)
private val ColorCobblestone = Color(0xFFB0B0B0)
private val ColorSterrato = Color(0xFFC8A870)

private fun waypointColor(type: String): Color = when (type) {
    "bonus_sprint" -> ColorBonusSprint
    "intermediate_sprint" -> ColorSprint
    "intermediate_split" -> ColorSplit
    "cobblestone" -> ColorCobblestone
    "sterrato" -> ColorSterrato
    else -> Color.Gray
}

private fun waypointLetter(type: String): String = when (type) {
    "bonus_sprint" -> "B"
    "intermediate_sprint" -> "S"
    "intermediate_split" -> "P"
    "cobblestone" -> "P"
    "sterrato" -> "S"
    else -> "?"
}

private fun summitLetter(category: String?): String = when (category) {
    "HC" -> "HC"
    "1" -> "1"
    "2" -> "2"
    "3" -> "3"
    "4" -> "4"
    "M" -> "M"
    else -> "C"
}

// ─── Screen ───────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ElevationProfileScreen(rdId: String, navController: NavHostController) {
    val app = rememberApp()
    var raceDay by remember { mutableStateOf<RaceDay?>(null) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(rdId) {
        raceDay = app.database.raceDaysDao().getById(rdId)?.toModel()
        loading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Perfil de etapa") },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Atrás",
                        )
                    }
                },
            )
        },
    ) { padding ->
        when {
            loading -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }

            raceDay?.hasElevationProfile != true -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "Perfil no disponible",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            else -> {
                val rd = raceDay!!
                val profile = rd.elevationProfile!!
                val summits = rd.profileSummits.orEmpty()
                val waypoints = rd.profileWaypoints.orEmpty()

                ElevationProfileContent(
                    profile = profile,
                    summits = summits,
                    waypoints = waypoints,
                    modifier = Modifier.padding(padding),
                )
            }
        }
    }
}

// ─── Content ──────────────────────────────────────────────────────

@Composable
private fun ElevationProfileContent(
    profile: ElevationProfile,
    summits: List<ProfileSummit>,
    waypoints: List<ProfileWaypoint>,
    modifier: Modifier = Modifier,
) {
    val otherWaypoints = waypoints.filter { it.type != "town" }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { StatsRow(profile) }
        item {
            ElevationChart(
                profile = profile,
                summits = summits,
                waypoints = waypoints,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(240.dp),
            )
        }
        if (summits.isNotEmpty()) {
            item { SummitsSection(summits) }
        }
        if (otherWaypoints.isNotEmpty()) {
            item { WaypointsSection(otherWaypoints) }
        }
    }
}

// ─── Stats ────────────────────────────────────────────────────────

@Composable
private fun StatsRow(profile: ElevationProfile) {
    val parts = mutableListOf<String>()
    profile.elevationLoss?.let { loss ->
        parts += "−${formatAlt(loss)}"
    }
    val distStr = formatDistance(profile.distance)
    parts += distStr

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = parts.joinToString("  ·  "),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

private fun formatAlt(meters: Int): String {
    return if (meters >= 1000) {
        val thousands = meters / 1000
        val hundreds = meters % 1000
        "${thousands}.${"%03d".format(hundreds)} m"
    } else {
        "$meters m"
    }
}

private fun formatDistance(km: Double): String {
    return if (km % 1.0 == 0.0) "%.0f km".format(km)
    else "%.1f km".format(km).replace('.', ',')
}

// ─── Chart ────────────────────────────────────────────────────────

private data class MarkerPos(
    val x: Float,
    val y: Float,
    val color: Color,
    val letter: String,
    val isSummit: Boolean,
    val label: String,
    val altitudeM: Int?,
    val km: Double,
)

@Composable
fun ElevationChart(
    profile: ElevationProfile,
    summits: List<ProfileSummit>,
    waypoints: List<ProfileWaypoint>,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val accentColor = MaterialTheme.colorScheme.primary
    val gridColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f)
    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant

    val markerRadius = with(density) { 8.dp.toPx() }

    var markerPositions by remember { mutableStateOf<List<MarkerPos>>(emptyList()) }
    var selectedMarker by remember { mutableStateOf<MarkerPos?>(null) }
    var cursorKm by remember { mutableStateOf<Double?>(null) }
    var chartSize by remember { mutableStateOf(Size.Zero) }

    val points = profile.points
    if (points.size < 2) return

    val distance = profile.distance.takeIf { it > 0 } ?: points.last().km
    val minElevRaw = profile.minElevation ?: points.minOf { it.alt }
    val maxElevRaw = profile.maxElevation ?: points.maxOf { it.alt }

    val yMin = maxOf(0.0, minElevRaw - 150.0)
    val yMax = maxOf(1100.0, maxElevRaw + 200.0)
    val yRange = yMax - yMin

    val yStep = when {
        yRange < 600 -> 100
        yRange > 2500 -> 500
        else -> 200
    }

    val mlDp: Dp = 44.dp
    val mrDp: Dp = 8.dp
    val mtDp: Dp = 14.dp
    val mbDp: Dp = 24.dp

    fun calcX(km: Double, ml: Float, pw: Float): Float = ml + (km / distance * pw).toFloat()
    fun calcY(alt: Double, mt: Float, ph: Float): Float =
        (mt + ph - ((alt - yMin) / yRange) * ph).toFloat()

    Box(modifier = modifier) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures { offset ->
                        val hit = markerPositions.minByOrNull { mp ->
                            val dx = mp.x - offset.x
                            val dy = mp.y - offset.y
                            dx * dx + dy * dy
                        }
                        if (hit != null) {
                            val dx = hit.x - offset.x
                            val dy = hit.y - offset.y
                            val dist2 = dx * dx + dy * dy
                            selectedMarker = if (dist2 <= (markerRadius * 2.5f) * (markerRadius * 2.5f)) {
                                if (selectedMarker == hit) null else hit
                            } else {
                                null
                            }
                        } else {
                            selectedMarker = null
                        }
                    }
                }
                .pointerInput(Unit) {
                    detectHorizontalDragGestures(
                        onDragEnd = { cursorKm = null },
                        onHorizontalDrag = { change, _ ->
                            change.consume()
                            with(density) {
                                val ml = mlDp.toPx()
                                val mr = mrDp.toPx()
                                val pw = chartSize.width - ml - mr
                                if (pw > 0) {
                                    val km = ((change.position.x - ml) / pw * distance)
                                        .coerceIn(0.0, distance)
                                    cursorKm = km
                                }
                            }
                        },
                    )
                },
        ) {
            chartSize = size
            val ml = mlDp.toPx()
            val mr = mrDp.toPx()
            val mt = mtDp.toPx()
            val mb = mbDp.toPx()
            val pw = size.width - ml - mr
            val ph = size.height - mt - mb

            fun x(km: Double) = calcX(km, ml, pw)
            fun y(alt: Double) = calcY(alt, mt, ph)

            // 1. Grid lines Y dashed
            val dashEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 4f))
            var gridAlt = (yMin / yStep).toInt() * yStep
            while (gridAlt <= yMax) {
                val gy = y(gridAlt.toDouble())
                drawLine(
                    color = gridColor,
                    start = Offset(ml, gy),
                    end = Offset(ml + pw, gy),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = dashEffect,
                )
                gridAlt += yStep
            }

            // 2. Grid lines X dashed
            val numXLines = 5
            for (i in 0..numXLines) {
                val gx = ml + i * pw / numXLines
                drawLine(
                    color = gridColor,
                    start = Offset(gx, mt),
                    end = Offset(gx, mt + ph),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = dashEffect,
                )
            }

            // 3. Fill path
            val fillPath = Path()
            fillPath.moveTo(x(points.first().km), mt + ph)
            points.forEach { pt -> fillPath.lineTo(x(pt.km), y(pt.alt.toDouble())) }
            fillPath.lineTo(x(points.last().km), mt + ph)
            fillPath.close()

            drawPath(
                path = fillPath,
                brush = Brush.verticalGradient(
                    colors = listOf(accentColor.copy(alpha = 0.45f), accentColor.copy(alpha = 0.04f)),
                    startY = mt,
                    endY = mt + ph,
                ),
            )

            // 4. Line stroke
            val linePath = Path()
            linePath.moveTo(x(points.first().km), y(points.first().alt.toDouble()))
            points.drop(1).forEach { pt -> linePath.lineTo(x(pt.km), y(pt.alt.toDouble())) }
            drawPath(linePath, color = accentColor, style = Stroke(width = 2.dp.toPx()))

            // 5. Pavé/sterrato segments (lengthKm != null)
            waypoints.filter { it.lengthKm != null && it.lengthKm > 0 }.forEach { wp ->
                val segColor = waypointColor(wp.type)
                val endKm = (wp.km + wp.lengthKm!!).coerceAtMost(distance)
                val segPoints = points.filter { it.km >= wp.km && it.km <= endKm }
                if (segPoints.size >= 2) {
                    val segPath = Path()
                    segPath.moveTo(x(segPoints.first().km), y(segPoints.first().alt.toDouble()))
                    segPoints.drop(1).forEach { pt -> segPath.lineTo(x(pt.km), y(pt.alt.toDouble())) }
                    drawPath(
                        segPath,
                        color = segColor,
                        style = Stroke(width = 3.5.dp.toPx(), cap = StrokeCap.Round),
                    )
                }
            }

            // 6. Etiquetas Y
            drawIntoCanvas { canvas ->
                val paint = Paint().apply {
                    textSize = 9.sp.toPx()
                    color = labelColor.toArgb()
                    textAlign = Paint.Align.RIGHT
                    typeface = Typeface.DEFAULT
                    isAntiAlias = true
                }
                var labelAlt = (yMin / yStep).toInt() * yStep
                while (labelAlt <= yMax) {
                    val gy = y(labelAlt.toDouble())
                    if (gy >= mt - 2 && gy <= mt + ph + 2) {
                        canvas.nativeCanvas.drawText(
                            "$labelAlt",
                            ml - 4f,
                            gy + paint.textSize / 3,
                            paint,
                        )
                    }
                    labelAlt += yStep
                }
            }

            // 7. Etiquetas X
            drawIntoCanvas { canvas ->
                val paint = Paint().apply {
                    textSize = 9.sp.toPx()
                    color = labelColor.toArgb()
                    textAlign = Paint.Align.CENTER
                    isAntiAlias = true
                }
                for (i in 0..numXLines) {
                    val kmVal = i * distance / numXLines
                    val gx = ml + i * pw / numXLines
                    canvas.nativeCanvas.drawText(
                        "${kmVal.roundToInt()}",
                        gx,
                        mt + ph + mb - 2f,
                        paint,
                    )
                }
            }

            // Calcular posiciones de marcadores
            val newMarkers = mutableListOf<MarkerPos>()
            summits.forEach { s ->
                val alt = interpolateAlt(points, s.km)
                newMarkers += MarkerPos(
                    x = x(s.km),
                    y = y(alt),
                    color = ColorSummit,
                    letter = summitLetter(s.category),
                    isSummit = true,
                    label = s.name ?: "Puerto",
                    altitudeM = s.altitude ?: alt.roundToInt(),
                    km = s.km,
                )
            }
            waypoints.filter { it.type != "town" }.forEach { wp ->
                val alt = interpolateAlt(points, wp.km)
                newMarkers += MarkerPos(
                    x = x(wp.km),
                    y = y(alt),
                    color = waypointColor(wp.type),
                    letter = waypointLetter(wp.type),
                    isSummit = false,
                    label = wp.name ?: wp.type,
                    altitudeM = alt.roundToInt(),
                    km = wp.km,
                )
            }
            markerPositions = newMarkers

            // 8. Dibujar marcadores
            newMarkers.forEach { mp ->
                drawCircle(
                    color = mp.color,
                    radius = markerRadius,
                    center = Offset(mp.x, mp.y),
                )
                drawIntoCanvas { canvas ->
                    val paint = Paint().apply {
                        textSize = if (mp.letter.length > 1) 6.5.sp.toPx() else 8.sp.toPx()
                        color = Color.White.toArgb()
                        textAlign = Paint.Align.CENTER
                        typeface = Typeface.DEFAULT_BOLD
                        isAntiAlias = true
                    }
                    canvas.nativeCanvas.drawText(
                        mp.letter,
                        mp.x,
                        mp.y + paint.textSize / 3,
                        paint,
                    )
                }
            }

            // 9. Cursor vertical
            cursorKm?.let { km ->
                val cx = x(km)
                val cursorAlt = interpolateAlt(points, km)
                drawLine(
                    color = Color.Gray.copy(alpha = 0.6f),
                    start = Offset(cx, mt),
                    end = Offset(cx, mt + ph),
                    strokeWidth = 1.5.dp.toPx(),
                )
                drawCircle(
                    color = accentColor,
                    radius = 4.dp.toPx(),
                    center = Offset(cx, y(cursorAlt)),
                )
            }
        }

        // Callout flotante
        selectedMarker?.let { mp ->
            val density2 = LocalDensity.current
            val xPx = mp.x
            val yPx = mp.y
            val calloutW = 160.dp
            val calloutH = 68.dp
            val calloutWPx = with(density2) { calloutW.toPx() }
            val calloutHPx = with(density2) { calloutH.toPx() }

            var offsetX = xPx - calloutWPx / 2
            var offsetY = yPx - calloutHPx - with(density2) { 12.dp.toPx() }

            if (offsetX < 0) offsetX = 0f
            if (offsetX + calloutWPx > chartSize.width) offsetX = chartSize.width - calloutWPx
            if (offsetY < 0) offsetY = yPx + with(density2) { 12.dp.toPx() }

            Surface(
                modifier = Modifier
                    .wrapContentSize()
                    .offset { IntOffset(offsetX.roundToInt(), offsetY.roundToInt()) },
                shape = RoundedCornerShape(10.dp),
                shadowElevation = 4.dp,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 2.dp,
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = mp.color,
                            modifier = Modifier.size(10.dp),
                        ) {}
                        Text(
                            text = mp.letter,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = mp.color,
                        )
                    }
                    Text(
                        text = mp.label,
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                        maxLines = 2,
                    )
                    Text(
                        text = buildString {
                            mp.altitudeM?.let { append(formatAlt(it)) }
                            append("  ·  km ${mp.km.roundToInt()}")
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        // Burbuja de altitud del cursor
        val currentCursorKm = cursorKm
        if (currentCursorKm != null) {
            val ml = with(density) { mlDp.toPx() }
            val mr = with(density) { mrDp.toPx() }
            val mt = with(density) { mtDp.toPx() }
            val pw = chartSize.width - ml - mr
            val ph = chartSize.height - mt - with(density) { mbDp.toPx() }
            if (pw > 0 && ph > 0) {
                val alt = interpolateAlt(profile.points, currentCursorKm)
                val cx = ml + (currentCursorKm / distance * pw).toFloat()
                val cy = mt + ph - ((alt - yMin) / yRange * ph).toFloat()
                val bubbleW = with(density) { 56.dp.toPx() }
                val bubbleH = with(density) { 22.dp.toPx() }
                var bx = cx - bubbleW / 2
                val by = (cy - bubbleH - with(density) { 6.dp.toPx() }).coerceAtLeast(0f)
                if (bx < 0) bx = 0f
                if (bx + bubbleW > chartSize.width) bx = chartSize.width - bubbleW

                Surface(
                    modifier = Modifier
                        .offset { IntOffset(bx.roundToInt(), by.roundToInt()) }
                        .wrapContentSize(),
                    shape = RoundedCornerShape(4.dp),
                    color = MaterialTheme.colorScheme.inverseSurface,
                    shadowElevation = 2.dp,
                ) {
                    Text(
                        text = "${alt.roundToInt()} m",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.inverseOnSurface,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
        }
    }
}

private fun interpolateAlt(points: List<ElevationPoint>, km: Double): Double {
    if (points.isEmpty()) return 0.0
    if (km <= points.first().km) return points.first().alt.toDouble()
    if (km >= points.last().km) return points.last().alt.toDouble()
    val idx = points.indexOfLast { it.km <= km }
    if (idx < 0 || idx >= points.size - 1) return points.last().alt.toDouble()
    val p0 = points[idx]
    val p1 = points[idx + 1]
    val t = if (abs(p1.km - p0.km) < 0.0001) 0.0 else (km - p0.km) / (p1.km - p0.km)
    return p0.alt + t * (p1.alt - p0.alt)
}

// ─── Summits section ──────────────────────────────────────────────

@Composable
private fun SummitsSection(summits: List<ProfileSummit>) {
    Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
        Text(
            text = "Puertos",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        HorizontalDivider()
        summits.sortedBy { it.km }.forEach { summit ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SummitBadge(category = summit.category)
                Column {
                    Text(
                        text = summit.name ?: "Puerto",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = buildString {
                            summit.altitude?.let { append(formatAlt(it)) }
                            append("  ·  km ${summit.km.roundToInt()}")
                            summit.side?.let { side ->
                                val sideLabel = if (side == "descente") "descenso" else side
                                append("  ·  $sideLabel")
                            }
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun SummitBadge(category: String?) {
    val letter = summitLetter(category)
    val fontSize = if (letter.length > 1) 8.sp else 10.sp
    Surface(
        shape = CircleShape,
        color = ColorSummit,
        modifier = Modifier.size(28.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = letter,
                fontSize = fontSize,
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

// ─── Waypoints section ────────────────────────────────────────────

private val waypointTypeLabel = mapOf(
    "intermediate_sprint" to "Sprint intermedio",
    "bonus_sprint" to "Bonificación",
    "intermediate_split" to "Punto intermedio",
    "cobblestone" to "Pavé",
    "sterrato" to "Sterrato",
)

@Composable
private fun WaypointsSection(waypoints: List<ProfileWaypoint>) {
    Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
        Text(
            text = "Otros puntos",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        HorizontalDivider()
        waypoints.sortedBy { it.km }.forEach { wp ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                WaypointBadge(type = wp.type)
                Column {
                    Text(
                        text = wp.name ?: waypointTypeLabel[wp.type] ?: wp.type,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = buildString {
                            append("km ${wp.km.roundToInt()}")
                            wp.lengthKm?.let { append("  ·  ${formatDistance(it)}") }
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun WaypointBadge(type: String) {
    val color = waypointColor(type)
    val letter = waypointLetter(type)
    Surface(
        shape = CircleShape,
        color = color,
        modifier = Modifier.size(28.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = letter,
                fontSize = 10.sp,
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
