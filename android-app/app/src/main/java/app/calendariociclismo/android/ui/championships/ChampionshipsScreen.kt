package app.calendariociclismo.android.ui.championships

import androidx.compose.foundation.isSystemInDarkTheme
import app.calendariociclismo.android.ui.theme.CCColors
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.neutralFill
import app.calendariociclismo.android.ui.theme.neutralFillPressed
import app.calendariociclismo.android.ui.month.CalendarFilterChip
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.outlined.SportsScore
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.ChampionshipCountry
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.RegionDetector
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Modo Campeonatos — rejilla país × pruebas de los Campeonatos Nacionales.
 * Port nativo de `campeonatos-nacionales-2026.html` / `js/campeonatos.js`.
 *
 * Pantalla completa (con TopAppBar + back), usada por el botón "Modo
 * Campeonatos" desde Hoy. [ChampionshipsContent] contiene la rejilla.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChampionshipsScreen(navController: NavController) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("${stringResource(R.string.champ_title)} ${ChampionshipsConfig.YEAR}") },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.action_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        ChampionshipsGrid(
            navController = navController,
            showHeader = false,
            modifier = Modifier.fillMaxSize().padding(padding),
        )
    }
}

/** Contenido embebido para el takeover del tab Hoy (sin Scaffold ni TopAppBar). */
@Composable
fun ChampionshipsContent(navController: NavController) {
    ChampionshipsGrid(
        navController = navController,
        showHeader = true,
        modifier = Modifier.fillMaxSize(),
    )
}

