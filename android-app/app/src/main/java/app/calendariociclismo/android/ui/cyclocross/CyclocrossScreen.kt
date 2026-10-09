package app.calendariociclismo.android.ui.cyclocross

import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.vector.ImageVector
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.neutralFill
import app.calendariociclismo.android.ui.theme.neutralFillPressed
import app.calendariociclismo.android.ui.month.CalendarFilterChip
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import app.calendariociclismo.android.ui.today.TodayHighlightsBanner
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
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
import app.calendariociclismo.android.util.NetworkMonitor
import androidx.compose.ui.platform.LocalContext
import app.calendariociclismo.android.util.rememberHaptics
import java.time.Instant
import java.time.LocalDate
import androidx.compose.foundation.lazy.LazyListState
import app.calendariociclismo.android.ui.today.DATE_BAR_RADIUS
import app.calendariociclismo.android.ui.today.DateBarWithControls
import app.calendariociclismo.android.ui.today.DayEmptyState
import app.calendariociclismo.android.ui.today.animateDayNavigation
import app.calendariociclismo.android.ui.today.daySwipeNavigation
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private sealed class AgendaRow(val key: String) {
    class Day(val date: String) : AgendaRow("day:$date")
    class Race(val race: CxRace, val date: String) : AgendaRow("race:$date:${race.id}")
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

private fun cxFilter(raw: String?): CxAgendaFilter = CxAgendaFilter.entries.firstOrNull { it.name == raw } ?: CxAgendaFilter.ALL

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
    // Cambio de día con la animación de Hoy en Carretera: la lista sale
    // deslizada, cambia el día y entra el nuevo desde el lado contrario.
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
    // Día elegido a mano: se recupera al volver a la pestaña. Sin navegación
    // manual, la apertura recalcula hoy o el siguiente día con carreras.
    var savedDay by rememberSaveable { mutableStateOf<String?>(null) }
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
    val pinnedFilter = cxFilter(cxPinnedRaw)
    val filter = state.filter
    var pendingDefault by remember { mutableStateOf<CxAgendaFilter?>(null) }
    // Página de torneo: todas sus pruebas de la temporada, agrupadas por día.
    val rows = if (tournamentId == null) emptyList() else buildList {
        for (month in CyclocrossLogic.months(season)) {
            val monthRaces = state.cache[month]?.data ?: continue
            val races = monthRaces.filter { it.tournamentId == tournamentId }
            val dates = races.flatMap { CyclocrossLogic.dates(it) }.distinct().sorted().filter { it.startsWith(month.toString()) }
            for (date in dates) {
                add(AgendaRow.Day(date))
                for (race in CyclocrossLogic.racesOn(races, date)) add(AgendaRow.Race(race, date))
            }
        }
    }
    val roundTotal = tournamentId?.let { id ->
        CxPresentation.tournamentRoundTotal(id, rows.filterIsInstance<AgendaRow.Race>().map { it.race }, state.rounds)
    } ?: 0
    LaunchedEffect(tournamentId) {
        if (tournamentId != null) state.open(selectedSeason ?: season)
        // El filtro fijado se lee antes de abrir para elegir el día de apertura.
        else state.open(season, savedDay, cxFilter(app.preferences.snapshotCxDefaultFilter()))
    }
    // Cambios posteriores del filtro fijado (diálogo de predeterminado).
    LaunchedEffect(tournamentId) {
        if (tournamentId == null) app.preferences.cxDefaultFilter.map(::cxFilter).distinctUntilChanged().drop(1)
            .collect { state.selectFilter(it) }
    }
    LaunchedEffect(season) { state.loadRounds() }
    LaunchedEffect(state.dateKey) { if (state.navigated) savedDay = state.dateKey }
    // Latido de Hoy (cada minuto y al volver a primer plano): auto-avance de
    // medianoche y, si se muestra hoy con mangas sin resultados ni
    // cancelación, nueva descarga silenciosa de la temporada.
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner, tournamentId) {
        if (tournamentId != null) return@LaunchedEffect
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                state.advanceIfNewLocalDay()
                state.refreshSilently()
                delay(60_000)
            }
        }
    }
    // Al recuperar la conectividad, recarga si hubo error o no hay datos,
    // como Hoy en carretera.
    val context = LocalContext.current
    LaunchedEffect(tournamentId) {
        if (tournamentId != null) return@LaunchedEffect
        var wasOffline = false
        NetworkMonitor.online(context).collect { online ->
            if (!online) {
                wasOffline = true
            } else if (wasOffline) {
                wasOffline = false
                if ((state.error != null || !state.loaded) && !state.busy) state.refresh()
            }
        }
    }
    // Cambio de día unificado (tira de fechas, flechas, «Hoy», botón de
    // siguiente día y deslizamiento) con la animación de Hoy en Carretera.
    fun changeDay(forward: Boolean, action: suspend () -> Unit) {
        haptic(Haptics.Event.Navigation)
        scope.launch { animateDayNavigation(contentOffsetX, contentWidthPx, forward, { isAnimatingNav = it }, action) }
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
            else CCCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    RaceCompetitionIdentity(tournamentName.orEmpty(), tournamentLogo, null, hideFlag = true, onBack = { nav.popBackStack() })
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (roundTotal > 1) {
                            Text(stringResource(R.string.cx_rounds_count, roundTotal), style = CCText.S13, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("·", style = CCText.S13, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(season, style = CCText.S13, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            // La agenda general es una vista de un día con la barra de fechas de
            // Hoy, acotada a la temporada (1 de agosto – último día de febrero).
            if (tournamentId == null) {
                val dateKey = state.dateKey
                val firstDay = state.firstDay
                val lastDay = state.lastDay
                val dateKeys = remember(dateKey, firstDay, lastDay) {
                    CyclocrossLogic.dayStrip(LocalDate.parse(dateKey), LocalDate.parse(firstDay), LocalDate.parse(lastDay), 2 * DATE_BAR_RADIUS + 1)
                        .map(LocalDate::toString)
                }
                DateBarWithControls(
                    selectedDateKey = dateKey,
                    isToday = dateKey == state.todayKey(),
                    dateKeys = dateKeys,
                    canGoPrevious = state.canGoPrevious,
                    canGoNext = state.canGoNext,
                    onSelect = { target -> changeDay(target > state.dateKey) { state.navigateTo(target) } },
                    onPrevious = { changeDay(false) { state.navigateToPreviousDay() } },
                    onToday = { changeDay(state.todayKey() >= state.dateKey) { state.navigateToToday() } },
                    onNext = { changeDay(true) { state.navigateToNextDay() } },
                )
            }
            // Filtro de la agenda, con la misma presentación y posición que Hoy
            // en Carretera: franja fija de chips bajo la barra de fechas.
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
                    // Pulsar el filtro activo abre el diálogo de filtro
                    // predeterminado, como en Mes y Temporada.
                    CalendarFilterChip(
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
                                state.selectFilter(option)
                            }
                        },
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
                        onOpenRace = { nav.navigate(Routes.cxRace(it.id, title = cxTitle(it))) },
                    )
                }
                return@Column
            }
            if (state.busy && !state.isRefreshing && (tournamentId != null || state.loaded)) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.error?.let { error ->
                Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(error, Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { scope.launch { state.retry() } }) { Text(stringResource(R.string.cx_retry)) }
                }
            }
            if (tournamentId == null) {
                CxDayAgenda(
                    state = state,
                    clock = clock,
                    contentOffsetX = { contentOffsetX.value },
                    onWidth = { contentWidthPx = it },
                    canNavigate = { forward -> !isAnimatingNav && (if (forward) state.canGoNext else state.canGoPrevious) },
                    onSwipe = { forward -> changeDay(forward) { if (forward) state.navigateToNextDay() else state.navigateToPreviousDay() } },
                    onNextRaceDay = { changeDay(true) { state.navigateToNextRaceDay() } },
                    openTournament = { race ->
                        race.tournament?.let { nav.navigate(Routes.cxTournament(it.id, race.seasonKey, if (locale.language != "es") it.nameEn ?: it.name else it.name, it.logoUrl)) }
                    },
                    openRace = { race, category -> nav.navigate(Routes.cxRace(race.id, category, cxTitle(race))) },
                    modifier = Modifier.weight(1f),
                )
                return@Column
            }
            // Torneo: pantalla de carga completa (sin perfil inferior) mientras
            // llega la primera tanda de carreras.
            if (state.busy && !state.isRefreshing && rows.isEmpty()) {
                RouteLoadingView(message = stringResource(R.string.loading), showProfile = false, modifier = Modifier.weight(1f), title = LocaleHolder.t("Ciclocross", "Cyclocross"))
            } else PullToRefreshBox(
                isRefreshing = state.isRefreshing,
                onRefresh = { scope.launch { state.refresh() } },
                modifier = Modifier.weight(1f),
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
                                // Fecha del día en gris, como en Resultados, Fichajes y Calendario.
                                is AgendaRow.Day -> Text(DateFormatting.formatDateLabel(first.date), style = CCText.S13, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = if (first.key != rows.firstOrNull()?.key) 6.dp else 0.dp).semantics { heading() })
                                is AgendaRow.Race -> CxRaceRow(group.filterIsInstance<AgendaRow.Race>(), columns, clock, state.rounds, showTournamentLink = false,
                                    openTournament = {}, openRace = { race, category -> nav.navigate(Routes.cxRace(race.id, category, cxTitle(race))) })
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

