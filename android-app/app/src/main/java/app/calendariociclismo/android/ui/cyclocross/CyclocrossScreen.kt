package app.calendariociclismo.android.ui.cyclocross

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import app.calendariociclismo.android.ui.today.TodayHighlightsBanner
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.filled.Group
import app.calendariociclismo.android.util.CxAgendaFilter
import app.calendariociclismo.android.util.CxCategoryCardState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.CxCategory
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.data.model.CxTournamentGeneral
import app.calendariociclismo.android.ui.results.ResultsClassificationTab
import app.calendariociclismo.android.ui.results.classificationSwipe
import app.calendariociclismo.android.ui.results.rememberClassificationSwipeState
import app.calendariociclismo.android.util.CxTournamentSection
import app.calendariociclismo.android.util.UciResultsLogic
import androidx.compose.foundation.lazy.LazyRow
import kotlinx.coroutines.CancellationException
import app.calendariociclismo.android.ui.components.CCActionButton
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.components.WaitingResultsIndicator
import app.calendariociclismo.android.ui.components.*
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.adaptive.rememberAdaptiveLayoutInfo
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.results.ResultsStageSelector
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.CxTemporalState
import app.calendariociclismo.android.util.CxPresentation
import app.calendariociclismo.android.util.CyclocrossLogic
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.rememberHaptics
import java.time.Instant
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private sealed class AgendaRow(val key: String) {
    class Day(val date: String) : AgendaRow("day:$date")
    class Race(val race: CxRace, val date: String) : AgendaRow("race:$date:${race.id}")
    /** Mes sin pruebas. `filtered` = el filtro activo quitó pruebas que sí había. */
    class Empty(val month: YearMonth, val filtered: Boolean) : AgendaRow("empty:$month:${if (filtered) 1 else 0}")
}

private fun agendaLayoutRows(rows: List<AgendaRow>, columns: Int): List<List<AgendaRow>> {
    if (columns <= 1) return rows.map(::listOf)
    val result = mutableListOf<List<AgendaRow>>()
    val pending = mutableListOf<AgendaRow.Race>()
    fun flush() {
        if (pending.isNotEmpty()) {
            result += pending.toList()
            pending.clear()
        }
    }
    rows.forEach { row ->
        when (row) {
            is AgendaRow.Race -> {
                if (pending.isNotEmpty() && pending.first().date != row.date) flush()
                pending += row
                if (pending.size == columns) flush()
            }
            else -> {
                flush()
                result += listOf(row)
            }
        }
    }
    flush()
    return result
}

@Composable
internal fun cxClock(): Instant {
    var now by remember { mutableStateOf(Instant.now()) }
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { now = Instant.now(); delay(30_000) }
        }
    }
    return now
}

@Composable
internal fun cxCategoryName(code: String): String = stringResource(when (code) {
    "ME" -> R.string.cx_me; "WE" -> R.string.cx_we; "MU" -> R.string.cx_mu
    "WU" -> R.string.cx_wu; "MJ" -> R.string.cx_mj; else -> R.string.cx_wj
})

internal fun cxColor(value: String?): Color? = value?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() }

/** Desliza el contenido fuera, ejecuta el cambio de mes y desliza el nuevo,
 *  idéntico a `animateNavigation` de Hoy en Carretera (TodayScreen.kt). */
