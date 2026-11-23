package app.calendariociclismo.android.ui.transfers

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
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
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.composed
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.round
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.pluralStringResource
import kotlinx.coroutines.async
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.rememberHaptics
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.util.TransfersLogic

private sealed class TeamState {
    object Loading : TeamState()
    data class Ready(
        val season: TeamSeason,
        val data: TransfersLogic.MarketData,
        val detail: TransfersLogic.TeamDetail,
        /** País del equipo, para la cabecera (null si no consta). */
        val countryCode: String? = null,
    ) : TeamState()

    data class Error(val message: String) : TeamState()
}

/**
 * Detalle de equipo del mercado (apps 4.0) — espejo de la vista de equipo de
 * /fichajes/ web, en dos columnas: plantilla de la temporada del mercado
 * (continúan y llegadas confirmadas, tintadas por años de contrato) y estados
 * (en duda, terminan contrato, llegan, se marchan), con badge Rumor donde
 * proceda. Regla Dani: una salida rumoreada
 * saca al corredor de "continúan" y lo pinta como baja·Rumor.
 *
 * Ruta a pantalla completa (móvil, enlaces profundos). En tablets, Fichajes
 * muestra el mismo contenido en la columna de detalle ([TransfersTeamPane]).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransfersTeamScreen(teamId: String, navController: NavController) {
    val title = stringResource(R.string.transfers_heading, TransfersLogic.MARKET_SEASON)

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
        TransfersTeamPane(
            teamId = teamId,
            // Llega → equipo del que VENÍA; se marcha → equipo AL QUE VA.
            // No hay ficha pública de corredor → el nombre enlaza al equipo.
            onLinkTeam = { linkedTeamId ->
                navController.navigate(Routes.transfersTeam(linkedTeamId))
            },
            padding = padding,
        )
    }
}

/**
 * Carga y contenido de la página de un equipo, sin barra superior: la ruta a
 * pantalla completa ([TransfersTeamScreen]) y la columna de detalle de
 * [TransfersScreen] en tablets lo comparten. `market` evita pedir de nuevo el
 * mercado cuando el llamador ya lo tiene.
 */
@Composable
fun TransfersTeamPane(
    teamId: String,
    onLinkTeam: (String) -> Unit,
    modifier: Modifier = Modifier,
    market: TransfersLogic.MarketData? = null,
    padding: PaddingValues = PaddingValues(0.dp),
) {
    val app = app.calendariociclismo.android.ui.rememberApp()
    val unknownError = stringResource(R.string.transfers_error)
    val title = stringResource(R.string.transfers_heading, TransfersLogic.MARKET_SEASON)
    var state by remember(teamId) { mutableStateOf<TeamState>(TeamState.Loading) }

    LaunchedEffect(teamId) { app.analytics.logScreenView("transfers_team") }
    LaunchedEffect(teamId, market) {
        runCatching {
            val data = market ?: app.repository.loadTransfersMarket(TransfersLogic.MARKET_SEASON)
            val season = data.seasons.firstOrNull { it.teamId == teamId }
                ?: error("team season not found")
            val gender = season.gender ?: TransfersLogic.divisionGender(season.category)
            val (roster, countryCode) = kotlinx.coroutines.coroutineScope {
                val country = async { app.repository.teamCountryCode(teamId) }
                app.repository.transfersRoster(teamId, gender) to country.await()
            }
            // Hidratar también las fichas de llegadas/salidas que no estén ya
            // (loadTransfersMarket ya trae todas las de los movimientos).
            // Categoría del equipo de destino (para ordenar "se marchan").
            val categoryByTeamId = data.seasons.mapNotNull { s -> s.category?.let { s.teamId to it } }.toMap()
            TeamState.Ready(
                season, data,
                TransfersLogic.teamDetail(
                    data.transfers, roster, teamId,
                    ridersById = data.ridersById,
                    categoryByTeamId = categoryByTeamId,
                    teamNameById = data.teamNameById,
                ),
                countryCode,
            )
        }.onSuccess { ready ->
            state = ready
        }.onFailure { error ->
            state = TeamState.Error(error.message ?: unknownError)
        }
    }

    val loadingVisible = rememberLoadingVisible(state is TeamState.Loading)

    val current = state
    when {
        loadingVisible -> RouteLoadingView(
            message = stringResource(R.string.loading),
            // El nombre del equipo si el mercado ya se cargó.
            title = (current as? TeamState.Ready)?.season?.name
                ?: market?.seasons?.firstOrNull { it.teamId == teamId }?.name
                ?: app.repository.transfersTeamNames[teamId]
                ?: title,
            modifier = modifier.padding(padding),
        )
        current is TeamState.Error -> Box(
            modifier.fillMaxSize().padding(padding),
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
            countryCode = current.countryCode,
            padding = padding,
            modifier = modifier,
            onLinkTeam = onLinkTeam,
        )
    }
}

