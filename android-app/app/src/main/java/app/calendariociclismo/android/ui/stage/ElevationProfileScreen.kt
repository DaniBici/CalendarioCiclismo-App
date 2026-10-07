package app.calendariociclismo.android.ui.stage

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
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
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.ProfileSegment
import kotlin.math.abs
import kotlin.math.roundToInt

// ─── Colores ──────────────────────────────────────────────────────

private val ColorSummit = Color(0xFFC53030)
private val ColorFinish = Color(0xFFE63D3D)
private val ColorBonusSprint = Color(0xFFF9AB00)
private val ColorSprint = Color(0xFF0F9D58)
private val ColorSplit = Color(0xFF00838F)
private val ColorCobblestone = Color(0xFF8C8C8C)
private val ColorSterrato = Color(0xFFC4975A)

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

private fun waypointDisplayName(waypoint: ProfileWaypoint): String {
    val explicit = waypoint.name?.trim().orEmpty()
    if (explicit.isNotEmpty()) return explicit
    return when (waypoint.type) {
        "bonus_sprint" -> LocaleHolder.t("Bonificación", "Bonus sprint")
        "intermediate_sprint" -> LocaleHolder.t("Sprint intermedio", "Intermediate sprint")
        "intermediate_split" -> LocaleHolder.t("Punto intermedio", "Intermediate point")
        "cobblestone" -> LocaleHolder.t("Pavé", "Cobbles")
        "sterrato" -> LocaleHolder.t("Sterrato", "Gravel")
        else -> waypoint.type
    }
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

    val selection = remember(raceDay.id) { ProfileSelection() }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
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
            StageProfileSection(
                raceDay = raceDay,
                race = race,
                officialProfile = null,
                onOfficialProfileTap = {},
                selection = selection,
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
    val type: String,
    val color: Color,
    val letter: String,
    val letterColor: Color,
    val secondaryColor: Color? = null,
    val secondaryLetter: String? = null,
    val secondaryLetterColor: Color = Color.White,
    val secondaryType: String? = null,
)

private data class MarkerBadge(
    val color: Color,
    val letter: String,
    val letterColor: Color,
    val type: String,
)

/** Puerto con pie definido: zona del doble toque, del pie a la cima. */
private data class ClimbZone(val startKm: Double, val endKm: Double, val name: String?)

/** Umbral del arrastre horizontal que mide un tramo (6 px en la web). */
private val SegmentDragThreshold = 6.dp

/**
 * Perfil interactivo. Gestos (espejo de `js/stage/profile.js`):
 * - arrastrar en horizontal mide un tramo; el desplazamiento vertical de la
 *   página sigue funcionando porque el arrastre solo se reconoce cuando el
 *   movimiento es predominantemente horizontal más allá de 6 dp;
 * - un toque sin arrastre fija un punto;
 * - doble toque sobre un puerto (entre su pie y su cima) selecciona el puerto;
 * - con ratón, el puntero recorre el perfil sin fijar el punto.
 *
 * El tramo conserva el color del perfil y el resto se vela con el color de
 * la tarjeta. No se rotula nada sobre el perfil: la lectura vive en la
 * cabecera del panel ([ProfileReadout]).
 */
@Composable
internal fun ElevationChart(
    profile: ElevationProfile,
    summits: List<ProfileSummit>,
    waypoints: List<ProfileWaypoint>,
    race: Race? = null,
    selection: ProfileSelection = remember { ProfileSelection() },
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
    // Velo fuera del tramo: color de la tarjeta al 72 % (`.stage-profile-dim`).
    val veilColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.72f)
    val climbFallback = stringResource(R.string.profile_climb_fallback)
    val doubleTapTimeout = LocalViewConfiguration.current.doubleTapTimeoutMillis

    val markerRadius = with(density) { 8.dp.toPx() }

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

    val climbs: List<ClimbZone> = remember(summits, distance) {
        summits.mapNotNull { s ->
            val summitKm = s.km ?: return@mapNotNull null
            val foot = s.startKm ?: return@mapNotNull null
            if (foot >= summitKm) return@mapNotNull null
            val startKm = maxOf(0.0, foot)
            val endKm = minOf(summitKm, distance)
            if (endKm - startKm < 0.05) null else ClimbZone(startKm, endKm, s.name)
        }
    }

    val mlDp: Dp = 44.dp
    val mrDp: Dp = 8.dp
    val mtDp: Dp = 14.dp
    val mbDp: Dp = 24.dp

    var chartWidth by remember { mutableFloatStateOf(0f) }
    // Último toque, para reconocer el doble toque sin retrasar el sencillo.
    val lastTap = remember { longArrayOf(0L) }
    val lastTapX = remember { floatArrayOf(Float.NaN) }

    fun kmAt(x: Float): Double {
        val ml = with(density) { mlDp.toPx() }
        val pw = chartWidth - ml - with(density) { mrDp.toPx() }
        if (pw <= 0f) return 0.0
        return ((x - ml) / pw * distance).coerceIn(0.0, distance)
    }

    fun calcX(km: Double, ml: Float, pw: Float): Float = ml + (km / distance * pw).toFloat()
    fun calcY(alt: Double, mt: Float, ph: Float): Float =
        (mt + ph - ((alt - yMin) / yRange) * ph).toFloat()

    val accessibilityKm = selection.pointKm ?: 0.0
    val accessibilityState = "${ProfileSegment.formatKm(accessibilityKm)} km · " +
        "${ProfileSegment.formatMeters(ProfileSegment.interpolateAlt(points, accessibilityKm))} m"
    Box(
        modifier = modifier.semantics(mergeDescendants = true) {
            contentDescription = LocaleHolder.t(
                "Consultar distancia y altitud del recorrido",
                "Explore route distance and altitude",
            )
            stateDescription = accessibilityState
            progressBarRangeInfo = ProgressBarRangeInfo(
                current = accessibilityKm.toFloat(),
                range = 0f..distance.toFloat(),
                steps = 0,
            )
            setProgress { target ->
                selection.pin(target.toDouble().coerceIn(0.0, distance))
                true
            }
        },
    ) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged { chartWidth = it.width.toFloat() }
                .pointerInput(distance, climbs, selection) {
                    val slop = SegmentDragThreshold.toPx()
                    val doubleTapSlop = 24.dp.toPx()
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val startX = down.position.x
                        val startY = down.position.y
                        val startKm = kmAt(startX)
                        var dragging = false
                        var released = false
                        var upTime = down.uptimeMillis
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            if (!change.pressed) {
                                released = true
                                upTime = change.uptimeMillis
                                break
                            }
                            if (!dragging) {
                                // El contenedor ya desplaza la página: el gesto es suyo.
                                if (change.isConsumed) break
                                val dx = change.position.x - startX
                                val dy = change.position.y - startY
                                if (abs(dx) > slop && abs(dx) > abs(dy)) {
                                    dragging = true
                                } else if (abs(dy) > slop) {
                                    break
                                }
                            }
                            if (dragging) {
                                change.consume()
                                val km = kmAt(change.position.x)
                                if (km != startKm) selection.measure(startKm, km)
                            }
                        }
                        if (released && !dragging) {
                            val isDouble = upTime - lastTap[0] <= doubleTapTimeout &&
                                !lastTapX[0].isNaN() && abs(lastTapX[0] - startX) <= doubleTapSlop
                            lastTap[0] = if (isDouble) 0L else upTime
                            lastTapX[0] = if (isDouble) Float.NaN else startX
                            val climb = if (isDouble) climbs.firstOrNull { startKm in it.startKm..it.endKm } else null
                            if (climb != null) {
                                selection.pin(startKm)
                                selection.measure(climb.startKm, climb.endKm, climb.name ?: climbFallback)
                            } else {
                                selection.pin(startKm)
                            }
                        }
                    }
                }
                .pointerInput(distance, selection) {
                    // Ratón: el puntero recorre el perfil; al salir queda el
                    // punto fijado o el tramo medido.
                    awaitPointerEventScope {
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull() ?: continue
                            if (change.type != PointerType.Mouse || change.pressed) continue
                            when (event.type) {
                                PointerEventType.Enter, PointerEventType.Move ->
                                    if (selection.range == null) selection.hoverKm = kmAt(change.position.x)
                                PointerEventType.Exit -> selection.hoverKm = null
                                else -> Unit
                            }
                        }
                    }
                },
        ) {
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

            // 3. Relleno plano al 30 % con el color de la carrera, idéntico a
            // iOS. Sin selección no se sombrean las zonas de puerto.
            val fillPath = Path()
            fillPath.moveTo(x(points.first().km), mt + ph)
            points.forEach { pt -> fillPath.lineTo(x(pt.km), y(pt.alt.toDouble())) }
            fillPath.lineTo(x(points.last().km), mt + ph)
            fillPath.close()
            drawPath(path = fillPath, color = profileColor.copy(alpha = 0.30f))

            // 4. Línea del perfil con el color de la carrera.
            val linePath = Path()
            linePath.moveTo(x(points.first().km), y(points.first().alt.toDouble()))
            points.drop(1).forEach { pt -> linePath.lineTo(x(pt.km), y(pt.alt.toDouble())) }
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

            // 6. Etiquetas Y
            drawIntoCanvas { canvas ->
                val paint = Paint().apply {
                    textSize = 12.sp.toPx()
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
                            ProfileSegment.formatMeters(labelAlt.toDouble()),
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
                    textSize = 12.sp.toPx()
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

            // 8. Marcadores de cimas y puntos
            val newMarkers = mutableListOf<MarkerPos>()
            val remainingWaypoints = waypoints.filter { it.type != "town" }.toMutableList()
            var finishAvailable = true
            summits.forEach { s ->
                val sKm = s.km ?: return@forEach
                val alt = ProfileSegment.interpolateAlt(points, sKm)
                val atFinish = finishAvailable && sKm == distance
                val companionIndex = if (atFinish) -1 else remainingWaypoints.indexOfFirst { it.km == sKm }
                val companion = if (companionIndex >= 0) remainingWaypoints.removeAt(companionIndex) else null
                newMarkers += MarkerPos(
                    x = x(sKm),
                    y = y(alt),
                    type = "summit",
                    color = ColorSummit,
                    letter = summitLetter(s.category),
                    letterColor = Color.White,
                    secondaryColor = if (atFinish) ColorFinish else companion?.let { waypointColor(it.type) },
                    secondaryLetter = if (atFinish) "" else companion?.let { waypointLetter(it.type) },
                    secondaryLetterColor = if (companion?.type == "bonus_sprint") Color.Black else Color.White,
                    secondaryType = if (atFinish) "finish" else companion?.type,
                )
                if (atFinish) finishAvailable = false
            }
            remainingWaypoints.forEach { wp ->
                val wpKm = wp.km ?: return@forEach
                val alt = ProfileSegment.interpolateAlt(points, wpKm)
                val atFinish = finishAvailable && wpKm == distance
                newMarkers += MarkerPos(
                    x = x(wpKm),
                    y = y(alt),
                    type = wp.type,
                    color = waypointColor(wp.type),
                    letter = waypointLetter(wp.type),
                    letterColor = if (wp.type == "bonus_sprint") Color.Black else Color.White,
                    secondaryColor = if (atFinish) ColorFinish else null,
                    secondaryLetter = if (atFinish) "" else null,
                    secondaryType = if (atFinish) "finish" else null,
                )
                if (atFinish) finishAvailable = false
            }

            newMarkers.forEach { mp ->
                val badges = buildList {
                    add(MarkerBadge(mp.color, mp.letter, mp.letterColor, mp.type))
                    if (mp.secondaryColor != null && mp.secondaryLetter != null) {
                        add(MarkerBadge(mp.secondaryColor, mp.secondaryLetter, mp.secondaryLetterColor, mp.secondaryType.orEmpty()))
                    }
                }
                val badgeStep = markerRadius * 1.6f
                val centeredStartX = mp.x - badgeStep * (badges.size - 1) / 2f
                val startX = minOf(centeredStartX, size.width - markerRadius - badgeStep * (badges.size - 1))
                badges.forEachIndexed { index, badge ->
                    val badgeX = startX + index * badgeStep
                    drawCircle(
                        color = badge.color,
                        radius = markerRadius,
                        center = Offset(badgeX, mp.y),
                    )
                    if (badge.type == "cobblestone" || badge.type == "sterrato") {
                        drawSurfaceGlyph(badge.type, Offset(badgeX, mp.y), markerRadius * 2)
                    } else if (badge.type == "finish") {
                        val tile = markerRadius * 0.44f
                        val origin = Offset(badgeX - tile, mp.y - tile)
                        drawRect(
                            color = Color.White.copy(alpha = 0.3f),
                            topLeft = origin,
                            size = Size(tile * 2, tile * 2),
                        )
                        drawRect(Color.White, topLeft = origin, size = Size(tile, tile))
                        drawRect(
                            Color.White,
                            topLeft = Offset(origin.x + tile, origin.y + tile),
                            size = Size(tile, tile),
                        )
                    } else {
                        // Glifo del marcador (categoría o letra), no texto de interfaz.
                        drawIntoCanvas { canvas ->
                            val paint = Paint().apply {
                                textSize = if (badge.letter.length > 1) 6.5.sp.toPx() else 8.sp.toPx()
                                color = badge.letterColor.toArgb()
                                textAlign = Paint.Align.CENTER
                                typeface = Typeface.DEFAULT_BOLD
                                isAntiAlias = true
                            }
                            canvas.nativeCanvas.drawText(
                                badge.letter,
                                badgeX,
                                mp.y + paint.textSize / 3,
                                paint,
                            )
                        }
                    }
                }
            }

            // 9. Tramo seleccionado: conserva su color y el resto del perfil
            // queda velado, de arriba al eje. Sin banda ni bordes.
            selection.range?.let { range ->
                val from = minOf(range.a, range.b).coerceIn(0.0, distance)
                val to = maxOf(range.a, range.b).coerceIn(0.0, distance)
                val x1 = x(from)
                val x2 = x(to)
                val bottom = mt + ph + 1.dp.toPx()
                if (x1 > ml) drawRect(veilColor, topLeft = Offset(ml, 0f), size = Size(x1 - ml, bottom))
                if (ml + pw > x2) drawRect(veilColor, topLeft = Offset(x2, 0f), size = Size(ml + pw - x2, bottom))
            }

            // 10. Punto señalado: línea discontinua en acento.
            selection.pointKm?.let { km ->
                val cx = x(km.coerceIn(0.0, distance))
                drawLine(
                    color = accentColor,
                    start = Offset(cx, mt),
                    end = Offset(cx, mt + ph),
                    strokeWidth = 1.5.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())),
                )
            }
        }
    }
}

