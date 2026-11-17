package app.calendariociclismo.android.ui.videos

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CCHeaderMark
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.components.ccSegmentedColors
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.stage.PanelDivider
import app.calendariociclismo.android.ui.stage.PanelTextAction
import app.calendariociclismo.android.ui.stage.StageVideoList
import app.calendariociclismo.android.ui.stage.logVideoOpen
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.CxPresentation
import app.calendariociclismo.android.util.CyclocrossLogic
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RegionDetector
import app.calendariociclismo.android.util.RoadTodayAvailability
import app.calendariociclismo.android.util.VideoFeedDay
import app.calendariociclismo.android.util.VideoFeedEntry
import app.calendariociclismo.android.util.VideosFeedLogic
import app.calendariociclismo.android.util.openExternalUrl
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.LocalDate

private const val ROAD = "road"
private const val CX = "cx"

/**
 * Sección Vídeos (docs/plans/videos-5-2.md, fase 5): conmutador Ciclocross /
 * Carretera (Ciclocross primero mientras la portada es Ciclocross), días con
 * cabecera y una tarjeta por carrera que se despliega hacia abajo con el
 * acordeón de vídeos de la jornada (el primero abierto, sin reproducción
 * automática) y las emisiones de Revive. Sin vídeos y con una sola emisión, la
 * tarjeta lleva «Emisión ↗» y no se despliega. Carretera desde
 * `video_feed_days` y ciclocross desde la temporada en curso, cada vista con su
 * ventana de 14 días anclada a su último día con vídeos y «Cargar más
 * carreras» hasta el principio de la temporada.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideosFeedScreen(navController: NavController) {
    val app = rememberApp()
    val context = LocalContext.current
    val haptic = rememberHaptics()
    val scope = rememberCoroutineScope()
    val today = remember { LocalDate.now().toString() }
    val cxSeason = remember { CyclocrossLogic.season(LocalDate.now()) }
    val cxSeasonStart = remember { CyclocrossLogic.months(cxSeason).first().atDay(1).toString() }
    var discipline by rememberSaveable { mutableStateOf(if (RoadTodayAvailability.isVisible()) ROAD else CX) }
    var roadDays by remember { mutableStateOf<List<VideoFeedDay>>(emptyList()) }
    var cxRaces by remember { mutableStateOf<List<CxRace>>(emptyList()) }
    var rounds by remember { mutableStateOf<Map<String, CxRound>>(emptyMap()) }
    var roadFrom by remember { mutableStateOf<String?>(null) }
    var cxFrom by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    val groups = remember { RegionDetector.allowedBroadcastGroups() }

    val roadEntries = remember(roadDays) { VideosFeedLogic.roadEntries(roadDays, groups) }
    val cxEntries = remember(cxRaces, rounds) { VideosFeedLogic.cxEntries(cxRaces, groups, rounds) }

    suspend fun loadCx() {
        val months = CyclocrossLogic.months(cxSeason).filter { it.atDay(1).toString() <= today }
        val rows = coroutineScope { months.map { async { app.supabaseService.cxMonth(cxSeason, it) } }.awaitAll() }.flatten()
        cxRaces = rows.distinctBy { it.id }.filter { CxPresentation.listedInAgenda(it) }
            .sortedWith(compareBy({ it.dateKey }, { it.id }))
        rounds = runCatching { app.supabaseService.cxSeasonRounds(cxSeason) }.getOrDefault(emptyMap())
    }

    suspend fun load() {
        try {
            val anchor = coroutineScope {
                val anchor = async { app.supabaseService.videoFeedDays(null, today) }
                runCatching { loadCx() }
                anchor.await()
            }
            val roadLatest = anchor.map { it.dateKey }.filter { it <= today }.maxOrNull() ?: today
            val cxLatest = VideosFeedLogic.cxEntries(cxRaces, groups, rounds).map { it.date }.filter { it <= today }.maxOrNull() ?: today
            val road = roadFrom ?: maxOf(VideosFeedLogic.shift(roadLatest, -(VideosFeedLogic.WINDOW_DAYS - 1)), VideosFeedLogic.ROAD_SEASON_START)
            roadFrom = road
            cxFrom = cxFrom ?: maxOf(VideosFeedLogic.shift(cxLatest, -(VideosFeedLogic.WINDOW_DAYS - 1)), cxSeasonStart)
            roadDays = app.supabaseService.videoFeedDays(road, today)
            error = null
            loaded = true
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = LocaleHolder.t("No se han podido cargar los vídeos.", "Videos could not be loaded.")
        }
    }

    LaunchedEffect(Unit) { if (!loaded) load() }
    // GA4: `videos` (Carretera) y `videos_cx` (Ciclocross), al abrir y en cada
    // cambio de disciplina, como `results_feed` / `results_feed_cx`.
    LaunchedEffect(discipline) { app.analytics.logScreenView(if (discipline == ROAD) "videos" else "videos_cx") }

    // Semanas anteriores de la vista activa hasta encontrar algún día con
    // carreras o llegar al principio de la temporada.
    fun loadMore() {
        val current = discipline
        var from = (if (current == ROAD) roadFrom else cxFrom) ?: return
        val start = if (current == ROAD) VideosFeedLogic.ROAD_SEASON_START else cxSeasonStart
        scope.launch {
            loadingMore = true
            try {
                while (from > start) {
                    val older = maxOf(VideosFeedLogic.shift(from, -VideosFeedLogic.MORE_DAYS), start)
                    val to = VideosFeedLogic.shift(from, -1)
                    val found = if (current == ROAD) {
                        val rows = app.supabaseService.videoFeedDays(older, to)
                        roadDays = roadDays + rows
                        VideosFeedLogic.roadEntries(rows, groups).isNotEmpty()
                    } else {
                        cxEntries.any { it.date in older..to }
                    }
                    from = older
                    if (current == ROAD) roadFrom = older else cxFrom = older
                    if (found) break
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
            } finally {
                loadingMore = false
            }
        }
    }

    val days = if (discipline == ROAD) VideosFeedLogic.days(roadEntries, roadFrom, today)
        else VideosFeedLogic.days(cxEntries, cxFrom, today, cxRaces)
    val canLoadMore = ((if (discipline == ROAD) roadFrom else cxFrom) ?: "") >
        (if (discipline == ROAD) VideosFeedLogic.ROAD_SEASON_START else cxSeasonStart)
    val onExternal: (String) -> Unit = { url -> openExternalUrl(context, url) }

    Scaffold(
        topBar = {
            // Marca de CC y título de la sección, como Resultados.
            TopAppBar(
                title = {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        CCHeaderMark()
                        Text(LocaleHolder.t("Vídeos", "Videos"), style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            DisciplineSelector(discipline) {
                haptic(Haptics.Event.Selection)
                discipline = it
                openId = null
            }
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } },
                modifier = Modifier.fillMaxWidth().weight(1f),
            ) {
                when {
                    !loaded && error == null -> RouteLoadingView(message = LocaleHolder.t("Cargando vídeos", "Loading videos"), title = LocaleHolder.t("Vídeos", "Videos"))
                    !loaded -> Text(
                        text = error.orEmpty(),
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                        color = MaterialTheme.colorScheme.error,
                    )
                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        if (days.isEmpty()) {
                            item(key = "empty") {
                                Text(
                                    text = if (discipline == CX) LocaleHolder.t("No hay vídeos de ciclocross en este periodo.", "No cyclocross videos in this period.")
                                    else LocaleHolder.t("No hay vídeos de carretera en este periodo.", "No road videos in this period."),
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 96.dp, horizontal = 24.dp),
                                )
                            }
                        }
                        days.forEachIndexed { index, day ->
                            item(key = "day-${discipline}-${day.date}") {
                                Text(
                                    text = DateFormatting.formatDateLongContent(day.date),
                                    style = CCText.S13,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier
                                        .widthIn(max = 760.dp)
                                        .fillMaxWidth()
                                        .padding(top = if (index == 0) 0.dp else 8.dp, start = 4.dp)
                                        .semantics { heading() },
                                )
                            }
                            items(day.entries, key = { it.id }) { entry ->
                                VideoFeedCard(
                                    entry = entry,
                                    isOpen = openId == entry.id,
                                    onToggle = {
                                        haptic(Haptics.Event.Selection)
                                        openId = if (openId == entry.id) null else entry.id
                                    },
                                    onFull = { url, kind ->
                                        logVideoOpen(app, url, kind)
                                        onExternal(url)
                                    },
                                    onExternal = onExternal,
                                    onGo = {
                                        haptic(Haptics.Event.Navigation)
                                        if (entry.cxRaceId != null) {
                                            navController.navigate(Routes.cxRace(entry.cxRaceId, "videos", entry.name))
                                        } else if (entry.stageId != null) {
                                            navController.navigate(Routes.stage(entry.stageId, entry.raceId, entry.name, section = "videos"))
                                        }
                                    },
                                    modifier = Modifier.widthIn(max = 760.dp).fillMaxWidth(),
                                )
                            }
                        }
                        if (canLoadMore) {
                            item(key = "load-more") {
                                // Mismo botón que «Cargar más resultados» de Últimos resultados.
                                Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                                    OutlinedButton(
                                        onClick = { haptic(Haptics.Event.PrimaryAction); loadMore() },
                                        enabled = !loadingMore,
                                        shape = RoundedCornerShape(CCRadius.Control),
                                    ) {
                                        if (loadingMore) {
                                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                        } else {
                                            Text(LocaleHolder.t("Cargar más carreras", "Load more races"), style = CCText.S14, fontWeight = FontWeight.SemiBold)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Conmutador Ciclocross / Carretera, con el control segmentado de Resultados. */
