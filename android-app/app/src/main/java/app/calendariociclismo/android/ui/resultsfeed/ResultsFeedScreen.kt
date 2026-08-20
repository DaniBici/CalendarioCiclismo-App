package app.calendariociclismo.android.ui.resultsfeed

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.UciTeamRankingRow
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.components.StageTypeBadge
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.ui.theme.categoryBadgeColor
import app.calendariociclismo.android.ui.today.ResultsDialog
import app.calendariociclismo.android.ui.today.ResultsDialogItem
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.ResultsFeedLogic
import app.calendariociclismo.android.util.UciTeamRankingLogic
import app.calendariociclismo.android.util.UciTeamRankingPresentation
import app.calendariociclismo.android.util.UciTeamRankingTier
import app.calendariociclismo.android.util.rememberHaptics
import java.text.NumberFormat
import java.util.Locale

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

    val todayKey = remember { DateFormatting.todayKey() }
    var fromKey by remember {
        val initial = DateFormatting.dayOffset(todayKey, -(WINDOW_DAYS - 1)) ?: todayKey
        mutableStateOf(maxOf(initial, SEASON_START))
    }
    var state by remember { mutableStateOf<FeedState>(FeedState.Loading) }
    var loadingMore by remember { mutableStateOf(false) }
    var isRefreshing by remember { mutableStateOf(false) }
    var resultsDialogItem by remember { mutableStateOf<ResultsDialogItem?>(null) }
    var activeSection by rememberSaveable { mutableStateOf(ResultsSection.Latest) }
    var rankingGender by rememberSaveable { mutableStateOf(RankingGender.Male) }
    var rankingState by remember { mutableStateOf<RankingState>(RankingState.Loading) }
    var rankingLoaded by remember { mutableStateOf(false) }
    var rankingRefreshing by remember { mutableStateOf(false) }
    var showRankingInfo by remember { mutableStateOf(false) }
    var rankingExplanation by remember { mutableStateOf<RankingExplanation?>(null) }
    val pullRefreshState = rememberPullToRefreshState()
    val rankingPullRefreshState = rememberPullToRefreshState()

    LaunchedEffect(Unit) { app.analytics.logScreenView("results_feed") }

    // Refetch del rango actual [fromKey, hoy]. Compartido por la carga inicial,
    // el "Cargar más" (al ampliar fromKey) y el pull-to-refresh. Igual que la
    // web: las filas existentes se mantienen visibles mientras llega la recarga.
    suspend fun reload() {
        if (state !is FeedState.Ready) state = FeedState.Loading
        runCatching {
            val entries = app.repository.loadResultsFeedWindow(fromKey, todayKey)
            app.repository.resolveFeedWinners(entries)
        }.onSuccess { entries ->
            state = FeedState.Ready(entries)
        }.onFailure { error ->
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
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.results_feed_heading),
                        style = MaterialTheme.typography.titleMedium,
                    )
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
                                val loadingCd = stringResource(R.string.loading)
                                RouteLoadingView(message = loadingCd)
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
                                        showLoadMore = fromKey > SEASON_START,
                                        loadingMore = loadingMore,
                                        onLoadMore = {
                                            haptic(Haptics.Event.PrimaryAction)
                                            loadingMore = true
                                            val next = DateFormatting.dayOffset(fromKey, -WINDOW_DAYS) ?: SEASON_START
                                            fromKey = maxOf(next, SEASON_START)
                                        },
                                        onEntryTap = { entry ->
                                            if (entry.kind == ResultsFeedLogic.Kind.INHOUSE) {
                                                haptic(Haptics.Event.Navigation)
                                                navController.navigate(
                                                    Routes.results(entry.race.id, entry.stageNumber)
                                                )
                                            } else {
                                                val rd = entry.rd ?: return@FeedList
                                                haptic(Haptics.Event.PrimaryAction)
                                                resultsDialogItem = ResultsDialogItem(entry.race, rd)
                                            }
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
                            onGenderSelect = {
                                haptic(Haptics.Event.Selection)
                                rankingGender = it
                            },
                            onRetry = { rankingRefreshing = true },
                            onInfoClick = {
                                haptic(Haptics.Event.Selection)
                                showRankingInfo = true
                            },
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

    // Fallback FC/PCS: reusa el diálogo existente de las cards de Hoy.
    resultsDialogItem?.let { item ->
        ResultsDialog(item = item, context = context, onDismiss = { resultsDialogItem = null })
    }
    if (showRankingInfo) {
        val rows = (rankingState as? RankingState.Ready)?.rows.orEmpty()
        UciRankingInfoDialog(
            rows = UciTeamRankingLogic.decorate(rows, rankingGender.value),
            gender = rankingGender,
            onDismiss = { showRankingInfo = false },
        )
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

@Composable
private fun ResultsSectionSelector(
    active: ResultsSection,
    onSelect: (ResultsSection) -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        RankingChip(
            label = stringResource(R.string.results_feed_latest),
            selected = active == ResultsSection.Latest,
            onClick = { onSelect(ResultsSection.Latest) },
        )
        RankingChip(
            label = stringResource(R.string.uci_ranking_tab),
            selected = active == ResultsSection.Ranking,
            onClick = { onSelect(ResultsSection.Ranking) },
        )
    }
}

@Composable
private fun RankingChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(
                if (selected) primary.copy(alpha = 0.15f)
                else MaterialTheme.colorScheme.surfaceVariant
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun UciRankingContent(
    state: RankingState,
    gender: RankingGender,
    onGenderSelect: (RankingGender) -> Unit,
    onRetry: () -> Unit,
    onInfoClick: () -> Unit,
    onRowTap: (UciTeamRankingPresentation) -> Unit,
) {
    when (state) {
        is RankingState.Loading -> RouteLoadingView(
            message = stringResource(R.string.uci_ranking_loading),
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
            val rows = remember(state.rows, gender) {
                UciTeamRankingLogic.decorate(state.rows, gender.value)
            }
            Column(Modifier.fillMaxSize()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth().padding(
                        start = 16.dp,
                        end = 16.dp,
                        top = 10.dp,
                        bottom = 6.dp,
                    ),
                ) {
                    RankingChip(
                        label = stringResource(R.string.uci_ranking_men),
                        selected = gender == RankingGender.Male,
                        onClick = { onGenderSelect(RankingGender.Male) },
                    )
                    RankingChip(
                        label = stringResource(R.string.uci_ranking_women),
                        selected = gender == RankingGender.Female,
                        onClick = { onGenderSelect(RankingGender.Female) },
                    )
                }
                rows.firstOrNull()?.row?.rankingDate?.let { rankingDate ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(
                            start = 16.dp,
                            end = 16.dp,
                            top = 2.dp,
                        ),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = DateFormatting.formatUciRankingUpdated(
                                rankingDate,
                                LocaleHolder.shouldShowEnglishContent,
                            ),
                            modifier = Modifier.weight(1f),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 12.sp,
                            maxLines = 1,
                            softWrap = false,
                            overflow = TextOverflow.Ellipsis,
                        )
                        IconButton(
                            onClick = onInfoClick,
                            modifier = Modifier.size(28.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Info,
                                contentDescription = stringResource(R.string.uci_ranking_info_label),
                                modifier = Modifier.size(17.dp),
                            )
                        }
                    }
                }
                if (rows.isEmpty()) {
                    Text(
                        text = stringResource(R.string.uci_ranking_empty),
                        modifier = Modifier.align(Alignment.CenterHorizontally).padding(24.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    UciRankingList(rows = rows, onRowTap = onRowTap)
                }
            }
        }
    }
}

@Composable
private fun UciRankingList(
    rows: List<UciTeamRankingPresentation>,
    onRowTap: (UciTeamRankingPresentation) -> Unit,
) {
    val locale = remember(LocaleHolder.shouldShowEnglishContent) {
        if (LocaleHolder.shouldShowEnglishContent) Locale.UK else Locale.forLanguageTag("es-ES")
    }
    val pointsFormatter = remember(locale) {
        NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = 0
            maximumFractionDigits = 0
        }
    }
    LazyColumn(
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(key = "ranking-header") {
            UciRankingHeader()
        }
        items(rows, key = { it.id }) { item ->
            Column {
                UciRankingRow(
                    item = item,
                    points = pointsFormatter.format(item.row.points),
                    onClick = { onRowTap(item) },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable
private fun UciRankingHeader() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(
            "#",
            modifier = Modifier.width(27.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
            fontSize = 10.sp,
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
        Spacer(Modifier.width(18.dp))
        Text(
            stringResource(R.string.uci_ranking_team),
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
            fontSize = 10.sp,
        )
        Text(
            "Cat.",
            modifier = Modifier.width(32.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
            fontSize = 10.sp,
        )
        Text(
            stringResource(R.string.uci_ranking_points),
            modifier = Modifier.width(68.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
            fontSize = 10.sp,
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
    }
}

@Composable
private fun UciRankingRow(
    item: UciTeamRankingPresentation,
    points: String,
    onClick: () -> Unit,
) {
    val dark = isSystemInDarkTheme()
    val orange = if (dark) Color(0xFFFFB77C) else Color(0xFFE37400)
    val green = if (dark) Color(0xFF6DD58C) else Color(0xFF137333)
    val red = if (dark) Color(0xFFFFB4AB) else Color(0xFFC5221F)
    val background = if (item.grandTourExcluded) {
        red.copy(alpha = 0.13f)
    } else {
        when (item.invitationTier) {
            UciTeamRankingTier.WORLD_TOUR -> categoryBadgeColor("1.UWT").background
            UciTeamRankingTier.ALL_WORLD_TOUR,
            UciTeamRankingTier.WOMENS_WORLD_TOUR -> orange.copy(alpha = 0.15f)
            UciTeamRankingTier.PRO_SERIES -> green.copy(alpha = 0.15f)
            UciTeamRankingTier.STANDARD -> Color.Transparent
        }
    }
    val explanation = item.explanation(LocaleHolder.shouldShowEnglishContent)
    val clickableModifier = if (explanation.isNotEmpty()) {
        Modifier.clickable(role = Role.Button, onClick = onClick)
    } else {
        Modifier
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(background)
            .then(clickableModifier),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Text(
                text = item.row.rank.toString(),
                modifier = Modifier.width(27.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.End,
            )
            Box(Modifier.width(18.dp), contentAlignment = Alignment.Center) {
                CountryFlag(countryCode = item.row.countryCode, height = 13.5.dp)
            }
            Text(
                text = item.row.displayName,
                modifier = Modifier.weight(1f),
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = item.row.teamCategory.orEmpty(),
                modifier = Modifier.width(32.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Bold,
                fontSize = 10.sp,
            )
            Text(
                text = points,
                modifier = Modifier.width(68.dp),
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.End,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

@Composable
private fun UciRankingInfoDialog(
    rows: List<UciTeamRankingPresentation>,
    gender: RankingGender,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val updated = rows.firstOrNull()?.row?.rankingDate
        ?.let {
            DateFormatting.formatUciRankingUpdated(
                it,
                LocaleHolder.shouldShowEnglishContent,
            )
        } ?: if (LocaleHolder.shouldShowEnglishContent) "Updated: —" else "Actualizado: —"
    val sourceUrl = rows.firstOrNull()?.row?.sourceUrl
    val regulationsUrl =
        "https://assets.ctfassets.net/761l7gh5x5an/6FEzFHeA2oKMBGb5sdIvQ7/" +
            "96aad776f210fc38853ec9bf9ec9acba/2-ROA-20260701-E.pdf"
    val dark = isSystemInDarkTheme()
    val orange = if (dark) Color(0xFFFFB77C) else Color(0xFFE37400)
    val green = if (dark) Color(0xFF6DD58C) else Color(0xFF137333)
    val red = if (dark) Color(0xFFFFB4AB) else Color(0xFFC5221F)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.uci_ranking_info_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.uci_ranking_updated, updated))
                Spacer(Modifier.height(12.dp))
                Text(
                    text = stringResource(R.string.uci_ranking_projection),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(14.dp))
                RankingLegendRow(
                    categoryBadgeColor("1.UWT").background,
                    stringResource(
                        if (gender == RankingGender.Male) {
                            R.string.uci_ranking_legend_worldteams
                        } else {
                            R.string.uci_ranking_legend_womens_worldteams
                        },
                    ),
                )
                RankingLegendRow(
                    orange.copy(alpha = 0.15f),
                    stringResource(
                        if (gender == RankingGender.Male) {
                            R.string.uci_ranking_legend_worldtour
                        } else {
                            R.string.uci_ranking_legend_womens_worldtour
                        },
                    ),
                )
                if (gender == RankingGender.Male) {
                    RankingLegendRow(
                        green.copy(alpha = 0.15f),
                        stringResource(R.string.uci_ranking_legend_proseries),
                    )
                    RankingLegendRow(
                        red.copy(alpha = 0.13f),
                        stringResource(R.string.uci_ranking_legend_top30),
                    )
                }
                Spacer(Modifier.height(10.dp))
                sourceUrl?.let { url ->
                    TextButton(onClick = {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    }) {
                        Text(stringResource(R.string.uci_ranking_source))
                    }
                }
                TextButton(onClick = {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(regulationsUrl)))
                }) {
                    Text(stringResource(R.string.uci_ranking_regulations))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.action_close))
            }
        },
    )
}

@Composable
private fun RankingLegendRow(color: Color, text: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
        modifier = Modifier.padding(vertical = 4.dp),
    ) {
        Box(
            modifier = Modifier
                .size(width = 34.dp, height = 16.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(color)
                .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(4.dp)),
        )
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun FeedList(
    entries: List<ResultsFeedLogic.FeedEntry>,
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
    LazyColumn(
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        grouped.forEach { (date, dayEntries) ->
            item(key = "hdr-$date") {
                // Cabecera de día en el idioma de CONTENIDO (no el locale del
                // dispositivo) — mismo criterio que las fechas de cabecera de etapa.
                Text(
                    text = DateFormatting.formatDateLongContent(date),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp, bottom = 2.dp, start = 4.dp),
                )
            }
            items(
                dayEntries,
                key = { e -> e.stageRefId ?: "ext-${e.rd?.id ?: e.race.id}-${e.stageNumber ?: "f"}" },
            ) { entry ->
                FeedEntryRow(entry = entry, onClick = { onEntryTap(entry) })
            }
        }
        if (showLoadMore) {
            item(key = "load-more") {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    OutlinedButton(onClick = onLoadMore, enabled = !loadingMore) {
                        if (loadingMore) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(stringResource(R.string.results_feed_load_more))
                        }
                    }
                }
            }
        }
    }
}

/**
 * Fila del feed — mimetiza la card de Hoy (`RaceCard`): superficie CCCard con
 * el tinte del color de la carrera, logo 36dp con la bandera debajo, nombre con
 * la tipografía de card, línea "Etapa N · NNN km · +N.NNN m" + badge de tipo
 * solo para contrarrelojes, y tercera línea trofeo + ganador en
 * SemiBold. Las generales finales llevan etiqueta propia y tinte algo más
 * fuerte (espejo de `.feed-row--gc` en la web).
 */
@Composable
private fun FeedEntryRow(
    entry: ResultsFeedLogic.FeedEntry,
    onClick: () -> Unit,
) {
    val race = entry.race
    CCCard(
        accent = race.colorHex?.let { colorFromHex(it, fallback = MaterialTheme.colorScheme.outlineVariant) },
        // Mismo 4% tenue que las cards de Hoy; las generales finales, un punto más.
        accentAlpha = if (entry.isGcFinal) 0.10f else 0.04f,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = onClick)
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Columna izquierda: logo de carrera + bandera debajo (como la web).
            Column(
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
                // Nombre — misma tipografía que las cards de Hoy (Medium 14/16).
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = race.localizedName,
                        fontWeight = FontWeight.Medium,
                        fontSize = 14.sp,
                        lineHeight = 16.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (RaceLogic.shouldShowFemaleIndicator(race)) {
                        Text(
                            text = "♀",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.tertiary,
                        )
                    }
                }

                if (entry.isGcFinal) {
                    // Las generales finales solo llevan su etiqueta (sin datos de etapa).
                    Text(
                        text = stringResource(R.string.results_feed_gc_final),
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.sp,
                        lineHeight = 14.sp,
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
                                    fontWeight = FontWeight.Normal,
                                    fontSize = 12.sp,
                                    lineHeight = 14.sp,
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
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                            lineHeight = 14.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            Icon(
                imageVector = Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                modifier = Modifier.size(20.dp),
            )
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
            entry.stageNumber != null -> LocaleHolder.t("Etapa ${entry.stageNumber}", "Stage ${entry.stageNumber}")
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