/**
 * Lectura del perfil en una sola línea de altura fija, dentro de la cabecera
 * del panel: vacía sin selección; «88,2 km · 939 m» con un punto; nombre del
 * puerto o «Tramo», distancia, desnivel positivo y negativo, pendiente media y
 * «Quitar» con un tramo.
 */
@Composable
internal fun ProfileReadout(
    profile: ElevationProfile,
    selection: ProfileSelection,
    modifier: Modifier = Modifier,
    visible: Boolean = true,
    alignEnd: Boolean = true,
) {
    val points = profile.points
    val distance = profile.distance.takeIf { it > 0 } ?: points.lastOrNull()?.km ?: 0.0
    val interpolate: (Double) -> Double = { km -> ProfileSegment.interpolateAlt(points, km) }
    val range = selection.range
    val stats = range?.let {
        ProfileSegment.stats(points, it.a.coerceIn(0.0, distance), it.b.coerceIn(0.0, distance), interpolate)
    }
    val pointKm = selection.pointKm
    val textStyle = CCText.S13.copy(fontFeatureSettings = "tnum")
    Row(
        modifier = modifier.height(ReadoutHeight),
        horizontalArrangement = Arrangement.spacedBy(10.dp, if (alignEnd) Alignment.End else Alignment.Start),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when {
            !visible -> Unit
            range != null && stats != null -> {
                Text(
                    text = range.label ?: LocaleHolder.t("Tramo", "Section"),
                    style = textStyle,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                ReadoutFigure("${ProfileSegment.formatKm(stats.distance)} km", textStyle, bold = true)
                ReadoutFigure("+${ProfileSegment.formatMeters(stats.ascent)} m", textStyle, bold = true)
                ReadoutFigure("−${ProfileSegment.formatMeters(stats.descent)} m", textStyle, bold = false)
                ReadoutFigure("${ProfileSegment.formatGradient(stats.gradient)} %", textStyle, bold = false)
                // La lectura tiene altura fija: el botón no amplía la fila.
                CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
                    PanelTextAction(
                        label = LocaleHolder.t("Quitar", "Clear"),
                        onClick = { selection.range = null; selection.markedRowKm = null },
                        modifier = Modifier.height(ReadoutHeight),
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
                    )
                }
            }
            pointKm != null -> {
                val km = pointKm.coerceIn(0.0, distance)
                ReadoutFigure(
                    "${ProfileSegment.formatKm(km)} km · ${ProfileSegment.formatMeters(interpolate(km))} m",
                    textStyle,
                    bold = true,
                )
            }
            else -> Unit
        }
    }
}

