package app.calendariociclismo.android.ui.stage

import android.content.Context
import android.content.Intent
import android.provider.CalendarContract
import android.webkit.MimeTypeMap
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.Grain
import androidx.compose.material.icons.filled.Terrain
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import androidx.navigation.NavController
import app.calendariociclismo.android.CalendarioCiclismoApp
import app.calendariociclismo.android.data.premium.PremiumService
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Asset
import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.components.AssetChip
import app.calendariociclismo.android.ui.components.AssetActionStrip
import app.calendariociclismo.android.ui.components.CCActionButton
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CategoryBadge
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.MarkdownText
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.RouteLoadingView
import app.calendariociclismo.android.ui.components.StageTypeBadge
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.adaptive.rememberAdaptiveLayoutInfo
import app.calendariociclismo.android.ui.components.TVBadge
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.Constants
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.NetworkMonitor
import app.calendariociclismo.android.util.GuideRow
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.RegionDetector
import app.calendariociclismo.android.util.openExternalUrl
import app.calendariociclismo.android.util.SimplifiedGuide
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Detalle de una jornada / etapa — equivalente a `StageDetailView.swift`.
 *
 * Secciones:
 *   - Cabecera: carrera + nombre de etapa + fecha + recorrido + badges
 *   - Horario: salida neutralizada + meta estimada
 *   - Retransmisión: canales con hora Madrid + enlace externo
 *   - Documentación: pastillas con iconos para assets (perfil, mapa, roadbook…)
 *   - Descripción / Bonificaciones / Notas
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun StageScreen(stageId: String, raceId: String? = null, navController: NavController) {
    val app = rememberApp()
    val context = LocalContext.current
    val haptic = rememberHaptics()
    val adaptiveInfo = rememberAdaptiveLayoutInfo()
    var state by remember { mutableStateOf<StageState>(StageState.Loading) }
    var isRefreshing by remember { mutableStateOf(false) }
    var offlineAlert by remember { mutableStateOf<OfflineAccessAlert?>(null) }
    val scope = rememberCoroutineScope()
    // Usado por la lógica de "sin red" para decidir entre modal "fuera de rango"
    // (offline ON) o modal "Sin conexión" con CTA a activar offline (offline OFF).
    val offlineEnabled by app.preferences.offlineEnabled.collectAsState(initial = false)
    val networkErrorFallback = stringResource(R.string.startlist_error_unknown)
    LaunchedEffect(stageId) {
        state = StageState.Loading
        runCatching { loadStageData(app, stageId, raceId) }
            .onSuccess { state = StageState.Ready(it) }
            .onFailure { state = StageState.Error(it.message ?: networkErrorFallback) }
    }

    // Analytics: paridad con iOS — race_day_id + stage_name + race_name.
    // Se dispara cuando state pasa a Ready porque necesitamos los nombres
    // del ViewModel. Ver docs/memory/analytics.md.
    LaunchedEffect(state) {
        val ready = state as? StageState.Ready ?: return@LaunchedEffect
        val race = ready.data.race ?: return@LaunchedEffect
        app.analytics.logScreenView(
            "stage_detail",
            android.os.Bundle().apply {
                putString("race_day_id", ready.data.raceDay.id)
                putString("stage_name", ready.data.raceDay.stageLabel)
                putString("race_name", race.name)
            },
        )
    }

    Scaffold { padding ->
        when (val s = state) {
            StageState.Loading -> {
                RouteLoadingView(
                    message = stringResource(R.string.loading),
                    modifier = Modifier.padding(padding),
                )
            }
            is StageState.Error -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { Text(s.message, color = MaterialTheme.colorScheme.error) }
            is StageState.Ready -> PullToRefreshBox(
                isRefreshing = isRefreshing,
                onRefresh = {
                    // Sin red no tiene sentido pegar a Supabase — el spinner
                    // colgaría hasta el timeout. Reutilizamos el mismo patrón
                    // de modales que usamos al tocar un asset sin conexión: si
                    // el modo sin conexión está OFF, ofrecemos activarlo; si
                    // está ON pero la jornada cae fuera de la ventana
                    // sincronizada, avisamos específicamente de que los datos
                    // pueden no estar al día.
                    if (!NetworkMonitor.isOnline(app)) {
                        val outOfRange = offlineEnabled &&
                            !app.offlineManager.isInOfflineRange(s.data.raceDay.dateKey)
                        offlineAlert = if (outOfRange) {
                            OfflineAccessAlert.RefreshOutOfRange
                        } else {
                            OfflineAccessAlert.RefreshOffline(offlineEnabled = offlineEnabled)
                        }
                        haptic(Haptics.Event.Warning)
                    } else {
                        scope.launch {
                            isRefreshing = true
                            runCatching { loadStageData(app, stageId, raceId) }
                                .onSuccess {
                                    state = StageState.Ready(it)
                                    haptic(Haptics.Event.Success)
                                }
                            // Errores silenciados: mantenemos el contenido visible.
                            isRefreshing = false
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                BoxWithConstraints(Modifier.fillMaxSize()) {
                val wideDetail = AdaptiveLayoutPolicy.usesWideDetail(maxWidth.value, adaptiveInfo)
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val race = s.data.race
                    val raceDay = s.data.raceDay
                    val navSiblings = s.data.siblings
                        .filter { !it.isRestDay && !it.isCancelledDay }
                        .sortedWith(compareBy({ it.stageNumber ?: Int.MAX_VALUE }, { it.dateKey }))
                    val currentIdx = navSiblings.indexOfFirst { it.id == raceDay.id }
                    val prevRd = if (currentIdx > 0) navSiblings[currentIdx - 1] else null

                    // Clasificaciones propias (in-house): de esta jornada si ya
                    // están volcadas; en su defecto, la GENERAL de la etapa
                    // anterior (vueltas por etapas). Se ofrece como PRIMER chip
                    // de la tira de assets; sin clasificaciones no hay chip.
                    // Espejo de jornada.js (web).
                    val raceId = race?.id
                    val currentResultsNav: () -> Unit = {
                        navController.navigate(
                            Routes.results(raceId ?: "", s.data.resultsStageNumber, suffix = raceDay.stageSuffix),
                        )
                    }
                    val prevResultsNav: () -> Unit = {
                        navController.navigate(
                            Routes.results(
                                raceId ?: "",
                                s.data.prevResultsStageNumber,
                                classKind = "gc",
                                suffix = prevRd?.stageSuffix,
                            ),
                        )
                    }
                    val resultsNav: (() -> Unit)? = when {
                        raceId == null -> null
                        s.data.hasInhouseResults -> currentResultsNav
                        s.data.prevHasInhouse && prevRd != null -> prevResultsNav
                        else -> null
                    }

                    item {
                        StageHeaderCard(
                            data = s.data,
                            navController = navController,
                            onBack = { navController.popBackStack() },
                            // Solo las carreras por etapas enlazan a la pantalla
                            // de competición ("ver todas las etapas"). Una carrera
                            // de un día no tiene lista de etapas, así que su
                            // cabecera no es tappable (paridad con iOS, que oculta
                            // el logo→RaceDetail salvo `isStageRace`).
                            onRaceTap = s.data.race
                                ?.takeIf { it.isStageRace }
                                ?.id
                                ?.let { id ->
                                    { navController.navigate(Routes.race(id)) }
                                },
                            onAssetTap = { asset ->
                                scope.launch {
                                    onAssetTap(app, context, asset, offlineEnabled) { offlineAlert = it }
                                }
                            },
                            onExternalLinkTap = { url ->
                                openExternal(context, url) { offlineAlert = it }
                            },
                            onWebProfileTap = { url ->
                                scope.launch {
                                    onWebProfileTap(
                                        app,
                                        context,
                                        url,
                                        s.data.assets.firstOrNull { it.type == "profile" },
                                        offlineEnabled,
                                    ) { offlineAlert = it }
                                }
                            },
                            onResultsTap = resultsNav,
                        )
                    }

                    val officialProfile = s.data.assets.firstOrNull {
                        it.type == "profile" && !it.url.isNullOrEmpty() && !s.data.raceDay.profileNotViewable
                    }
                    val hasProfile = s.data.raceDay.hasElevationProfile || officialProfile != null
                    val hasTime = !s.data.raceDay.isCancelledDay &&
                        (s.data.raceDay.neutralStartTimeUtc != null ||
                            s.data.raceDay.estimatedFinishTimeUtc != null)
                    val criticalPoints = criticalPointsFor(s.data.raceDay)
                    val hasMetrics = s.data.raceDay.competitiveDistanceKm != null ||
                        s.data.raceDay.hasValidTimeLimit
                    val rd = s.data.raceDay
                    val description = rd.localizedDescription?.takeIf { it.isNotEmpty() }
                    val localizedBonuses = rd.localizedBonuses
                    val localizedNotes = rd.localizedNotes
                    val hasBonuses = !localizedBonuses.isNullOrEmpty()
                    val hasNotes = !localizedNotes.isNullOrEmpty()
                    val hasEditorial = description != null || hasBonuses || hasNotes

                    if (wideDetail && (hasProfile || hasTime || criticalPoints.isNotEmpty() || hasMetrics || hasEditorial)) {
                        item {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(adaptiveInfo.paneSpacing),
                                verticalAlignment = Alignment.Top,
                            ) {
                                Column(
                                    modifier = Modifier.weight(0.62f),
                                    verticalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    if (hasProfile) {
                                        StageProfileSection(
                                            raceDay = rd,
                                            race = race,
                                            officialProfile = officialProfile,
                                            onOfficialProfileTap = { asset ->
                                                scope.launch {
                                                    onAssetTap(app, context, asset, offlineEnabled) { offlineAlert = it }
                                                }
                                            },
                                        )
                                    }
                                    description?.let {
                                        DescriptionCard(
                                            title = stringResource(R.string.stage_section_description),
                                            body = it,
                                            showAutoTranslationNotice = rd.isDescriptionAutoTranslated,
                                        )
                                    }
                                    if (hasBonuses || hasNotes) {
                                        BonusesNotesCard(localizedBonuses, localizedNotes)
                                    }
                                }
                                Column(
                                    modifier = Modifier.weight(0.38f),
                                    verticalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    if (hasTime) TimeSection(rd, race)
                                    if (criticalPoints.isNotEmpty()) CriticalPointsSection(rd, criticalPoints)
                                    if (hasMetrics) RaceMetricsSection(rd)
                                }
                            }
                        }
                    } else {
                        if (hasTime) item { TimeSection(rd, race) }
                        if (hasProfile) {
                            item {
                                StageProfileSection(
                                    raceDay = rd,
                                    race = race,
                                    officialProfile = officialProfile,
                                    onOfficialProfileTap = { asset ->
                                        scope.launch {
                                            onAssetTap(app, context, asset, offlineEnabled) { offlineAlert = it }
                                        }
                                    },
                                )
                            }
                        }
                        if (criticalPoints.isNotEmpty()) item { CriticalPointsSection(rd, criticalPoints) }
                        if (hasMetrics) item { RaceMetricsSection(rd) }
                    }

                    // En una cancelada solo se muestra Revive con clasificaciones
                    // propias y una emisión seleccionada para reproducción.
                    val cancelledWithoutRevive = s.data.raceDay.isCancelledDay &&
                        !RaceLogic.hasReviveBroadcasts(
                            s.data.broadcasts, s.data.hasActualResults, isCancelled = true)
                    val liveTextUrl = if (
                        !s.data.raceDay.isCancelledDay &&
                        !s.data.raceDay.isRestDay &&
                        !s.data.hasActualResults &&
                        s.data.raceDay.raceStatus != "finished"
                    ) {
                        s.data.assets.firstOrNull {
                            it.type == "live_text" && !it.url.isNullOrEmpty()
                        }?.url
                    } else null
                    val hasBroadcastSection = s.data.broadcasts.isNotEmpty() ||
                        s.data.allBroadcasts.isNotEmpty() ||
                        s.data.raceDay.tvStatus == "pending" ||
                        liveTextUrl != null
                    if (hasBroadcastSection && !cancelledWithoutRevive) {
                        item {
                            BroadcastSection(
                                raceDay = s.data.raceDay,
                                race = race,
                                hasResults = s.data.hasActualResults,
                                broadcasts = s.data.broadcasts,
                                allBroadcasts = s.data.allBroadcasts,
                                liveTextUrl = liveTextUrl,
                                onExternalLinkTap = { url ->
                                    openExternal(context, url) { offlineAlert = it }
                                },
                            )
                        }
                    }

                    if (!wideDetail && hasEditorial) {
                        item {
                            BoxWithConstraints(Modifier.fillMaxWidth()) {
                                if (maxWidth >= 700.dp) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                        Box(Modifier.weight(1f)) {
                                            description?.let {
                                                DescriptionCard(
                                                    title = stringResource(R.string.stage_section_description),
                                                    body = it,
                                                    showAutoTranslationNotice = rd.isDescriptionAutoTranslated,
                                                )
                                            }
                                        }
                                        Box(Modifier.weight(1f)) {
                                            if (hasBonuses || hasNotes) BonusesNotesCard(localizedBonuses, localizedNotes)
                                        }
                                    }
                                } else {
                                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        description?.let {
                                            DescriptionCard(
                                                title = stringResource(R.string.stage_section_description),
                                                body = it,
                                                showAutoTranslationNotice = rd.isDescriptionAutoTranslated,
                                            )
                                        }
                                        if (hasBonuses || hasNotes) BonusesNotesCard(localizedBonuses, localizedNotes)
                                    }
                                }
                            }
                        }
                    }
                }
                }
            }
        }
    }

    // Modales según las 3 casuísticas definidas en producto.
    offlineAlert?.let { alert ->
        OfflineAccessDialog(
            alert = alert,
            onDismiss = { offlineAlert = null },
            onEnableOffline = {
                offlineAlert = null
                scope.launch { app.offlineManager.enable() }
            },
        )
    }
}