/** Fila de la rejilla: una tarjeta por columna; los huecos conservan su ancho. */
@Composable
private fun CxRaceRow(
    group: List<AgendaRow.Race>,
    columns: Int,
    clock: Instant,
    rounds: Map<String, CxRound>,
    showTournamentLink: Boolean,
    openTournament: (CxRace) -> Unit,
    openRace: (CxRace, String?) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        group.forEach { row ->
            Box(Modifier.weight(1f).fillMaxHeight()) {
                CxRaceCard(row.race, row.date, clock, round = rounds[row.race.id], showTournamentLink = showTournamentLink,
                    openTournament = { openTournament(row.race) }) { category -> openRace(row.race, category) }
            }
        }
        repeat(columns - group.size) { Spacer(Modifier.weight(1f)) }
    }
}

/**
 * Contenido del día de la agenda general: tarjetas CX del día en la rejilla
 * adaptable, sin cabecera de día (la indica la barra de fechas), con
 * deslizamiento lateral y pull-to-refresh como Hoy en carretera.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CxDayAgenda(
    state: CyclocrossAgendaState,
    clock: Instant,
    contentOffsetX: () -> Float,
    onWidth: (Float) -> Unit,
    canNavigate: (Boolean) -> Boolean,
    onSwipe: (Boolean) -> Unit,
    onNextRaceDay: () -> Unit,
    openTournament: (CxRace) -> Unit,
    openRace: (CxRace, String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    // El gesto se instala una vez; lee siempre las acciones vigentes.
    val currentCanNavigate by rememberUpdatedState(canNavigate)
    val currentOnSwipe by rememberUpdatedState(onSwipe)
    val dateKey = state.dateKey
    val races = state.races
    val dayRaces = CyclocrossLogic.racesOn(races, dateKey)
    val nextRaceDay = CyclocrossLogic.nextRaceDay(CyclocrossLogic.raceDays(races), dateKey)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .onSizeChanged { onWidth(it.width.toFloat()) }
            .graphicsLayer { translationX = contentOffsetX() }
            .clipToBounds()
            .daySwipeNavigation(key = Unit, canNavigate = { currentCanNavigate(it) }, onNavigate = { currentOnSwipe(it) }),
    ) {
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = { scope.launch { state.refresh() } },
            modifier = Modifier.fillMaxSize(),
        ) {
            when {
                !state.loaded && state.busy -> RouteLoadingView(
                    message = stringResource(R.string.loading),
                    showProfile = false,
                    title = LocaleHolder.t("Ciclocross", "Cyclocross"),
                )
                dayRaces.isEmpty() -> DayEmptyState(
                    title = stringResource(R.string.cx_empty_title),
                    body = stringResource(if (state.filter == CxAgendaFilter.ALL) R.string.cx_empty_body else R.string.cx_empty_filter_body),
                    nextLabel = stringResource(R.string.cx_empty_next_race),
                    nextRaceDate = nextRaceDay,
                    onNextRaceDay = onNextRaceDay,
                )
                else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                    val columns = AdaptiveLayoutPolicy.feedColumns(maxWidth.value, adaptiveInfo)
                    val layoutRows = remember(dayRaces, dateKey, columns) {
                        agendaLayoutRows(dayRaces.map { AgendaRow.Race(it, dateKey) }, columns)
                    }
                    // Cada día empieza arriba.
                    val dayList = remember(dateKey) { LazyListState() }
                    LazyColumn(modifier = Modifier.fillMaxSize(), state = dayList, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(layoutRows, key = { group -> group.joinToString("|") { it.key } }) { group ->
                            CxRaceRow(group.filterIsInstance<AgendaRow.Race>(), columns, clock, state.rounds, showTournamentLink = true,
                                openTournament = openTournament, openRace = openRace)
                        }
                    }
                }
            }
        }
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

// MARK: - Caja de categoría y enlaces

/**
 * Caja de categoría de la agenda (ME, WE, MJ…): gris neutro con texto
 * principal y radio de control; al pulsar, la onda neutra la oscurece
 * (`.cx-category-box` de `css/ciclocross.css`). Espejo de `CxCategoryBoxStyle`
 * de iOS.
 */
