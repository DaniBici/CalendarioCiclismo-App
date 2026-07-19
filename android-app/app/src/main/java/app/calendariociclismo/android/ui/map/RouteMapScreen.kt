package app.calendariociclismo.android.ui.map

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.material3.rememberStandardBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.ElevationPoint
import app.calendariociclismo.android.data.model.ProfileSummit
import app.calendariociclismo.android.data.model.ProfileWaypoint
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.prefs.ThemePreference
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.stage.StageInfoBlock
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.util.LatLng
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RouteMapLogic
import app.calendariociclismo.android.util.RoutePoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL
import kotlin.math.roundToInt

// ─── Colores (espejo del perfil y del pin de iOS) ─────────────────

private val ColorSummit = Color(0xFFC53030)
private val ColorBonusSprint = Color(0xFFF9AB00)
private val ColorSprint = Color(0xFF0F9D58)
private val ColorSplit = Color(0xFF00838F)
private val ColorCobblestone = Color(0xFFB0B0B0)
private val ColorSterrato = Color(0xFFC8A870)
private val ColorStart = Color(0xFF0F9D58)
private val ColorFinish = Color(0xFFC53030)

private fun waypointColor(type: String): Color = when (type) {
    "bonus_sprint" -> ColorBonusSprint
    "intermediate_sprint" -> ColorSprint
    "intermediate_split" -> ColorSplit
    "cobblestone" -> ColorCobblestone
    "sterrato" -> ColorSterrato
    else -> Color.Gray
}

private fun summitGlyph(category: String?): String = when (category) {
    "HC", "1", "2", "3", "4" -> category!!
    else -> "•"
}

/** Glyph del pin del waypoint en el MAPA. A diferencia del perfil, pavé/sterrato
 *  NO usan letra (confunde: "P"/"S" chocan con sprint); usan un punto. */
private fun waypointMapGlyph(type: String): String = when (type) {
    "bonus_sprint" -> "B"
    "intermediate_sprint" -> "S"
    "intermediate_split" -> "◷"
    "cobblestone", "sterrato" -> "•"
    else -> "•"
}

private enum class LoadState { LOADING, READY, ERROR }

