package app.calendariociclismo.android.ui.transfers

import app.calendariociclismo.android.ui.components.ccSegmentedColors
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.SyncAlt
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.RiderTransfer
import app.calendariociclismo.android.data.model.TeamSeason
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.adaptive.rememberAdaptiveLayoutInfo
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.WholeWordText
import app.calendariociclismo.android.ui.components.CCHeaderMark
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.components.rememberLoadingVisible
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.startlist.TeamColorBands
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.TransfersLogic
import app.calendariociclismo.android.util.rememberHaptics

private sealed class MarketState {
    object Loading : MarketState()
    data class Ready(val data: TransfersLogic.MarketData) : MarketState()
    data class Error(val message: String) : MarketState()
}

/** Altura fija de la lista de cada panel en pantallas anchas (22rem web). */
private val FEED_HEIGHT = 352.dp

/** Altura de cada fila del feed: con la cabecera de día caben nueve filas en FEED_HEIGHT. */
private val FEED_ROW_HEIGHT = 35.dp

/**
 * Pestaña "Fichajes" (apps 4.0) — mercado de la temporada 2027, espejo de
 * /fichajes/ web (`js/fichajes.js`) y de `TransfersView` (iOS): paneles de
 * Fichajes y Renovaciones confirmados + divisiones (WT·PT·WWT·PRW) + parrilla
 * de equipos 2027 con el cuadrado de colores de Resultados (colores 2027
 * publicados o los de la temporada anterior mientras no lo estén). Tocar un
 * equipo abre [TransfersTeamScreen] (continúan / llegan / se marchan).
 *
 * En teléfono se ve un panel, elegido con el control segmentado, con el corte
 * corto del feed; en pantallas anchas los dos paneles van en paralelo, con
 * título y lista de altura fija desplazable (corte largo).
 *
 * En tablets y plegables abiertos (`AdaptiveLayoutPolicy.usesListDetail`) la
 * pantalla se divide, como `TransfersSplitView` en el iPad: en la columna
 * lateral, «Movimientos» y los equipos por división; en el detalle, los
 * paneles de Fichajes y Renovaciones o la página del equipo elegido.
 *
 * Solo-online (sin Room), como resultados/inscritos. La lógica pura vive en
 * `TransfersLogic` (testeada); aquí solo carga + render.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransfersScreen(navController: NavController, showBackArrow: Boolean) {
    val app = rememberApp()
    val haptic = rememberHaptics()
    val unknownError = stringResource(R.string.transfers_error)
    val title = stringResource(R.string.transfers_heading, TransfersLogic.MARKET_SEASON)

    var state by remember { mutableStateOf<MarketState>(MarketState.Loading) }
    var activeDivision by rememberSaveable { mutableStateOf(TransfersLogic.DIVISIONS.first()) }
    var activeFeed by rememberSaveable { mutableStateOf(TransfersFeed.Signings) }
    // Elemento de la columna lateral en lista y detalle: null es «Movimientos»;
    // un id, la página de ese equipo.
    var selectedTeamId by rememberSaveable { mutableStateOf<String?>(null) }
    var isRefreshing by remember { mutableStateOf(false) }
    val pullRefreshState = rememberPullToRefreshState()

    LaunchedEffect(Unit) { app.analytics.logScreenView("transfers") }

    suspend fun reload() {
        if (state !is MarketState.Ready) state = MarketState.Loading
        runCatching { app.repository.loadTransfersMarket(TransfersLogic.MARKET_SEASON) }
            .onSuccess { state = MarketState.Ready(it) }
            .onFailure { error ->
                if (state !is MarketState.Ready) {
                    state = MarketState.Error(error.message ?: unknownError)
                }
            }
    }

    LaunchedEffect(Unit) { reload() }
    LaunchedEffect(isRefreshing) {
        if (isRefreshing) {
            reload()
            isRefreshing = false
        }
    }

    val loadingVisible = rememberLoadingVisible(state is MarketState.Loading)

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CCHeaderMark()
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                navigationIcon = {
                    if (showBackArrow) {
                        IconButton(onClick = { navController.popBackStack() }) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = stringResource(R.string.action_back),
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            state = pullRefreshState,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            val current = state
            when {
                loadingVisible -> RouteLoadingView(message = stringResource(R.string.loading), title = title)
                current is MarketState.Error -> Text(
                    text = current.message,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    style = CCText.S14,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                current is MarketState.Ready -> MarketLayout(
                    data = current.data,
                    activeDivision = activeDivision,
                    activeFeed = activeFeed,
                    selectedTeamId = selectedTeamId,
                    onDivisionSelect = {
                        haptic(Haptics.Event.Selection)
                        activeDivision = it
                    },
                    onFeedSelect = {
                        haptic(Haptics.Event.Selection)
                        activeFeed = it
                    },
                    onTeamTap = { teamId ->
                        haptic(Haptics.Event.Navigation)
                        navController.navigate(Routes.transfersTeam(teamId))
                    },
                    onSidebarSelect = { teamId ->
                        if (teamId != selectedTeamId) haptic(Haptics.Event.Selection)
                        selectedTeamId = teamId
                    },
                    onOpenTeamInDetail = { teamId ->
                        haptic(Haptics.Event.Navigation)
                        selectedTeamId = teamId
                    },
                    onDeepLinkedTeam = { teamId, listDetail ->
                        if (listDetail) {
                            selectedTeamId = teamId
                        } else {
                            navController.navigate(Routes.transfersTeam(teamId))
                        }
                    },
                )
            }
        }
    }
}

/**
 * Elige entre la pantalla de una columna (teléfono, ventanas estrechas) y la
 * lista con detalle (tablets y plegables abiertos) por el ancho del contenedor.
 * El estado (división, panel, selección) vive en [TransfersScreen]: cruzar el
 * umbral al redimensionar la ventana lo conserva.
 */
