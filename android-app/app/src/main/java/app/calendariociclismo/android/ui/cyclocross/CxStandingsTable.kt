package app.calendariociclismo.android.ui.cyclocross

import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.data.model.CxStanding
import app.calendariociclismo.android.data.model.CxStandingState
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.results.ResultsClassificationTable
import app.calendariociclismo.android.ui.startlist.TeamColorBands
import app.calendariociclismo.android.util.CxPresentation
import app.calendariociclismo.android.util.CxRoundCell
import app.calendariociclismo.android.util.CxStandingsBreakdown
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.UciResultsLogic
import kotlinx.coroutines.launch

private val RankWidth = 32.dp
private val TotalWidth = 56.dp
private val RoundWidth = 38.dp
private val CellGap = 6.dp
private val EdgePadding = 8.dp
private val MinFixedWidth = 176.dp

/**
 * Tabla de una general CX, común a la ficha de carrera y a la página de torneo.
 * Con desglose por ronda (general por puntos calculada) puesto y corredor
 * quedan fijos y el total y las rondas se desplazan en horizontal; sin él, la
 * tabla de clasificación de carretera con el total.
 */
@Composable
internal fun CxStandingsTable(
    rows: List<CxStanding>,
    state: CxStandingState?,
    mode: String,
    teamMatcher: UciResultsLogic.TeamMatcher,
    rounds: Map<String, CxRound>,
    races: Map<String, CxRace>,
    onOpenRace: (CxRace) -> Unit,
) {
    val locale = LocalConfiguration.current.locales[0]
    val sorted = remember(rows) { rows.sortedBy { it.rank } }
    val vms = remember(sorted, mode, locale, teamMatcher) { CxPresentation.standingRows(sorted, mode, locale, teamMatcher) }
    val breakdown = remember(state, mode, locale) { CxPresentation.standingsBreakdown(state, mode, locale) }
    val valueHeader = stringResource(if (mode == "points") R.string.results_col_points else R.string.results_col_time)
    if (breakdown == null) {
        ResultsClassificationTable(vms, showTeam = true, showUciPoints = false, valueHeader = valueHeader)
        return
    }
    CxRoundsTable(sorted, vms, breakdown, valueHeader, rounds, races, onOpenRace)
}