@Composable
private fun TeamContent(
    season: TeamSeason,
    data: TransfersLogic.MarketData,
    detail: TransfersLogic.TeamDetail,
    countryCode: String?,
    padding: PaddingValues,
    onLinkTeam: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val arrivalCue = stringResource(R.string.transfers_arrival_cue)
    val haptic = rememberHaptics()
    // Orden de la plantilla: por año de contrato (por defecto) o alfabético.
    var squadAlphabetical by rememberSaveable(season.teamId) { mutableStateOf(false) }
    // Plantilla: los que continúan y las llegadas confirmadas, tintados por
    // años de contrato (fuerte en las llegadas).
    val squad = if (detail.squad.isEmpty()) null else TeamSectionBlock(
        "squad", stringResource(R.string.transfers_squad, TransfersLogic.MARKET_SEASON),
        action = if (detail.squad.size > 1) {
            {
                SquadOrderButton(squadAlphabetical) {
                    haptic(Haptics.Event.Selection)
                    squadAlphabetical = !squadAlphabetical
                }
            }
        } else null,
    ) {
        CCCard(modifier = Modifier.fillMaxWidth()) { Column {
            TransfersLogic.sortedSquad(detail.squad, squadAlphabetical).forEachIndexed { i, row ->
                if (i > 0) TeamRowDivider()
                // Cada fila conserva su identidad (key) y, al cambiar el orden,
                // se desplaza desde su sitio anterior, como en iOS y la web.
                key(row.riderId) {
                    Box(Modifier.animatePlacement()) {
                        PersonRow(
                            nationality = row.rider?.nationality,
                            name = row.rider?.fullName?.ifBlank { row.riderId } ?: row.riderId,
                            detail = null,
                            contractUntil = row.contractUntil,
                            isRumor = row.isRumor,
                            tint = contractTintColor(TransfersLogic.contractTint(row.contractUntil), row.isArrival, dark),
                            // El color no es la única señal de una llegada.
                            accessibilityNote = if (row.isArrival) arrivalCue else null,
                        )
                    }
                }
            }
        } }
    }
    val sections = buildList {
        if (detail.doubtful.isNotEmpty()) add(TeamSectionBlock("doubtful", stringResource(R.string.transfers_doubtful)) {
            CCCard(modifier = Modifier.fillMaxWidth()) { Column {
                detail.doubtful.forEachIndexed { i, row ->
                    if (i > 0) TeamRowDivider()
                    PersonRow(row.rider?.nationality, row.rider?.fullName?.ifBlank { row.riderId } ?: row.riderId, null, row.contractUntil, false)
                }
            } }
        })
        if (detail.contractEnds.isNotEmpty()) add(TeamSectionBlock("contract_ends", stringResource(R.string.transfers_contract_ends)) {
            CCCard(modifier = Modifier.fillMaxWidth()) { Column {
                detail.contractEnds.forEachIndexed { i, transfer ->
                    if (i > 0) TeamRowDivider()
                    val rider = data.ridersById[transfer.riderId]
                    PersonRow(rider?.nationality, rider?.fullName?.ifBlank { transfer.riderId } ?: transfer.riderId, null, null, transfer.status == "rumor")
                }
            } }
        })
        if (detail.arrivals.isNotEmpty()) add(TeamSectionBlock("arrivals", stringResource(R.string.transfers_arrivals)) {
            MovementCard(detail.arrivals, data, true, onLinkTeam)
        })
        if (detail.departures.isNotEmpty()) add(TeamSectionBlock("departures", stringResource(R.string.transfers_departures)) {
            MovementCard(detail.departures, data, false, onLinkTeam)
        })
    }

    BoxWithConstraints(modifier.fillMaxSize().padding(padding)) {
        // Dos columnas, como la web: la plantilla y, juntos, los estados (en
        // duda, terminan contrato, llegan y se marchan). En ancho estrecho,
        // una columna con la plantilla primero.
        val wide = AdaptiveLayoutPolicy.usesWideDetail(maxWidth.value, adaptiveInfo) && squad != null && sections.isNotEmpty()
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        ) {
            item(key = "header") {
                TeamHeader(season, data, countryCode, confirmedCount = if (detail.squad.isEmpty()) null else detail.confirmedCount)
            }
            if (season.continuityDoubt) {
                item(key = "team_doubt_notice") {
                    TeamDoubtNotice(stringResource(R.string.transfers_team_doubt_notice, TransfersLogic.MARKET_SEASON))
                }
            }
            when {
                squad == null && sections.isEmpty() -> item(key = "team_empty") { TeamEmptyText(stringResource(R.string.transfers_team_empty)) }
                wide && squad != null -> item(key = "wide_sections") {
                    Row(horizontalArrangement = Arrangement.spacedBy(adaptiveInfo.paneSpacing), verticalAlignment = Alignment.Top) {
                        TeamSectionColumn(listOf(squad), Modifier.weight(1f))
                        TeamSectionColumn(sections, Modifier.weight(1f))
                    }
                }
                else -> (listOfNotNull(squad) + sections).forEach { section -> item(key = section.key) { TeamSection(section) } }
            }
            // Leyenda de los tintes bajo todas las listas, si alguna fila de
            // la plantilla lleva tinte.
            if (detail.squad.any { TransfersLogic.contractTint(it.contractUntil) != null }) {
                item(key = "contract_legend") { ContractLegend(dark) }
            }
            item(key = "bottom_spacer") { Spacer(Modifier.height(24.dp)) }
        }
    }
}

