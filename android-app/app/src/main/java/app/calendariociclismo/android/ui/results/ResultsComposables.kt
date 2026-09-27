package app.calendariociclismo.android.ui.results

import java.math.BigDecimal
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    CCCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 12) {
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
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Medium,
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
    CCCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 12) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            raceDay.elevationProfile?.takeIf { raceDay.hasElevationProfile }?.let { profile ->
                Column(
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onProfileTap),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        LocaleHolder.t("Perfil y datos", "Profile and data"),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                        style = MaterialTheme.typography.labelMedium,
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
            raceDay.averageSpeedKmh?.let {
                ResultsContextMetric(LocaleHolder.t("Velocidad media", "Average speed"), "%.1f km/h".format(java.util.Locale.US, it))
            }
            if (raceDay.hasValidTimeLimit) RaceDay.formatDuration(raceDay.timeLimitSeconds)?.let {
                ResultsContextMetric(LocaleHolder.t("Fuera de control", "Time limit"), it)
            }
        }
    }
}

@Composable
private fun ResultsContextMetric(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
    }
}

/** Selector de etapa: P · 1 · 2 · … · F (cápsulas, estética canónica). */
@Composable
internal fun ResultsStageSelector(
    stageKeys: List<String>,
    activeKey: String?,
    isEn: Boolean,
    labelForKey: ((String) -> String)? = null,
    subtitleForKey: ((String) -> String)? = null,
    accessibilityLabelForKey: (@Composable (String) -> String)? = null,
    enabled: Boolean = true,
    dateNavigationStyle: Boolean = false,
    centerWhenFits: Boolean = false,
    onFitsChange: ((Boolean) -> Unit)? = null,
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
    // La tira «cabe» cuando tras medir no puede desplazarse en ningún sentido;
    // el selector de meses CX retira entonces sus flechas laterales.
    val fits by remember(listState) {
        derivedStateOf {
            val info = listState.layoutInfo
            info.viewportSize.width > 0 && !listState.canScrollForward && !listState.canScrollBackward
        }
    }
    LaunchedEffect(fits) { onFitsChange?.invoke(fits) }
    LazyRow(
        state = listState,
        modifier = Modifier.fillMaxWidth(),
        // Cada elemento ya reserva 48 dp de objetivo táctil. No añadimos otro
        // hueco entre ellos para que el carril de etapas mantenga la densidad
        // visual de la web sin reducir su superficie accesible.
        horizontalArrangement = if (centerWhenFits && fits) Arrangement.Center else Arrangement.Start,
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
                subtitle = subtitleForKey?.invoke(key),
                enabled = enabled,
                dateNavigationStyle = dateNavigationStyle,
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
                Row(
                    modifier = Modifier
                        .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
                        .clickable { expanded = true }
                        .padding(horizontal = 10.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        selectedTeam ?: allLabel,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 140.dp),
                    )
                    Icon(Icons.Filled.ArrowDropDown, contentDescription = null, modifier = Modifier.size(18.dp))
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

/** Pestaña rectangular equivalente al selector de clasificaciones de la web. */
@Composable
internal fun ResultsClassificationTab(
    label: String,
    selected: Boolean,
    tint: Color? = null,
    onClick: () -> Unit,
) {
    val selectedUnderline = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.65f)
    Column(
        modifier = Modifier
            .widthIn(min = 48.dp)
            .height(48.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(
                if (selected) MaterialTheme.colorScheme.surfaceVariant
                else MaterialTheme.colorScheme.surface,
            )
            // El carril horizontal mide sus hijos sin un ancho máximo. Las bandas
            // con fillMaxWidth podían recibir ancho cero; dibujarlas sobre el
            // tamaño final de la pestaña garantiza el destaque cromático.
            .drawBehind {
                val stripeHeight = 3.dp.toPx()
                tint?.let {
                    drawRect(
                        color = it,
                        size = Size(size.width, stripeHeight),
                    )
                }
                if (selected) {
                    drawRect(
                        color = selectedUnderline,
                        topLeft = Offset(0f, size.height - stripeHeight),
                        size = Size(size.width, stripeHeight),
                    )
                }
            }
            .semantics { role = Role.Button; this.selected = selected }
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(3.dp))
        Box(
            modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                color = if (selected) MaterialTheme.colorScheme.onSurface
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.height(3.dp))
    }
}

/** Cápsula de filtro (igual estética que StartOrderFilterPill / CategoryChip). */
@Composable
private fun ResultsPill(
    label: String,
    selected: Boolean,
    subtitle: String? = null,
    enabled: Boolean = true,
    tint: Color? = null,
    dateNavigationStyle: Boolean = false,
    accessibilityLabel: String = label,
    onClick: () -> Unit,
) {
    val primary = MaterialTheme.colorScheme.primary
    val selectedColor = tint ?: primary
    val bg = if (selected) selectedColor.copy(alpha = 0.15f) else if (dateNavigationStyle) Color.Transparent else MaterialTheme.colorScheme.surfaceVariant
    Box(
        modifier = Modifier
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .semantics {
                role = Role.Button
                this.selected = selected
                contentDescription = accessibilityLabel
            }
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 5.dp),
        contentAlignment = Alignment.Center,
    ) {
        // Con subtítulo (selector de meses CX) el mando es el mes: línea
        // grande en color de texto; el año queda pequeño y atenuado.
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(bg)
                .padding(horizontal = 10.dp, vertical = 5.dp),
        ) {
            Text(label,
                style = if (subtitle != null) MaterialTheme.typography.labelLarge else MaterialTheme.typography.labelMedium,
                fontWeight = if (selected) FontWeight.SemiBold else if (subtitle != null) FontWeight.Medium else FontWeight.Normal,
                color = when {
                    selected -> selectedColor
                    subtitle != null -> MaterialTheme.colorScheme.onSurface
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                })
            if (subtitle != null) Text(subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = if (selected) selectedColor else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
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
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
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
            style = MaterialTheme.typography.labelMedium,
        )
        if (!official && UciResultsLogic.classificationIsUpdating(stage)) {
            val updatingLabel = if (LocaleHolder.shouldShowEnglishContent) {
                "Classification updating"
            } else {
                "Clasificación actualizándose"
            }
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
                    .clearAndSetSemantics { contentDescription = updatingLabel },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    color = MaterialTheme.colorScheme.primary,
                    strokeWidth = 2.dp,
                )
                Text(
                    if (LocaleHolder.shouldShowEnglishContent) "Updating" else "Actualizando",
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        if (!official && !stage.lastSyncedAt.isNullOrBlank()) {
            Text(
                (if (LocaleHolder.shouldShowEnglishContent) "Last upd.: " else "Últ. act.: ") +
                    stage.lastSyncedAt.take(16).replace('T', ' '),
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall,
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
            style = MaterialTheme.typography.bodyMedium,
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

@Composable
internal fun ResultsClassificationTable(
    rows: List<UciResultsLogic.ResultRowVM>, showTeam: Boolean, showUciPoints: Boolean, valueHeader: String,
    showTableHeader: Boolean = true, notice: @Composable () -> Unit = {},
) {
    val sameTimeLabel = stringResource(R.string.results_same_time)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp)),
    ) {
        notice()
        if (showTableHeader) {
            ResultsTableHeader(
                showTeam = showTeam,
                showUciPoints = showUciPoints,
                valueHeader = valueHeader,
            )
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
        }
        // m.t. dinámico: el 1º visible de cada grupo de gap muestra su gap real;
        // los siguientes con el mismo gap → m.t. (igual que applyTeamFilter web).
        var prevGap: String? = null
        rows.forEach { vm ->
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
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
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
    Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), Alignment.Center) {
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
                text = stringResource(R.string.race_stage_cancelled),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.error,
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
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .background(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                shape = RoundedCornerShape(6.dp),
            )
            .padding(horizontal = 10.dp, vertical = 8.dp),
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
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

internal data class ResultsTableHeaderSpec(
    val primaryColumnIsRider: Boolean,
    val showUciPoints: Boolean,
    val isPoints: Boolean,
)

@Composable
internal fun ResultsTableHeader(
    showTeam: Boolean,
    showUciPoints: Boolean,
    valueHeader: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HeaderCell("#", Modifier.width(32.dp))
        HeaderCell(
            stringResource(if (showTeam) R.string.results_col_rider else R.string.results_col_team),
            Modifier.weight(1f),
        )
        if (showUciPoints) HeaderCell("UCI", Modifier.width(44.dp), end = true)
        HeaderCell(valueHeader, Modifier.width(70.dp), end = true)
    }
}

@Composable
private fun HeaderCell(text: String, modifier: Modifier, end: Boolean = false) {
    Text(
        text,
        modifier = modifier,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = if (end) androidx.compose.ui.text.style.TextAlign.End else androidx.compose.ui.text.style.TextAlign.Start,
    )
}

@Composable
private fun ResultsRow(
    vm: UciResultsLogic.ResultRowVM,
    showTeam: Boolean,
    showUciPoints: Boolean,
    displayKind: UciResultsLogic.ValueKind,
    displayValue: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // # / IRM
        Box(modifier = Modifier.width(32.dp), contentAlignment = Alignment.CenterStart) {
            if (vm.rank != null) {
                Text(
                    vm.rank.toString(),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            } else {
                Text(
                    vm.rankBadge ?: "–",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Corredor (bandera + nombre [+ equipo como subtítulo]) o equipo.
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (vm.countryCode.isNotEmpty()) CountryFlag(countryCode = vm.countryCode, height = 13.dp)
                if (!showTeam) {
                    vm.team?.let { team ->
                        if (team.hasVisibleBadge) TeamColorBands(team)
                    }
                }
                Text(
                    vm.riderName.ifEmpty { "—" },
                    fontSize = 14.sp,
                    lineHeight = 16.sp,
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
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    vm.team?.let { team ->
                        if (team.hasVisibleBadge) TeamColorBands(team)
                    }
                    Text(
                        vm.teamName,
                        fontSize = 11.sp,
                        lineHeight = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }

        // Jerarquía compartida: puesto · identidad · [UCI] · resultado.
        if (showUciPoints) UciPointsCell(vm.uciPoints, Modifier.width(44.dp))
        ResultValueCell(displayKind, displayValue, Modifier.width(70.dp))
    }
}

@Composable
private fun UciPointsCell(points: Double?, modifier: Modifier) {
    Text(
        points?.let { BigDecimal.valueOf(it).stripTrailingZeros().toPlainString() }.orEmpty(),
        modifier = modifier,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = androidx.compose.ui.text.style.TextAlign.End,
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
        fontSize = 13.sp,
        fontWeight = weight,
        color = color,
        textAlign = androidx.compose.ui.text.style.TextAlign.End,
        maxLines = 1,
        // Textos largos («vuelta perdida» en CX) acaban en puntos suspensivos
        // como en iOS, en vez de cortarse sin indicación.
        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
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

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp)),
    ) {
        if (showTableHeader) {
            ResultsTableHeader(
                showTeam = false,
                showUciPoints = showUciPoints,
                valueHeader = timeHeader,
            )
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
        }

        teams.forEachIndexed { i, team ->
            val isOpen = expanded[i] == true
            // Fila de equipo (pulsable → despliega corredores).
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded[i] = !isOpen }
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    team.rank?.toString() ?: "–",
                    modifier = Modifier.width(32.dp),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    team.team?.let { teamModel ->
                        if (teamModel.hasVisibleBadge) TeamColorBands(teamModel)
                    }
                    Text(
                        team.teamName.ifEmpty { "—" },
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Text(if (isOpen) "▴" else "▾", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (showUciPoints) UciPointsCell(team.uciPoints, Modifier.width(44.dp))
                val (color, weight) = when {
                    team.rank == 1 && team.teamTimeText != null -> MaterialTheme.colorScheme.primary to FontWeight.Bold
                    else -> MaterialTheme.colorScheme.onSurfaceVariant to FontWeight.Normal
                }
                val value = when {
                    team.rank == null -> ""
                    team.rank == 1 && team.teamTimeText != null -> team.teamTimeText
                    else -> UciResultsLogic.tttGapBetween(team.teamSecs, winnerSecs) ?: team.teamTimeText.orEmpty()
                }
                Text(
                    value,
                    modifier = Modifier.width(70.dp),
                    fontSize = 13.sp,
                    fontWeight = weight,
                    color = color,
                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                    maxLines = 1,
                )
            }
            // Sub-filas de corredores (al desplegar).
            if (isOpen) {
                team.riders.forEach { rider ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.25f))
                            .padding(start = 38.dp, end = 4.dp, top = 5.dp, bottom = 5.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (rider.countryCode.isNotEmpty()) CountryFlag(countryCode = rider.countryCode, height = 13.dp)
                        Text(
                            rider.name.ifEmpty { "—" },
                            modifier = Modifier.weight(1f),
                            fontSize = 13.sp,
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
                            modifier = Modifier.width(70.dp),
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = androidx.compose.ui.text.style.TextAlign.End,
                            maxLines = 1,
                        )
                    }
                }
            }
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
        }
    }
}
