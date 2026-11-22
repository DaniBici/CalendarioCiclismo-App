package app.calendariociclismo.android.ui.components

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.RichTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TooltipAnchorPosition
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.TooltipState
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.CCText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow

/*
 * Burbujas de la primera visita a Hoy (5.2.4), con `RichTooltip` de Material 3:
 * primero «Filtros» y después «Ordenar». Hoy de carretera y Hoy de Ciclocross
 * tienen cada uno su primera vez (AppPreferences.todayTipsDone). Solo aparecen
 * sin arranque, bienvenida ni hoja de apoyo encima ([AppOverlays]) y con la
 * agenda cargada. Cerrar la primera, con su botón o pulsando fuera, da paso a
 * la segunda; cerrar la segunda las da por vistas. Espejo de `TodayTips.swift`
 * (iOS). Últimos resultados tiene la suya ([rememberResultsFiltersTip]).
 */

/** Arranque, bienvenida u hoja de apoyo a la vista (lo actualiza MainActivity). */
object AppOverlays {
    val visible = MutableStateFlow(true)
}

enum class TodayTipDiscipline(val key: String) { Road("road"), Cyclocross("cyclocross") }

@OptIn(ExperimentalMaterial3Api::class)
class TodayTipsState internal constructor(
    val discipline: TodayTipDiscipline,
    internal val filters: TooltipState,
    internal val sort: TooltipState,
)

/** Estado de las dos burbujas de una disciplina; `ready`: agenda cargada. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun rememberTodayTips(discipline: TodayTipDiscipline, ready: Boolean): TodayTipsState {
    val app = rememberApp()
    val filters = rememberTooltipState(isPersistent = true)
    val sort = rememberTooltipState(isPersistent = true)
    val state = remember(discipline) { TodayTipsState(discipline, filters, sort) }
    val done by app.preferences.todayTipsDone(discipline.key).collectAsState(initial = true)
    val overlays by AppOverlays.visible.collectAsState()
    LaunchedEffect(done, ready, overlays) {
        if (done || !ready || overlays) return@LaunchedEffect
        delay(600)
        filters.showUntilDismissed()
        sort.showUntilDismissed()
        app.preferences.setTodayTipsDone(discipline.key)
    }
    return state
}

/**
 * Muestra la burbuja y espera a que se cierre. Material 3 cierra una burbuja
 * persistente cancelando la espera de show(): esa cancelación no corta la
 * secuencia, salvo que se cancele la pantalla.
 */
@OptIn(ExperimentalMaterial3Api::class)
private suspend fun TooltipState.showUntilDismissed() {
    try {
        show()
    } catch (e: CancellationException) {
        currentCoroutineContext().ensureActive()
    }
}

/** Clave de [AppPreferences.todayTipsDone] de la burbuja de Resultados. */
private const val RESULTS_TIP_KEY = "results"

/**
 * Burbuja de «Filtros» de Últimos resultados: los filtros de Hoy y Calendario
 * también valen ahí. Una sola vez, la primera vez que se abre Resultados, sin
 * arranque, bienvenida ni hoja de apoyo encima; `ready`: lista cargada.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun rememberResultsFiltersTip(ready: Boolean): TooltipState {
    val app = rememberApp()
    val state = rememberTooltipState(isPersistent = true)
    val done by app.preferences.todayTipsDone(RESULTS_TIP_KEY).collectAsState(initial = true)
    val overlays by AppOverlays.visible.collectAsState()
    LaunchedEffect(done, ready, overlays) {
        if (done || !ready || overlays) return@LaunchedEffect
        delay(600)
        state.showUntilDismissed()
        app.preferences.setTodayTipsDone(RESULTS_TIP_KEY)
    }
    return state
}

/** «Filtros» de Resultados con su burbuja. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultsFiltersTipAnchor(state: TooltipState, content: @Composable () -> Unit) {
    TodayTipBox(
        state = state,
        title = stringResource(R.string.today_tip_filters_title),
        text = stringResource(R.string.results_tip_filters),
        action = stringResource(R.string.today_tip_done),
        content = content,
    )
}

/** «Filtros» con su burbuja. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayFiltersTipAnchor(tips: TodayTipsState, content: @Composable () -> Unit) {
    TodayTipBox(
        state = tips.filters,
        title = stringResource(R.string.today_tip_filters_title),
        text = stringResource(
            if (tips.discipline == TodayTipDiscipline.Road) R.string.today_tip_filters_road else R.string.today_tip_filters_cx,
        ),
        action = stringResource(R.string.today_tip_next),
        content = content,
    )
}

/** «Ordenar» con su burbuja. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodaySortTipAnchor(tips: TodayTipsState, content: @Composable () -> Unit) {
    TodayTipBox(
        state = tips.sort,
        title = stringResource(R.string.today_tip_sort_title),
        text = stringResource(R.string.today_tip_sort),
        action = stringResource(R.string.today_tip_done),
        content = content,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TodayTipBox(
    state: TooltipState,
    title: String,
    text: String,
    action: String,
    content: @Composable () -> Unit,
) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Below),
        tooltip = {
            RichTooltip(
                title = { Text(title, style = CCText.S14, fontWeight = FontWeight.SemiBold) },
                action = { TextButton(onClick = { state.dismiss() }) { Text(action) } },
                caretShape = TooltipDefaults.caretShape(),
            ) { Text(text, style = CCText.S14) }
        },
        state = state,
        enableUserInput = false,
        content = content,
    )
}
