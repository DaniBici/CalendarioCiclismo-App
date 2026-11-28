package app.calendariociclismo.android.ui.startlist

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RiderOut
import app.calendariociclismo.android.data.model.StartlistData
import app.calendariociclismo.android.data.model.StartlistRider
import app.calendariociclismo.android.data.model.StartlistTeam
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.TeamNames
import app.calendariociclismo.android.util.UciResultsLogic

/**
 * «Busca dorsal»: hoja de la tarjeta de Hoy con la jornada en curso. Se teclea
 * un dorsal y el corredor aparece sin confirmar, con su equipo y sus
 * compañeros. Lee la misma lista que la pantalla de inscritos.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BibSearchSheet(race: Race, onDismiss: () -> Unit, onShowFullList: () -> Unit) {
    val app = rememberApp()
    var data by remember(race.id) { mutableStateOf<StartlistData?>(null) }
    var failed by remember(race.id) { mutableStateOf(false) }
    var query by remember(race.id) { mutableStateOf("") }
    val focus = remember { FocusRequester() }

    LaunchedEffect(race.id) {
        runCatching { app.repository.loadStartlistData(race.id) }
            .onSuccess { data = it }
            .onFailure { failed = true }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        contentWindowInsets = { WindowInsets.safeDrawing },
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.today_bib_search_badge),
                    modifier = Modifier.weight(1f),
                    style = CCText.S16,
                    fontWeight = FontWeight.Bold,
                )
                TextButton(onClick = onShowFullList) { Text(stringResource(R.string.bib_search_full_list)) }
            }
            val numberLabel = stringResource(R.string.bib_search_number)
            OutlinedTextField(
                value = query,
                // Solo cifras, sin ceros a la izquierda y con tres como máximo.
                onValueChange = { value -> query = value.filter(Char::isDigit).trimStart('0').take(3) },
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focus)
                    .semantics { contentDescription = numberLabel },
                textStyle = CCText.S28.copy(fontWeight = FontWeight.Bold, fontFeatureSettings = "tnum"),
                leadingIcon = { Icon(ImageVector.vectorResource(R.drawable.ic_startlist_bib), null, Modifier.size(24.dp)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
            )
            val loaded = data
            when {
                loaded == null && failed -> Note(stringResource(R.string.bib_search_error))
                loaded == null -> Box(Modifier.fillMaxWidth().padding(top = 16.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                else -> Result(race, loaded, query)
            }
        }
    }
}

@Composable
private fun Note(text: String) {
    Text(text, style = CCText.S14, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Result(race: Race, data: StartlistData, query: String) {
    // Corredores con número, por dorsal. Ante un dorsal repetido vale el primero.
    val byBib = remember(data) {
        buildMap<Int, StartlistRider> {
            data.riders.forEach { rider -> rider.dorsal?.takeIf { it > 0 }?.let { putIfAbsent(it, rider) } }
        }
    }
    val rider = query.toIntOrNull()?.let { byBib[it] }
    when {
        byBib.isEmpty() -> Note(stringResource(R.string.bib_search_no_bibs))
        query.isEmpty() -> Note(stringResource(R.string.bib_search_hint))
        rider == null -> {
            Note(stringResource(R.string.bib_search_none, query))
            val near = remember(byBib, query) { byBib.keys.filter { it.toString().startsWith(query) }.sorted().take(6) }
            if (near.isNotEmpty()) Rows(near.mapNotNull { byBib[it] }, data.ridersOut, race.isOneDay)
        }
        else -> Hit(race, data, rider)
    }
}

@Composable
private fun Hit(race: Race, data: StartlistData, rider: StartlistRider) {
    val team: StartlistTeam? = data.teams.firstOrNull { it.id == rider.teamId }
    val globalTeam = team?.teamId?.let { id -> data.globalTeams.firstOrNull { it.id == id } }
    val showsTeam = team != null && !team.isNoTeamPlaceholder
    val out: RiderOut? = rider.globalRiderId?.let { data.ridersOut[it] }
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "${rider.dorsal}",
            style = CCText.S36.copy(fontFeatureSettings = "tnum"),
            fontWeight = FontWeight.Bold,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (!rider.countryCode.isNullOrBlank()) CountryFlag(countryCode = rider.countryCode, modifier = Modifier.width(22.dp))
                Text(
                    rider.fullName,
                    style = CCText.S16,
                    fontWeight = FontWeight.Bold,
                    maxLines = 2,
                    textDecoration = if (out != null) TextDecoration.LineThrough else null,
                )
            }
            if (showsTeam && team != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (globalTeam != null) TeamColorBands(globalTeam)
                    Text(
                        TeamNames.localizedName(globalTeam?.name ?: team.displayName, globalTeam, LocaleHolder.shouldShowEnglishContent),
                        style = CCText.S13,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (out != null) {
                val label = UciResultsLogic.irmLabel(out.irm, LocaleHolder.shouldShowEnglishContent)
                val reason = when {
                    out.stageNumber == null || race.isOneDay -> stringResource(R.string.startlist_dnf_reason, label)
                    out.stageNumber == 0 -> stringResource(R.string.startlist_dnf_reason_prologue, label)
                    else -> stringResource(R.string.startlist_dnf_reason_stage, label, out.stageNumber)
                }
                Text(reason, style = CCText.S13, color = MaterialTheme.colorScheme.error)
            }
        }
    }
    val mates = remember(data, rider.id) {
        data.riders.filter { it.teamId == rider.teamId && it.id != rider.id && (it.dorsal ?: 0) > 0 }.sortedBy { it.dorsal }
    }
    if (showsTeam && mates.isNotEmpty()) {
        Text(
            stringResource(if (race.isFemale) R.string.bib_search_mates_female else R.string.bib_search_mates),
            style = CCText.S12,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Rows(mates, data.ridersOut, race.isOneDay)
    }
}

@Composable
private fun Rows(riders: List<StartlistRider>, ridersOut: Map<String, RiderOut>, isOneDay: Boolean) {
    Column(Modifier.fillMaxWidth()) {
        riders.forEach { rider ->
            StartlistRiderRow(rider, out = rider.globalRiderId?.let { ridersOut[it] }, isOneDay = isOneDay)
        }
    }
}
