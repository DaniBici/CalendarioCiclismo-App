package app.calendariociclismo.android.ui.results

import android.os.Bundle
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Grain
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Terrain
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.pullToRefresh
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Asset
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceUciStage
import app.calendariociclismo.android.data.model.UciResultsData
import app.calendariociclismo.android.ui.components.AssetActionStrip
import app.calendariociclismo.android.ui.components.AssetChip
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.stage.StageInfoHeaderCard
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.Constants
import app.calendariociclismo.android.util.openExternalUrl
import app.calendariociclismo.android.util.UciResultsLogic
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner

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

    var loading by remember(raceId) { mutableStateOf(false) }
    suspend fun load() {
        if (loading) return
        loading = true
        try {
            runCatching { app.repository.loadResultsData(raceId) }
                .onSuccess { data ->
                    state = if (data == null) ResultsState.Empty else ResultsState.Ready(data)
                    reloadToken++
                }
                .onFailure { error ->
                    if (error is CancellationException) throw error
                    if (state !is ResultsState.Ready) state = ResultsState.Error(error.message ?: unknownError)
                }
        } finally { loading = false }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(raceId, lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            load()
            while (true) {
                delay(60_000)
                load()
            }
        }
    }

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
                            onProfileTap = { navController.navigate(Routes.elevationProfile(it)) },
                            onMapTap = { navController.navigate(Routes.routeMap(it)) },
                            onStartlistTap = { navController.navigate(Routes.startlist(it)) },
                            onStartOrderTap = { navController.navigate(Routes.startOrder(it)) },
                            onStageTap = { stageId -> navController.navigate(Routes.stage(stageId, raceId)) },
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