// ─── Carga de datos ───────────────────────────────────────────────

/**
 * Carga la jornada — primero cache local, luego refresca desde Supabase para
 * poblar Room con la última versión de la carrera. Devuelve una `StageData`
 * ya construida con carrera, retransmisiones ordenadas, assets ordenados y
 * flag de startlist. Se reutiliza tanto en la carga inicial (`LaunchedEffect`)
 * como en el pull-to-refresh.
 */
private suspend fun loadStageData(
    app: CalendarioCiclismoApp,
    stageId: String,
    raceId: String?,
): StageData {
    // Intentar cargar desde caché local
    val cached = app.database.raceDaysDao().getById(stageId)?.toModel()

    // Si no está en caché local y tenemos un raceId (ej: navegación desde búsqueda
    // por ciudad de una carrera futura como la Vuelta a España), prefetchamos la
    // carrera completa para poblar Room antes de continuar.
    if (cached == null && raceId != null) {
        app.repository.refreshRaceComplete(raceId)
    } else {
        // Camino normal: refrescar desde red usando el raceId de la jornada cacheada
        cached?.raceId?.let { app.repository.refreshRaceComplete(it) }
    }

    val latest = app.database.raceDaysDao().getById(stageId)
        ?.toModel() ?: error(app.getString(R.string.stage_label_route_unknown))
    val race = latest.raceId?.let { app.database.racesDao().getById(it)?.toModel() }
    val allBroadcasts = app.database.broadcastsDao()
        .getByRaceDay(stageId)
        .map { it.toModel() }
        .sortedBy { it.sortOrder }
    val broadcasts = RaceLogic.filterBroadcastsByRegion(
        allBroadcasts,
        RegionDetector.allowedBroadcastGroups(),
    )
    val stageAssets = app.database.assetsDao()
        .getByRaceDay(stageId).map { it.toModel() }
    // Derivado de `races.startlistImportedAt` (ya cargado con la carrera).
    // Evita un roundtrip extra a `startlist_teams` que retrasaba el botón.
    val hasStartlist = race?.startlistImportedAt != null
    val siblings = latest.raceId?.let { rid ->
        val allDays = app.database.raceDaysDao().getByRace(rid).map { it.toModel() }.toMutableList()
        RaceLogic.annotateDoubleSectors(allDays)
        allDays.toList()
    } ?: emptyList()
    // El gate llega antes de publicar StageData: así la tarjeta no aparece sin
    // clasificaciones y se transforma después en "Ver clasificaciones".
    val navigable = siblings
        .filter { !it.isRestDay && !it.isCancelledDay }
        .sortedWith(compareBy({ it.stageNumber ?: Int.MAX_VALUE }, { it.dateKey }))
    val previous = navigable.indexOfFirst { it.id == latest.id }
        .takeIf { it > 0 }
        ?.let { navigable[it - 1] }
    val inhouseByDay = latest.raceId?.let { rid ->
        val days = listOfNotNull(
            latest.id to latest.stageNumber,
            previous?.let { it.id to it.stageNumber },
        )
        app.repository.inhouseStagesForDays(rid, days)
    }.orEmpty()
    val currentInhouseStage = inhouseByDay[latest.id]
    val technicalGuide = app.repository.cachedAssetsForRaceDays(siblings.map { it.id })
        .firstOrNull { it.type == "technicalGuide" }
    val assets = (listOfNotNull(technicalGuide) + stageAssets.filter { it.type != "technicalGuide" })
        .distinctBy { it.type }
        .sortedBy { asset ->
            val idx = Constants.ASSET_ORDER.indexOf(asset.type.orEmpty())
            if (idx < 0) Int.MAX_VALUE else idx
        }
    return StageData(
        raceDay = latest,
        race = race,
        broadcasts = broadcasts,
        allBroadcasts = allBroadcasts,
        assets = assets,
        hasStartlist = hasStartlist,
        siblings = siblings,
        hasInhouseResults = inhouseByDay.containsKey(latest.id) || latest.isCancelledDay,
        hasActualResults = inhouseByDay.containsKey(latest.id),
        resultsStageNumber = currentInhouseStage ?: latest.stageNumber,
        prevHasInhouse = previous?.let { inhouseByDay.containsKey(it.id) } == true,
        prevResultsStageNumber = previous?.let { inhouseByDay[it.id] },
    )
}

