package app.calendariociclismo.android.ui.today

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
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
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.runtime.DisposableEffect
import kotlinx.coroutines.delay
import androidx.navigation.NavController
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CategoryBadge
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.MiniElevationProfile
import app.calendariociclismo.android.ui.components.PlaceholderItem
import app.calendariociclismo.android.ui.components.PlaceholderModalOverlay
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.StageTypeBadge
import app.calendariociclismo.android.ui.components.TVBadge
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.Constants
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.NetworkMonitor
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.rememberHaptics
import java.time.format.DateTimeFormatter
import java.util.Locale
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
    val state by vm.state.collectAsState()
    val data = remember(state) { vm.visibleData() }
    var placeholderItem by remember { mutableStateOf<PlaceholderItem?>(null) }
    var resultsDialogItem by remember { mutableStateOf<ResultsDialogItem?>(null) }
    // Jornadas visibles con resultados in-house (raceDayId → stageNumber): el
    // trofeo de esas etapas navega a la pantalla nativa, no al modal FC/PCS.
    // Una query por carrera visible (en Hoy suelen ser pocas); diferido y no
    // bloqueante (sin red → vacío → modal clásico).
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
    LaunchedEffect(visibleKey) {
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
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) vm.advanceIfNewLocalDay()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            vm.advanceIfNewLocalDay()
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

    val infiniteTransition = rememberInfiniteTransition(label = "refresh")
    val refreshRotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(800, easing = LinearEasing)),
        label = "refreshRotation",
    )

    Box(modifier = Modifier.fillMaxSize()) {
    Scaffold { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            TodayHighlightsBanner(navController = navController)

            // Las carreras de Campeonatos Nacionales (uciCategory='CN') se muestran
            // como cualquier otra carrera del día. La rejilla país×prueba sigue
            // accesible aparte, pero no sustituye ni oculta nada en Hoy.

            DateBarWithControls(
                selectedDateKey = state.dateKey,
                isLoading = state.isLoading,
                refreshRotation = refreshRotation,
                onSelect = { newDate ->
                    haptic(Haptics.Event.Navigation)
                    val forward = newDate > state.dateKey
                    scope.launch {
                        animateNavigation(contentOffsetX, contentWidthPx, forward, { isAnimatingNav = it }) {
                            vm.setDate(newDate)
                        }
                    }
                },
                onPrevious = {
                    haptic(Haptics.Event.Navigation)
                    scope.launch {
                        animateNavigation(contentOffsetX, contentWidthPx, false, { isAnimatingNav = it }) {
                            vm.previousDay()
                        }
                    }
                },
                onNext = {
                    haptic(Haptics.Event.Navigation)
                    scope.launch {
                        animateNavigation(contentOffsetX, contentWidthPx, true, { isAnimatingNav = it }) {
                            vm.nextDay()
                        }
                    }
                },
                onRefresh = { vm.refresh() },
                onToday = {
                    haptic(Haptics.Event.Navigation)
                    val forward = DateFormatting.todayKey() >= state.dateKey
                    scope.launch {
                        animateNavigation(contentOffsetX, contentWidthPx, forward, { isAnimatingNav = it }) {
                            vm.setDate(DateFormatting.todayKey())
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
                    onLongPress = { haptic(Haptics.Event.PrimaryAction); pendingDefault = it },
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

                                if (isHorizontal && abs(totalX) > 80f && !isAnimatingNav) {
                                    haptic(Haptics.Event.Navigation)
                                    val forward = totalX < 0
                                    scope.launch {
                                        animateNavigation(
                                            contentOffsetX, contentWidthPx, forward,
                                            { isAnimatingNav = it },
                                        ) {
                                            if (forward) vm.nextDay() else vm.previousDay()
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
                                    ) { vm.jumpToNextRaceDay() }
                                }
                            },
                        )
                        else -> LazyColumn(
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            itemsIndexed(data.raceDays, key = { _, it -> it.id }) { index, day ->
                                // In-house: si la jornada tiene clasificación propia, el
                                // trofeo va a la pantalla nativa (no al modal FC/PCS).
                                val inhouseStage = inhouseByDay[day.id]
                                val hasInhouse = inhouseByDay.containsKey(day.id)
                                val showResults = hasInhouse || RaceLogic.shouldShowResults(day.raceDay, day.race)
                                val hideNoIds = !showResults && RaceLogic.noIdsAndPastDeadline(day.raceDay, day.race)
                                val reviveUrl = if (showResults || hideNoIds) RaceLogic.reviveUrl(day.broadcasts) else null
                                val isFinalStage = day.race?.isStageRace == true &&
                                    !day.raceDay.isRestDay &&
                                    !day.raceDay.isCancelledDay &&
                                    day.raceDay.dateKey == day.race?.endDate
                                RaceCard(
                                    day = day,
                                    activeFilter = state.category,
                                    isFinalStage = isFinalStage,
                                    onShowResults = if (showResults && day.race != null) { {
                                        haptic(Haptics.Event.PrimaryAction)
                                        if (hasInhouse) {
                                            navController.navigate(Routes.results(day.race!!.id, inhouseStage, suffix = day.raceDay.stageSuffix))
                                        } else {
                                            resultsDialogItem = ResultsDialogItem(day.race!!, day.raceDay)
                                        }
                                    } } else null,
                                    onRevive = reviveUrl?.let { url -> {
                                        haptic(Haptics.Event.PrimaryAction)
                                        runCatching {
                                            context.startActivity(
                                                Intent(Intent.ACTION_VIEW, url.toUri()).apply {
                                                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                                }
                                            )
                                        }
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
    resultsDialogItem?.let { item ->
        ResultsDialog(item = item, context = context, onDismiss = { resultsDialogItem = null })
    }
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
    action: () -> Unit,
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
 * Fila única que combina botón Hoy (animado), flechas de navegación,
 * carrusel de fechas y botón de refresco. Sustituye el TopAppBar + DateBar
 * separados para eliminar el espacio en blanco redundante.
 */
@Composable
private fun DateBarWithControls(
    selectedDateKey: String,
    isLoading: Boolean,
    refreshRotation: Float,
    onSelect: (String) -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onRefresh: () -> Unit,
    onToday: () -> Unit,
) {
    val dateKeys = remember(selectedDateKey) {
        DateFormatting.dateRangeAround(selectedDateKey, offset = 45)
    }
    val selectedIndex = remember(selectedDateKey, dateKeys) {
        dateKeys.indexOf(selectedDateKey).coerceAtLeast(0)
    }
    val density = LocalDensity.current
    val listState = rememberLazyListState()
    LaunchedEffect(selectedDateKey) {
        snapshotFlow { listState.layoutInfo.viewportSize.width }
            .first { it > 0 }
        val viewportWidth = listState.layoutInfo.viewportSize.width
        val itemHalfWidthPx = with(density) { 24.dp.roundToPx() }
        listState.animateScrollToItem(
            index = selectedIndex,
            scrollOffset = -(viewportWidth / 2 - itemHalfWidthPx),
        )
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AnimatedVisibility(
            visible = selectedDateKey != DateFormatting.todayKey(),
            enter = expandHorizontally(),
            exit = shrinkHorizontally(),
        ) {
            TextButton(
                onClick = onToday,
                contentPadding = PaddingValues(horizontal = 8.dp),
            ) {
                Text(stringResource(R.string.today_button_today), style = MaterialTheme.typography.labelLarge)
            }
        }

        IconButton(onClick = onPrevious) {
            Icon(Icons.Filled.ChevronLeft, contentDescription = stringResource(R.string.today_prev_day_cd))
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

        IconButton(onClick = onNext) {
            Icon(Icons.Filled.ChevronRight, contentDescription = stringResource(R.string.today_next_day_cd))
        }

        IconButton(onClick = onRefresh) {
            Icon(
                Icons.Filled.Refresh,
                contentDescription = stringResource(R.string.today_refresh_cd),
                modifier = Modifier.rotate(if (isLoading) refreshRotation else 0f),
            )
        }
    }
}

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
            DateTimeFormatter.ofPattern("EEE", locale)
                .format(it)
                .take(3)
                .uppercase(locale)
        }.orEmpty()
    }

    // Día seleccionado con el mismo lenguaje suave que los chips y el cintillo:
    // fondo azul de marca al 15% + texto azul, en vez del azul sólido opaco
    // previo (que era lo más "duro" de la pantalla).
    val primary = MaterialTheme.colorScheme.primary
    val background = if (isSelected) primary.copy(alpha = 0.15f) else Color.Transparent
    val foreground = if (isSelected) primary else MaterialTheme.colorScheme.onSurface
    val weekdayColor = if (isSelected) primary else MaterialTheme.colorScheme.onSurfaceVariant
    val cellLabel = "$weekday $day"

    Column(
        modifier = Modifier
            .width(48.dp)
            .height(56.dp)
            .background(background, RoundedCornerShape(24.dp))
            .semantics {
                this.role = Role.Button
                this.selected = isSelected
                this.contentDescription = cellLabel
            }
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = weekday,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            color = weekdayColor,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = day,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
            color = foreground,
        )
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
    onLongPress: (Constants.CategoryFilter) -> Unit,
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
                onLongClick = { if (!champWeekLock) onLongPress(cat) },
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
    Box(modifier = Modifier.padding(end = 12.dp)) {
        Row(
            modifier = Modifier
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50))
                .semantics {
                    role = Role.Button
                    contentDescription = "$actionLabel: $label"
                }
                .clickable { expanded = true }
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.SwapVert,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CategoryChip(
    label: String,
    selected: Boolean,
    pinFilled: Boolean,
    pinOutline: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val primary = MaterialTheme.colorScheme.primary
    val background = if (selected) primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant
    val foreground = if (selected) primary else MaterialTheme.colorScheme.onSurfaceVariant

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .background(background, RoundedCornerShape(50))
            .semantics {
                this.role = Role.Button
                this.selected = selected
            }
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = foreground,
        )
        when {
            pinFilled -> Icon(
                imageVector = Icons.Filled.PushPin,
                contentDescription = null,
                tint = primary,
                modifier = Modifier.size(12.dp),
            )
            pinOutline -> Icon(
                imageVector = Icons.Outlined.PushPin,
                contentDescription = null,
                tint = primary.copy(alpha = 0.55f),
                modifier = Modifier.size(12.dp),
            )
        }
    }
}

// ─── Race card ─────────────────────────────────────────────────────

data class ResultsDialogItem(val race: Race, val raceDay: RaceDay)

/** Altura de la franja del mini-perfil (a sangre, al fondo de la tarjeta):
 *  mayor en montaña para exacerbar las diferencias de perfil; algo más en
 *  cotas, sinuosas y clásicas de pavé/sterrato (desnivel a baja altitud que
 *  sin altura extra queda aplastado). Algo más altas que el sparkline inline
 *  previo, ahora que ocupan todo el ancho de la tarjeta. */
private fun miniProfileBandHeight(primaryType: String?) = when (primaryType) {
    "high_mountain", "summit_finish", "chrono_climb" -> 54.dp
    "medium_mountain" -> 46.dp
    "cotas", "uphill_finish", "rolling", "cobbles", "sterrato" -> 40.dp
    else -> 34.dp
}

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
) {
    val race = day.race
    val stripe = colorFromHex(race?.colorHex, fallback = MaterialTheme.colorScheme.outlineVariant)
    val rd = day.raceDay
    val liveTextUrl = day.assets.firstOrNull { it.type == "live_text" }?.url
    val isFinishedMode = onShowResults != null || onRevive != null
    val isFemaleFilterActive = activeFilter == Constants.CategoryFilter.FEMALE ||
        activeFilter == Constants.CategoryFilter.WWT
    val displayName = race?.localizedName?.let {
        if (isFemaleFilterActive && race?.isFemale == true) RaceLogic.cleanFeminineDisplayName(it) else it
    } ?: stringResource(R.string.today_race_fallback)

    val cancelled = race?.isCancelled == true || rd.isCancelledDay
    val app = rememberApp()
    // Mini-perfil + badge inscritos se liberaron al plan gratuito: visibles
    // siempre (gateados por featuresUnlocked, no por la suscripción).
    val featuresUnlocked = app.premium.featuresUnlocked
    val showsMiniProfile = featuresUnlocked && !rd.isRestDay && !rd.isCancelledDay &&
        rd.elevationProfile?.points?.let { it.size >= 2 } == true
    // Paridad con web: clásicas siempre; vueltas por etapas solo el primer día.
    val isFirstOrOnlyDay = race?.raceFormat != "stage_race" || rd.dateKey == race?.startDate
    val showsStartlistBadge = featuresUnlocked && !rd.isRestDay && !rd.isCancelledDay &&
        onShowStartlist != null && race?.startlistImportedAt != null && isFirstOrOnlyDay
    val startOrderAsset = day.assets.firstOrNull { it.type == "startOrder" && !it.url.isNullOrEmpty() }
    val showsStartOrderBadge = startOrderAsset != null && !rd.isCancelledDay &&
        (rd.primaryType == "itt" || rd.primaryType == "ttt")

    // Tarjeta canónica (CCCard) con tinte de marca por carrera — paridad con el
    // cintillo "Hoy". El contenido es la misma fila logo + textos + columna
    // derecha que antes, pero ahora vive sobre la superficie elevada compartida.
    CCCard(
        accent = race?.colorHex?.let { colorFromHex(it, fallback = MaterialTheme.colorScheme.outlineVariant) },
        // Tinte más tenue que el default del cintillo: en una lista con muchas
        // carreras de colores distintos, el 4% (planteamiento original) ordena
        // mejor que el 7%.
        accentAlpha = 0.04f,
        modifier = Modifier.fillMaxWidth(),
    ) {
      Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick),
      ) {
      Row(
        modifier = Modifier
            .fillMaxWidth()
            // El contenido cede el borde inferior a la franja de perfil cuando
            // ésta se muestra (llega de lado a lado de la tarjeta).
            .padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = if (showsMiniProfile) 8.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RaceLogo(url = race?.logoUrl, size = 36.dp)

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            // Nombre + bandera
            Row(
                modifier = Modifier.height(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (race?.hideFlag != true || rd.countryCode != null) {
                    CountryFlag(countryCode = rd.countryCode ?: race?.countryCode)
                }
                // Idéntico al título del cintillo: Medium 14/16. Antes 15/18,
                // que se percibía un punto más grande que el cintillo pese a
                // compartir peso y familia.
                Text(
                    text = displayName,
                    // El botón de competición conserva sus 16 dp incluso cuando
                    // el título agota el ancho disponible.
                    modifier = Modifier.weight(1f, fill = false),
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    lineHeight = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (onShowCompetition != null) {
                    // IconButton impone un mínimo interactivo de 48 dp. Este
                    // control visual debe medir exactamente 16 dp para mantener
                    // la densidad de la fila y la paridad con iOS.
                    Box(
                        modifier = Modifier
                            .size(16.dp)
                            .background(
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                                RoundedCornerShape(3.dp),
                            )
                            .clickable(role = Role.Button, onClick = onShowCompetition),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Menu,
                            contentDescription = LocaleHolder.t("Ver competición", "View race"),
                            modifier = Modifier.size(9.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
                if (!isFemaleFilterActive && RaceLogic.shouldShowFemaleIndicator(race)) {
                    val femaleCd = stringResource(R.string.season_female_indicator_cd)
                    Text(
                        text = "♀",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.tertiary,
                        modifier = Modifier.semantics { contentDescription = femaleCd },
                    )
                }
            }

            if (rd.isRestDay) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Bedtime,
                        contentDescription = null,
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = stringResource(R.string.today_subtitle_rest),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                val subtitle = buildSubtitle(day, isFinalStage)
                if (subtitle.isNotEmpty()) {
                    // Mismo registro que el subtítulo del cintillo (Normal 12/14)
                    // en lugar de labelSmall (Medium 11), que pesaba más. Las
                    // partes en negrita (etapa, distancia) conservan su SpanStyle
                    // SemiBold definido en buildSubtitle; route y desnivel quedan
                    // en Normal, como el subtítulo del cintillo.
                    Text(
                        text = subtitle,
                        fontWeight = FontWeight.Normal,
                        fontSize = 12.sp,
                        lineHeight = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (isFinishedMode) {
                    // En modo terminado solo categoría (tipo + TV ocultos)
                    CategoryBadge(category = race?.uciCategory)
                } else {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        CategoryBadge(category = race?.uciCategory)
                        if (rd.isCancelledDay) {
                            CancelledDayBadge()
                        } else if (!showsMiniProfile || rd.primaryType == "itt" || rd.primaryType == "ttt") {
                            // Cuando hay mini-perfil, la silueta de elevación ya
                            // comunica el carácter de la etapa; omitir el badge
                            // de tipo (primary/secondary) — paridad con iOS.
                            // Excepción: CRI/CRE siempre muestran el badge (la silueta
                            // no comunica que es contrarreloj).
                            StageTypeBadge(
                                primaryType = rd.primaryType,
                                secondaryType = rd.secondaryType,
                                countryCode = rd.countryCode ?: race?.countryCode,
                            )
                        }
                        // Una jornada cancelada no se emite: ni TV ni Live Texto
                        // (no hay nada que seguir). Paridad con la web.
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
                            )
                        }
                        if (showsStartOrderBadge && onShowStartOrder != null) {
                            val startOrderHaptic = rememberHaptics()
                            StartOrderBadge {
                                startOrderHaptic(Haptics.Event.PrimaryAction)
                                onShowStartOrder()
                            }
                        }
                    }
                }
                // El mini-perfil ya no va aquí: se renderiza como franja a
                // sangre al fondo de la tarjeta (ver más abajo).
            }
        }

        // Columna derecha: tiempos o iconos de resultados/revive.
        // Cancelada → sin horario: la etapa no se corre (paridad con la web).
        if (!rd.isRestDay && !rd.isCancelledDay) {
            if (isFinishedMode) {
                Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                    onShowResults?.let { action ->
                        IconButton(onClick = action) {
                            Icon(
                                imageVector = Icons.Outlined.EmojiEvents,
                                contentDescription = stringResource(R.string.today_results_cd),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                    }
                    onRevive?.let { action ->
                        IconButton(onClick = action) {
                            Icon(
                                imageVector = Icons.Outlined.Tv,
                                contentDescription = stringResource(R.string.today_revive_cd),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                    }
                }
            } else {
                val startStr = rd.neutralStartTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
                val finishStr = rd.estimatedFinishTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
                if (startStr != null || finishStr != null) {
                    Column(horizontalAlignment = Alignment.End) {
                        if (startStr != null) {
                            Text(
                                text = startStr,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (finishStr != null) {
                                Text(
                                    text = "↓",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.clearAndSetSemantics { },
                                )
                                Text(
                                    text = finishStr,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        } else if (finishStr != null) {
                            Text(
                                text = finishStr,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
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
                  tint = stripe,
                  height = miniProfileBandHeight(rd.primaryType),
                  summits = rd.profileSummits ?: emptyList(),
                  waypoints = rd.profileWaypoints ?: emptyList(),
                  primaryType = rd.primaryType,
                  startTimeMs = rd.neutralStartTimeUtc?.let { DateFormatting.parseIso(it)?.toEpochMilli() },
                    endTimeMs = rd.estimatedFinishTimeUtc?.let { DateFormatting.parseIso(it)?.toEpochMilli() },
                    isTimeTrial = rd.primaryType == "itt" || rd.primaryType == "ttt",
                    forceCompleted = isFinishedMode,
                )
          }
      }
      }
    }
}

/**
 * Badge tappable que abre directamente la lista de inscritos sin pasar
 * por el detalle de jornada. Premium en Fase 6 — abierto en Fases 1-5.
 */
@Composable
private fun StartlistBadge(
    onClick: () -> Unit,
    isFemale: Boolean = false,
    isProvisional: Boolean = false,
) {
    val label = when {
        isProvisional -> stringResource(R.string.stage_doc_startlist_provisional)
        isFemale -> stringResource(R.string.stage_doc_startlist_female)
        else -> stringResource(R.string.today_startlist_badge)
    }
    Row(
        modifier = Modifier
            .clickable(role = Role.Button, onClick = onClick)
            .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(3))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon(
            imageVector = Icons.Filled.Group,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.size(11.dp),
        )
        Text(
            text = label.uppercase(LocaleHolder.currentState),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}

@Composable
private fun StartOrderBadge(onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .clickable(role = Role.Button, onClick = onClick)
            .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(3))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon(
            imageVector = Icons.Filled.Timer,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.size(11.dp),
        )
        Text(
            text = stringResource(R.string.asset_start_order).uppercase(LocaleHolder.currentState),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}

/** Badge de jornada cancelada, idéntico en geometría y color al de la web. */
@Composable
private fun CancelledDayBadge() {
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

// ─── Results dialog ────────────────────────────────────────────────

// `internal` para reutilizarlo desde la vista de competición (RaceScreen).
@Composable
internal fun ResultsDialog(
    item: ResultsDialogItem,
    context: android.content.Context,
    onDismiss: () -> Unit,
) {
    val race = item.race
    val rd = item.raceDay
    val fcUrl = RaceLogic.buildFcUrl(race, rd.stageNumber)
    val pcsUrl = RaceLogic.buildPcsUrl(race, rd.stageNumber, rd.stageSuffix)

    val title = if (race.isOneDay) {
        stringResource(R.string.today_results_title)
    } else {
        stringResource(R.string.today_results_title_with_stage, rd.stageLabel)
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = race.localizedName,
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (fcUrl != null) {
                    ResultsLinkButton(label = "FirstCycling", url = fcUrl, context = context)
                }
                if (pcsUrl != null) {
                    ResultsLinkButton(label = "ProCyclingStats", url = pcsUrl, context = context)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
    )
}

@Composable
private fun ResultsLinkButton(label: String, url: String, context: android.content.Context) {
    FilledTonalButton(
        onClick = {
            runCatching {
                CustomTabsIntent.Builder().setShowTitle(true).build()
                    .launchUrl(context, url.toUri())
            }
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(label)
    }
}

/**
 * Subtítulo "Etapa N · Distancia · Desnivel". Etapa y distancia van en negrita.
 */
private fun buildSubtitle(day: EnrichedRaceDay, isFinalStage: Boolean = false): AnnotatedString {
    val race = day.race
    val rd = day.raceDay
    val bold = SpanStyle(fontWeight = FontWeight.SemiBold)
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
