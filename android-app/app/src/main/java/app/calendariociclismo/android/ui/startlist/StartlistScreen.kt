package app.calendariociclismo.android.ui.startlist

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import app.calendariociclismo.android.ui.components.CCCard
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
import androidx.compose.ui.unit.sp
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
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadingContent() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        CircularProgressIndicator()
    }
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
) {
    val pullRefreshState = rememberPullToRefreshState()

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
            // El ficticio "Individual" no cuenta como equipo (sus corredores sí).
            StartlistHeaderCard(
                race = data.race,
                teamCount = data.teams.count { !it.isIndividualPlaceholder },
                riderCount = data.riders.size,
                onBack = onBack,
            )
        }

        LazyColumn(
            // weight(1f): ocupa el espacio restante bajo la cabecera fija.
            modifier = Modifier.fillMaxWidth().weight(1f),
            // Sin top: la cabecera fija ya aporta el inset superior.
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (data.race.startlistProvisional == true) {
                item {
                    ProvisionalDisclaimerCard()
                }
            }

            if (data.teams.isEmpty()) {
                item {
                    Text(
                        stringResource(R.string.startlist_empty),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                items(data.teams) { team ->
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

@Composable
private fun StartlistHeaderCard(race: Race, teamCount: Int, riderCount: Int, onBack: () -> Unit) {
    // Cabecera neutra en CCCard (sin tinte de marca), igual que el resto de
    // detalle. Sustituye el Card surfaceVariant 40% por la superficie pulida.
    CCCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 12,
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
                            style = MaterialTheme.typography.titleLarge,
                            // Peso igualado al titular del cintillo (Medium, no Bold).
                            fontWeight = FontWeight.Medium,
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
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Sin equipos reales (startlist 100% ficticio "Individual") no se
                // muestra "Equipos: 0": solo el total de corredores.
                if (teamCount > 0) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            stringResource(R.string.startlist_label_teams),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            teamCount.toString(),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    HorizontalDivider(modifier = Modifier.width(1.dp))
                }

                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        stringResource(if (race.isFemale) R.string.startlist_label_riders_female else R.string.startlist_label_riders_male),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        riderCount.toString(),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}

@Composable
private fun ProvisionalDisclaimerCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                stringResource(R.string.startlist_disclaimer_provisional_title),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                stringResource(R.string.startlist_disclaimer_provisional_body),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer
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
    val headerBgColor = globalTeam?.headerBg?.let { Color(android.graphics.Color.parseColor(it)) }
        ?: MaterialTheme.colorScheme.surfaceVariant
    val headerTextColor = globalTeam?.headerText?.let { Color(android.graphics.Color.parseColor(it)) }
        ?: MaterialTheme.colorScheme.onSurfaceVariant

    // Tarjeta de equipo en CCCard: la superficie pulida (esquinas, sombra,
    // hairline) envuelve el header con el color del equipo y la lista de
    // corredores. CCCard recorta el contenido a la forma, así que el header
    // coloreado queda enrasado con las esquinas redondeadas.
    CCCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 12,
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // Header — el ficticio "Individual" va SIN cabecera (ocultación
            // cosmética, espejo de la web): solo se listan sus corredores.
            if (!team.isIndividualPlaceholder) Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(headerBgColor)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (globalTeam != null) {
                    TeamBadgeComposable(globalTeam, size = 32)
                }

                Text(
                    globalTeam?.name ?: team.displayName,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = headerTextColor,
                    maxLines = 1
                )

                if (isProvisional) {
                    Box(
                        modifier = Modifier
                            .size(18.dp)
                            .clip(RoundedCornerShape(4.dp))
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
                    .background(MaterialTheme.colorScheme.background)
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
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Dorsal
        if (rider.dorsal != null && rider.dorsal != 0) {
            Surface(
                modifier = Modifier
                    .width(28.dp)
                    .wrapContentHeight(),
                shape = RoundedCornerShape(2.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        "${rider.dorsal}",
                        modifier = Modifier
                            .padding(horizontal = 4.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 10.sp
                    )
                }
            }
        } else {
            Spacer(modifier = Modifier.width(28.dp))
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
                style = MaterialTheme.typography.bodySmall,
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
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                    maxLines = 1,
                )
            }
        }
    }
}