@Composable
private fun DisciplineSelector(active: String, onSelect: (String) -> Unit) {
    val options = listOf(CX to LocaleHolder.t("Ciclocross", "Cyclocross"), ROAD to LocaleHolder.t("Carretera", "Road"))
    SingleChoiceSegmentedButtonRow(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp),
    ) {
        options.forEachIndexed { index, (key, label) ->
            SegmentedButton(
                colors = ccSegmentedColors(),
                selected = active == key,
                onClick = { if (active != key) onSelect(key) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = options.size, baseShape = RoundedCornerShape(CCRadius.Control)),
                icon = {},
            ) {
                Text(label, style = CCText.S13, maxLines = 1)
            }
        }
    }
}

/** Tarjeta de una carrera: plegada, la carrera y una flecha hacia abajo. */
@Composable
private fun VideoFeedCard(
    entry: VideoFeedEntry,
    isOpen: Boolean,
    onToggle: () -> Unit,
    onFull: (String, String) -> Unit,
    onExternal: (String) -> Unit,
    onGo: () -> Unit,
    modifier: Modifier = Modifier,
) {
    CCCard(modifier = modifier) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (entry.expandable) {
                            Modifier
                                .clickable(role = Role.Button, onClick = onToggle)
                                .semantics(mergeDescendants = true) { selected = isOpen }
                        } else Modifier,
                    )
                    .padding(start = 12.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(
                    modifier = Modifier.width(36.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    RaceLogo(url = entry.logoUrl, size = 36.dp, placeholder = entry.placeholderLogo)
                    if (entry.countryCode != null) CountryFlag(countryCode = entry.countryCode)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(entry.name, style = CCText.S16, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (entry.subtitle.isNotEmpty()) {
                        Text(
                            entry.subtitle,
                            style = CCText.S13,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                if (entry.expandable) {
                    Icon(
                        imageVector = Icons.Filled.KeyboardArrowDown,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.padding(end = 4.dp),
                    )
                } else {
                    val url = entry.fullUrl
                    if (url != null) {
                        PanelTextAction(
                            label = "${LocaleHolder.t("Emisión", "Broadcast")} ↗︎",
                            onClick = { onFull(url, "full") },
                            modifier = Modifier.semantics { entry.fullLabel?.let { contentDescription = it } },
                        )
                    }
                }
            }
            if (entry.expandable && isOpen) {
                PanelDivider()
                StageVideoList(entry.rows, entry.oneDay, stateKey = entry.id, onExternalLinkTap = onExternal)
                PanelDivider()
                val goLabel = when {
                    entry.cxRaceId != null -> LocaleHolder.t("Ir a la prueba", "Go to race")
                    entry.oneDay -> LocaleHolder.t("Ir a la carrera", "Go to race")
                    else -> LocaleHolder.t("Ir a la etapa", "Go to stage")
                }
                TextButton(onClick = onGo, modifier = Modifier.padding(horizontal = 4.dp).heightIn(min = 48.dp)) {
                    Text("$goLabel ›", style = CCText.S13, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
