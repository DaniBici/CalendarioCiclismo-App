package app.calendariociclismo.android.ui.month

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
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
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CategoryBadge
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.PlaceholderItem
import app.calendariociclismo.android.ui.components.PlaceholderModalOverlay
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.Constants
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun MonthScreen(
    navController: NavController,
    /** Toggle Mes↔Temporada de la pestaña Calendario (apps 3.1). No-null cuando
     *  la pantalla vive dentro de CalendarScreen → añade la action de cambio. */
    onSwitchView: (() -> Unit)? = null,
) {
    val app = rememberApp()
    val haptic = rememberHaptics()
    val scope = rememberCoroutineScope()
    var year by remember { mutableStateOf(LocalDate.now().year) }
    var category by remember { mutableStateOf(Constants.CategoryFilter.ALL) }
    var placeholderItem by remember { mutableStateOf<PlaceholderItem?>(null) }
    var pendingDefault by remember { mutableStateOf<Constants.CategoryFilter?>(null) }
    var yearMenuOpen by remember { mutableStateOf(false) }
    var scrollToTodayTrigger by remember { mutableStateOf(0) }
    var isLoading by remember { mutableStateOf(true) }

    // Default filter (synced across tabs)
    val defaultFilterPref by app.preferences.defaultFilter.collectAsState(initial = Constants.CategoryFilter.ALL)
    LaunchedEffect(defaultFilterPref) { category = defaultFilterPref }

    // Analytics con parámetros
    LaunchedEffect(year, category) {
        app.analytics.logScreenView(
            "month",
            android.os.Bundle().apply {
                putString("year", year.toString())
                putString("category_filter", category.id)
            },
        )
    }

    // Year-level data from Room
    val yearStart = "%04d-01-01".format(year)
    val yearEnd = "%04d-12-31".format(year)
    val allDaysRaw by app.repository
        .observeRaceDaysByRange(yearStart, yearEnd)
        .collectAsState(initial = emptyList())
    val allRaces by app.repository.observeAllRaces().collectAsState(initial = emptyList())

    val raceMap = remember(allRaces) { allRaces.associateBy { it.id } }

    // Generate placeholders for races without published race_days (year-level, category-agnostic)
    val allDaysWithPlaceholders = remember(allDaysRaw, allRaces, year) {
        val coveredIds = allDaysRaw.mapNotNull { it.raceId }.toSet()
        val placeholders = mutableListOf<RaceDay>()
        val yStart = "%04d-01-01".format(year)
        val yEnd = "%04d-12-31".format(year)
        for (race in allRaces) {
            if (race.isCancelled) continue
            if (coveredIds.contains(race.id)) continue
            val raceStart = race.startDate ?: continue
            val raceEnd = race.endDate ?: continue
            if (raceEnd < yStart || raceStart > yEnd) continue
            val overlapStart = maxOf(raceStart, yStart)
            val overlapEnd = minOf(raceEnd, yEnd)
            var cursor = DateFormatting.parseLocalDate(overlapStart) ?: continue
            val end = DateFormatting.parseLocalDate(overlapEnd) ?: continue
            while (!cursor.isAfter(end)) {
                val dk = cursor.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))
                if (RaceLogic.isRaceDay(race, dk)) {
                    placeholders.add(
                        RaceDay(
                            id = "ph-${race.id}-$dk",
                            raceId = race.id,
                            dateKey = dk,
                            stageNumber = RaceLogic.theoreticalStageNumber(race, dk),
                            editorialStatus = "placeholder",
                        )
                    )
                }
                cursor = cursor.plusDays(1)
            }
        }
        allDaysRaw + placeholders
    }

    // Available years for picker
    val availableYears = remember {
        val current = LocalDate.now().year
        (2026..maxOf(2026, current + 1)).reversed().toList()
    }

    // Pager: 12 pages (one per month), starting at current month
    val pagerState = rememberPagerState(
        initialPage = LocalDate.now().monthValue - 1,
        pageCount = { 12 },
    )

    // Haptic on swipe between months
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.currentPage }
            .drop(1)
            .collect { haptic(Haptics.Event.Navigation) }
    }

    // When year changes: refresh data + scroll pager to appropriate month
    LaunchedEffect(year) {
        val target = if (year == LocalDate.now().year) LocalDate.now().monthValue - 1 else 0
        pagerState.scrollToPage(target)
        isLoading = true
        try {
            runCatching { app.repository.refreshRange("%04d-01-01".format(year), "%04d-12-31".format(year)) }
            runCatching { app.repository.refreshRacesYear(year) }
        } finally {
            isLoading = false
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            text = stringResource(R.string.month_title),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    },
                    actions = {
                        TextButton(onClick = {
                            haptic(Haptics.Event.Navigation)
                            val now = LocalDate.now()
                            if (now.year != year) {
                                year = now.year
                            } else {
                                scope.launch {
                                    pagerState.animateScrollToPage(now.monthValue - 1)
                                }
                            }
                            scrollToTodayTrigger++
                        }) {
                            Text(stringResource(R.string.month_button_today))
                        }
                        // Toggle a la subvista Temporada (pestaña Calendario).
                        if (onSwitchView != null) {
                            IconButton(onClick = {
                                haptic(Haptics.Event.Navigation)
                                onSwitchView()
                            }) {
                                Icon(
                                    imageVector = Icons.Filled.Event,
                                    contentDescription = stringResource(R.string.tab_season),
                                )
                            }
                        }
                    },
                )
            },
        ) { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                // Category filter chips
                LazyRow(
                    modifier = Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(Constants.CategoryFilter.entries.toList(), key = { it.id }) { cat ->
                        val hideAll = cat == Constants.CategoryFilter.ALL || category == Constants.CategoryFilter.ALL
                        val isPinnedValid = defaultFilterPref != Constants.CategoryFilter.ALL
                        val pinFilled = !hideAll && isPinnedValid && defaultFilterPref == cat
                        val pinOutline = !hideAll && !pinFilled && category == cat
                        CategoryFilterChip(
                            label = stringResource(cat.labelRes),
                            selected = category == cat,
                            pinFilled = pinFilled,
                            pinOutline = pinOutline,
                            onClick = {
                                if (cat == category) {
                                    haptic(Haptics.Event.PrimaryAction)
                                    pendingDefault = cat
                                } else {
                                    haptic(Haptics.Event.Selection)
                                    category = cat
                                }
                            },
                            onLongClick = {
                                haptic(Haptics.Event.PrimaryAction)
                                pendingDefault = cat
                            },
                        )
                    }
                }

                // Month pills row with year picker as first item
                LazyRow(
                    modifier = Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    item(key = "year-picker") {
                        Box {
                            PillButton(
                                icon = Icons.Filled.CalendarMonth,
                                label = year.toString(),
                                active = true,
                                onClick = { yearMenuOpen = true },
                            )
                            DropdownMenu(
                                expanded = yearMenuOpen,
                                onDismissRequest = { yearMenuOpen = false },
                            ) {
                                availableYears.forEach { y ->
                                    DropdownMenuItem(
                                        text = { Text(y.toString()) },
                                        onClick = {
                                            if (y != year) {
                                                haptic(Haptics.Event.Selection)
                                                year = y
                                            }
                                            yearMenuOpen = false
                                        },
                                    )
                                }
                            }
                        }
                    }
                    items(12, key = { it }) { idx ->
                        MonthChip(
                            month = idx + 1,
                            isSelected = pagerState.currentPage == idx,
                            onClick = {
                                haptic(Haptics.Event.Navigation)
                                scope.launch { pagerState.animateScrollToPage(idx) }
                            },
                        )
                    }
                }

                if (isLoading && allDaysRaw.isEmpty() && allRaces.none { it.year == year }) {
                    RouteLoadingView(message = stringResource(R.string.calendar_loading))
                } else {
                    // HorizontalPager — one page per month
                    HorizontalPager(
                        state = pagerState,
                        modifier = Modifier.fillMaxSize(),
                        beyondViewportPageCount = 1,
                    ) { pageIdx ->
                        MonthDayPage(
                            year = year,
                            monthNum = pageIdx + 1,
                            allDaysWithPlaceholders = allDaysWithPlaceholders,
                            raceMap = raceMap,
                            category = category,
                            scrollToTodayTrigger = scrollToTodayTrigger,
                            onStageClick = { id ->
                                haptic(Haptics.Event.Navigation)
                                navController.navigate(Routes.stage(id))
                            },
                            onPlaceholderClick = { race, rd ->
                                haptic(Haptics.Event.Navigation)
                                placeholderItem = PlaceholderItem(race, rd)
                            },
                            onChampionshipsClick = {
                                haptic(Haptics.Event.Navigation)
                                navController.navigate(Routes.CHAMPIONSHIPS)
                            },
                        )
                    }
                }
            }
        }

        PlaceholderModalOverlay(
            item = placeholderItem,
            onDismiss = { placeholderItem = null },
        )

        pendingDefault?.let { filter ->
            val isPinned = filter == defaultFilterPref && defaultFilterPref != Constants.CategoryFilter.ALL
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
                        TextButton(onClick = {
                            scope.launch { app.preferences.clearDefaultFilter() }
                            category = Constants.CategoryFilter.ALL
                            pendingDefault = null
                        }) { Text(stringResource(R.string.action_remove)) }
                    } else {
                        TextButton(onClick = {
                            scope.launch { app.preferences.setDefaultFilter(filter) }
                            category = filter
                            pendingDefault = null
                        }) { Text(stringResource(R.string.action_set)) }
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingDefault = null }) { Text(stringResource(R.string.action_cancel)) }
                },
            )
        }
    }
}

