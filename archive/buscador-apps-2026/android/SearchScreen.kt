package app.calendariociclismo.android.ui.search

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.components.CategoryBadge
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.rememberHaptics
import java.text.Normalizer
import java.time.LocalDate

// ─── Modelos ──────────────────────────────────────────────────────

data class SearchResult(
    val race: Race,
    val matchLocation: MatchLocation?,
    val matchedRaceDayId: String?,
    // Para carreras de un día: id de su jornada única. Permite que el resultado
    // navegue a la jornada (no a competición, que no tiene lista de etapas).
    val oneDayRaceDayId: String? = null,
) {
    val id: String get() = race.id

    enum class MatchLocation(@androidx.annotation.StringRes val labelRes: Int) {
        StartCity(R.string.search_match_start),
        FinishCity(R.string.search_match_finish),
        StartAndFinish(R.string.search_match_start_finish),
        Description(R.string.search_match_description),
    }
}

/**
 * Resultado del buscador — una carrera con su relevancia (`score`). Las que casan
 * por NOMBRE/categoría son fuertes (weak=0); las que casan solo por una ubicación
 * de etapa son débiles (weak=1) y caen al final a igual score.
 */
data class RaceHit(
    val result: SearchResult,
    val score: Int,
    val weak: Int,
) {
    val key: String get() = "race:${result.id}"
}