// ─── Screen ───────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RouteMapScreen(rdId: String, navController: NavHostController) {
    val app = rememberApp()
    val context = LocalContext.current
    // El tema del mapa debe seguir la PREFERENCIA de la app (Sistema/Claro/Oscuro),
    // no solo el ajuste del sistema — igual que MainActivity resuelve el tema global.
    // Con isSystemInDarkTheme() suelto, elegir "Oscuro" en la app con el sistema en
    // claro dejaba el mapa con el estilo claro mientras el resto de la app iba oscura.
    val themePref by app.preferences.themePreference.collectAsState(initial = ThemePreference.SYSTEM)
    val systemDark = isSystemInDarkTheme()
    val darkTheme = when (themePref) {
        ThemePreference.SYSTEM -> systemDark
        ThemePreference.LIGHT -> false
        ThemePreference.DARK -> true
    }

    var raceDay by remember { mutableStateOf<RaceDay?>(null) }
    var race by remember { mutableStateOf<Race?>(null) }
    var points by remember { mutableStateOf<List<RoutePoint>>(emptyList()) }
    var markers by remember { mutableStateOf<List<MapMarker>>(emptyList()) }
    var state by remember { mutableStateOf(LoadState.LOADING) }
    var reloadToken by remember { mutableStateOf(0) }
    // Popup del marcador tocado (espejo del bindPopup web / callout iOS).
    var tappedMarker by remember { mutableStateOf<TappedMarker?>(null) }

    LaunchedEffect(rdId, reloadToken) {
        state = LoadState.LOADING
        val rd = app.database.raceDaysDao().getById(rdId)?.toModel()
        raceDay = rd
        race = rd?.raceId?.let { app.database.racesDao().getById(it)?.toModel() }

        val url = rd?.routeGpxUrl
        if (rd == null || url.isNullOrEmpty()) { state = LoadState.ERROR; return@LaunchedEffect }

        val parsed = withContext(Dispatchers.IO) {
            runCatching { RouteMapLogic.parseGpx(URL(url).readText()) }.getOrDefault(emptyList())
        }
        if (parsed.size < 2) { state = LoadState.ERROR; return@LaunchedEffect }

        points = parsed
        markers = buildMarkers(context, rd, parsed)
        state = LoadState.READY
    }

    LaunchedEffect(raceDay, race) {
        val rd = raceDay ?: return@LaunchedEffect
        app.analytics.logScreenView(
            "route_map",
            android.os.Bundle().apply {
                putString("race_day_id", rdId)
                putString("stage_name", rd.stageLabel)
                race?.let { putString("race_name", it.name) }
            },
        )
    }

    when (state) {
        LoadState.LOADING -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        LoadState.ERROR -> RouteMapError(onRetry = { reloadToken++ })
        LoadState.READY -> {
            val rd = raceDay!!
            val routeColor = (race?.colorHex?.let { colorFromHex(it) } ?: Color(0xFFD8442E))
            val sheetState = rememberBottomSheetScaffoldState(
                bottomSheetState = rememberStandardBottomSheetState(initialValue = SheetValue.PartiallyExpanded),
            )
            BottomSheetScaffold(
                scaffoldState = sheetState,
                sheetPeekHeight = 150.dp,
                sheetContent = { KeyPointsSheet(rd) },
            ) { _ ->
                Box(Modifier.fillMaxSize()) {
                    MapLibreView(
                        points = points,
                        markers = markers,
                        routeColor = routeColor.toArgb(),
                        darkTheme = darkTheme,
                        modifier = Modifier.fillMaxSize(),
                        onMarkerTap = { tappedMarker = it },
                    )
                    // Header de etapa flotante. Mismo padding (14dp) y mismo
                    // espaciado vertical (spacedBy 8dp) que StageInfoHeaderCard
                    // del perfil, para que el bloque respire igual (sin esto las
                    // líneas quedaban comprimidas respecto al perfil).
                    Surface(
                        shape = MaterialTheme.shapes.large,
                        tonalElevation = 3.dp,
                        shadowElevation = 6.dp,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .fillMaxWidth()
                            .padding(12.dp),
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            StageInfoBlock(
                                raceDay = rd,
                                race = race,
                                onBack = { navController.popBackStack() },
                            )
                        }
                    }
                    // Popup del marcador tocado (nombre + km + cat/altitud),
                    // espejo del bindPopup de Leaflet: anclado SOBRE el pin (en su
                    // posición de pantalla). Tap sobre él lo cierra.
                    tappedMarker?.let { tm ->
                        MarkerPopup(
                            marker = tm,
                            onDismiss = { tappedMarker = null },
                            modifier = Modifier.align(Alignment.TopStart),
                        )
                    }
                }
            }
        }
    }
}

// ─── Proyección de marcadores ─────────────────────────────────────

private fun buildMarkers(ctx: android.content.Context, rd: RaceDay, pts: List<RoutePoint>): List<MapMarker> {
    val result = ArrayList<MapMarker>()
    val total = rd.distanceKm ?: 0.0
    val summits = (rd.profileSummits ?: emptyList()).filter { it.km != null }
    val isTt = rd.primaryType == "itt" || rd.primaryType == "ttt"
    val sprints = (rd.profileWaypoints ?: emptyList()).filter {
        it.km != null && if (isTt) it.type == "intermediate_split"
        else it.type == "intermediate_sprint" || it.type == "bonus_sprint"
    }
    val sectors = (rd.profileWaypoints ?: emptyList()).filter {
        it.km != null && (it.type == "cobblestone" || it.type == "sterrato")
    }

    val kmUnit = if (LocaleHolder.shouldShowEnglishContent) "km" else " km"

    pts.firstOrNull()?.let {
        result.add(MapMarker("start", LatLng(it.lat, it.lon), ColorStart.toArgb(),
            "▶", ctx.getString(R.string.map_start), "km 0"))
    }
    pts.lastOrNull()?.let {
        val finishKm = if (total > 0) "km ${total.roundToInt()}" else null
        result.add(MapMarker("finish", LatLng(it.lat, it.lon), ColorFinish.toArgb(),
            "■", ctx.getString(R.string.map_finish), finishKm))
    }

    summits.forEach { s ->
        val km = s.km ?: return@forEach
        val ll = RouteMapLogic.markerLatLng(pts, km, total, s.altitude?.toDouble()) ?: return@forEach
        val cat = if (s.category != null && s.category != "M") " · ${ctx.getString(R.string.map_cat)} ${s.category}" else ""
        val alt = s.altitude?.let { " · ${formatAltMap(it)}" } ?: ""
        val title = s.name ?: ctx.getString(R.string.profile_climb_fallback)
        result.add(MapMarker("summit-$km-${s.name}", ll, ColorSummit.toArgb(),
            summitGlyph(s.category), title, "${km.roundToInt()}$kmUnit$cat$alt"))
    }
    sprints.forEach { w ->
        val km = w.km ?: return@forEach
        val ll = RouteMapLogic.kmToLatLng(pts, km, total) ?: return@forEach
        val label = waypointLabelFor(ctx, w.type)
        result.add(MapMarker("wp-$km-${w.type}", ll, waypointColor(w.type).toArgb(),
            waypointMapGlyph(w.type), w.name ?: label, "$label · ${km.roundToInt()}$kmUnit"))
    }
    sectors.forEach { w ->
        val km = w.km ?: return@forEach
        val ll = RouteMapLogic.kmToLatLng(pts, km, total) ?: return@forEach
        val label = waypointLabelFor(ctx, w.type)
        result.add(MapMarker("sec-$km-${w.type}", ll, waypointColor(w.type).toArgb(),
            waypointMapGlyph(w.type), w.name ?: label, "$label · ${km.roundToInt()}$kmUnit"))
    }
    return result
}