// ─── Modales de acceso sin conexión ───────────────────────────────

/**
 * Tres casos definidos por producto para enlaces que no pueden abrirse porque
 * no hay red (o porque no hay caché):
 *   - [OutOfRange]: offline ON, pero el asset NO está cacheado.
 *   - [ExternalLinkOffline]: el enlace es externo (no nuestro) y no hay red.
 *   - [OfflineDisabled]: offline OFF + asset propio + sin red → ofrecemos activar.
 */
sealed class OfflineAccessAlert {
    object OutOfRange : OfflineAccessAlert()
    object ExternalLinkOffline : OfflineAccessAlert()
    object OfflineDisabled : OfflineAccessAlert()
    data class RefreshOffline(val offlineEnabled: Boolean) : OfflineAccessAlert()
    /**
     * Pull-to-refresh sin red + offline ON, pero la jornada cae FUERA de la
     * ventana sincronizada (mes actual/mes siguiente). Los datos cacheados
     * pueden estar desactualizados y el sync no los mantiene al día.
     */
    object RefreshOutOfRange : OfflineAccessAlert()
}

/** `true` si el modal debe ofrecer el botón "Activar modo sin conexión". */
private val OfflineAccessAlert.offersEnableOfflineCTA: Boolean
    get() = when (this) {
        OfflineAccessAlert.OfflineDisabled -> true
        is OfflineAccessAlert.RefreshOffline -> !offlineEnabled
        else -> false
    }

@Composable
private fun OfflineAccessDialog(
    alert: OfflineAccessAlert,
    onDismiss: () -> Unit,
    onEnableOffline: () -> Unit,
) {
    val title: String
    val message: String
    when (alert) {
        OfflineAccessAlert.OutOfRange -> {
            title = stringResource(R.string.stage_dialog_out_of_range_title)
            message = stringResource(R.string.stage_dialog_out_of_range_body)
        }
        OfflineAccessAlert.ExternalLinkOffline -> {
            title = stringResource(R.string.stage_dialog_external_link_title)
            message = stringResource(R.string.stage_dialog_external_link_body)
        }
        OfflineAccessAlert.OfflineDisabled -> {
            title = stringResource(R.string.stage_dialog_offline_disabled_title)
            message = stringResource(R.string.stage_dialog_offline_disabled_body)
        }
        is OfflineAccessAlert.RefreshOffline -> {
            title = stringResource(R.string.stage_dialog_refresh_offline_title)
            message = if (alert.offlineEnabled) {
                stringResource(R.string.stage_dialog_refresh_offline_body_active)
            } else {
                stringResource(R.string.stage_dialog_refresh_offline_body_inactive)
            }
        }
        OfflineAccessAlert.RefreshOutOfRange -> {
            title = stringResource(R.string.stage_dialog_refresh_out_of_range_title)
            message = stringResource(R.string.stage_dialog_refresh_out_of_range_body)
        }
    }

    val showCTA = alert.offersEnableOfflineCTA
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            if (showCTA) {
                TextButton(onClick = onEnableOffline) {
                    Text(stringResource(R.string.stage_dialog_action_activate_offline))
                }
            } else {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
            }
        },
        dismissButton = if (showCTA) {
            { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) } }
        } else null,
    )
}

// ─── Lógica de apertura de enlaces ────────────────────────────────

/**
 * Abre un asset: si tiene fichero local (R2 descargado), FileProvider + Intent
 * VIEW (funciona sin red). Si no, decide entre abrir Custom Tabs (hay red) o
 * mostrar un modal según sea enlace externo o asset propio.
 */
private suspend fun onAssetTap(
    app: CalendarioCiclismoApp,
    context: Context,
    asset: Asset,
    offlineEnabled: Boolean,
    showAlert: (OfflineAccessAlert) -> Unit,
) {
    // 1. Fichero local → abrir con la app predeterminada del sistema.
    val localFile: File? = withContext(Dispatchers.IO) {
        app.offlineManager.assetCache().localFile(asset)
    }
    if (localFile != null) {
        openLocalFile(app, localFile, asset.fileExtension)
        return
    }

    val remoteUrl = asset.url?.takeIf { it.isNotEmpty() } ?: return

    // 2. Sin fichero local: si es R2 propio aplicar reglas offline.
    if (asset.isDownloadableR2) {
        openOwnAsset(context, remoteUrl, offlineEnabled, showAlert)
    } else {
        openExternal(context, remoteUrl, showAlert)
    }
}

/**
 * Tap en el chip "Perfil" cuando la jornada tiene perfil SVG web. Con red,
 * abre la página de perfil en el navegador (comportamiento original). Sin red
 * y con modo sin conexión activo, si existe un asset estático de tipo "profile"
 * descargado en local lo abre con la app predeterminada del sistema en vez de
 * caer en el modal de "Enlace externo".
 */
private suspend fun onWebProfileTap(
    app: CalendarioCiclismoApp,
    context: Context,
    url: String,
    profileAsset: Asset?,
    offlineEnabled: Boolean,
    showAlert: (OfflineAccessAlert) -> Unit,
) {
    if (NetworkMonitor.isOnline(context)) {
        openExternal(context, url, showAlert)
        return
    }
    if (offlineEnabled && profileAsset != null) {
        val localFile: File? = withContext(Dispatchers.IO) {
            app.offlineManager.assetCache().localFile(profileAsset)
        }
        if (localFile != null) {
            openLocalFile(app, localFile, profileAsset.fileExtension)
            return
        }
    }
    openExternal(context, url, showAlert)
}

private fun openOwnAsset(
    context: Context,
    url: String,
    offlineEnabled: Boolean,
    showAlert: (OfflineAccessAlert) -> Unit,
) {
    if (NetworkMonitor.isOnline(context)) {
        runCatching {
            CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
                .launchUrl(context, url.toUri())
        }
        return
    }
    showAlert(if (offlineEnabled) OfflineAccessAlert.OutOfRange else OfflineAccessAlert.OfflineDisabled)
}

/** YouTube, HBO Max y X deben abrirse en su app nativa si está instalada. */
private fun openExternal(
    context: Context,
    url: String,
    showAlert: (OfflineAccessAlert) -> Unit,
) {
    if (!NetworkMonitor.isOnline(context)) {
        showAlert(OfflineAccessAlert.ExternalLinkOffline)
        return
    }
    openExternalUrl(context, url)
}

// ACTION_INSERT para que el evento entre al calendario primario sin permisos
// y sin la latencia/visibilidad oculta del flujo `?cid=` (que suscribe el .ics).
private fun addStageToCalendar(context: Context, race: Race?, rd: RaceDay) {
    if (!RaceLogic.hasCalendarForYear(race?.year) || rd.isRestDay || rd.isCancelledDay) return
    val title = buildCalendarTitle(race, rd)
    val description = buildCalendarDescription(context, rd)
    val location = listOfNotNull(
        rd.localizedStartLocation?.takeUnless { it.isEmpty() },
        rd.localizedFinishLocation?.takeUnless { it.isEmpty() },
    ).distinct().joinToString(" → ")

    val intent = Intent(Intent.ACTION_INSERT).apply {
        data = CalendarContract.Events.CONTENT_URI
        putExtra(CalendarContract.Events.TITLE, title)
        if (description.isNotEmpty()) {
            putExtra(CalendarContract.Events.DESCRIPTION, description)
        }
        if (location.isNotEmpty()) {
            putExtra(CalendarContract.Events.EVENT_LOCATION, location)
        }

        val beginMs = rd.neutralStartTimeUtc?.let { DateFormatting.parseIso(it)?.toEpochMilli() }
        val endMs = rd.estimatedFinishTimeUtc?.let { DateFormatting.parseIso(it)?.toEpochMilli() }

        when {
            beginMs != null -> {
                putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMs)
                putExtra(
                    CalendarContract.EXTRA_EVENT_END_TIME,
                    endMs ?: (beginMs + 3 * 60 * 60 * 1000L),
                )
            }
            else -> {
                val day = DateFormatting.parseLocalDate(rd.dateKey)
                if (day != null) {
                    val dayStart = day.atStartOfDay(java.time.ZoneId.of("Europe/Madrid"))
                        .toInstant().toEpochMilli()
                    putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, dayStart)
                    putExtra(CalendarContract.EXTRA_EVENT_END_TIME, dayStart + 24 * 60 * 60 * 1000L)
                    putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true)
                }
            }
        }

        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching { context.startActivity(intent) }
}