private data class TeamSectionBlock(
    val key: String,
    val title: String,
    /** Control a la derecha del título (orden de la plantilla). */
    val action: (@Composable () -> Unit)? = null,
    val content: @Composable () -> Unit,
)

/**
 * Desplaza el elemento desde su posición anterior hasta la nueva cuando cambia
 * de sitio dentro de su padre (cambio de orden de la plantilla). Respeta la
 * escala de animaciones del sistema.
 */
private fun Modifier.animatePlacement(): Modifier = composed {
    val scope = rememberCoroutineScope()
    var placed by remember { mutableStateOf<IntOffset?>(null) }
    val offset = remember { Animatable(IntOffset.Zero, IntOffset.VectorConverter) }
    onPlaced { coordinates ->
        val now = coordinates.positionInParent().round()
        val previous = placed
        placed = now
        if (previous != null && previous != now) {
            scope.launch {
                offset.snapTo(offset.value + (previous - now))
                offset.animateTo(IntOffset.Zero, tween(durationMillis = 350, easing = FastOutSlowInEasing))
            }
        }
    }.offset { offset.value }
}

/**
 * Conmutador del orden de la plantilla, como en la web: muestra el orden al
 * que cambia (A-Z con el de contrato activo; un lápiz sobre una hoja, el
 * contrato, con el alfabético).
 */
