package app.calendariociclismo.android.ui.cyclocross

import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.style.TextOverflow
import app.calendariociclismo.android.ui.theme.CCText
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.*
import app.calendariociclismo.android.data.repository.CxCached
import app.calendariociclismo.android.ui.components.*
import androidx.compose.material.icons.filled.Language
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.adaptive.rememberAdaptiveLayoutInfo
import app.calendariociclismo.android.ui.results.ResultsStageSelector
import app.calendariociclismo.android.ui.results.ResultsClassificationTab
import app.calendariociclismo.android.ui.results.ResultsClassificationTable
import app.calendariociclismo.android.ui.results.classificationSwipe
import app.calendariociclismo.android.ui.results.rememberClassificationSwipeState
import app.calendariociclismo.android.ui.startlist.TeamColorBands
import app.calendariociclismo.android.util.CxDetailSection
import app.calendariociclismo.android.util.RegionDetector
import app.calendariociclismo.android.util.UciResultsLogic
import app.calendariociclismo.android.ui.stage.RaceDayHeading
import app.calendariociclismo.android.ui.stage.RaceDayLocation
import app.calendariociclismo.android.ui.stage.SectionCard
import app.calendariociclismo.android.ui.stage.SectionTitle
import app.calendariociclismo.android.ui.stage.BroadcastRow
import app.calendariociclismo.android.ui.stage.PanelTextAction
import app.calendariociclismo.android.ui.stage.OfflineAccessAlert
import app.calendariociclismo.android.ui.stage.OfflineAccessDialog
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.CxPresentation
import app.calendariociclismo.android.util.CyclocrossLogic
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.openExternalLink
import app.calendariociclismo.android.util.openExternalUrl
import app.calendariociclismo.android.util.rememberHaptics
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import java.text.NumberFormat
import java.time.ZoneId
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