@Composable
private fun MarketLayout(
    data: TransfersLogic.MarketData,
    activeDivision: String,
    activeFeed: TransfersFeed,
    selectedTeamId: String?,
    onDivisionSelect: (String) -> Unit,
    onFeedSelect: (TransfersFeed) -> Unit,
    onTeamTap: (String) -> Unit,
    onSidebarSelect: (String?) -> Unit,
    onOpenTeamInDetail: (String) -> Unit,
    onDeepLinkedTeam: (teamId: String, listDetail: Boolean) -> Unit,
) {
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    val pendingTeamId by TransfersDeepLink.pendingTeamId.collectAsState()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val listDetail = AdaptiveLayoutPolicy.usesListDetail(maxWidth.value, adaptiveInfo)
        // Equipo pedido por un enlace profundo: se abre según la disposición.
        LaunchedEffect(pendingTeamId, listDetail) {
            val teamId = pendingTeamId ?: return@LaunchedEffect
            TransfersDeepLink.consume(teamId)
            onDeepLinkedTeam(teamId, listDetail)
        }
        if (listDetail) {
            MarketListDetail(
                data = data,
                activeFeed = activeFeed,
                selectedTeamId = selectedTeamId,
                sidebarWidth = AdaptiveLayoutPolicy.listDetailSidebarDp(maxWidth.value).dp,
                onFeedSelect = onFeedSelect,
                onSidebarSelect = onSidebarSelect,
                onOpenTeam = onOpenTeamInDetail,
            )
        } else {
            MarketContent(
                data = data,
                activeDivision = activeDivision,
                activeFeed = activeFeed,
                onDivisionSelect = onDivisionSelect,
                onFeedSelect = onFeedSelect,
                onTeamTap = onTeamTap,
            )
        }
    }
}

/** Feeds de Fichajes y de Renovaciones con el corte largo de las listas desplazables. */
@Composable
private fun rememberFeeds(data: TransfersLogic.MarketData): Map<TransfersFeed, List<RiderTransfer>> =
    remember(data) {
        val categoryByTeamId = data.seasons.mapNotNull { season ->
            season.category?.let { season.teamId to it }
        }.toMap()
        // Listas de altura fija con desplazamiento propio en todos los
        // tamaños: admiten el historial largo.
        fun cut(feed: List<RiderTransfer>) = TransfersLogic.limitedFeed(
            feed,
            maxDays = TransfersLogic.FEED_SCROLL_MAX_DAYS,
            maxItems = TransfersLogic.FEED_SCROLL_MAX_ITEMS,
        )
        mapOf(
            TransfersFeed.Signings to cut(TransfersLogic.confirmedFeed(
                data.transfers, categoryByTeamId, data.teamNameById
            )),
            TransfersFeed.Renewals to cut(TransfersLogic.renewalFeed(
                data.transfers, categoryByTeamId, data.teamNameById
            )),
        )
    }