/** Label de tipo de waypoint resuelto con Context (no-Composable; para callouts). */
private fun waypointLabelFor(ctx: android.content.Context, type: String): String = when (type) {
    "intermediate_sprint" -> ctx.getString(R.string.profile_waypoint_intermediate_sprint)
    "bonus_sprint" -> ctx.getString(R.string.profile_waypoint_bonus_sprint)
    "intermediate_split" -> ctx.getString(R.string.profile_waypoint_intermediate_split)
    "cobblestone" -> ctx.getString(R.string.profile_waypoint_cobblestone)
    "sterrato" -> ctx.getString(R.string.profile_waypoint_sterrato)
    else -> type
}

// ─── Bottom sheet: cajas de puntos clave (clon de las del perfil) ─

@Composable
private fun KeyPointsSheet(rd: RaceDay) {
    val total = rd.elevationProfile?.distance ?: rd.distanceKm ?: 0.0
    val points = rd.elevationProfile?.points ?: emptyList()
    val summits = (rd.profileSummits ?: emptyList()).filter { it.km != null }
    val isTt = rd.primaryType == "itt" || rd.primaryType == "ttt"
    val sprints = (rd.profileWaypoints ?: emptyList()).filter {
        it.km != null && if (isTt) it.type == "intermediate_split"
        else it.type == "intermediate_sprint" || it.type == "bonus_sprint"
    }
    val sectors = (rd.profileWaypoints ?: emptyList()).filter {
        it.km != null && (it.type == "cobblestone" || it.type == "sterrato")
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        contentPadding = PaddingValues(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Text(
                text = stringResource(R.string.map_key_points),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
        if (summits.isEmpty() && sprints.isEmpty() && sectors.isEmpty()) {
            item {
                Text(
                    text = stringResource(R.string.map_key_points_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (summits.isNotEmpty()) {
            item {
                KeyBox(title = "${stringResource(R.string.map_section_climbs)} (${summits.size})") {
                    summits.sortedBy { it.km }.forEach { RouteSummitRow(it, total, points) }
                }
            }
        }
        if (sprints.isNotEmpty()) {
            item {
                val title = if (isTt) stringResource(R.string.map_section_splits)
                            else stringResource(R.string.map_section_sprints)
                KeyBox(title = "$title (${sprints.size})") {
                    sprints.sortedBy { it.km }.forEach { RouteWaypointRow(it, total) }
                }
            }
        }
        if (sectors.isNotEmpty()) {
            item {
                KeyBox(title = "${stringResource(R.string.map_section_sectors)} (${sectors.size})") {
                    sectors.sortedBy { it.km }.forEach { RouteWaypointRow(it, total) }
                }
            }
        }
    }
}

@Composable
private fun KeyBox(title: String, content: @Composable () -> Unit) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            content()
        }
    }
}

// Filas IDÉNTICAS a SummitsSection/WaypointsSection del perfil: km inverso
// ("-NN km" / "Meta") + longitud·pendiente media (climbStats) en puertos.

@Composable
private fun RouteSummitRow(s: ProfileSummit, total: Double, points: List<ElevationPoint>) {
    val stats = s.climbStats(points)
    androidx.compose.foundation.layout.Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Dot(ColorSummit, summitGlyph(s.category))
        Column(Modifier.weight(1f)) {
            s.name?.takeIf { it.isNotEmpty() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            s.km?.let { km ->
                val remaining = total - km
                val label = if (remaining < 0.5) stringResource(R.string.map_finish)
                            else "-${remaining.roundToInt()} km"
                Text(label, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
            }
            if (stats != null) {
                Text(
                    text = String.format("%.1f km · %.1f%%", stats.lengthKm, stats.avgGradient),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                s.altitude?.let {
                    Text(formatAltMap(it), style = MaterialTheme.typography.labelSmall,
                         color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
    HorizontalDivider()
}

@Composable
private fun RouteWaypointRow(w: ProfileWaypoint, total: Double) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Dot(waypointColor(w.type), waypointMapGlyph(w.type))
        Column(Modifier.weight(1f)) {
            val label = waypointTypeLabel(w.type)
            Text(w.name ?: label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            if (w.name != null) {
                Text(label, style = MaterialTheme.typography.labelSmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            w.km?.let { km ->
                Text("-${(total - km).roundToInt()} km",
                     style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
            }
            w.lengthKm?.let {
                Text(formatDistanceMap(it), style = MaterialTheme.typography.labelSmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    HorizontalDivider()
}

@Composable
private fun Dot(color: Color, glyph: String) {
    Surface(shape = CircleShape, color = color, modifier = Modifier.size(28.dp)) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = glyph,
                fontSize = if (glyph.length > 1) 8.sp else 10.sp,
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun waypointTypeLabel(type: String): String = when (type) {
    "intermediate_sprint" -> stringResource(R.string.profile_waypoint_intermediate_sprint)
    "bonus_sprint" -> stringResource(R.string.profile_waypoint_bonus_sprint)
    "intermediate_split" -> stringResource(R.string.profile_waypoint_intermediate_split)
    "cobblestone" -> stringResource(R.string.profile_waypoint_cobblestone)
    "sterrato" -> stringResource(R.string.profile_waypoint_sterrato)
    else -> type
}

@Composable
private fun MarkerPopup(
    marker: TappedMarker,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Posicionado SOBRE el pin: el ancla (TopStart) + offset = posición de
    // pantalla del pin, centrado en horizontal (−ancho/2) y elevado por encima
    // (−alto − 14dp de separación). Se mide el tamaño propio para centrar.
    var size by remember { mutableStateOf(IntSize.Zero) }
    val gap = with(LocalDensity.current) { 14.dp.roundToPx() }
    Surface(
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 3.dp,
        shadowElevation = 6.dp,
        modifier = modifier
            .onSizeChanged { size = it }
            .offset {
                IntOffset(
                    x = (marker.screenX.roundToInt() - size.width / 2).coerceAtLeast(0),
                    y = (marker.screenY.roundToInt() - size.height - gap).coerceAtLeast(0),
                )
            }
            .clickable(onClick = onDismiss),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            Text(
                text = marker.title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            marker.subtitle?.takeIf { it.isNotEmpty() }?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun RouteMapError(onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = stringResource(R.string.map_load_error),
                style = MaterialTheme.typography.titleMedium,
            )
            Button(onClick = onRetry) { Text(stringResource(R.string.map_retry)) }
        }
    }
}

// ─── Formato (idioma de CONTENIDO, igual que el perfil) ───────────

private fun formatAltMap(meters: Int): String {
    return if (meters >= 1000) {
        val sep = if (LocaleHolder.shouldShowEnglishContent) ',' else '.'
        "${meters / 1000}${sep}${"%03d".format(meters % 1000)} m"
    } else "$meters m"
}

private fun formatDistanceMap(km: Double): String {
    if (km % 1.0 == 0.0) return "%.0f km".format(km)
    val raw = String.format(java.util.Locale.US, "%.1f", km)
    val str = if (LocaleHolder.shouldShowEnglishContent) raw else raw.replace('.', ',')
    return "$str km"
}
