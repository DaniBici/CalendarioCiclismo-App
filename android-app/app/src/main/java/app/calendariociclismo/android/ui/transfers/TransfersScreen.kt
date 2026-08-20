package app.calendariociclismo.android.ui.transfers

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.RiderTransfer
import app.calendariociclismo.android.data.model.Team
import app.calendariociclismo.android.data.model.TeamSeason
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.startlist.TeamBadgeComposable
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.TransfersLogic
import app.calendariociclismo.android.util.rememberHaptics

private sealed class MarketState {
    object Loading : MarketState()
    data class Ready(val data: TransfersLogic.MarketData) : MarketState()
    data class Error(val message: String) : MarketState()
}

private data class TransferSource(val name: String, val outlet: String, val url: String)

// Mismas cuentas acreditadas en /abierto.html.
private val transferSources = listOf(
    TransferSource("Nacho Labarga", "MARCA", "https://x.com/nacholabarga"),
    TransferSource("Dani Miranda", "AS", "https://x.com/danimiranda9"),
    TransferSource("Ciro Scognamiglio", "La Gazzetta dello Sport", "https://x.com/cirogazzetta"),
    TransferSource("Youri IJnsen", "WielerFlits", "https://x.com/Youri_IJnsen"),
    TransferSource("James Odvart", "DirectVelo", "https://x.com/OdvartJames"),
    TransferSource("Daniel Benson", "", "https://x.com/dnlbenson"),
    TransferSource("Bram Vandecapelle", "Het Laatste Nieuws", "https://x.com/bvdecape"),
)

/**
 * Pestaña "Fichajes" (apps 4.0) — mercado de la temporada 2027, espejo de
 * /fichajes/ web (`js/fichajes.js`): feed cronológico inverso de
 * CONFIRMACIONES + botones de división (WT·PT·WWT·PRW) + parrilla de equipos
 * 2027 (team_seasons; la chapa muestra los colores 2027 publicados, los
 * antiguos mientras no, o nada si el equipo es nuevo — ver [TransfersLogic.badgeSeason]).
 * Tocar un equipo abre [TransfersTeamScreen] (continúan / llegan / se marchan).
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

    var state by remember { mutableStateOf<MarketState>(MarketState.Loading) }
    var activeDivision by rememberSaveable { mutableStateOf(TransfersLogic.DIVISIONS.first()) }
    var activeFeed by rememberSaveable { mutableStateOf(TransfersFeed.Signings) }
    var isRefreshing by remember { mutableStateOf(false) }
    var showTransfersInfo by remember { mutableStateOf(false) }
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

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.transfers_heading, TransfersLogic.MARKET_SEASON),
                        style = MaterialTheme.typography.titleMedium,
                    )
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
                actions = {
                    IconButton(onClick = {
                        haptic(Haptics.Event.Selection)
                        showTransfersInfo = true
                    }) {
                        Icon(
                            imageVector = Icons.Outlined.Info,
                            contentDescription = stringResource(R.string.transfers_info_label),
                        )
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
            when (val current = state) {
                is MarketState.Loading -> RouteLoadingView(
                    message = stringResource(R.string.loading),
                )
                is MarketState.Error -> Text(
                    text = current.message,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    color = MaterialTheme.colorScheme.error,
                )
                is MarketState.Ready -> MarketContent(
                    data = current.data,
                    activeDivision = activeDivision,
                    activeFeed = activeFeed,
                    onDivisionSelect = { activeDivision = it },
                    onFeedSelect = { activeFeed = it },
                    onTeamTap = { teamId ->
                        haptic(Haptics.Event.Navigation)
                        navController.navigate(Routes.transfersTeam(teamId))
                    },
                )
            }
        }
    }

    if (showTransfersInfo) {
        TransfersInfoDialog(onDismiss = { showTransfersInfo = false })
    }
}

@Composable
private fun TransfersInfoDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.transfers_info_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.transfers_info_text))
                Spacer(Modifier.height(12.dp))
                transferSources.forEach { source ->
                    Row {
                        Text(
                            text = source.name,
                            color = MaterialTheme.colorScheme.primary,
                            textDecoration = TextDecoration.Underline,
                            modifier = Modifier.clickable {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(source.url)))
                            },
                        )
                        if (source.outlet.isNotEmpty()) {
                            Text(" (${source.outlet})")
                        }
                    }
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
private fun MarketContent(
    data: TransfersLogic.MarketData,
    activeDivision: String,
    activeFeed: TransfersFeed,
    onDivisionSelect: (String) -> Unit,
    onFeedSelect: (TransfersFeed) -> Unit,
    onTeamTap: (String) -> Unit,
) {
    val feed = remember(data, activeFeed) {
        val moves = when (activeFeed) {
            TransfersFeed.Signings -> TransfersLogic.confirmedFeed(data.transfers)
            TransfersFeed.Renewals -> TransfersLogic.renewalFeed(data.transfers)
        }
        TransfersLogic.limitedFeed(moves)
    }
    val feedByDay = remember(feed) { TransfersLogic.groupByDay(feed) }
    val teams = remember(data, activeDivision) {
        TransfersLogic.divisionTeams(data.seasons, activeDivision)
    }

    // Un único scroll para que las confirmaciones puedan ocupar lo que necesitan
    // y todos los equipos sigan siendo alcanzables sin pelear con dos paneles.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        // ── Confirmaciones ─────────────────────────────────────────
        SectionTitle(stringResource(R.string.transfers_feed_title), topPadding = 4.dp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FeedChip(stringResource(R.string.transfers_feed_signings), activeFeed == TransfersFeed.Signings) {
                onFeedSelect(TransfersFeed.Signings)
            }
            FeedChip(stringResource(R.string.transfers_feed_renewals), activeFeed == TransfersFeed.Renewals) {
                onFeedSelect(TransfersFeed.Renewals)
            }
        }
        Spacer(Modifier.height(14.dp))
        if (feed.isEmpty()) {
            Text(
                text = stringResource(R.string.transfers_feed_empty),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 4.dp),
            )
        } else {
            feedByDay.forEach { (day, moves) ->
                Text(
                    text = DateFormatting.formatDateWeekdayNoYear(day),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 10.dp, bottom = 4.dp),
                )
                moves.forEach { move ->
                    TransferFeedRow(transfer = move, data = data, onLinkTeam = onTeamTap)
                    Spacer(Modifier.height(6.dp))
                }
            }
        }

        HorizontalDivider(
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f),
            modifier = Modifier.padding(top = 14.dp),
        )

        // ── Divisiones + parrilla de equipos ───────────────────────
        SectionTitle(stringResource(R.string.transfers_teams_title, TransfersLogic.MARKET_SEASON))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TransfersLogic.DIVISIONS.forEach { div ->
                DivisionChip(label = div, selected = div == activeDivision) {
                    onDivisionSelect(div)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        if (teams.isEmpty()) {
            Text(
                text = stringResource(R.string.transfers_teams_empty),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            teams.chunked(4).forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    row.forEach { season ->
                        TeamTile(
                            season = season,
                            prev = data.prevSeasonsByTeamId,
                            onTap = { onTeamTap(season.teamId) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}

private enum class TransfersFeed { Signings, Renewals }

@Composable
private fun SectionTitle(text: String, topPadding: androidx.compose.ui.unit.Dp = 18.dp) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.8.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = topPadding, bottom = 8.dp),
    )
}

/**
 * Píldora de división — mismo tamaño que los filtros de categoría de la vista
 * Hoy (`CategoryChip`): labelMedium + padding 12/6 + esquina 50%. Activo =
 * relleno accent-dim + texto accent.
 */