// MARK: - Month day page (one per pager page)

@Composable
private fun MonthDayPage(
    year: Int,
    monthNum: Int,
    allDaysWithPlaceholders: List<RaceDay>,
    raceMap: Map<String, Race>,
    category: Constants.CategoryFilter,
    scrollToTodayTrigger: Int,
    onStageClick: (String) -> Unit,
    onPlaceholderClick: (Race, RaceDay) -> Unit,
    onChampionshipsClick: () -> Unit,
) {
    val monthPrefix = "%04d-%02d".format(year, monthNum)

    // Filter days for this month + active category. En la semana de Campeonatos
    // (22-28 jun) las CN NO se muestran sueltas: se colapsan en una fila
    // sintética "Campeonatos Nacionales" que enlaza a la pantalla de Campeonatos
    // (espejo de la web `js/calendario-mes.js` → `champRowHtml`/`passesCategoryFilter`).
    val isChampYear = year == ChampionshipsConfig.YEAR
    val filtered = remember(allDaysWithPlaceholders, raceMap, category, monthPrefix, isChampYear) {
        val inMonth = if (category == Constants.CategoryFilter.ALL) {
            allDaysWithPlaceholders.filter { it.dateKey.startsWith(monthPrefix) }
        } else {
            allDaysWithPlaceholders.filter { rd ->
                rd.dateKey.startsWith(monthPrefix) &&
                    rd.raceId?.let { raceMap[it] }?.let { RaceLogic.matchesCategory(it, category) } == true
            }
        }
        // En Mes NINGUNA CN se muestra suelta, independientemente de la fecha: los
        // Campeonatos se representan SOLO por la fila sintética de la semana 22-28
        // jun (que se inserta en esos días). Paridad EXACTA con la web
        // (`js/calendario-mes.js`: `if (cat === 'CN') return false` en
        // `passesCategoryFilter`) y con iOS. Antes solo se ocultaban las CN dentro
        // del rango 22-28 → las CN de junio fuera de esas fechas se colaban sueltas.
        if (!isChampYear) inMonth
        else inMonth.filterNot { rd ->
            rd.raceId?.let { raceMap[it]?.uciCategory } == "CN"
        }
    }

    // Group by date and sort each group by UCI category
    val byDate = remember(filtered, raceMap) {
        val comparator = RaceLogic.byCategoryWithRaceMap(raceMap)
        filtered
            .groupBy { it.dateKey }
            .mapValues { (_, days) -> days.sortedWith(comparator) }
            .toSortedMap()
    }

    val daysInMonth = YearMonth.of(year, monthNum).lengthOfMonth()
    val allDayKeys = remember(year, monthNum) {
        (1..daysInMonth).map { d -> "%04d-%02d-%02d".format(year, monthNum, d) }
    }

    val isCurrentMonth = year == LocalDate.now().year && monthNum == LocalDate.now().monthValue
    val todayDay = LocalDate.now().dayOfMonth
    val todayIdx = (todayDay - 1).coerceAtLeast(0)
    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = if (isCurrentMonth) todayIdx else 0,
    )

    // Scroll to today when "Hoy" button is tapped
    LaunchedEffect(scrollToTodayTrigger) {
        if (scrollToTodayTrigger > 0 && isCurrentMonth) {
            listState.animateScrollToItem(todayIdx)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Month title header
        Text(
            text = DateFormatting.formatMonthYear(year, monthNum),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .semantics { heading() },
        )

        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
        ) {
            items(allDayKeys, key = { it }) { dateKey ->
                val dayRaces = byDate[dateKey].orEmpty()
                val isChampDay = isChampYear && dateKey in ChampionshipsConfig.DATES
                DaySection(
                    dateKey = dateKey,
                    raceDays = dayRaces,
                    raceMap = raceMap,
                    activeFilter = category,
                    isChampDay = isChampDay,
                    onStageClick = onStageClick,
                    onPlaceholderClick = onPlaceholderClick,
                    onChampionshipsClick = onChampionshipsClick,
                )
            }
        }
    }
}