@Composable
private fun SquadOrderButton(alphabetical: Boolean, onToggle: () -> Unit) {
    IconButton(onClick = onToggle) {
        Icon(
            painterResource(if (alphabetical) R.drawable.ic_squad_order_contract else R.drawable.ic_squad_order_az),
            contentDescription = stringResource(
                if (alphabetical) R.string.transfers_squad_order_contract else R.string.transfers_squad_order_alpha,
            ),
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * Leyenda de los tintes de la plantilla bajo las listas del equipo
 * (`.tr-legend` web): un cuadrado por color con el año de fin de contrato y,
 * aparte, el tono fuerte de los fichajes, centrada. Pasa a otra línea si no
 * cabe.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ContractLegend(dark: Boolean) {
    val dim = MaterialTheme.colorScheme.onSurfaceVariant
    val season = TransfersLogic.MARKET_SEASON
    @Composable
    fun Item(tint: TransfersLogic.ContractTint, strong: Boolean, text: String) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(
                Modifier
                    .size(12.dp)
                    .background(contractTintColor(tint, strong, dark) ?: Color.Transparent)
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant),
            )
            Text(text, style = CCText.S13, color = dim)
        }
    }
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(top = 20.dp).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(stringResource(R.string.transfers_legend_contract), style = CCText.S13, fontWeight = FontWeight.SemiBold, color = dim)
        Item(TransfersLogic.ContractTint.GREEN, false, stringResource(R.string.transfers_legend_or_later, season + 2))
        Item(TransfersLogic.ContractTint.YELLOW, false, (season + 1).toString())
        Item(TransfersLogic.ContractTint.RED, false, season.toString())
        Item(TransfersLogic.ContractTint.GREEN, true, stringResource(R.string.transfers_legend_arrival))
    }
}

/**
 * Cabecera de la vista de equipo, espejo de `.tr-team-header` web, con los
 * colores de cabecera del equipo y la disposición de iOS: nombre, con la división y la
 * temporada al final de la línea (el nombre largo pasa a dos líneas); debajo,
 * país y ciclistas confirmados separados por «·», o uno bajo otro si no caben.
 */
@Composable
private fun TeamHeader(
    season: TeamSeason,
    data: TransfersLogic.MarketData,
    countryCode: String?,
    confirmedCount: Int?,
) {
    val colors = marketHeaderColors(season, data.prevSeasonsByTeamId)
    // Con los colores del equipo, los textos secundarios derivan del texto de la cabecera.
    val dim = colors?.second?.copy(alpha = 0.8f) ?: MaterialTheme.colorScheme.onSurfaceVariant
    CCCard(
        modifier = Modifier.fillMaxWidth(),
        containerColor = colors?.first ?: MaterialTheme.colorScheme.surface,
        contentColor = colors?.second ?: MaterialTheme.colorScheme.onSurface,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 12.dp, vertical = 9.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    season.name.orEmpty(),
                    style = CCText.S20,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
                Text(
                    listOfNotNull(season.category?.takeUnless(String::isBlank), TransfersLogic.MARKET_SEASON.toString()).joinToString(" · "),
                    style = CCText.S13,
                    fontWeight = FontWeight.SemiBold,
                    color = dim,
                    maxLines = 1,
                )
            }
            if (countryCode != null || confirmedCount != null) {
                HeaderFacts(
                    country = countryCode?.let { code ->
                        {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                CountryFlag(countryCode = code, height = 11.dp)
                                val locale = if (LocaleHolder.shouldShowEnglishContent) java.util.Locale.ENGLISH else java.util.Locale.forLanguageTag("es")
                                Text(
                                    java.util.Locale("", code.uppercase()).getDisplayCountry(locale),
                                    style = CCText.S13,
                                    color = dim,
                                    maxLines = 1,
                                )
                            }
                        }
                    },
                    count = confirmedCount?.let { n ->
                        {
                            // «N ciclistas confirmados», con el número en negrita; sin el año,
                            // que la cabecera ya muestra junto a la categoría.
                            val text = pluralStringResource(R.plurals.transfers_squad_count, n, n)
                            val number = n.toString()
                            Text(
                                buildAnnotatedString {
                                    if (text.startsWith(number)) {
                                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(number) }
                                        append(text.removePrefix(number))
                                    } else {
                                        append(text)
                                    }
                                },
                                style = CCText.S13,
                                color = dim,
                            )
                        }
                    },
                    separatorColor = dim,
                )
            }
        }
    }
}

/**
 * País y recuento en una línea con «·» a 6 dp de cada lado si caben; si no,
 * uno debajo de otro y sin separador.
 */
