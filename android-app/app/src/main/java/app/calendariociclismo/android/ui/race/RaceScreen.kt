package app.calendariociclismo.android.ui.race

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.LocalContext
import androidx.core.net.toUri
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.prefs.RaceFollowMode
import app.calendariociclismo.android.ui.components.AssetChip
import app.calendariociclismo.android.ui.components.AssetActionStrip
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CategoryBadge
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.MiniElevationProfile
import app.calendariociclismo.android.ui.components.StageTypeBadge
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.theme.colorFromHex
import app.calendariociclismo.android.data.premium.PremiumService
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.ui.today.ResultsDialog
import app.calendariociclismo.android.ui.today.ResultsDialogItem
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.launch

/**
 * Detalle de carrera — equivalente a `RaceDetailView.swift`.
 *
 * Muestra cabecera con logo, nombre, bandera, categoría y rango de fechas,
 * seguida de una lista de etapas (o estado vacío si aún no hay jornadas).
 */
@Composable
fun RaceScreen(raceId: String, navController: NavController) {
    val app = rememberApp()
    var state by remember { mutableStateOf<RaceState>(RaceState.Loading) }
    // Etapa cuyo diálogo de resultados (FirstCycling / PCS) está abierto.
    var resultsDialogItem by remember { mutableStateOf<ResultsDialogItem?>(null) }
    val context = LocalContext.current
    val networkErrorFallback = stringResource(R.string.startlist_error_unknown)
    LaunchedEffect(raceId) {
        state = RaceState.Loading
        runCatching { app.repository.refreshRaceComplete(raceId) }
            .onSuccess { (race, days) -> state = RaceState.Ready(race, days) }
            .onFailure { state = RaceState.Error(it.message ?: networkErrorFallback) }
    }

    // Analytics: paridad con iOS — race_id + race_name. Se dispara cuando
    // state pasa a Ready (no en LaunchedEffect(raceId)) porque necesitamos
    // race.name. Ver docs/memory/analytics.md.
    LaunchedEffect(state) {
        val ready = state as? RaceState.Ready ?: return@LaunchedEffect
        app.analytics.logScreenView(
            "race_detail",
            android.os.Bundle().apply {
                putString("race_id", raceId)
                putString("race_name", ready.race.name)
            },
        )
    }

    // Jornadas con resultados in-house (raceDayId → stageNumber): el trofeo de
    // esas etapas navega a la pantalla nativa de clasificaciones en vez del modal
    // FC/PCS. Diferido y no bloqueante (sin red → vacío → modal clásico). Pasa las
    // jornadas para resolver el caso de un día/general (stage sin raceDayId).
    var inhouseByDay by remember(raceId) { mutableStateOf<Map<String, Int?>>(emptyMap()) }
    LaunchedEffect(state) {
        val ready = state as? RaceState.Ready ?: return@LaunchedEffect
        val days = ready.days.map { it.raceDay.id to it.raceDay.stageNumber }
        val cancelled = ready.days.filter { it.raceDay.isCancelledDay }.map { it.raceDay.id }.toSet()
        inhouseByDay = runCatching { app.repository.inhouseStagesForDays(raceId, days, cancelled) }.getOrDefault(emptyMap())
    }

    Scaffold { padding ->
        when (val s = state) {
            RaceState.Loading -> {
                val loadingCd = stringResource(R.string.loading)
                Box(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator(modifier = Modifier.semantics { contentDescription = loadingCd }) }
            }
            is RaceState.Error -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { Text(s.message, color = MaterialTheme.colorScheme.error) }
            is RaceState.Ready -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                @OptIn(ExperimentalFoundationApi::class)
                stickyHeader(key = "header") {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.background)
                            .padding(top = 8.dp),
                    ) {
                        RaceHeader(
                            race = s.race,
                            stageCount = s.days.count { !it.raceDay.isRestDay },
                            onBack = { navController.popBackStack() },
                        )
                    }
                }

                item(key = "docchips") {
                    // Padding inferior extra para separar la primera tarjeta de
                    // etapa del encabezado (logo + datos + chips de documentación).
                    Box(modifier = Modifier.padding(bottom = 6.dp)) {
                        RaceDocumentationChips(
                            race = s.race,
                            days = s.days,
                            navController = navController,
                        )
                    }
                }

                if (s.days.isEmpty()) {
                    item { EmptyStagesState() }
                } else {
                    itemsIndexed(s.days, key = { _, it -> it.id }) { index, day ->
                        // Resultados/Revive cuando la etapa ya terminó (mismo
                        // criterio que "Hoy").
                        // In-house: si esta jornada tiene clasificación propia, el
                        // trofeo va a la pantalla nativa (no al modal FC/PCS).
                        val inhouseStage = inhouseByDay[day.id]
                        val hasInhouse = inhouseByDay.containsKey(day.id)
                        val showResults = hasInhouse || RaceLogic.shouldShowResults(day.raceDay, s.race)
                        val hideNoIds = !showResults && RaceLogic.noIdsAndPastDeadline(day.raceDay, s.race)
                        val reviveUrl = if (showResults || hideNoIds) RaceLogic.reviveUrl(day.broadcasts) else null
                        StageRow(
                                day = day,
                                race = s.race,
                                onClick = {
                                    // La cancelada SÍ navega a su ficha (paridad
                                    // con la web): conserva recorrido, perfil y
                                    // documentación. El descanso no tiene ficha.
                                    if (!day.raceDay.isRestDay) {
                                        navController.navigate(Routes.stage(day.id))
                                    }
                                },
                                onShowResults = if (showResults) {
                                    {
                                        if (hasInhouse) {
                                            navController.navigate(Routes.results(s.race.id, inhouseStage, suffix = day.raceDay.stageSuffix))
                                        } else {
                                            resultsDialogItem = ResultsDialogItem(s.race, day.raceDay)
                                        }
                                    }
                                } else null,
                                onRevive = reviveUrl?.let { url ->
                                    {
                                        runCatching {
                                            context.startActivity(
                                                Intent(Intent.ACTION_VIEW, url.toUri()).apply {
                                                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                                }
                                            )
                                        }
                                    }
                                },
                        )
                    }
                }
            }
        }
    }

    resultsDialogItem?.let { item ->
        ResultsDialog(
            item = item,
            context = context,
            onDismiss = { resultsDialogItem = null },
        )
    }
}

