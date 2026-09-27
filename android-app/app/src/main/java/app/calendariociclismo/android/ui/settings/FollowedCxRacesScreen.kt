package app.calendariociclismo.android.ui.settings

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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.CxPresentation
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.LocaleHolder
import kotlinx.coroutines.launch

/**
 * Lista de carreras de ciclocross seguidas individualmente para notificaciones
 * push. Independiente del modo de carretera: sigue el mismo mecanismo que las
 * carreras de ruta, sin etapas ni torneos completos. Accesible desde Ajustes →
 * Notificaciones → Carreras y jornadas.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FollowedCxRacesScreen(navController: NavController) {
    val app = rememberApp()
    val scope = rememberCoroutineScope()

    val followedCxRaceIds by app.preferences.followedCxRaceIds.collectAsState(initial = emptySet())
    var races by remember { mutableStateOf<List<CxRace>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(followedCxRaceIds) {
        if (followedCxRaceIds.isEmpty()) {
            races = emptyList()
            isLoading = false
            return@LaunchedEffect
        }
        isLoading = true
        error = null
        runCatching {
            races = app.supabaseService.cxRacesByIds(followedCxRaceIds.toList()).sortedBy { it.dateKey }
        }.onFailure {
            error = it.message
        }
        isLoading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.followed_cx_races_title)) },
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
        when {
            isLoading -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }

            !error.isNullOrEmpty() -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { Text(error!!, color = MaterialTheme.colorScheme.error) }

            races.isEmpty() -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(horizontal = 40.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Notifications,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(48.dp),
                    )
                    Text(
                        text = stringResource(R.string.followed_cx_races_empty_title),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = stringResource(R.string.followed_cx_races_empty_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(vertical = 8.dp),
            ) {
                items(races, key = { it.id }) { race ->
                    val dismissState = rememberSwipeToDismissBoxState(
                        confirmValueChange = { value ->
                            if (value == SwipeToDismissBoxValue.EndToStart) {
                                scope.launch {
                                    val updated = followedCxRaceIds - race.id
                                    app.preferences.setFollowedCxRaceIds(updated)
                                    app.pushManager.syncCategories()
                                }
                                true
                            } else false
                        },
                    )
                    SwipeToDismissBox(
                        state = dismissState,
                        backgroundContent = {
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(horizontal = 16.dp),
                                contentAlignment = Alignment.CenterEnd,
                            ) {
                                Text(
                                    text = stringResource(R.string.action_deactivate),
                                    color = MaterialTheme.colorScheme.error,
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                        },
                        enableDismissFromStartToEnd = false,
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            RaceLogo(url = CxPresentation.logo(race), size = 36.dp)
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = LocaleHolder.t(race.name, race.nameEn?.takeIf { it.isNotBlank() } ?: race.name),
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = DateFormatting.formatDateLongContent(race.dateKey),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
