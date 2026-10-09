package app.calendariociclismo.android.ui.resultsfeed

import androidx.compose.foundation.layout.Arrangement
import java.time.LocalDate
import app.calendariociclismo.android.ui.theme.CCRadius
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.material3.OutlinedButton
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutInfo
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.ui.cyclocross.CxMetaLine
import app.calendariociclismo.android.ui.cyclocross.CyclocrossAgendaState
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.CxPresentation
import app.calendariociclismo.android.util.CxResultsFeedLogic
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.ResultsFeedLogic

/**
 * Pestaña Ciclocross de Resultados: pruebas CX de la temporada en curso con
 * resultados, agrupadas por día en cronología inversa ([CxResultsFeedLogic]).
 * Los datos son los meses de la temporada de [CyclocrossAgendaState].
 */
/** Días de la ventana inicial y de cada «Cargar más», como el feed de carretera. */
private const val CX_WINDOW_DAYS = 14

@Composable
internal fun CxResultsContent(
    state: CyclocrossAgendaState,
    adaptiveInfo: AdaptiveLayoutInfo,
    onRetry: () -> Unit,
    onEntryTap: (CxResultsFeedLogic.Entry) -> Unit,
) {
    val days by remember(state) { derivedStateOf { CxResultsFeedLogic.days(state.races, state.season) } }
    // Como en carretera: 14 días hasta hoy y «Cargar más» amplía otros 14.
    var windowStart by rememberSaveable { mutableStateOf(LocalDate.now().minusDays(CX_WINDOW_DAYS - 1L).toString()) }
    val visible = days.filter { it.date >= windowStart }
    when {
        !state.loaded && state.error != null && !state.busy -> Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = state.error.orEmpty(),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(24.dp),
            )
            TextButton(onClick = onRetry) {
                Text(stringResource(R.string.action_retry))
            }
        }
        !state.loaded -> RouteLoadingView(
            message = stringResource(R.string.loading),
            title = LocaleHolder.t("Ciclocross", "Cyclocross"),
        )
        days.isEmpty() -> FeedEmptyState(stringResource(R.string.results_feed_cx_empty))
        else -> CxFeedList(
            days = visible,
            rounds = state.rounds,
            adaptiveInfo = adaptiveInfo,
            onEntryTap = onEntryTap,
            canLoadMore = days.any { it.date < windowStart },
            onLoadMore = { windowStart = LocalDate.parse(windowStart).minusDays(CX_WINDOW_DAYS.toLong()).toString() },
        )
    }
}

@Composable
private fun CxFeedList(
    days: List<CxResultsFeedLogic.Day>,
    rounds: Map<String, CxRound>,
    adaptiveInfo: AdaptiveLayoutInfo,
    onEntryTap: (CxResultsFeedLogic.Entry) -> Unit,
    canLoadMore: Boolean,
    onLoadMore: () -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val columns = AdaptiveLayoutPolicy.feedColumns(maxWidth.value, adaptiveInfo)
        LazyColumn(
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            days.forEachIndexed { index, day ->
                item(key = "cx-hdr-${day.date}") {
                    FeedDayHeader(date = day.date, isFirst = index == 0)
                }
                if (columns <= 1) {
                    items(day.entries, key = { "cx-${it.race.id}-${it.date}" }) { entry ->
                        CxFeedEntryRow(entry = entry, round = rounds[entry.race.id], onClick = { onEntryTap(entry) })
                    }
                } else {
                    // Ancho expandido: mampostería por día; cada tarjeta, en
                    // orden de lectura, va a la columna más corta y conserva
                    // su altura (sin huecos entre tarjetas).
                    item(key = "cx-day-${day.date}") {
                        MasonryColumns(columns = columns, spacing = 8.dp) {
                            day.entries.forEach { entry ->
                                CxFeedEntryRow(entry = entry, round = rounds[entry.race.id], onClick = { onEntryTap(entry) })
                            }
                        }
                    }
                }
            }
            if (days.isEmpty()) {
                item(key = "cx-empty-window") { FeedEmptyState(stringResource(R.string.results_feed_cx_empty_period)) }
            }
            if (canLoadMore) {
                item(key = "cx-load-more") {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        OutlinedButton(onClick = onLoadMore, shape = RoundedCornerShape(CCRadius.Control)) {
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

/**
 * Columnas independientes: cada hijo se mide con el ancho de columna y se
 * coloca bajo la columna más corta (empate: la de la izquierda).
 */
@Composable
private fun MasonryColumns(columns: Int, spacing: Dp, content: @Composable () -> Unit) {
    Layout(content = content, modifier = Modifier.fillMaxWidth()) { measurables, constraints ->
        val gap = spacing.roundToPx()
        val width = constraints.maxWidth
        val columnWidth = ((width - gap * (columns - 1)) / columns).coerceAtLeast(0)
        val heights = IntArray(columns)
        val placed = measurables.map { measurable ->
            val placeable = measurable.measure(Constraints.fixedWidth(columnWidth))
            val column = heights.indices.minBy { heights[it] }
            val y = if (heights[column] == 0) 0 else heights[column] + gap
            heights[column] = y + placeable.height
            Triple(placeable, column * (columnWidth + gap), y)
        }
        layout(width, heights.maxOrNull() ?: 0) {
            placed.forEach { (placeable, x, y) -> placeable.placeRelative(x, y) }
        }
    }
}

/**
 * Fila CX con la variante destacada de la fila de carretera: logo de la
 * prueba (o del torneo) con la bandera debajo, nombre, línea torneo · manga ·
 * sede (la de la tarjeta de Hoy, sin categoría) y,
 * en lugar de las clasificaciones complementarias, una línea por categoría
 * con su código y el ganador o la ganadora. Sin la copa de ganador.
 */
@Composable
private fun CxFeedEntryRow(
    entry: CxResultsFeedLogic.Entry,
    round: CxRound?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val race = entry.race
    FeedRowFrame(
        logoUrl = CxPresentation.logo(race),
        flagCountryCode = race.countryCode?.takeIf { it.isNotBlank() },
        alignTop = true,
        onClick = onClick,
        modifier = modifier,
    ) {
        Text(
            text = LocaleHolder.t(race.name, race.nameEn?.takeIf { it.isNotBlank() } ?: race.name),
            style = CCText.S16,
            fontWeight = FontWeight.SemiBold,
        )
        val tournament = race.tournament?.let { LocaleHolder.t(it.name, it.nameEn?.takeIf { name -> name.isNotBlank() } ?: it.name) }
        val venue = race.venue?.takeIf { it.isNotBlank() && it != race.name }
        // Manga n/total como en la tarjeta de Hoy: la sede se recorta antes.
        val roundLabel = CxPresentation.roundLabel(round)
        if (tournament != null || roundLabel != null || venue != null) {
            CxMetaLine(tournament = tournament, round = roundLabel, venue = venue, style = CCText.S13)
        }
        HorizontalDivider(
            modifier = Modifier.padding(vertical = 2.dp),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        entry.categories.forEach { category ->
            FeedComplementaryLine(
                label = category.category,
                value = ResultsFeedLogic.cleanWinner(category.winnerName),
            )
        }
    }
}