@Composable
private fun DivisionChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant)
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
private fun FeedChip(label: String, selected: Boolean, onClick: () -> Unit) =
    DivisionChip(label, selected, onClick)

/** Fila del feed: bandera + "Corredor → Destino" + marcador Mid-Season si aplica. */
@Composable
fun TransferFeedRow(
    transfer: RiderTransfer,
    data: TransfersLogic.MarketData,
    onLinkTeam: (String) -> Unit,
) {
    // Strings hoisted: buildAnnotatedString no admite llamadas @Composable.
    val unknownTeam = stringResource(R.string.transfers_unknown_team)
    val renewsWith = stringResource(R.string.transfers_renews_with)
    val retires = stringResource(R.string.transfers_retires)
    val rider = data.ridersById[transfer.riderId]
    val dimColor = MaterialTheme.colorScheme.onSurfaceVariant
    // El feed contiene solo fichajes reales: enlaza al equipo de DESTINO si
    // ese equipo tiene ficha en el mercado 2027.
    val marketTeamIds = remember(data.seasons) { data.seasons.map { it.teamId }.toHashSet() }
    val linkTeamId = transfer.toTeamId?.takeIf { it in marketTeamIds }
    val moveText = buildAnnotatedString {
        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
            append(rider?.fullName?.ifBlank { transfer.riderId } ?: transfer.riderId)
        }
        when (transfer.type) {
            "renewal" -> {
                // Al no haber flecha, se separa explícitamente del nombre.
                append(" ")
                append(renewsWith)
                append(" ")
                append(TransfersLogic.teamLabel(transfer.toTeamId, transfer.toTeamName, data.teamNameById, unknownTeam))
            }
            "retirement" -> {
                withStyle(SpanStyle(color = dimColor)) { append("  ·  ") }
                append(retires)
                append(" (")
                append(TransfersLogic.teamLabel(transfer.fromTeamId, transfer.fromTeamName, data.teamNameById, unknownTeam, TransfersLogic.TeamSide.FROM, data.teamNamePrev))
                append(")")
            }
            else -> {
                // Por falta de espacio en el feed móvil solo se muestra el equipo
                // de DESTINO (a dónde va), no el de origen. La flecha ya separa el
                // nombre del destino → sin divisor "·". El destino NO va en negrita:
                // el nombre del corredor ya lo está. Decisión Dani 2026-07-20.
                withStyle(
                    SpanStyle(
                        color = dimColor,
                        baselineShift = BaselineShift(0.12f),
                    ),
                ) { append("  →  ") }
                append(TransfersLogic.teamLabel(transfer.toTeamId, transfer.toTeamName, data.teamNameById, unknownTeam))
            }
        }
    }
    CCCard(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (linkTeamId != null) Modifier.clickable { onLinkTeam(linkTeamId) } else Modifier),
        cornerRadius = 12,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CountryFlag(countryCode = rider?.nationality, height = 11.dp)
            // Corredor + movimiento trunca con "…" a una línea; el año de
            // contrato (o el marcador de mitad de temporada) queda fijo a la derecha.
            Text(
                text = moveText,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (transfer.midSeason) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color(0xFF2563EB).copy(alpha = 0.14f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(
                        text = stringResource(R.string.transfers_mid_season),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF2563EB),
                    )
                }
            } else if (transfer.contractUntil != null) {
                TransferContractBadge(transfer.contractUntil)
            }
        }
    }
}