@Composable
private fun HeaderFacts(country: (@Composable () -> Unit)?, count: (@Composable () -> Unit)?, separatorColor: Color) {
    val gap = 6.dp
    Layout(
        content = {
            country?.invoke()
            if (country != null && count != null) HeaderSeparator(separatorColor)
            count?.invoke()
        },
    ) { measurables, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val placeables = measurables.map { it.measure(loose) }
        val gapPx = gap.roundToPx()
        val rowWidth = placeables.sumOf { it.width } + gapPx * (placeables.size - 1)
        if (rowWidth <= constraints.maxWidth) {
            val height = placeables.maxOf { it.height }
            layout(rowWidth, height) {
                var x = 0
                placeables.forEach { p ->
                    p.placeRelative(x, (height - p.height) / 2)
                    x += p.width + gapPx
                }
            }
        } else {
            // Sin el separador, uno debajo de otro.
            val stacked = if (placeables.size == 3) listOf(placeables[0], placeables[2]) else placeables
            val width = stacked.maxOf { it.width }.coerceAtMost(constraints.maxWidth)
            val height = stacked.sumOf { it.height } + gapPx * (stacked.size - 1)
            layout(width, height) {
                var y = 0
                stacked.forEach { p ->
                    p.placeRelative(0, y)
                    y += p.height + gapPx
                }
            }
        }
    }
}

@Composable
private fun HeaderSeparator(color: Color) {
    Text(
        "·",
        style = CCText.S13,
        color = color,
        modifier = Modifier.clearAndSetSemantics { },
    )
}

/** Tintes de la plantilla por años de contrato (`.tr-tint--*` web): pálido
 *  para los que continúan y fuerte para las llegadas. El texto pasa 4,5:1
 *  sobre cada tinte en los dos temas. */
private fun contractTintColor(tint: TransfersLogic.ContractTint?, strong: Boolean, dark: Boolean): Color? = when (tint) {
    null -> null
    TransfersLogic.ContractTint.GREEN -> Color(if (strong) { if (dark) 0xFF1F5A2C else 0xFF8DFE96 } else { if (dark) 0xFF12301C else 0xFFE3F9E0 })
    TransfersLogic.ContractTint.YELLOW -> Color(if (strong) { if (dark) 0xFF5C5217 else 0xFFFEF18D } else { if (dark) 0xFF3A3512 else 0xFFFCF8DB })
    TransfersLogic.ContractTint.RED -> Color(if (strong) { if (dark) 0xFF6B2424 else 0xFFF9A8A8 } else { if (dark) 0xFF3D1B1B else 0xFFFCDBDB })
}

@Composable
private fun TeamSectionColumn(sections: List<TeamSectionBlock>, modifier: Modifier = Modifier) {
    Column(modifier = modifier) { sections.forEach { TeamSection(it) } }
}

@Composable
private fun TeamSection(section: TeamSectionBlock) {
    Column {
        if (section.action == null) {
            TeamSectionTitle(section.title)
        } else {
            // El botón (48 dp de área táctil) se centra en la línea del título
            // sin añadir altura: las dos columnas siguen alineadas.
            Box(Modifier.fillMaxWidth()) {
                TeamSectionTitle(section.title)
                Box(Modifier.align(Alignment.TopEnd).offset(x = 12.dp, y = 6.dp)) { section.action.invoke() }
            }
        }
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
    val marketTeamIds = remember(data.seasons) { TransfersLogic.marketTeamIds(data.seasons) }
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
    tint: Color? = null,
    accessibilityNote: String? = null,
) {
    val dimColor = MaterialTheme.colorScheme.onSurfaceVariant
    val personLine = buildAnnotatedString {
        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(name) }
        if (!detail.isNullOrEmpty()) {
            withStyle(SpanStyle(color = dimColor)) { append(" · $detail") }
        }
    }
    val base = Modifier.fillMaxWidth()
        .then(if (tint != null) Modifier.background(tint) else Modifier)
        .then(if (accessibilityNote != null) Modifier.semantics(mergeDescendants = true) { stateDescription = accessibilityNote } else Modifier)
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
