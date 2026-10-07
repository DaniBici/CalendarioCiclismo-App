package app.calendariociclismo.android.ui.resultsfeed

import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.IntrinsicSize
import app.calendariociclismo.android.ui.components.ccSegmentedColors
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextAlign
import app.calendariociclismo.android.ui.results.ResultsHeaderCell
import app.calendariociclismo.android.ui.results.ResultsTableMetrics
import app.calendariociclismo.android.ui.results.ResultsTableSurface
import app.calendariociclismo.android.ui.theme.BadgeColor
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.UciRankingKeyItem
import app.calendariociclismo.android.util.UciRankingKeyStyle
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.components.CCHeaderMark
import app.calendariociclismo.android.data.model.UciTeamRankingRow
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.components.StageTypeBadge
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutInfo
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.adaptive.rememberAdaptiveLayoutInfo
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.ResultsFeedLogic
import app.calendariociclismo.android.util.UciTeamRankingLogic
import app.calendariociclismo.android.util.UciTeamRankingPresentation
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** Ventana del feed: 14 días por página (espejo de WINDOW_DAYS en
 *  resultados-feed.js); "Cargar más" amplía hacia atrás hasta SEASON_START. */
private const val WINDOW_DAYS = 14
private const val SEASON_START = "2026-01-01"

private sealed class FeedState {
    object Loading : FeedState()
    data class Ready(val entries: List<ResultsFeedLogic.FeedEntry>) : FeedState()
    data class Error(val message: String) : FeedState()
}

private enum class ResultsSection { Latest, Ranking }
private enum class RankingGender(val value: String) { Male("male"), Female("female") }

private sealed class RankingState {
    object Loading : RankingState()
    data class Ready(val rows: List<UciTeamRankingRow>) : RankingState()
    data class Error(val message: String) : RankingState()
}

private data class RankingExplanation(val title: String, val message: String)

