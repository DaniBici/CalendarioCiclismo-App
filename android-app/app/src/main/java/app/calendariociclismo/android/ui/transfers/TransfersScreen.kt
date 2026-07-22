package app.calendariociclismo.android.ui.transfers

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
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

/**
 * Pestaña "Fichajes" (apps 4.0) — mercado de la temporada 2027, espejo de
 * /fichajes/ web (`js/fichajes.js`): feed cronológico inverso de
 * CONFIRMACIONES + botones de división (WT·WWT·PT·PRW) + lista de equipos
 * 2027 (team_seasons; la chapa muestra los colores 2027 publicados, los
 * antiguos mientras no, o nada si el equipo es nuevo — ver [TransfersLogic.badgeSeason]).
 * Tocar un equipo abre [TransfersTeamScreen] (continúan / llegan / se marchan).
 *
 * Solo-online (sin Room), como resultados/inscritos. La lógica pura vive en
 * `TransfersLogic` (testeada); aquí solo carga + render.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransfersScreen(navController: NavController) {
    val app = rememberApp()
    val haptic = rememberHaptics()
    val unknownError = stringResource(R.string.transfers_error)

    var state by remember { mutableStateOf<MarketState>(MarketState.Loading) }
    var activeDivision by rememberSaveable { mutableStateOf(TransfersLogic.DIVISIONS.first()) }
    var isRefreshing by remember { mutableStateOf(false) }
    val pullRefreshState = rememberPullToRefreshState()

    // Se llega a Fichajes por la pestaña principal (sin nada detrás en el back
    // stack → sin flecha) o desde el cintillo de Hoy (apilado sobre Hoy → con
    // flecha), ya que en ese caso la barra inferior se oculta y no habría otra
    // forma de volver. Espejo de la salida condicional del cintillo en iOS.
    val showBackArrow = navController.previousBackStackEntry != null

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
                is MarketState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                is MarketState.Error -> Text(
                    text = current.message,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    color = MaterialTheme.colorScheme.error,
                )
                is MarketState.Ready -> MarketContent(
                    data = current.data,
                    activeDivision = activeDivision,
                    onDivisionSelect = { activeDivision = it },
                    onTeamTap = { teamId ->
                        haptic(Haptics.Event.Navigation)
                        navController.navigate(Routes.transfersTeam(teamId))
                    },
                )
            }
        }
    }
}

@Composable
private fun MarketContent(
    data: TransfersLogic.MarketData,
    activeDivision: String,
    onDivisionSelect: (String) -> Unit,
    onTeamTap: (String) -> Unit,
) {
    val feed = remember(data) { TransfersLogic.limitedFeed(TransfersLogic.confirmedFeed(data.transfers)) }
    val feedByDay = remember(feed) { TransfersLogic.groupByDay(feed) }
    val teams = remember(data, activeDivision) {
        TransfersLogic.divisionTeams(data.seasons, activeDivision)
    }

    // Doble panel: "Últimas confirmaciones" (arriba, ~38%) y equipos (abajo,
    // ~62%), cada uno con su propio scroll → ambos siempre visibles.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        // ── Panel 1: feed de confirmaciones ────────────────────────
        Column(modifier = Modifier.weight(0.38f)) {
            // Primer título: pegado al top bar → sin el top de 18dp (que sí
            // separa el título de "equipos" del feed de arriba).
            SectionTitle(stringResource(R.string.transfers_feed_title), topPadding = 4.dp)
            LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                if (feed.isEmpty()) {
                    item(key = "feed_empty") {
                        Text(
                            text = stringResource(R.string.transfers_feed_empty),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    }
                } else {
                    feedByDay.forEach { (day, moves) ->
                        item(key = "day_$day") {
                            Text(
                                text = DateFormatting.formatDateWeekdayNoYear(day),
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 10.dp, bottom = 4.dp),
                            )
                        }
                        items(moves.size, key = { i -> "move_${moves[i].id}" }) { i ->
                            TransferFeedRow(transfer = moves[i], data = data)
                            Spacer(Modifier.height(6.dp))
                        }
                    }
                }
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f))

        // ── Panel 2: divisiones + equipos ──────────────────────────
        Column(modifier = Modifier.weight(0.62f)) {
            SectionTitle(stringResource(R.string.transfers_teams_title, TransfersLogic.MARKET_SEASON))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TransfersLogic.DIVISIONS.forEach { div ->
                    DivisionChip(
                        label = div,
                        selected = div == activeDivision,
                        onClick = { onDivisionSelect(div) },
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                if (teams.isEmpty()) {
                    item(key = "teams_empty") {
                        Text(
                            text = stringResource(R.string.transfers_teams_empty),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    items(teams.size, key = { i -> "team_${teams[i].teamId}" }) { i ->
                        val season = teams[i]
                        TeamRow(
                            season = season,
                            prev = data.prevSeasonsByTeamId,
                            onTap = { onTeamTap(season.teamId) },
                        )
                        Spacer(Modifier.height(6.dp))
                    }
                }
                item(key = "bottom_spacer") { Spacer(Modifier.height(12.dp)) }
            }
        }
    }
}

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

/** Fila del feed: bandera + "Corredor  → Destino" + "hasta YYYY". */
@Composable
fun TransferFeedRow(transfer: RiderTransfer, data: TransfersLogic.MarketData) {
    // Strings hoisted: buildAnnotatedString no admite llamadas @Composable.
    val unknownTeam = stringResource(R.string.transfers_unknown_team)
    val renewsWith = stringResource(R.string.transfers_renews_with)
    val retires = stringResource(R.string.transfers_retires)
    val untilText = transfer.contractUntil?.let { stringResource(R.string.transfers_until, it) }
    val rider = data.ridersById[transfer.riderId]
    val dimColor = MaterialTheme.colorScheme.onSurfaceVariant
    val moveText = buildAnnotatedString {
        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
            append(rider?.fullName?.ifBlank { transfer.riderId } ?: transfer.riderId)
        }
        when (transfer.type) {
            "renewal" -> {
                // Un divisor atenuado separa el nombre del texto "renueva con …"
                // (que no empieza con flecha).
                withStyle(SpanStyle(color = dimColor)) { append("  ·  ") }
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
                withStyle(SpanStyle(color = dimColor)) { append("  →  ") }
                append(TransfersLogic.teamLabel(transfer.toTeamId, transfer.toTeamName, data.teamNameById, unknownTeam))
            }
        }
    }
    CCCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 12) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CountryFlag(countryCode = rider?.nationality, height = 11.dp)
            // Corredor + movimiento trunca con "…" a una línea (misma fórmula
            // que las cards de Hoy): sin doble altura, y el badge de año queda
            // fijo a la derecha.
            Text(
                text = moveText,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            // El año de contrato como BADGE (solo el año, sin "hasta").
            if (untilText != null) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.10f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(
                        text = untilText,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** Fila de equipo: chapa efectiva (colores 2027 / antiguos / vacía) + nombre 2027. */
@Composable
private fun TeamRow(season: TeamSeason, prev: Map<String, TeamSeason>, onTap: () -> Unit) {
    CCCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 12) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onTap)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Sin chapa no se invoca: en un Row con spacedBy, un composable
            // vacío gastaría el hueco igual.
            val badge = TransfersLogic.badgeSeason(season, prev)
            if (badge != null) {
                SeasonBadge(season = badge, size = 24)
            }
            Text(
                text = season.name.orEmpty(),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            // Continuidad del equipo sin confirmar (mig. 123): sigue listado,
            // solo se advierte.
            if (season.continuityDoubt) {
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
                        fontSize = 9.sp,
                        color = TRANSFERS_DOUBT_COLOR,
                    )
                }
            }
            Icon(
                Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                modifier = Modifier.size(18.dp),
            )
        }
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