private fun buildCalendarTitle(race: Race?, rd: RaceDay): String {
    val raceName = race?.name.orEmpty()
    val year = race?.year?.toString().orEmpty()
    val base = listOf(raceName, year).filter { it.isNotEmpty() }.joinToString(" ")
    val stage = rd.stageLabel
    return if (stage.isNotEmpty() && race?.isStageRace == true) {
        if (base.isEmpty()) stage else "$base · $stage"
    } else {
        base.ifEmpty { stage }
    }
}

private fun buildCalendarDescription(context: Context, rd: RaceDay): String {
    val parts = mutableListOf<String>()
    rd.routeDescription?.takeUnless { it.isEmpty() }?.let { parts += it }
    rd.distanceFormatted?.let { parts += it }
    val typeLabel = RaceLogic.resolveTypeLabel(context, rd.primaryType, rd.secondaryType)
    if (typeLabel.isNotEmpty()) parts += typeLabel
    val header = parts.joinToString(" · ")
    val slug = rd.slug
    val url = if (!slug.isNullOrEmpty()) {
        "https://calendariociclismo.app/jornada/$slug/"
    } else null
    return listOfNotNull(header.takeIf { it.isNotEmpty() }, url).joinToString("\n\n")
}

/**
 * Lanza un Intent.ACTION_VIEW apuntando al fichero local con el MIME adecuado.
 * Usa FileProvider — no admite `file://` directos desde Android 7.
 */
private fun openLocalFile(app: CalendarioCiclismoApp, file: File, extension: String) {
    runCatching {
        val authority = "${app.packageName}.fileprovider"
        val uri = FileProvider.getUriForFile(app, authority, file)
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
            ?: when (extension.lowercase()) {
                "pdf" -> "application/pdf"
                "png", "jpg", "jpeg", "gif", "webp" -> "image/*"
                else -> "*/*"
            }
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        app.startActivity(intent)
    }
}

// ─── Cards ────────────────────────────────────────────────────────

@Composable
internal fun SectionCard(content: @Composable () -> Unit) {
    // Tarjeta canónica neutra (sin tinte de marca): en el detalle de jornada
    // las secciones son bloques de info de UNA carrera, no carreras distintas,
    // así que la superficie es gris pulida (CCCard) en vez del Box tintado al
    // 40% previo. Esquinas 12dp (un punto menos que el cintillo, encajan mejor
    // en secciones grandes) y el mismo padding interno de 14dp.
    CCCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 12,
    ) {
        Box(modifier = Modifier.padding(14.dp)) {
            content()
        }
    }
}

@Composable
internal fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        // Peso igualado al titular del cintillo (Medium, no SemiBold). Gobierna
        // los títulos de sección del detalle: Horario, Resultados, Televisión/
        // Revive, Descripción, Bonificaciones, Notas.
        fontWeight = FontWeight.Medium,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.semantics { heading() },
    )
}

/**
 * Acción canónica de Jornada. Unifica los CTA propios, los enlaces alternativos,
 * los controles de retransmisión y los selectores sin sacrificar el objetivo
 * táctil mínimo de 48 dp.
 */
@Composable
internal fun StageActionButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primaryAction: Boolean = false,
    selected: Boolean? = null,
) = CCActionButton(label, onClick, modifier, icon, primaryAction, selected)

// ─── Cabecera ─────────────────────────────────────────────────────

/**
 * Datos generales de la etapa (flecha de retroceso integrada, carrera, jornada,
 * fecha, recorrido y badges de tipo/distancia/desnivel). Es el bloque que en la
 * jornada aparece encima de la documentación. Emite sus elementos como hijos
 * directos de la [Column] contenedora, por lo que debe invocarse dentro de una
 * `Column(verticalArrangement = Arrangement.spacedBy(10.dp))`.
 *
 * Se comparte entre la jornada ([StageHeaderCard]) y el perfil de elevación
 * ([StageInfoHeaderCard]) para mantener el contexto de la etapa por encima del
 * perfil. La flecha llama a [onBack] (en el perfil, vuelve a la jornada).
 */