private val CxDetailSection.label: Int get() = when (this) {
    CxDetailSection.PROGRAMME -> R.string.cx_programme
    CxDetailSection.STARTLIST -> R.string.cx_startlist
    CxDetailSection.RESULTS -> R.string.cx_results
    CxDetailSection.GENERAL -> R.string.cx_general
    CxDetailSection.VIDEOS -> R.string.cx_videos
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun CxRaceScreen(nav: NavController, raceId: String, initialCategory: String? = null, titleHint: String? = null) {
    val app = rememberApp()
    val owner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val locale = LocalConfiguration.current.locales[0]
    val english = locale.language != "es"
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    var data by remember(raceId) { mutableStateOf<CxCached<CxDetail>?>(null) }
    var loading by remember(raceId) { mutableStateOf(false) }
    // Hasta la primera carga se muestra la pantalla de carga: sin esto, el primer
    // fotograma mostraba «Carrera no disponible».
    var loadedOnce by remember(raceId) { mutableStateOf(false) }
    var error by remember(raceId) { mutableStateOf<String?>(null) }
    var categoryCode by rememberSaveable(raceId) { mutableStateOf<String?>(initialCategory?.removePrefix("inscritos-")?.removePrefix("resultados-")?.removePrefix("general-")?.takeIf { it in CyclocrossLogic.categories } ?: "ME") }
    var section by rememberSaveable(raceId) { mutableStateOf(when {
        initialCategory?.startsWith("general") == true -> CxDetailSection.GENERAL
        initialCategory?.startsWith("inscritos-") == true -> CxDetailSection.STARTLIST
        initialCategory?.startsWith("resultados-") == true -> CxDetailSection.RESULTS
        initialCategory == "videos" -> CxDetailSection.VIDEOS
        else -> CxDetailSection.PROGRAMME
    }) }
    var showAllTV by rememberSaveable(raceId) { mutableStateOf(false) }
    var initialApplied by remember(raceId) { mutableStateOf(false) }
    var round by remember(raceId) { mutableStateOf<CxRound?>(null) }
    // Numeración de la temporada y carreras de las rondas: cabeceras de la general.
    var seasonRounds by remember(raceId) { mutableStateOf<Map<String, CxRound>>(emptyMap()) }
    var roundRaces by remember(raceId) { mutableStateOf<Map<String, CxRace>>(emptyMap()) }
    val swipeState = rememberClassificationSwipeState()
    val followedCxRaceIds by app.preferences.followedCxRaceIds.collectAsState(initial = emptySet())
    val context = LocalContext.current
    // URL del mapa embebible (jpg/png), la misma validación que el item del mapa.
    fun mapAssetUrl(detail: CxDetail): String? = detail.assets.firstOrNull { it.type == "map" && CxPresentation.link(it.url)?.let { url ->
        java.net.URI(url).path.substringAfterLast('.').lowercase() in listOf("jpg", "jpeg", "png")
    } == true }?.let { CxPresentation.link(it.url) }
    // Precarga del mapa en la caché de coil: el contenido se publica con el
    // mapa ya disponible, sin cargas asíncronas posteriores.
    suspend fun preloadMap(url: String?) {
        if (url == null) return
        try { SingletonImageLoader.get(context).execute(ImageRequest.Builder(context).data(url).build()) }
        catch (failure: Exception) { if (failure is CancellationException) throw failure }
    }
    // Publicación completa: nada se pinta sin la ronda y, en la primera carga,
    // sin el mapa ya en caché.
    suspend fun publish(value: CxCached<CxDetail>) {
        seasonRounds = app.cxRepository.rounds(value.data.race.seasonKey)
        round = seasonRounds[value.data.race.id]
        // El refresco de cada minuto trae un cachedAt nuevo: sin cambios en la
        // jornada no se publica, para no recomponer la ficha ni la clasificación.
        if (data?.data == value.data) return
        data = value
    }
    suspend fun reload() {
        if (loading) return
        loading = true
        try {
            if (data == null) {
                app.cxRepository.cachedDetail(raceId)?.let { cached ->
                    preloadMap(mapAssetUrl(cached.data))
                    publish(cached)
                }
            }
            val fresh = app.cxRepository.detail(raceId)
            if (fresh != null) {
                if (data == null) preloadMap(mapAssetUrl(fresh.data))
                publish(fresh)
            }
            error = null
        }
        catch (failure: Exception) { if (failure is CancellationException) throw failure; error = failure.message }
        finally { loading = false; loadedOnce = true }
    }
    LaunchedEffect(raceId, owner) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { reload(); delay(60_000) }
        }
    }
    val detail = data?.data
    val race = detail?.race
    val categories = race?.categories?.filter { it.category in CyclocrossLogic.categories && (it.dateKey ?: race.dateKey) in CyclocrossLogic.dates(race) }?.sortedBy { CyclocrossLogic.categories.indexOf(it.category) } ?: emptyList()
    val category = categories.firstOrNull { it.category == categoryCode } ?: categories.firstOrNull { it.category == "ME" } ?: categories.firstOrNull()
    val generalCategories = detail?.let(CxPresentation::generalCategories) ?: emptyList()
    val standingCategory = categoryCode?.takeIf { it in generalCategories } ?: "ME".takeIf { it in generalCategories } ?: generalCategories.firstOrNull()
    val roundIds = detail?.standingsState?.flatMap { it.roundIds }?.distinct().orEmpty()
    // TV o Revive sin horarios también abren la pestaña Programa.
    val clock = cxClock()
    val hasMedia = detail?.let { CxPresentation.hasProgrammeMedia(it, RegionDetector.allowedBroadcastGroups(), clock) } ?: false
    LaunchedEffect(roundIds) {
        roundRaces = try { app.cxRepository.roundRaces(roundIds).associateBy { it.id } }
            catch (failure: Exception) { if (failure is CancellationException) throw failure; emptyMap() }
    }
    LaunchedEffect(detail, section, categoryCode, hasMedia) {
        if (detail != null) {
            val defaultResults = !initialApplied && initialCategory == null && CxPresentation.resultCategories(detail).isNotEmpty()
            val requested = if (defaultResults || (!initialApplied && initialCategory in CyclocrossLogic.categories && categoryCode in CxPresentation.resultCategories(detail))) CxDetailSection.RESULTS else section
            val normalized = CxPresentation.normalizeSelection(detail, requested, categoryCode, hasMedia)
            section = normalized.first
            categoryCode = normalized.second
            initialApplied = true
        }
    }
    // Sin barra superior: el retroceso vive en la cabecera de la ficha y en el
    // gesto del sistema, y la jornada se refresca sola cada minuto.
    Scaffold(contentWindowInsets = WindowInsets(0)) { padding ->
        // Primera carga: pantalla de carga completa (sin perfil inferior, como
        // Hoy) hasta tener jornada, ronda y mapa listos.
        if ((loading || !loadedOnce) && data == null) {
            RouteLoadingView(message = stringResource(R.string.loading), showProfile = false, title = titleHint ?: LocaleHolder.t("Ciclocross", "Cyclocross"), modifier = Modifier.padding(padding).consumeWindowInsets(padding).windowInsetsPadding(WindowInsets.statusBars))
            return@Scaffold
        }
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).windowInsetsPadding(WindowInsets.statusBars)) {
        val wideDetail = AdaptiveLayoutPolicy.usesWideDetail(maxWidth.value, adaptiveInfo)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            // Sin indicador en línea durante el refresco periódico: insertarlo
            // como primer elemento desplazaba la clasificación cada minuto.
            error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error); TextButton(onClick = { scope.launch { reload() } }) { Text(stringResource(R.string.cx_retry)) } } }
            if (race == null) {
                if (!loading && loadedOnce && error == null) item { Text(stringResource(R.string.cx_not_found)) }
            } else if (CxPresentation.isHidden(race)) {
                item { CxSpanishAudienceNotice(onBack = { nav.popBackStack() }) }
            } else {
                item {
                    SectionCard {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            val date = DateFormatting.formatDateLongContent(race.dateKey) + (race.endDateKey?.takeIf { it != race.dateKey }?.let { " – " + DateFormatting.formatDateLongContent(it) } ?: "")
                            RaceDayHeading(name = if (english) race.nameEn?.takeIf { it.isNotBlank() } ?: race.name else race.name,
                                logoUrl = CxPresentation.logo(race), countryCode = race.countryCode,
                                categoryName = CxPresentation.className(race.raceClass, english), dateLabel = date, onBack = { nav.popBackStack() }, nameMaxLines = 1)
                            RaceDayLocation(race.venue ?: "")
                            race.tournament?.let { tournament ->
                                val currentRound = round
                                // Torneo como texto enlazado, separador y número de manga (n/total).
                                val tournamentName = LocaleHolder.t(tournament.name, tournament.nameEn ?: tournament.name)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = tournamentName,
                                        style = CCText.S14,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f, fill = false).clickable(role = Role.Button) {
                                            nav.navigate(Routes.cxTournament(tournament.id, race.seasonKey, tournamentName, tournament.logoUrl))
                                        },
                                    )
                                    if (currentRound != null && currentRound.total > 1) {
                                        Text("·", style = CCText.S14, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Text("${currentRound.n}/${currentRound.total}", style = CCText.S14, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                            if (race.isCancelled) Text(stringResource(R.string.cx_cancelled), style = CCText.S12, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                            // Zona de documentación, idéntica a la de carretera:
                            // tira enmarcada con Web oficial · Libro de Ruta · Mapa.
                            // La acción de seguimiento es también la puerta de
                            // entrada a los avisos, por lo que siempre se muestra.
                            val websiteUrl = CxPresentation.link(race.websiteUrl)
                            val docs = detail.assets.filter { !it.url.isNullOrEmpty() && it.type in listOf("technicalGuide", "map") }
                                .sortedBy { if (it.type == "technicalGuide") 0 else 1 }
                            AssetActionStrip {
                                websiteUrl?.let { url ->
                                    AssetChip(icon = Icons.Filled.Language, label = stringResource(R.string.stage_doc_web_official),
                                        onClick = { openExternalUrl(context, url) })
                                }
                                for (asset in docs) {
                                    val isMap = asset.type == "map"
                                    AssetChip(icon = if (isMap) Icons.Filled.Map else Icons.AutoMirrored.Outlined.InsertDriveFile,
                                        label = stringResource(if (isMap) R.string.asset_map else R.string.asset_technical_guide),
                                        onClick = { openExternalUrl(context, asset.url!!) })
                                }
                                // Los avisos de ciclocross solo se ofrecen en las
                                // pruebas con resultados en directo (Mundial,
                                // Continental, Copa del Mundo, Superprestige y
                                // X2O), igual que el indicador de espera.
                                if (CxPresentation.awaitsResults(race)) {
                                    CxNotificationChip(
                                        isFollowing = race.id in followedCxRaceIds,
                                        onClick = {
                                            scope.launch {
                                                val newIds = if (race.id in followedCxRaceIds) followedCxRaceIds - race.id else followedCxRaceIds + race.id
                                                app.preferences.setFollowedCxRaceIds(newIds)
                                                app.pushManager.syncCategories()
                                            }
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
                // La barra de secciones solo se clava cuando tiene contenido:
                // vacía dejaría un hueco muerto entre la cabecera y Horarios.
                if (CxPresentation.showsSectionSelector(detail, hasMedia) || section == CxDetailSection.VIDEOS || (section != CxDetailSection.PROGRAMME && CxPresentation.detailCategories(detail, section).isNotEmpty())) {
                    stickyHeader {
                        Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background)) {
                            if (CxPresentation.showsSectionSelector(detail, hasMedia)) {
                                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    items(CxPresentation.detailSections(detail, hasMedia)) { part ->
                                        ResultsClassificationTab(label = when (part) {
                                            CxDetailSection.PROGRAMME -> LocaleHolder.t("Programa", "Programme")
                                            CxDetailSection.STARTLIST -> LocaleHolder.t("Dorsales", "Startlist")
                                            CxDetailSection.RESULTS -> LocaleHolder.t("Resultados", "Results")
                                            CxDetailSection.GENERAL -> LocaleHolder.t("General", "Standings")
                                            CxDetailSection.VIDEOS -> LocaleHolder.t("Vídeos", "Videos")
                                        }, selected = section == part, onClick = {
                                            section = part
                                            val codes = CxPresentation.detailCategories(detail, part)
                                            if (categoryCode !in codes) categoryCode = "ME".takeIf { it in codes } ?: codes.firstOrNull()
                                        })
                                    }
                                }
                            }
                            val codes = CxPresentation.detailCategories(detail, section)
                            if (section != CxDetailSection.PROGRAMME && codes.isNotEmpty()) ResultsStageSelector(stageKeys = codes,
                                activeKey = categoryCode, isEn = english,
                                labelForKey = { it }, accessibilityLabelForKey = { cxCategoryName(it) }, onSelect = { categoryCode = it })
                        }
                    }
                }
                item(key = "content:${section.name}:${categoryCode.orEmpty()}") {
                    // Deslizar sobre dorsales, resultados o general cambia de categoría.
                    val swipeCategories = if (section == CxDetailSection.PROGRAMME || section == CxDetailSection.VIDEOS) emptyList()
                        else CxPresentation.detailCategories(detail, section)
                    val swipeCurrent = if (section == CxDetailSection.GENERAL) standingCategory else categoryCode
                    val selectedContent: @Composable () -> Unit = {
                        Box(Modifier.classificationSwipe(swipeCategories, swipeCurrent, swipeState) { categoryCode = it }) {
                        CxSelectedContent(
                            detail = detail,
                            race = race,
                            categories = categories,
                            category = category,
                            section = section,
                            standingCategory = standingCategory,
                            generalCategories = generalCategories,
                            rounds = seasonRounds,
                            roundRaces = roundRaces,
                            onOpenRace = { nav.navigate(Routes.cxRace(it.id, title = cxTitle(it))) },
                            locale = locale,
                            english = english,
                            showAllTV = showAllTV,
                            wide = wideDetail,
                            onToggleTV = { showAllTV = !showAllTV },
                            onStartlist = { code -> categoryCode = code; section = CxDetailSection.STARTLIST },
                            onResults = { code -> categoryCode = code; section = CxDetailSection.RESULTS },
                        )
                        }
                    }
                    val mapUrl = mapAssetUrl(detail).takeIf { section != CxDetailSection.VIDEOS }
                    // Resultados, publicados o no, llevan columna lateral como en
                    // carretera: mapa en pequeño y, debajo, los datos de la
                    // jornada (el horario).
                    val scheduled = cxScheduledCategories(race, categories)
                    val raceData = section == CxDetailSection.RESULTS && scheduled.isNotEmpty()
                    val sideColumn: @Composable () -> Unit = {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            mapUrl?.let { CxMapPreview(url = it, maxHeight = if (section == CxDetailSection.RESULTS) 260.dp else 480.dp) }
                            if (raceData) CxRaceDataCard(race = race, scheduled = scheduled, activeCategory = categoryCode)
                        }
                    }
                    if (wideDetail && (mapUrl != null || raceData)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(adaptiveInfo.paneSpacing),
                            verticalAlignment = Alignment.Top,
                        ) {
                            if (section == CxDetailSection.PROGRAMME && mapUrl != null) {
                                Box(Modifier.weight(0.60f)) { CxMapPreview(url = mapUrl) }
                                Box(Modifier.weight(0.40f)) { selectedContent() }
                            } else {
                                Box(Modifier.weight(0.60f)) { selectedContent() }
                                Box(Modifier.weight(0.40f)) { sideColumn() }
                            }
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            selectedContent()
                            if (mapUrl != null || raceData) sideColumn()
                        }
                    }
                }
            }
        }
        }
    }
}