@OptIn(ExperimentalFoundationApi::class)
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
    onProfileTap: (String) -> Unit,
    onMapTap: (String) -> Unit,
    onStartlistTap: (String) -> Unit,
    onStartOrderTap: (String) -> Unit,
    onStageTap: (String) -> Unit,
) {
    val app = rememberApp()
    val context = androidx.compose.ui.platform.LocalContext.current
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
    var activeStageKey by remember(data.race.id) {
        mutableStateOf(requestedEntryKey() ?: stageKeys.lastOrNull())
    }

    fun sortedStagesForKey(key: String?): List<RaceUciStage> {
        val existing = stagesByKey[key].orEmpty()
            .filter { key != "final" || it.classKind != "stage" }
        return UciResultsLogic.visibleStageClassifications(data.classificationConfig, existing)
    }

    LaunchedEffect(stageKeys) {
        if (activeStageKey !in stageKeys) activeStageKey = requestedEntryKey() ?: stageKeys.lastOrNull()
    }
    val activeStages = sortedStagesForKey(activeStageKey)

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
    LaunchedEffect(activeStageKey, data.raceDays, data.stages) {
        headerRaceDay = data.raceDay
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
    LaunchedEffect(activeStageKey, headerRaceDay?.id) {
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
    // La cabecera depende de la presencia efectiva de la columna UCI, que solo
    // se conoce al cargar las filas. Queda fijada bajo las pestañas.
    var tableHeader by remember(activeStage?.id) { mutableStateOf<ResultsTableHeaderSpec?>(null) }
    val swipeState = rememberClassificationSwipeState()
    // Precarga de las clasificaciones contiguas, como los días vecinos de Hoy:
    // el deslizamiento las muestra ya pintadas.
    val prefetchApp = rememberApp()
    LaunchedEffect(activeStage?.id, reloadToken) {
        val current = activeStage ?: return@LaunchedEffect
        val index = activeStages.indexOfFirst { it.id == current.id }
        listOf(index + 1, index - 1).mapNotNull { activeStages.getOrNull(it) }
            .filterNot { it.isCancelledStage || it.isPendingClassification }
            .forEach { ResultsRowsCache.bundle(prefetchApp.repository, it.id, reloadToken, data.byDorsal, data.race.year) }
    }

    BoxWithConstraints(modifier = rootModifier.fillMaxSize()) {
        val contextDay = headerRaceDay
        val hasStageContext = contextDay?.let {
            it.hasElevationProfile || it.distanceKm != null || it.elevationProfile?.elevationGain != null
                || it.neutralStartTimeUtc != null || it.averageSpeedKmh != null
                || it.hasValidTimeLimit
        } == true
        val showSideContext = maxWidth >= 700.dp && hasStageContext
        Row(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.weight(1f).fillMaxHeight()) {
        // La ficha general permanece fuera del scroll. Documentación y selector
        // de etapas se desplazan; las pestañas de clasificación, el estado de
        // publicación y la fila de columnas forman una única cabecera sticky.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.background)
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
        ) {
            val rd = headerRaceDay
            if (rd != null) {
                StageInfoHeaderCard(raceDay = rd, race = data.race, onBack = onBack)
            } else {
                ResultsPlainHeader(race = data.race, onBack = onBack)
            }
        }

        if (activeStage != null) {
            LazyColumn(
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
            ) {
                headerRaceDay?.let { rd ->
                    item {
                        Spacer(Modifier.height(8.dp))
                        ResultsAssetStrip(
                            data = data,
                            raceDay = rd,
                            onProfileTap = onProfileTap,
                            onMapTap = onMapTap,
                            onStartlistTap = onStartlistTap,
                            onStartOrderTap = onStartOrderTap,
                            onStageTap = onStageTap,
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                }

                if (stageKeys.size > 1) {
                    item {
                        ResultsStageSelector(
                            stageKeys = stageKeys,
                            activeKey = activeStageKey,
                            isEn = isEn,
                            onSelect = { key ->
                                activeStageKey = key
                                activeClassKind = sortedStagesForKey(key).firstOrNull()?.classKind
                            },
                        )
                        Spacer(Modifier.height(4.dp))
                    }
                }

                stickyHeader {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.background),
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                        ) {
                            ResultsClassTabsBar(
                                stages = activeStages,
                                classificationConfig = data.classificationConfig,
                                activeClassKind = activeStage.classKind,
                                isEn = isEn,
                                teamsAvailable = teamsAvailable,
                                selectedTeam = selectedTeam,
                                onSelectClass = { activeClassKind = it },
                                onSelectTeam = { selectedTeam = it },
                            )
                        }
                        val config = data.classificationConfig.firstOrNull { it.classKind == activeStage.classKind }
                        val classificationLabel = config?.let { UciResultsLogic.classificationLabel(it, isEn) }
                            ?: classLabel(activeStage.classKind)
                        ResultsPublicationStatus(
                            stage = activeStage,
                            classificationLabel = classificationLabel,
                            showClassificationLabel = !data.race.isOneDay,
                        )
                        Spacer(Modifier.height(4.dp))
                        tableHeader?.let { header ->
                            ResultsTableHeader(
                                showTeam = header.primaryColumnIsRider,
                                showUciPoints = header.showUciPoints,
                                valueHeader = stringResource(
                                    if (header.isPoints) R.string.results_col_points
                                    else R.string.results_col_time,
                                ),
                            )
                            HorizontalDivider(
                                thickness = 0.5.dp,
                                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
                            )
                        }
                    }
                }

                val classKinds = activeStages.map { it.classKind }

                if (activeStage.isPendingClassification) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(vertical = 32.dp)
                            .classificationSwipe(classKinds, activeStage.classKind, swipeState) { activeClassKind = it },
                            contentAlignment = Alignment.Center) {
                            Text(
                                if (isEn) "Pending publication" else "Pendiente de publicación",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                } else item {
                    // key() fuerza recomposición limpia de la tabla al cambiar de
                    // clasificación o etapa (recarga de filas + reset de estado CRE).
                    key(activeStage.id) {
                        Box(Modifier.classificationSwipe(classKinds, activeStage.classKind, swipeState) { activeClassKind = it }) {
                            ResultsTable(
                                stage = activeStage,
                                byDorsal = data.byDorsal,
                                raceTeams = data.raceTeams,
                                raceDayPrimaryType = headerRaceDay?.primaryType,
                                raceYear = data.race.year,
                                isOneDay = data.race.isOneDay,
                                isEn = isEn,
                                selectedTeam = selectedTeam,
                                reloadToken = reloadToken,
                                showTableHeader = false,
                                onTeamsResolved = { teamsAvailable = it },
                                onHeaderResolved = { tableHeader = it },
                            )
                        }
                    }
                }
                if (!showSideContext && contextDay != null && hasStageContext) {
                    item {
                        Spacer(Modifier.height(12.dp))
                        ResultsStageContextCard(
                            raceDay = contextDay,
                            race = data.race,
                        ) { onProfileTap(contextDay.id) }
                    }
                }
            }
        }
        }
        contextDay?.takeIf { showSideContext }?.let { sideDay ->
            Box(
                modifier = Modifier
                    .width(320.dp)
                    .fillMaxHeight()
                    .padding(top = 16.dp, end = 16.dp),
            ) {
                ResultsStageContextCard(
                    raceDay = sideDay,
                    race = data.race,
                ) { onProfileTap(sideDay.id) }
            }
        }
        }
    }
}