@Composable
private fun RaceHeader(race: Race, stageCount: Int, onBack: () -> Unit) {
    val context = LocalContext.current
    // Cabecera neutra (sin tinte de marca) en CCCard, igual que las secciones
    // del detalle de jornada. El color de la carrera vive en logo y badges.
    CCCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 12,
    ) {
      Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
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
                    contentDescription = stringResource(R.string.action_back),
                    modifier = Modifier.size(18.dp),
                )
            }
            RaceLogo(url = race.logoUrl, size = 44.dp)
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (!race.hideFlag) {
                        CountryFlag(countryCode = race.countryCode)
                    }
                    Text(
                        text = race.localizedName,
                        style = MaterialTheme.typography.titleLarge,
                        // Peso igualado al titular del cintillo (Medium, no Bold).
                        fontWeight = FontWeight.Medium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (RaceLogic.shouldShowFemaleIndicator(race)) {
                        val femaleCd = stringResource(R.string.season_female_indicator_cd)
                        Text(
                            text = "♀",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.tertiary,
                            modifier = Modifier.semantics { contentDescription = femaleCd },
                        )
                    }
                }
            }
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CategoryBadge(category = race.uciCategory)
            val showStageCount = race.isStageRace && stageCount > 0
            if (showStageCount) {
                Text(
                    text = stringResource(R.string.race_label_stages_count, stageCount),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val range = DateFormatting.formatDateRange(race.startDate, race.endDate)
            if (range.isNotEmpty()) {
                if (showStageCount) {
                    Text(
                        text = "·",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    text = range,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (race.isCancelled) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Cancel,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    text = stringResource(R.string.race_label_cancelled),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }

      }
    }
}

@Composable
private fun RaceDocumentationChips(
    race: Race,
    days: List<EnrichedRaceDay>,
    navController: NavController,
) {
    val context = LocalContext.current
    val app = rememberApp()
    val scope = rememberCoroutineScope()

    val raceFollowMode by app.preferences.raceFollowMode.collectAsState(initial = RaceFollowMode.FOLLOW_ALL)
    val followedRaceIds by app.preferences.followedRaceIds.collectAsState(initial = emptySet())

    val isFollowing = race.id in followedRaceIds
    var showModeAlert by remember { mutableStateOf(false) }

    val hasWebsite = !race.websiteUrl.isNullOrEmpty()
    val technicalGuide = days.asSequence().flatMap { it.assets.asSequence() }
        .firstOrNull { it.type == "technicalGuide" && !it.url.isNullOrEmpty() }
    val hasStartlist = race.startlistImportedAt != null
    // La acción de seguimiento es también la puerta de entrada a las
    // notificaciones, por lo que no se oculta antes de conceder permisos.
    val showNotifications = true

    if (!hasWebsite && technicalGuide == null && !hasStartlist && !showNotifications) return

    AssetActionStrip {
        if (hasWebsite) {
            AssetChip(
                icon = Icons.Outlined.Language,
                label = stringResource(R.string.stage_doc_web_official),
                onClick = {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, race.websiteUrl!!.toUri())
                                .apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                        )
                    }
                },
            )
        }
        technicalGuide?.let { guide ->
            AssetChip(
                icon = Icons.Filled.Description,
                label = stringResource(R.string.asset_technical_guide),
                onClick = {
                    runCatching {
                        CustomTabsIntent.Builder()
                            .setShowTitle(true)
                            .build()
                            .launchUrl(context, guide.url!!.toUri())
                    }
                },
            )
        }
        if (hasStartlist) {
            AssetChip(
                icon = Icons.Outlined.People,
                label = when {
                    race.startlistProvisional -> stringResource(R.string.stage_doc_startlist_provisional)
                    race.isFemale -> stringResource(R.string.race_startlist_female)
                    else -> stringResource(R.string.race_startlist)
                },
                onClick = { navController.navigate(Routes.startlist(race.id)) },
            )
        }
        if (showNotifications) {
            // Notificaciones enriquecidas liberadas al plan gratuito: sin paywall.
            // Mismo estilo que AssetChip / StageNotificationChip (no AssistChip de
            // Material3, que rompía la paridad visual con los chips contiguos).
            RaceNotificationChip(
                isFollowing = isFollowing,
                onClick = {
                    when (raceFollowMode) {
                        RaceFollowMode.FOLLOW_ALL -> showModeAlert = true
                        else -> scope.launch {
                            val newIds = if (isFollowing) followedRaceIds - race.id else followedRaceIds + race.id
                            app.preferences.setFollowedRaceIds(newIds)
                            app.pushManager.syncCategories()
                        }
                    }
                },
            )
        }
    }

    if (showModeAlert) {
        AlertDialog(
            onDismissRequest = { showModeAlert = false },
            title = { Text(stringResource(R.string.race_notifications_mode_title)) },
            text = { Text(stringResource(R.string.race_notifications_mode_body)) },
            confirmButton = {
                TextButton(onClick = {
                    showModeAlert = false
                    scope.launch {
                        app.preferences.setRaceFollowMode(RaceFollowMode.FOLLOW_RACES)
                        app.preferences.setFollowedRaceIds(followedRaceIds + race.id)
                        app.pushManager.syncCategories()
                    }
                }) { Text(stringResource(R.string.race_notifications_mode_only_this)) }
            },
            dismissButton = {
                TextButton(onClick = { showModeAlert = false }) {
                    Text(stringResource(R.string.race_notifications_mode_keep_all))
                }
            },
        )
    }
}