/** Nombre de la prueba en el idioma activo, para rotular la pantalla de carga de su ficha. */
internal fun cxTitle(race: CxRace): String =
    LocaleHolder.t(race.name, race.nameEn?.takeIf { it.isNotBlank() } ?: race.name)

@Composable
private fun CxSelectedContent(
    detail: CxDetail,
    race: CxRace,
    categories: List<CxCategory>,
    category: CxCategory?,
    section: CxDetailSection,
    standingCategory: String?,
    generalCategories: List<String>,
    rounds: Map<String, CxRound>,
    roundRaces: Map<String, CxRace>,
    onOpenRace: (CxRace) -> Unit,
    locale: Locale,
    english: Boolean,
    showAllTV: Boolean,
    wide: Boolean,
    onToggleTV: () -> Unit,
    onStartlist: (String) -> Unit,
    onResults: (String) -> Unit,
) {
    // Catálogo CX indexado una vez por publicación, y filas memorizadas: la
    // recomposición (cambios de sección) no vuelve a casar cada fila contra
    // los ~400 equipos.
    val teamMatcher = remember(detail.teams) { UciResultsLogic.TeamMatcher(detail.teams.map { it.roadTeam }) }
    when {
        section == CxDetailSection.PROGRAMME -> CxProgrammeCard(
            detail,
            categories,
            RegionDetector.allowedBroadcastGroups(),
            showAllTV,
            broadcastColumns = if (wide) 2 else 1,
            onToggleTV = onToggleTV,
            onStartlist = onStartlist,
            onResults = onResults,
        )
        section == CxDetailSection.VIDEOS -> CxVideosCard(CxPresentation.videos(detail))
        section == CxDetailSection.GENERAL -> {
            if (generalCategories.isEmpty()) {
                Text(stringResource(R.string.cx_no_general))
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        if (english) race.tournament?.nameEn ?: race.tournament?.name.orEmpty()
                        else race.tournament?.name.orEmpty(),
                        style = CCText.S16,
                        fontWeight = FontWeight.SemiBold,
                    )
                    val standings = detail.standings.filter { it.category == standingCategory }
                    CxStandingsTable(
                        rows = standings,
                        state = detail.standingsState.firstOrNull { it.category == standingCategory },
                        mode = CxPresentation.standingMode(race.tournament, standingCategory, standings),
                        teamMatcher = teamMatcher,
                        rounds = rounds,
                        races = roundRaces,
                        onOpenRace = onOpenRace,
                    )
                }
            }
        }
        category == null -> Text(stringResource(R.string.cx_no_categories))
        section == CxDetailSection.STARTLIST -> {
            val riders = detail.startlist.filter { it.category == category.category }.sortedBy { it.sortOrder }
            Column {
                Text(cxCategoryName(category.category), style = CCText.S16, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
                if (categories.map { it.dateKey ?: race.dateKey }.distinct().size > 1) {
                    Text(category.dateKey ?: race.dateKey, style = CCText.S13, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (riders.isEmpty()) Text(stringResource(R.string.cx_no_startlist), style = CCText.S14, color = MaterialTheme.colorScheme.onSurfaceVariant)
                riders.forEach { row ->
                    CxTableRow(
                        row.bib ?: "-",
                        "${row.firstName} ${row.lastName}",
                        null,
                        row.countryCode,
                        null,
                        detail.teams.firstOrNull { it.id == row.teamId }?.roadTeam,
                    )
                }
            }
        }
        section == CxDetailSection.RESULTS -> {
            val rows = detail.results.filter { it.category == category.category }.sortedBy { it.sortOrder }
            Column {
                CxPublicationStatus(cxCategoryName(category.category), category.resultsStatus == "official")
                if (categories.map { it.dateKey ?: race.dateKey }.distinct().size > 1) {
                    Text(category.dateKey ?: race.dateKey, style = CCText.S13, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.height(4.dp))
                val resultRows = remember(rows, locale, teamMatcher) { CxPresentation.resultRows(rows, locale, teamMatcher) }
                ResultsClassificationTable(
                    resultRows,
                    showTeam = rows.any { !it.teamName.isNullOrBlank() },
                    showUciPoints = rows.any { it.points != null },
                    valueHeader = stringResource(R.string.results_col_time),
                )
                rows.filter { it.bonusSeconds != null }.forEach { row ->
                    Text(
                        row.riderDisplay + " · " + LocaleHolder.t("Bonificación: ", "Bonus: ") + row.bonusSeconds + " s",
                        style = CCText.S12,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun CxVideosCard(videos: List<CxVideo>) {
    val context = LocalContext.current
    var offlineAlert by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        videos.forEach { video ->
            val id = CxPresentation.youtubeVideoId(video.url) ?: return@forEach
            SectionCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(LocaleHolder.t(video.title, video.titleEn?.takeIf { it.isNotBlank() } ?: video.title), style = CCText.S16, fontWeight = FontWeight.SemiBold)
                    AndroidView(
                        factory = { context -> WebView(context).apply {
                            // Con WRAP_CONTENT el WebView adopta la altura del
                            // contenido y el iframe al 100 % queda a 0 px.
                            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            webChromeClient = WebChromeClient()
                            loadDataWithBaseURL("https://calendariociclismo.app", """
                                <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
                                <style>html,body{margin:0;width:100%;height:100%;background:#000}iframe{width:100%;height:100%;border:0}</style>
                                </head><body><iframe src="https://www.youtube-nocookie.com/embed/$id?playsinline=1"
                                title="YouTube" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe></body></html>
                            """.trimIndent(), "text/html", "UTF-8", null)
                        } },
                        modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                        onRelease = { it.destroy() },
                    )
                    BroadcastRow(
                        Broadcast(id = video.id, raceDayId = video.raceId, channel = "YouTube", url = video.url, showInRevive = true),
                        isRevive = true,
                        hasResults = true,
                        onExternalLinkTap = { url -> openExternalLink(context, url) { offlineAlert = true } },
                    )
                }
            }
        }
    }
    if (offlineAlert) OfflineAccessDialog(OfflineAccessAlert.ExternalLinkOffline, onDismiss = { offlineAlert = false }, onEnableOffline = { offlineAlert = false })
}

/** Fila de estado de publicación de una clasificación CX, idéntica a
 *  `ResultsPublicationStatus` de carretera: etiqueta en negrita y
 *  Oficial/Provisional en secundario. */
@Composable
internal fun CxPublicationStatus(label: String, official: Boolean, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, style = CCText.S14, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        Text(if (official) LocaleHolder.t("Oficial", "Official") else LocaleHolder.t("Provisional", "Provisional"),
            style = CCText.S12, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.weight(1f))
    }
}

/** Chip de notificaciones por carrera de ciclocross. Estilo idéntico a
 *  `AssetChip` y a `RaceNotificationChip` de carretera. Independiente del modo
 *  de carretera: seguir una carrera CX no altera el modo ni los filtros de
 *  carretera. El aviso se entrega solo con la categoría `cyclocross` activa en
 *  Ajustes y el seguimiento de esa carrera (paridad con las carreras de ruta). */
@Composable
private fun CxNotificationChip(isFollowing: Boolean, onClick: () -> Unit) {
    val haptic = rememberHaptics()
    AssetChip(
        icon = if (isFollowing) Icons.Filled.Notifications else Icons.Outlined.NotificationsNone,
        label = stringResource(R.string.race_notifications),
        onClick = {
            haptic(Haptics.Event.Selection)
            onClick()
        },
        showTrailingSeparator = false,
    )
}

// Solo categorías con horario verificado, por día y hora de salida: la que no
// lo tiene no se lista en Horarios ni en Datos de la jornada.
private fun cxScheduledCategories(race: CxRace, categories: List<CxCategory>): List<CxCategory> =
    categories.filter { it.startTimeUtc != null }
        .sortedWith(compareBy<CxCategory> { it.dateKey ?: race.dateKey }.thenBy { CyclocrossLogic.parseInstant(it.startTimeUtc) ?: java.time.Instant.MAX })

// Datos esenciales de la jornada junto a los resultados, como la tarjeta de
// carretera: en ciclocross, la hora de salida de cada categoría, con la
// seleccionada resaltada.
@Composable
private fun CxRaceDataCard(race: CxRace, scheduled: List<CxCategory>, activeCategory: String?) {
    val multiDate = race.categories.map { it.dateKey ?: race.dateKey }.distinct().size > 1
    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionTitle(LocaleHolder.t("Datos de la jornada", "Race data"))
            for (category in scheduled) {
                val active = category.category == activeCategory
                val time = if (race.isCancelled || category.isCancelled) stringResource(R.string.cx_cancelled)
                    else (if (multiDate) DateFormatting.formatDateShort(category.dateKey ?: race.dateKey) + " · " else "") +
                        category.startTimeUtc?.let(DateFormatting::formatTimeLocal).orEmpty()
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(cxCategoryName(category.category), Modifier.weight(1f), style = CCText.S14,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(time, style = CCText.S14, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun CxProgrammeCard(
    detail: CxDetail,
    categories: List<CxCategory>,
    allowedGroups: Set<String>,
    showAllTV: Boolean,
    broadcastColumns: Int = 1,
    onToggleTV: () -> Unit,
    onStartlist: (String) -> Unit,
    onResults: (String) -> Unit,
) {
    val race = detail.race
    val context = LocalContext.current
    var offlineAlert by remember { mutableStateOf(false) }
    // Si ninguna categoría tiene horario verificado, la zona de programa no se muestra.
    val scheduled = cxScheduledCategories(race, categories)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (scheduled.isNotEmpty()) SectionCard {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionTitle(LocaleHolder.t("Horarios", "Schedule"))
                for ((index, category) in scheduled.withIndex()) {
                    if (index > 0) HorizontalDivider()
                    // Fila centrada verticalmente: hora (en negrita) y categoría
                    // a la izquierda con su metadata debajo; dorsales y copa a
                    // la derecha, centradas con el bloque.
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(if (race.isCancelled || category.isCancelled) stringResource(R.string.cx_cancelled)
                                    else category.startTimeUtc?.let(DateFormatting::formatTimeLocal).orEmpty(), style = CCText.S16, fontWeight = FontWeight.Bold)
                                Text(cxCategoryName(category.category), style = CCText.S16)
                            }
                            if (race.categories.map { it.dateKey ?: race.dateKey }.distinct().size > 1) {
                                Text(DateFormatting.formatDateLongContent(category.dateKey ?: race.dateKey), style = CCText.S13, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (detail.startlist.any { it.category == category.category }) CxLinkBadge(stringResource(R.string.cx_startlist), { onStartlist(category.category) }, icon = Icons.Filled.Group)
                            // Copa solo-icono de las cards de Hoy en lugar del botón de texto.
                            if (category.category in CxPresentation.resultCategories(detail)) {
                                ResultsTrophyAction(onClick = { onResults(category.category) }, contentDescription = stringResource(R.string.cx_results), boxSize = 28.dp, glyphSize = 20.dp)
                            }
                        }
                    }
                }
            }
        }
        val media = CxPresentation.programmeMedia(detail, allowedGroups, showAllTV, cxClock())
        // Apertura de carretera: aviso sin conexión y apps nativas.
        val openLink: (String) -> Unit = { url -> openExternalLink(context, url) { offlineAlert = true } }
        if (media.showsLiveTV) SectionCard {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // Conmutador regional de carretera (`BroadcastSection`): acción
                // de texto «Todas» / «Mi región» junto al título, solo con filas
                // de otras regiones; el aviso vacío desaparece con «Todas».
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) { SectionTitle(stringResource(R.string.cx_tv)) }
                    if (media.hasHiddenTV) PanelTextAction(
                        label = stringResource(if (showAllTV) R.string.stage_broadcast_filter_region else R.string.stage_broadcast_filter_all),
                        onClick = onToggleTV,
                        // Sin altura propia en la fila: el título conserva la
                        // posición de los demás paneles y el objetivo táctil
                        // de 48 dp queda centrado sobre él.
                        modifier = Modifier.layout { measurable, constraints ->
                            val placeable = measurable.measure(constraints.copy(minHeight = 0, maxHeight = Constraints.Infinity))
                            layout(placeable.width, 0) { placeable.placeRelative(0, -placeable.height / 2) }
                        },
                    )
                }
                if (media.tv.isEmpty() && media.hasHiddenTV && !showAllTV) Text(
                    text = stringResource(R.string.stage_broadcast_no_region),
                    style = CCText.S14,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
                // Presentación de carretera, dividida por categorías: emisiones
                // comunes (sin categoría) sin encabezado y un bloque por
                // categoría en directo, en el orden del programa.
                for (group in media.tv) {
                    group.category?.let {
                        Text(cxCategoryName(it), style = CCText.S14, fontWeight = FontWeight.SemiBold)
                        // Filete de las filas de la ficha entre la categoría y sus emisiones.
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    group.rows.chunked(broadcastColumns).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            row.forEach { tv ->
                                Box(Modifier.weight(1f)) {
                                    BroadcastRow(
                                        Broadcast(
                                            id = tv.broadcast.id,
                                            raceDayId = race.id,
                                            channel = tv.broadcast.channel,
                                            startTimeUtc = tv.broadcast.startTimeUtc,
                                            url = tv.url,
                                            note = tv.broadcast.note,
                                            sortOrder = tv.broadcast.sortOrder,
                                            showInRevive = tv.broadcast.showInRevive,
                                            country = tv.broadcast.country,
                                        ),
                                        showsRegion = showAllTV,
                                        onExternalLinkTap = openLink,
                                    )
                                }
                            }
                            repeat(broadcastColumns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
        if (media.revive.isNotEmpty()) SectionCard {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionTitle(stringResource(R.string.cx_revive))
                media.revive.chunked(broadcastColumns).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { link ->
                            Box(Modifier.weight(1f)) {
                                BroadcastRow(
                                    Broadcast(id = link.url, raceDayId = race.id, channel = link.title, url = link.url, sortOrder = link.sortOrder, showInRevive = true),
                                    isRevive = true,
                                    hasResults = true,
                                    onExternalLinkTap = openLink,
                                )
                            }
                        }
                        repeat(broadcastColumns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
    if (offlineAlert) OfflineAccessDialog(OfflineAccessAlert.ExternalLinkOffline, onDismiss = { offlineAlert = false }, onEnableOffline = { offlineAlert = false })
}

@Composable
private fun CxTableRow(position: String, name: String, teamName: String?, country: String?, value: String?, team: Team? = null) {
    Column {
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(position, Modifier.width(36.dp), style = CCText.S14, fontWeight = FontWeight.SemiBold)
            CountryFlag(country, height = 12.dp)
            Column(Modifier.weight(1f)) {
                // Franjas junto al corredor, como en iOS y en la web.
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(name, style = CCText.S14, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f, fill = false))
                    team?.let { TeamColorBands(it) }
                }
                teamName?.takeIf { it.isNotBlank() }?.let { Text(it, style = CCText.S12, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            value?.let { Text(it, style = CCText.S13) }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}

/** Aviso en inglés para una carrera o un torneo solo nacional. */
@Composable
internal fun CxSpanishAudienceNotice(onBack: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(CxPresentation.SPANISH_AUDIENCE_TITLE, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(
            CxPresentation.SPANISH_AUDIENCE_NOTICE,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        TextButton(onClick = onBack) { Text("Back") }
    }
}