/**
 * Pestaña "Resultados" (apps 3.1) — feed nativo de últimos resultados, espejo
 * del índice /resultados/ de la web (`js/resultados-feed.js`): cronología
 * inversa agrupada por fecha, filas con el tinte de la carrera, ganador con
 * nombre canónico y "Cargar más" de 14 en 14 días.
 *
 * Solo-online (sin Room), como inscritos/orden de salida/resultados. La
 * construcción y orden de las entradas vive en `ResultsFeedLogic` (testeada);
 * aquí solo carga + render.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultsFeedScreen(navController: NavController) {
    val app = rememberApp()
    val haptic = rememberHaptics()
    val context = LocalContext.current
    val unknownError = stringResource(R.string.startlist_error_unknown)
    val adaptiveInfo = rememberAdaptiveLayoutInfo()

    val todayKey = remember { DateFormatting.todayKey() }
    var fromKey by remember {
        val initial = DateFormatting.dayOffset(todayKey, -(WINDOW_DAYS - 1)) ?: todayKey
        mutableStateOf(maxOf(initial, SEASON_START))
    }
    var state by remember { mutableStateOf<FeedState>(FeedState.Loading) }
    var loadingMore by remember { mutableStateOf(false) }
    var isRefreshing by remember { mutableStateOf(false) }
    var activeSection by rememberSaveable { mutableStateOf(ResultsSection.Latest) }
    var rankingGender by rememberSaveable { mutableStateOf(RankingGender.Male) }
    var rankingState by remember { mutableStateOf<RankingState>(RankingState.Loading) }
    var rankingLoaded by remember { mutableStateOf(false) }
    var rankingRefreshing by remember { mutableStateOf(false) }
    var rankingExplanation by remember { mutableStateOf<RankingExplanation?>(null) }
    val pullRefreshState = rememberPullToRefreshState()
    val rankingPullRefreshState = rememberPullToRefreshState()

    LaunchedEffect(Unit) { app.analytics.logScreenView("results_feed") }

    // Refetch del rango actual [fromKey, hoy]. Compartido por la carga inicial,
    // el "Cargar más" (al ampliar fromKey) y el pull-to-refresh. Igual que la
    // web: las filas existentes se mantienen visibles mientras llega la recarga.
    suspend fun reload() {
        if (state !is FeedState.Ready) state = FeedState.Loading
        try {
            val entries = app.repository.loadResultsFeedWindow(fromKey, todayKey)
            currentCoroutineContext().ensureActive()
            // Commit único: el repositorio ya entrega ganadores y líderes resueltos.
            state = FeedState.Ready(entries)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            // Si la recarga falla, conservamos lo ya cargado.
            if (state !is FeedState.Ready) {
                state = FeedState.Error(error.message ?: unknownError)
            }
        }
        loadingMore = false
    }

    suspend fun reloadRanking() {
        if (!rankingLoaded) rankingState = RankingState.Loading
        runCatching { app.repository.loadUciTeamRankings() }
            .onSuccess { rows ->
                rankingState = RankingState.Ready(rows)
                rankingLoaded = true
            }
            .onFailure {
                if (!rankingLoaded) rankingState = RankingState.Error(
                    context.getString(R.string.uci_ranking_error)
                )
            }
        rankingRefreshing = false
    }

    // Carga inicial y recarga al ampliar la ventana ("Cargar más").
    LaunchedEffect(fromKey) { reload() }

    // Pull-to-refresh: refetch del rango visible sin colapsar a Loading.
    LaunchedEffect(isRefreshing) {
        if (isRefreshing) {
            reload()
            isRefreshing = false
        }
    }
    LaunchedEffect(activeSection) {
        if (activeSection == ResultsSection.Ranking && !rankingLoaded) {
            app.analytics.logScreenView("uci_team_ranking")
            reloadRanking()
        }
    }
    LaunchedEffect(rankingRefreshing) {
        if (rankingRefreshing) reloadRanking()
    }

    Scaffold(
        topBar = {
            // Título nativo de la sección, como Ciclocross y Fichajes.
            TopAppBar(
                title = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CCHeaderMark()
                        Text(
                            text = stringResource(R.string.tab_results),
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                        )
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            ResultsSectionSelector(
                active = activeSection,
                onSelect = {
                    haptic(Haptics.Event.Selection)
                    activeSection = it
                },
            )
            Box(Modifier.fillMaxWidth().weight(1f)) {
                if (activeSection == ResultsSection.Latest) {
                    PullToRefreshBox(
                        isRefreshing = isRefreshing,
                        onRefresh = { isRefreshing = true },
                        state = pullRefreshState,
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        when (val current = state) {
                            is FeedState.Loading -> {
                                RouteLoadingView(message = stringResource(R.string.loading), title = LocaleHolder.t("Últimos resultados", "Latest results"))
                            }
                            is FeedState.Error -> Text(
                                text = current.message,
                                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                                color = MaterialTheme.colorScheme.error,
                            )
                            is FeedState.Ready -> {
                                if (current.entries.isEmpty()) {
                                    FeedEmptyState()
                                } else {
                                    FeedList(
                                        entries = current.entries,
                                        adaptiveInfo = adaptiveInfo,
                                        showLoadMore = fromKey > SEASON_START,
                                        loadingMore = loadingMore,
                                        onLoadMore = {
                                            haptic(Haptics.Event.PrimaryAction)
                                            loadingMore = true
                                            val next = DateFormatting.dayOffset(fromKey, -WINDOW_DAYS) ?: SEASON_START
                                            fromKey = maxOf(next, SEASON_START)
                                        },
                                        onEntryTap = { entry ->
                                            haptic(Haptics.Event.Navigation)
                                            navController.navigate(
                                                Routes.results(
                                                    entry.race.id,
                                                    entry.stageNumber,
                                                    suffix = entry.stageSuffix,
                                                )
                                            )
                                        },
                                    )
                                }
                            }
                        }
                    }
                } else {
                    PullToRefreshBox(
                        isRefreshing = rankingRefreshing,
                        onRefresh = { rankingRefreshing = true },
                        state = rankingPullRefreshState,
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        UciRankingContent(
                            state = rankingState,
                            gender = rankingGender,
                            adaptiveInfo = adaptiveInfo,
                            onGenderSelect = {
                                haptic(Haptics.Event.Selection)
                                rankingGender = it
                            },
                            onRetry = { rankingRefreshing = true },
                            onRowTap = { item ->
                                val message = item.explanation(LocaleHolder.shouldShowEnglishContent)
                                if (message.isNotEmpty()) {
                                    haptic(Haptics.Event.Selection)
                                    rankingExplanation = RankingExplanation(item.row.displayName, message)
                                }
                            },
                        )
                    }
                }
            }
        }
    }

    rankingExplanation?.let { explanation ->
        AlertDialog(
            onDismissRequest = { rankingExplanation = null },
            title = { Text(explanation.title) },
            text = { Text(explanation.message) },
            confirmButton = {
                TextButton(onClick = { rankingExplanation = null }) {
                    Text(stringResource(R.string.action_close))
                }
            },
        )
    }
}

/**
 * Selector de vista: control segmentado nativo con radio 4, como el de
 * Fichajes y el de género del ránking. El título de la pantalla es el de la
 * barra superior («Resultados»).
 */
