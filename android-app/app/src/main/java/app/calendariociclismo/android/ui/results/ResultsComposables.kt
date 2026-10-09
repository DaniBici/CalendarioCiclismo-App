package app.calendariociclismo.android.ui.results

import java.math.BigDecimal
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import kotlinx.coroutines.CoroutineScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.rememberHaptics
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceUciResultRow
import app.calendariociclismo.android.data.model.RaceUciStage
import app.calendariociclismo.android.data.model.RaceClassificationConfig
import app.calendariociclismo.android.data.model.ResolvedRider
import app.calendariociclismo.android.data.model.Team
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CC_CARD_ELEVATION
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.ui.theme.neutralFill
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.components.MiniElevationProfile
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.startlist.TeamColorBands
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.UciResultsLogic
import app.calendariociclismo.android.util.LocaleHolder

// ── Etiqueta de la pestaña de clasificación ────────────────────────
@Composable
internal fun classLabel(classKind: String): String = stringResource(
    when (classKind) {
        "stage" -> R.string.results_tab_stage
        "gc" -> R.string.results_tab_gc
        "points" -> R.string.results_tab_points
        "kom" -> R.string.results_tab_kom
        "youth" -> R.string.results_tab_youth
        "teams" -> R.string.results_tab_teams
        else -> R.string.results_tab_stage
    }
)

/** Header simple para clasificación final / carrera de un día sin raceDay. */
@Composable
internal fun ResultsPlainHeader(race: Race, onBack: () -> Unit) {
    CCCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack, modifier = Modifier.size(32.dp)) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.action_back),
                    modifier = Modifier.size(18.dp),
                )
            }
            if (!race.countryCode.isNullOrBlank()) CountryFlag(countryCode = race.countryCode)
            Text(
                race.localizedName,
                modifier = Modifier.weight(1f),
                style = CCText.S16,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (race.logoUrl != null) RaceLogo(url = race.logoUrl, size = 36.dp)
        }
    }
}

@Composable
internal fun ResultsStageContextCard(
    raceDay: RaceDay,
    race: Race,
    officialProfileUrl: String? = null,
    onOfficialProfileTap: (String) -> Unit = {},
    onProfileTap: () -> Unit,
) {
    val visibleOfficialProfileUrl = officialProfileUrl.takeUnless { raceDay.profileNotViewable }
    val hasMetrics = raceDay.distanceKm != null || raceDay.elevationProfile?.elevationGain != null ||
        raceDay.neutralStartTimeUtc != null || raceDay.averageSpeedKmh != null || raceDay.hasValidTimeLimit
    if (!raceDay.hasElevationProfile && visibleOfficialProfileUrl == null && !hasMetrics) return
    CCCard(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            raceDay.elevationProfile?.takeIf { raceDay.hasElevationProfile }?.let { profile ->
                Column(
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onProfileTap),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        LocaleHolder.t("Perfil y datos", "Profile and data"),
                        style = CCText.S16,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.semantics { heading() },
                    )
                    MiniElevationProfile(
                        profile = profile,
                        tint = race.colorHex?.let { app.calendariociclismo.android.ui.theme.colorFromHex(it) }
                            ?: MaterialTheme.colorScheme.primary,
                        height = 58.dp,
                        summits = raceDay.profileSummits.orEmpty(),
                        waypoints = raceDay.profileWaypoints.orEmpty(),
                        primaryType = raceDay.primaryType,
                        forceCompleted = true,
                    )
                }
            }
            visibleOfficialProfileUrl?.let { url ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOfficialProfileTap(url) }
                        .heightIn(min = 48.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        LocaleHolder.t("Perfil oficial", "Official profile"),
                        style = CCText.S14,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
                }
            }
            raceDay.distanceFormatted?.let {
                ResultsContextMetric(LocaleHolder.t("Distancia", "Distance"), it)
            }
            raceDay.elevationGainFormatted?.let {
                ResultsContextMetric(LocaleHolder.t("Desnivel", "Elevation gain"), it)
            }
            raceDay.neutralStartTimeUtc?.let { raw ->
                DateFormatting.formatTimeLocal(raw)?.let {
                    ResultsContextMetric(LocaleHolder.t("Salida neutralizada", "Neutral start"), it)
                }
            }
            raceDay.averageSpeedKmh?.takeIf { it > 0 }?.let {
                ResultsContextMetric(LocaleHolder.t("Velocidad media", "Average speed"), averageSpeedText(it))
            }
            if (raceDay.hasValidTimeLimit) RaceDay.formatDuration(raceDay.timeLimitSeconds)?.let {
                ResultsContextMetric(LocaleHolder.t("Fuera de control", "Time limit"), it)
            }
        }
    }
}

/** Velocidad media con los decimales del idioma (hasta dos), como la web. */
private fun averageSpeedText(value: Double): String {
    val locale = if (LocaleHolder.shouldShowEnglishContent) java.util.Locale.UK else java.util.Locale.forLanguageTag("es-ES")
    val format = java.text.NumberFormat.getNumberInstance(locale).apply {
        minimumFractionDigits = 0
        maximumFractionDigits = 2
    }
    return "${format.format(value)} km/h"
}

@Composable
private fun ResultsContextMetric(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = CCText.S14, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = CCText.S14.copy(fontFeatureSettings = "tnum"))
    }
}

