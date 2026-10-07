package app.calendariociclismo.android.ui.today

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import androidx.navigation.NavController
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CCHeaderBrand
import app.calendariociclismo.android.ui.components.CategoryBadge
import app.calendariociclismo.android.ui.components.RaceCompetitionButton
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.MiniElevationProfile
import app.calendariociclismo.android.ui.components.PlaceholderItem
import app.calendariociclismo.android.ui.components.PlaceholderModalOverlay
import app.calendariociclismo.android.ui.components.WaitingResultsIndicator
import app.calendariociclismo.android.ui.components.RaceActionBadge
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.StageTypeBadge
import app.calendariociclismo.android.ui.components.TVBadge
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.adaptive.AdaptiveWidthClass
import app.calendariociclismo.android.ui.adaptive.rememberAdaptiveLayoutInfo
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.Constants
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.NetworkMonitor
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.TodaySeason
import app.calendariociclismo.android.util.openExternalUrl
import app.calendariociclismo.android.util.rememberHaptics
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(navController: NavController) {
    val app = rememberApp()
    val haptic = rememberHaptics()
    val vm: TodayViewModel = viewModel(
        factory = TodayViewModelFactory(app.repository, app.preferences)
    )
    val scope = rememberCoroutineScope()
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    val state by vm.state.collectAsState()
    val data = remember(state) { vm.visibleData() }
    var placeholderItem by remember { mutableStateOf<PlaceholderItem?>(null) }
    // Jornadas visibles con resultados in-house (raceDayId → stageNumber): el
    // acceso de esas etapas navega a la pantalla nativa. Sin clasificación
    // publicada, Hoy mantiene «Esperando resultados» y no ofrece enlaces
    // provisionales a proveedores externos.
    var inhouseByDay by remember { mutableStateOf<Map<String, Int?>>(emptyMap()) }
    var pendingDefault by remember { mutableStateOf<Constants.CategoryFilter?>(null) }
    val pinnedFilter by app.preferences.defaultFilter.collectAsState(initial = Constants.CategoryFilter.ALL)
    // Semana de Campeonatos (22-28 jun): cuando la JORNADA MOSTRADA cae en la
    // ventana, "Hoy" impone Masculino por defecto, solo ofrece Todas/Pro/Masc/Fem
    // y no permite fijar otro predeterminado. Reactivo al día mostrado.
    val champWeekLock = ChampionshipsConfig.isChampWeekFilterLock(state.dateKey)
    // Cargar el mapa de jornadas con resultados in-house de las carreras visibles
    // (clave para redirigir el trofeo). Se recalcula al cambiar el día/filtro.
    // Agrupa por carrera y pasa sus jornadas para resolver el caso de un día/
    // general (la stage 'gc' no trae raceDayId). Clave = raceId + el raceDayId
    // de cada jornada, para que el efecto reaccione al cambiar de día.
    val visibleByRace = data?.raceDays
        ?.filter { it.race != null }
        ?.groupBy { it.race!!.id }
        ?: emptyMap()
    val visibleKey = visibleByRace.keys.sorted().joinToString(",") +
        "|" + (data?.raceDays?.joinToString(",") { it.id } ?: "")
    LaunchedEffect(visibleKey, state.refreshToken) {
        if (visibleByRace.isEmpty()) { inhouseByDay = emptyMap(); return@LaunchedEffect }
        val merged = HashMap<String, Int?>()
        for ((rid, days) in visibleByRace) {
            val pairs = days.map { it.raceDay.id to it.raceDay.stageNumber }
            val cancelled = days.filter { it.raceDay.isCancelledDay }.map { it.raceDay.id }.toSet()
            runCatching { app.repository.inhouseStagesForDays(rid, pairs, cancelled) }.getOrNull()?.let { merged.putAll(it) }
        }
        inhouseByDay = merged
    }

    // Al recuperar conectividad, recargar automáticamente si estamos mostrando
    // un error o no tenemos datos — equivalente al `onChange(of: network.isOnline)`
    // de iOS. El usuario no debería tener que cambiar de día para ver los datos
    // frescos tras recuperar la red.
    val context = LocalContext.current
    LaunchedEffect(Unit) {
        var wasOffline = false
        NetworkMonitor.online(context).collect { online ->
            if (!online) {
                wasOffline = true
            } else if (wasOffline) {
                wasOffline = false
                val s = vm.state.value
                val needsReload = s.error != null || s.data == null
                if (needsReload && !s.isLoading && !s.isRefreshing) {
                    vm.refresh()
                }
            }
        }
    }

    // Auto-avance de medianoche: el día por defecto es la fecha local del usuario.
    // Si deja la app abierta y cruza la medianoche local (latido de 60 s) o vuelve
    // a primer plano (ON_RESUME), pasa solo al día nuevo — pero SOLO si está viendo
    // "hoy" (la lógica de respetar la navegación manual vive en el ViewModel).
    var statusNow by remember { mutableStateOf(java.time.Instant.now()) }
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            statusNow = java.time.Instant.now()
            vm.advanceIfNewLocalDay()
            vm.refreshAutomatically()
            while (true) {
                delay(60_000)
                statusNow = java.time.Instant.now()
                vm.advanceIfNewLocalDay()
                vm.refreshAutomatically()
            }
        }
    }

    // Analytics con parámetros
    LaunchedEffect(state.category, state.sortMode) {
        app.analytics.logScreenView(
            "today",
            android.os.Bundle().apply {
                putString("category_filter", state.category.id)
                putString("sort_mode", state.sortMode.id)
            },
        )
    }

    // Slide animation state
    val contentOffsetX = remember { Animatable(0f) }
    var isAnimatingNav by remember { mutableStateOf(false) }
    var contentWidthPx by remember { mutableStateOf(0f) }

    val todayButtonLabel = stringResource(R.string.today_button_today)
    Box(modifier = Modifier.fillMaxSize()) {
    Scaffold { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CCHeaderBrand(
                    modifier = Modifier
                        .semantics { contentDescription = todayButtonLabel }
                        .clickable(role = Role.Button) {
                            haptic(Haptics.Event.Navigation)
                            val target = vm.currentDayKey()
                            val forward = target >= state.dateKey
                            scope.launch {
                                animateNavigation(contentOffsetX, contentWidthPx, forward, { isAnimatingNav = it }) {
                                    vm.navigateTo(target)
                                }
                            }
                        },
                )
                Spacer(Modifier.weight(1f))
                IconButton(
                    onClick = {
                        haptic(Haptics.Event.Navigation)
                        navController.navigate(Routes.SETTINGS) { launchSingleTop = true }
                    },
                    modifier = Modifier.size(44.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Settings,
                        contentDescription = LocaleHolder.t("Ajustes", "Settings"),
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
            TodayHighlightsBanner(navController = navController)

            // Las carreras de Campeonatos Nacionales (uciCategory='CN') se muestran
            // como cualquier otra carrera del día. La rejilla país×prueba sigue
            // accesible aparte, pero no sustituye ni oculta nada en Hoy.

            DateBarWithControls(
                selectedDateKey = state.dateKey,
                isToday = state.dateKey == vm.currentDayKey(),
                lastDateKey = TodaySeason.lastDay(),
                canGoNext = vm.canGoToNextDay(state.dateKey),
                onSelect = { newDate ->
                    haptic(Haptics.Event.Navigation)
                    val forward = newDate > state.dateKey
                    scope.launch {
                        animateNavigation(contentOffsetX, contentWidthPx, forward, { isAnimatingNav = it }) {
                            vm.navigateTo(newDate)
                        }
                    }
                },
                onPrevious = {
                    haptic(Haptics.Event.Navigation)
                    scope.launch {
                        animateNavigation(contentOffsetX, contentWidthPx, false, { isAnimatingNav = it }) {
                            vm.navigateToPreviousDay()
                        }
                    }
                },
                onToday = {
                    haptic(Haptics.Event.Navigation)
                    val target = vm.currentDayKey()
                    val forward = target >= state.dateKey
                    scope.launch {
                        animateNavigation(contentOffsetX, contentWidthPx, forward, { isAnimatingNav = it }) {
                            vm.navigateTo(target)
                        }
                    }
                },
                onNext = {
                    haptic(Haptics.Event.Navigation)
                    scope.launch {
                        animateNavigation(contentOffsetX, contentWidthPx, true, { isAnimatingNav = it }) {
                            vm.navigateToNextDay()
                        }
                    }
                },
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                CategoryChips(
                    modifier = Modifier.weight(1f),
                    current = state.category,
                    pinned = pinnedFilter,
                    champWeekLock = champWeekLock,
                    onPick = {
                        if (it == state.category) {
                            // En la semana de Campeonatos el fijado está inhibido:
                            // pulsar el chip activo no abre el diálogo de predeterminado.
                            if (!champWeekLock) {
                                haptic(Haptics.Event.PrimaryAction)
                                pendingDefault = it
                            }
                        } else {
                            haptic(Haptics.Event.Selection)
                            vm.setCategory(it)
                        }
                    },
                )
                VerticalDivider(
                    modifier = Modifier.height(22.dp),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
                SortMenu(
                    current = state.sortMode,
                    onPick = {
                        if (it != state.sortMode) haptic(Haptics.Event.Selection)
                        vm.setSortMode(it)
                    },
                )
            }
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .onSizeChanged { contentWidthPx = it.width.toFloat() }
                    .graphicsLayer { translationX = contentOffsetX.value }
                    .clipToBounds()
                    .pointerInput(Unit) {
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

                                // Último día de temporada: el gesto hacia delante no navega.
                                val blockedForward = totalX < 0 && !vm.canGoToNextDay(vm.state.value.dateKey)
                                if (isHorizontal && abs(totalX) > 80f && !isAnimatingNav && !blockedForward) {
                                    haptic(Haptics.Event.Navigation)
                                    val forward = totalX < 0
                                    scope.launch {
                                        animateNavigation(
                                            contentOffsetX, contentWidthPx, forward,
                                            { isAnimatingNav = it },
                                        ) {
                                            if (forward) vm.navigateToNextDay() else vm.navigateToPreviousDay()
                                        }
                                    }
                                }
                            }
                        }
                    },
            ) {
                PullToRefreshBox(
                    isRefreshing = state.isRefreshing,
                    onRefresh = { vm.refresh() },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    when {
                        state.isLoading && data == null -> RouteLoadingView(
                            message = stringResource(R.string.loading),
                            title = LocaleHolder.t("Carreras de hoy", "Today's races"),
                        )
                        state.error != null && data == null -> CenteredText(state.error?.takeIf { it.isNotEmpty() } ?: stringResource(R.string.startlist_error_unknown))
                        data == null || data.raceDays.isEmpty() -> EmptyState(
                            nextRaceDate = state.nextRaceDate,
                            onNextRaceDay = {
                                haptic(Haptics.Event.Navigation)
                                scope.launch {
                                    animateNavigation(
                                        contentOffsetX, contentWidthPx, true,
                                        { isAnimatingNav = it },
                                    ) { vm.navigateToNextRaceDay() }
                                }
                            },
                        )
                        else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                            val columns = AdaptiveLayoutPolicy.feedColumns(maxWidth.value, adaptiveInfo)
                            // Las destacadas solo cambian el orden: misma tarjeta y
                            // misma columna. Una tarjeta suelta conserva media anchura.
                            val rows = AdaptiveLayoutPolicy.rows(data.raceDays, columns)
                            val isPhone = adaptiveInfo.widthClass == AdaptiveWidthClass.Compact
                            val renderDay: @Composable (EnrichedRaceDay) -> Unit = { day ->
                                // In-house: si la jornada tiene clasificación propia, el
                                // acceso va a la pantalla nativa.
                                val inhouseStage = inhouseByDay[day.id]
                                val hasInhouse = inhouseByDay.containsKey(day.id)
                                // Revive/TV solo acompaña a Resultados: alcanzar
                                // la hora de meta sin clasificaciones no lo activa.
                                val reviveUrl = if (hasInhouse) RaceLogic.reviveUrl(day.broadcasts) else null
                                val raceState = RaceLogic.todayRaceState(
                                    day.raceDay,
                                    hasInhouseResults = hasInhouse,
                                    now = statusNow,
                                )
                                val isWaiting = raceState == RaceLogic.TodayRaceState.WAITING
                                val showsFinishTime = state.sortMode == TodayViewModel.SortMode.FINISH_TIME ||
                                    raceState == RaceLogic.TodayRaceState.RUNNING
                                val isFinalStage = day.race?.isStageRace == true &&
                                    !day.raceDay.isRestDay &&
                                    !day.raceDay.isCancelledDay &&
                                    day.raceDay.dateKey == day.race?.endDate
                                RaceCard(
                                    day = day,
                                    activeFilter = state.category,
                                    isFinalStage = isFinalStage,
                                    showsFinishTimeOnly = showsFinishTime,
                                    isWaitingForResults = isWaiting,
                                    isPhone = isPhone,
                                    now = statusNow,
                                    onShowResults = if (hasInhouse && day.race != null) { {
                                        haptic(Haptics.Event.PrimaryAction)
                                        navController.navigate(Routes.results(day.race!!.id, inhouseStage, suffix = day.raceDay.stageSuffix))
                                    } } else null,
                                    onRevive = reviveUrl?.let { url -> {
                                        haptic(Haptics.Event.PrimaryAction)
                                        openExternalUrl(context, url)
                                    } },
                                    onShowStartlist = if (day.race?.startlistImportedAt != null) { {
                                        haptic(Haptics.Event.PrimaryAction)
                                        navController.navigate(Routes.startlist(day.race!!.id))
                                    } } else null,
                                    onShowStartOrder = {
                                        haptic(Haptics.Event.PrimaryAction)
                                        navController.navigate(Routes.startOrder(day.raceDay.id))
                                    },
                                    onShowCompetition = if (day.race?.isStageRace == true && day.race?.startDate != day.race?.endDate) { {
                                        haptic(Haptics.Event.Navigation)
                                        navController.navigate(Routes.race(day.race!!.id))
                                    } } else null,
                                    onClick = {
                                        haptic(Haptics.Event.Navigation)
                                        val race = day.race
                                        when {
                                            day.isPlaceholder && race != null ->
                                                placeholderItem = PlaceholderItem(race, day.raceDay)
                                            race?.isCancelled == true ->
                                                placeholderItem = PlaceholderItem(race, day.raceDay)
                                            else -> navController.navigate(Routes.stage(day.id))
                                        }
                                    },
                                )
                            }
                            LazyColumn(
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                items(rows, key = { row -> row.items.joinToString("|") { it.id } }) { row ->
                                    if (columns == 1 || row.spansAllColumns) {
                                        renderDay(row.items.first())
                                    } else {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            verticalAlignment = Alignment.Top,
                                        ) {
                                            row.items.forEach { day ->
                                                Box(Modifier.weight(1f)) { renderDay(day) }
                                            }
                                            repeat(columns - row.items.size) { Spacer(Modifier.weight(1f)) }
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
    PlaceholderModalOverlay(
        item = placeholderItem,
        onDismiss = { placeholderItem = null },
    )
    pendingDefault?.let { filter ->
        val isPinned = filter == pinnedFilter && pinnedFilter != Constants.CategoryFilter.ALL
        val filterLabel = stringResource(filter.labelRes)
        AlertDialog(
            onDismissRequest = { pendingDefault = null },
            title = {
                Text(
                    stringResource(
                        if (isPinned) R.string.filter_dialog_remove_title
                        else R.string.filter_dialog_title
                    )
                )
            },
            text = {
                Text(
                    stringResource(
                        if (isPinned) R.string.filter_dialog_remove_message
                        else R.string.filter_dialog_set_message,
                        filterLabel,
                    )
                )
            },
            confirmButton = {
                if (isPinned) {
                    TextButton(onClick = { vm.clearDefaultFilter(); pendingDefault = null }) {
                        Text(stringResource(R.string.action_remove))
                    }
                } else {
                    TextButton(onClick = { vm.setDefaultFilter(filter); pendingDefault = null }) {
                        Text(stringResource(R.string.action_set))
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingDefault = null }) { Text(stringResource(R.string.action_cancel)) }
            },
        )
    }
    }
}

// ─── Navigation animation ─────────────────────────────────────────

/** Slides content out, performs [action], then slides new content in. */
private suspend fun animateNavigation(
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

// ─── DateBar con controles fusionados ───────────────────────────────

/**
 * Fila única situada bajo el cintillo: flecha anterior, carrusel de fechas y
 * flecha siguiente. Fuera de la fecha actual inserta «Hoy» antes de los siete días.
 */
@Composable
private fun DateBarWithControls(
    selectedDateKey: String,
    isToday: Boolean,
    lastDateKey: String?,
    canGoNext: Boolean,
    onSelect: (String) -> Unit,
    onPrevious: () -> Unit,
    onToday: () -> Unit,
    onNext: () -> Unit,
) {
    // Sin días posteriores al último día de temporada (TodaySeason).
    val dateKeys = remember(selectedDateKey, lastDateKey) {
        DateFormatting.dateRangeAround(selectedDateKey, offset = 45)
            .filter { lastDateKey == null || it <= lastDateKey }
    }
    val selectedIndex = remember(selectedDateKey, dateKeys) {
        dateKeys.indexOf(selectedDateKey).coerceAtLeast(0)
    }
    val density = LocalDensity.current
    val listState = rememberLazyListState()
    val animationsEnabled = android.animation.ValueAnimator.areAnimatorsEnabled()
    LaunchedEffect(selectedDateKey) {
        snapshotFlow { listState.layoutInfo.viewportSize.width }
            .first { it > 0 }
        val viewportWidth = listState.layoutInfo.viewportSize.width
        val itemHalfWidthPx = with(density) { 24.dp.roundToPx() }
        val offset = -(viewportWidth / 2 - itemHalfWidthPx)
        if (animationsEnabled) {
            listState.animateScrollToItem(index = selectedIndex, scrollOffset = offset)
        } else {
            listState.scrollToItem(index = selectedIndex, scrollOffset = offset)
        }
    }

    Row(
        modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onPrevious) {
            Icon(Icons.Filled.ChevronLeft, contentDescription = stringResource(R.string.today_prev_day_cd))
        }

        if (!isToday) {
            FilledTonalButton(
                onClick = onToday,
                modifier = Modifier.height(48.dp),
                shape = RoundedCornerShape(CCRadius.Surface),
                contentPadding = PaddingValues(horizontal = 10.dp),
            ) {
                Text(
                    text = stringResource(R.string.today_button_today),
                    style = CCText.S14,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.width(8.dp))
        }

        LazyRow(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(dateKeys, key = { it }) { dateKey ->
                DateBarItem(
                    dateKey = dateKey,
                    isSelected = dateKey == selectedDateKey,
                    onClick = { onSelect(dateKey) },
                )
            }
        }

        IconButton(onClick = onNext, enabled = canGoNext) {
            Icon(Icons.Filled.ChevronRight, contentDescription = stringResource(R.string.today_next_day_cd))
        }
    }
}

/**
 * Día de la tira: abreviatura del día (mayúscula inicial, sin punto) sobre el
 * número, un único formato en todos los anchos. Solo el día seleccionado lleva
 * el acento (selección); sin otros adornos. `Surface` seleccionable nativo.
 */
@Composable
private fun DateBarItem(
    dateKey: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val localDate = remember(dateKey) { DateFormatting.parseLocalDate(dateKey) }
    val day = localDate?.dayOfMonth?.toString() ?: "?"
    val weekday = remember(dateKey, LocaleHolder.current) {
        localDate?.let {
            val locale = LocaleHolder.current
            val short = DateTimeFormatter.ofPattern("EEE", locale)
                .format(it)
                .replace(".", "")
                .take(3)
            short.replaceFirstChar { c -> c.titlecase(locale) }
        }.orEmpty()
    }

    val primary = MaterialTheme.colorScheme.primary
    val foreground = if (isSelected) primary else MaterialTheme.colorScheme.onSurface
    val weekdayColor = if (isSelected) primary else MaterialTheme.colorScheme.onSurfaceVariant
    val cellLabel = "$weekday $day"

    Surface(
        selected = isSelected,
        onClick = onClick,
        modifier = Modifier
            .width(48.dp)
            .height(56.dp)
            .semantics { contentDescription = cellLabel },
        shape = RoundedCornerShape(CCRadius.Surface),
        color = if (isSelected) primary.copy(alpha = 0.15f) else Color.Transparent,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = weekday,
                style = CCText.S12,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                color = weekdayColor,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = day,
                style = CCText.S16,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                color = foreground,
            )
        }
    }
}

// ─── Category chips ────────────────────────────────────────────────

@Composable
private fun CategoryChips(
    modifier: Modifier = Modifier,
    current: Constants.CategoryFilter,
    pinned: Constants.CategoryFilter,
    champWeekLock: Boolean,
    onPick: (Constants.CategoryFilter) -> Unit,
) {
    // En la semana de Campeonatos (22-28 jun) solo Todas/Pro/Masc/Fem y sin
    // posibilidad de fijar un predeterminado (el pin queda inhibido).
    val chips = if (champWeekLock) ChampionshipsConfig.CHAMP_WEEK_HOY_FILTERS
                else Constants.CategoryFilter.entries.toList()
    LazyRow(
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(chips, key = { it.id }) { cat ->
            val hideAll = cat == Constants.CategoryFilter.ALL || current == Constants.CategoryFilter.ALL
            val isPinnedValid = pinned != Constants.CategoryFilter.ALL
            val pinFilled = !champWeekLock && !hideAll && isPinnedValid && pinned == cat
            val pinOutline = !champWeekLock && !hideAll && !pinFilled && current == cat
            CategoryChip(
                label = stringResource(cat.labelRes),
                selected = current == cat,
                pinFilled = pinFilled,
                pinOutline = pinOutline,
                onClick = { onPick(cat) },
            )
        }
    }
}

@Composable
private fun SortMenu(
    current: TodayViewModel.SortMode,
    onPick: (TodayViewModel.SortMode) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val label = stringResource(current.labelRes)
    val actionLabel = stringResource(R.string.today_sort_action)
    Box(modifier = Modifier.padding(end = 4.dp)) {
        TextButton(
            onClick = { expanded = true },
            modifier = Modifier.semantics { contentDescription = "$actionLabel: $label" },
            shape = RoundedCornerShape(CCRadius.Control),
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.SwapVert,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                text = label,
                style = CCText.S13,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            TodayViewModel.SortMode.entries.forEach { mode ->
                DropdownMenuItem(
                    text = { Text(stringResource(mode.labelRes)) },
                    onClick = {
                        onPick(mode)
                        expanded = false
                    },
                )
            }
        }
    }
}

/**
 * Chip de categoría (`FilterChip` de Material 3): activo con el azul al 15 % y
 * texto azul (selección); inactivo sobre la superficie de tarjeta con texto
 * secundario. Radio de control y sin borde. Pulsar el activo abre el diálogo
 * de filtro predeterminado.
 */
@Composable
private fun CategoryChip(
    label: String,
    selected: Boolean,
    pinFilled: Boolean,
    pinOutline: Boolean,
    onClick: () -> Unit,
) {
    val primary = MaterialTheme.colorScheme.primary
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(
                text = label,
                style = CCText.S13,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            )
        },
        trailingIcon = when {
            pinFilled -> { {
                Icon(Icons.Filled.PushPin, contentDescription = null, tint = primary, modifier = Modifier.size(12.dp))
            } }
            pinOutline -> { {
                Icon(Icons.Outlined.PushPin, contentDescription = null, tint = primary.copy(alpha = 0.55f), modifier = Modifier.size(12.dp))
            } }
            else -> null
        },
        shape = RoundedCornerShape(CCRadius.Control),
        colors = FilterChipDefaults.filterChipColors(
            containerColor = MaterialTheme.colorScheme.surface,
            labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
            selectedContainerColor = primary.copy(alpha = 0.15f),
            selectedLabelColor = primary,
        ),
        border = null,
    )
}

// ─── Race card ─────────────────────────────────────────────────────

/**
 * Tarjeta de carrera de Hoy (`buildCard` de js/app.js). Estructura común a
 * todos los anchos: columna de logotipo (con la bandera debajo); a su derecha,
 * el nombre (hasta dos líneas, nunca cortado) con la hora o los accesos de
 * jornada terminada arriba a la derecha, la línea de cifras debajo y las
 * etiquetas a todo el ancho a 6 dp de las cifras. El miniperfil ocupa la
 * banda inferior (36 dp en teléfono, 58 dp en pantallas anchas).
 *
 * Superficie neutra: el color de la carrera solo marca el avance de una
 * jornada en directo (perfil recorrido o, sin perfil, relleno del 8 % hasta el
 * porcentaje de avance). Las destacadas no tienen diseño propio.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RaceCard(
    day: EnrichedRaceDay,
    activeFilter: Constants.CategoryFilter,
    onClick: () -> Unit,
    onShowResults: (() -> Unit)? = null,
    onRevive: (() -> Unit)? = null,
    onShowStartlist: (() -> Unit)? = null,
    onShowStartOrder: (() -> Unit)? = null,
    onShowCompetition: (() -> Unit)? = null,
    isFinalStage: Boolean = false,
    showsFinishTimeOnly: Boolean = false,
    isWaitingForResults: Boolean = false,
    isPhone: Boolean = true,
    now: java.time.Instant = java.time.Instant.now(),
) {
    val race = day.race
    val rd = day.raceDay
    val raceColor = colorFromHex(race?.colorHex, fallback = MaterialTheme.colorScheme.primary)
    val liveTextUrl = day.assets.firstOrNull { it.type == "live_text" }?.url
    val isFinishedMode = onShowResults != null || onRevive != null
    val isTimeTrial = rd.primaryType == "itt" || rd.primaryType == "ttt"
    val isFemaleFilterActive = activeFilter == Constants.CategoryFilter.FEMALE ||
        activeFilter == Constants.CategoryFilter.WWT
    val displayName = race?.localizedName?.let {
        if (isFemaleFilterActive && race?.isFemale == true) RaceLogic.cleanFeminineDisplayName(it) else it
    } ?: stringResource(R.string.today_race_fallback)

    val app = rememberApp()
    // Mini-perfil + etiqueta de dorsales se liberaron al plan gratuito: visibles
    // siempre (gateados por featuresUnlocked, no por la suscripción).
    val featuresUnlocked = app.premium.featuresUnlocked
    val showsMiniProfile = featuresUnlocked && !rd.isRestDay && !rd.isCancelledDay &&
        rd.elevationProfile?.points?.let { it.size >= 2 } == true
    // Paridad con web: clásicas siempre; vueltas por etapas solo el primer día.
    val isFirstOrOnlyDay = race?.raceFormat != "stage_race" || rd.dateKey == race?.startDate
    // Crono de etapa única: el orden de salida sustituye a los dorsales.
    val isSingleTimeTrial = isTimeTrial && race?.raceFormat != "stage_race"
    val showsStartlistBadge = featuresUnlocked && !rd.isRestDay && !rd.isCancelledDay &&
        onShowStartlist != null && race?.startlistImportedAt != null && isFirstOrOnlyDay && !isSingleTimeTrial
    val startOrderAsset = day.assets.firstOrNull { it.type == "startOrder" && !it.url.isNullOrEmpty() }
    val showsStartOrderBadge = startOrderAsset != null && !rd.isCancelledDay && isTimeTrial
    // Etiquetas de enlace (TV, dorsales, orden de salida) solo mientras la
    // jornada no ha terminado ni espera resultados (paridad con la web).
    val showsLinkBadges = !isFinishedMode && !isWaitingForResults
    // Tipo: CRI/CRE y cronoescalada siempre; el resto solo sin miniperfil.
    // Etiqueta de tipo solo en contrarreloj (CRI, CRE y cronoescalada), como
    // la web: el resto de tipos no lleva etiqueta, haya o no miniperfil.
    val showsStageType = !rd.isCancelledDay &&
        (isTimeTrial || rd.secondaryType == "chrono_climb")
    // Relleno de avance: jornadas en directo sin miniperfil.
    val liveFill = if (!showsMiniProfile && !isFinishedMode && !isWaitingForResults &&
        !rd.isRestDay && !rd.isCancelledDay && !isTimeTrial
    ) {
        RaceLogic.profileProgress(rd, hasInhouseResults = false, now = now).takeIf { it > 0f && it < 1f }
    } else null
    val liveFillColor = raceColor.copy(alpha = 0.08f)
    val horizontalPadding = if (isPhone) 16.dp else 20.dp
    val verticalPadding = if (isPhone) 14.dp else 16.dp

    CCCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .drawBehind {
                    liveFill?.let { progress ->
                        drawRect(liveFillColor, size = Size(size.width * progress, size.height))
                    }
                }
                .clickable(role = Role.Button, onClick = onClick),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        start = horizontalPadding,
                        end = horizontalPadding,
                        top = verticalPadding,
                        bottom = if (showsMiniProfile) 12.dp else verticalPadding,
                    ),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                RaceIdentityColumn(
                    logoUrl = race?.logoUrl,
                    countryCode = if (race?.hideFlag != true || rd.countryCode != null) {
                        rd.countryCode ?: race?.countryCode
                    } else null,
                )
                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.Top,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            RaceNameRow(
                                name = displayName,
                                onShowCompetition = onShowCompetition,
                                showFemale = !isFemaleFilterActive && RaceLogic.shouldShowFemaleIndicator(race),
                            )
                            if (rd.isRestDay) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.Bedtime,
                                        contentDescription = null,
                                        modifier = Modifier.size(14.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Text(
                                        text = stringResource(R.string.today_subtitle_rest),
                                        style = CCText.S13,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            } else {
                                val metrics = buildSubtitle(day, isFinalStage, MaterialTheme.colorScheme.onSurface)
                                if (metrics.isNotEmpty()) {
                                    Text(
                                        text = metrics,
                                        style = CCText.S13,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                        // Esquina superior derecha: accesos de jornada terminada,
                        // espera de resultados u horario, alineados con la
                        // primera línea del nombre.
                        if (!rd.isRestDay && !rd.isCancelledDay) {
                            when {
                                isFinishedMode -> FinishedActions(onShowResults, onRevive, isPhone)
                                isWaitingForResults -> Box(
                                    Modifier.semantics {
                                        contentDescription = LocaleHolder.t("Esperando resultados", "Awaiting results")
                                    },
                                ) { WaitingResultsIndicator() }
                                else -> ScheduleColumn(rd, showsFinishTimeOnly, isTimeTrial, isPhone)
                            }
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    // Etiquetas a todo el ancho, en el orden de la web:
                    // Categoría → Cancelada → Tipo → TV → Dorsales → Orden de salida.
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        CategoryBadge(category = race?.uciCategory)
                        if (!rd.isRestDay) {
                            if (rd.isCancelledDay) {
                                CancelledDayBadge()
                            } else if (showsStageType) {
                                StageTypeBadge(
                                    primaryType = rd.primaryType,
                                    secondaryType = rd.secondaryType,
                                    countryCode = rd.countryCode ?: race?.countryCode,
                                )
                            }
                            if (showsLinkBadges) {
                                // Una jornada cancelada no se emite: ni TV ni Live
                                // texto (no hay nada que seguir). Paridad con la web.
                                if (!rd.isCancelledDay) {
                                    TVBadge(
                                        tvStatus = rd.tvStatus,
                                        broadcasts = day.broadcasts,
                                        neutralStartTimeUtc = rd.neutralStartTimeUtc,
                                        liveTextUrl = liveTextUrl,
                                    )
                                }
                                if (showsStartlistBadge && onShowStartlist != null) {
                                    StartlistBadge(
                                        onClick = onShowStartlist,
                                        isFemale = race?.isFemale == true,
                                        isProvisional = race?.startlistProvisional == true,
                                        iconOnly = isPhone,
                                    )
                                }
                                if (showsStartOrderBadge && onShowStartOrder != null) {
                                    val startOrderHaptic = rememberHaptics()
                                    StartOrderBadge(iconOnly = isPhone) {
                                        startOrderHaptic(Haptics.Event.PrimaryAction)
                                        onShowStartOrder()
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (showsMiniProfile) {
                rd.elevationProfile?.let { profile ->
                    MiniElevationProfile(
                        profile = profile,
                        tint = raceColor,
                        height = if (isPhone) 36.dp else 58.dp,
                        summits = rd.profileSummits ?: emptyList(),
                        waypoints = rd.profileWaypoints ?: emptyList(),
                        primaryType = rd.primaryType,
                        fixedProgress = RaceLogic.profileProgress(rd, hasInhouseResults = isFinishedMode, now = now),
                    )
                }
            }
        }
    }
}

/** Columna izquierda: logotipo en caja de lista con la bandera debajo; sin
 *  logotipo, solo la bandera (`cardLogoHtml` de la web). */
@Composable
private fun RaceIdentityColumn(logoUrl: String?, countryCode: String?) {
    val hasLogo = !logoUrl.isNullOrBlank()
    if (!hasLogo && countryCode == null) return
    Column(
        modifier = Modifier.width(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (hasLogo) RaceLogo(logoUrl, size = 32.dp)
        if (countryCode != null) CountryFlag(countryCode = countryCode)
    }
}

/** Nombre de la carrera: pasa a dos líneas si hace falta, nunca se corta. */
@Composable
private fun RaceNameRow(name: String, onShowCompetition: (() -> Unit)?, showFemale: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = name,
            modifier = Modifier.weight(1f, fill = false),
            style = CCText.S16,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        if (onShowCompetition != null) {
            RaceCompetitionButton(LocaleHolder.t("Ver competición", "View race"), onShowCompetition)
        }
        if (showFemale) {
            val femaleCd = stringResource(R.string.season_female_indicator_cd)
            Text(
                text = "♀",
                style = CCText.S13,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.semantics { contentDescription = femaleCd },
            )
        }
    }
}

/** Copa (resultados) y TV (Revive) juntas arriba a la derecha. */
@Composable
private fun FinishedActions(onShowResults: (() -> Unit)?, onRevive: (() -> Unit)?, isPhone: Boolean) {
    val glyph = if (isPhone) 20.dp else 22.dp
    // El botón nativo conserva su área táctil; se desplaza hacia arriba para que
    // el glifo quede a la altura de la primera línea del nombre.
    Row(modifier = Modifier.offset(x = 8.dp, y = (-8).dp)) {
        onShowResults?.let { action ->
            IconButton(onClick = action, modifier = Modifier.size(40.dp)) {
                Icon(
                    imageVector = Icons.Outlined.EmojiEvents,
                    contentDescription = stringResource(R.string.today_results_cd),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(glyph),
                )
            }
        }
        onRevive?.let { action ->
            IconButton(onClick = action, modifier = Modifier.size(40.dp)) {
                Icon(
                    imageVector = Icons.Outlined.Tv,
                    contentDescription = stringResource(R.string.today_revive_cd),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(glyph),
                )
            }
        }
    }
}

/** Rótulo (Salida/Meta/Inicio/Final) apilado sobre la hora. */
@Composable
private fun ScheduleColumn(rd: RaceDay, showsFinishTimeOnly: Boolean, isTimeTrial: Boolean, isPhone: Boolean) {
    val startStr = rd.neutralStartTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
    val finishStr = rd.estimatedFinishTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
    val startLabel = if (isTimeTrial) LocaleHolder.t("Inicio", "Start") else LocaleHolder.t("Salida", "Start")
    val finishLabel = if (isTimeTrial) LocaleHolder.t("Final", "End") else LocaleHolder.t("Meta", "Finish")
    val (label, value) = when {
        showsFinishTimeOnly && finishStr != null -> finishLabel to "~$finishStr"
        startStr != null -> startLabel to startStr
        finishStr != null -> finishLabel to "~$finishStr"
        else -> return
    }
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(
            text = label,
            style = CCText.S12,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        Text(
            text = value,
            style = if (isPhone) CCText.S14 else CCText.S16,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
        )
    }
}

/** Etiqueta «Dorsales»: abre la lista de inscritos sin pasar por la jornada. */
@Composable
private fun StartlistBadge(
    onClick: () -> Unit,
    isFemale: Boolean = false,
    isProvisional: Boolean = false,
    iconOnly: Boolean = false,
) {
    val label = when {
        isProvisional -> stringResource(R.string.stage_doc_startlist_provisional)
        isFemale -> stringResource(R.string.stage_doc_startlist_female)
        else -> stringResource(R.string.today_startlist_badge)
    }
    RaceActionBadge(label = label, icon = Icons.Filled.Group, primaryAction = true, iconOnly = iconOnly, onClick = onClick)
}

@Composable
private fun StartOrderBadge(iconOnly: Boolean = false, onClick: () -> Unit) {
    RaceActionBadge(label = stringResource(R.string.asset_start_order), icon = Icons.Filled.Timer, primaryAction = true, iconOnly = iconOnly, onClick = onClick)
}

/** Etiqueta de jornada cancelada, idéntica en geometría y color a la web. */
@Composable
private fun CancelledDayBadge() {
    Text(
        text = stringResource(R.string.today_subtitle_cancelled),
        style = CCText.S12,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier
            .background(MaterialTheme.colorScheme.error.copy(alpha = 0.12f), RoundedCornerShape(CCRadius.Control))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/**
 * Cifras "Etapa N · Distancia · Desnivel". Etapa y distancia en seminegrita y
 * en el color de texto principal (`.race-card__stage`, `.race-card__km`).
 */
private fun buildSubtitle(day: EnrichedRaceDay, isFinalStage: Boolean = false, strongColor: Color = Color.Unspecified): AnnotatedString {
    val race = day.race
    val rd = day.raceDay
    val bold = SpanStyle(fontWeight = FontWeight.SemiBold, color = strongColor)
    return buildAnnotatedString {
        var first = true
        fun appendSeparator() {
            if (!first) append(" · ")
            first = false
        }
        if (race != null && race.isStageRace && rd.stageLabel.isNotEmpty()) {
            appendSeparator()
            val label = if (isFinalStage) "${rd.stageLabel} (Final)" else rd.stageLabel
            withStyle(bold) { append(label) }
        }
        rd.distanceFormatted?.let { dist ->
            appendSeparator()
            withStyle(bold) { append(dist) }
        }
        rd.elevationGainFormatted?.let { elev ->
            appendSeparator()
            append(elev)
        }
    }
}

// ─── Estados auxiliares ────────────────────────────────────────────

@Composable
private fun CenteredText(text: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = text, color = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun EmptyState(
    nextRaceDate: String? = null,
    onNextRaceDay: () -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Outlined.EventBusy,
            contentDescription = null,
            modifier = Modifier.size(52.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.today_empty_title),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = stringResource(R.string.today_empty_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
        )
        if (nextRaceDate != null) {
            Spacer(Modifier.height(16.dp))
            TextButton(onClick = onNextRaceDay) {
                Text(stringResource(R.string.today_empty_next_race))
                Spacer(Modifier.width(4.dp))
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}