@Composable
private fun ResultsSectionSelector(
    active: ResultsSection,
    onSelect: (ResultsSection) -> Unit,
) {
    val options = listOf(
        ResultsSection.Latest to stringResource(R.string.results_feed_latest),
        ResultsSection.Ranking to stringResource(R.string.uci_ranking_tab),
    )
    SingleChoiceSegmentedButtonRow(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp),
    ) {
        options.forEachIndexed { index, (section, label) ->
            SegmentedButton(
                colors = ccSegmentedColors(),
                selected = active == section,
                onClick = { if (active != section) onSelect(section) },
                shape = SegmentedButtonDefaults.itemShape(
                    index = index,
                    count = options.size,
                    baseShape = RoundedCornerShape(CCRadius.Control),
                ),
                icon = {},
            ) {
                Text(label, style = CCText.S13, maxLines = 1)
            }
        }
    }
}

/** Colores de la etiqueta de puesto y de la explicación (`.uci-ranking-legend__item`). */
@Composable
private fun UciRankingKeyStyle.colors(): BadgeColor {
    val dark = isSystemInDarkTheme()
    return when (this) {
        UciRankingKeyStyle.WORLD_TOUR -> if (dark) {
            BadgeColor(Color(0xFFAAC7FF).copy(alpha = 0.15f), Color(0xFFAAC7FF))
        } else {
            BadgeColor(Color(0xFFD3E3FD), Color(0xFF0842A0))
        }
        UciRankingKeyStyle.ORANGE -> {
            val fg = if (dark) Color(0xFFFFB77C) else Color(0xFFE37400)
            BadgeColor(fg.copy(alpha = 0.16f), fg)
        }
        UciRankingKeyStyle.GREEN -> {
            val fg = if (dark) Color(0xFF6DD58C) else Color(0xFF137333)
            BadgeColor(fg.copy(alpha = 0.16f), fg)
        }
        UciRankingKeyStyle.EXCLUDED -> {
            val fg = if (dark) Color(0xFFFFB4AB) else Color(0xFFC5221F)
            BadgeColor(fg.copy(alpha = 0.14f), fg)
        }
    }
}

