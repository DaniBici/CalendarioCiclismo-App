package app.calendariociclismo.android.ui.startlist

import app.calendariociclismo.android.ui.components.RouteLoadingView
import android.widget.Toast
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.runtime.rememberCoroutineScope
import app.calendariociclismo.android.util.StartlistPdfExporter
import kotlinx.coroutines.launch
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.adaptive.rememberAdaptiveLayoutInfo
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.outlined.Info
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.ui.theme.neutralFill
import androidx.navigation.NavController
import app.calendariociclismo.android.CalendarioCiclismoApp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.*
import android.os.Bundle
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.UciResultsLogic
import kotlinx.coroutines.delay

sealed class StartlistState {
    object Loading : StartlistState()
    data class Ready(val data: StartlistData) : StartlistState()
    data class Error(val message: String) : StartlistState()
}

@Composable
fun StartlistScreen(
    raceId: String,
    navController: NavController,
    app: CalendarioCiclismoApp,
    context: Context,
) {
    var state by remember { mutableStateOf<StartlistState>(StartlistState.Loading) }
    var isRefreshing by remember { mutableStateOf(false) }

    val unknownErrorFallback = stringResource(R.string.startlist_error_unknown)
    suspend fun loadStartlistData() {
        runCatching { app.repository.loadStartlistData(raceId) }
            .onSuccess { data -> state = StartlistState.Ready(data) }
            .onFailure { error -> state = StartlistState.Error(error.message ?: unknownErrorFallback) }
    }

    suspend fun refresh() {
        isRefreshing = true
        delay(300) // Pequeño delay para mejor UX
        loadStartlistData()
        isRefreshing = false
    }

    val app = rememberApp()
    val scope = rememberCoroutineScope()
    var isExportingPdf by remember { mutableStateOf(false) }
    val pdfErrorMessage = stringResource(R.string.startlist_pdf_error)
    fun exportPdf() {
        if (isExportingPdf) return
        isExportingPdf = true
        scope.launch {
            val english = LocaleHolder.current.language == "en"
            runCatching { StartlistPdfExporter.export(context, raceId, english) }
                .onSuccess { file ->
                    StartlistPdfExporter.open(context, file)
                    app.analytics.logEvent("startlist_pdf", Bundle().apply { putString("race_id", raceId) })
                }
                .onFailure { Toast.makeText(context, pdfErrorMessage, Toast.LENGTH_LONG).show() }
            isExportingPdf = false
        }
    }

    LaunchedEffect(raceId) {
        loadStartlistData()
    }

    LaunchedEffect(state) {
        val ready = state as? StartlistState.Ready ?: return@LaunchedEffect
        app.analytics.logScreenView(
            "startlist",
            Bundle().apply {
                putString("race_id", raceId)
                putString("race_name", ready.data.race.name)
            },
        )
    }

    Scaffold { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (val currentState = state) {
                is StartlistState.Loading -> LoadingContent()
                is StartlistState.Error -> {
                    ErrorContent(error = currentState.message) {
                        state = StartlistState.Loading
                    }
                }
                is StartlistState.Ready -> {
                    StartlistContent(
                        data = currentState.data,
                        isRefreshing = isRefreshing,
                        onRefresh = { state = StartlistState.Loading; state = StartlistState.Ready(currentState.data) },
                        onBack = { navController.popBackStack() },
                        isExportingPdf = isExportingPdf,
                        onDownloadPdf = ::exportPdf,
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadingContent() {
    RouteLoadingView(
        message = stringResource(R.string.loading),
        showProfile = false,
        title = LocaleHolder.t("Inscritos", "Startlist"),
    )
}

@Composable
private fun ErrorContent(error: String, onRetry: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                stringResource(R.string.startlist_error_title),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            Text(
                error,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Button(onClick = onRetry) {
                Text(stringResource(R.string.action_retry))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StartlistContent(
    data: StartlistData,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
    isExportingPdf: Boolean,
    onDownloadPdf: () -> Unit,
) {
    val pullRefreshState = rememberPullToRefreshState()
    val adaptiveInfo = rememberAdaptiveLayoutInfo()

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
        state = pullRefreshState,
    ) {
      Column(
          modifier = Modifier
              .fillMaxSize()
              .background(MaterialTheme.colorScheme.background),
      ) {
        // La cabecera de carrera queda FIJA arriba (no scrollea con la lista de
        // equipos); mismo inset lateral/superior que el contentPadding de la
        // lista, más un hueco inferior que reproduce el `spacedBy`.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
        ) {
            // Los estados sin equipo no cuentan como formaciones (sus corredores sí).
            StartlistHeaderCard(
                race = data.race,
                teamCount = data.teams.count { !it.isNoTeamPlaceholder },
                riderCount = data.riders.size,
                onBack = onBack,
                isExportingPdf = isExportingPdf,
                onDownloadPdf = onDownloadPdf.takeIf { data.teams.isNotEmpty() },
            )
        }

        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
            val columns = AdaptiveLayoutPolicy.startlistColumns(maxWidth.value - 24f, adaptiveInfo)
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (data.race.startlistProvisional == true) {
                    item(span = { GridItemSpan(maxLineSpan) }) { ProvisionalDisclaimerCard() }
                }

                if (data.teams.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Text(
                            stringResource(R.string.startlist_empty),
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    items(count = data.teams.size, key = { index -> data.teams[index].id }) { index ->
                        val team = data.teams[index]
                        val teamRiders = data.riders
                            .filter { it.teamId == team.id }
                            .sortedWith(compareBy(nullsLast()) { it.dorsal })
                        val globalTeam = data.globalTeams.find { it.id == team.teamId }
                        StartlistTeamCard(
                            team = team,
                            riders = teamRiders,
                            globalTeam = globalTeam,
                            isProvisional = data.race.startlistProvisional == true,
                            ridersOut = data.ridersOut,
                            isOneDay = data.race.raceFormat == "one_day",
                        )
                    }
                }
            }
        }
      }
    }
}

@Composable
private fun StartlistHeaderCard(
    race: Race,
    teamCount: Int,
    riderCount: Int,
    onBack: () -> Unit,
    isExportingPdf: Boolean,
    onDownloadPdf: (() -> Unit)?,
) {
    // Cabecera neutra en CCCard (sin tinte de marca), igual que el resto de
    // detalle. Sustituye el Card surfaceVariant 40% por la superficie pulida.
    CCCard(
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = stringResource(R.string.action_back),
                        modifier = Modifier.size(18.dp)
                    )
                }

                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        if (!race.countryCode.isNullOrBlank()) {
                            CountryFlag(countryCode = race.countryCode)
                        }
                        Text(
                            race.localizedName,
                            style = CCText.S16,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                if (race.logoUrl != null) {
                    RaceLogo(url = race.logoUrl, size = 36.dp)
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Sin equipos reales (startlist 100% ficticio "Individual") no se
                // muestra "Equipos: 0": solo el total de corredores.
                if (teamCount > 0) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            stringResource(R.string.startlist_label_teams),
                            style = CCText.S12,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            teamCount.toString(),
                            style = CCText.S20,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    VerticalDivider(modifier = Modifier.height(32.dp))
                }

                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        stringResource(if (race.isFemale) R.string.startlist_label_riders_female else R.string.startlist_label_riders_male),
                        style = CCText.S12,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        riderCount.toString(),
                        style = CCText.S20,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                if (onDownloadPdf != null) {
                    Spacer(modifier = Modifier.weight(1f))
                    // PDF generado con el mismo código que la web (StartlistPdfExporter).
                    // En la fila de recuentos para no restar ancho al nombre de la carrera.
                    IconButton(
                        onClick = onDownloadPdf,
                        enabled = !isExportingPdf,
                        modifier = Modifier.size(32.dp),
                    ) {
                        if (isExportingPdf) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(
                                imageVector = Icons.Outlined.FileDownload,
                                contentDescription = stringResource(R.string.startlist_download_pdf),
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Aviso de lista provisional sobre la superficie neutra; título en acento, como la web. */
@Composable
private fun ProvisionalDisclaimerCard() {
    CCCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Outlined.Info,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    stringResource(R.string.startlist_disclaimer_provisional_title),
                    style = CCText.S14,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Text(
                stringResource(R.string.startlist_disclaimer_provisional_body),
                style = CCText.S13,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StartlistTeamCard(
    team: StartlistTeam,
    riders: List<StartlistRider>,
    globalTeam: Team?,
    isProvisional: Boolean,
    ridersOut: Map<String, RiderOut> = emptyMap(),
    isOneDay: Boolean = false,
) {
    // Tarjeta de equipo sobre la superficie neutra: cabecera gris con las
    // franjas de maillot del equipo (las de Resultados), como iOS.
    CCCard(
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // Los estados sin equipo van SIN cabecera (ocultación cosmética,
            // espejo de la web/iOS): solo se listan sus corredores.
            if (!team.isNoTeamPlaceholder) Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 38.dp)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(horizontal = 12.dp)
                    .semantics(mergeDescendants = true) { heading() },
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                globalTeam?.let { TeamColorBands(it) }
                Text(
                    globalTeam?.name ?: team.displayName,
                    modifier = Modifier.weight(1f),
                    style = CCText.S14,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                if (isProvisional) {
                    Box(
                        modifier = Modifier
                            .size(18.dp)
                            .clip(RoundedCornerShape(CCRadius.Control))
                            .background(
                                if (team.isConfirmed) MaterialTheme.colorScheme.primary
                                else Color(0xFF6B7280)
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = if (team.isConfirmed) Icons.Filled.Check else Icons.Filled.Close,
                            contentDescription = stringResource(
                                if (team.isConfirmed) R.string.startlist_team_confirmed_cd
                                else R.string.startlist_team_pending_cd
                            ),
                            modifier = Modifier.size(12.dp),
                            tint = Color.White,
                        )
                    }
                }
            }

            // Riders
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
            ) {
                riders.forEach { rider ->
                    val out = rider.globalRiderId?.let { ridersOut[it] }
                    StartlistRiderRow(
                        rider,
                        out = out,
                        isOneDay = isOneDay,
                    )
                }
            }
        }
    }
}

@Composable
private fun StartlistRiderRow(
    rider: StartlistRider,
    out: RiderOut? = null,
    isOneDay: Boolean = false,
) {
    val isOut = out != null
    // Fuera de carrera → fila atenuada (opacidad, no color → dark-mode safe).
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .alpha(if (isOut) 0.55f else 1f)
            .padding(horizontal = 12.dp, vertical = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Dorsal
        // Dorsal en recuadro gris (radio de control), como la web.
        if (rider.dorsal != null && rider.dorsal != 0) {
            Text(
                "${rider.dorsal}",
                modifier = Modifier
                    .width(34.dp)
                    .clip(RoundedCornerShape(CCRadius.Control))
                    .background(neutralFill)
                    .padding(vertical = 1.dp),
                style = CCText.S13.copy(fontFeatureSettings = "tnum"),
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        } else {
            Spacer(modifier = Modifier.width(34.dp))
        }

        // Flag
        if (!rider.countryCode.isNullOrBlank()) {
            CountryFlag(
                countryCode = rider.countryCode,
                modifier = Modifier.width(22.dp)
            )
        }

        // Nombre (tachado si fuera de carrera) + motivo como subtítulo.
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                rider.fullName,
                style = CCText.S14,
                maxLines = 2,
                textDecoration = if (isOut) TextDecoration.LineThrough else null,
            )
            if (out != null) {
                val isEn = LocaleHolder.shouldShowEnglishContent
                val label = UciResultsLogic.irmLabel(out.irm, isEn)
                val reason = if (out.stageNumber != null && !isOneDay) {
                    if (out.stageNumber == 0) {
                        stringResource(R.string.startlist_dnf_reason_prologue, label)
                    } else {
                        stringResource(R.string.startlist_dnf_reason_stage, label, out.stageNumber)
                    }
                } else {
                    stringResource(R.string.startlist_dnf_reason, label)
                }
                Text(
                    reason,
                    style = CCText.S12,
                    color = MaterialTheme.colorScheme.error,
                    maxLines = 1,
                )
            }
        }
    }
}