private suspend fun animateMonthNavigation(
    offsetX: Animatable<Float, *>,
    widthPx: Float,
    forward: Boolean,
    setAnimating: (Boolean) -> Unit,
    action: suspend () -> Unit,
) {
    if (widthPx <= 0f) { action(); return }
    setAnimating(true)
    val dir = if (forward) -1f else 1f
    offsetX.animateTo(dir * widthPx, tween(150))
    action()
    offsetX.snapTo(-dir * widthPx)
    offsetX.animateTo(0f, tween(200))
    setAnimating(false)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CyclocrossScreen(nav: NavController, tournamentId: String? = null, selectedSeason: String? = null, tournamentName: String? = null, tournamentLogo: String? = null) {
    val app = rememberApp()
    val state = remember(tournamentId) { CyclocrossAgendaState(app.cxRepository, tournamentId = tournamentId) }
    val season = state.season
    val scope = rememberCoroutineScope()
    val haptic = rememberHaptics()
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    val list = rememberLazyListState()
    // Deslizamiento entre meses con la animación de Hoy en Carretera: la lista
    // sale deslizada, cambia el mes y entra la nueva desde el lado contrario.
    val contentOffsetX = remember { Animatable(0f) }
    var isAnimatingNav by remember { mutableStateOf(false) }
    var contentWidthPx by remember { mutableStateOf(0f) }
    // Torneo formado solo por carreras ocultas en el idioma activo.
    var tournamentHidden by remember(tournamentId) { mutableStateOf(false) }
    LaunchedEffect(tournamentId) {
        if (tournamentId != null) tournamentHidden = !app.cxRepository.tournamentIsVisible(tournamentId)
    }
    if (tournamentHidden) {
        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars), contentAlignment = Alignment.Center) {
            CxSpanishAudienceNotice(onBack = { nav.popBackStack() })
        }
        return
    }
    var savedMonth by rememberSaveable { mutableStateOf<String?>(null) }
    // Clasificación general del torneo: la sección solo existe con generales
    // publicadas; sin ellas la página queda como calendario sin selector.
    val generalSeason = selectedSeason ?: season
    var general by remember(tournamentId, generalSeason) { mutableStateOf<CxTournamentGeneral?>(null) }
    var generalRefreshing by remember(tournamentId) { mutableStateOf(false) }
    var tournamentSection by rememberSaveable(tournamentId) { mutableStateOf(CxTournamentSection.CALENDAR) }
    var generalCategory by rememberSaveable(tournamentId) { mutableStateOf<String?>(null) }
    suspend fun loadGeneral() {
        val id = tournamentId ?: return
        try { general = app.cxRepository.tournamentGeneral(id, generalSeason) }
        catch (failure: Exception) { if (failure is CancellationException) throw failure }
    }
    LaunchedEffect(tournamentId, generalSeason) { loadGeneral() }
    val generalCategories = general?.let { CxPresentation.tournamentGeneralCategories(it.standings, it.states) }.orEmpty()
    val activeSection = if (generalCategories.isEmpty()) CxTournamentSection.CALENDAR else tournamentSection
    val activeGeneralCategory = generalCategory?.takeIf { it in generalCategories } ?: "ME".takeIf { it in generalCategories } ?: generalCategories.firstOrNull()
    val generalSwipe = rememberClassificationSwipeState()
    val locale = LocalConfiguration.current.locales[0]
    val clock = cxClock()
    val cxPinnedRaw by app.preferences.cxDefaultFilter.collectAsState(initial = null)
    val pinnedFilter = CxAgendaFilter.entries.firstOrNull { it.name == cxPinnedRaw } ?: CxAgendaFilter.ALL
    var filter by rememberSaveable { mutableStateOf(CxAgendaFilter.ALL) }
    var pendingDefault by remember { mutableStateOf<CxAgendaFilter?>(null) }
    LaunchedEffect(cxPinnedRaw, tournamentId) { filter = if (tournamentId == null) pinnedFilter else CxAgendaFilter.ALL }
    val rows = buildList {
        for (month in state.visibleMonths) {
            val monthRaces = state.cache[month]?.data ?: continue
            val allRaces = monthRaces.filter { tournamentId == null || it.tournamentId == tournamentId }
            val races = if (tournamentId == null) allRaces.filter { CxPresentation.matchesAgendaFilter(it, filter) } else allRaces
            val dates = races.flatMap { CyclocrossLogic.dates(it) }.distinct().sorted().filter { it.startsWith(month.toString()) }
            if (dates.isEmpty()) {
                if (tournamentId == null) {
                    val unfiltered = allRaces.flatMap { CyclocrossLogic.dates(it) }.any { it.startsWith(month.toString()) }
                    add(AgendaRow.Empty(month, unfiltered))
                }
                continue
            }
            for (date in dates) {
                add(AgendaRow.Day(date))
                for (race in CyclocrossLogic.racesOn(races, date)) add(AgendaRow.Race(race, date))
            }
        }
    }
    val roundTotal = tournamentId?.let { id ->
        CxPresentation.tournamentRoundTotal(id, rows.filterIsInstance<AgendaRow.Race>().map { it.race }, state.rounds)
    } ?: 0
    LaunchedEffect(season) { state.open(selectedSeason ?: season, savedMonth?.let { runCatching { YearMonth.parse(it) }.getOrNull() }) }
    LaunchedEffect(season) { state.loadRounds() }
    LaunchedEffect(state.activeMonth) { state.activeMonth?.let { savedMonth = it.toString() } }
    // Cambio de mes unificado (swipe, flechas y selector) con la animación de
    // Hoy en Carretera.
    suspend fun changeMonth(target: YearMonth?) {
        val active = state.activeMonth ?: return
        if (target == null || target == active || target !in CyclocrossLogic.months(season) || isAnimatingNav) return
        val forward = target > active
        animateMonthNavigation(contentOffsetX, contentWidthPx, forward, { isAnimatingNav = it }) {
            if (!state.busy) state.selectMonth(target)
        }
    }
    // La página de torneo usa la estructura de las vueltas por etapas de
    // carretera: cabecera en tarjeta con identidad y retroceso, sin el logo
    // simplificado en la barra superior. La agenda general conserva su barra.
    Scaffold(contentWindowInsets = WindowInsets(0), topBar = {
        if (tournamentId == null) {
            // Titular de sección, como en Mercado de Fichajes o Resultados.
            // Sin botón de refresco: la agenda se actualiza al tirar.
            TopAppBar(title = {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    CCHeaderMark()
                    Text(stringResource(R.string.tab_cyclocross), style = MaterialTheme.typography.titleMedium)
                }
            })
        }
    }) { padding ->
        val base = Modifier.padding(padding).consumeWindowInsets(padding)
        Column(if (tournamentId != null) base.windowInsetsPadding(WindowInsets.statusBars) else base) {
            if (tournamentId == null) TodayHighlightsBanner(navController = nav, scope = "cx")
            else CCCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), cornerRadius = 12) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    RaceCompetitionIdentity(tournamentName.orEmpty(), tournamentLogo, null, hideFlag = true, onBack = { nav.popBackStack() })
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (roundTotal > 1) {
                            Text(stringResource(R.string.cx_rounds_count, roundTotal), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("·", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(season, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            // Secciones del torneo con el selector de la ficha de carrera.
            if (generalCategories.isNotEmpty()) {
                LazyRow(Modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(CxTournamentSection.entries) { part ->
                        ResultsClassificationTab(label = stringResource(when (part) {
                            CxTournamentSection.CALENDAR -> R.string.cx_calendar
                            CxTournamentSection.GENERAL -> R.string.cx_overall_standings
                        }), selected = activeSection == part, onClick = { tournamentSection = part })
                    }
                }
                if (activeSection == CxTournamentSection.GENERAL) Box(Modifier.padding(horizontal = 16.dp)) {
                    ResultsStageSelector(stageKeys = generalCategories, activeKey = activeGeneralCategory, isEn = locale.language != "es",
                        labelForKey = { it }, accessibilityLabelForKey = { cxCategoryName(it) }, onSelect = { generalCategory = it })
                }
            }
            // La agenda general conserva el selector de meses; la página de torneo
            // muestra todas sus pruebas juntas y prescinde de él. Las flechas solo
            // acompañan al selector cuando los siete meses no caben sin desplazarse.
            if (tournamentId == null) {
                val allowed = CyclocrossLogic.months(season)
                val active = state.activeMonth ?: allowed.firstOrNull()
                var monthsFit by remember { mutableStateOf(false) }
                Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (!monthsFit) {
                        IconButton(onClick = { haptic(Haptics.Event.Navigation); active?.let { scope.launch { changeMonth(it.minusMonths(1)) } } }, enabled = !state.busy && active != allowed.firstOrNull()) {
                            Icon(Icons.Default.ChevronLeft, LocaleHolder.t("Mes anterior", "Previous month"))
                        }
                    }
                    Box(Modifier.weight(1f)) {
                        ResultsStageSelector(allowed.map { it.toString() }, active?.toString(), locale.language != "es",
                            labelForKey = { YearMonth.parse(it).format(DateTimeFormatter.ofPattern("MMM", locale)).lowercase(locale) },
                            subtitleForKey = { it.take(4) },
                            enabled = !state.busy,
                            dateNavigationStyle = true,
                            centerWhenFits = true,
                            accessibilityLabelForKey = { YearMonth.parse(it).format(DateTimeFormatter.ofPattern("MMMM yyyy", locale)) },
                            onFitsChange = { monthsFit = it },
                            onSelect = { key -> if (!state.busy && key != null) { haptic(Haptics.Event.Navigation); scope.launch { changeMonth(YearMonth.parse(key)) } } })
                    }
                    if (!monthsFit) {
                        IconButton(onClick = { haptic(Haptics.Event.Navigation); active?.let { scope.launch { changeMonth(it.plusMonths(1)) } } }, enabled = !state.busy && active != allowed.lastOrNull()) {
                            Icon(Icons.Default.ChevronRight, LocaleHolder.t("Mes siguiente", "Next month"))
                        }
                    }
                }
            }
            // Filtro de la agenda, con la misma presentación y posición que Hoy
            // en Carretera: franja fija de chips bajo la cabecera/meses.
            if (tournamentId == null) Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CxAgendaFilter.entries.forEach { option ->
                    val hidePin = option == CxAgendaFilter.ALL || filter == CxAgendaFilter.ALL
                    val pinFilled = !hidePin && pinnedFilter != CxAgendaFilter.ALL && pinnedFilter == option
                    val pinOutline = !hidePin && !pinFilled && filter == option
                    CxAgendaFilterChip(
                        label = stringResource(option.labelRes),
                        selected = filter == option,
                        pinFilled = pinFilled,
                        pinOutline = pinOutline,
                        onClick = {
                            if (filter == option) {
                                haptic(Haptics.Event.PrimaryAction)
                                pendingDefault = option
                            } else {
                                haptic(Haptics.Event.Selection)
                                filter = option
                            }
                        },
                        onLongClick = { haptic(Haptics.Event.PrimaryAction); pendingDefault = option },
                    )
                }
            }
            if (activeSection == CxTournamentSection.GENERAL) {
                val data = general
                PullToRefreshBox(
                    isRefreshing = generalRefreshing,
                    onRefresh = { scope.launch { generalRefreshing = true; try { loadGeneral() } finally { generalRefreshing = false } } },
                    modifier = Modifier.weight(1f),
                ) {
                    if (data != null) CxTournamentGeneralContent(
                        general = data,
                        category = activeGeneralCategory,
                        categories = generalCategories,
                        rounds = state.rounds,
                        swipeState = generalSwipe,
                        onCategory = { generalCategory = it },
                        onOpenRace = { nav.navigate(Routes.cxRace(it.id)) },
                    )
                }
                return@Column
            }
            if (state.busy && !state.isRefreshing) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.error?.let { error ->
                Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(error, Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { scope.launch { state.retry() } }) { Text(stringResource(R.string.cx_retry)) }
                }
            }
            // Torneo: pantalla de carga completa (sin perfil inferior) mientras
            // llega la primera tanda de carreras.
            if (tournamentId != null && state.busy && !state.isRefreshing && rows.isEmpty()) {
                RouteLoadingView(message = stringResource(R.string.loading), showProfile = false, modifier = Modifier.weight(1f))
            } else PullToRefreshBox(
                isRefreshing = state.isRefreshing,
                onRefresh = { scope.launch { state.refresh() } },
                modifier = Modifier.weight(1f),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .onSizeChanged { contentWidthPx = it.width.toFloat() }
                        .graphicsLayer { translationX = contentOffsetX.value }
                        .clipToBounds()
                        .then(if (tournamentId == null) Modifier.pointerInput(season) {
                            // Misma receta que Hoy: decidir la dirección tras 30 px
                            // con margen 1,5× sobre la vertical y exigir 80 px
                            // reales; así una deriva horizontal durante un scroll
                            // vertical no cambia de mes.
                            awaitPointerEventScope {
                                while (true) {
                                    val down = awaitFirstDown(requireUnconsumed = false)
                                    var totalX = 0f
                                    var totalY = 0f
                                    var decided = false
                                    var isHorizontal = false

                                    drag(down.id) { change ->
                                        totalX += change.positionChange().x
                                        totalY += change.positionChange().y
                                        if (!decided && (abs(totalX) > 30f || abs(totalY) > 30f)) {
                                            decided = true
                                            isHorizontal = abs(totalX) > abs(totalY) * 1.5f
                                        }
                                        if (isHorizontal) change.consume()
                                    }

                                    if (isHorizontal && abs(totalX) > 80f && !isAnimatingNav) {
                                        haptic(Haptics.Event.Navigation)
                                        val active = state.activeMonth
                                        val target = active?.let { if (totalX < 0) it.plusMonths(1) else it.minusMonths(1) }
                                        scope.launch { changeMonth(target) }
                                    }
                                }
                            }
                        } else Modifier),
                ) {
                    BoxWithConstraints(Modifier.fillMaxSize()) {
                        val columns = AdaptiveLayoutPolicy.feedColumns(maxWidth.value, adaptiveInfo)
                        val layoutRows = remember(rows, columns) { agendaLayoutRows(rows, columns) }
                        LaunchedEffect(state.jumpDate, layoutRows) {
                            state.jumpDate?.let { date ->
                                val index = layoutRows.indexOfFirst { group ->
                                    group.any { it.key == "day:$date" }
                                }.takeIf { it >= 0 } ?: 0
                                list.scrollToItem(index)
                                state.consumeJump()
                            }
                        }
                        LazyColumn(modifier = Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(layoutRows, key = { group -> group.joinToString("|") { it.key } }) { group ->
                                when (val first = group.first()) {
                                    is AgendaRow.Day -> Text(DateFormatting.formatDateLabel(first.date), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = if (tournamentId != null && first.key != rows.firstOrNull()?.key) 6.dp else 0.dp).semantics { heading() })
                                    is AgendaRow.Empty -> CxEmptyState(first.filtered)
                                    is AgendaRow.Race -> Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                        verticalAlignment = Alignment.Top,
                                    ) {
                                        group.filterIsInstance<AgendaRow.Race>().forEach { row ->
                                            Box(Modifier.weight(1f)) {
                                                CxRaceCard(row.race, row.date, clock, round = state.rounds[row.race.id], showTournamentLink = tournamentId == null, openTournament = {
                                                    row.race.tournament?.let { nav.navigate(Routes.cxTournament(it.id, row.race.seasonKey, if (locale.language != "es") it.nameEn ?: it.name else it.name, it.logoUrl)) }
                                                }) { category -> nav.navigate(Routes.cxRace(row.race.id, category)) }
                                            }
                                        }
                                        repeat(columns - group.size) { Spacer(Modifier.weight(1f)) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    pendingDefault?.let { option ->
        val isPinned = pinnedFilter != CxAgendaFilter.ALL && pinnedFilter == option
        val optionLabel = stringResource(option.labelRes)
        AlertDialog(
            onDismissRequest = { pendingDefault = null },
            title = { Text(stringResource(if (isPinned) R.string.filter_dialog_remove_title else R.string.filter_dialog_title)) },
            text = { Text(stringResource(if (isPinned) R.string.cx_filter_dialog_remove_message else R.string.cx_filter_dialog_set_message, optionLabel)) },
            confirmButton = {
                if (isPinned) {
                    TextButton(onClick = { scope.launch { app.preferences.setCxDefaultFilter(null) }; pendingDefault = null }) { Text(stringResource(R.string.action_remove)) }
                } else {
                    TextButton(onClick = { scope.launch { app.preferences.setCxDefaultFilter(option.name) }; pendingDefault = null }) { Text(stringResource(R.string.action_set)) }
                }
            },
            dismissButton = { TextButton(onClick = { pendingDefault = null }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

/** Clasificación general de la página de torneo: la tabla de la ficha de
 *  carrera para la categoría elegida; deslizar cambia de categoría. */
@Composable
private fun CxTournamentGeneralContent(
    general: CxTournamentGeneral,
    category: String?,
    categories: List<String>,
    rounds: Map<String, CxRound>,
    swipeState: app.calendariociclismo.android.ui.results.ClassificationSwipeState,
    onCategory: (String) -> Unit,
    onOpenRace: (CxRace) -> Unit,
) {
    val teamMatcher = remember(general.teams) { UciResultsLogic.TeamMatcher(general.teams.map { it.roadTeam }) }
    val races = remember(general.races) { general.races.associateBy { it.id } }
    val rows = general.standings.filter { it.category == category }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
        item(key = "general:${category.orEmpty()}") {
            Box(Modifier.classificationSwipe(categories, category, swipeState, onCategory)) {
                CxStandingsTable(
                    rows = rows,
                    state = general.states.firstOrNull { it.category == category },
                    mode = CxPresentation.standingMode(general.tournament, category, rows),
                    teamMatcher = teamMatcher,
                    rounds = rounds,
                    races = races,
                    onOpenRace = onOpenRace,
                )
            }
        }
    }
}

/** Chip de filtro de la agenda CX, con la misma presentación que `CategoryChip`
 *  de Hoy en Carretera (cápsula y azul de marca al activar). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CxAgendaFilterChip(
    label: String,
    selected: Boolean,
    pinFilled: Boolean,
    pinOutline: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val primary = MaterialTheme.colorScheme.primary
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .background(if (selected) primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50))
            .semantics {
                role = Role.Button
                this.selected = selected
            }
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        when {
            pinFilled -> Icon(Icons.Filled.PushPin, contentDescription = null, tint = primary, modifier = Modifier.size(12.dp))
            pinOutline -> Icon(Icons.Outlined.PushPin, contentDescription = null, tint = primary.copy(alpha = 0.55f), modifier = Modifier.size(12.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CxRaceCard(race: CxRace, date: String, clock: Instant, round: CxRound?, showTournamentLink: Boolean, openTournament: () -> Unit, open: (String?) -> Unit) {
    val english = LocalConfiguration.current.locales[0].language != "es"
    val categories = CyclocrossLogic.categoriesOn(race, date)
    // Sin documento (Libro de Ruta o Mapa) o sin horarios —o cancelada—, la
    // ficha no está lista: card placeholder de Hoy en Carretera. El toque abre
    // el aviso de información en vez de navegar.
    val openRace = !race.isCancelled && CyclocrossLogic.raceOpen(race)
    var showPlaceholder by remember { mutableStateOf(false) }
    // Prueba sin ningún horario asociado: los indicadores pasan a badges.
    val badges = CxPresentation.usesCategoryBadges(race, categories, clock)
    CCCard(modifier = Modifier.fillMaxWidth(), accent = cxColor(CxPresentation.color(race)), accentAlpha = 0.04f, cornerRadius = 14, elevation = 0) {
        // Card entera clicable (patrón de Hoy): cualquier zona abre la ficha;
        // los botones internos (categorías, torneo) conservan su acción.
        Column(Modifier.fillMaxWidth().clickable(role = Role.Button) { if (openRace) open(null) else showPlaceholder = true }) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RaceCardIdentity(CxPresentation.logo(race), countryCode = race.countryCode, stackedFlag = true, title = {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        // Paridad web: nombre, badge de clase y hamburguesa de
                        // torneo en la primera línea. El nombre largo se corta
                        // con puntos suspensivos, sin dejar hueco antes del badge.
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(modifier = Modifier.weight(1f, fill = false), text = if (english) race.nameEn?.takeIf { it.isNotBlank() } ?: race.name else race.name, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            CategoryBadge(CxPresentation.raceClass(race.raceClass, english))
                            if (race.isCancelled) CxCancelledBadge()
                            // Hamburguesa compartida con Hoy: acceso directo al torneo.
                            if (showTournamentLink && race.tournament != null) RaceCompetitionButton(LocaleHolder.t("Ver torneo", "View series"), openTournament)
                        }
                        // Orden de metadatos: torneo · ronda · localización.
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            val venue = race.venue?.takeIf { it != race.name }
                            val tournament = if (showTournamentLink) race.tournament else null
                            val currentRound = round?.takeIf { it.total > 1 }
                            if (tournament != null) {
                                Text(LocaleHolder.t(tournament.name, tournament.nameEn ?: tournament.name), modifier = Modifier.weight(1f, fill = false), fontSize = 12.sp, lineHeight = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                if (currentRound != null || venue != null) MetaDot()
                            }
                            if (currentRound != null) {
                                Text("${currentRound.n}/${currentRound.total}", fontSize = 12.sp, lineHeight = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                if (venue != null) MetaDot()
                            }
                            if (venue != null) Text(venue, modifier = Modifier.weight(1f, fill = false), fontSize = 12.sp, lineHeight = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }, details = {
                    val onOpen: (String?) -> Unit = { if (openRace) open(it) else showPlaceholder = true }
                    // Prueba cancelada: solo la indicación; sin categorías.
                    if (!race.isCancelled) {
                        if (badges) {
                            FlowRow(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                for (category in categories) CxCategoryActions(race, category, clock,
                                    compact = true, onProgramme = { onOpen(category.category) }, onStartlist = { onOpen("inscritos-${category.category}") }, onResults = { onOpen("resultados-${category.category}") })
                            }
                        } else {
                            Row(Modifier.fillMaxWidth().padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                for (category in categories) CxCategoryActions(race, category, clock,
                                    expanded = true, modifier = Modifier.weight(1f), onProgramme = { onOpen(category.category) }, onStartlist = { onOpen("inscritos-${category.category}") }, onResults = { onOpen("resultados-${category.category}") })
                            }
                        }
                    }
                })
                if (openRace) Box(Modifier.align(Alignment.CenterVertically)) { RaceCardChevron() }
            }
        }
    }
    if (showPlaceholder) CxPlaceholderModal(race = race, onDismiss = { showPlaceholder = false })
}

@Composable
private fun MetaDot() {
    Text("·", fontSize = 12.sp, lineHeight = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
internal fun CxCategoryActions(race: CxRace, category: CxCategory, clock: Instant, selected: Boolean = false, compact: Boolean = false, expanded: Boolean = false, modifier: Modifier = Modifier, onProgramme: () -> Unit, onStartlist: () -> Unit, onResults: () -> Unit) {
    val phase = CxPresentation.categoryCardState(race, category, clock)
    val description = cxCategoryName(category.category)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (compact) {
            // Prueba sin horarios: badge plano que mantiene su acción por fase.
            RaceActionBadge(category.category, if (phase == CxCategoryCardState.RESULTS) onResults else onProgramme, selected = selected, neutral = true, modifier = Modifier.semantics { contentDescription = description })
        } else {
            // Con horarios: la caja solo lleva el código (mismo ancho, menos
            // alta); hora o copa se muestran debajo, fuera de la caja, con la
            // tipografía de salida/meta de Hoy en Carretera.
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    RaceActionTile(category.category, onProgramme,
                        selected = selected, fillWidth = expanded, boxOnly = true, neutral = true,
                        modifier = (if (expanded) Modifier.weight(1f) else Modifier).semantics { contentDescription = description })
                    if (phase == CxCategoryCardState.TIME && category.startlistImportedAt != null) RaceActionBadge(stringResource(R.string.cx_startlist), onStartlist, icon = Icons.Filled.Group, primaryAction = true)
                }
                CxCategorySchedule(phase, category, onResults)
            }
        }
        if (compact && phase == CxCategoryCardState.TIME && category.startlistImportedAt != null) RaceActionBadge(stringResource(R.string.cx_startlist), onStartlist, icon = Icons.Filled.Group, primaryAction = true)
    }
}

/** Hora, copa, espera o cancelación bajo la caja de categoría, fuera de ella. */
@Composable
private fun CxCategorySchedule(phase: CxCategoryCardState, category: CxCategory, onResults: () -> Unit) {
    when (phase) {
        // Copa compacta: misma altura contenida que el horario que acompaña,
        // sin el objetivo táctil de 48 dp del IconButton ni colchón extra.
        CxCategoryCardState.RESULTS -> ResultsTrophyAction(onClick = onResults, contentDescription = stringResource(R.string.cx_results))
        CxCategoryCardState.AWAITING -> WaitingResultsIndicator()
        CxCategoryCardState.CANCELLED -> CxCancelledBadge()
        CxCategoryCardState.TIME -> Text(category.startTimeUtc?.let(DateFormatting::formatTimeLocal) ?: "—",
            fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Badge rojo de "Cancelada", idéntico al de Hoy en Carretera. */
@Composable
private fun CxCancelledBadge() {
    Text(
        text = stringResource(R.string.today_subtitle_cancelled).uppercase(LocaleHolder.currentState),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier
            .background(MaterialTheme.colorScheme.error.copy(alpha = 0.12f), RoundedCornerShape(3))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** Estado vacío de mes, con la presentación de Hoy en Carretera. */
@Composable
private fun CxEmptyState(filtered: Boolean) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            imageVector = Icons.Outlined.EventBusy,
            contentDescription = null,
            modifier = Modifier.size(52.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f),
        )
        Text(
            text = stringResource(R.string.cx_empty_title),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = stringResource(if (filtered) R.string.cx_empty_filter_body else R.string.cx_empty_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
        )
    }
}