@Composable
private fun ChampionshipsGrid(
    navController: NavController,
    showHeader: Boolean,
    modifier: Modifier = Modifier,
) {
    val app = rememberApp()
    val vm: ChampionshipsViewModel = viewModel(factory = ChampionshipsViewModelFactory(app.repository))
    val state by vm.state.collectAsState()

    Box(modifier = modifier) {
        when {
            state.isLoading && state.countries.isEmpty() ->
                RouteLoadingView(
                    message = stringResource(R.string.loading),
                    modifier = Modifier.fillMaxSize(),
                    title = LocaleHolder.t("Campeonatos nacionales", "National championships"),
                )

            !state.error.isNullOrEmpty() && state.countries.isEmpty() ->
                Text(
                    text = state.error!!.ifEmpty { stringResource(R.string.champ_error) },
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                )

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (showHeader) {
                    item(key = "__title__") {
                        Text(
                            text = "${stringResource(R.string.champ_title)} ${ChampionshipsConfig.YEAR}",
                            style = CCText.S20,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    }
                }
                item(key = "__filters__") {
                    FilterChips(current = state.filter, onPick = { vm.setFilter(it) })
                }
                val countries = state.displayCountries
                if (countries.isEmpty()) {
                    item(key = "__empty__") {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(top = 48.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = stringResource(R.string.champ_empty),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                } else {
                    items(countries, key = { it.countryCode }) { country ->
                        CountryCard(country = country, filter = state.filter, navController = navController, inhouseKeys = state.inhouseKeys)
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterChips(
    current: ChampionshipsConfig.Filter,
    onPick: (ChampionshipsConfig.Filter) -> Unit,
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(vertical = 4.dp),
    ) {
        items(ChampionshipsConfig.visibleFilters(), key = { it.id }) { filter ->
            val selected = filter == current
            CalendarFilterChip(
                label = stringResource(filter.labelRes),
                selected = selected,
                onClick = { if (!selected) onPick(filter) },
            )
        }
    }
}

@Composable
private fun CountryCard(
    country: ChampionshipCountry,
    filter: ChampionshipsConfig.Filter,
    navController: NavController,
    inhouseKeys: Set<String> = emptySet(),
) {
    val countryName = remember(country.countryCode) {
        Locale("", country.countryCode).getDisplayCountry(LocaleHolder.current)
            .ifEmpty { country.countryCode }
    }
    CCCard {
        Column(
            modifier = Modifier.padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CountryFlag(countryCode = country.countryCode, countryName = countryName)
                Text(
                    text = countryName,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                country.hostCity?.takeIf { it.isNotEmpty() }?.let { sede ->
                    Text(
                        text = "· $sede",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
            // Rejilla compacta: 4 celdas por fila (8 pruebas → 2 filas, no 8).
            val slots = country.visibleSlots(filter)
            slots.chunked(4).forEach { rowSlots ->
                Row(
                    modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    rowSlots.forEach { slot ->
                        country.slots[slot]?.let { enriched ->
                            EventCell(
                                slot = slot,
                                item = enriched,
                                navController = navController,
                                inhouseKeys = inhouseKeys,
                                modifier = Modifier.weight(1f).fillMaxHeight(),
                            )
                        }
                    }
                    repeat(4 - rowSlots.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * Celda compacta de una prueba. Por prioridad (espejo de `eventCell` en
 * js/campeonatos.js): con clasificaciones propias → trofeo a la pantalla nativa;
 * si no, concluida → bandera; con TV → badge de TV (Live / hora / "TV"); si no →
 * hora de meta con bandera a cuadros. El cuerpo navega al detalle. Paridad con
 * `ChampionshipEventCell` iOS.
 */
@Composable
private fun EventCell(
    slot: ChampionshipsConfig.Slot,
    item: EnrichedRaceDay,
    navController: NavController,
    inhouseKeys: Set<String> = emptySet(),
    modifier: Modifier = Modifier,
) {
    val rd = item.raceDay
    val app = rememberApp()
    val concluded = RaceLogic.isRaceConcluded(rd)
    // El badge de TV de la celda debe respetar la preferencia regional igual que
    // las race cards / la web (que pre-filtra): si no, un usuario de España vería
    // la TV del campeonato de Bélgica.
    val regionBroadcasts = RaceLogic.filterBroadcastsByRegion(item.broadcasts, RegionDetector.allowedBroadcastGroups())
    val hasTvInfo = regionBroadcasts.isNotEmpty() || !rd.tvStatus.isNullOrEmpty()
    // ¿Resultados in-house? → el trofeo lleva a la pantalla NATIVA (como las race cards).
    val hasInhouse = item.race?.id?.let { inhouseKeys.contains(app.repository.inhouseKey(it, rd.stageNumber)) } ?: false
    val showResults = hasInhouse

    // Celda en superficie gris neutra, sin tinte ni borde. Al mostrar
    // resultados la navegación va solo en la zona etiqueta+día (más abajo); el
    // resto de estados navega desde toda la celda.
    val shape = RoundedCornerShape(CCRadius.Control)
    val cellContent: @Composable () -> Unit = { Column(
        modifier = Modifier.padding(vertical = 8.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        val headerModifier =
            if (showResults) Modifier.clickable(role = Role.Button) { navController.navigate(Routes.stage(rd.id)) }
            else Modifier
        Column(
            modifier = headerModifier,
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = slot.shortLabel(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            CellDivider()
            Text(
                text = dayLabel(rd.dateKey),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
        CellDivider()
        when {
            // El trofeo (pantalla NATIVA) sustituye a hora/TV.
            showResults && item.race != null ->
                TrophyBadge { navController.navigate(Routes.results(item.race!!.id, rd.stageNumber)) }
            concluded -> Icon(
                imageVector = Icons.Filled.Flag,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(12.dp),
            )
            hasTvInfo -> TvBadge(broadcasts = regionBroadcasts)
            else -> rd.estimatedFinishTimeUtc?.let { DateFormatting.formatTimeLocal(it) }?.let { time ->
                // Hora de meta con bandera a cuadros (paridad con la web).
                Row(
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.SportsScore,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(11.dp),
                    )
                    Text(
                        text = time,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } ?: Spacer(Modifier.size(12.dp))
        }
    } }
    if (showResults) {
        Surface(modifier = modifier, shape = shape, color = neutralFill, content = cellContent)
    } else {
        Surface(
            onClick = { navController.navigate(Routes.stage(rd.id)) },
            modifier = modifier,
            shape = shape,
            color = neutralFill,
            content = cellContent,
        )
    }
}

/** Separador fino entre prueba/día y día/estado: línea corta y tenue centrada. */
@Composable
private fun CellDivider() {
    HorizontalDivider(modifier = Modifier.width(26.dp), color = MaterialTheme.colorScheme.outlineVariant)
}

/** Badge de TV: "Live" si la hora de TV ya pasó, la hora si es futura, o "TV". */
@Composable
private fun TvBadge(broadcasts: List<Broadcast>) {
    val state = RaceLogic.championshipTvState(broadcasts)
    // Verde solo en directo; el resto, texto principal neutro.
    val tint = if (state is RaceLogic.ChampionshipTvState.Live) { if (isSystemInDarkTheme()) CCColors.DarkGreen else CCColors.LightGreen } else MaterialTheme.colorScheme.onSurface
    Row(
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Outlined.Tv,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(11.dp),
        )
        val label = when (val s = state) {
            is RaceLogic.ChampionshipTvState.Live -> "Live"
            is RaceLogic.ChampionshipTvState.Time -> s.display
            is RaceLogic.ChampionshipTvState.Label -> "TV"
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = if (label == "Live") FontWeight.SemiBold else FontWeight.Normal,
            color = tint,
        )
    }
}

/** Badge-trofeo → pantalla NATIVA de resultados (cuando hay clasificaciones in-house). */
@Composable
private fun TrophyBadge(onClick: () -> Unit) {
    // Enlace neutro: texto principal sobre el gris de las etiquetas.
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(CCRadius.Control),
        color = neutralFillPressed,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Icon(
            imageVector = Icons.Filled.EmojiEvents,
            contentDescription = stringResource(R.string.results_cta),
            modifier = Modifier
                .padding(horizontal = 6.dp, vertical = 3.dp)
                .size(14.dp),
        )
    }
}

/** Día corto "EEE d" (sin mes — la semana es conocida). */
private fun dayLabel(dateKey: String): String {
    val date = DateFormatting.parseLocalDate(dateKey) ?: return dateKey
    val fmt = DateTimeFormatter.ofPattern("EEE d", LocaleHolder.current)
    val str = date.format(fmt)
    return str.replaceFirstChar { it.uppercase() }
}