@Composable
private fun CxRoundsTable(
    rows: List<CxStanding>,
    vms: List<UciResultsLogic.ResultRowVM>,
    breakdown: CxStandingsBreakdown,
    valueHeader: String,
    rounds: Map<String, CxRound>,
    races: Map<String, CxRace>,
    onOpenRace: (CxRace) -> Unit,
) {
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    var headerHeight by remember { mutableIntStateOf(0) }
    var viewportWidth by remember { mutableIntStateOf(0) }
    val cells = remember(rows, breakdown) { rows.map(breakdown::cells) }
    val shape = RoundedCornerShape(CCRadius.Surface)
    val headerBackground = MaterialTheme.colorScheme.surfaceVariant
    val tableBackground = MaterialTheme.colorScheme.surface
    val divider = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f)
    BoxWithConstraints(
        Modifier.fillMaxWidth().clip(shape).background(tableBackground),
    ) {
        // Total y rondas ocupan su ancho natural; el corredor toma el resto
        // con un mínimo, y lo que no cabe se desplaza.
        val scrollingWidth = TotalWidth + (RoundWidth + CellGap) * breakdown.roundIds.size + EdgePadding
        val fixedWidth = (maxWidth - CellGap - scrollingWidth).coerceAtLeast(MinFixedWidth)
        Column(Modifier.fillMaxWidth()) {
            Row(
                Modifier.fillMaxWidth().background(headerBackground).padding(vertical = 8.dp).onSizeChanged { headerHeight = it.height },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(Modifier.width(fixedWidth).padding(start = EdgePadding), horizontalArrangement = Arrangement.spacedBy(CellGap)) {
                    CxHeaderCell("#", Modifier.width(RankWidth))
                    CxHeaderCell(stringResource(R.string.results_col_rider), Modifier.weight(1f))
                }
                Spacer(Modifier.width(CellGap))
                Box(Modifier.weight(1f).onSizeChanged { viewportWidth = it.width }.horizontalScroll(scroll)) {
                    Row(Modifier.padding(end = EdgePadding), horizontalArrangement = Arrangement.spacedBy(CellGap), verticalAlignment = Alignment.CenterVertically) {
                        CxHeaderCell(valueHeader, Modifier.width(TotalWidth), end = true)
                        breakdown.roundIds.forEachIndexed { index, raceId ->
                            val race = races[raceId]?.takeUnless(CxPresentation::isHidden)
                            val label = CxPresentation.roundHeader(raceId, index, rounds)
                            val modifier = Modifier.width(RoundWidth)
                            CxHeaderCell(label, if (race == null) modifier else modifier
                                .clickable(role = Role.Button) { onOpenRace(race) }
                                .semantics { contentDescription = LocaleHolder.t(race.name, race.nameEn?.takeIf { it.isNotBlank() } ?: race.name) }, end = true)
                        }
                    }
                }
            }
            HorizontalDivider(thickness = 0.5.dp, color = divider)
            vms.forEachIndexed { index, vm ->
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.width(fixedWidth).padding(start = EdgePadding), horizontalArrangement = Arrangement.spacedBy(CellGap), verticalAlignment = Alignment.CenterVertically) {
                        Text(vm.rank?.toString() ?: vm.rankBadge ?: "–", Modifier.width(RankWidth), style = CCText.S13, fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface)
                        CxStandingRider(vm, Modifier.weight(1f))
                    }
                    Spacer(Modifier.width(CellGap))
                    Box(Modifier.weight(1f).horizontalScroll(scroll)) {
                        Row(Modifier.padding(end = EdgePadding), horizontalArrangement = Arrangement.spacedBy(CellGap), verticalAlignment = Alignment.CenterVertically) {
                            Text(vm.valueText, Modifier.width(TotalWidth), style = CCText.S13, fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.End, maxLines = 1)
                            cells[index].forEach { cell -> CxRoundValue(cell, Modifier.width(RoundWidth)) }
                        }
                    }
                }
                HorizontalDivider(thickness = 0.5.dp, color = divider)
            }
        }
        // Indicador de desplazamiento: flecha a la altura de la cabecera y
        // degradado hacia el fondo de la tabla mientras quedan rondas fuera.
        if (scroll.canScrollForward && headerHeight > 0) {
            val headerDp: Dp = with(density) { headerHeight.toDp() }
            Box(Modifier.matchParentSize()) {
                Column(Modifier.align(Alignment.TopEnd).fillMaxHeight()) {
                    Row(Modifier.height(headerDp)) {
                        Box(Modifier.width(16.dp).fillMaxHeight().background(Brush.horizontalGradient(listOf(Color.Transparent, headerBackground))))
                        Box(
                            Modifier.width(28.dp).fillMaxHeight().background(headerBackground)
                                .clickable(role = Role.Button) {
                                    scope.launch { scroll.animateScrollTo(scroll.value + (viewportWidth * 0.6f).toInt()) }
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Filled.ChevronRight, contentDescription = stringResource(R.string.cx_more_rounds),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                        }
                    }
                    Box(Modifier.align(Alignment.End).width(28.dp).weight(1f)
                        .background(Brush.horizontalGradient(listOf(Color.Transparent, tableBackground))))
                }
            }
        }
    }
}

@Composable
private fun CxHeaderCell(text: String, modifier: Modifier, end: Boolean = false) {
    Text(
        text,
        modifier = modifier,
        style = CCText.S12,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = if (end) TextAlign.End else TextAlign.Start,
        maxLines = 1,
    )
}

/** Corredor con bandera y, debajo, su equipo con las franjas de maillot. */
@Composable
private fun CxStandingRider(vm: UciResultsLogic.ResultRowVM, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (vm.countryCode.isNotEmpty()) CountryFlag(countryCode = vm.countryCode, height = 13.dp)
            Text(vm.riderName.ifEmpty { "-" }, style = CCText.S14, fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (vm.teamName.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                vm.team?.takeIf { it.hasVisibleBadge }?.let { TeamColorBands(it) }
                Text(vm.teamName, style = CCText.S12, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Puntos de una ronda; el resultado descartado se tacha en color secundario. */
@Composable
private fun CxRoundValue(cell: CxRoundCell, modifier: Modifier) {
    val dropped = stringResource(R.string.cx_dropped_result)
    Text(
        cell.text,
        modifier = if (cell.dropped) modifier.semantics { contentDescription = "${cell.text}, $dropped" } else modifier,
        style = CCText.S12,
        color = if (cell.dropped) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        textDecoration = if (cell.dropped) TextDecoration.LineThrough else null,
        textAlign = TextAlign.End,
        maxLines = 1,
    )
}