@Composable
internal fun CxCategoryBox(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    fillWidth: Boolean = false,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(CCRadius.Control),
        color = if (selected) neutralFillPressed else neutralFill,
        contentColor = MaterialTheme.colorScheme.onSurface,
        modifier = modifier
            .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier.widthIn(min = 40.dp))
            .height(CxCategoryBoxHeight)
            .semantics { this.selected = selected },
    ) {
        Box(Modifier.padding(horizontal = if (fillWidth) 5.dp else 8.dp), contentAlignment = Alignment.Center) {
            Text(label, style = CCText.S12, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** Etiqueta de enlace neutra (Dorsales, torneo): texto principal sobre el gris de las etiquetas. */
@Composable
internal fun CxLinkBadge(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(CCRadius.Control),
        color = neutralFill,
        contentColor = MaterialTheme.colorScheme.onSurface,
        modifier = modifier.height(24.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(12.dp))
            Text(label, style = CCText.S12, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CxRaceCard(race: CxRace, date: String, clock: Instant, round: CxRound?, showTournamentLink: Boolean, openTournament: () -> Unit, open: (String?) -> Unit) {
    val english = LocalConfiguration.current.locales[0].language != "es"
    val categories = CyclocrossLogic.categoriesOn(race, date)
    // Sin documento (Libro de Ruta o Mapa) o sin horarios, la ficha no está
    // lista: card placeholder de Hoy en Carretera. El toque abre el aviso de
    // información en vez de navegar.
    val openRace = CyclocrossLogic.raceOpen(race)
    var showPlaceholder by remember { mutableStateOf(false) }
    // Prueba sin ningún horario asociado: los indicadores pasan a badges.
    val badges = CxPresentation.usesCategoryBadges(race, categories, clock)
    CCCard(modifier = Modifier.fillMaxSize()) {
        // Card entera clicable (patrón de Hoy): cualquier zona abre la ficha;
        // los botones internos (categorías, torneo) conservan su acción.
        Column(Modifier.fillMaxSize().clickable(role = Role.Button) { if (openRace) open(null) else showPlaceholder = true }) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RaceCardIdentity(CxPresentation.logo(race), countryCode = race.countryCode, stackedFlag = true, title = {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        // Paridad web: nombre, badge de clase y hamburguesa de
                        // torneo en la primera línea. Una sola línea con puntos
                        // suspensivos para que todas las tarjetas midan igual.
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(modifier = Modifier.weight(1f, fill = false), text = if (english) race.nameEn?.takeIf { it.isNotBlank() } ?: race.name else race.name, style = CCText.S16, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            CategoryBadge(CxPresentation.raceClass(race.raceClass, english))
                            // Hamburguesa compartida con Hoy: acceso directo al torneo.
                            if (showTournamentLink && race.tournament != null) RaceCompetitionButton(LocaleHolder.t("Ver torneo", "View series"), openTournament)
                        }
                        val tournament = if (showTournamentLink) race.tournament else null
                        CxMetaLine(
                            tournament = tournament?.let { LocaleHolder.t(it.name, it.nameEn ?: it.name) },
                            round = CxPresentation.roundLabel(round),
                            venue = race.venue?.takeIf { it != race.name },
                        )
                    }
                }, details = {
                    val onOpen: (String?) -> Unit = { if (openRace) open(it) else showPlaceholder = true }
                    // Altura única en todas las tarjetas: la variante sin horarios
                    // reserva caja de categoría + fila de estado.
                    if (badges) {
                        FlowRow(Modifier.padding(top = 3.dp).heightIn(min = CxCategoryBoxHeight + CxStatusRowHeight), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            for (category in categories) CxCategoryActions(race, category, clock,
                                compact = true, onProgramme = { onOpen(category.category) }, onStartlist = { onOpen("inscritos-${category.category}") }, onResults = { onOpen("resultados-${category.category}") })
                        }
                    } else {
                        Row(Modifier.fillMaxWidth().padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            for (category in categories) CxCategoryActions(race, category, clock,
                                expanded = true, modifier = Modifier.weight(1f), onProgramme = { onOpen(category.category) }, onStartlist = { onOpen("inscritos-${category.category}") }, onResults = { onOpen("resultados-${category.category}") })
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
private fun MetaDot(modifier: Modifier = Modifier, style: TextStyle = CCText.S12) {
    Text("·", modifier = modifier, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/**
 * Línea secundaria de la tarjeta (torneo · ronda · sede) en una sola línea.
 * La ronda no se recorta; si falta espacio se recorta primero la sede (y se
 * omite cuando apenas cabe) y después el torneo, con puntos suspensivos.
 * Compartida con la pestaña Ciclocross de Resultados.
 */
@Composable
internal fun CxMetaLine(tournament: String?, round: String?, venue: String?, style: TextStyle = CCText.S12) {
    // Sin datos, la línea conserva su altura para no alterar la de la tarjeta.
    if (tournament == null && round == null && venue == null) { Text("", style = style); return }
    val color = MaterialTheme.colorScheme.onSurfaceVariant
    val parts = listOfNotNull(tournament?.let { "t" to it }, round?.let { "r" to it }, venue?.let { "v" to it })
    Layout(
        modifier = Modifier.fillMaxWidth(),
        content = {
            parts.forEachIndexed { index, (id, text) ->
                if (index > 0) MetaDot(Modifier.layoutId("d$id"), style)
                Text(text, modifier = Modifier.layoutId(id), style = style, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis, softWrap = false)
            }
        },
    ) { measurables, constraints ->
        val gap = 5.dp.roundToPx()
        val minVenue = 32.dp.roundToPx()
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val byId = measurables.associateBy { it.layoutId as String }
        val dots = parts.drop(1).associate { (id, _) -> id to byId.getValue("d$id").measure(loose) }
        val roundPlaceable = byId["r"]?.measure(loose)
        fun extra(id: String): Int = dots[id]?.let { it.width + 2 * gap } ?: 0
        val fixed = (roundPlaceable?.width ?: 0) + (if (round != null) extra("r") else 0)
        var available = (constraints.maxWidth - fixed).coerceAtLeast(0)
        val tournamentPlaceable = byId["t"]?.measure(loose.copy(maxWidth = available))
        available -= tournamentPlaceable?.width ?: 0
        val venueSpace = available - (if (venue != null) extra("v") else 0)
        val venuePlaceable = byId["v"]?.takeIf { venueSpace >= minVenue || (tournament == null && round == null) }
            ?.measure(loose.copy(maxWidth = venueSpace.coerceAtLeast(0)))
        val shown = listOfNotNull(
            tournamentPlaceable?.let { "t" to it },
            roundPlaceable?.let { "r" to it },
            venuePlaceable?.let { "v" to it },
        )
        val height = (shown.map { it.second.height } + dots.values.map { it.height }).maxOrNull() ?: 0
        layout(constraints.maxWidth, height) {
            var x = 0
            shown.forEachIndexed { index, (id, placeable) ->
                if (index > 0) dots[id]?.let { dot ->
                    x += gap
                    dot.placeRelative(x, (height - dot.height) / 2)
                    x += dot.width + gap
                }
                placeable.placeRelative(x, (height - placeable.height) / 2)
                x += placeable.width
            }
        }
    }
}

@Composable
internal fun CxCategoryActions(race: CxRace, category: CxCategory, clock: Instant, selected: Boolean = false, compact: Boolean = false, expanded: Boolean = false, modifier: Modifier = Modifier, onProgramme: () -> Unit, onStartlist: () -> Unit, onResults: () -> Unit) {
    val phase = CxPresentation.categoryCardState(race, category, clock)
    val description = cxCategoryName(category.category)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (compact) {
            // Prueba sin horarios: badge plano que mantiene su acción por fase.
            CxCategoryBox(category.category, if (phase == CxCategoryCardState.RESULTS) onResults else onProgramme, selected = selected, modifier = Modifier.semantics { contentDescription = description })
        } else {
            // Con horarios: la caja solo lleva el código (mismo ancho, menos
            // alta); hora o copa se muestran debajo, fuera de la caja, con la
            // tipografía de salida/meta de Hoy en Carretera.
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    CxCategoryBox(category.category, onProgramme,
                        selected = selected, fillWidth = expanded,
                        modifier = (if (expanded) Modifier.weight(1f) else Modifier).semantics { contentDescription = description })
                    if (phase == CxCategoryCardState.TIME && category.startlistImportedAt != null) CxLinkBadge(stringResource(R.string.cx_startlist), onStartlist, icon = Icons.Filled.Group)
                }
                CxCategorySchedule(phase, category, onResults)
            }
        }
        if (compact && phase == CxCategoryCardState.TIME && category.startlistImportedAt != null) CxLinkBadge(stringResource(R.string.cx_startlist), onStartlist, icon = Icons.Filled.Group)
    }
}

/** Altura de la caja de categoría (`.cx-category-box`). */
private val CxCategoryBoxHeight = 24.dp

/** Fila de estado bajo la caja: reserva siempre el objetivo táctil de la copa,
 *  de modo que hora, copa, espera y aspa no cambian la altura de la tarjeta. */
private val CxStatusRowHeight = 24.dp

/** Hora, copa, espera o cancelación bajo la caja de categoría, fuera de ella. */
@Composable
private fun CxCategorySchedule(phase: CxCategoryCardState, category: CxCategory, onResults: () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = CxStatusRowHeight), contentAlignment = Alignment.Center) {
    when (phase) {
        // Copa compacta: misma altura contenida que el horario que acompaña,
        // sin el objetivo táctil de 48 dp del IconButton ni colchón extra.
        CxCategoryCardState.RESULTS -> ResultsTrophyAction(onClick = onResults, contentDescription = stringResource(R.string.cx_results))
        CxCategoryCardState.AWAITING -> WaitingResultsIndicator()
        CxCategoryCardState.CANCELLED -> CxCancelledCross()
        CxCategoryCardState.TIME -> Text(category.startTimeUtc?.let(DateFormatting::formatTimeLocal) ?: "-",
            style = CCText.S16, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
    }
    }
}

/**
 * Aspa roja de una categoría cancelada: ocupa la mitad central del hueco, con
 * trazo grueso y extremos redondeados como la X del emblema de ciclocross, y
 * la altura del horario o de la copa.
 */
@Composable
private fun CxCancelledCross() {
    val color = MaterialTheme.colorScheme.error
    val description = stringResource(R.string.today_subtitle_cancelled)
    Canvas(Modifier.fillMaxWidth().height(24.dp).padding(vertical = 5.dp).semantics { contentDescription = description }) {
        val stroke = 4.dp.toPx()
        val left = size.width / 4
        val right = size.width - left
        drawLine(color, Offset(left, 0f), Offset(right, size.height), stroke, StrokeCap.Round)
        drawLine(color, Offset(right, 0f), Offset(left, size.height), stroke, StrokeCap.Round)
    }
}