/**
 * Selector de etapa: P · 1 · 2 · … · F, con `FilterChip` con el aspecto de los
 * filtros de Hoy (`.res-stage-btn`). Compartido con Ciclocross (categorías).
 */
@Composable
internal fun ResultsStageSelector(
    stageKeys: List<String>,
    activeKey: String?,
    isEn: Boolean,
    labelForKey: ((String) -> String)? = null,
    accessibilityLabelForKey: (@Composable (String) -> String)? = null,
    onSelect: (String?) -> Unit,
) {
    val finalLbl = stringResource(R.string.results_stage_final_short)
    val finalAccessibilityLabel = stringResource(R.string.results_stage_final_accessibility)
    val prologueAccessibilityLabel = stringResource(R.string.results_stage_prologue_accessibility)
    val animationsEnabled = android.animation.ValueAnimator.areAnimatorsEnabled()
    val listState = rememberLazyListState()
    val density = LocalDensity.current
    // Autoscroll: en etapas avanzadas (p. ej. la 18 de una Gran Vuelta) la
    // cápsula activa queda fuera de pantalla; la centramos al aparecer y cada
    // vez que cambia la etapa activa.
    val activeIndex = stageKeys.indexOf(activeKey).coerceAtLeast(0)
    LaunchedEffect(activeKey, stageKeys) {
        if (stageKeys.isEmpty()) return@LaunchedEffect
        snapshotFlow { listState.layoutInfo.viewportSize.width }.first { it > 0 }
        val viewportWidth = listState.layoutInfo.viewportSize.width
        val itemHalfWidthPx = with(density) { 16.dp.roundToPx() }
        val offset = -(viewportWidth / 2 - itemHalfWidthPx)
        if (animationsEnabled) {
            listState.animateScrollToItem(index = activeIndex, scrollOffset = offset)
        } else {
            listState.scrollToItem(index = activeIndex, scrollOffset = offset)
        }
    }
    LazyRow(
        state = listState,
        modifier = Modifier.fillMaxWidth(),
        // Cada elemento ya reserva 48 dp de objetivo táctil. No añadimos otro
        // hueco entre ellos para que el carril de etapas mantenga la densidad
        // visual de la web sin reducir su superficie accesible.
    ) {
        items(stageKeys, key = { it }) { key ->
            // 'final'→F · '0'→P · '3'/'3A' → el número con su sufijo de sector.
            val (num, sfx) = UciResultsLogic.parseResultStageKey(key)
            val lbl = labelForKey?.invoke(key) ?: when {
                key == "final" -> finalLbl
                num == 0 -> "P"
                else -> "$num$sfx"
            }
            val accessibilityLabel = accessibilityLabelForKey?.invoke(key) ?: when {
                key == "final" -> finalAccessibilityLabel
                num == 0 -> prologueAccessibilityLabel
                else -> stringResource(R.string.results_stage_accessibility, "$num$sfx")
            }
            ResultsPill(
                label = lbl,
                selected = key == activeKey,
                accessibilityLabel = accessibilityLabel,
                onClick = { onSelect(key) },
            )
        }
    }
}

/**
 * Estado de la transición al cambiar de clasificación deslizando. Vive a nivel
 * de pantalla: el contenido puede recrearse al cambiar de clasificación o de
 * categoría (claves de LazyColumn) sin cortar la animación de entrada.
 */
@Stable
internal class ClassificationSwipeState(internal val scope: CoroutineScope) {
    internal val offset = Animatable(0f)
    internal var animating = false
}

@Composable
internal fun rememberClassificationSwipeState(): ClassificationSwipeState {
    val scope = rememberCoroutineScope()
    return remember(scope) { ClassificationSwipeState(scope) }
}

/**
 * Deslizamiento lateral sobre una clasificación: pasa a la anterior o a la
 * siguiente de [options] con la transición de Hoy (el contenido sale por el
 * lado del gesto y el nuevo entra por el contrario). El arrastre vertical
 * sigue desplazando la lista.
 */
internal fun Modifier.classificationSwipe(
    options: List<String>,
    current: String?,
    state: ClassificationSwipeState,
    onSelect: (String) -> Unit,
): Modifier = composed {
    val haptic = rememberHaptics()
    val threshold = with(LocalDensity.current) { 80.dp.toPx() }
    val latestOptions by rememberUpdatedState(options)
    val latestCurrent by rememberUpdatedState(current)
    val latestOnSelect by rememberUpdatedState(onSelect)
    graphicsLayer { translationX = state.offset.value }.pointerInput(state) {
        var total = 0f
        detectHorizontalDragGestures(
            onDragStart = { total = 0f },
            onHorizontalDrag = { change, amount -> total += amount; change.consume() },
            onDragEnd = {
                val index = latestCurrent?.let(latestOptions::indexOf) ?: -1
                val forward = total < 0
                val target = index + if (forward) 1 else -1
                if (!state.animating && index >= 0 && kotlin.math.abs(total) > threshold && target in latestOptions.indices) {
                    haptic(Haptics.Event.Selection)
                    val key = latestOptions[target]
                    val width = size.width.toFloat()
                    if (width <= 0f || !android.animation.ValueAnimator.areAnimatorsEnabled()) {
                        latestOnSelect(key)
                    } else {
                        state.animating = true
                        state.scope.launch {
                            val direction = if (forward) -1f else 1f
                            try {
                                state.offset.animateTo(direction * width, tween(150))
                                latestOnSelect(key)
                                state.offset.snapTo(-direction * width)
                                state.offset.animateTo(0f, tween(200))
                            } finally {
                                state.animating = false
                            }
                        }
                    }
                }
            },
        )
    }
}