// ─── Screen ───────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(navController: NavController) {
    val app = rememberApp()
    val haptic = rememberHaptics()
    val year = LocalDate.now().year
    var query by remember { mutableStateOf("") }
    val allRaces by app.repository.observeAllRaces().collectAsState(initial = emptyList())
    var raceDaysByRaceId by remember { mutableStateOf<Map<String, List<RaceDay>>>(emptyMap()) }
    var raceDayTextByRaceId by remember { mutableStateOf<Map<String, String>>(emptyMap()) }

    LaunchedEffect(year) {
        runCatching { app.repository.refreshRacesYear(year) }
        runCatching {
            val raceDays = app.repository.searchRaceDays(year)
            val textMap = mutableMapOf<String, MutableList<String>>()
            val daysMap = mutableMapOf<String, MutableList<RaceDay>>()
            for (rd in raceDays) {
                val raceId = rd.raceId ?: continue
                val parts = mutableListOf<String>()
                rd.startLocation?.let { parts += it }
                rd.finishLocation?.let { parts += it }
                rd.startLocationEn?.let { parts += it }
                rd.finishLocationEn?.let { parts += it }
                rd.description?.let { parts += it }
                if (parts.isNotEmpty()) textMap.getOrPut(raceId) { mutableListOf() }.addAll(parts)
                daysMap.getOrPut(raceId) { mutableListOf() }.add(rd)
            }
            raceDayTextByRaceId = textMap.mapValues { it.value.joinToString(" ") }
            raceDaysByRaceId = daysMap
        }
    }

    // Analytics con parámetros
    LaunchedEffect(query) {
        app.analytics.logScreenView(
            "search",
            android.os.Bundle().apply {
                putString("search_query", query)
            },
        )
    }

    val results: List<RaceHit> = remember(allRaces, raceDaysByRaceId, raceDayTextByRaceId, query) {
        val q = normalize(query)
        if (q.length < 2) return@remember emptyList()
        val terms = q.split(" ").filter { it.isNotEmpty() }

        // ── Carreras ──────────────────────────────────────────────
        val raceHits = allRaces.filter { it.year == year }.mapNotNull { race ->
            val raceHaystack = normalize(
                listOfNotNull(race.name, race.originalName, race.slug, race.countryCode, race.uciCategory)
                    .joinToString(" ")
            )
            val fullHaystack = normalize(
                listOfNotNull(raceHaystack, raceDayTextByRaceId[race.id])
                    .joinToString(" ")
            )
            if (!terms.all { fullHaystack.contains(it) }) return@mapNotNull null

            val matchLocation: SearchResult.MatchLocation?
            val matchedRaceDayId: String?
            val matchedName: Boolean
            if (terms.all { raceHaystack.contains(it) }) {
                matchLocation = null
                matchedRaceDayId = null
                matchedName = true
            } else {
                val match = findMatchLocation(race.id, terms, raceDaysByRaceId)
                matchLocation = match?.first
                matchedRaceDayId = match?.second
                matchedName = false
            }
            val oneDayRaceDayId = if (race.isOneDay) {
                raceDaysByRaceId[race.id]?.singleOrNull()?.id
                    ?: raceDaysByRaceId[race.id]?.firstOrNull()?.id
            } else null
            // score por NOMBRE de carrera (las que casan por ubicación van detrás).
            val s = if (matchedName) scoreText(race.name, q) else 0
            RaceHit(
                result = SearchResult(race, matchLocation, matchedRaceDayId, oneDayRaceDayId),
                score = s,
                weak = if (matchedName) 0 else 1,
            )
        }

        // ── Orden por relevancia ──────────────────────────────────
        raceHits.sortedWith(
            compareByDescending<RaceHit> { it.score }
                .thenBy { it.weak }
                .thenBy { hitSortKey(it) }
        ).take(MAX_COMBINED)
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.tab_search), style = MaterialTheme.typography.titleMedium) })
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text(stringResource(R.string.search_field_label)) },
                placeholder = { Text(stringResource(R.string.search_field_placeholder)) },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    imeAction = ImeAction.Search,
                ),
            )

            when {
                allRaces.isEmpty() && query.isEmpty() -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    val loadingCd = stringResource(R.string.loading)
                    androidx.compose.material3.CircularProgressIndicator(
                        modifier = Modifier.semantics { contentDescription = loadingCd }
                    )
                }
                query.isEmpty() -> EmptySearchState(
                    title = stringResource(R.string.search_empty_title),
                    subtitle = stringResource(R.string.search_empty_body),
                )
                results.isEmpty() -> EmptySearchState(
                    title = stringResource(R.string.search_no_results_title),
                    subtitle = stringResource(R.string.search_no_results_body, query),
                )
                else -> {
                    val countText = if (results.size == 1) {
                        stringResource(R.string.search_results_count_one, results.size)
                    } else {
                        stringResource(R.string.search_results_count_other, results.size)
                    }
                    Text(
                        text = countText,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        items(results, key = { it.key }) { hit ->
                            SearchResultRow(
                                result = hit.result,
                                onClick = {
                                    haptic(Haptics.Event.Navigation)
                                    // Jornada por etapas que casó una etapa concreta, o
                                    // carrera de un día (su jornada única) → a la jornada.
                                    // El resto (carrera por etapas que casó por nombre) → a
                                    // competición. Pasamos raceId como hint para que
                                    // StageScreen prefetchee si la jornada no está en caché.
                                    val race = hit.result.race
                                    val stageId = if (race.isStageRace) hit.result.matchedRaceDayId
                                        else hit.result.oneDayRaceDayId
                                    if (stageId != null) {
                                        navController.navigate(Routes.stage(stageId, race.id))
                                    } else {
                                        navController.navigate(Routes.race(race.id))
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────

private const val MAX_COMBINED = 12

/** Puntuación por substring (espejo de `score()` en js/buscar.js): match al
 *  inicio = 3, tras un espacio = 2, en cualquier otro lugar = 1, sin match = 0. */
private fun scoreText(text: String?, q: String): Int {
    val t = normalize(text ?: "")
    val idx = t.indexOf(q)
    if (idx == -1) return 0
    if (idx == 0) return 3
    if (t.contains(" $q")) return 2
    return 1
}

/** Desempate estable a igual score/weak: por nivel pro + fecha de la carrera. */
private fun hitSortKey(hit: RaceHit): String {
    val r = hit.result.race
    return "%02d:%s".format(RaceLogic.proLevel(r.uciCategory, r.name, r.countryCode), r.startDate ?: "")
}

private fun normalize(str: String): String {
    val lower = str.lowercase()
    val nfd = Normalizer.normalize(lower, Normalizer.Form.NFD)
    return nfd.replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
        .replace(Regex("[^a-z0-9\\s]"), " ")
        .trim()
}

private fun findMatchLocation(
    raceId: String,
    terms: List<String>,
    raceDaysByRaceId: Map<String, List<RaceDay>>,
): Pair<SearchResult.MatchLocation, String>? {
    val days = raceDaysByRaceId[raceId] ?: return null
    for (rd in days) {
        val startVariants = listOfNotNull(rd.startLocation, rd.startLocationEn)
            .map { normalize(it) }.filter { it.isNotEmpty() }
        val finishVariants = listOfNotNull(rd.finishLocation, rd.finishLocationEn)
            .map { normalize(it) }.filter { it.isNotEmpty() }
        val descNorm = rd.description?.let { normalize(it) } ?: ""

        val matchesStart = startVariants.any { v -> terms.any { v.contains(it) } }
        val matchesFinish = finishVariants.any { v -> terms.any { v.contains(it) } }
        val matchesDesc = descNorm.isNotEmpty() && terms.any { descNorm.contains(it) }

        if (matchesStart && rd.finishLocation.isNullOrEmpty() && rd.finishLocationEn.isNullOrEmpty()) return SearchResult.MatchLocation.StartAndFinish to rd.id
        if (matchesStart) return SearchResult.MatchLocation.StartCity to rd.id
        if (matchesFinish) return SearchResult.MatchLocation.FinishCity to rd.id
        if (matchesDesc) return SearchResult.MatchLocation.Description to rd.id
    }
    return null
}

// ─── Composables ──────────────────────────────────────────────────

@Composable
private fun SearchResultRow(result: SearchResult, onClick: () -> Unit) {
    val race = result.race
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        RaceLogo(url = race.logoUrl, size = 32.dp)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (!race.hideFlag) {
                    CountryFlag(countryCode = race.countryCode)
                }
                Text(
                    text = race.localizedName,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                CategoryBadge(category = race.uciCategory)
                val range = DateFormatting.formatDateRange(race.startDate, race.endDate)
                if (range.isNotEmpty()) {
                    Text(
                        text = range,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (race.isStageRace) {
                    Text(
                        text = stringResource(R.string.search_race_stage_race),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            }
            result.matchLocation?.let { loc ->
                Text(
                    text = stringResource(loc.labelRes),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.tertiary,
                )
            }
        }
    }
}

@Composable
private fun EmptySearchState(title: String, subtitle: String) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(32.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.outline,
                modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}
