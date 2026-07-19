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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.ElevationPoint
import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.ProfileSummit
import app.calendariociclismo.android.data.model.ProfileWaypoint
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.colorFromHex
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

@Composable
fun ElevationProfileScreen(rdId: String, navController: NavHostController) {
    val app = rememberApp()
    var raceDay by remember { mutableStateOf<RaceDay?>(null) }
    var race by remember { mutableStateOf<Race?>(null) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(rdId) {
        val rd = app.database.raceDaysDao().getById(rdId)?.toModel()
        raceDay = rd
        race = rd?.raceId?.let { app.database.racesDao().getById(it)?.toModel() }
        loading = false
    }

    // Analytics: paridad con stage_detail (race_day_id + stage_name + race_name)
    // para sumar en "etapas más vistas". `race` se resuelve en el mismo
    // LaunchedEffect que raceDay → reaccionar a ambos para no perder race_name.
    LaunchedEffect(raceDay, race) {
        val rd = raceDay ?: return@LaunchedEffect
        app.analytics.logScreenView(
            "elevation_profile",
            android.os.Bundle().apply {
                putString("race_day_id", rdId)
                putString("stage_name", rd.stageLabel)
                race?.let { putString("race_name", it.name) }
            },
        )
    }

    // Sin TopAppBar: la flecha de retroceso va integrada en la cabecera de
    // datos generales (StageInfoHeaderCard), igual que en la jornada, y vuelve
    // a la pantalla anterior (la jornada).
    Scaffold { padding ->
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
                    text = stringResource(R.string.profile_unavailable),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            else -> {
                val rd = raceDay!!
                val profile = rd.elevationProfile!!
                val summits = rd.profileSummits.orEmpty()
                val waypoints = rd.profileWaypoints.orEmpty()

                ElevationProfileContent(
                    raceDay = rd,
                    race = race,
                    profile = profile,
                    summits = summits,
                    waypoints = waypoints,
                    onBack = { navController.popBackStack() },
                    // Solo carreras por etapas enlazan a competición ("ver todas
                    // las etapas"); una de un día no tiene lista de etapas, así que
                    // su cabecera no es tappable (paridad con iOS y la jornada).
                    onRaceTap = race?.takeIf { it.isStageRace }?.id
                        ?.let { id -> { navController.navigate(Routes.race(id)) } },
                    modifier = Modifier.padding(padding),
                )
            }
        }
    }
}

// ─── Content ──────────────────────────────────────────────────────

@Composable
private fun ElevationProfileContent(
    raceDay: RaceDay,
    race: Race?,
    profile: ElevationProfile,
    summits: List<ProfileSummit>,
    waypoints: List<ProfileWaypoint>,
    onBack: () -> Unit,
    onRaceTap: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val otherWaypoints = waypoints.filter { it.type != "town" }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Datos generales de la etapa por encima del perfil: el mismo bloque
        // que en la jornada aparece encima de la documentación. La flecha
        // integrada vuelve a la jornada.
        item {
            StageInfoHeaderCard(
                raceDay = raceDay,
                race = race,
                onBack = onBack,
                onRaceTap = onRaceTap,
            )
        }
        item {
            ElevationChart(
                profile = profile,
                summits = summits,
                waypoints = waypoints,
                race = race,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(240.dp),
            )
        }
        if (summits.isNotEmpty()) {
            item { SummitsSection(summits, profile.distance, profile.points) }
        }
        if (otherWaypoints.isNotEmpty()) {
            item { WaypointsSection(otherWaypoints, profile.distance) }
        }
    }
}

// ─── Formato ──────────────────────────────────────────────────────

private fun formatAlt(meters: Int): String {
    return if (meters >= 1000) {
        val thousands = meters / 1000
        val hundreds = meters % 1000
        // Separador de miles según el idioma de contenido (EN→coma, ES→punto),
        // no el locale del dispositivo — igual que el desnivel y el kilometraje.
        val sep = if (LocaleHolder.shouldShowEnglishContent) ',' else '.'
        "${thousands}${sep}${"%03d".format(hundreds)} m"
    } else {
        "$meters m"
    }
}