/** Barra de pestañas de clasificación + dropdown de filtro por equipo. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ResultsClassTabsBar(
    stages: List<RaceUciStage>,
    classificationConfig: List<RaceClassificationConfig>,
    activeClassKind: String,
    isEn: Boolean,
    teamsAvailable: List<String>,
    selectedTeam: String?,
    onSelectClass: (String) -> Unit,
    onSelectTeam: (String?) -> Unit,
    /**
     * Clasificación activa: sin pestañas (carreras de un día), su estado
     * (Oficial/Provisional) ocupa la izquierda de la fila del filtro.
     */
    publicationStage: RaceUciStage? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val hasTabs = stages.size > 1
        if (hasTabs) {
            val scrollState = rememberScrollState()
            val scope = rememberCoroutineScope()
            val animationsEnabled = android.animation.ValueAnimator.areAnimatorsEnabled()
            // Posición de cada pestaña en el carril: la activa se centra al
            // cambiar (también tras un deslizamiento sobre la tabla).
            val tabBounds = remember { mutableStateMapOf<String, Pair<Int, Int>>() }
            LaunchedEffect(activeClassKind, scrollState.viewportSize, tabBounds[activeClassKind]) {
                val (x, width) = tabBounds[activeClassKind] ?: return@LaunchedEffect
                val target = (x + width / 2 - scrollState.viewportSize / 2).coerceIn(0, scrollState.maxValue)
                if (animationsEnabled) scrollState.animateScrollTo(target) else scrollState.scrollTo(target)
            }
            Row(
                modifier = Modifier.weight(1f).height(48.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val hasOverflow = scrollState.maxValue > 0
                if (hasOverflow) {
                    ResultsRailArrow(forward = false, enabled = scrollState.value > 0) {
                        scope.launch {
                            val step = maxOf(80, scrollState.viewportSize * 3 / 4)
                            val target = (scrollState.value - step).coerceAtLeast(0)
                            if (animationsEnabled) scrollState.animateScrollTo(target)
                            else scrollState.scrollTo(target)
                        }
                    }
                }
                Row(
                    modifier = Modifier.weight(1f).horizontalScroll(scrollState),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    stages.forEach { st ->
                        val config = classificationConfig.firstOrNull { it.classKind == st.classKind }
                        val tint = UciResultsLogic.classificationColor(config)?.let {
                            app.calendariociclismo.android.ui.theme.colorFromHex(it)
                        }
                        Box(Modifier.onGloballyPositioned {
                            tabBounds[st.classKind] = it.positionInParent().x.toInt() to it.size.width
                        }) {
                            ResultsClassificationTab(
                                label = config?.let { UciResultsLogic.classificationLabel(it, isEn) }
                                    ?: classLabel(st.classKind),
                                selected = st.classKind == activeClassKind,
                                tint = tint,
                                onClick = { onSelectClass(st.classKind) },
                            )
                        }
                    }
                }
                if (hasOverflow) {
                    ResultsRailArrow(
                        forward = true,
                        enabled = scrollState.value < scrollState.maxValue,
                    ) {
                        scope.launch {
                            val step = maxOf(80, scrollState.viewportSize * 3 / 4)
                            val target = (scrollState.value + step).coerceAtMost(scrollState.maxValue)
                            if (animationsEnabled) scrollState.animateScrollTo(target)
                            else scrollState.scrollTo(target)
                        }
                    }
                }
            }
        } else if (publicationStage != null) {
            Box(Modifier.weight(1f)) {
                ResultsPublicationStatus(
                    stage = publicationStage,
                    classificationLabel = "",
                    showClassificationLabel = false,
                )
            }
        } else {
            Spacer(Modifier.weight(1f))
        }

        // Filtro por equipo (solo si hay ≥2 equipos en la clasificación),
        // separado de las pestañas por un divisor vertical.
        if (teamsAvailable.size >= 2) {
            if (hasTabs) {
                VerticalDivider(
                    modifier = Modifier.height(22.dp),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
            }
            var expanded by remember { mutableStateOf(false) }
            val allLabel = stringResource(R.string.results_filter_all_teams)
            ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                // Desplegable como `.res-teamfilter__select`: superficie de
                // tarjeta, texto principal y flecha gris.
                Surface(
                    onClick = { expanded = true },
                    modifier = Modifier
                        .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                        .heightIn(min = 48.dp),
                    shape = RoundedCornerShape(CCRadius.Surface),
                    color = MaterialTheme.colorScheme.surface,
                    shadowElevation = CC_CARD_ELEVATION,
                ) {
                    Row(
                        modifier = Modifier.heightIn(min = 48.dp).padding(start = 10.dp, end = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            selectedTeam ?: allLabel,
                            style = CCText.S14,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 140.dp),
                        )
                        Icon(
                            Icons.Filled.ArrowDropDown,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
                ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    DropdownMenuItem(
                        text = { Text(allLabel) },
                        onClick = { onSelectTeam(null); expanded = false },
                    )
                    teamsAvailable.forEach { tn ->
                        DropdownMenuItem(
                            text = { Text(tn) },
                            onClick = { onSelectTeam(tn); expanded = false },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ResultsRailArrow(
    forward: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val label = if (forward) {
        stringResource(R.string.results_more_classifications)
    } else {
        stringResource(R.string.results_previous_classifications)
    }
    Box(
        modifier = Modifier
            .width(48.dp)
            .fillMaxHeight()
            .background(colors.onSurfaceVariant.copy(alpha = if (enabled) 0.10f else 0.045f))
            .drawBehind {
                val x = if (forward) 0f else size.width
                drawLine(
                    color = colors.outlineVariant,
                    start = Offset(x, 0f),
                    end = Offset(x, size.height),
                    strokeWidth = 1.dp.toPx(),
                )
            }
            .semantics { contentDescription = label }
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = if (forward) Icons.AutoMirrored.Filled.KeyboardArrowRight
            else Icons.AutoMirrored.Filled.KeyboardArrowLeft,
            contentDescription = null,
            tint = colors.onSurfaceVariant.copy(alpha = if (enabled) 1f else 0.48f),
            modifier = Modifier.size(22.dp),
        )
    }
}

/**
 * Pestaña de clasificación (`.res-tab`) sobre el `Tab` de Material 3: filete
 * superior con el color del maillot si la clasificación lo declara (Etapa
 * permanece neutra); la activa con texto principal y subrayado de acento de
 * 2 dp, sin fondo; las inactivas en gris. Compartida con Ciclocross.
 */
@Composable
internal fun ResultsClassificationTab(
    label: String,
    selected: Boolean,
    tint: Color? = null,
    onClick: () -> Unit,
) {
    val accent = MaterialTheme.colorScheme.primary
    val outline = MaterialTheme.colorScheme.outlineVariant
    Tab(
        selected = selected,
        onClick = onClick,
        selectedContentColor = MaterialTheme.colorScheme.onSurface,
        unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .widthIn(min = 48.dp)
            .height(48.dp)
            // El filete del maillot y el subrayado de la activa se dibujan
            // sobre el tamaño final de la pestaña (el carril no fija anchos).
            .drawBehind {
                tint?.let {
                    val inset = 10.dp.toPx()
                    val top = 2.dp.toPx()
                    val stripe = 3.dp.toPx()
                    drawRect(
                        color = outline,
                        topLeft = Offset(inset - 1.dp.toPx(), top - 1.dp.toPx()),
                        size = Size(size.width - 2 * inset + 2.dp.toPx(), stripe + 2.dp.toPx()),
                    )
                    drawRect(color = it, topLeft = Offset(inset, top), size = Size(size.width - 2 * inset, stripe))
                }
                if (selected) {
                    val line = 2.dp.toPx()
                    drawRect(color = accent, topLeft = Offset(0f, size.height - line), size = Size(size.width, line))
                }
            },
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 10.dp),
            style = CCText.S13,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Botón del selector de etapas sobre `FilterChip`, con el aspecto de los
 * filtros de Hoy: inactivo en gris sobre la superficie de tarjeta; activo con
 * el acento al 15 % y texto de acento en negrita. Radio de control.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ResultsPill(
    label: String,
    selected: Boolean,
    tint: Color? = null,
    accessibilityLabel: String = label,
    onClick: () -> Unit,
) {
    val selectedColor = tint ?: MaterialTheme.colorScheme.primary
    FilterChip(
        selected = selected,
        onClick = onClick,
        modifier = Modifier
            .padding(horizontal = 2.dp)
            .heightIn(min = 32.dp)
            .semantics { contentDescription = accessibilityLabel },
        shape = RoundedCornerShape(CCRadius.Control),
        border = null,
        colors = FilterChipDefaults.filterChipColors(
            containerColor = MaterialTheme.colorScheme.surface,
            labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
            selectedContainerColor = selectedColor.copy(alpha = 0.15f),
            selectedLabelColor = selectedColor,
        ),
        label = {
            Box(modifier = Modifier.widthIn(min = 16.dp), contentAlignment = Alignment.Center) {
                Text(
                    label,
                    style = CCText.S14,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                )
            }
        },
    )
}

@Composable
internal fun ResultsPublicationStatus(
    stage: RaceUciStage,
    classificationLabel: String,
    showClassificationLabel: Boolean = true,
) {
    val official = stage.publicationStatus == "official"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (showClassificationLabel) {
            Text(
                classificationLabel,
                style = CCText.S16,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
        Text(
            if (official) {
                if (LocaleHolder.shouldShowEnglishContent) "Official" else "Oficial"
            } else {
                "Provisional"
            },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = CCText.S13,
        )
        if (!official && UciResultsLogic.classificationIsUpdating(stage)) {
            val updatingLabel = if (LocaleHolder.shouldShowEnglishContent) {
                "Classification updating"
            } else {
                "Clasificación actualizándose"
            }
            // Solo el indicador giratorio, sin texto, sobre el acento atenuado
            // con 6 de relleno y sin radio, como la web.
            Box(
                modifier = Modifier
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f))
                    .padding(6.dp)
                    .clearAndSetSemantics { contentDescription = updatingLabel },
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    color = MaterialTheme.colorScheme.primary,
                    strokeWidth = 2.dp,
                )
            }
        }
        if (!official && !stage.lastSyncedAt.isNullOrBlank()) {
            Text(
                (if (LocaleHolder.shouldShowEnglishContent) "Last update: " else "Última actualización: ") +
                    stage.lastSyncedAt.take(16).replace('T', ' '),
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = CCText.S13,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        } else {
            Spacer(Modifier.weight(1f))
        }
    }
}

/**
 * Tabla de una clasificación. Carga las filas on-demand por stageRef, decide
 * individual vs CRE colapsada, y aplica el filtro por equipo (recalculando m.t.
 * sobre las filas visibles, como `applyTeamFilter` en la web).
 */
@Composable
internal fun ResultsTable(
    stage: RaceUciStage,
    byDorsal: Map<Int, ResolvedRider>,
    raceTeams: List<Team>,
    raceDayPrimaryType: String?,
    raceYear: Int?,
    isOneDay: Boolean,
    isEn: Boolean,
    selectedTeam: String?,
    /** Se incrementa en cada pull-to-refresh del padre; entra en la clave del
     *  LaunchedEffect para re-pedir las filas (sin él, el swipe-down no
     *  recargaba la clasificación visible porque stage.id no cambia). */
    reloadToken: Int = 0,
    showTableHeader: Boolean = true,
    onTeamsResolved: (List<String>) -> Unit,
    onHeaderResolved: (ResultsTableHeaderSpec?) -> Unit = {},
) {
    val app = rememberApp()
    // remember SOLO por stage.id: al refrescar, `rows` conserva el valor previo
    // (la tabla anterior sigue visible) mientras el LaunchedEffect — re-clavado
    // también en reloadToken — re-pide las filas. Así no parpadea el spinner.
    // Una clasificación precargada (ResultsRowsCache) entra ya pintada.
    val cached = remember(stage.id) { ResultsRowsCache.cached(stage.id) }
    var rows by remember(stage.id) { mutableStateOf(cached?.rows) }
    // Fallback por globalRiderId para filas que no casan por dorsal. Solo el año
    // vigente puede completar además el equipo actual.
    var byRider by remember(stage.id) { mutableStateOf(cached?.byRider ?: emptyMap()) }
    // Override MANUAL de equipo (mig. 112): teamId de la fila → equipo canónico.
    var byTeamOverride by remember(stage.id) { mutableStateOf(cached?.byTeamOverride ?: emptyMap()) }

    // Etapa CANCELADA: la pestaña "Etapa" no tiene clasificación que mostrar (la
    // carrera no llegó a meta). En vez de una tabla vacía ("sin datos", que se
    // lee como un volcado que falta), el aviso explica QUÉ pasó. Es un marcador
    // sintético: no hay filas que pedir. Espejo de js/resultados.js.
    if (stage.isCancelledStage) {
        LaunchedEffect(stage.id) {
            onTeamsResolved(emptyList())
            onHeaderResolved(null)
        }
        CancelledStageNotice()
        return
    }

    LaunchedEffect(stage.id, reloadToken) {
        val bundle = ResultsRowsCache.bundle(app.repository, stage.id, reloadToken, byDorsal, raceYear) ?: return@LaunchedEffect
        byRider = bundle.byRider
        byTeamOverride = bundle.byTeamOverride
        rows = bundle.rows
    }

    val loaded = rows
    if (loaded == null) {
        Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.size(28.dp))
        }
        return
    }
    if (loaded.isEmpty()) {
        // Publicar "sin equipos" desde un efecto (nunca mutar estado del padre
        // durante la composición).
        LaunchedEffect(stage.id) {
            onTeamsResolved(emptyList())
            onHeaderResolved(null)
        }
        Text(
            stringResource(R.string.results_no_data),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            style = CCText.S14,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }

    val isTeams = stage.classKind == "teams"
    val isTtt = remember(loaded, stage.classKind, raceDayPrimaryType, stage.raceType) {
        UciResultsLogic.isTttStage(loaded, stage.classKind, isTeams, raceDayPrimaryType, stage.stageNumber, isOneDay, stage.raceType)
    }

    // Equipos disponibles para el filtro (vacío en CRE / pestaña Equipos).
    LaunchedEffect(loaded, isTeams, isTtt, byRider, byTeamOverride) {
        onTeamsResolved(
            if (isTeams || isTtt) emptyList()
            else UciResultsLogic.teamsInClass(loaded, byDorsal, byRider, byTeamOverride),
        )
    }
    LaunchedEffect(loaded, isTeams, isTtt, stage.classKind) {
        onHeaderResolved(
            ResultsTableHeaderSpec(
                primaryColumnIsRider = !isTeams && !isTtt,
                showUciPoints = loaded.any { it.uciPoints != null },
                isPoints = !isTtt && UciResultsLogic.isPointsClass(stage.classKind),
            )
        )
    }

    if (isTtt) {
        Column {
            CarriedStandingsNotice(stage)
            ResultsTttTable(
                loaded, byDorsal, isEn,
                byRider = byRider,
                byTeamOverride = byTeamOverride,
                showTableHeader = showTableHeader,
            )
        }
        return
    }

    // CRI: ganador con su tiempo oficial truncado en notación de prensa (20'52")
    // y el resto con su diferencia sobre los enteros, como una etapa en línea.
    // Señal doble: RaceTypeCode 'ITT' de la etapa o jornada 'itt' (las CRI de un
    // día llegan con el bloque final sin raceType).
    val isItt = UciResultsLogic.isIttStage(
        classKind = stage.classKind,
        isTeams = isTeams,
        stageRaceType = stage.raceType,
        raceDayPrimaryType = raceDayPrimaryType,
        stageNumber = stage.stageNumber,
        isOneDay = isOneDay,
    )
    val vms = remember(loaded, stage.classKind, isTeams, raceTeams, isItt, byRider, byTeamOverride) {
        UciResultsLogic.buildIndividualRows(loaded, stage.classKind, isTeams, byDorsal, isEn, raceTeams, isItt, byRider, byTeamOverride)
    }
    // Filtrado por equipo (si aplica) — la lista visible se deriva aquí.
    val visible = if (!isTeams && selectedTeam != null) vms.filter { it.teamName == selectedTeam } else vms
    val isPts = UciResultsLogic.isPointsClass(stage.classKind)
    val valueHeader =
        if (isPts) stringResource(R.string.results_col_points) else stringResource(R.string.results_col_time)
    // El slot UCI nace solo cuando haya al menos un dato. Al filtrar por equipo
    // se mantiene estable porque el contrato pertenece a la clasificación completa.
    val showUciPoints = vms.any { it.uciPoints != null }

    ResultsClassificationTable(visible, showTeam = !isTeams, showUciPoints = showUciPoints, valueHeader = valueHeader,
        showTableHeader = showTableHeader, notice = { CarriedStandingsNotice(stage) })
}

// ── Tabla de clasificación (`.res-table`) ──────────────────────────
//
// Presentación común de las clasificaciones, el ránking UCI por equipos y el
// orden de salida: superficie de tarjeta, cabecera de columnas en gris y filas
// separadas por un filete fino, sin franjas ni fondos por fila.

/** Medidas comunes de fila y cabecera. */
internal object ResultsTableMetrics {
    val HorizontalPadding = 9.dp
    val RowVerticalPadding = 7.dp
    val HeaderVerticalPadding = 7.dp
    val ColumnSpacing = 8.dp
    val RankWidth = 32.dp
}

private val TableTopShape = RoundedCornerShape(topStart = CCRadius.Surface, topEnd = CCRadius.Surface)
private val TableBottomShape = RoundedCornerShape(bottomStart = CCRadius.Surface, bottomEnd = CCRadius.Surface)

/** Superficie de una tabla de clasificación. */
@Composable
internal fun ResultsTableSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(CCRadius.Surface),
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = shape,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = CC_CARD_ELEVATION,
    ) {
        Column(Modifier.fillMaxWidth(), content = content)
    }
}

/** Celda de la cabecera de columnas: 12 en negrita, gris. */
@Composable
internal fun ResultsHeaderCell(text: String, modifier: Modifier, align: TextAlign = TextAlign.Start) {
    Text(
        text,
        modifier = modifier,
        style = CCText.S12,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = align,
        maxLines = 1,
    )
}

@Composable
private fun ResultsTableDivider() {
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
internal fun ResultsClassificationTable(
    rows: List<UciResultsLogic.ResultRowVM>, showTeam: Boolean, showUciPoints: Boolean, valueHeader: String,
    showTableHeader: Boolean = true, notice: @Composable () -> Unit = {},
) {
    val sameTimeLabel = stringResource(R.string.results_same_time)
    Column(Modifier.fillMaxWidth()) {
        notice()
        // Sin cabecera propia (la fija la pantalla bajo las pestañas), la
        // superficie continúa la de esa cabecera.
        ResultsTableSurface(shape = if (showTableHeader) RoundedCornerShape(CCRadius.Surface) else TableBottomShape) {
            if (showTableHeader) {
                ResultsTableHeaderRow(showTeam = showTeam, showUciPoints = showUciPoints, valueHeader = valueHeader)
                ResultsTableDivider()
            }
            // m.t. dinámico: el 1º visible de cada grupo de gap muestra su gap real;
            // los siguientes con el mismo gap → m.t. (igual que applyTeamFilter web).
            var prevGap: String? = null
            rows.forEachIndexed { index, vm ->
                val displayKind: UciResultsLogic.ValueKind
                val displayValue: String
                if (vm.valueKind == UciResultsLogic.ValueKind.GAP && vm.rowGap.isNotEmpty()) {
                    if (prevGap != null && vm.rowGap == prevGap) {
                        displayKind = UciResultsLogic.ValueKind.SAME_TIME; displayValue = sameTimeLabel
                    } else {
                        displayKind = UciResultsLogic.ValueKind.GAP; displayValue = vm.rowGap
                    }
                    prevGap = vm.rowGap
                } else {
                    displayKind = vm.valueKind
                    displayValue = if (vm.valueKind == UciResultsLogic.ValueKind.SAME_TIME) sameTimeLabel else vm.valueText
                }
                ResultsRow(
                    vm = vm,
                    showTeam = showTeam,
                    showUciPoints = showUciPoints,
                    displayKind = displayKind,
                    displayValue = displayValue,
                )
                if (index < rows.lastIndex) ResultsTableDivider()
            }
        }
    }
}

/**
 * Aviso de la pestaña "Etapa" de una jornada CANCELADA (no hay tabla: la carrera
 * no llegó a meta). Mismo lenguaje que el banner de la ficha. Espejo de
 * `.res-cancelled-note` (web).
 */
@Composable
private fun CancelledStageNotice() {
    val red = MaterialTheme.colorScheme.error
    Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), Alignment.Center) {
        Row(
            modifier = Modifier
                .background(color = red.copy(alpha = 0.10f), shape = RoundedCornerShape(CCRadius.Surface))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.Cancel,
                contentDescription = null,
                tint = red,
                modifier = Modifier.size(16.dp),
            )
            Text(
                text = stringResource(R.string.race_stage_cancelled),
                style = CCText.S13,
                fontWeight = FontWeight.Bold,
                color = red,
            )
        }
    }
}

/**
 * Aviso de general ARRASTRADA: en una etapa cancelada las generales que se ven
 * son las de la etapa anterior (la carrera no se movió). Sin decirlo, una GC
 * idéntica a la de ayer se lee como un volcado viejo o roto. Espejo de
 * `.res-carried-note` (web).
 */
@Composable
private fun CarriedStandingsNotice(stage: RaceUciStage) {
    val fromNum = stage.carriedFromStage ?: return
    val from = "$fromNum${stage.carriedFromSuffix.orEmpty()}"   // "3A" en dobles sectores
    CCCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.Info,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(15.dp),
            )
            Text(
                text = stringResource(R.string.results_carried_standings, from),
                style = CCText.S13,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

internal data class ResultsTableHeaderSpec(
    val primaryColumnIsRider: Boolean,
    val showUciPoints: Boolean,
    val isPoints: Boolean,
)

/**
 * Cabecera de columnas fijada por la pantalla bajo las pestañas: abre la
 * superficie que continúa la tabla (`showTableHeader = false`).
 */
@Composable
internal fun ResultsTableHeader(
    showTeam: Boolean,
    showUciPoints: Boolean,
    valueHeader: String,
) {
    ResultsTableSurface(shape = TableTopShape) {
        ResultsTableHeaderRow(showTeam = showTeam, showUciPoints = showUciPoints, valueHeader = valueHeader)
        ResultsTableDivider()
    }
}

@Composable
private fun ResultsTableHeaderRow(
    showTeam: Boolean,
    showUciPoints: Boolean,
    valueHeader: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = ResultsTableMetrics.HorizontalPadding, vertical = ResultsTableMetrics.HeaderVerticalPadding),
        horizontalArrangement = Arrangement.spacedBy(ResultsTableMetrics.ColumnSpacing),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ResultsHeaderCell("#", Modifier.width(ResultsTableMetrics.RankWidth), align = TextAlign.Center)
        ResultsHeaderCell(
            stringResource(if (showTeam) R.string.results_col_rider else R.string.results_col_team),
            Modifier.weight(1f),
        )
        if (showUciPoints) ResultsHeaderCell("UCI", Modifier.width(44.dp), align = TextAlign.End)
        ResultsHeaderCell(valueHeader, Modifier.width(72.dp), align = TextAlign.End)
    }
}