/**
 * Chip de notificaciones de la carrera. Estilo idéntico a [AssetChip] y a
 * `StageNotificationChip` (StageScreen): misma celda azul tenue, icono 14dp y
 * texto de una línea con truncado.
 *
 * Antes usaba `AssistChip` (Material3), que tenía altura, radio de esquina y
 * colores distintos a los chips contiguos ("Web oficial", "Inscritos") y
 * rompía la paridad visual. La decisión de seguir/parar la toma el llamador.
 */
@Composable
private fun RaceNotificationChip(isFollowing: Boolean, onClick: () -> Unit) {
    val haptic = rememberHaptics()
    val label = stringResource(R.string.race_notifications)
    val icon = if (isFollowing) Icons.Filled.Notifications else Icons.Outlined.NotificationsNone

    AssetChip(
        icon = icon,
        label = label,
        onClick = {
            haptic(Haptics.Event.Selection)
            onClick()
        },
        showTrailingSeparator = false,
    )
}

@Composable
private fun StageRow(
    day: EnrichedRaceDay,
    race: Race?,
    onClick: () -> Unit,
    onShowResults: (() -> Unit)? = null,
    onRevive: (() -> Unit)? = null,
) {
    val rd = day.raceDay
    // La jornada cancelada NO se atenúa ni deja de ser pulsable: el aviso
    // "Etapa cancelada" ya lo dice, y su ficha (recorrido, perfil, rutómetro,
    // documentación) sigue siendo accesible — igual que en la web. Solo la
    // jornada de DESCANSO queda inerte: no tiene ficha que abrir.
    val isInteractive = !rd.isRestDay
    // Modo terminado: hay resultados o revive. Igual que en "Hoy" (y la web),
    // cambia el accesorio derecho (chevron → iconos) y completa el miniperfil.
    val isFinishedMode = onShowResults != null || onRevive != null

    val app = rememberApp()
    // Mini-perfil liberado al plan gratuito: visible siempre (featuresUnlocked).
    val featuresUnlocked = app.premium.featuresUnlocked
    val tint = colorFromHex(race?.colorHex, fallback = MaterialTheme.colorScheme.outlineVariant)
    val showsMiniProfile = featuresUnlocked && !rd.isRestDay && !rd.isCancelledDay &&
        rd.elevationProfile?.points?.let { it.size >= 2 } == true

    // Tarjeta canónica (CCCard) por etapa — paridad con el cintillo "Hoy" y la
    // web. El mini-perfil va como franja a sangre al fondo de la tarjeta.
    CCCard(
        accent = race?.colorHex?.let { colorFromHex(it, fallback = MaterialTheme.colorScheme.outlineVariant) },
        accentAlpha = 0.04f,
        modifier = Modifier
            .fillMaxWidth(),
    ) {
      Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (isInteractive) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier),
      ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                // El contenido cede el borde inferior a la franja de perfil
                // cuando ésta se muestra (llega de lado a lado de la tarjeta).
                .padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = if (showsMiniProfile) 8.dp else 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
        // Columna del número de etapa / icono descanso / cancelada
        Box(
            modifier = Modifier.width(36.dp),
            contentAlignment = Alignment.Center,
        ) {
            when {
                rd.isRestDay -> Icon(
                    imageVector = Icons.Outlined.Bedtime,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
                rd.isCancelledDay -> Icon(
                    imageVector = Icons.Filled.Cancel,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(18.dp),
                )
                else -> Text(
                    text = rd.stageLabelShort.ifEmpty { "—" },
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            if (rd.isRestDay) {
                Text(
                    text = stringResource(R.string.race_stage_rest_day),
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = DateFormatting.formatDateShort(rd.dateKey),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(
                    text = DateFormatting.formatDateShort(rd.dateKey),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                rd.routeDescription?.takeIf { it.isNotEmpty() }?.let { route ->
                    Text(
                        text = route,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                // FlowRow: badge + métricas en una sola línea cuando caben; si el
                // badge es ancho (p. ej. "Cronoescalada") y no cabe todo, las
                // métricas saltan completas a la línea siguiente en lugar de que
                // el desnivel se parta a mitad ("+7" / "50" / "m"). Cada métrica
                // usa espacios duros ( ) para no romperse internamente.
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (rd.isCancelledDay) {
                        Text(
                            text = stringResource(R.string.race_stage_cancelled),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.error,
                            // El badge de tipo lleva fondo + padding vertical
                            // propio; este texto va pelado. Sin centrarlo, queda
                            // alto respecto al badge y a las métricas.
                            modifier = Modifier.align(Alignment.CenterVertically),
                        )
                    } else if (!showsMiniProfile || rd.primaryType == "itt" || rd.primaryType == "ttt") {
                        StageTypeBadge(
                            primaryType = rd.primaryType,
                            secondaryType = rd.secondaryType,
                            countryCode = rd.countryCode ?: race?.countryCode,
                        )
                    }
                    val dist = rd.distanceFormatted
                    val elev = rd.elevationGainFormatted
                    val metrics = listOfNotNull(dist, elev)
                        .joinToString("  ·  ")
                        .replace(' ', ' ')
                        .takeIf { it.isNotEmpty() }
                    metrics?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            softWrap = false,
                        )
                    }
                }
                // El mini-perfil va como franja a sangre al fondo de la tarjeta
                // (ver más abajo), no inline en la columna.
            }
        }

        if (isFinishedMode) {
            Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                onShowResults?.let { action ->
                    IconButton(onClick = action) {
                        Icon(
                            imageVector = Icons.Outlined.EmojiEvents,
                            contentDescription = stringResource(R.string.today_results_cd),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }
                onRevive?.let { action ->
                    IconButton(onClick = action) {
                        Icon(
                            imageVector = Icons.Outlined.Tv,
                            contentDescription = stringResource(R.string.today_revive_cd),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }
            }
        } else if (isInteractive) {
            Icon(
                imageVector = Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.outline,
            )
        } else {
            Spacer(modifier = Modifier.width(24.dp))
        }
        }

        if (showsMiniProfile) {
            rd.elevationProfile?.let { profile ->
                MiniElevationProfile(
                    profile = profile,
                    tint = tint,
                    height = miniProfileBandHeight(rd.primaryType),
                    summits = rd.profileSummits.orEmpty(),
                    waypoints = rd.profileWaypoints.orEmpty(),
                    primaryType = rd.primaryType,
                    startTimeMs = rd.neutralStartTimeUtc?.let { DateFormatting.parseIso(it)?.toEpochMilli() },
                    endTimeMs = rd.estimatedFinishTimeUtc?.let { DateFormatting.parseIso(it)?.toEpochMilli() },
                    isTimeTrial = rd.primaryType == "itt" || rd.primaryType == "ttt",
                    usesLineFallbackWithoutTimeTrialSchedule = true,
                    forceCompleted = isFinishedMode,
                )
            }
        }
      }
    }
}

@Composable
private fun EmptyStagesState() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .height(180.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(R.string.race_empty_no_stages_title),
            style = MaterialTheme.typography.titleMedium,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = stringResource(R.string.race_empty_no_stages_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun miniProfileBandHeight(primaryType: String?) = when (primaryType) {
    "high_mountain", "summit_finish", "chrono_climb" -> 54.dp
    "medium_mountain" -> 46.dp
    "cotas", "uphill_finish", "rolling", "cobbles", "sterrato" -> 40.dp
    else -> 34.dp
}

private sealed class RaceState {
    data object Loading : RaceState()
    data class Error(val message: String) : RaceState()
    data class Ready(val race: Race, val days: List<EnrichedRaceDay>) : RaceState()
}