private fun formatDistance(km: Double): String {
    if (km % 1.0 == 0.0) return "%.0f km".format(km)
    // Separador decimal según el idioma de contenido (EN→punto, ES→coma), no el
    // locale del dispositivo.
    val raw = String.format(java.util.Locale.US, "%.1f", km)
    val str = if (LocaleHolder.shouldShowEnglishContent) raw else raw.replace('.', ',')
    return "$str km"
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
    race: Race? = null,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val accentColor = MaterialTheme.colorScheme.primary
    // El relleno y la línea del perfil usan el color de la carrera (mismo
    // criterio que iOS: ElevationProfileView.profileColor). Si no hay
    // colorHex, cae al primary del tema, igual que iOS cae a .accentColor.
    val profileColor = colorFromHex(race?.colorHex, fallback = accentColor)
    val gridColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f)
    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant

    val markerRadius = with(density) { 8.dp.toPx() }

    data class SegmentMeasure(
        val startKm: Double,
        val endKm: Double,
        val distanceKm: Double,
        val elevationMeters: Int,
        val percentageGrade: Double,
    )

    data class ClimbInfo(
        val id: String,
        val startKm: Double,
        val endKm: Double,
        val name: String?,
        val category: String?,
        val lengthKm: Double,
        val avgGradient: Double,
        val gain: Int,
    )

    var markerPositions by remember { mutableStateOf<List<MarkerPos>>(emptyList()) }
    var selectedMarker by remember { mutableStateOf<MarkerPos?>(null) }
    var selectedClimb by remember { mutableStateOf<ClimbInfo?>(null) }
    var cursorKm by remember { mutableStateOf<Double?>(null) }
    var dragStartKm by remember { mutableStateOf<Double?>(null) }
    var dragEndKm by remember { mutableStateOf<Double?>(null) }
    var frozenSegment by remember { mutableStateOf<SegmentMeasure?>(null) }
    var chartSize by remember { mutableStateOf(Size.Zero) }

    val climbs: List<ClimbInfo> = remember(summits, profile.points) {
        summits.mapNotNull { s ->
            val summitKm = s.km ?: return@mapNotNull null
            val stats = s.climbStats(profile.points) ?: return@mapNotNull null
            ClimbInfo(
                id = "climb-${summitKm}-${s.name.orEmpty()}",
                startKm = s.startKm ?: return@mapNotNull null,
                endKm = minOf(summitKm, profile.distance),
                name = s.name,
                category = s.category,
                lengthKm = stats.lengthKm,
                avgGradient = stats.avgGradient,
                gain = stats.gainMeters,
            )
        }
    }

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

    fun interpolateAltitude(targetKm: Double): Double {
        if (points.isEmpty()) return 0.0
        if (targetKm <= points.first().km) return points.first().alt.toDouble()
        if (targetKm >= points.last().km) return points.last().alt.toDouble()
        for (i in 0 until points.size - 1) {
            val p1 = points[i]
            val p2 = points[i + 1]
            if (targetKm >= p1.km && targetKm <= p2.km) {
                val t = (targetKm - p1.km) / (p2.km - p1.km)
                return p1.alt + t * (p2.alt - p1.alt)
            }
        }
        return points.last().alt.toDouble()
    }

    Box(modifier = modifier) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(climbs) {
                    detectTapGestures { offset ->
                        val hit = markerPositions.minByOrNull { mp ->
                            val dx = mp.x - offset.x
                            val dy = mp.y - offset.y
                            dx * dx + dy * dy
                        }
                        val markerHit: MarkerPos? = if (hit != null) {
                            val dx = hit.x - offset.x
                            val dy = hit.y - offset.y
                            val dist2 = dx * dx + dy * dy
                            if (dist2 <= (markerRadius * 2.5f) * (markerRadius * 2.5f)) hit else null
                        } else null

                        if (markerHit != null) {
                            selectedMarker = if (selectedMarker == markerHit) null else markerHit
                            selectedClimb = null
                        } else {
                            // Tap dentro de zona sombreada de un puerto
                            val ml = mlDp.toPx()
                            val pw = chartSize.width - ml - mrDp.toPx()
                            val mt = mtDp.toPx()
                            val ph = chartSize.height - mt - mbDp.toPx()
                            val withinPlot = offset.y in mt..(mt + ph)
                            val tapKm = if (pw > 0) ((offset.x - ml) / pw * distance).coerceIn(0.0, distance) else null
                            val climbHit = if (withinPlot && tapKm != null) {
                                climbs.firstOrNull { tapKm in it.startKm..it.endKm }
                            } else null
                            if (climbHit != null) {
                                selectedClimb = if (selectedClimb?.id == climbHit.id) null else climbHit
                                selectedMarker = null
                            } else {
                                selectedMarker = null
                                selectedClimb = null
                                frozenSegment = null
                            }
                        }
                    }
                }
                .pointerInput(Unit) {
                    detectHorizontalDragGestures(
                        onDragStart = { offset ->
                            with(density) {
                                val ml = mlDp.toPx()
                                val pw = chartSize.width - ml - mlDp.toPx()
                                if (pw > 0) {
                                    val km = ((offset.x - ml) / pw * distance).coerceIn(0.0, distance)
                                    dragStartKm = km
                                    frozenSegment = null
                                }
                            }
                        },
                        onHorizontalDrag = { change, _ ->
                            change.consume()
                            with(density) {
                                val ml = mlDp.toPx()
                                val pw = chartSize.width - ml - mlDp.toPx()
                                if (pw > 0 && dragStartKm != null) {
                                    val km = ((change.position.x - ml) / pw * distance).coerceIn(0.0, distance)
                                    dragEndKm = km
                                }
                            }
                        },
                        onDragEnd = {
                            if (dragStartKm != null && dragEndKm != null) {
                                val dragDistance = abs(dragEndKm!! - dragStartKm!!)
                                if (dragDistance >= 0.1) {
                                    val alt1 = interpolateAltitude(dragStartKm!!)
                                    val alt2 = interpolateAltitude(dragEndKm!!)
                                    val elevation = abs(alt2 - alt1)
                                    val grade = if (dragDistance > 0) (elevation / (dragDistance * 1000)) * 100 else 0.0
                                    frozenSegment = SegmentMeasure(
                                        startKm = minOf(dragStartKm!!, dragEndKm!!),
                                        endKm = maxOf(dragStartKm!!, dragEndKm!!),
                                        distanceKm = dragDistance,
                                        elevationMeters = elevation.toInt(),
                                        percentageGrade = grade,
                                    )
                                }
                            }
                            dragStartKm = null
                            dragEndKm = null
                            cursorKm = null
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

            // Relleno plano al 30 % con el color de la carrera, idéntico a
            // iOS (ctx.fill(fillPath, with: .color(profileColor.opacity(0.30)))).
            drawPath(
                path = fillPath,
                color = profileColor.copy(alpha = 0.30f),
            )

            // 3b. Climb zones — área bajo la curva entre startKm y km del summit
            climbs.forEach { climb ->
                val startAlt = interpolateAlt(points, climb.startKm)
                val endAlt   = interpolateAlt(points, climb.endKm)
                val seg = mutableListOf<ElevationPoint>()
                seg += ElevationPoint(climb.startKm, startAlt.roundToInt())
                points.filter { it.km > climb.startKm && it.km < climb.endKm }
                    .forEach { seg += it }
                seg += ElevationPoint(climb.endKm, endAlt.roundToInt())
                if (seg.size >= 2) {
                    val zone = Path()
                    zone.moveTo(x(seg.first().km), mt + ph)
                    seg.forEach { zone.lineTo(x(it.km), y(it.alt.toDouble())) }
                    zone.lineTo(x(seg.last().km), mt + ph)
                    zone.close()
                    drawPath(zone, color = ColorSummit.copy(alpha = 0.22f))
                }
            }

            // 4. Line stroke
            val linePath = Path()
            linePath.moveTo(x(points.first().km), y(points.first().alt.toDouble()))
            points.drop(1).forEach { pt -> linePath.lineTo(x(pt.km), y(pt.alt.toDouble())) }
            // Línea del perfil con el color de la carrera, stroke 1.5dp para
            // igualar a iOS.
            drawPath(linePath, color = profileColor, style = Stroke(width = 1.5.dp.toPx()))

            // 5. Pavé/sterrato segments (lengthKm != null)
            waypoints.filter { it.km != null && it.lengthKm != null && it.lengthKm > 0 }.forEach { wp ->
                val wpKm = wp.km ?: return@forEach
                val segColor = waypointColor(wp.type)
                val endKm = (wpKm + wp.lengthKm!!).coerceAtMost(distance)
                val segPoints = points.filter { it.km >= wpKm && it.km <= endKm }
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

            // 6. Segmento de arrastre (activo o congelado)
            val segStartKm: Double?
            val segEndKm: Double?
            when {
                dragStartKm != null && dragEndKm != null -> {
                    segStartKm = minOf(dragStartKm!!, dragEndKm!!)
                    segEndKm = maxOf(dragStartKm!!, dragEndKm!!)
                }
                frozenSegment != null -> {
                    segStartKm = frozenSegment!!.startKm
                    segEndKm = frozenSegment!!.endKm
                }
                else -> { segStartKm = null; segEndKm = null }
            }
            if (segStartKm != null && segEndKm != null) {
                val x1 = x(segStartKm)
                val x2 = x(segEndKm)
                drawRect(
                    color = accentColor.copy(alpha = 0.12f),
                    topLeft = Offset(x1, mt),
                    size = Size(x2 - x1, ph),
                )
                drawLine(
                    color = accentColor.copy(alpha = 0.65f),
                    start = Offset(x1, mt),
                    end = Offset(x1, mt + ph),
                    strokeWidth = 1.5.dp.toPx(),
                )
                drawLine(
                    color = accentColor.copy(alpha = 0.65f),
                    start = Offset(x2, mt),
                    end = Offset(x2, mt + ph),
                    strokeWidth = 1.5.dp.toPx(),
                )
            }

            // 7. Etiquetas Y
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
                val sKm = s.km ?: return@forEach
                val alt = interpolateAlt(points, sKm)
                newMarkers += MarkerPos(
                    x = x(sKm),
                    y = y(alt),
                    color = ColorSummit,
                    letter = summitLetter(s.category),
                    isSummit = true,
                    label = s.name ?: "Puerto",
                    altitudeM = s.altitude ?: alt.roundToInt(),
                    km = sKm,
                )
            }
            waypoints.filter { it.type != "town" }.forEach { wp ->
                val wpKm = wp.km ?: return@forEach
                val alt = interpolateAlt(points, wpKm)
                newMarkers += MarkerPos(
                    x = x(wpKm),
                    y = y(alt),
                    color = waypointColor(wp.type),
                    letter = waypointLetter(wp.type),
                    isSummit = false,
                    label = wp.name ?: wp.type,
                    altitudeM = alt.roundToInt(),
                    km = wpKm,
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

        // Tooltip de puerto (zona sombreada)
        selectedClimb?.let { climb ->
            val title = climb.name?.takeIf { it.isNotEmpty() } ?: stringResource(R.string.profile_climb_fallback)
            val gradeStr = String.format("%.1f%%", climb.avgGradient)
            Surface(
                modifier = Modifier
                    .padding(12.dp)
                    .align(Alignment.TopStart),
                shape = RoundedCornerShape(10.dp),
                shadowElevation = 4.dp,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 2.dp,
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text = String.format("%.1f km", climb.lengthKm),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(text = "·", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            text = gradeStr,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    Text(
                        text = stringResource(R.string.profile_tooltip_gain, climb.gain),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
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

        // Tooltip del tramo medido (congelado)
        frozenSegment?.let { segment ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                contentAlignment = Alignment.TopStart,
            ) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    shadowElevation = 4.dp,
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 2.dp,
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = "${formatDistance(segment.distanceKm)} / +${segment.elevationMeters} m / ${String.format("%.1f%%", segment.percentageGrade)}",
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
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
private fun SummitsSection(
    summits: List<ProfileSummit>,
    totalDistance: Double,
    profilePoints: List<ElevationPoint> = emptyList(),
) {
    Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
        Text(
            text = stringResource(R.string.profile_section_summits),
            style = MaterialTheme.typography.titleSmall,
            // Peso igualado al titular del cintillo (Medium, no SemiBold).
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        HorizontalDivider()
        summits.sortedBy { it.km }.forEach { summit ->
            val stats = summit.climbStats(profilePoints)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SummitBadge(category = summit.category)
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = summit.name ?: stringResource(R.string.profile_climb_fallback),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    summit.km?.let { km ->
                        val remaining = totalDistance - km
                        val label = if (remaining < 0.5f) stringResource(R.string.profile_summit_finish)
                                    else "-${remaining.roundToInt()} km"
                        Text(
                            text = label,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                    if (stats != null) {
                        Text(
                            text = String.format("%.1f km · %.1f%%", stats.lengthKm, stats.avgGradient),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        summit.altitude?.let {
                            Text(
                                text = formatAlt(it),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
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

private val waypointTypeLabelRes = mapOf(
    "intermediate_sprint" to R.string.profile_waypoint_intermediate_sprint,
    "bonus_sprint" to R.string.profile_waypoint_bonus_sprint,
    "intermediate_split" to R.string.profile_waypoint_intermediate_split,
    "cobblestone" to R.string.profile_waypoint_cobblestone,
    "sterrato" to R.string.profile_waypoint_sterrato,
)

@Composable
private fun waypointTypeLabel(type: String): String {
    val res = waypointTypeLabelRes[type] ?: return type
    return stringResource(res)
}

@Composable
private fun WaypointsSection(waypoints: List<ProfileWaypoint>, totalDistance: Double) {
    Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
        Text(
            text = stringResource(R.string.profile_section_other_points),
            style = MaterialTheme.typography.titleSmall,
            // Peso igualado al titular del cintillo (Medium, no SemiBold).
            fontWeight = FontWeight.Medium,
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
                Column(modifier = Modifier.weight(1f)) {
                    val typeLabel = waypointTypeLabel(wp.type)
                    Text(
                        text = wp.name ?: typeLabel,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    if (wp.name != null) {
                        Text(
                            text = typeLabel,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Column(horizontalAlignment = Alignment.End) {
                    wp.km?.let { km ->
                        Text(
                            text = "-${(totalDistance - km).roundToInt()} km",
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                    wp.lengthKm?.let {
                        Text(
                            text = formatDistance(it),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
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