/** Barra documental de la jornada activa, sin el perfil oficial externo. */
@Composable
private fun ResultsAssetStrip(
    data: UciResultsData,
    raceDay: RaceDay,
    onProfileTap: (String) -> Unit,
    onMapTap: (String) -> Unit,
    onStartlistTap: (String) -> Unit,
    onStartOrderTap: (String) -> Unit,
    onStageTap: (String) -> Unit,
) {
    val context = LocalContext.current
    val technicalGuide = data.assets.firstOrNull {
        it.type == "technicalGuide" && !it.url.isNullOrEmpty()
    }
    val stageAssets = data.assets.filter {
        it.raceDayId == raceDay.id && it.type != "technicalGuide" && it.type != "live_text"
            && (it.type == "startOrder" || !it.url.isNullOrEmpty())
    }
    val assets = (listOfNotNull(technicalGuide) + stageAssets)
        .distinctBy { it.type ?: it.id }
        .sortedBy { asset ->
            Constants.ASSET_ORDER.indexOf(asset.type.orEmpty()).let { if (it < 0) Int.MAX_VALUE else it }
        }
    val profileIndex = Constants.ASSET_ORDER.indexOf("profile").let {
        if (it < 0) Constants.ASSET_ORDER.size else it
    }
    val hasInteractiveProfile = raceDay.hasElevationProfile
    val hasStaticProfile = assets.any { it.type == "profile" }
    val hasInteractiveMap = !raceDay.routeGpxUrl.isNullOrEmpty()
    val hasStaticMap = assets.any { it.type == "map" }
    val bothMaps = hasInteractiveMap && hasStaticMap
    val assetsBeforeProfile = assets.filter { asset ->
        asset.type != "technicalGuide" &&
            Constants.ASSET_ORDER.indexOf(asset.type.orEmpty()).let { if (it < 0) Int.MAX_VALUE else it } < profileIndex
    }
    val officialMap = if (bothMaps) assets.firstOrNull { it.type == "map" } else null
    val assetsFromProfile = assets.filter { asset ->
        if (asset.type == "profile") return@filter false
        if (asset.type == "map" && bothMaps) return@filter false
        Constants.ASSET_ORDER.indexOf(asset.type.orEmpty()).let { if (it < 0) Int.MAX_VALUE else it } >= profileIndex
    }

    AssetActionStrip {
        data.race.websiteUrl?.takeUnless { it.isEmpty() }?.let { url ->
            AssetChip(
                icon = Icons.Outlined.Language,
                label = LocaleHolder.t("Web oficial", "Official website"),
                onClick = { openExternalUrl(context, url) },
            )
        }

        technicalGuide?.let { asset ->
            AssetChip(
                icon = resultsAssetIcon(asset.type),
                label = asset.typeLabel(context),
                onClick = { asset.url?.let { openExternalUrl(context, it) } },
            )
        }

        AssetChip(
            iconPainter = painterResource(R.drawable.ic_action_cursor),
            label = if (data.race.isOneDay) {
                LocaleHolder.t("Ir a la carrera", "Go to the race")
            } else {
                LocaleHolder.t("Ir a la etapa", "Go to the stage")
            },
            onClick = { onStageTap(raceDay.id) },
        )

        if (data.race.startlistImportedAt != null) {
            AssetChip(
                icon = Icons.Filled.Group,
                label = if (data.race.startlistProvisional) {
                    LocaleHolder.t("Lista provisional", "Provisional Startlist")
                } else {
                    LocaleHolder.t("Dorsales", "Startlist")
                },
                onClick = { onStartlistTap(data.race.id) },
            )
        }

        assetsBeforeProfile.forEach { asset ->
            if (asset.type == "startOrder") {
                AssetChip(
                    icon = Icons.Filled.Timer,
                    label = LocaleHolder.t("Orden de salida", "Start order"),
                    onClick = { onStartOrderTap(raceDay.id) },
                )
            } else {
                val effectiveType = resultsEffectiveAssetType(
                    asset = asset,
                    raceCountryCode = data.race.countryCode,
                    raceDay = raceDay,
                    hasProfile = hasInteractiveProfile || hasStaticProfile,
                )
                AssetChip(
                    icon = resultsAssetIcon(effectiveType),
                    label = resultsAssetLabel(effectiveType),
                    onClick = { asset.url?.let { openExternalUrl(context, it) } },
                )
            }
        }

        if (hasInteractiveProfile) {
            AssetChip(
                icon = Icons.AutoMirrored.Filled.ShowChart,
                label = LocaleHolder.t("Perfil", "Profile"),
                onClick = { onProfileTap(raceDay.id) },
            )
        }

        officialMap?.let { asset ->
            AssetChip(
                icon = Icons.Filled.Map,
                label = LocaleHolder.t("Mapa", "Map"),
                onClick = { asset.url?.let { openExternalUrl(context, it) } },
            )
        }

        if (hasInteractiveMap) {
            AssetChip(
                icon = Icons.Filled.Map,
                label = if (bothMaps) {
                    LocaleHolder.t("Mapa 3D", "3D Map")
                } else {
                    LocaleHolder.t("Mapa", "Map")
                },
                onClick = { onMapTap(raceDay.id) },
            )
        }

        assetsFromProfile.forEach { asset ->
            val effectiveType = resultsEffectiveAssetType(
                asset = asset,
                raceCountryCode = data.race.countryCode,
                raceDay = raceDay,
                hasProfile = hasInteractiveProfile || hasStaticProfile,
            )
            AssetChip(
                icon = resultsAssetIcon(effectiveType),
                label = resultsAssetLabel(effectiveType),
                onClick = { asset.url?.let { openExternalUrl(context, it) } },
            )
        }
    }
}