/** Altura fija de la lectura: aparecer o desaparecer no desplaza el perfil. */
internal val ReadoutHeight = 20.dp

@Composable
private fun ReadoutFigure(text: String, style: TextStyle, bold: Boolean) {
    Text(
        text = text,
        style = style,
        fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        softWrap = false,
    )
}

// ─── Summits section ──────────────────────────────────────────────

@Composable
private fun SummitsSection(
    summits: List<ProfileSummit>,
    totalDistance: Double,
    profilePoints: List<ElevationPoint> = emptyList(),
) {
    StagePanel {
        PanelHeader(title = stringResource(R.string.profile_section_summits))
        val sorted = summits.sortedBy { it.km }
        sorted.forEachIndexed { index, summit ->
            if (index > 0) PanelDivider()
            val stats = summit.climbStats(profilePoints)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SummitBadge(category = summit.category)
                Text(
                    text = summit.name ?: stringResource(R.string.profile_climb_fallback),
                    style = CCText.S14,
                    modifier = Modifier.weight(1f),
                )
                Column(horizontalAlignment = Alignment.End) {
                    summit.km?.let { km ->
                        val remaining = totalDistance - km
                        val label = if (remaining < 0.5) stringResource(R.string.profile_summit_finish)
                                    else "${ProfileSegment.formatKm(remaining)} km"
                        Text(
                            text = label,
                            style = CCText.S13.copy(fontFeatureSettings = "tnum"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    val detail = if (stats != null) {
                        "${ProfileSegment.formatKm(stats.lengthKm)} km · ${ProfileSegment.formatGradient(stats.avgGradient)} %"
                    } else summit.altitude?.let { formatAlt(it) }
                    detail?.let {
                        Text(
                            text = it,
                            style = CCText.S12,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SummitBadge(category: String?) {
    val letter = summitLetter(category)
    Surface(
        shape = CircleShape,
        color = ColorSummit,
        modifier = Modifier.size(28.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = letter,
                style = CCText.S12,
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
    StagePanel {
        PanelHeader(title = stringResource(R.string.profile_section_other_points))
        waypoints.sortedBy { it.km }.forEachIndexed { index, wp ->
            if (index > 0) PanelDivider()
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                WaypointBadge(type = wp.type)
                Column(modifier = Modifier.weight(1f)) {
                    val typeLabel = waypointTypeLabel(wp.type)
                    Text(text = wp.name ?: typeLabel, style = CCText.S14)
                    if (wp.name != null) {
                        Text(
                            text = typeLabel,
                            style = CCText.S12,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Column(horizontalAlignment = Alignment.End) {
                    wp.km?.let { km ->
                        Text(
                            text = "${ProfileSegment.formatKm(maxOf(0.0, totalDistance - km))} km",
                            style = CCText.S13.copy(fontFeatureSettings = "tnum"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    wp.lengthKm?.let {
                        Text(
                            text = formatDistance(it),
                            style = CCText.S12,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun WaypointBadge(type: String) {
    if (type == "cobblestone" || type == "sterrato") {
        GuideMarker(type, null, Modifier.size(28.dp))
        return
    }
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
                style = CCText.S12,
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
