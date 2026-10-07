package app.calendariociclismo.android.ui.transfers

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.RiderTransfer
import app.calendariociclismo.android.data.model.TeamSeason
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.adaptive.rememberAdaptiveLayoutInfo
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.components.rememberLoadingVisible
import app.calendariociclismo.android.ui.startlist.TeamColorBands
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.util.TransfersLogic

private sealed class TeamState {
    object Loading : TeamState()
    data class Ready(
        val season: TeamSeason,
        val data: TransfersLogic.MarketData,
        val detail: TransfersLogic.TeamDetail,
    ) : TeamState()

    data class Error(val message: String) : TeamState()
}

/**
 * Detalle de equipo del mercado (apps 4.0) — espejo de la vista de equipo de
 * /fichajes/ web: continúan (plantilla actual con fin de contrato) / llegan /
 * se marchan, con badge Rumor donde proceda. Regla Dani: una salida rumoreada
 * saca al corredor de "continúan" y lo pinta como baja·Rumor.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransfersTeamScreen(teamId: String, navController: NavController) {
    val app = app.calendariociclismo.android.ui.rememberApp()
    val unknownError = stringResource(R.string.transfers_error)
    var state by remember { mutableStateOf<TeamState>(TeamState.Loading) }

    LaunchedEffect(teamId) {
        app.analytics.logScreenView("transfers_team")
        runCatching {
            val data = app.repository.loadTransfersMarket(TransfersLogic.MARKET_SEASON)
            val season = data.seasons.firstOrNull { it.teamId == teamId }
                ?: error("team season not found")
            val gender = season.gender ?: TransfersLogic.divisionGender(season.category)
            val roster = app.repository.transfersRoster(teamId, gender)
            // Hidratar también las fichas de llegadas/salidas que no estén ya
            // (loadTransfersMarket ya trae todas las de los movimientos).
            // Categoría del equipo de destino (para ordenar "se marchan").
            val categoryByTeamId = data.seasons.mapNotNull { s -> s.category?.let { s.teamId to it } }.toMap()
            Triple(
                season, data,
                TransfersLogic.teamDetail(
                    data.transfers, roster, teamId,
                    ridersById = data.ridersById,
                    categoryByTeamId = categoryByTeamId,
                    teamNameById = data.teamNameById,
                ),
            )
        }.onSuccess { (season, data, detail) ->
            state = TeamState.Ready(season, data, detail)
        }.onFailure { error ->
            state = TeamState.Error(error.message ?: unknownError)
        }
    }

    val title = stringResource(R.string.transfers_heading, TransfersLogic.MARKET_SEASON)

    val loadingVisible = rememberLoadingVisible(state is TeamState.Loading)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(text = title, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.action_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        val current = state
        when {
            loadingVisible -> RouteLoadingView(
                message = stringResource(R.string.loading),
                title = (current as? TeamState.Ready)?.season?.name ?: title,
                modifier = Modifier.padding(padding),
            )
            current is TeamState.Error -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = current.message,
                    style = CCText.S14,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp),
                )
            }
            current is TeamState.Ready -> TeamContent(
                season = current.season,
                data = current.data,
                detail = current.detail,
                padding = padding,
                // Llega → equipo del que VENÍA; se marcha → equipo AL QUE VA.
                // No hay ficha pública de corredor → el nombre enlaza al equipo.
                onLinkTeam = { linkedTeamId ->
                    navController.navigate(Routes.transfersTeam(linkedTeamId))
                },
            )
        }
    }
}

@Composable
private fun TeamContent(
    season: TeamSeason,
    data: TransfersLogic.MarketData,
    detail: TransfersLogic.TeamDetail,
    padding: PaddingValues,
    onLinkTeam: (String) -> Unit,
) {
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    val sections = buildList {
        if (detail.staying.isNotEmpty()) add(TeamSectionBlock("staying", detail.staying.size, stringResource(R.string.transfers_staying)) {
            CCCard(modifier = Modifier.fillMaxWidth()) { Column {
                detail.staying.forEachIndexed { i, row ->
                    if (i > 0) TeamRowDivider()
                    PersonRow(row.rider.nationality, row.rider.fullName.ifBlank { row.rider.id }, null, row.contractUntil, row.isRumor)
                }
            } }
        })
        if (detail.doubtful.isNotEmpty()) add(TeamSectionBlock("doubtful", detail.doubtful.size, stringResource(R.string.transfers_doubtful)) {
            CCCard(modifier = Modifier.fillMaxWidth()) { Column {
                detail.doubtful.forEachIndexed { i, row ->
                    if (i > 0) TeamRowDivider()
                    PersonRow(row.rider?.nationality, row.rider?.fullName?.ifBlank { row.riderId } ?: row.riderId, null, row.contractUntil, false)
                }
            } }
        })
        if (detail.contractEnds.isNotEmpty()) add(TeamSectionBlock("contract_ends", detail.contractEnds.size, stringResource(R.string.transfers_contract_ends)) {
            CCCard(modifier = Modifier.fillMaxWidth()) { Column {
                detail.contractEnds.forEachIndexed { i, transfer ->
                    if (i > 0) TeamRowDivider()
                    val rider = data.ridersById[transfer.riderId]
                    PersonRow(rider?.nationality, rider?.fullName?.ifBlank { transfer.riderId } ?: transfer.riderId, null, null, transfer.status == "rumor")
                }
            } }
        })
        if (detail.arrivals.isNotEmpty()) add(TeamSectionBlock("arrivals", detail.arrivals.size, stringResource(R.string.transfers_arrivals)) {
            MovementCard(detail.arrivals, data, true, onLinkTeam)
        })
        if (detail.departures.isNotEmpty()) add(TeamSectionBlock("departures", detail.departures.size, stringResource(R.string.transfers_departures)) {
            MovementCard(detail.departures, data, false, onLinkTeam)
        })
    }

    BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
        val wide = AdaptiveLayoutPolicy.usesWideDetail(maxWidth.value, adaptiveInfo) && sections.size > 1
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        ) {
            item(key = "header") { TeamHeader(season, data) }
            if (season.continuityDoubt) {
                item(key = "team_doubt_notice") {
                    TeamDoubtNotice(stringResource(R.string.transfers_team_doubt_notice, TransfersLogic.MARKET_SEASON))
                }
            }
            when {
                sections.isEmpty() -> item(key = "team_empty") { TeamEmptyText(stringResource(R.string.transfers_team_empty)) }
                wide -> item(key = "wide_sections") {
                    val split = AdaptiveLayoutPolicy.balancedBlockBreak(sections.map { it.weight })
                    Row(horizontalArrangement = Arrangement.spacedBy(adaptiveInfo.paneSpacing), verticalAlignment = Alignment.Top) {
                        TeamSectionColumn(sections.take(split), Modifier.weight(1f))
                        TeamSectionColumn(sections.drop(split), Modifier.weight(1f))
                    }
                }
                else -> sections.forEach { section -> item(key = section.key) { TeamSection(section) } }
            }
            item(key = "bottom_spacer") { Spacer(Modifier.height(24.dp)) }
        }
    }
}

private data class TeamSectionBlock(
    val key: String,
    val weight: Int,
    val title: String,
    val content: @Composable () -> Unit,
)

/** Cabecera sobre superficie neutra con las franjas de maillot de Resultados. */
@Composable
private fun TeamHeader(season: TeamSeason, data: TransfersLogic.MarketData) {
    CCCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TransfersLogic.stripesTeam(season, data.prevSeasonsByTeamId)?.let { TeamColorBands(it) }
                Text(
                    season.name.orEmpty(),
                    style = CCText.S20,
                    fontWeight = FontWeight.Bold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
            }
            Text(
                listOfNotNull(season.category?.takeUnless(String::isBlank), TransfersLogic.MARKET_SEASON.toString()).joinToString(" · "),
                style = CCText.S13,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun TeamSectionColumn(sections: List<TeamSectionBlock>, modifier: Modifier = Modifier) {
    Column(modifier = modifier) { sections.forEach { TeamSection(it) } }
}

@Composable
private fun TeamSection(section: TeamSectionBlock) {
    Column {
        TeamSectionTitle(section.title)
        section.content()
    }
}

@Composable
private fun TeamRowDivider() {
    HorizontalDivider()
}

@Composable
private fun TeamSectionTitle(text: String) {
    Text(
        text = text,
        style = CCText.S16,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(top = 20.dp, bottom = 8.dp).semantics { heading() },
    )
}

@Composable
private fun TeamEmptyText(text: String) {
    Text(
        text = text,
        style = CCText.S14,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(vertical = 4.dp),
    )
}

/** Tarjeta de llegadas o salidas: una fila por movimiento. */
@Composable
private fun MovementCard(
    moves: List<RiderTransfer>,
    data: TransfersLogic.MarketData,
    showOrigin: Boolean,
    onLinkTeam: (String) -> Unit,
) {
    val unknownTeam = stringResource(R.string.transfers_unknown_team)
    val retires = stringResource(R.string.transfers_retired)
    // Equipos con ficha en el mercado (destino enlazable de un nombre).
    val marketTeamIds = remember(data.seasons) { data.seasons.map { it.teamId }.toHashSet() }
    CCCard(modifier = Modifier.fillMaxWidth()) {
        BoxWithConstraints {
            if (maxWidth >= 600.dp && moves.size > 1) {
                val splitIndex = (moves.size + 1) / 2
                Row(verticalAlignment = Alignment.Top) {
                    MovementColumn(
                        moves = moves.take(splitIndex), data = data, showOrigin = showOrigin,
                        marketTeamIds = marketTeamIds, unknownTeam = unknownTeam,
                        retires = retires, onLinkTeam = onLinkTeam,
                        modifier = Modifier.weight(1f),
                    )
                    androidx.compose.material3.VerticalDivider()
                    MovementColumn(
                        moves = moves.drop(splitIndex), data = data, showOrigin = showOrigin,
                        marketTeamIds = marketTeamIds, unknownTeam = unknownTeam,
                        retires = retires, onLinkTeam = onLinkTeam,
                        modifier = Modifier.weight(1f),
                    )
                }
            } else {
                MovementColumn(
                    moves = moves, data = data, showOrigin = showOrigin,
                    marketTeamIds = marketTeamIds, unknownTeam = unknownTeam,
                    retires = retires, onLinkTeam = onLinkTeam,
                )
            }
        }
    }
}

@Composable
private fun MovementColumn(
    moves: List<RiderTransfer>,
    data: TransfersLogic.MarketData,
    showOrigin: Boolean,
    marketTeamIds: Set<String>,
    unknownTeam: String,
    retires: String,
    onLinkTeam: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        moves.forEachIndexed { i, t ->
                if (i > 0) HorizontalDivider()
                val rider = data.ridersById[t.riderId]
                val detailText = when {
                    showOrigin -> TransfersLogic.teamLabel(t.fromTeamId, t.fromTeamName, data.teamNameById, unknownTeam, TransfersLogic.TeamSide.FROM, data.teamNamePrev)
                    t.type == "retirement" -> retires
                    else -> TransfersLogic.teamLabel(t.toTeamId, t.toTeamName, data.teamNameById, unknownTeam)
                }
                // Llega → enlaza al equipo del que VENÍA (fromTeamId); se marcha →
                // al equipo AL QUE VA (toTeamId). Solo si ese equipo tiene ficha en
                // el mercado (una retirada no tiene destino).
                val candidate = if (showOrigin) t.fromTeamId else t.toTeamId
                val linkTeamId = candidate?.takeIf { it in marketTeamIds }
                PersonRow(
                    nationality = rider?.nationality,
                    name = rider?.fullName?.ifBlank { t.riderId } ?: t.riderId,
                    detail = detailText,
                    contractUntil = if (showOrigin) t.contractUntil else null,
                    isRumor = t.status == "rumor",
                    linkTeamId = linkTeamId,
                    onLinkTeam = onLinkTeam,
                )
        }
    }
}

/**
 * Fila de persona: bandera + nombre + detalle + contrato + badge Rumor/Duda.
 * El detalle (equipo de origen/destino) va INLINE a la derecha del nombre,
 * atenuado y separado por "·" — misma estética que la web (`personRowHtml`),
 * no como subtítulo debajo. Si se pasa `linkTeamId`, la FILA ENTERA es clicable
 * y navega a la ficha de ese equipo (no solo el nombre).
 */
@Composable
private fun PersonRow(
    nationality: String?,
    name: String,
    detail: String?,
    contractUntil: Int?,
    isRumor: Boolean,
    isDoubt: Boolean = false,
    linkTeamId: String? = null,
    onLinkTeam: (String) -> Unit = {},
) {
    val dimColor = MaterialTheme.colorScheme.onSurfaceVariant
    val personLine = buildAnnotatedString {
        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(name) }
        if (!detail.isNullOrEmpty()) {
            withStyle(SpanStyle(color = dimColor)) { append(" · $detail") }
        }
    }
    val base = Modifier.fillMaxWidth()
    val rowModifier = if (linkTeamId != null) {
        base.clickable { onLinkTeam(linkTeamId) }
    } else {
        base
    }.padding(horizontal = 12.dp, vertical = 8.dp)
    Row(
        modifier = rowModifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        CountryFlag(countryCode = nationality, height = 11.dp)
        // Corredor + equipo trunca con "…" a una línea (misma fórmula que las
        // cards de Hoy): sin doble altura, y los badges quedan fijos a la derecha.
        // El realce de "clicable" es la FILA entera (`.clickable` en el Row), no
        // el color del nombre → nombre en Medium, sin accent.
        Text(
            text = personLine,
            style = CCText.S14,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        // El año de contrato como BADGE junto al de rumor/duda (solo el año).
        if (contractUntil != null) ContractText(contractLabel(contractUntil))
        if (isDoubt) {
            TransferStateChip(stringResource(R.string.transfers_doubt), TransferChipKind.Doubt)
        } else if (isRumor) {
            TransferStateChip(stringResource(R.string.transfers_rumor), TransferChipKind.Rumor)
        }
    }
}

/** Aviso de continuidad del equipo en duda — espejo de `.tr-team-notice`. */
@Composable
private fun TeamDoubtNotice(text: String) {
    Text(
        text = text,
        style = CCText.S13,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .clip(RoundedCornerShape(CCRadius.Surface))
            .background(TRANSFERS_DOUBT_COLOR.copy(alpha = 0.10f))
            .padding(horizontal = 12.dp, vertical = 9.dp),
    )
}
