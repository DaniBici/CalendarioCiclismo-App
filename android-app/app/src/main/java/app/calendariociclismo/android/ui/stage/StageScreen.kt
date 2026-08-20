package app.calendariociclismo.android.ui.stage

import android.content.Context
import android.content.Intent
import android.provider.CalendarContract
import android.webkit.MimeTypeMap
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.Grain
import androidx.compose.material.icons.filled.Terrain
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
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
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CategoryBadge
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.MarkdownText
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.StageTypeBadge
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
                val loadingCd = stringResource(R.string.loading)
                Box(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator(modifier = Modifier.semantics { contentDescription = loadingCd }) }
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
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
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
                        )
                    }

                    // Jornada cancelada → sin horario: la etapa no se corre, la
                    // salida/meta ya no describen nada (el aviso de cancelación
                    // del header es quien lo cuenta). Paridad con la web.
                    if (!s.data.raceDay.isCancelledDay &&
                        (s.data.raceDay.neutralStartTimeUtc != null ||
                            s.data.raceDay.estimatedFinishTimeUtc != null)
                    ) {
                        item { TimeSection(s.data.raceDay, s.data.race) }
                    }

                    val race = s.data.race
                    val raceDay = s.data.raceDay
                    val navSiblings = s.data.siblings
                        .filter { !it.isRestDay && !it.isCancelledDay }
                        .sortedWith(compareBy({ it.stageNumber ?: Int.MAX_VALUE }, { it.dateKey }))
                    val currentIdx = navSiblings.indexOfFirst { it.id == raceDay.id }
                    val prevRd = if (currentIdx > 0) navSiblings[currentIdx - 1] else null

                    // ¿Los resultados de la etapa ACTUAL ya están disponibles (in-house
                    // o por hora)? Si lo están, la GC del día los recoge → no se
                    // muestra "Así está la carrera" (espejo de `_currentResultsAvailable`).
                    val hasInhouse = s.data.hasInhouseResults
                    val currentResultsAvailable =
                        hasInhouse || RaceLogic.shouldShowResultsDetail(raceDay, race)

                    // "Así está la carrera": resultados de la etapa anterior. Si esa
                    // etapa tiene clasificaciones in-house → CTA primario a la pantalla
                    // nativa (FC/PCS de respaldo); si no, comportamiento clásico FC/PCS
                    // con el gate temporal. Espejo de jornada.js (web).
                    val showPrevInhouse = s.data.prevHasInhouse && !currentResultsAvailable
                    val showPrevExternal = prevRd != null && race != null &&
                        RaceLogic.shouldShowPreviousResults(prevRd, raceDay, race)
                    if (prevRd != null && race != null && (showPrevExternal || showPrevInhouse)) {
                        item {
                            PreviousResultsSection(
                                race = race,
                                prevRaceDay = prevRd,
                                onInhouseTap = if (showPrevInhouse) {
                                    // "Así está la carrera" → abre en la General (GC) de la
                                    // etapa anterior, no en su clasificación de etapa.
                                    { navController.navigate(Routes.results(race.id, s.data.prevResultsStageNumber, classKind = "gc", suffix = prevRd.stageSuffix)) }
                                } else null,
                                onLinkTap = { url ->
                                    openExternal(context, url) { offlineAlert = it }
                                },
                            )
                        }
                    }

                    // Bloque "Resultados" de la etapa actual: una sola tarjeta con
                    // el CTA in-house arriba (si lo hay) y FC/PCS como "También en"
                    // debajo — mismo patrón que "Así está la carrera" y que
                    // jornada.js (web). Sin in-house → FC/PCS clásicos.
                    val showResults = RaceLogic.shouldShowResultsDetail(raceDay, race)
                    if (race != null && (showResults || hasInhouse)) {
                        item {
                            ResultsButtonsCard(
                                titleRes = R.string.stage_section_results,
                                fcUrl = RaceLogic.buildFcUrl(race, raceDay.stageNumber),
                                pcsUrl = RaceLogic.buildPcsUrl(race, raceDay.stageNumber, raceDay.stageSuffix),
                                onInhouseTap = if (hasInhouse) {
                                    { navController.navigate(Routes.results(race.id, s.data.resultsStageNumber, suffix = raceDay.stageSuffix)) }
                                } else null,
                                onLinkTap = { url ->
                                    openExternal(context, url) { offlineAlert = it }
                                },
                            )
                        }
                    }

                    // Cancelada → nada de emisión EN DIRECTO (no se corrió), pero
                    // SÍ el "Revive" si existe: una etapa cancelada en carrera puede
                    // tener vídeo de lo que sí se disputó (Qinghai E6 y su broadcast
                    // showInRevive curado). BroadcastSection ya se queda solo con los
                    // de Revive cuando la jornada ha concluido. Paridad con la web.
                    val cancelledWithoutRevive = s.data.raceDay.isCancelledDay &&
                        s.data.broadcasts.none { isReviveBroadcast(it) }
                    if (s.data.broadcasts.isNotEmpty() && !cancelledWithoutRevive) {
                        item {
                            BroadcastSection(
                                raceDay = s.data.raceDay,
                                race = race,
                                broadcasts = s.data.broadcasts,
                                onExternalLinkTap = { url ->
                                    openExternal(context, url) { offlineAlert = it }
                                },
                            )
                        }
                    }

                    s.data.raceDay.localizedDescription?.takeIf { it.isNotEmpty() }?.let { desc ->
                        item {
                            DescriptionCard(
                                title = stringResource(R.string.stage_section_description),
                                body = desc,
                                showAutoTranslationNotice = s.data.raceDay.isDescriptionAutoTranslated,
                            )
                        }
                    }

                    val rd = s.data.raceDay
                    val localizedBonuses = rd.localizedBonuses
                    val localizedNotes = rd.localizedNotes
                    val hasBonuses = !localizedBonuses.isNullOrEmpty()
                    val hasNotes = !localizedNotes.isNullOrEmpty()
                    if (hasBonuses || hasNotes) {
                        item { BonusesNotesCard(bonuses = localizedBonuses, notes = localizedNotes) }
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
    val broadcasts = RaceLogic.filterBroadcastsByRegion(
        app.database.broadcastsDao()
            .getByRaceDay(stageId).map { it.toModel() },
        app.preferences.snapshotRegionPreference().allowedBroadcastGroups,
    ).sortedBy { it.sortOrder }
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
    // El gate llega antes de publicar StageData: así la tarjeta no aparece con
    // FC/PCS y se transforma después en "Ver clasificaciones".
    val navigable = siblings
        .filter { !it.isRestDay && !it.isCancelledDay }
        .sortedWith(compareBy({ it.stageNumber ?: Int.MAX_VALUE }, { it.dateKey }))
    val previous = navigable.indexOfFirst { it.id == latest.id }
        .takeIf { it > 0 }
        ?.let { navigable[it - 1] }
    val inhouseByDay = latest.raceId?.let { rid ->
        val days = listOfNotNull(
            latest.takeUnless { it.isCancelledDay }?.let { it.id to it.stageNumber },
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
        assets = assets,
        hasStartlist = hasStartlist,
        siblings = siblings,
        hasInhouseResults = inhouseByDay.containsKey(latest.id) || latest.isCancelledDay,
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
private fun prefersNativeApp(url: String): Boolean {
    val lower = url.lowercase()
    return lower.contains("youtube.com") || lower.contains("youtu.be") ||
        lower.contains("hbomax.com") || lower.contains("play.max.com") ||
        lower.contains("x.com") || lower.contains("twitter.com")
}

private fun openExternal(
    context: Context,
    url: String,
    showAlert: (OfflineAccessAlert) -> Unit,
) {
    if (!NetworkMonitor.isOnline(context)) {
        showAlert(OfflineAccessAlert.ExternalLinkOffline)
        return
    }
    runCatching {
        val uri = url.toUri()
        if (prefersNativeApp(url)) {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, uri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        } else {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, uri)
        }
    }
}

// ACTION_INSERT para que el evento entre al calendario primario sin permisos
// y sin la latencia/visibilidad oculta del flujo `?cid=` (que suscribe el .ics).
private fun addStageToCalendar(context: Context, race: Race?, rd: RaceDay) {
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
private fun SectionCard(content: @Composable () -> Unit) {
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
private fun SectionTitle(text: String) {
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
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun StageInfoBlock(
    raceDay: RaceDay,
    race: Race?,
    onBack: () -> Unit,
    onRaceTap: (() -> Unit)? = null,
) {
    val rd = raceDay
    val hasStageLabel = rd.stageLabel.isNotEmpty()

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
        if (race != null) {
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
                        if (!race.hideFlag || rd.countryCode != null) {
                            CountryFlag(countryCode = rd.countryCode ?: race.countryCode)
                        }
                        Text(
                            text = race.localizedName,
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
                    CategoryBadge(category = race.uciCategory)
                }
                RaceLogo(url = race.logoUrl, size = 36.dp)
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
                text = rd.stageLabel,
                style = MaterialTheme.typography.titleMedium,
                // Peso igualado al titular del cintillo (Medium, no Bold).
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            // La cabecera de etapa va en el idioma del CONTENIDO (igual que el
            // nombre de carrera, la ruta y el km), no en el del chrome de la UI.
            text = DateFormatting.formatDateLongContent(rd.dateKey),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    rd.routeDescription?.let { route ->
        Column {
            Text(
                text = route,
                style = MaterialTheme.typography.bodyMedium,
                // Peso igualado al titular del cintillo (Medium, no SemiBold).
                fontWeight = FontWeight.Medium,
            )
            if (rd.isSingleCity) {
                Text(
                    text = stringResource(R.string.stage_label_start_finish),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
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
) {
    val rd = data.raceDay
    val race = data.race
    val context = LocalContext.current
    val app = rememberApp()
    // Jornada cancelada: no hay carrera que seguir en directo → fuera el Live
    // Texto. La documentación del recorrido (rutómetro/perfil/mapa) SÍ se
    // conserva: describe la etapa que estaba trazada, no su seguimiento.
    // Espejo del filtro de `buildActionButtons` en la web.
    val assets = if (rd.isCancelledDay) data.assets.filter { it.type != "live_text" } else data.assets
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
    val hasICalSubscribe = !rd.slug.isNullOrEmpty() && !rd.isRestDay && !rd.isCancelledDay
    val followedStageIds by app.preferences.followedStageIds.collectAsState(initial = emptySet())
    // El control debe seguir visible aunque el usuario todavía no haya activado
    // los permisos: es el punto de entrada para personalizar esta jornada.
    val showNotifChip = !rd.isRestDay && !rd.isCancelledDay
    val hasDocs = hasGpxProfile || hasRouteMap || assets.isNotEmpty() || data.hasStartlist || !race?.websiteUrl.isNullOrEmpty() || hasICalSubscribe || showNotifChip
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

                    // Assets desde "profile" en adelante (ports, map, live_text;
                    // el profile estático se renderiza arriba como "Perfil oficial")
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

            SimplifiedGuideSection(rd)
        }
    }
}

// ─── Guía simplificada de horarios de paso (despliegue inline) ─────
@Composable
private fun SimplifiedGuideSection(rd: RaceDay) {
    val rows = remember(rd.id) {
        SimplifiedGuide.build(
            distanceKm = rd.distanceKm ?: rd.elevationProfile?.distance,
            neutralStartTimeUtc = rd.neutralStartTimeUtc,
            estimatedFinishTimeUtc = rd.estimatedFinishTimeUtc,
            summits = rd.profileSummits ?: emptyList(),
            waypoints = rd.profileWaypoints ?: emptyList(),
            primaryType = rd.primaryType,
        )
    }
    if (!SimplifiedGuide.hasGuide(rows)) return

    var expanded by remember(rd.id) { mutableStateOf(false) }
    HorizontalDivider()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { expanded = !expanded }
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.stage_guide_open),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.weight(1f),
        )
        Icon(
            imageVector = if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
        )
    }
    AnimatedVisibility(visible = expanded) {
        Column {
            rows.forEach { GuideRowItem(it) }
            if (rows.any { it.isEstimated && it.timeUtc != null }) {
                Text(
                    text = stringResource(R.string.stage_guide_estimated_note),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun GuideRowItem(row: GuideRow) {
    val timeStr = row.timeUtc?.let { DateFormatting.formatTimeLocal(it) } ?: "—"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(modifier = Modifier.width(54.dp)) {
            Text(
                text = timeStr,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            if (row.isEstimated && row.timeUtc != null) {
                Text(
                    text = "*",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        GuideMarker(
            row = row,
            modifier = Modifier
                .padding(start = 6.dp, end = 10.dp)
                .size(20.dp),
        )
        Text(
            text = guideRowLabel(row),
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        row.kmToGo?.let { km ->
            // A ≤0.5 km de meta (o en la propia meta) → "Meta", igual que el
            // perfil interactivo. Cubre varios puntos cercanos y negativos por redondeo.
            val posText = if (km <= 0.5) stringResource(R.string.stage_guide_at_finish)
                          else stringResource(R.string.stage_guide_km_to_go, fmtKm(km))
            Text(
                text = posText,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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
 * salvo las categorías de puerto (HC/1..4/B/S), que van como texto centrado.
 * Espejo del `guideMarkerSVG` de la web (js/elevation-profile.js).
 */
@Composable
private fun GuideMarker(row: GuideRow, modifier: Modifier = Modifier) {
    val circleColor = guideMarkerColor(row.type)
    // Categoría de puerto o letra de sprint/bonif → texto centrado.
    val letter: String? = when (row.type) {
        "summit" -> row.category?.takeIf { it != "M" }
        "intermediate_sprint" -> "S"
        "bonus_sprint" -> "B"
        else -> null
    }
    val letterColor = if (row.type == "bonus_sprint") Color.Black else Color.White
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
                when (row.type) {
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
                    "summit" -> {
                        // Montaña (categoría M / sin categoría): silueta de dos picos.
                        val path = androidx.compose.ui.graphics.Path().apply {
                            moveTo(cx - 7f * u, cy + 3f * u)
                            lineTo(cx - 3f * u, cy - 4.5f * u)
                            lineTo(cx, cy - 0.5f * u)
                            lineTo(cx + 3f * u, cy - 5f * u)
                            lineTo(cx + 7f * u, cy + 3f * u)
                            close()
                        }
                        drawPath(path, white)
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
private fun guideRowLabel(row: GuideRow): String = when (row.type) {
    "start" -> stringResource(R.string.stage_guide_start)
    "finish" -> stringResource(R.string.stage_guide_finish)
    "climb_foot" -> row.label?.let { stringResource(R.string.stage_guide_climb_foot, it) }
        ?: stringResource(R.string.stage_guide_climb_foot_generic)
    "summit" -> row.label ?: stringResource(R.string.stage_guide_summit)
    "intermediate_sprint" -> row.label ?: stringResource(R.string.stage_guide_intermediate_sprint)
    "bonus_sprint" -> row.label ?: stringResource(R.string.stage_guide_bonus_sprint)
    "intermediate_split" -> row.label ?: stringResource(R.string.stage_guide_intermediate_split)
    "cobblestone" -> row.label ?: stringResource(R.string.stage_guide_cobblestone)
    "sterrato" -> row.label ?: stringResource(R.string.stage_guide_sterrato)
    "town" -> row.label ?: stringResource(R.string.stage_guide_town)
    else -> row.label ?: row.type
}

// Formatea un km de la guía con el separador decimal del IDIOMA DE CONTENIDO
// (ES → coma, EN → punto), igual que `RaceDay.distanceFormatted`. Espejo de la
// web (_fmtGuideKm) e iOS (fmtKm).
private fun fmtKm(d: Double): String {
    if (d == Math.floor(d)) return d.toInt().toString()
    val raw = String.format(java.util.Locale.US, "%.1f", d) // siempre con '.'
    return if (LocaleHolder.shouldShowEnglishContent) raw else raw.replace('.', ',')
}

// ─── Resultados / Así está la carrera (bloque unificado) ──────────

/**
 * Tarjeta de botones de resultados, compartida por "Resultados" (etapa actual)
 * y "Así está la carrera" (etapa anterior). UNA sola tarjeta: si hay
 * clasificaciones in-house (`onInhouseTap != null`), el CTA primario "Ver
 * clasificaciones" va arriba y FC/PCS quedan como respaldo discreto bajo
 * "También en"; sin in-house, FC/PCS son los botones principales. Espejo de
 * `resultsButtonsHtml` en jornada.js (web), que también los agrupa.
 */
@Composable
private fun ResultsButtonsCard(
    titleRes: Int,
    fcUrl: String?,
    pcsUrl: String?,
    onLinkTap: (String) -> Unit,
    onInhouseTap: (() -> Unit)? = null,
) {
    // Sin in-house y sin FC/PCS no hay nada que mostrar. Con in-house, el CTA
    // primario se muestra aunque FC/PCS falten.
    if (onInhouseTap == null && fcUrl == null && pcsUrl == null) return

    val primary = MaterialTheme.colorScheme.primary
    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionTitle(stringResource(titleRes))

            if (onInhouseTap != null) {
                // CTA primario → pantalla nativa de clasificaciones.
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(primary, RoundedCornerShape(3))
                        .clickable(role = Role.Button) { onInhouseTap() }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                ) {
                    Text(
                        text = stringResource(R.string.results_cta),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                }
                // FC/PCS de respaldo discreto bajo "También en".
                if (fcUrl != null || pcsUrl != null) {
                    Text(
                        text = stringResource(R.string.results_also_on),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (fcUrl != null || pcsUrl != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    fcUrl?.let { url ->
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .weight(1f)
                                .background(primary.copy(alpha = 0.1f), RoundedCornerShape(3))
                                .clickable(role = Role.Button, onClickLabel = "FirstCycling") { onLinkTap(url) }
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                        ) {
                            Text(
                                text = "FirstCycling",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Medium,
                                color = primary,
                            )
                        }
                    }
                    pcsUrl?.let { url ->
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .weight(1f)
                                .background(primary.copy(alpha = 0.1f), RoundedCornerShape(3))
                                .clickable(role = Role.Button, onClickLabel = "ProCyclingStats") { onLinkTap(url) }
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                        ) {
                            Text(
                                text = "ProCyclingStats",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Medium,
                                color = primary,
                            )
                        }
                    }
                }
            }
        }
    }
}

// ─── Así está la carrera (resultados etapa anterior) ─────────────

/** "Así está la carrera": resultados de la etapa anterior. Delega en la tarjeta
 *  unificada [ResultsButtonsCard] (in-house → CTA nativo + FC/PCS de respaldo). */
@Composable
private fun PreviousResultsSection(
    race: Race,
    prevRaceDay: RaceDay,
    onLinkTap: (String) -> Unit,
    onInhouseTap: (() -> Unit)? = null,
) {
    ResultsButtonsCard(
        titleRes = R.string.stage_section_previous_results,
        fcUrl = RaceLogic.buildFcUrl(race, prevRaceDay.stageNumber),
        pcsUrl = RaceLogic.buildPcsUrl(race, prevRaceDay.stageNumber, prevRaceDay.stageSuffix),
        onLinkTap = onLinkTap,
        onInhouseTap = onInhouseTap,
    )
}

// ─── Retransmisión / Revive ───────────────────────────────────────

private fun isReviveBroadcast(b: Broadcast): Boolean {
    val url = b.url?.takeIf { it.isNotEmpty() } ?: return false
    if (b.showInRevive) return true
    val ch = (b.channel ?: "").lowercase()
    return ch.contains("eurosport") || ch.contains("hbo max") ||
        url.lowercase().contains("youtube.com") || url.lowercase().contains("youtu.be")
}

@Composable
private fun BroadcastSection(
    raceDay: RaceDay,
    race: Race?,
    broadcasts: List<Broadcast>,
    onExternalLinkTap: (String) -> Unit,
) {
    val primary = MaterialTheme.colorScheme.primary

    // T+30: filtrar a Eurosport/HBO Max/YouTube y cambiar título a "Revive".
    // Una jornada CANCELADA no espera al T+30: ya no habrá directo, así que si
    // tiene vídeo de lo que se disputó, se muestra como "Revive" desde el
    // momento en que se marca como cancelada (paridad con la web).
    val hasReviveBroadcast = broadcasts.isNotEmpty() &&
        (raceDay.isCancelledDay ||
            (raceDay.estimatedFinishTimeUtc != null && RaceLogic.raceTimeCheck(raceDay, 30))) &&
        broadcasts.any { isReviveBroadcast(it) }

    val visibleBroadcasts = if (hasReviveBroadcast)
        broadcasts.filter { isReviveBroadcast(it) }
    else
        broadcasts

    val title = if (hasReviveBroadcast) {
        if (race?.isOneDay == true) stringResource(R.string.stage_section_broadcast_revive_one_day)
        else stringResource(R.string.stage_section_broadcast_revive_stage)
    } else {
        stringResource(R.string.stage_section_broadcast)
    }

    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                SectionTitle(title)
                // Mismo chip de Hoy. En Jornada se mantiene visible aunque ya
                // exista un canal provisional o Live texto.
                if (!hasReviveBroadcast && raceDay.tvStatus == "pending") {
                    TVBadge(tvStatus = "pending", broadcasts = emptyList())
                }
            }
            Spacer(Modifier.height(4.dp))
            visibleBroadcasts.forEach { b ->
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
                        val channelLine = buildString {
                            append(b.channel ?: channelFallback)
                            if (!hasReviveBroadcast) {
                                b.startTimeLocal?.let { append("  ·  $it") }
                            }
                        }
                        Text(
                            text = channelLine,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        if (!hasReviveBroadcast || b.showInRevive) {
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
                            imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                            contentDescription = stringResource(R.string.stage_action_open_link_cd),
                            tint = primary,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
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
    val assets: List<Asset>,
    val hasStartlist: Boolean = false,
    val siblings: List<RaceDay> = emptyList(),
    val hasInhouseResults: Boolean = false,
    val resultsStageNumber: Int? = null,
    val prevHasInhouse: Boolean = false,
    val prevResultsStageNumber: Int? = null,
)

private sealed class StageState {
    data object Loading : StageState()
    data class Error(val message: String) : StageState()
    data class Ready(val data: StageData) : StageState()
}
