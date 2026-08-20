package app.calendariociclismo.android.ui.season

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
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
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CategoryBadge
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.components.PlaceholderItem
import app.calendariociclismo.android.ui.components.PlaceholderModalOverlay
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.util.Constants
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.rememberHaptics
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.res.painterResource
import app.calendariociclismo.android.util.ChampionshipsConfig
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import java.time.LocalDate

/** Umbral por debajo del cual, con un país activo, se colapsan todos los meses
 * y solo se ofrece la vista "Todos". Paridad con iOS
 * (`SeasonViewModel.collapseCountryThreshold`). */
private const val COLLAPSE_COUNTRY_THRESHOLD = 5

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SeasonScreen(
    navController: NavController,
    /** Toggle Temporada↔Mes de la pestaña Calendario (apps 3.1). No-null cuando
     *  la pantalla vive dentro de CalendarScreen → añade TopAppBar con la action
     *  (esta pantalla no tenía topBar propio). */
    onSwitchView: (() -> Unit)? = null,
) {
    val app = rememberApp()
    val haptic = rememberHaptics()
    val scope = rememberCoroutineScope()
    val allRaces by app.repository.observeAllRaces().collectAsState(initial = emptyList())
    var year by remember { mutableStateOf(LocalDate.now().year) }
    var category by remember { mutableStateOf(Constants.CategoryFilter.ALL) }
    var country by remember { mutableStateOf<String?>(null) }
    var yearMenuOpen by remember { mutableStateOf(false) }
    var countryMenuOpen by remember { mutableStateOf(false) }
    var modalItem by remember { mutableStateOf<PlaceholderItem?>(null) }
    var pendingDefault by remember { mutableStateOf<Constants.CategoryFilter?>(null) }

    // Observar el filtro por defecto de forma reactiva (se actualiza cuando otra sección lo cambia)
    val defaultFilterPref by app.preferences.defaultFilter.collectAsState(initial = Constants.CategoryFilter.ALL)
    LaunchedEffect(defaultFilterPref) { category = defaultFilterPref }

    LaunchedEffect(year) {
        runCatching { app.repository.refreshRacesYear(year) }
    }

    // Analytics con parámetros
    LaunchedEffect(year, category, country) {
        app.analytics.logScreenView(
            "season",
            android.os.Bundle().apply {
                putString("year", year.toString())
                putString("category_filter", category.id)
                putString("country_code", country ?: "all")
            },
        )
    }

    // Filtrado y agrupación por mes.
    // Los Campeonatos Nacionales (uciCategory == "CN") se EXCLUYEN aquí: se
    // muestran colapsados en una sola fila sintética que enlaza a la pantalla de
    // Campeonatos (igual que la vista de Mes y la web `js/temporada.js`).
    val filtered = remember(allRaces, year, category, country) {
        allRaces
            .filter { it.year == year }
            .filter { !ChampionshipsConfig.isChampionship(it) }
            .filter { race -> RaceLogic.matchesCategory(race, category) }
            .filter { race ->
                country == null || run {
                    val cc = (race.countryCode ?: "").lowercase()
                    val normalized = if (cc.startsWith("es-")) "es" else cc
                    normalized == country
                }
            }
            .sortedWith(compareBy({ it.startDate ?: "" }, { it.name }))
    }
    // ¿Mostrar la fila sintética de Campeonatos? El año es el de Campeonatos,
    // existe ≥1 prueba CN y no se filtra por un país concreto (la fila enlaza a
    // TODOS los campeonatos). Espejo de la inyección tras el filtro de la web.
    val hasChampionships = remember(allRaces, year, country) {
        year == ChampionshipsConfig.YEAR && country == null &&
            allRaces.any { it.year == year && ChampionshipsConfig.isChampionship(it) && !it.isCancelled }
    }
    val championshipsMonth = remember {
        DateFormatting.parseLocalDate(ChampionshipsConfig.RANGE_START)?.monthValue ?: 6
    }
    // Cuando hay un país activo y el total filtrado es menor que el umbral,
    // colapsamos la vista a solo "Todos" (month = 0). Se recalcula en cuanto
    // cambia el país, por lo que al retirar/ampliar el filtro de país vuelven
    // a aparecer todos los meses automáticamente.
    val shouldCollapseToAll = country != null && filtered.isNotEmpty() &&
        filtered.size < COLLAPSE_COUNTRY_THRESHOLD
    val byMonth = remember(filtered, shouldCollapseToAll) {
        if (filtered.isEmpty()) {
            sortedMapOf<Int, List<Race>>()
        } else {
            val all = mapOf(0 to filtered)
            if (shouldCollapseToAll) {
                sortedMapOf<Int, List<Race>>().apply { putAll(all) }
            } else {
                val monthly = filtered
                    .groupBy { race ->
                        race.startDate?.let { DateFormatting.parseLocalDate(it)?.monthValue } ?: 0
                    }
                    .filterKeys { it > 0 }
                (all + monthly).toSortedMap()
            }
        }
    }
    // Lista de meses incluidos en el pager. `0` representa "Todos" y va
    // siempre primero si hay carreras.
    val months = remember(byMonth) { byMonth.keys.toList() }

    val availableYears = remember(allRaces) {
        val currentYear = LocalDate.now().year
        val fromData = allRaces.mapNotNull { it.year }.toSet()
        // Calendario solo ofrece la temporada actual y las futuras. Los datos
        // offline pueden conservar años anteriores, pero no deben reaparecer
        // en este selector.
        (currentYear..(currentYear + 1)).toList()
            .union(fromData)
            .filter { it >= currentYear }
            .sortedDescending()
    }
    data class CountryEntry(val code: String, val label: String, val name: String)
    val availableCountries = remember(allRaces, year) {
        val codes = allRaces.filter { it.year == year }
            .filter { !ChampionshipsConfig.isChampionship(it) }
            .mapNotNull { race ->
                val cc = race.countryCode?.lowercase() ?: return@mapNotNull null
                if (cc.startsWith("es-")) "es" else cc
            }
            .toSet()
        val collator = java.text.Collator.getInstance(java.util.Locale("es", "ES"))
        codes.map { code ->
            val base = 0x1F1E6 - 'A'.code
            val flag = code.uppercase().take(2).map { c ->
                String(Character.toChars(base + c.code))
            }.joinToString("")
            val name = java.util.Locale("", code.uppercase())
                .getDisplayCountry(java.util.Locale("es", "ES"))
            CountryEntry(code = code, label = "$flag $name", name = name)
        }.sortedWith(Comparator { a, b -> collator.compare(a.name, b.name) })
    }
    val countryLabel = country?.let { c ->
        availableCountries.find { it.code == c }?.label ?: c.uppercase()
    } ?: stringResource(R.string.season_country_pill_default)

    // Índice inicial: mes actual o siguiente disponible.
    // Regla: seleccionamos el mes en curso por defecto (no "Todos") siempre
    // que esté presente. Si no lo está (año distinto al actual o colapsado por
    // país con <5 carreras) caemos al primer mes real disponible; si tampoco
    // hay meses reales, seleccionamos "Todos" (month = 0).
    fun bestPageIndex(): Int {
        if (months.isEmpty()) return 0
        // Solo existe "Todos" (colapsado por país con <5 carreras).
        if (months == listOf(0)) return 0
        val firstRealIdx = months.indexOfFirst { it > 0 }.coerceAtLeast(0)
        if (year != LocalDate.now().year) return firstRealIdx
        val current = LocalDate.now().monthValue
        return months.indexOfFirst { it == current }.takeIf { it >= 0 }
            ?: months.indexOfFirst { it > current && it > 0 }.takeIf { it >= 0 }
            ?: firstRealIdx
    }

    val pagerState = rememberPagerState(
        initialPage = 0,
        pageCount = { months.size.coerceAtLeast(1) },
    )

    // Rastrea si ya se ejecutó el salto inicial al mes actual (para no repetirlo en cambios de filtro)
    var initialScrollDone by remember { mutableStateOf(false) }

    // Haptic al deslizar entre páginas (drop(1) evita el disparo en la composición inicial)
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.currentPage }
            .drop(1)
            .collect { haptic(Haptics.Event.Navigation) }
    }

    // Al cargar por primera vez: saltar al mes actual/mejor. En cambios de filtro: mantener mes visible.
    LaunchedEffect(months) {
        if (months.isEmpty()) return@LaunchedEffect
        if (!initialScrollDone) {
            initialScrollDone = true
            val targetIdx = bestPageIndex()
            if (targetIdx != pagerState.currentPage) {
                pagerState.scrollToPage(targetIdx)
            }
        } else {
            val visibleMonth = months.getOrNull(pagerState.currentPage)
            val targetIdx = if (visibleMonth != null && visibleMonth in months) {
                months.indexOf(visibleMonth)
            } else {
                bestPageIndex()
            }
            if (targetIdx != pagerState.currentPage) {
                pagerState.animateScrollToPage(targetIdx)
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Scaffold(
            topBar = {
                // Solo dentro de la pestaña Calendario: cabecera con el toggle a
                // la subvista Mes (la pantalla histórica no tenía TopAppBar y los
                // selectores Año/País siguen siendo la primera fila de contenido).
                if (onSwitchView != null) {
                    TopAppBar(
                        title = {
                            Text(
                                text = stringResource(R.string.month_title),
                                style = MaterialTheme.typography.titleMedium,
                            )
                        },
                        actions = {
                            IconButton(onClick = {
                                haptic(Haptics.Event.Navigation)
                                onSwitchView()
                            }) {
                                Icon(
                                    imageVector = Icons.Filled.CalendarMonth,
                                    contentDescription = stringResource(R.string.tab_month),
                                )
                            }
                        },
                    )
                }
            },
        ) { padding ->
            Column(modifier = Modifier.fillMaxSize().padding(padding)) {

                // Fila de selectores Año + País
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
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
                                        if (y != year) haptic(Haptics.Event.Selection)
                                        year = y
                                        yearMenuOpen = false
                                    },
                                )
                            }
                        }
                    }
                    Box {
                        PillButton(
                            icon = Icons.Filled.Public,
                            label = countryLabel,
                            active = country != null,
                            onClick = { countryMenuOpen = true },
                        )
                        DropdownMenu(
                            expanded = countryMenuOpen,
                            onDismissRequest = { countryMenuOpen = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.season_country_all)) },
                                onClick = {
                                    if (country != null) haptic(Haptics.Event.Selection)
                                    country = null
                                    countryMenuOpen = false
                                },
                            )
                            availableCountries.forEach { entry ->
                                DropdownMenuItem(
                                    text = { Text(entry.label) },
                                    onClick = {
                                        if (country != entry.code) haptic(Haptics.Event.Selection)
                                        country = entry.code
                                        countryMenuOpen = false
                                    },
                                )
                            }
                        }
                    }
                }

                // Chips de categoría
                LazyRow(
                    modifier = Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
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

                // Chips de mes — sincronizan bidireccionalmente con HorizontalPager
                if (months.isNotEmpty()) {
                    LazyRow(
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(months, key = { it }) { month ->
                            val idx = months.indexOf(month)
                            val chipLabel = if (month == 0) stringResource(R.string.season_pill_all_months)
                                else DateFormatting.shortMonthName(month)
                            MonthChip(
                                label = chipLabel,
                                isSelected = pagerState.currentPage == idx,
                                onClick = {
                                    haptic(Haptics.Event.Navigation)
                                    scope.launch { pagerState.animateScrollToPage(idx) }
                                },
                            )
                        }
                    }
                }

                // Contenido — un mes por página con deslizamiento horizontal
                when {
                    filtered.isEmpty() -> Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (allRaces.isEmpty()) {
                            RouteLoadingView(message = stringResource(R.string.loading))
                        } else {
                            Text(
                                text = stringResource(R.string.season_empty_no_races),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    else -> HorizontalPager(
                        state = pagerState,
                        modifier = Modifier.fillMaxSize(),
                        beyondViewportPageCount = 1,
                    ) { pageIdx ->
                        val month = months.getOrNull(pageIdx) ?: return@HorizontalPager
                        val races = byMonth[month] ?: emptyList()
                        MonthPage(
                            year = year,
                            month = month,
                            races = races,
                            activeFilter = category,
                            showChampionships = hasChampionships,
                            championshipsMonth = championshipsMonth,
                            onChampionshipsClick = {
                                haptic(Haptics.Event.Navigation)
                                navController.navigate(Routes.CHAMPIONSHIPS)
                            },
                            onRaceClick = { race ->
                                haptic(Haptics.Event.Navigation)
                                when {
                                    race.isCancelled ->
                                        modalItem = PlaceholderItem(race, null)
                                    race.isOneDay -> scope.launch {
                                        val stageId = app.repository.oneDayRaceStageId(race.id)
                                        when {
                                            stageId != null -> navController.navigate(Routes.stage(stageId))
                                            else -> modalItem = PlaceholderItem(race, null, race.websiteUrl)
                                        }
                                    }
                                    else -> scope.launch {
                                        val days = runCatching {
                                            app.repository.refreshRaceComplete(race.id).second
                                        }.getOrNull()
                                        if (days.isNullOrEmpty()) {
                                            modalItem = PlaceholderItem(race, null, race.websiteUrl)
                                        } else {
                                            navController.navigate(Routes.race(race.id))
                                        }
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }

        PlaceholderModalOverlay(
            item = modalItem,
            onDismiss = { modalItem = null },
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

// MARK: - Month page

@Composable
private fun MonthPage(
    year: Int,
    month: Int,
    races: List<Race>,
    activeFilter: Constants.CategoryFilter,
    showChampionships: Boolean,
    championshipsMonth: Int,
    onChampionshipsClick: () -> Unit,
    onRaceClick: (Race) -> Unit,
) {
    val listState = rememberLazyListState()

    // Para la página "Todos" (month = 0), agrupamos las carreras por mes real
    // y pintamos una cabecera por grupo. Para una página de mes concreto,
    // renderizamos una sola cabecera y sus carreras.
    val groups: List<Pair<Int, List<Race>>> = remember(month, races) {
        if (month == 0) {
            races
                .groupBy { race ->
                    race.startDate?.let { DateFormatting.parseLocalDate(it)?.monthValue } ?: 0
                }
                .filterKeys { it > 0 }
                .toSortedMap()
                .map { (m, list) -> m to list }
        } else {
            listOf(month to races)
        }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, top = 8.dp, end = 12.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        groups.forEach { (groupMonth, groupRaces) ->
            item(key = "header-$groupMonth") {
                Text(
                    text = DateFormatting.formatMonthYear(year, groupMonth),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .padding(bottom = 4.dp)
                        .semantics { heading() },
                )
            }
            // En el mes que contiene la semana de Campeonatos, la fila sintética
            // de Campeonatos Nacionales se intercala por fecha (RANGE_START), tras
            // las carreras que empiezan antes (las carreras vienen ordenadas por
            // startDate). Mismo lugar que las CN colapsadas tendrían.
            val champIndex = if (showChampionships && groupMonth == championshipsMonth) {
                groupRaces.indexOfFirst {
                    (it.startDate ?: "") > ChampionshipsConfig.RANGE_START
                }.let { if (it < 0) groupRaces.size else it }
            } else {
                -1
            }
            groupRaces.forEachIndexed { index, race ->
                if (index == champIndex) {
                    item(key = "championships-$groupMonth") {
                        SeasonChampionshipsRow(onClick = onChampionshipsClick)
                    }
                }
                item(key = race.id) {
                    SeasonRaceRow(
                        race = race,
                        activeFilter = activeFilter,
                        onClick = { onRaceClick(race) },
                    )
                }
            }
            // Campeonatos al final del grupo (todas las carreras empiezan antes).
            if (champIndex == groupRaces.size) {
                item(key = "championships-$groupMonth") {
                    SeasonChampionshipsRow(onClick = onChampionshipsClick)
                }
            }
        }
    }
}

/**
 * Fila sintética "Campeonatos Nacionales" de la semana 22-28 jun: colapsa todas
 * las CN de la temporada en una sola entrada que enlaza a la pantalla de
 * Campeonatos. Espejo de [app.calendariociclismo.android.ui.month.MonthScreen]'s
 * MonthChampionshipsRow y de la fila inyectada en `js/temporada.js`.
 */
@Composable
private fun SeasonChampionshipsRow(onClick: () -> Unit) {
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

// MARK: - Composables (sin cambios respecto a la versión anterior)

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
            .background(background, RoundedCornerShape(50))
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
private fun MonthChip(label: String, isSelected: Boolean = false, onClick: () -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    val background = if (isSelected) primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant
    val foreground = if (isSelected) primary else MaterialTheme.colorScheme.onSurfaceVariant
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        // No seleccionado en Normal (no Medium), para casar con los chips de
        // filtro: solo el seleccionado lleva peso fuerte.
        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
        color = foreground,
        modifier = Modifier
            .background(background, RoundedCornerShape(50))
            .semantics {
                this.role = Role.Button
                this.selected = isSelected
            }
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

@Composable
private fun SeasonRaceRow(
    race: Race,
    activeFilter: Constants.CategoryFilter,
    onClick: () -> Unit,
) {
    val displayName = remember(race.id, activeFilter) {
        if ((activeFilter == Constants.CategoryFilter.WWT ||
                activeFilter == Constants.CategoryFilter.FEMALE) && race.isFemale
        ) {
            RaceLogic.cleanFeminineDisplayName(race.localizedName)
        } else {
            race.localizedName
        }
    }
    val showFemale = remember(race.id, activeFilter) {
        if (activeFilter == Constants.CategoryFilter.WWT ||
            activeFilter == Constants.CategoryFilter.FEMALE
        ) false else RaceLogic.shouldShowFemaleIndicator(race)
    }
    val stripe = colorFromHex(race.colorHex, fallback = Color.Gray)
    val rowAlpha = if (race.isCancelled) 0.5f else 1f

    // Tarjeta con tono de carrera (CCCard) — mismo lenguaje que Hoy y Mes.
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
        RaceLogo(url = race.logoUrl, size = 28.dp)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (!race.hideFlag) {
                    CountryFlag(countryCode = race.countryCode)
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
                if (showFemale) {
                    val femaleCd = stringResource(R.string.season_female_indicator_cd)
                    Text(
                        text = "♀",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.tertiary,
                        modifier = Modifier.semantics { contentDescription = femaleCd },
                    )
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                CategoryBadge(category = race.uciCategory)
                val range = DateFormatting.formatDateRange(race.startDate, race.endDate)
                if (range.isNotEmpty()) {
                    Text(
                        text = range,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
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