private fun resultsEffectiveAssetType(
    asset: Asset,
    raceCountryCode: String?,
    raceDay: RaceDay,
    hasProfile: Boolean,
): String? {
    if (asset.type != "ports" || hasProfile || raceDay.primaryType != "sterrato") return asset.type
    return if (raceCountryCode.equals("FR", ignoreCase = true)) "ribinou" else "sterrato"
}

@Composable
private fun resultsAssetLabel(type: String?): String {
    val context = LocalContext.current
    return when (type) {
        "sterrato" -> stringResource(R.string.stage_doc_sterrato)
        "ribinou" -> stringResource(R.string.stage_doc_ribinou)
        else -> Constants.assetLabel(context, type)
    }
}

private fun resultsAssetIcon(type: String?): ImageVector = when (type) {
    "technicalGuide" -> Icons.AutoMirrored.Outlined.InsertDriveFile
    "startOrder" -> Icons.Filled.Timer
    "profile" -> Icons.AutoMirrored.Filled.ShowChart
    "map" -> Icons.Filled.Map
    "roadbook" -> Icons.Filled.Description
    "ports", "pave" -> Icons.Filled.Terrain
    "sterrato", "ribinou" -> Icons.Filled.Grain
    else -> Icons.AutoMirrored.Outlined.InsertDriveFile
}