/** Badge neutro del año de fin de contrato en el feed de confirmaciones. */
@Composable
private fun TransferContractBadge(year: Int) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.10f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = if (year == 9999) "∞" else stringResource(R.string.transfers_until, year),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Tarjeta compacta de equipo: chapa efectiva encima del nombre de dos líneas. */
@Composable
private fun TeamTile(
    season: TeamSeason,
    prev: Map<String, TeamSeason>,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    CCCard(modifier = modifier.height(104.dp), cornerRadius = 12) {
        Column(
            modifier = Modifier.fillMaxSize().clickable(onClick = onTap).padding(6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // Sin chapa no se invoca para que el nombre no arrastre un hueco.
            val badge = TransfersLogic.badgeSeason(season, prev)
            if (badge != null) {
                SeasonBadge(season = badge, size = 32)
            }
            Spacer(Modifier.height(5.dp))
            if (season.continuityDoubt) {
                // El distintivo queda pegado al nombre; solo estas tarjetas
                // redistribuyen su contenido dentro de la altura fija.
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    TeamTileName(season.name.orEmpty())
                    TeamDoubtBadge()
                }
            } else {
                TeamTileName(season.name.orEmpty(), reserveTwoLines = true)
            }
        }
    }
}

@Composable
private fun TeamTileName(name: String, reserveTwoLines: Boolean = false) {
    Text(
        text = name,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        modifier = if (reserveTwoLines) Modifier.height(28.dp) else Modifier,
    )
}

@Composable
private fun TeamDoubtBadge() {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(TRANSFERS_DOUBT_COLOR.copy(alpha = 0.16f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = stringResource(R.string.transfers_team_doubt).uppercase(),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            fontSize = 8.sp,
            color = TRANSFERS_DOUBT_COLOR,
        )
    }
}

/**
 * Chapa de un equipo del mercado. Se le pasa la fila (del mercado o la anterior)
 * cuyos colores hay que pintar; la decisión de CUÁL —o si no hay chapa— vive en
 * [TransfersLogic.badgeSeason]: colores del mercado publicados → 2027; sin
 * publicar pero equipo preexistente → colores antiguos (2026); equipo nuevo →
 * nada. Espejo de `badgeOrPlaceholder` (web) y `TransfersSeasonBadge` (iOS).
 *
 * ⚠️ Los call sites viven en `Row(Arrangement.spacedBy(...))`, donde un
 * composable vacío gastaría el spacing igual y dejaría un hueco. Por eso se
 * gatean con `if (badgeSeason(...) != null)` y solo invocan esto cuando hay chapa.
 */
@Composable
fun SeasonBadge(season: TeamSeason, size: Int) {
    TeamBadgeComposable(team = season.toBadgeTeam(), size = size)
}

/**
 * Violeta de las DUDAS (corredor sin renovación despejada / equipo sin
 * continuidad confirmada). Espejo del `.tr-chip--doubt` de la web. Color propio
 * a propósito: el ámbar ya significa "rumor" y son estados distintos.
 */
val TRANSFERS_DOUBT_COLOR = Color(0xFF8B5CF6)

/** Team mínimo para pintar la chapa con los colores de la temporada. */
fun TeamSeason.toBadgeTeam(): Team = Team(
    id = teamId,
    name = name.orEmpty(),
    badgeTorsoCenter = badgeTorsoCenter ?: "#ffffff",
    badgeTorsoSides = badgeTorsoSides ?: "#111111",
    badgeShorts = badgeShorts ?: "#111111",
    badgeInnerCircle = badgeInnerCircle,
    headerBg = headerBg ?: "#1f2937",
    headerText = headerText ?: "#ffffff",
    category = category,
)