@Composable
private fun MarketContent(
    data: TransfersLogic.MarketData,
    activeDivision: String,
    activeFeed: TransfersFeed,
    onDivisionSelect: (String) -> Unit,
    onFeedSelect: (TransfersFeed) -> Unit,
    onTeamTap: (String) -> Unit,
) {
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = AdaptiveLayoutPolicy.feedColumns(maxWidth.value - 32f, adaptiveInfo) == 2
        val feeds = rememberFeeds(data)
        val teams = remember(data, activeDivision) {
            TransfersLogic.divisionTeams(data.seasons, activeDivision)
        }
        val feedLabels = mapOf(
            TransfersFeed.Signings to stringResource(R.string.transfers_feed_signings),
            TransfersFeed.Renewals to stringResource(R.string.transfers_feed_renewals),
        )

        // Una única rejilla perezosa: los paneles y los selectores ocupan toda
        // la fila y los equipos se reparten en columnas adaptativas.
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 160.dp),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // ── Fichajes y Renovaciones ────────────────────────────
            if (wide) {
                item(key = "feeds", span = { GridItemSpan(maxLineSpan) }) {
                    Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        TransfersFeed.entries.forEach { kind ->
                            FeedPanel(
                                title = feedLabels.getValue(kind),
                                feed = feeds[kind].orEmpty(),
                                data = data,
                                onTeamTap = onTeamTap,
                                wide = true,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            } else {
                item(key = "feed_choice", span = { GridItemSpan(maxLineSpan) }) {
                    MarketSegments(
                        options = TransfersFeed.entries,
                        selected = activeFeed,
                        label = { feedLabels.getValue(it) },
                        onSelect = onFeedSelect,
                    )
                }
                item(key = "feed", span = { GridItemSpan(maxLineSpan) }) {
                    FeedPanel(
                        title = null,
                        feed = feeds[activeFeed].orEmpty(),
                        data = data,
                        onTeamTap = onTeamTap,
                    )
                }
            }

            // ── Divisiones + parrilla de equipos ───────────────────
            item(key = "teams_title", span = { GridItemSpan(maxLineSpan) }) {
                Text(
                    text = stringResource(R.string.transfers_teams_title, TransfersLogic.MARKET_SEASON),
                    style = CCText.S16,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 18.dp).semantics { heading() },
                )
            }
            item(key = "divisions", span = { GridItemSpan(maxLineSpan) }) {
                MarketSegments(
                    options = TransfersLogic.DIVISIONS,
                    selected = activeDivision,
                    label = { it },
                    onSelect = onDivisionSelect,
                )
            }
            if (teams.isEmpty()) {
                item(key = "teams_empty", span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        text = stringResource(R.string.transfers_teams_empty),
                        style = CCText.S14,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                items(teams, key = { it.teamId }) { season ->
                    TeamTile(
                        season = season,
                        prev = data.prevSeasonsByTeamId,
                        onTap = { onTeamTap(season.teamId) },
                    )
                }
            }
        }
    }
}

/**
 * Lista con detalle (tablets y plegables abiertos), espejo de
 * `TransfersSplitView` (iOS): columna lateral con «Movimientos» y los equipos
 * por división; detalle con los paneles de Fichajes y Renovaciones o la página
 * del equipo elegido. Cada selección parte de una pantalla nueva.
 */
@Composable
private fun MarketListDetail(
    data: TransfersLogic.MarketData,
    activeFeed: TransfersFeed,
    selectedTeamId: String?,
    sidebarWidth: Dp,
    onFeedSelect: (TransfersFeed) -> Unit,
    onSidebarSelect: (String?) -> Unit,
    onOpenTeam: (String) -> Unit,
) {
    Row(Modifier.fillMaxSize()) {
        MarketSidebar(
            data = data,
            selectedTeamId = selectedTeamId,
            onSelect = onSidebarSelect,
            modifier = Modifier.width(sidebarWidth).fillMaxHeight(),
        )
        VerticalDivider()
        Box(Modifier.weight(1f).fillMaxHeight()) {
            key(selectedTeamId) {
                if (selectedTeamId == null) {
                    MovesDetail(
                        data = data,
                        activeFeed = activeFeed,
                        onFeedSelect = onFeedSelect,
                        onTeamTap = onOpenTeam,
                    )
                } else {
                    TransfersTeamPane(
                        teamId = selectedTeamId,
                        onLinkTeam = onOpenTeam,
                        market = data,
                        // La página de equipo ya separa 8 dp; con estos, 16 dp
                        // bajo la barra, como la columna lateral.
                        padding = PaddingValues(top = 8.dp),
                    )
                }
            }
        }
    }
}