private val TabularS14: TextStyle get() = CCText.S14.copy(fontFeatureSettings = "tnum")
private val TabularS13: TextStyle get() = CCText.S13.copy(fontFeatureSettings = "tnum")

@Composable
private fun ResultsRow(
    vm: UciResultsLogic.ResultRowVM,
    showTeam: Boolean,
    showUciPoints: Boolean,
    displayKind: UciResultsLogic.ValueKind,
    displayValue: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 35.dp)
            .padding(horizontal = ResultsTableMetrics.HorizontalPadding, vertical = ResultsTableMetrics.RowVerticalPadding),
        horizontalArrangement = Arrangement.spacedBy(ResultsTableMetrics.ColumnSpacing),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // # / IRM
        Box(modifier = Modifier.width(ResultsTableMetrics.RankWidth), contentAlignment = Alignment.Center) {
            if (vm.rank != null) {
                Text(
                    vm.rank.toString(),
                    style = TabularS14,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(
                    vm.rankBadge ?: "–",
                    style = CCText.S12,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Corredor (bandera + nombre [+ equipo como subtítulo]) o equipo.
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (vm.countryCode.isNotEmpty()) CountryFlag(countryCode = vm.countryCode, height = 13.dp)
                if (!showTeam) {
                    vm.team?.let { team ->
                        if (team.hasVisibleBadge) TeamColorBands(team)
                    }
                }
                Text(
                    vm.riderName.ifEmpty { "-" },
                    style = CCText.S14,
                    fontWeight = FontWeight.SemiBold,
                    color = if (vm.riderName.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            // Equipo como subtítulo (en filas de corredor; oculto en pestaña Equipos).
            if (showTeam && vm.teamName.isNotEmpty()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    vm.team?.let { team ->
                        if (team.hasVisibleBadge) TeamColorBands(team)
                    }
                    Text(
                        vm.teamName,
                        style = CCText.S12,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }

        // Jerarquía compartida: puesto · identidad · [UCI] · resultado.
        if (showUciPoints) UciPointsCell(vm.uciPoints, Modifier.width(44.dp))
        ResultValueCell(displayKind, displayValue, Modifier.width(72.dp))
    }
}

@Composable
private fun UciPointsCell(points: Double?, modifier: Modifier) {
    Text(
        points?.let { BigDecimal.valueOf(it).stripTrailingZeros().toPlainString() }.orEmpty(),
        modifier = modifier,
        style = TabularS13,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.End,
        maxLines = 1,
    )
}

@Composable
private fun ResultValueCell(kind: UciResultsLogic.ValueKind, value: String, modifier: Modifier) {
    val (color, weight) = when (kind) {
        UciResultsLogic.ValueKind.WINNER_TIME -> MaterialTheme.colorScheme.primary to FontWeight.Bold
        UciResultsLogic.ValueKind.POINTS -> MaterialTheme.colorScheme.onSurface to FontWeight.SemiBold
        else -> MaterialTheme.colorScheme.onSurfaceVariant to FontWeight.Normal
    }
    Text(
        value,
        modifier = modifier,
        style = TabularS14,
        fontWeight = weight,
        color = color,
        textAlign = TextAlign.End,
        maxLines = 1,
        // Textos largos («vuelta perdida» en CX) acaban en puntos suspensivos
        // como en iOS, en vez de cortarse sin indicación.
        overflow = TextOverflow.Ellipsis,
    )
}

// ── CRE (crono por equipos) colapsada ──────────────────────────────

@Composable
private fun ResultsTttTable(
    rows: List<RaceUciResultRow>,
    byDorsal: Map<Int, ResolvedRider>,
    isEn: Boolean,
    byRider: Map<String, ResolvedRider> = emptyMap(),
    byTeamOverride: Map<String, Team> = emptyMap(),
    showTableHeader: Boolean = true,
) {
    val teams = remember(rows, byRider, byTeamOverride) { UciResultsLogic.collapseTtt(rows, byDorsal, isEn, byRider, byTeamOverride) }
    val winnerSecs = remember(teams) { UciResultsLogic.tttWinnerSecs(teams) }
    val expanded = remember(rows) { mutableStateMapOf<Int, Boolean>() }
    val timeHeader = stringResource(R.string.results_col_time)
    val showUciPoints = rows.any { it.uciPoints != null }

    ResultsTableSurface(shape = if (showTableHeader) RoundedCornerShape(CCRadius.Surface) else TableBottomShape) {
        if (showTableHeader) {
            ResultsTableHeaderRow(
                showTeam = false,
                showUciPoints = showUciPoints,
                valueHeader = timeHeader,
            )
            ResultsTableDivider()
        }

        teams.forEachIndexed { i, team ->
            val isOpen = expanded[i] == true
            // Fila de equipo (pulsable → despliega corredores).
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 35.dp)
                    .clickable(role = Role.Button) { expanded[i] = !isOpen }
                    .padding(horizontal = ResultsTableMetrics.HorizontalPadding, vertical = ResultsTableMetrics.RowVerticalPadding),
                horizontalArrangement = Arrangement.spacedBy(ResultsTableMetrics.ColumnSpacing),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    team.rank?.toString() ?: "–",
                    modifier = Modifier.width(ResultsTableMetrics.RankWidth),
                    style = TabularS14,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    team.team?.let { teamModel ->
                        if (teamModel.hasVisibleBadge) TeamColorBands(teamModel)
                    }
                    Text(
                        team.teamName.ifEmpty { "-" },
                        style = CCText.S14,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Icon(
                        imageVector = if (isOpen) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                        contentDescription = null,
                        tint = if (isOpen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
                if (showUciPoints) UciPointsCell(team.uciPoints, Modifier.width(44.dp))
                val isWinner = team.rank == 1 && team.teamTimeText != null
                val value = when {
                    team.rank == null -> ""
                    isWinner -> team.teamTimeText.orEmpty()
                    else -> UciResultsLogic.tttGapBetween(team.teamSecs, winnerSecs) ?: team.teamTimeText.orEmpty()
                }
                ResultValueCell(
                    if (isWinner) UciResultsLogic.ValueKind.WINNER_TIME else UciResultsLogic.ValueKind.GAP,
                    value,
                    Modifier.width(72.dp),
                )
            }
            // Sub-filas de corredores (al desplegar).
            if (isOpen) {
                team.riders.forEach { rider ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(neutralFill.copy(alpha = 0.04f))
                            .padding(
                                start = ResultsTableMetrics.HorizontalPadding + ResultsTableMetrics.RankWidth + ResultsTableMetrics.ColumnSpacing,
                                end = ResultsTableMetrics.HorizontalPadding,
                                top = 5.dp,
                                bottom = 5.dp,
                            ),
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (rider.countryCode.isNotEmpty()) CountryFlag(countryCode = rider.countryCode, height = 13.dp)
                        Text(
                            rider.name.ifEmpty { "-" },
                            modifier = Modifier.weight(1f),
                            style = CCText.S14,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        val indiv = if (!rider.irm.isNullOrEmpty()) {
                            UciResultsLogic.irmLabel(rider.irm, isEn)
                        } else rider.timeText.orEmpty()
                        if (showUciPoints) UciPointsCell(rider.uciPoints, Modifier.width(44.dp))
                        Text(
                            indiv,
                            modifier = Modifier.width(72.dp),
                            style = TabularS13,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.End,
                            maxLines = 1,
                        )
                    }
                }
            }
            if (i < teams.lastIndex) ResultsTableDivider()
        }
    }
}