/** Etiqueta de color de un nivel (puesto y panel explicativo), radio 4. */
@Composable
private fun UciRankingTag(text: String, style: UciRankingKeyStyle?, modifier: Modifier = Modifier) {
    val colors = style?.colors()
    Text(
        text = text,
        style = CCText.S12,
        fontWeight = FontWeight.SemiBold,
        color = colors?.foreground ?: MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        maxLines = 1,
        modifier = modifier
            .clip(RoundedCornerShape(CCRadius.Control))
            .background(colors?.background ?: Color.Transparent)
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun UciRankingContent(
    state: RankingState,
    gender: RankingGender,
    adaptiveInfo: AdaptiveLayoutInfo,
    onGenderSelect: (RankingGender) -> Unit,
    onRetry: () -> Unit,
    onRowTap: (UciTeamRankingPresentation) -> Unit,
) {
    when (state) {
        is RankingState.Loading -> RouteLoadingView(
            message = stringResource(R.string.loading),
            title = LocaleHolder.t("Ránking UCI", "UCI ranking"),
        )
        is RankingState.Error -> Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = state.message,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(24.dp),
            )
            TextButton(onClick = onRetry) {
                Text(stringResource(R.string.action_retry))
            }
        }
        is RankingState.Ready -> {
            val isEnglish = LocaleHolder.shouldShowEnglishContent
            val rows = remember(state.rows, gender) {
                UciTeamRankingLogic.decorate(state.rows, gender.value)
            }
            val keyItems = remember(rows, isEnglish) { UciTeamRankingLogic.keyItems(rows, isEnglish) }
            Column(Modifier.fillMaxSize()) {
                // Género y fecha de actualización en una fila.
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val options = listOf(
                        RankingGender.Male to stringResource(R.string.uci_ranking_men),
                        RankingGender.Female to stringResource(R.string.uci_ranking_women),
                    )
                    SingleChoiceSegmentedButtonRow {
                        options.forEachIndexed { index, (value, label) ->
                            SegmentedButton(
                                colors = ccSegmentedColors(),
                                selected = gender == value,
                                onClick = { onGenderSelect(value) },
                                shape = SegmentedButtonDefaults.itemShape(
                                    index = index,
                                    count = options.size,
                                    baseShape = RoundedCornerShape(CCRadius.Control),
                                ),
                                icon = {},
                            ) {
                                Text(label, style = CCText.S13, maxLines = 1)
                            }
                        }
                    }
                    rows.firstOrNull()?.row?.rankingDate?.let { rankingDate ->
                        Text(
                            text = DateFormatting.formatUciRankingUpdated(rankingDate, isEnglish),
                            modifier = Modifier.weight(1f),
                            style = CCText.S12,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                if (rows.isEmpty()) {
                    Text(
                        text = stringResource(R.string.uci_ranking_empty),
                        modifier = Modifier.align(Alignment.CenterHorizontally).padding(24.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    BoxWithConstraints(Modifier.fillMaxSize()) {
                        val wide = adaptiveInfo.supportsTwoPanes && maxWidth >= 820.dp
                        val year = UciTeamRankingLogic.invitationYear(rows)
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .verticalScroll(rememberScrollState())
                                .padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            if (wide) {
                                Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                                    if (keyItems.isNotEmpty()) {
                                        UciRankingKeyPanel(year, keyItems, Modifier.width(288.dp))
                                    }
                                    UciRankingTable(rows, isEnglish, onRowTap, Modifier.weight(1f))
                                }
                            } else {
                                if (keyItems.isNotEmpty()) {
                                    UciRankingKeyPanel(year, keyItems, Modifier.fillMaxWidth())
                                }
                                UciRankingTable(rows, isEnglish, onRowTap, Modifier.fillMaxWidth())
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Panel «Invitaciones <año>»: cada etiqueta de puesto con su explicación. */
@Composable
private fun UciRankingKeyPanel(year: Int, items: List<UciRankingKeyItem>, modifier: Modifier) {
    CCCard(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = LocaleHolder.t("Invitaciones $year", "Invitations $year"),
                style = CCText.S16,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.semantics { heading() },
            )
            items.forEach { item ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    UciRankingTag(item.label, item.style)
                    Text(
                        text = item.text,
                        style = CCText.S13,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private val RankColumnWidth = 38.dp
private val FlagColumnWidth = 20.dp
private val CategoryColumnWidth = 40.dp
private val PointsColumnWidth = 64.dp

/** Ránking con la presentación de las clasificaciones (`ResultsTableSurface`). */
@Composable
private fun UciRankingTable(
    rows: List<UciTeamRankingPresentation>,
    isEnglish: Boolean,
    onRowTap: (UciTeamRankingPresentation) -> Unit,
    modifier: Modifier,
) {
    ResultsTableSurface(modifier = modifier) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = ResultsTableMetrics.HorizontalPadding, vertical = ResultsTableMetrics.HeaderVerticalPadding)
                .clearAndSetSemantics {},
            horizontalArrangement = Arrangement.spacedBy(ResultsTableMetrics.ColumnSpacing),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ResultsHeaderCell("#", Modifier.width(RankColumnWidth), align = TextAlign.Center)
            Spacer(Modifier.width(FlagColumnWidth))
            ResultsHeaderCell(stringResource(R.string.uci_ranking_team), Modifier.weight(1f))
            ResultsHeaderCell("Cat.", Modifier.width(CategoryColumnWidth), align = TextAlign.Center)
            ResultsHeaderCell(stringResource(R.string.uci_ranking_points), Modifier.width(PointsColumnWidth), align = TextAlign.End)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        rows.forEachIndexed { index, item ->
            UciRankingRow(
                item = item,
                points = UciTeamRankingLogic.formatPoints(item.row.points, isEnglish),
                explanation = item.explanation(isEnglish),
                onClick = { onRowTap(item) },
            )
            if (index < rows.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
private fun UciRankingRow(
    item: UciTeamRankingPresentation,
    points: String,
    explanation: String,
    onClick: () -> Unit,
) {
    val clickableModifier = if (explanation.isNotEmpty()) {
        Modifier.clickable(role = Role.Button, onClick = onClick)
    } else {
        Modifier
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 35.dp)
            .then(clickableModifier)
            .padding(horizontal = ResultsTableMetrics.HorizontalPadding, vertical = ResultsTableMetrics.RowVerticalPadding),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(ResultsTableMetrics.ColumnSpacing),
    ) {
        // Todos los puestos comparten caja: las cifras quedan alineadas.
        Box(Modifier.width(RankColumnWidth), contentAlignment = Alignment.Center) {
            UciRankingTag(item.row.rank.toString(), item.rankStyle, Modifier.widthIn(min = 30.dp))
        }
        Box(Modifier.width(FlagColumnWidth), contentAlignment = Alignment.Center) {
            CountryFlag(countryCode = item.row.countryCode, height = 13.5.dp)
        }
        Text(
            text = item.row.displayName,
            modifier = Modifier.weight(1f),
            style = CCText.S14,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = item.row.teamCategory.orEmpty(),
            modifier = Modifier.width(CategoryColumnWidth),
            style = CCText.S12,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Text(
            text = points,
            modifier = Modifier.width(PointsColumnWidth),
            style = CCText.S14.copy(fontFeatureSettings = "tnum"),
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.End,
            maxLines = 1,
            softWrap = false,
        )
    }
}

@Composable
private fun FeedList(
    entries: List<ResultsFeedLogic.FeedEntry>,
    adaptiveInfo: AdaptiveLayoutInfo,
    showLoadMore: Boolean,
    loadingMore: Boolean,
    onLoadMore: () -> Unit,
    onEntryTap: (ResultsFeedLogic.FeedEntry) -> Unit,
) {
    // Agrupación por fecha conservando el orden (las entradas ya vienen en
    // cronología inversa desde ResultsFeedLogic).
    val grouped = remember(entries) {
        val out = LinkedHashMap<String, MutableList<ResultsFeedLogic.FeedEntry>>()
        for (e in entries) out.getOrPut(e.date) { mutableListOf() }.add(e)
        out
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val columns = AdaptiveLayoutPolicy.feedColumns(maxWidth.value, adaptiveInfo)
        LazyColumn(
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            grouped.forEach { (date, dayEntries) ->
                item(key = "hdr-$date") {
                    // Cabecera de día en el idioma de CONTENIDO (no el locale del
                    // dispositivo) — mismo criterio que las fechas de cabecera de etapa.
                    Text(
                        text = DateFormatting.formatDateLongContent(date),
                        style = CCText.S13,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .padding(top = if (date == grouped.keys.first()) 0.dp else 8.dp, start = 4.dp)
                            .semantics { heading() },
                    )
                }
                // Ninguna fila ocupa las dos columnas, como la web
                // (`.feed-day>.feed-row { grid-column: auto }`).
                val rows = AdaptiveLayoutPolicy.rows(dayEntries, columns)
                items(rows, key = { row ->
                    row.items.joinToString("|") { e ->
                        e.stageRefId ?: "ext-${e.rd?.id ?: e.race.id}-${e.stageNumber ?: "f"}"
                    }
                }) { row ->
                    if (columns == 1 || row.spansAllColumns) {
                        val entry = row.items.first()
                        FeedEntryRow(entry = entry, onClick = { onEntryTap(entry) })
                    } else {
                        // Misma altura para las tarjetas de la fila: la fila
                        // toma el alto de la más alta.
                        Row(
                            modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            row.items.forEach { entry ->
                                Box(Modifier.weight(1f).fillMaxHeight()) {
                                    FeedEntryRow(
                                        entry = entry,
                                        onClick = { onEntryTap(entry) },
                                        modifier = Modifier.fillMaxHeight(),
                                    )
                                }
                            }
                            repeat(columns - row.items.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
            if (showLoadMore) {
                item(key = "load-more") {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        OutlinedButton(
                            onClick = onLoadMore,
                            enabled = !loadingMore,
                            shape = RoundedCornerShape(CCRadius.Control),
                        ) {
                            if (loadingMore) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                )
                            } else {
                                Text(
                                    stringResource(R.string.results_feed_load_more),
                                    style = CCText.S14,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Fila del feed — superficie neutra de la card de Hoy (`CCCard`, sin tinte del
 * color de carrera), logo 36dp con la bandera debajo, nombre completo con el
 * peso de los títulos de Hoy, línea "Etapa N · NN,N km · +N.NNN m" + badge de
 * tipo solo para contrarrelojes, y tercera línea trofeo + ganador en
 * SemiBold. Las generales finales conservan su etiqueta propia.
 */
@Composable
private fun FeedEntryRow(
    entry: ResultsFeedLogic.FeedEntry,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val race = entry.race
    CCCard(
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight()
                .clickable(role = Role.Button, onClick = onClick)
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Columna izquierda: logo de carrera + bandera debajo (como la web).
            Column(
                modifier = Modifier.align(
                    if (entry.isFeatured) Alignment.Top else Alignment.CenterVertically
                ),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                RaceLogo(url = race.logoUrl, size = 36.dp)
                // País efectivo: la jornada puede transcurrir en otro país que la
                // carrera (etapa que sale del extranjero) → gana el de la jornada,
                // que además vence al hideFlag de la carrera.
                val flagCc = entry.rd?.countryCode ?: race.countryCode
                if (!race.hideFlag || entry.rd?.countryCode != null) {
                    CountryFlag(countryCode = flagCc)
                }
            }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                // Nombre completo con el peso de los títulos de Hoy (16
                // seminegrita): pasa a una segunda línea en lugar de cortarse.
                Row(
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = race.localizedName,
                        modifier = Modifier.weight(1f, fill = false),
                        style = CCText.S16,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (RaceLogic.shouldShowFemaleIndicator(race)) {
                        Text(
                            text = "♀",
                            style = CCText.S12,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                if (entry.isGcFinal) {
                    // Las generales finales solo llevan su etiqueta (sin datos de etapa).
                    Text(
                        text = stringResource(R.string.results_feed_gc_final),
                        style = CCText.S13,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    val subtitle = feedSubtitle(entry)
                    val rd = entry.rd
                    val showType = rd?.primaryType == "itt" || rd?.primaryType == "ttt"
                    // Como en web e iOS: datos condensados y badge comparten línea.
                    if (subtitle.isNotEmpty() || showType) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            if (subtitle.isNotEmpty()) {
                                Text(
                                    text = subtitle,
                                    modifier = Modifier.weight(1f, fill = false),
                                    style = CCText.S13,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            if (showType) {
                                StageTypeBadge(
                                    primaryType = rd?.primaryType,
                                    secondaryType = if (
                                        rd?.primaryType == "itt" &&
                                        (rd.secondaryType == "chrono_climb" || rd.secondaryType == "summit_finish")
                                    ) rd.secondaryType else null,
                                    countryCode = race.countryCode,
                                    compact = true,
                                )
                            }
                        }
                    }
                }

                // Ganador (solo in-house con ganador resuelto/crudo).
                if (entry.kind == ResultsFeedLogic.Kind.INHOUSE && entry.winner.isNotEmpty()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.EmojiEvents,
                            contentDescription = stringResource(R.string.results_feed_winner_cd),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(14.dp),
                        )
                        Text(
                            text = entry.winner,
                            style = CCText.S13,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }

                if (entry.isFeatured && entry.complementary.isNotEmpty()) {
                    HorizontalDivider(
                        modifier = Modifier.padding(vertical = 2.dp),
                        color = MaterialTheme.colorScheme.outlineVariant,
                    )
                    entry.complementary.forEach { item ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            item.colorHex?.let {
                                Box(Modifier.size(7.dp).clip(androidx.compose.foundation.shape.CircleShape).background(colorFromHex(it)))
                            }
                            Text(
                                if (LocaleHolder.shouldShowEnglishContent) item.labelEn else item.labelEs,
                                style = CCText.S12,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (item.winner.isNotEmpty()) {
                                Text(item.winner, style = CCText.S12, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }

            app.calendariociclismo.android.ui.components.RaceCardChevron()
        }
    }
}

/**
 * Línea "Etapa N · NNN km · +N m" — "Etapa N" y los km en SemiBold,
 * en el idioma de CONTENIDO. Las pruebas de un día van sin etiqueta de etapa
 * (decisión 2026-06-11, igual que la web).
 */
private fun feedSubtitle(entry: ResultsFeedLogic.FeedEntry): AnnotatedString {
    val bold = SpanStyle(fontWeight = FontWeight.SemiBold)
    return buildAnnotatedString {
        var first = true
        fun appendSeparator() {
            if (!first) append(" · ")
            first = false
        }
        val stageLabel = when {
            entry.stageNumber == 0 -> LocaleHolder.t("Prólogo", "Prologue")
            entry.stageNumber != null -> LocaleHolder.t(
                "Etapa ${entry.stageNumber}${entry.stageSuffix}",
                "Stage ${entry.stageNumber}${entry.stageSuffix}",
            )
            else -> ""
        }
        if (stageLabel.isNotEmpty()) {
            appendSeparator()
            withStyle(bold) { append(stageLabel) }
        }
        val rd = entry.rd
        rd?.distanceFormatted?.let {
            appendSeparator()
            withStyle(bold) { append(it) }
        }
        rd?.elevationGainFormatted?.let {
            appendSeparator()
            append(it)
        }
    }
}

@Composable
private fun FeedEmptyState() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Outlined.EmojiEvents,
            contentDescription = null,
            modifier = Modifier.size(52.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.results_feed_empty),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
