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
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.RiderTransfer
import app.calendariociclismo.android.data.model.TeamSeason
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RouteLoadingView
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

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(text = title, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
            )
        },
    ) { padding ->
        when (val current = state) {
            is TeamState.Loading -> RouteLoadingView(
                message = stringResource(R.string.loading),
                modifier = Modifier.padding(padding),
            )
            is TeamState.Error -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = current.message,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(24.dp),
                )
            }
            is TeamState.Ready -> TeamContent(
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
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(padding),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
    ) {
        // Cabecera del equipo: chapa (si está activada) + nombre + categoría·año.
        item(key = "header") {
            CCCard(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    // Sin chapa no se invoca: en un Row con spacedBy, un
                    // composable vacío gastaría el hueco igual.
                    val badge = TransfersLogic.badgeSeason(season, data.prevSeasonsByTeamId)
                    if (badge != null) {
                        SeasonBadge(season = badge, size = 40)
                    }
                    Column {
                        Text(
                            text = season.name.orEmpty(),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = season.category.orEmpty(),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        // Aviso: la continuidad del equipo en la temporada del mercado no está
        // confirmada (mig. 123). El equipo se lista igual; solo se advierte.
        if (season.continuityDoubt) {
            item(key = "team_doubt_notice") {
                TeamDoubtNotice(
                    stringResource(R.string.transfers_team_doubt_notice, TransfersLogic.MARKET_SEASON)
                )
            }
        }

        // Cada sección solo se muestra si tiene contenido (una categoría vacía se
        // oculta por completo, título incluido).

        // ── Continúan ──────────────────────────────────────────────
        if (detail.staying.isNotEmpty()) {
            item(key = "staying_title") { TeamSectionTitle(stringResource(R.string.transfers_staying)) }
            item(key = "staying_card") {
                CCCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 12) {
                    Column {
                        detail.staying.forEachIndexed { i, row ->
                            if (i > 0) HorizontalDivider(
                                thickness = 0.5.dp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
                            )
                            PersonRow(
                                nationality = row.rider.nationality,
                                name = row.rider.fullName.ifBlank { row.rider.id },
                                detail = null,
                                contractUntil = row.contractUntil,
                                isRumor = row.isRumor,
                            )
                        }
                    }
                }
            }
        }

        // ── En duda ────────────────────────────────────────────────
        // Renovaciones sin despejar: ni continúan, ni salen, ni entran.
        if (detail.doubtful.isNotEmpty()) {
            item(key = "doubtful_title") { TeamSectionTitle(stringResource(R.string.transfers_doubtful)) }
            item(key = "doubtful_card") {
                CCCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 12) {
                    Column {
                        detail.doubtful.forEachIndexed { i, row ->
                            if (i > 0) HorizontalDivider(
                                thickness = 0.5.dp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
                            )
                            // Sin badge "Duda": ya están bajo la sección "En duda".
                            PersonRow(
                                nationality = row.rider?.nationality,
                                name = row.rider?.fullName?.ifBlank { row.riderId } ?: row.riderId,
                                detail = null,
                                contractUntil = row.contractUntil,
                                isRumor = false,
                            )
                        }
                    }
                }
            }
        }

        // ── Terminan contrato ──────────────────────────────────────
        // Acaban su contrato sin equipo conocido (sin destino).
        if (detail.contractEnds.isNotEmpty()) {
            item(key = "contract_ends_title") { TeamSectionTitle(stringResource(R.string.transfers_contract_ends)) }
            item(key = "contract_ends_card") {
                CCCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 12) {
                    Column {
                        detail.contractEnds.forEachIndexed { i, t ->
                            if (i > 0) HorizontalDivider(
                                thickness = 0.5.dp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
                            )
                            val rider = data.ridersById[t.riderId]
                            PersonRow(
                                nationality = rider?.nationality,
                                name = rider?.fullName?.ifBlank { t.riderId } ?: t.riderId,
                                detail = null,
                                contractUntil = null,
                                isRumor = t.status == "rumor",
                            )
                        }
                    }
                }
            }
        }

        // ── Llegan ─────────────────────────────────────────────────
        if (detail.arrivals.isNotEmpty()) {
            item(key = "arrivals_title") { TeamSectionTitle(stringResource(R.string.transfers_arrivals)) }
            item(key = "arrivals_card") {
                MovementCard(moves = detail.arrivals, data = data, showOrigin = true, onLinkTeam = onLinkTeam)
            }
        }

        // ── Se marchan ─────────────────────────────────────────────
        if (detail.departures.isNotEmpty()) {
            item(key = "departures_title") { TeamSectionTitle(stringResource(R.string.transfers_departures)) }
            item(key = "departures_card") {
                MovementCard(moves = detail.departures, data = data, showOrigin = false, onLinkTeam = onLinkTeam)
            }
        }

        // Equipo sin ningún movimiento anunciado: aviso único.
        if (detail.staying.isEmpty() && detail.doubtful.isEmpty() && detail.contractEnds.isEmpty() &&
            detail.arrivals.isEmpty() && detail.departures.isEmpty()
        ) {
            item(key = "team_empty") { TeamEmptyText(stringResource(R.string.transfers_team_empty)) }
        }
        item(key = "bottom_spacer") { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun TeamSectionTitle(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.8.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 18.dp, bottom = 8.dp),
    )
}

@Composable
private fun TeamEmptyText(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
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
    CCCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 12) {
        Column {
            moves.forEachIndexed { i, t ->
                if (i > 0) HorizontalDivider(
                    thickness = 0.5.dp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
                )
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
        withStyle(SpanStyle(fontWeight = FontWeight.Medium)) { append(name) }
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
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        // El año de contrato como BADGE junto al de rumor/duda (solo el año).
        if (contractUntil != null) YearBadge(contractUntil)
        if (isDoubt) DoubtBadge() else if (isRumor) RumorBadge()
    }
}

/** Badge neutro del año de fin de contrato — espejo del `.tr-contract` de la web. */
@Composable
private fun YearBadge(year: Int) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.10f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            // Año centinela 9999 (contrato vitalicio) → ∞.
            text = if (year == 9999) "∞" else stringResource(R.string.transfers_until, year),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Badge ámbar "Rumor" — espejo del `.tr-chip--rumor` de la web. */
@Composable
private fun RumorBadge() {
    val amber = Color(0xFFF59E0B)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(amber.copy(alpha = 0.16f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = stringResource(R.string.transfers_rumor).uppercase(),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            fontSize = 9.sp,
            color = amber,
        )
    }
}

/**
 * Badge violeta "Duda" — espejo del `.tr-chip--doubt` de la web. Color propio,
 * distinto del ámbar del rumor: un rumor es una noticia sin confirmar, una
 * duda es la ausencia de noticia; no deben leerse como el mismo estado.
 */
@Composable
private fun DoubtBadge() {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(TRANSFERS_DOUBT_COLOR.copy(alpha = 0.16f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = stringResource(R.string.transfers_doubt).uppercase(),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            fontSize = 9.sp,
            color = TRANSFERS_DOUBT_COLOR,
        )
    }
}

/** Aviso de continuidad del equipo en duda — espejo de `.tr-team-notice`. */
@Composable
private fun TeamDoubtNotice(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(TRANSFERS_DOUBT_COLOR.copy(alpha = 0.10f))
            .padding(horizontal = 10.dp, vertical = 8.dp),
    )
}
