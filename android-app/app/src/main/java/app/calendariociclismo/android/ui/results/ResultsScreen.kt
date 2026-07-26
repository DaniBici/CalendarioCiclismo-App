package app.calendariociclismo.android.ui.results

import android.os.Bundle
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.pullToRefresh
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceUciStage
import app.calendariociclismo.android.data.model.UciResultsData
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.stage.StageInfoHeaderCard
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.UciResultsLogic
import kotlinx.coroutines.delay

private sealed class ResultsState {
    object Loading : ResultsState()
    data class Ready(val data: UciResultsData) : ResultsState()
    data class Error(val message: String) : ResultsState()
    object Empty : ResultsState()
}

/** Orden de una clave de entrada sector-consciente ('final' al final; '3A'<'3B'). */
private fun stageKeyRank(key: String): Pair<Int, String> {
    if (key == "final") return Int.MAX_VALUE to ""
    val (n, sfx) = UciResultsLogic.parseResultStageKey(key)
    return (n ?: Int.MAX_VALUE) to sfx
}

private fun classOrderIndex(classKind: String): Int =
    UciResultsLogic.CLASS_ORDER.indexOf(classKind).let { if (it < 0) 99 else it }

/**
 * Pantalla de resultados in-house (clasificaciones UCI de una carrera).
 * Réplica nativa de `js/resultados.js`. Primo de `StartOrderScreen`.
 *
 * Solo-online: se carga en vivo desde Supabase (sin Room). La lógica de
 * tiempos/gaps/CRE vive en `UciResultsLogic` (testeada).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultsScreen(
    raceId: String,
    initialStageNumber: Int?,   // etapa pedida (deep-link desde la jornada); null = última/final
    initialStageSuffix: String? = null,   // sufijo de sector (A/B) del deep-link (doble sector)
    initialClassKind: String? = null,   // clasificación inicial ("gc" = General); null = la primera (stage)
    navController: NavController,
) {
    val app = rememberApp()
    var state by remember { mutableStateOf<ResultsState>(ResultsState.Loading) }
    var isRefreshing by remember { mutableStateOf(false) }
    // Token de recarga de filas. Las filas de cada clasificación las carga el
    // propio ResultsTable por stage.id, NO loadResultsData; sin esto el
    // pull-to-refresh recargaba cabecera/etapas/equipos pero NO las filas
    // visibles (el LaunchedEffect(stage.id) no se re-disparaba). Se incrementa
    // en cada refresh y entra en la clave de carga del hijo.
    var reloadToken by remember { mutableStateOf(0) }
    val unknownError = stringResource(R.string.startlist_error_unknown)

    suspend fun load() {
        runCatching { app.repository.loadResultsData(raceId) }
            .onSuccess { data ->
                state = if (data == null) ResultsState.Empty else ResultsState.Ready(data)
            }
            .onFailure { error ->
                state = ResultsState.Error(error.message ?: unknownError)
            }
    }

    LaunchedEffect(raceId) { load() }

    // El screen_view de Resultados se emite dentro de `ResultsContent` (reacciona
    // a la etapa activa), para que lleve stage_name/race_day_id de la etapa
    // realmente mostrada y aparezca en "etapas más vistas" como `stage_detail`.

    // Pull-to-refresh: el efecto vive a NIVEL DE PANTALLA (no dentro del
    // PullToRefreshBox), para que se componga siempre y no dependa del árbol
    // del Box. Recarga la cabecera/etapas/equipos + incrementa el token que
    // re-pide las filas de la clasificación activa.
    LaunchedEffect(isRefreshing) {
        if (isRefreshing) {
            delay(300)
            reloadToken++
            load()
            isRefreshing = false
        }
    }

    val pullRefreshState = rememberPullToRefreshState()

    Scaffold { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (val current = state) {
                is ResultsState.Loading -> RouteLoadingView(
                    message = stringResource(R.string.loading),
                )
                is ResultsState.Error -> Text(
                    current.message,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    color = MaterialTheme.colorScheme.error,
                )
                is ResultsState.Empty -> Text(
                    stringResource(R.string.results_empty),
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                is ResultsState.Ready -> {
                    // El gesto de pull se aplica al CONTENIDO ENTERO (Column raíz
                    // de ResultsContent, que incluye el header fijo), no solo a la
                    // lista. Así tirar hacia abajo DESDE EL HEADER dispara el
                    // refresh — el header fijo no scrollea y no propagaba el gesto
                    // a un PullToRefreshBox que solo escucha el nested-scroll de la
                    // lista. El indicador se superpone manualmente arriba-centro.
                    Box(modifier = Modifier.fillMaxSize()) {
                        ResultsContent(
                            data = current.data,
                            initialStageNumber = initialStageNumber,
                            initialStageSuffix = initialStageSuffix,
                            initialClassKind = initialClassKind,
                            reloadToken = reloadToken,
                            rootModifier = Modifier.pullToRefresh(
                                isRefreshing = isRefreshing,
                                state = pullRefreshState,
                                onRefresh = { isRefreshing = true },
                            ),
                            onBack = { navController.popBackStack() },
                        )
                        PullToRefreshDefaults.Indicator(
                            state = pullRefreshState,
                            isRefreshing = isRefreshing,
                            modifier = Modifier.align(Alignment.TopCenter),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ResultsContent(
    data: UciResultsData,
    initialStageNumber: Int?,
    initialStageSuffix: String? = null,
    initialClassKind: String? = null,
    reloadToken: Int = 0,
    /** Modifier aplicado a la Column raíz (el gesto de pull-to-refresh, para que
     *  enganche también sobre el header fijo). */
    rootModifier: Modifier = Modifier,
    onBack: () -> Unit,
) {
    val app = rememberApp()
    val isEn = LocaleHolder.shouldShowEnglishContent

    // ── Agrupar clasificaciones por etapa ──────────────────────────
    // Las generales del ÚLTIMO día (clasificación final, stageNumber null) se
    // muestran TAMBIÉN bajo la última etapa numerada — duplicado visual a
    // petición: la pantalla 'F' se conserva (key null sigue en stageKeys) y
    // todas las generales aparecen a la vez en los dos sitios. No se vuelcan dos
    // veces (es solo presentación). Si la etapa ya trae una clasificación del
    // mismo tipo, manda la final (es la oficial del último día).
    // Clave sector-consciente ('final' | '3' | '3A'): separa los dobles sectores
    // (3A/3B comparten stageNumber) por su raceDayId. Espejo de js/resultados.js.
    val stagesByKey = remember(data.stages) {
        val keyOf: (RaceUciStage) -> String = {
            UciResultsLogic.resultStageEntryKey(
                it.stageNumber, it.raceDayId, data.sectorSuffixByRaceDayId, data.sectoredStageNumbers,
            )
        }
        val grouped = data.stages.groupBy(keyOf)
        val finals = grouped["final"]
        val lastKey = grouped.keys.filter { it != "final" }.maxWithOrNull(compareBy({ stageKeyRank(it).first }, { stageKeyRank(it).second }))
        if (!finals.isNullOrEmpty() && lastKey != null) {
            val finalKinds = finals.map { it.classKind }.toSet()
            val merged = grouped[lastKey].orEmpty().filter { it.classKind !in finalKinds } + finals
            grouped.toMutableMap().apply { put(lastKey, merged) }
        } else {
            grouped
        }
    }
    val stageKeys = remember(stagesByKey) {
        stagesByKey.keys.sortedWith(compareBy({ stageKeyRank(it).first }, { stageKeyRank(it).second }))
    }

    // Clave de entrada pedida por el deep-link (sector-consciente). Un número
    // pelado que resulta ser doble sector cae a su primer sector (A).
    fun requestedEntryKey(): String? {
        val n = initialStageNumber ?: return null
        val sfx = initialStageSuffix.orEmpty().uppercase()
        val exact = "$n$sfx"
        if (stagesByKey.containsKey(exact)) return exact
        if (sfx.isEmpty() && n in data.sectoredStageNumbers) {
            return stageKeys.firstOrNull { UciResultsLogic.parseResultStageKey(it).first == n }
        }
        return if (stagesByKey.containsKey(exact)) exact else null
    }

    // Etapa activa: la pedida si existe, si no la última con datos.
    var activeStageKey by remember(data.stages) {
        mutableStateOf(requestedEntryKey() ?: stageKeys.lastOrNull())
    }

    val activeStages = (stagesByKey[activeStageKey] ?: emptyList())
        .sortedBy { classOrderIndex(it.classKind) }

    // Clasificación activa: por defecto la primera de la etapa. Si se pidió una
    // clasificación inicial (p. ej. "gc" desde "Así está la carrera") Y seguimos
    // en la etapa que se abrió, se selecciona esa si existe; al cambiar de etapa
    // se cae a la primera (stage). Degrada con gracia si la etapa no trae esa clas.
    val initialKey = requestedEntryKey() ?: stageKeys.lastOrNull()
    var activeClassKind by remember(activeStageKey) {
        val requested = if (initialClassKind != null && activeStageKey == initialKey) {
            activeStages.firstOrNull { it.classKind == initialClassKind }?.classKind
        } else null
        mutableStateOf(requested ?: activeStages.firstOrNull()?.classKind)
    }
    val activeStage = activeStages.firstOrNull { it.classKind == activeClassKind }
        ?: activeStages.firstOrNull()

    // RaceDay del header: el de la etapa activa. Se resuelve de las jornadas ya
    // cargadas (`data.raceDays`, con countryCode/ruta/…) por raceDayId y, si el
    // volcado no lo trajo, por stageNumber → así la cabecera aplica el override de
    // país por jornada (p. ej. et1 en Francia de una carrera italiana). Si la etapa
    // activa no casa por ninguno (un día / general final), se conserva
    // `data.raceDay`, NUNCA se pone a null (perdería ruta/distancia).
    val daysById = remember(data.raceDays) { data.raceDays.associateBy { it.id } }
    val daysByStage = remember(data.raceDays) {
        data.raceDays.filter { it.stageNumber != null }.associateBy { it.stageNumber!! }
    }
    var headerRaceDay by remember { mutableStateOf<RaceDay?>(data.raceDay) }
    LaunchedEffect(activeStageKey) {
        val rdId = activeStages.firstOrNull { it.raceDayId != null }?.raceDayId
        val byId = rdId?.let { daysById[it] }
        if (byId != null) {
            // El header muestra el sufijo de sector (3A/3B) igual que el selector.
            headerRaceDay = byId.also { it.stageSuffix = data.sectorSuffixByRaceDayId[rdId] }
        } else {
            val sn = activeStages.firstOrNull { it.stageNumber != null }?.stageNumber
            val byStage = sn?.let { daysByStage[it] }
            if (byStage != null) headerRaceDay = byStage
            // else: mantener data.raceDay (fallback de un día); no sobrescribir.
        }
    }

    // screen_view con el contexto de la etapa activa: mismos parámetros que
    // `stage_detail` para sumar en "etapas más vistas". Se re-emite en cada
    // cambio de etapa (clave = activeStageKey + el raceDay ya resuelto).
    LaunchedEffect(activeStageKey, headerRaceDay) {
        app.analytics.logScreenView(
            "results",
            Bundle().apply {
                putString("race_id", data.race.id)
                putString("race_name", data.race.name)
                headerRaceDay?.let { rd ->
                    putString("race_day_id", rd.id)
                    putString("stage_name", rd.stageLabel)
                }
            },
        )
    }

    // Filtro por equipo (persiste al cambiar de clasificación, como la web).
    var selectedTeam by remember { mutableStateOf<String?>(null) }
    // Equipos disponibles en la clasificación actual (los publica ResultsTable).
    var teamsAvailable by remember { mutableStateOf<List<String>>(emptyList()) }

    Column(modifier = rootModifier.fillMaxSize()) {
        // Bloque FIJO arriba (no scrollea con la tabla): cabecera de carrera +
        // selector de etapa + barra de clasificaciones/filtro de equipo. Así,
        // al recorrer una clasificación larga, el contexto (qué etapa y qué
        // clasificación se miran) permanece siempre visible. Mismo inset
        // lateral/superior que el contentPadding de la tabla; el `spacedBy`
        // reproduce la separación que tenían como items de la lista.
        // Fondo opaco + padding inferior generoso: forma un "colchón" bajo el
        // filtro/pestañas para que las filas de la tabla se deslicen por debajo
        // con aire en vez de rozar el filtro al scrollear.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.background)
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            val rd = headerRaceDay
            if (rd != null) {
                StageInfoHeaderCard(raceDay = rd, race = data.race, onBack = onBack)
            } else {
                ResultsPlainHeader(race = data.race, onBack = onBack)
            }

            if (stageKeys.size > 1) {
                ResultsStageSelector(
                    stageKeys = stageKeys,
                    activeKey = activeStageKey,
                    isEn = isEn,
                    onSelect = { key ->
                        activeStageKey = key
                        activeClassKind = (stagesByKey[key] ?: emptyList())
                            .sortedBy { classOrderIndex(it.classKind) }
                            .firstOrNull()?.classKind
                    },
                )
            }

            if (activeStage != null) {
                ResultsClassTabsBar(
                    stages = activeStages,
                    activeClassKind = activeStage.classKind,
                    isEn = isEn,
                    teamsAvailable = teamsAvailable,
                    selectedTeam = selectedTeam,
                    onSelectClass = { activeClassKind = it },
                    onSelectTeam = { selectedTeam = it },
                )
            }
        }

        if (activeStage != null) {
            LazyColumn(
                // weight(1f): ocupa el espacio restante bajo el bloque fijo.
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
            ) {
                item {
                    // key() fuerza recomposición limpia de la tabla al cambiar de
                    // clasificación o etapa (recarga de filas + reset de estado CRE).
                    key(activeStage.id) {
                        ResultsTable(
                            stage = activeStage,
                            byDorsal = data.byDorsal,
                            raceTeams = data.raceTeams,
                            raceDayPrimaryType = headerRaceDay?.primaryType,
                            isOneDay = data.race.isOneDay,
                            isEn = isEn,
                            selectedTeam = selectedTeam,
                            reloadToken = reloadToken,
                            onTeamsResolved = { teamsAvailable = it },
                        )
                    }
                }
            }
        }
    }
}