// MARK: - Day section

@Composable
private fun DaySection(
    dateKey: String,
    raceDays: List<RaceDay>,
    raceMap: Map<String, Race>,
    activeFilter: Constants.CategoryFilter,
    isChampDay: Boolean,
    onStageClick: (String) -> Unit,
    onPlaceholderClick: (Race, RaceDay) -> Unit,
    onChampionshipsClick: () -> Unit,
) {
    val localDate = remember(dateKey) { DateFormatting.parseLocalDate(dateKey) }
    val day = localDate?.dayOfMonth ?: return
    val isToday = dateKey == DateFormatting.todayKey()
    val weekdayName = remember(dateKey) {
        localDate.let {
            val name = DateTimeFormatter.ofPattern("EEEE", Locale("es", "ES")).format(it)
            name.replaceFirstChar { c -> c.uppercase(Locale("es", "ES")) }
        }
    }

    // En la semana de Campeonatos un día puede quedar con raceDays vacío (todas
    // sus carreras eran CN y se filtraron) pero seguir teniendo contenido: la
    // fila sintética de Campeonatos.
    val hasContent = raceDays.isNotEmpty() || isChampDay

    Column(modifier = Modifier.fillMaxWidth()) {
        // Day header: circle with day number + weekday name
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp, bottom = if (!hasContent) 10.dp else 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val primary = MaterialTheme.colorScheme.primary
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .background(
                        color = if (isToday) primary else Color.Transparent,
                        shape = CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = day.toString(),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (isToday) FontWeight.Bold else FontWeight.Medium,
                    color = if (isToday) MaterialTheme.colorScheme.onPrimary else primary,
                )
            }
            Text(
                text = weekdayName,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }

        if (!hasContent) {
            Text(
                text = stringResource(R.string.month_no_races),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 46.dp, bottom = 8.dp),
            )
        } else {
            Column(
                // Separación entre tarjetas (antes 2dp para filas planas).
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(bottom = 6.dp),
            ) {
                // Fila sintética de Campeonatos Nacionales, primero (espejo web:
                // `if (isChampDay) rowsHtml = champRowHtml() + rowsHtml`).
                if (isChampDay) {
                    MonthChampionshipsRow(onClick = onChampionshipsClick)
                }
                raceDays.forEach { rd ->
                    val race = rd.raceId?.let { raceMap[it] }
                    MonthScheduleRaceRow(
                        raceDay = rd,
                        race = race,
                        activeFilter = activeFilter,
                        onClick = {
                            when {
                                rd.editorialStatus == "placeholder" && race != null ->
                                    onPlaceholderClick(race, rd)
                                race?.isCancelled == true ->
                                    onPlaceholderClick(race, rd)
                                else -> onStageClick(rd.id)
                            }
                        },
                    )
                }
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}

// MARK: - Race row

@Composable
private fun MonthScheduleRaceRow(
    raceDay: RaceDay,
    race: Race?,
    activeFilter: Constants.CategoryFilter,
    onClick: () -> Unit,
) {
    val stripe = colorFromHex(race?.colorHex, fallback = Color.Gray)
    // Solo se atenúa la CARRERA cancelada (no se corre en absoluto). Una JORNADA
    // cancelada no: su aviso ya lo dice y su ficha sigue siendo accesible.
    val rowAlpha = if (race?.isCancelled == true) 0.5f else 1f
    val isFemaleFilterActive = activeFilter == Constants.CategoryFilter.FEMALE ||
        activeFilter == Constants.CategoryFilter.WWT
    val displayName = race?.localizedName?.let {
        if (isFemaleFilterActive && race?.isFemale == true) RaceLogic.cleanFeminineDisplayName(it) else it
    } ?: stringResource(R.string.today_race_fallback)

    val context = androidx.compose.ui.platform.LocalContext.current
    val isTimeTrial = raceDay.primaryType == "itt" || raceDay.primaryType == "ttt"
    val stageLabelWithType = remember(raceDay.id, raceDay.primaryType, raceDay.secondaryType, LocaleHolder.current) {
        val base = raceDay.stageLabelShort
        if (isTimeTrial) {
            val type = RaceLogic.resolveTypeLabel(context, raceDay.primaryType, raceDay.secondaryType)
            if (base.isEmpty()) "($type)" else "$base ($type)"
        } else base
    }

    // Tarjeta con tono de carrera (CCCard) — mismo lenguaje que Hoy. El tinte de
    // marca al 4% va sobre la superficie; la fila interior conserva su layout.
    CCCard(
        accent = stripe,
        accentAlpha = 0.04f,
        cornerRadius = 14,
        modifier = Modifier
            .fillMaxWidth()
            .alpha(rowAlpha),
    ) {
      Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        RaceLogo(url = race?.logoUrl, size = 28.dp)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (race?.hideFlag != true || raceDay.countryCode != null) {
                    CountryFlag(countryCode = raceDay.countryCode ?: race?.countryCode)
                }
                // Peso del nombre alineado con Hoy/cintillo (Medium 14/16).
                Text(
                    text = displayName,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    lineHeight = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!isFemaleFilterActive && RaceLogic.shouldShowFemaleIndicator(race)) {
                    val femaleCd = stringResource(R.string.season_female_indicator_cd)
                    Text(
                        text = "♀",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.tertiary,
                        modifier = Modifier.semantics { contentDescription = femaleCd },
                    )
                }
                when {
                    raceDay.isRestDay -> Text(
                        text = "\u00b7 ${stringResource(R.string.today_subtitle_rest)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    raceDay.isCancelledDay -> Text(
                        text = "\u00b7 ${stringResource(R.string.today_subtitle_cancelled)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            if (!raceDay.isRestDay && !raceDay.isCancelledDay) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    CategoryBadge(category = race?.uciCategory)
                    if (stageLabelWithType.isNotEmpty()) {
                        Text(
                            text = stageLabelWithType,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (race?.isOneDay != true) {
                        raceDay.routeDescription?.takeIf { it.isNotEmpty() }?.let { route ->
                            Text(
                                text = route,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
        Icon(
            imageVector = Icons.Filled.ChevronRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.outline,
        )
      }
    }
}

// MARK: - Championships synthetic row

/** Fila sintética "Campeonatos Nacionales" de la semana 22-28 jun: colapsa todas
 *  las CN del día en una sola entrada que enlaza a la pantalla de Campeonatos.
 *  Espejo de `champRowHtml()` de `js/calendario-mes.js`. */
@Composable
private fun MonthChampionshipsRow(onClick: () -> Unit) {
    // Azul suave del rediseño (= CAMP.ACCENT de la web).
    val accent = Color(0xFF1A73E8)
    CCCard(
        accent = accent,
        accentAlpha = 0.04f,
        cornerRadius = 14,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = onClick)
                .padding(horizontal = 10.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Hueco del logo (las CN colapsadas no tienen logo único), con un
            // globo terráqueo centrado en Europa/África como marca de Campeonatos
            // (varios países). SVG prefabricado (Twemoji 1F30D, CC-BY 4.0)
            // monocromo, teñido con el accent — el MISMO asset que iOS.
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .background(accent.copy(alpha = 0.12f), shape = CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_globe_europe_africa),
                    contentDescription = null,
                    tint = accent,
                    modifier = Modifier.size(17.dp),
                )
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = stringResource(R.string.champ_title),
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    lineHeight = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                CategoryBadge(category = "CN")
            }
            Icon(
                imageVector = Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.outline,
            )
        }
    }
}

// MARK: - UI components

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CategoryFilterChip(
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

@Composable
private fun MonthChip(month: Int, isSelected: Boolean = false, onClick: () -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    val background = if (isSelected) primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant
    val foreground = if (isSelected) primary else MaterialTheme.colorScheme.onSurfaceVariant
    Text(
        text = DateFormatting.shortMonthName(month),
        style = MaterialTheme.typography.labelMedium,
        // No seleccionado en Normal (no Medium), para casar con los chips de
        // filtro: solo el seleccionado lleva peso fuerte.
        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
        color = foreground,
        modifier = Modifier
            .background(background, RoundedCornerShape(3))
            .semantics {
                this.role = Role.Button
                this.selected = isSelected
            }
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

@Composable
private fun PillButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean,
    onClick: () -> Unit,
) {
    val primary = MaterialTheme.colorScheme.primary
    val background = if (active) primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant
    val foreground = if (active) primary else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier
            .background(background, RoundedCornerShape(3))
            .semantics(mergeDescendants = true) { this.role = Role.Button }
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = foreground,
            modifier = Modifier.size(14.dp),
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Medium,
            color = foreground,
        )
    }
}
