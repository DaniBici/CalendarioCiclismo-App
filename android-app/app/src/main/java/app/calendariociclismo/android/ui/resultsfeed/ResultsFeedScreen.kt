package app.calendariociclismo.android.ui.resultsfeed

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.StageTypeBadge
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.ui.today.ResultsDialog
import app.calendariociclismo.android.ui.today.ResultsDialogItem
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.ResultsFeedLogic
import app.calendariociclismo.android.util.rememberHaptics

/** Ventana del feed: 14 días por página (espejo de WINDOW_DAYS en
 *  resultados-feed.js); "Cargar más" amplía hacia atrás hasta SEASON_START. */
private const val WINDOW_DAYS = 14
private const val SEASON_START = "2026-01-01"

private sealed class FeedState {
    object Loading : FeedState()
    data class Ready(val entries: List<ResultsFeedLogic.FeedEntry>) : FeedState()
    data class Error(val message: String) : FeedState()
}

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
    val pullRefreshState = rememberPullToRefreshState()

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

    // Carga inicial y recarga al ampliar la ventana ("Cargar más").
    LaunchedEffect(fromKey) { reload() }

    // Pull-to-refresh: refetch del rango visible sin colapsar a Loading.
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
                        text = stringResource(R.string.tab_results),
                        style = MaterialTheme.typography.titleMedium,
                    )
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
                is FeedState.Loading -> {
                    val loadingCd = stringResource(R.string.loading)
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(
                            modifier = Modifier.semantics { contentDescription = loadingCd },
                        )
                    }
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
    }

    // Fallback externos: reusa el diálogo existente de las cards de Hoy.
    resultsDialogItem?.let { item ->
        ResultsDialog(item = item, context = context, onDismiss = { resultsDialogItem = null })
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
 * la tipografía de card, línea "Etapa N · salida › meta · NNN km" (etapa y km
 * en SemiBold) + chips de tipo reducidos, y tercera línea trofeo + ganador en
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
                    // Las generales finales solo llevan su etiqueta (sin ruta/km).
                    Text(
                        text = stringResource(R.string.results_feed_gc_final),
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.sp,
                        lineHeight = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    val subtitle = feedSubtitle(entry)
                    if (subtitle.isNotEmpty()) {
                        Text(
                            text = subtitle,
                            fontWeight = FontWeight.Normal,
                            fontSize = 12.sp,
                            lineHeight = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    // Chip de tipo reducido (mismo composable que las cards).
                    val rd = entry.rd
                    if (!rd?.primaryType.isNullOrBlank()) {
                        Row {
                            StageTypeBadge(
                                primaryType = rd?.primaryType,
                                secondaryType = rd?.secondaryType,
                                countryCode = race.countryCode,
                            )
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
 * Línea "Etapa N · salida › meta · NNN km" — "Etapa N" y los km en SemiBold,
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
        val start = rd?.localizedStartLocation?.takeUnless { it.isEmpty() }
        val finish = rd?.localizedFinishLocation?.takeUnless { it.isEmpty() }
        val route = when {
            finish == null || start == finish -> start ?: finish
            start == null -> finish
            else -> "$start › $finish"
        }
        route?.let {
            appendSeparator()
            append(it)
        }
        rd?.distanceFormatted?.let {
            appendSeparator()
            withStyle(bold) { append(it) }
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
