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
import androidx.compose.runtime.collectAsState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.calendariociclismo.android.util.CxRaceFilter
import app.calendariociclismo.android.util.RoadRaceFilter
import app.calendariociclismo.android.ui.components.FiltersMenuStyle
import app.calendariociclismo.android.ui.components.CxFiltersMenu
import app.calendariociclismo.android.ui.components.RoadFiltersMenu
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
/** Mínimo de días con vídeos que pasan los filtros antes de dejar de ampliar la ventana. */
private const val VIDEOS_MIN_DAYS = 15

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideosFeedScreen(navController: NavController) {
    val app = rememberApp()
    val context = LocalContext.current
    val haptic = rememberHaptics()
    val scope = rememberCoroutineScope()
    var today by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    val cxSeason = remember(today) { CyclocrossLogic.season(LocalDate.parse(today)) }
    val cxSeasonStart = remember(cxSeason) { CyclocrossLogic.months(cxSeason).first().atDay(1).toString() }
    var roadTodayVisible by rememberSaveable { mutableStateOf(RoadTodayAvailability.isVisible()) }
    var discipline by rememberSaveable { mutableStateOf(if (roadTodayVisible) ROAD else CX) }
    var roadDays by remember { mutableStateOf<List<VideoFeedDay>>(emptyList()) }
    var cxRaces by remember { mutableStateOf<List<CxRace>>(emptyList()) }
    var rounds by remember { mutableStateOf<Map<String, CxRound>>(emptyMap()) }
    // Destacadas (corona del panel): encabezan su día, como en Hoy. Carretera: `día|carrera`.
    var roadFeatured by remember { mutableStateOf<Set<String>>(emptySet()) }
    var cxFeatured by remember { mutableStateOf<Set<String>>(emptySet()) }
    var roadFrom by remember { mutableStateOf<String?>(null) }
    var cxFrom by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    val groups = remember { RegionDetector.allowedBroadcastGroups() }
    // Filtros de Hoy y Calendario, compartidos por disciplina. Sin leer aún (null), la lista espera.
    val storedRoadFilter by app.preferences.roadRaceFilter.collectAsState(initial = null)
    val roadFilter = storedRoadFilter ?: RoadRaceFilter()
    val cxFilter by app.preferences.cxRaceFilter.collectAsState(initial = CxRaceFilter())
    val filtersActive = if (discipline == ROAD) roadFilter.isActive else cxFilter.isActive

    val roadEntries = remember(roadDays, roadFeatured) { VideosFeedLogic.roadEntries(roadDays, groups, roadFeatured) }

    suspend fun roadFeaturedFor(rows: List<VideoFeedDay>): Set<String> {
        val keys = rows.map { it.dateKey }.distinct()
        if (keys.isEmpty()) return emptySet()
        return runCatching { app.supabaseService.featuredRaces(keys) }.getOrDefault(emptyList())
            .map { VideosFeedLogic.featuredKey(it.dateKey, it.raceId) }.toSet()
    }
    val cxEntries = remember(cxRaces, rounds) { VideosFeedLogic.cxEntries(cxRaces, groups, rounds) }

    suspend fun loadCx(targetToday: String = today) {
        val season = CyclocrossLogic.season(LocalDate.parse(targetToday))
        val months = CyclocrossLogic.months(season).filter { it.atDay(1).toString() <= targetToday }
        val rows = coroutineScope { months.map { async { app.supabaseService.cxMonth(season, it) } }.awaitAll() }.flatten()
        cxRaces = rows.distinctBy { it.id }.filter { CxPresentation.listedInAgenda(it) }
            .sortedWith(compareBy({ it.dateKey }, { it.id }))
        rounds = runCatching { app.supabaseService.cxSeasonRounds(season) }.getOrDefault(emptyMap())
        cxFeatured = runCatching { app.supabaseService.cxFeaturedRaceIds() }.getOrDefault(cxFeatured)
    }

    suspend fun load(targetToday: String = today) {
        try {
            val seasonStart = CyclocrossLogic.months(CyclocrossLogic.season(LocalDate.parse(targetToday))).first().atDay(1).toString()
            val anchor = coroutineScope {
                val anchor = async { app.supabaseService.videoFeedDays(null, targetToday) }
                runCatching { loadCx(targetToday) }
                anchor.await()
            }
            val roadLatest = anchor.map { it.dateKey }.filter { it <= targetToday }.maxOrNull() ?: targetToday
            val cxLatest = VideosFeedLogic.cxEntries(cxRaces, groups, rounds).map { it.date }.filter { it <= targetToday }.maxOrNull() ?: targetToday
            val road = roadFrom ?: maxOf(VideosFeedLogic.shift(roadLatest, -(VideosFeedLogic.WINDOW_DAYS - 1)), VideosFeedLogic.ROAD_SEASON_START)
            roadFrom = road
            cxFrom = cxFrom ?: maxOf(VideosFeedLogic.shift(cxLatest, -(VideosFeedLogic.WINDOW_DAYS - 1)), seasonStart)
            val fetched = app.supabaseService.videoFeedDays(road, targetToday)
            roadFeatured = roadFeaturedFor(fetched)
            roadDays = fetched
            error = null
            loaded = true
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = LocaleHolder.t("No se han podido cargar los vídeos.", "Videos could not be loaded.")
        }
    }

    LaunchedEffect(Unit) { if (!loaded) load() }
    // Al volver a primer plano tras cruzar la frontera estacional, cambia la
    // disciplina por defecto a Carretera o Ciclocross sin reiniciar la app.
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner) {
        var firstResume = true
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            val now = LocalDate.now()
            val nowKey = now.toString()
            val dayChanged = nowKey != today
            if (dayChanged) today = nowKey
            val visible = RoadTodayAvailability.isVisible(now)
            if (visible != roadTodayVisible) {
                roadTodayVisible = visible
                discipline = if (visible) ROAD else CX
                openId = null
            }
            if (firstResume) {
                firstResume = false
            } else if (dayChanged && loaded) {
                load(nowKey)
            }
        }
    }
    // GA4: `videos` (Carretera) y `videos_cx` (Ciclocross), al abrir y en cada
    // cambio de disciplina, como `results_feed` / `results_feed_cx`.
    LaunchedEffect(discipline) { app.analytics.logScreenView(if (discipline == ROAD) "videos" else "videos_cx") }

    // Semanas anteriores de la vista activa hasta encontrar algún día con
    // carreras o llegar al principio de la temporada.
    suspend fun loadMoreNow() {
        val current = discipline
        var from = (if (current == ROAD) roadFrom else cxFrom) ?: return
        val start = if (current == ROAD) VideosFeedLogic.ROAD_SEASON_START else cxSeasonStart
        loadingMore = true
        try {
            while (from > start) {
                val older = maxOf(VideosFeedLogic.shift(from, -VideosFeedLogic.MORE_DAYS), start)
                val to = VideosFeedLogic.shift(from, -1)
                val found = if (current == ROAD) {
                    val rows = app.supabaseService.videoFeedDays(older, to)
                    roadFeatured = roadFeatured + roadFeaturedFor(rows)
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

    // Semanas anteriores de la vista activa hasta encontrar algún día con
    // carreras o llegar al principio de la temporada.
    fun loadMore() {
        scope.launch { loadMoreNow() }
    }

    val allDays = if (discipline == ROAD) VideosFeedLogic.days(roadEntries, roadFrom, today)
        else VideosFeedLogic.days(cxEntries, cxFrom, today, cxRaces, cxFeatured)
    // Solo las carreras que pasan los filtros; un día sin ninguna no aparece.
    val days = if (!filtersActive) allDays else allDays.mapNotNull { group ->
        val kept = group.entries.filter { entry ->
            if (discipline == ROAD) entry.roadRace?.let { roadFilter.matches(it.uciCategory, it.name, it.gender) } ?: true
            else entry.cxRace?.let { cxFilter.matches(it) } ?: true
        }
        if (kept.isEmpty()) null else group.copy(entries = kept)
    }
    // Mínimo de 15 días con vídeos que pasan los filtros: si la ventana deja menos, se amplía
    // hacia atrás hasta alcanzarlo o llegar al principio de la temporada.
    val currentFrom = if (discipline == ROAD) roadFrom else cxFrom
    LaunchedEffect(loaded, storedRoadFilter != null, discipline, roadFilter, cxFilter, days.size, currentFrom) {
        if (loaded && storedRoadFilter != null && !loadingMore && days.size < VIDEOS_MIN_DAYS &&
            (currentFrom ?: "") > (if (discipline == ROAD) VideosFeedLogic.ROAD_SEASON_START else cxSeasonStart)
        ) loadMoreNow()
    }
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
                actions = {
                    if (discipline == ROAD) {
                        RoadFiltersMenu(
                            filter = roadFilter,
                            onChange = {
                                haptic(Haptics.Event.Selection)
                                scope.launch { app.preferences.setRoadRaceFilter(it) }
                            },
                            style = FiltersMenuStyle.TopBar,
                        )
                    } else {
                        CxFiltersMenu(
                            filter = cxFilter,
                            onChange = {
                                haptic(Haptics.Event.Selection)
                                scope.launch { app.preferences.setCxRaceFilter(it) }
                            },
                            style = FiltersMenuStyle.TopBar,
                        )
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
                    (!loaded && error == null) || (loaded && storedRoadFilter == null) -> RouteLoadingView(message = LocaleHolder.t("Cargando vídeos", "Loading videos"), title = LocaleHolder.t("Vídeos", "Videos"))
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
                                    text = if (filtersActive) LocaleHolder.t("No hay vídeos con estos filtros en este periodo.", "No videos match these filters in this period.")
                                    else if (discipline == CX) LocaleHolder.t("No hay vídeos de ciclocross en este periodo.", "No cyclocross videos in this period.")
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