/**
 * Columna lateral: «Movimientos» y los equipos por división, con la selección
 * marcada. 16 dp entre la barra superior y «Movimientos» (iPad:
 * `contentMargins` de la lista lateral).
 */
@Composable
private fun MarketSidebar(
    data: TransfersLogic.MarketData,
    selectedTeamId: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val divisions = remember(data) {
        TransfersLogic.DIVISIONS
            .map { division -> division to TransfersLogic.divisionTeams(data.seasons, division) }
            .filter { (_, teams) -> teams.isNotEmpty() }
    }
    LazyColumn(
        modifier = modifier,
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 16.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        item(key = "moves") {
            SidebarRow(selected = selectedTeamId == null, onClick = { onSelect(null) }) {
                Icon(
                    imageVector = Icons.Filled.SyncAlt,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    text = stringResource(R.string.transfers_moves),
                    style = CCText.S14,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
        divisions.forEach { (division, teams) ->
            item(key = "division_$division") {
                Text(
                    text = division,
                    style = CCText.S13,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .padding(start = 12.dp, end = 12.dp, top = 20.dp, bottom = 6.dp)
                        .semantics { heading() },
                )
            }
            items(teams, key = { "team_${it.teamId}" }) { season ->
                SidebarRow(selected = selectedTeamId == season.teamId, onClick = { onSelect(season.teamId) }) {
                    TransfersLogic.stripesTeam(season, data.prevSeasonsByTeamId)?.let { TeamColorBands(it) }
                    // Nombre completo: la palabra que no cabe baja a la segunda línea.
                    WholeWordText(
                        text = season.name.orEmpty(),
                        style = CCText.S14,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.weight(1f),
                    )
                    if (season.continuityDoubt) {
                        TransferStateChip(stringResource(R.string.transfers_team_doubt), TransferChipKind.Doubt)
                    }
                }
            }
        }
    }
}

/** Fila de la columna lateral; la seleccionada lleva el acento de los controles. */
@Composable
private fun SidebarRow(
    selected: Boolean,
    onClick: () -> Unit,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(CCRadius.Control))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f) else Color.Transparent)
            .selectable(selected = selected, onClick = onClick)
            .heightIn(min = 44.dp)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

/**
 * Detalle de «Movimientos»: los paneles de Fichajes y Renovaciones a la altura
 * de la columna. Con ancho para dos columnas van en paralelo, con título; si no,
 * un panel elegido con el control segmentado.
 */
@Composable
private fun MovesDetail(
    data: TransfersLogic.MarketData,
    activeFeed: TransfersFeed,
    onFeedSelect: (TransfersFeed) -> Unit,
    onTeamTap: (String) -> Unit,
) {
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    val feeds = rememberFeeds(data)
    val feedLabels = mapOf(
        TransfersFeed.Signings to stringResource(R.string.transfers_feed_signings),
        TransfersFeed.Renewals to stringResource(R.string.transfers_feed_renewals),
    )
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = AdaptiveLayoutPolicy.feedColumns(maxWidth.value - 32f, adaptiveInfo) == 2
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            if (wide) {
                Row(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    TransfersFeed.entries.forEach { kind ->
                        FeedPanel(
                            title = feedLabels.getValue(kind),
                            feed = feeds[kind].orEmpty(),
                            data = data,
                            onTeamTap = onTeamTap,
                            wide = true,
                            fillHeight = true,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            } else {
                MarketSegments(
                    options = TransfersFeed.entries,
                    selected = activeFeed,
                    label = { feedLabels.getValue(it) },
                    onSelect = onFeedSelect,
                )
                Spacer(Modifier.height(12.dp))
                FeedPanel(
                    title = null,
                    feed = feeds[activeFeed].orEmpty(),
                    data = data,
                    onTeamTap = onTeamTap,
                    fillHeight = true,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** Control segmentado nativo con el radio de control de la app. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> MarketSegments(
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
) {
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        options.forEachIndexed { index, option ->
            SegmentedButton(
                colors = ccSegmentedColors(),
                selected = option == selected,
                onClick = { if (option != selected) onSelect(option) },
                shape = SegmentedButtonDefaults.itemShape(
                    index = index,
                    count = options.size,
                    baseShape = RoundedCornerShape(CCRadius.Control),
                ),
                icon = {},
                label = { Text(label(option), style = CCText.S13, maxLines = 1) },
            )
        }
    }
}

/**
 * Panel de Fichajes o Renovaciones: superficie de tarjeta con filas separadas
 * por filete. En pantallas anchas lleva título y una lista de altura fija con
 * desplazamiento propio. Con `fillHeight` (columna de detalle de la lista con
 * detalle) el panel ocupa el alto disponible y la lista llega hasta el borde
 * inferior.
 */
@Composable
private fun FeedPanel(
    title: String?,
    feed: List<RiderTransfer>,
    data: TransfersLogic.MarketData,
    onTeamTap: (String) -> Unit,
    modifier: Modifier = Modifier,
    wide: Boolean = false,
    fillHeight: Boolean = false,
) {
    CCCard(modifier = if (fillHeight) modifier.fillMaxSize() else modifier.fillMaxWidth()) {
        Column(if (fillHeight) Modifier.fillMaxSize() else Modifier.fillMaxWidth()) {
            title?.let {
                Box(
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(
                        text = it,
                        style = CCText.S16,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                HorizontalDivider()
            }
            val rows: @Composable () -> Unit = { FeedRows(feed, data, onTeamTap, wide) }
            val listModifier = if (fillHeight) {
                Modifier.fillMaxWidth().weight(1f)
            } else {
                Modifier.fillMaxWidth().height(FEED_HEIGHT)
            }
            Column(listModifier.verticalScroll(rememberScrollState())) {
                rows()
            }
        }
    }
}

@Composable
private fun FeedRows(
    feed: List<RiderTransfer>,
    data: TransfersLogic.MarketData,
    onTeamTap: (String) -> Unit,
    wide: Boolean,
) {
    if (feed.isEmpty()) {
        Text(
            text = stringResource(R.string.transfers_feed_empty),
            style = CCText.S14,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(12.dp),
        )
        return
    }
    TransfersLogic.groupByDay(feed).forEach { (day, moves) ->
        Text(
            text = DateFormatting.formatDateWeekdayNoYear(day),
            style = CCText.S13,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 4.dp),
        )
        moves.forEach { move ->
            TransferFeedRow(transfer = move, data = data, onLinkTeam = onTeamTap, wide = wide)
            HorizontalDivider()
        }
    }
}

private enum class TransfersFeed { Signings, Renewals }

/**
 * Fila del feed: bandera + "Corredor → Destino" ("Corredor · Equipo" en renovaciones) + año de contrato o
 * «M. temporada» como texto gris. Sin superficie propia: va dentro del panel.
 */
@Composable
fun TransferFeedRow(
    transfer: RiderTransfer,
    data: TransfersLogic.MarketData,
    onLinkTeam: (String) -> Unit,
    wide: Boolean = false,
) {
    // Strings hoisted: buildAnnotatedString no admite llamadas @Composable.
    val unknownTeam = stringResource(R.string.transfers_unknown_team)
    val retires = stringResource(R.string.transfers_retires)
    val rider = data.ridersById[transfer.riderId]
    val dimColor = MaterialTheme.colorScheme.onSurfaceVariant
    // El feed contiene solo fichajes reales: enlaza al equipo de DESTINO si
    // ese equipo tiene ficha en el mercado 2027.
    val marketTeamIds = remember(data.seasons) { TransfersLogic.marketTeamIds(data.seasons) }
    val linkTeamId = transfer.toTeamId?.takeIf { it in marketTeamIds }
    val moveText = buildAnnotatedString {
        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
            append(rider?.fullName?.ifBlank { transfer.riderId } ?: transfer.riderId)
        }
        when (transfer.type) {
            "renewal" -> {
                // Punto central en todos los anchos (sin «renueva con»).
                withStyle(SpanStyle(color = dimColor)) { append(" · ") }
                append(TransfersLogic.teamLabel(transfer.toTeamId, transfer.toTeamName, data.teamNameById, unknownTeam))
            }
            "retirement" -> {
                append(" $retires ")
                withStyle(SpanStyle(color = dimColor)) {
                    append("(")
                    append(TransfersLogic.teamLabel(transfer.fromTeamId, transfer.fromTeamName, data.teamNameById, unknownTeam, TransfersLogic.TeamSide.FROM, data.teamNamePrev))
                    append(")")
                }
            }
            else -> {
                // Por falta de espacio en el feed móvil solo se muestra el equipo
                // de DESTINO (a dónde va), no el de origen. La flecha ya separa el
                // nombre del destino. El destino NO va en negrita: el nombre del
                // corredor ya lo está. Decisión Dani 2026-07-20.
                // El glifo «→» asienta cerca de la línea base: se sube para centrarlo.
                withStyle(SpanStyle(color = dimColor, baselineShift = BaselineShift(0.2f))) { append(" → ") }
                append(TransfersLogic.teamLabel(transfer.toTeamId, transfer.toTeamName, data.teamNameById, unknownTeam))
            }
        }
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (linkTeamId != null) Modifier.clickable { onLinkTeam(linkTeamId) } else Modifier)
            .height(FEED_ROW_HEIGHT)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        CountryFlag(countryCode = rider?.nationality, height = 11.dp)
        // Corredor + movimiento trunca con "…" a una línea; el año de
        // contrato (o el marcador de mitad de temporada) queda fijo a la derecha.
        Text(
            text = moveText,
            style = CCText.S14,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (transfer.midSeason) {
            ContractText(stringResource(R.string.transfers_mid_season))
        } else if (transfer.contractUntil != null) {
            ContractText(contractLabel(transfer.contractUntil))
        }
    }
}

/** Año de contrato (centinela 9999 = vitalicio → ∞). */
@Composable
internal fun contractLabel(year: Int): String =
    if (year == 9999) "∞" else stringResource(R.string.transfers_until, year)

/** Año de contrato o «M. temporada» como texto gris (`.tr-contract` web). */
@Composable
internal fun ContractText(text: String) {
    Text(
        text = text,
        style = CCText.S12.copy(fontFeatureSettings = "tnum"),
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
    )
}

/**
 * Tarjeta de equipo: superficie neutra con el cuadrado de colores de
 * Resultados delante del nombre (colores del mercado si están publicados; si
 * no, los de la temporada anterior).
 */
@Composable
private fun TeamTile(
    season: TeamSeason,
    prev: Map<String, TeamSeason>,
    onTap: () -> Unit,
) {
    CCCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 54.dp)
                .clickable(onClick = onTap)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    TransfersLogic.stripesTeam(season, prev)?.let { TeamColorBands(it) }
                    // Sin partir palabras: la que no cabe baja a la segunda línea y,
                    // si tampoco cabe allí, termina en puntos suspensivos.
                    WholeWordText(
                        text = season.name.orEmpty(),
                        style = CCText.S14,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (season.continuityDoubt) {
                    TransferStateChip(stringResource(R.string.transfers_team_doubt), TransferChipKind.Doubt)
                }
            }
            Icon(
                imageVector = Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

internal enum class TransferChipKind { Rumor, Doubt }

/**
 * Etiqueta de estado del mercado (`.tr-chip` web): 12 negrita, sin mayúsculas
 * forzadas, radio de control. Rumor en ámbar; duda en violeta, para que no se
 * lean como el mismo estado (un rumor es una noticia sin confirmar, una duda es
 * la ausencia de noticia).
 */
@Composable
internal fun TransferStateChip(text: String, kind: TransferChipKind) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val (foreground, background) = when (kind) {
        TransferChipKind.Rumor -> (if (dark) Color(0xFFFBBF24) else Color(0xFFA04607)) to Color(0xFFF59E0B).copy(alpha = 0.16f)
        TransferChipKind.Doubt -> (if (dark) Color(0xFFA78BFA) else Color(0xFF7C3AED)) to TRANSFERS_DOUBT_COLOR.copy(alpha = 0.16f)
    }
    Text(
        text = text,
        style = CCText.S12,
        fontWeight = FontWeight.Bold,
        color = foreground,
        maxLines = 1,
        modifier = Modifier
            .background(background, RoundedCornerShape(CCRadius.Control))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/**
 * Violeta de las DUDAS (corredor sin renovación despejada / equipo sin
 * continuidad confirmada). Espejo del `.tr-chip--doubt` de la web. Color propio
 * a propósito: el ámbar ya significa "rumor" y son estados distintos.
 */
val TRANSFERS_DOUBT_COLOR = Color(0xFF8B5CF6)