@Composable
internal fun RaceDayHeading(
    name: String?, logoUrl: String?, countryCode: String?, dateLabel: String, onBack: () -> Unit,
    showFlag: Boolean = true, category: String? = null, stageLabel: String = "", onRaceTap: (() -> Unit)? = null,
) {
    val hasStageLabel = stageLabel.isNotEmpty()
    // Fila superior: flecha integrada + logo + nombre de carrera
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconButton(
            onClick = onBack,
            modifier = Modifier.size(32.dp),
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = stringResource(R.string.stage_action_back_cd),
                modifier = Modifier.size(18.dp),
            )
        }
        if (name != null) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .then(
                        if (onRaceTap != null) Modifier.clickable(role = Role.Button, onClick = onRaceTap)
                        else Modifier
                    ),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        // Override puramente cosmético de la jornada
                        // (etapas en el extranjero p.ej.). El override
                        // vence al hideFlag de la carrera.
                        if (showFlag) {
                            CountryFlag(countryCode = countryCode)
                        }
                        Text(
                            text = name,
                            style = MaterialTheme.typography.titleLarge,
                            // Peso igualado al titular del cintillo (Medium) en
                            // lugar de Bold; se mantiene el tamaño titleLarge de
                            // cabecera. Compartido por jornada, perfil y orden de
                            // salida (todas reutilizan StageInfoBlock).
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Spacer(Modifier.height(2.dp))
                    category?.let { CategoryBadge(category = it) }
                }
                RaceLogo(url = logoUrl, size = 36.dp)
            }
        }
    }

    if (hasStageLabel) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }

    // Etapa + fecha forman un par tipográfico (título y subtítulo), por eso
    // van juntos en una Column con spacing reducido — el mismo patrón que en
    // iOS (VStack spacing: 4 dentro del VStack spacing: 8 exterior). Si no se
    // agrupasen, el ritmo vertical quedaría irregular porque hereda el
    // spacing de 8dp del contenedor exterior.
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (hasStageLabel) {
            Text(
                text = stageLabel,
                style = MaterialTheme.typography.titleMedium,
                // Peso igualado al titular del cintillo (Medium, no Bold).
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            // La cabecera de etapa va en el idioma del CONTENIDO (igual que el
            // nombre de carrera, la ruta y el km), no en el del chrome de la UI.
            text = dateLabel,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

}

@Composable
internal fun RaceDayLocation(location: String, detail: String? = null, category: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        category?.let { CategoryBadge(it) }
        Column {
            if (location.isNotEmpty()) Text(location, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            detail?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun StageInfoBlock(
    raceDay: RaceDay,
    race: Race?,
    onBack: () -> Unit,
    onRaceTap: (() -> Unit)? = null,
) {
    val rd = raceDay

    RaceDayHeading(name = race?.localizedName, logoUrl = race?.logoUrl, countryCode = rd.countryCode ?: race?.countryCode,
        dateLabel = DateFormatting.formatDateLongContent(rd.dateKey), onBack = onBack, showFlag = race?.hideFlag != true || rd.countryCode != null,
        category = race?.uciCategory, stageLabel = rd.stageLabel, onRaceTap = onRaceTap)

    rd.routeDescription?.let { route ->
        RaceDayLocation(route, detail = if (rd.isSingleCity) stringResource(R.string.stage_label_start_finish) else null)
    }

    // Badge + km/desnivel: FlowRow para que km/desnivel salten a una segunda
    // fila cuando la pastilla (primaryType + secondaryType) es muy larga, en
    // vez de comprimirse.
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (!rd.isRestDay && !rd.isCancelledDay) {
            StageTypeBadge(
                primaryType = rd.primaryType,
                secondaryType = rd.secondaryType,
                countryCode = race?.countryCode,
            )
        }
        // Bloque km · desnivel se mantiene como una unidad en la misma fila —
        // si entra junto al badge, queda al lado; si no, salta entero a la
        // siguiente línea sin partirse entre km y desnivel.
        if (rd.distanceFormatted != null || rd.elevationGainFormatted != null) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                rd.distanceFormatted?.let { dist ->
                    Text(
                        text = dist,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (rd.distanceFormatted != null && rd.elevationGainFormatted != null) {
                    Text(
                        text = "·",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                rd.elevationGainFormatted?.let { elev ->
                    Text(
                        text = elev,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }

    // Aviso de jornada cancelada — espejo del `jornada-cancelled-banner` de la
    // web: la ficha sigue siendo accesible (recorrido, perfil, documentación),
    // pero deja claro de entrada que la etapa no se corrió.
    if (rd.isCancelledDay) {
        Row(
            modifier = Modifier
                .background(
                    color = MaterialTheme.colorScheme.error.copy(alpha = 0.10f),
                    shape = RoundedCornerShape(6.dp),
                )
                .border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.error.copy(alpha = 0.30f),
                    shape = RoundedCornerShape(6.dp),
                )
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.Cancel,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(16.dp),
            )
            Text(
                text = stringResource(
                    if (race?.raceFormat == "one_day") R.string.race_cancelled
                    else R.string.race_stage_cancelled,
                ),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/**
 * Tarjeta de datos generales de la etapa lista para usar fuera de la jornada
 * (p. ej. encima del perfil de elevación). Reutiliza [StageInfoBlock] dentro de
 * la misma [SectionCard] que usa la jornada, sin los chips de documentación.
 */
@Composable
internal fun StageInfoHeaderCard(
    raceDay: RaceDay,
    race: Race?,
    onBack: () -> Unit,
    onRaceTap: (() -> Unit)? = null,
) {
    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StageInfoBlock(
                raceDay = raceDay,
                race = race,
                onBack = onBack,
                onRaceTap = onRaceTap,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StageHeaderCard(
    data: StageData,
    navController: NavController,
    onBack: () -> Unit,
    onRaceTap: (() -> Unit)? = null,
    onAssetTap: (Asset) -> Unit = {},
    onExternalLinkTap: (String) -> Unit = {},
    onWebProfileTap: (String) -> Unit = onExternalLinkTap,
    onResultsTap: (() -> Unit)? = null,
) {
    val rd = data.raceDay
    val race = data.race
    val context = LocalContext.current
    val app = rememberApp()
    val assets = data.assets.filter {
        it.type != "live_text" && !(rd.profileNotViewable && it.type == "profile")
    }
    val hasGpxProfile = rd.hasElevationProfile
    val hasProfile = assets.any { it.type == "profile" }
    // Cuando existen AMBOS (perfil interactivo GPX + asset estático) se ofrecen
    // los dos chips: "Perfil interactivo" (nativo) + "Perfil oficial" (asset).
    // Con uno solo, la etiqueta es simplemente "Perfil".
    val bothProfiles = hasGpxProfile && hasProfile
    val hasRouteMap = !rd.routeGpxUrl.isNullOrEmpty()
    val hasStaticMap = assets.any { it.type == "map" && !it.url.isNullOrEmpty() }
    val bothMaps = hasRouteMap && hasStaticMap
    val isSterrato = rd.primaryType == "sterrato"
    val isFrance = race?.countryCode?.uppercase() == "FR"
    val hasICalSubscribe = RaceLogic.hasCalendarForYear(race?.year) && !rd.slug.isNullOrEmpty() && !rd.isRestDay && !rd.isCancelledDay
    val followedStageIds by app.preferences.followedStageIds.collectAsState(initial = emptySet())
    // El control debe seguir visible aunque el usuario todavía no haya activado
    // los permisos: es el punto de entrada para personalizar esta jornada.
    val showNotifChip = !rd.isRestDay && !rd.isCancelledDay
    val hasDocs = hasGpxProfile || hasRouteMap || assets.isNotEmpty() || data.hasStartlist || !race?.websiteUrl.isNullOrEmpty() || hasICalSubscribe || showNotifChip || onResultsTap != null
    // Dividimos los assets respecto al índice de "profile" en ASSET_ORDER para
    // que el chip SVG web aparezca siempre después del rutómetro.
    val profileOrderIdx = Constants.ASSET_ORDER.indexOf("profile").let { if (it < 0) Constants.ASSET_ORDER.size else it }
    // El Libro de Ruta es común a toda la competición y mantiene una posición
    // fija: web oficial → Libro de Ruta → dorsales. Lo apartamos del grupo
    // genérico para que no vuelva a aparecer en su posición histórica.
    val technicalGuideAsset = assets.firstOrNull {
        it.type == "technicalGuide" && !it.url.isNullOrEmpty()
    }
    val assetsBeforeProfile = assets.filter { a ->
        a.type != "technicalGuide" &&
            Constants.ASSET_ORDER.indexOf(a.type ?: "").let { i -> if (i < 0) Int.MAX_VALUE else i } < profileOrderIdx
    }
    // Asset estático de mapa = "Mapa oficial" cuando coexisten ambos.
    val officialMapAsset = if (bothMaps) assets.firstOrNull { it.type == "map" && !it.url.isNullOrEmpty() } else null
    // Asset estático de perfil = "Perfil oficial" cuando coexisten ambos.
    // Se renderiza APARTE, justo tras el rutómetro y ANTES del interactivo
    // (orden: Rutómetro → oficial → interactivo → Mapa), por eso se excluye
    // de assetsFromProfile.
    val officialProfileAsset = if (bothProfiles) assets.firstOrNull { it.type == "profile" && !it.url.isNullOrEmpty() } else null
    val assetsFromProfile = assets.filter { a ->
        // El asset estático de tipo "profile" NUNCA va en este grupo cuando hay
        // perfil SVG web: si solo está el interactivo se oculta; si están ambos,
        // el oficial se renderiza aparte (arriba).
        if (a.type == "profile" && hasGpxProfile) return@filter false
        // Con mapa interactivo y oficial, el oficial se renderiza aparte
        // inmediatamente antes del interactivo, como sucede con perfiles.
        if (a.type == "map" && bothMaps) return@filter false
        Constants.ASSET_ORDER.indexOf(a.type ?: "").let { i -> if (i < 0) Int.MAX_VALUE else i } >= profileOrderIdx
    }

    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StageInfoBlock(
                raceDay = rd,
                race = race,
                onBack = onBack,
                onRaceTap = onRaceTap,
            )

            // Chips de documentación dentro de la primera card, sin titular —
            // igual que en iOS y equivalente a la disposición de la web, donde
            // estos enlaces aparecen en la parte superior de la jornada. El
            // divider previo replica el que separa la cabecera de carrera del
            // bloque de etapa.
            if (hasDocs) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                AssetActionStrip {
                    // Clasificaciones propias (in-house) — primer chip de la tira,
                    // en azul de marca. Sin clasificaciones no hay chip.
                    onResultsTap?.let { tap ->
                        AssetChip(
                            icon = Icons.Filled.EmojiEvents,
                            label = stringResource(R.string.stage_doc_classifications),
                            onClick = tap,
                            highlighted = true,
                        )
                    }

                    val websiteUrl = race?.websiteUrl
                    if (!websiteUrl.isNullOrEmpty()) {
                        AssetChip(
                            icon = Icons.Outlined.Language,
                            label = stringResource(R.string.stage_doc_web_official),
                            onClick = { onExternalLinkTap(websiteUrl) },
                        )
                    }

                    technicalGuideAsset?.let { asset ->
                        AssetChip(
                            icon = assetIcon(asset.type),
                            label = asset.typeLabel(context),
                            onClick = { onAssetTap(asset) },
                        )
                    }

                    if (data.hasStartlist && race != null) {
                        val label = when {
                            race.startlistProvisional -> stringResource(R.string.stage_doc_startlist_provisional)
                            race.isFemale -> stringResource(R.string.stage_doc_startlist_female)
                            else -> stringResource(R.string.stage_doc_startlist_male)
                        }
                        AssetChip(
                            icon = Icons.Filled.Group,
                            label = label,
                            onClick = { navController.navigate(Routes.startlist(race.id)) },
                        )
                    }

                    // Resto de assets antes de "profile" (orden de salida,
                    // rutómetro). El Libro de Ruta ya ocupa su posición fija.
                    assetsBeforeProfile.forEach { asset ->
                        // El asset startOrder ahora abre la vista nativa
                        if (asset.type == "startOrder") {
                            AssetChip(
                                icon = Icons.Filled.Timer,
                                label = stringResource(R.string.start_order_title),
                                onClick = { navController.navigate(Routes.startOrder(rd.id)) },
                            )
                            return@forEach
                        }
                        if (asset.url.isNullOrEmpty()) return@forEach
                        val isSterratiPorts = asset.type == "ports" && !hasProfile && isSterrato
                        val icon = if (isSterratiPorts) Icons.Filled.Grain else assetIcon(asset.type)
                        val label = if (isSterratiPorts) (
                            if (isFrance) stringResource(R.string.stage_doc_ribinou)
                            else stringResource(R.string.stage_doc_sterrato)
                        ) else asset.typeLabel(context)
                        AssetChip(icon = icon, label = label, onClick = { onAssetTap(asset) })
                    }

                    // Perfil oficial (asset estático) — solo cuando coexisten
                    // ambos. Va JUSTO DESPUÉS del rutómetro y ANTES del interactivo.
                    officialProfileAsset?.let { asset ->
                        AssetChip(
                            icon = assetIcon(asset.type),
                            label = stringResource(R.string.stage_doc_profile_official),
                            onClick = { onAssetTap(asset) },
                        )
                    }

                    // Perfil SVG — navega a la vista nativa del perfil; siempre
                    // después del rutómetro (y del perfil oficial, si lo hay). Con
                    // asset estático además, este es el "Perfil interactivo"; si
                    // no, solo "Perfil".
                    if (hasGpxProfile) {
                        AssetChip(
                            icon = Icons.AutoMirrored.Filled.ShowChart,
                            label = stringResource(
                                if (bothProfiles) R.string.stage_doc_profile_interactive
                                else R.string.stage_doc_profile
                            ),
                            onClick = { navController.navigate("elevation_profile/${rd.id}") },
                        )
                    }

                    // Mapa oficial — cuando también existe el interactivo, va primero.
                    officialMapAsset?.let { asset ->
                        AssetChip(
                            icon = Icons.Filled.Map,
                            label = stringResource(R.string.stage_doc_map_official),
                            onClick = { onAssetTap(asset) },
                        )
                    }

                    // Mapa del recorrido nativo. Con ambos recursos, se etiqueta
                    // como interactivo y queda inmediatamente después del oficial.
                    if (hasRouteMap) {
                        AssetChip(
                            icon = Icons.Filled.Map,
                            label = stringResource(
                                if (bothMaps) R.string.stage_doc_map_interactive
                                else R.string.stage_doc_map
                            ),
                            onClick = { navController.navigate(Routes.routeMap(rd.id)) },
                        )
                    }

                    // Assets desde "profile" en adelante (ports, map; el
                    // profile estático se renderiza arriba como "Perfil oficial").
                    assetsFromProfile.forEach { asset ->
                        if (asset.url.isNullOrEmpty()) return@forEach
                        val isSterratiPorts = asset.type == "ports" && !hasProfile && isSterrato
                        val icon = if (isSterratiPorts) Icons.Filled.Grain else assetIcon(asset.type)
                        val label = when {
                            isSterratiPorts ->
                                if (isFrance) stringResource(R.string.stage_doc_ribinou)
                                else stringResource(R.string.stage_doc_sterrato)
                            else -> asset.typeLabel(context)
                        }
                        AssetChip(icon = icon, label = label, onClick = { onAssetTap(asset) })
                    }

                    if (showNotifChip) {
                        StageNotificationChip(
                            raceDayId = rd.id,
                            isFollowing = followedStageIds.contains(rd.id),
                            app = app,
                        )
                    }

                    if (hasICalSubscribe) {
                        ICalChip(onClick = { addStageToCalendar(context, race, rd) })
                    }
                }
            }
        }
    }
}

// ─── Chip de notificaciones de jornada ────────────────────────────

@Composable
private fun StageNotificationChip(
    raceDayId: String,
    isFollowing: Boolean,
    app: CalendarioCiclismoApp,
) {
    val scope = rememberCoroutineScope()
    val haptic = rememberHaptics()
    val label = stringResource(R.string.race_notifications)
    val icon = if (isFollowing) Icons.Filled.Notifications else Icons.Outlined.NotificationsNone

    AssetChip(
        icon = icon,
        label = label,
        onClick = {
                // Notificaciones enriquecidas liberadas al plan gratuito: sin paywall.
                haptic(Haptics.Event.Selection)
                scope.launch {
                    val current = app.preferences.snapshotFollowedStageIds().toMutableSet()
                    if (isFollowing) current.remove(raceDayId) else current.add(raceDayId)
                    app.preferences.setFollowedStageIds(current)
                    app.pushManager.syncCategories()
                }
        },
    )
}

// ─── Horario ──────────────────────────────────────────────────────

@Composable
private fun TimeSection(rd: RaceDay, race: Race?) {
    val startStr = rd.neutralStartTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
    val finishStr = rd.estimatedFinishTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
    val isItt = rd.primaryType == "itt"
    val isTtt = rd.primaryType == "ttt"
    val fem = race?.isFemale == true
    val startLabel = stringResource(
        when {
            isItt && fem -> R.string.stage_label_start_first_rider_female
            isItt -> R.string.stage_label_start_first_rider
            isTtt -> R.string.stage_label_start_first_team
            else -> R.string.stage_label_start_neutralized
        },
    )
    val finishLabel = stringResource(
        when {
            isItt && fem -> R.string.stage_label_finish_last_rider_female
            isItt -> R.string.stage_label_finish_last_rider
            isTtt -> R.string.stage_label_finish_last_team
            else -> R.string.stage_label_estimated_finish
        },
    )
    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle(stringResource(R.string.stage_section_schedule))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (startStr != null) {
                    Column(
                        modifier = Modifier.weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = startStr,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = startLabel,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (startStr != null && finishStr != null) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.outline,
                    )
                }
                if (finishStr != null) {
                    Column(
                        modifier = Modifier.weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = finishStr,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = finishLabel,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

// ─── Puntos clave del recorrido ────────────────────────────────
@Composable
private fun CriticalPointsSection(rd: RaceDay, points: List<GuideRow>) {
    var showAll by remember(rd.id) { mutableStateOf(false) }
    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle(LocaleHolder.t("Puntos clave", "Key points"))
            Column {
                (if (showAll) points else points.take(5)).forEach { GuideRowItem(it) }
            }
            if (points.size > 5) {
                StageActionButton(
                    label = if (showAll) LocaleHolder.t("Ver menos", "Show less")
                        else LocaleHolder.t("Ver todos", "See all"),
                    onClick = { showAll = !showAll },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

private fun criticalPointsFor(rd: RaceDay): List<GuideRow> = SimplifiedGuide.build(
    distanceKm = rd.distanceKm ?: rd.elevationProfile?.distance,
    neutralStartTimeUtc = rd.neutralStartTimeUtc,
    estimatedFinishTimeUtc = rd.estimatedFinishTimeUtc,
    summits = rd.profileSummits ?: emptyList(),
    waypoints = rd.profileWaypoints ?: emptyList(),
    primaryType = rd.primaryType,
).filter { it.type != "start" && it.type != "finish" }

@Composable
private fun GuideRowItem(row: GuideRow) {
    // Las horas interpoladas no se presentan como datos del rutómetro.
    val timeStr = row.timeUtc?.takeUnless { row.isEstimated }?.let { DateFormatting.formatTimeLocal(it) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        row.kmToGo?.let { km ->
            val posText = if (km <= 0.5) stringResource(R.string.stage_guide_at_finish)
                else stringResource(R.string.stage_guide_km_to_go, fmtKm(km))
            Text(
                text = posText,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.width(78.dp),
            )
        }
        Box(
            modifier = Modifier
                .padding(end = 10.dp)
                .width(if (row.secondaryType == null) 20.dp else 37.dp)
                .height(20.dp)
                .clearAndSetSemantics { },
        ) {
            GuideMarker(
                type = row.type,
                category = row.category,
                modifier = Modifier.size(20.dp),
            )
            row.secondaryType?.let { secondaryType ->
                GuideMarker(
                    type = secondaryType,
                    category = null,
                    modifier = Modifier
                        .offset(x = 17.dp)
                        .size(20.dp),
                )
            }
        }
        Text(
            text = guideRowLabel(row),
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (timeStr != null) {
            Text(
                text = timeStr,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RaceMetricsSection(rd: RaceDay) {
    val timeLimit = if (rd.hasValidTimeLimit) RaceDay.formatDuration(rd.timeLimitSeconds) else null
    if (rd.competitiveDistanceKm == null && timeLimit == null) return

    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle(LocaleHolder.t("Datos de carrera", "Race data"))
            rd.competitiveDistanceKm?.let {
                MetricRow(LocaleHolder.t("Distancia competitiva", "Competitive distance"), "%.1f km".format(java.util.Locale.US, it))
            }
            timeLimit?.let { MetricRow(LocaleHolder.t("Fuera de control", "Time limit"), it) }
        }
    }
}

@Composable
private fun MetricRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

private fun guideMarkerColor(type: String): Color = when (type) {
    "start" -> Color(0xFF3DBA6F)
    "finish" -> Color(0xFFE63D3D)
    "climb_foot", "summit" -> Color(0xFFC53030)
    "intermediate_sprint" -> Color(0xFF3DBA6F)
    "bonus_sprint" -> Color(0xFFE6B800)
    "intermediate_split" -> Color(0xFF1A5CA8)
    "cobblestone" -> Color(0xFF8C8C8C)
    "sterrato" -> Color(0xFFC4975A)
    else -> Color(0xFF8C8C8C)
}

/**
 * Marcador circular de una fila de la guía. Los glifos se dibujan con Canvas
 * (formas vectoriales blancas centradas y bien dimensionadas dentro del círculo),
 * salvo las categorías de puerto (HC/1..4/M/B/S), que van como texto centrado.
 * Espejo del `guideMarkerSVG` de la web (js/elevation-profile.js).
 */
@Composable
internal fun GuideMarker(type: String, category: String?, modifier: Modifier = Modifier) {
    val circleColor = guideMarkerColor(type)
    // Categoría de puerto o letra de sprint/bonif → texto centrado.
    val letter: String? = when (type) {
        "summit" -> category?.trim()?.takeIf { it.isNotEmpty() } ?: "M"
        "intermediate_sprint" -> "S"
        "bonus_sprint" -> "B"
        else -> null
    }
    val letterColor = if (type == "bonus_sprint") Color.Black else Color.White
    Box(
        modifier = modifier.background(circleColor, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (letter != null) {
            Text(
                text = letter,
                color = letterColor,
                fontSize = if (letter.length >= 2) 9.sp else 11.sp,
                fontWeight = FontWeight.Bold,
                lineHeight = 11.sp,
            )
        } else {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val w = size.width
                val cx = w / 2f
                val cy = size.height / 2f
                val u = w / 20f // 1 unidad de diseño = 1/20 del diámetro (círculo Ø20)
                val white = Color.White
                fun p(x: Float, y: Float) = androidx.compose.ui.geometry.Offset(cx + x * u, cy + y * u)
                when (type) {
                    "start" -> {
                        // Triángulo "play" apuntando a la derecha.
                        val path = androidx.compose.ui.graphics.Path().apply {
                            moveTo(cx - 3.3f * u, cy - 5f * u)
                            lineTo(cx + 5f * u, cy)
                            lineTo(cx - 3.3f * u, cy + 5f * u)
                            close()
                        }
                        drawPath(path, white)
                    }
                    "finish" -> {
                        // Bandera de cuadros 2×2 (tile = 4 unidades → tablero 8×8).
                        val t = 4f * u
                        val x0 = cx - 4f * u
                        val y0 = cy - 4f * u
                        drawRect(white.copy(alpha = 0.3f),
                            topLeft = androidx.compose.ui.geometry.Offset(x0, y0),
                            size = androidx.compose.ui.geometry.Size(t * 2, t * 2))
                        drawRect(white,
                            topLeft = androidx.compose.ui.geometry.Offset(x0, y0),
                            size = androidx.compose.ui.geometry.Size(t, t))
                        drawRect(white,
                            topLeft = androidx.compose.ui.geometry.Offset(x0 + t, y0 + t),
                            size = androidx.compose.ui.geometry.Size(t, t))
                    }
                    "climb_foot" -> {
                        // Flecha ascendente (pie de puerto).
                        val sw = 1.7f * u
                        drawLine(white, p(-4f, 4f), p(4f, -4f), strokeWidth = sw,
                            cap = androidx.compose.ui.graphics.StrokeCap.Round)
                        drawLine(white, p(0.5f, -4f), p(4f, -4f), strokeWidth = sw,
                            cap = androidx.compose.ui.graphics.StrokeCap.Round)
                        drawLine(white, p(4f, -0.5f), p(4f, -4f), strokeWidth = sw,
                            cap = androidx.compose.ui.graphics.StrokeCap.Round)
                    }
                    "intermediate_split" -> {
                        // Cronómetro: manecilla vertical + horizontal + coronita.
                        val sw = 1.6f * u
                        drawLine(white, p(0f, -4f), p(0f, -0.6f), strokeWidth = sw,
                            cap = androidx.compose.ui.graphics.StrokeCap.Round)
                        drawLine(white, p(0f, 0f), p(2.6f, 0f), strokeWidth = sw,
                            cap = androidx.compose.ui.graphics.StrokeCap.Round)
                        drawLine(white, p(-2f, -7f), p(2f, -7f), strokeWidth = 1.5f * u,
                            cap = androidx.compose.ui.graphics.StrokeCap.Round)
                    }
                    "cobblestone", "sterrato" -> drawSurfaceGlyph(type, androidx.compose.ui.geometry.Offset(cx, cy), w)
                    else -> {
                        // Localidad / town: punto sólido.
                        drawCircle(white, radius = 2.6f * u, center = androidx.compose.ui.geometry.Offset(cx, cy))
                    }
                }
            }
        }
    }
}

@Composable
private fun guideRowLabel(row: GuideRow): String {
    val primary = guideTypeLabel(row.type, row.label)
    val secondary = row.secondaryType?.let { guideTypeLabel(it, row.secondaryLabel) }
    return secondary?.takeIf { it != primary }?.let { "$primary · $it" } ?: primary
}

@Composable
private fun guideTypeLabel(type: String, label: String?): String = when (type) {
    "start" -> stringResource(R.string.stage_guide_start)
    "finish" -> stringResource(R.string.stage_guide_finish)
    "climb_foot" -> label?.let { stringResource(R.string.stage_guide_climb_foot, it) }
        ?: stringResource(R.string.stage_guide_climb_foot_generic)
    "summit" -> label ?: stringResource(R.string.stage_guide_summit)
    "intermediate_sprint" -> label ?: stringResource(R.string.stage_guide_intermediate_sprint)
    "bonus_sprint" -> label ?: stringResource(R.string.stage_guide_bonus_sprint)
    "intermediate_split" -> label ?: stringResource(R.string.stage_guide_intermediate_split)
    "cobblestone" -> label ?: stringResource(R.string.stage_guide_cobblestone)
    "sterrato" -> label ?: stringResource(R.string.stage_guide_sterrato)
    "town" -> label ?: stringResource(R.string.stage_guide_town)
    else -> label ?: type
}

// Formatea un km de la guía con el separador decimal del IDIOMA DE CONTENIDO
// (ES → coma, EN → punto), igual que `RaceDay.distanceFormatted`. Espejo de la
// web (_fmtGuideKm) e iOS (fmtKm).
private fun fmtKm(d: Double): String {
    if (d == Math.floor(d)) return d.toInt().toString()
    val raw = String.format(java.util.Locale.US, "%.1f", d) // siempre con '.'
    return if (LocaleHolder.shouldShowEnglishContent) raw else raw.replace('.', ',')
}

// ─── Retransmisión / Revive ───────────────────────────────────────

private fun isReviveBroadcast(b: Broadcast): Boolean {
    return RaceLogic.isReviveBroadcast(b)
}

private fun broadcastRegionLabel(country: String?): String? {
    if (country == null || country == "ALL") return null
    if (LocaleHolder.current.language != "en") {
        return when (country) {
            "UK_IE" -> "GB / IRL"
            "SCANDI" -> "ESCANDI"
            else -> country
        }
    }
    return when (country) {
        "EUROPA" -> "EUROPE"
        "UK_IE" -> "UK / IRL"
        "NORTEAM" -> "NORTH AM."
        else -> country
    }
}

@Composable
private fun BroadcastSection(
    raceDay: RaceDay,
    race: Race?,
    hasResults: Boolean,
    broadcasts: List<Broadcast>,
    allBroadcasts: List<Broadcast>,
    liveTextUrl: String?,
    onExternalLinkTap: (String) -> Unit,
) {
    val primary = MaterialTheme.colorScheme.primary
    var showAllBroadcasts by remember(raceDay.id) { mutableStateOf(false) }
    val regionalIds = remember(broadcasts) { broadcasts.mapTo(mutableSetOf()) { it.id } }
    val hasHiddenBroadcasts = allBroadcasts.any { it.id !in regionalIds }

    // Revive aparece con clasificaciones de esta jornada y una emisión recuperable.
    // Conserva el filtro regional y no ofrece el selector «Todas».
    val hasReviveBroadcast = RaceLogic.hasReviveBroadcasts(
        broadcasts, hasResults, isCancelled = raceDay.isCancelledDay)

    val selectedBroadcasts = if (showAllBroadcasts) allBroadcasts else broadcasts
    val visibleBroadcasts = if (hasReviveBroadcast)
        RaceLogic.reviveBroadcasts(broadcasts, raceDay.isCancelledDay)
    else
        selectedBroadcasts

    val title = if (hasReviveBroadcast) {
        if (race?.isOneDay == true) stringResource(R.string.stage_section_broadcast_revive_one_day)
        else stringResource(R.string.stage_section_broadcast_revive_stage)
    } else {
        stringResource(R.string.stage_section_broadcast)
    }

    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                SectionTitle(title)
                if (!hasReviveBroadcast && raceDay.tvStatus == "pending") {
                    TVBadge(tvStatus = "pending", broadcasts = emptyList())
                }
            }
            if ((hasHiddenBroadcasts && !hasReviveBroadcast) || liveTextUrl != null) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (hasHiddenBroadcasts && !hasReviveBroadcast) {
                        StageActionButton(
                            icon = Icons.Outlined.Language,
                            label = if (showAllBroadcasts) {
                                stringResource(R.string.stage_broadcast_filter_region)
                            } else {
                                stringResource(R.string.stage_broadcast_filter_all)
                            },
                            onClick = { showAllBroadcasts = !showAllBroadcasts },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (liveTextUrl != null) {
                        StageActionButton(
                            icon = Icons.Outlined.ChatBubbleOutline,
                            label = stringResource(R.string.asset_live_text),
                            onClick = { onExternalLinkTap(liveTextUrl) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
            if (visibleBroadcasts.isEmpty() && hasHiddenBroadcasts && !showAllBroadcasts) {
                Text(
                    text = stringResource(R.string.stage_broadcast_no_region),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
            }
            visibleBroadcasts.forEach { b ->
                BroadcastRow(b, isRevive = hasReviveBroadcast, hasResults = hasResults,
                    showsRegion = showAllBroadcasts && !hasReviveBroadcast, onExternalLinkTap = onExternalLinkTap)
            }
        }
    }
}

@Composable
internal fun BroadcastRow(b: Broadcast, isRevive: Boolean = false, hasResults: Boolean = false,
    showsRegion: Boolean = false, onExternalLinkTap: (String) -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    val url = b.url?.takeIf { it.isNotEmpty() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (url != null) Modifier.clickable(role = Role.Button) {
                    onExternalLinkTap(url)
                } else Modifier
            )
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = Icons.Filled.Tv,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(18.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            val channelFallback = stringResource(R.string.stage_broadcast_channel_fallback)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = b.channel ?: channelFallback,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )
                if (showsRegion) {
                    broadcastRegionLabel(b.country)?.let { region ->
                        Text(
                            text = region,
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                            fontWeight = FontWeight.SemiBold,
                            color = primary,
                            modifier = Modifier
                                .background(
                                    primary.copy(alpha = 0.12f),
                                    RoundedCornerShape(3.dp),
                                )
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
                if (!isRevive) {
                    b.startTimeLocal?.let { time ->
                        Text(
                            text = "·",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = time,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            if (RaceLogic.shouldShowBroadcastNote(hasResults, isRevive, b.showInRevive)) {
                b.note?.takeIf { it.isNotEmpty() }?.let { note ->
                    Text(
                        text = note,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        if (url != null) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = stringResource(R.string.stage_action_open_link_cd),
                tint = primary,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

// ─── Documentación ────────────────────────────────────────────────
// AssetChip vive ahora en `ui/components/AssetChip.kt` para reusar el estilo
// en RaceScreen (web oficial, inscritos) con paridad total con StageScreen.

@Composable
private fun ICalChip(onClick: () -> Unit) {
    val label = stringResource(R.string.stage_doc_add_to_calendar)
    AssetChip(icon = Icons.Outlined.CalendarMonth, label = label, onClick = onClick)
}

private fun assetIcon(type: String?): ImageVector = when (type) {
    "technicalGuide" -> Icons.AutoMirrored.Outlined.InsertDriveFile
    "startOrder" -> Icons.Filled.Timer
    "profile" -> Icons.AutoMirrored.Filled.ShowChart
    "map" -> Icons.Filled.Map
    "roadbook" -> Icons.Filled.Description
    "ports" -> Icons.Filled.Terrain
    "live_text" -> Icons.Outlined.ChatBubbleOutline
    "pave" -> Icons.Filled.Terrain
    "startlist" -> Icons.Filled.Group
    else -> Icons.AutoMirrored.Outlined.InsertDriveFile
}

// ─── Descripción / Bonificaciones / Notas ─────────────────────────

@Composable
private fun DescriptionCard(title: String, body: String, showAutoTranslationNotice: Boolean = false) {
    val paragraphs = remember(body) {
        body.split("\n").filter { it.trim().replace("\u00A0", "").isNotEmpty() }
    }
    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SectionTitle(title)
                if (showAutoTranslationNotice) {
                    Text(
                        text = "AI translated from Spanish, might contain errors",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                paragraphs.forEach { para ->
                    MarkdownText(
                        source = para,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}

@Composable
private fun BonusesNotesCard(bonuses: String?, notes: String?) {
    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!bonuses.isNullOrEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SectionTitle(stringResource(R.string.stage_section_bonuses))
                    MarkdownText(
                        source = bonuses,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (!bonuses.isNullOrEmpty() && !notes.isNullOrEmpty()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            if (!notes.isNullOrEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SectionTitle(stringResource(R.string.stage_section_notes))
                    MarkdownText(
                        source = notes,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

// ─── State ────────────────────────────────────────────────────────

private data class StageData(
    val raceDay: RaceDay,
    val race: Race?,
    val broadcasts: List<Broadcast>,
    val allBroadcasts: List<Broadcast>,
    val assets: List<Asset>,
    val hasStartlist: Boolean = false,
    val siblings: List<RaceDay> = emptyList(),
    val hasInhouseResults: Boolean = false,
    val hasActualResults: Boolean = false,
    val resultsStageNumber: Int? = null,
    val prevHasInhouse: Boolean = false,
    val prevResultsStageNumber: Int? = null,
)

private sealed class StageState {
    data object Loading : StageState()
    data class Error(val message: String) : StageState()
    data class Ready(val data: StageData) : StageState()
}

/** Glifo compartido por la guía, el perfil y sus etiquetas. */
internal fun androidx.compose.ui.graphics.drawscope.DrawScope.drawSurfaceGlyph(
    type: String,
    center: androidx.compose.ui.geometry.Offset,
    diameter: Float,
) {
    val cx = center.x
    val cy = center.y
    val u = diameter / 20f
    val white = Color.White
    fun p(x: Float, y: Float) = androidx.compose.ui.geometry.Offset(cx + x * u, cy + y * u)
    when (type) {
        "cobblestone" -> {
            // Pavé: heptágono (mismo trazo que el asset).
            val sw = 1.2f * u
            val pts = listOf(
                p(-1.6f, 4.4f), p(-4.4f, 0.55f), p(-1.6f, -2.75f),
                p(2.25f, -4.4f), p(4.4f, -2.75f), p(5.5f, 0.55f), p(3.85f, 4.4f))
            val path = androidx.compose.ui.graphics.Path().apply {
                moveTo(pts[0].x, pts[0].y)
                for (i in 1 until pts.size) lineTo(pts[i].x, pts[i].y)
                close()
            }
            drawPath(path, white, style = androidx.compose.ui.graphics.drawscope.Stroke(
                width = sw, cap = androidx.compose.ui.graphics.StrokeCap.Round,
                join = androidx.compose.ui.graphics.StrokeJoin.Round))
        }
        "sterrato" -> {
            // Sterrato: tres guijarros.
            val sw = 1.2f * u
            val st = androidx.compose.ui.graphics.drawscope.Stroke(width = sw)
            fun ellipse(cxr: Float, cyr: Float, rx: Float, ry: Float) {
                drawOval(white,
                    topLeft = androidx.compose.ui.geometry.Offset(cx + (cxr - rx) * u, cy + (cyr - ry) * u),
                    size = androidx.compose.ui.geometry.Size(rx * 2 * u, ry * 2 * u), style = st)
            }
            ellipse(-3f, 2.5f, 2.5f, 1.65f)
            ellipse(2.5f, 2.5f, 2.2f, 1.55f)
            ellipse(0f, -1.7f, 2.5f, 1.65f)
        }
    }
}
