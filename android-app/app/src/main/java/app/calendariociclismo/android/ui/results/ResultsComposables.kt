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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
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
import app.calendariociclismo.android.data.model.RaceUciResultRow
import app.calendariociclismo.android.data.model.RaceUciStage
import app.calendariociclismo.android.data.model.ResolvedRider
import app.calendariociclismo.android.data.model.Team
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.startlist.TeamBadgeComposable
import app.calendariociclismo.android.util.UciResultsLogic

// ── Etiqueta de la pestaña de clasificación ────────────────────────
@Composable
private fun classLabel(classKind: String): String = stringResource(
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

/** Selector de etapa: P · 1 · 2 · … · F (cápsulas, estética canónica). */
@Composable
internal fun ResultsStageSelector(
    stageKeys: List<String>,
    activeKey: String?,
    isEn: Boolean,
    onSelect: (String?) -> Unit,
) {
    val finalLbl = stringResource(R.string.results_stage_final_short)
    val listState = rememberLazyListState()
    val density = LocalDensity.current
    // Autoscroll: en etapas avanzadas (p. ej. la 18 de una Gran Vuelta) la
    // cápsula activa queda fuera de pantalla; la centramos al aparecer y cada
    // vez que cambia la etapa activa.
    val activeIndex = stageKeys.indexOf(activeKey).coerceAtLeast(0)
    LaunchedEffect(activeKey, stageKeys) {
        snapshotFlow { listState.layoutInfo.viewportSize.width }.first { it > 0 }
        val viewportWidth = listState.layoutInfo.viewportSize.width
        val itemHalfWidthPx = with(density) { 16.dp.roundToPx() }
        listState.animateScrollToItem(
            index = activeIndex,
            scrollOffset = -(viewportWidth / 2 - itemHalfWidthPx),
        )
    }
    LazyRow(
        state = listState,
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(stageKeys, key = { it }) { key ->
            // 'final'→F · '0'→P · '3'/'3A' → el número con su sufijo de sector.
            val (num, sfx) = UciResultsLogic.parseResultStageKey(key)
            val lbl = when {
                key == "final" -> finalLbl
                num == 0 -> "P"
                else -> "$num$sfx"
            }
            ResultsPill(label = lbl, selected = key == activeKey, onClick = { onSelect(key) })
        }
    }
}

/** Barra de pestañas de clasificación + dropdown de filtro por equipo. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ResultsClassTabsBar(
    stages: List<RaceUciStage>,
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
            // Las pestañas scrollean en horizontal y, con muchas clasificaciones,
            // las de la derecha quedan ocultas tras el filtro de equipos. Un botón
            // chevron anclado al borde derecho —visible SOLO cuando aún queda
            // contenido por ver (`canScrollForward`)— lo señala explícitamente y,
            // al tocarlo, desplaza la fila hasta el final.
            val scrollState = rememberScrollState()
            val scope = rememberCoroutineScope()
            Box(modifier = Modifier.weight(1f)) {
                Row(
                    modifier = Modifier.horizontalScroll(scrollState),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    stages.forEach { st ->
                        ResultsPill(
                            label = classLabel(st.classKind),
                            selected = st.classKind == activeClassKind,
                            onClick = { onSelectClass(st.classKind) },
                        )
                    }
                }
                if (scrollState.canScrollForward) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.CenterEnd)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .clickable {
                                scope.launch { scrollState.animateScrollTo(scrollState.maxValue) }
                            }
                            .padding(3.dp),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = stringResource(R.string.results_more_classifications),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(18.dp),
                        )
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
                        .clip(RoundedCornerShape(50))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .clickable { expanded = true }
                        .padding(horizontal = 10.dp, vertical = 5.dp),
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

/** Cápsula de filtro (igual estética que StartOrderFilterPill / CategoryChip). */
@Composable
private fun ResultsPill(label: String, selected: Boolean, onClick: () -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    val bg = if (selected) primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (selected) primary else MaterialTheme.colorScheme.onSurfaceVariant
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        color = fg,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(bg)
            .semantics { role = Role.Button; this.selected = selected }
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
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
    isOneDay: Boolean,
    isEn: Boolean,
    selectedTeam: String?,
    /** Se incrementa en cada pull-to-refresh del padre; entra en la clave del
     *  LaunchedEffect para re-pedir las filas (sin él, el swipe-down no
     *  recargaba la clasificación visible porque stage.id no cambia). */
    reloadToken: Int = 0,
    onTeamsResolved: (List<String>) -> Unit,
) {
    val app = rememberApp()
    // remember SOLO por stage.id: al refrescar, `rows` conserva el valor previo
    // (la tabla anterior sigue visible) mientras el LaunchedEffect — re-clavado
    // también en reloadToken — re-pide las filas. Así no parpadea el spinner.
    var rows by remember(stage.id) { mutableStateOf<List<RaceUciResultRow>?>(null) }
    // Fallback por globalRiderId para las filas que NO casan por dorsal (CN sin
    // startlist): bandera + equipo actual + ficha, igual que `byRider` web.
    var byRider by remember(stage.id) { mutableStateOf<Map<String, ResolvedRider>>(emptyMap()) }
    // Override MANUAL de equipo (mig. 112): teamId de la fila → equipo canónico.
    var byTeamOverride by remember(stage.id) { mutableStateOf<Map<String, Team>>(emptyMap()) }

    // Etapa CANCELADA: la pestaña "Etapa" no tiene clasificación que mostrar (la
    // carrera no llegó a meta). En vez de una tabla vacía ("sin datos", que se
    // lee como un volcado que falta), el aviso explica QUÉ pasó. Es un marcador
    // sintético: no hay filas que pedir. Espejo de js/resultados.js.
    if (stage.isCancelledStage) {
        LaunchedEffect(stage.id) { onTeamsResolved(emptyList()) }
        CancelledStageNotice()
        return
    }

    LaunchedEffect(stage.id, reloadToken) {
        val loaded = runCatching { app.repository.loadResultRows(stage.id) }.getOrNull() ?: emptyList()
        // Enriquecer por globalRiderId las filas que NO resuelven por dorsal
        // (no-op si todas casan → byRider queda vacío). Espejo de la llamada a
        // `enrichRiders` en `renderClassification` (web).
        val unmatchedIds = loaded
            .filter { it.dorsalInt?.let { d -> byDorsal[d] } == null }
            .mapNotNull { it.globalRiderId }
        byRider = if (unmatchedIds.isEmpty()) emptyMap()
            else app.repository.enrichRidersByGlobalId(unmatchedIds)
        // Override de equipo: resolver los teamId de override a su equipo canónico.
        val overrideIds = loaded.mapNotNull { it.teamId }
        byTeamOverride = if (overrideIds.isEmpty()) emptyMap()
            else app.repository.enrichTeamsByIds(overrideIds)
        rows = loaded
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
        LaunchedEffect(stage.id) { onTeamsResolved(emptyList()) }
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

    if (isTtt) {
        Column {
            CarriedStandingsNotice(stage)
            ResultsTttTable(loaded, byDorsal, isEn, byRider = byRider, byTeamOverride = byTeamOverride)
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
    val sameTimeLabel = stringResource(R.string.results_same_time)
    // El slot UCI nace solo cuando haya al menos un dato. Al filtrar por equipo
    // se mantiene estable porque el contrato pertenece a la clasificación completa.
    val showUciPoints = vms.any { it.uciPoints != null }

    Column(modifier = Modifier.fillMaxWidth()) {
        CarriedStandingsNotice(stage)
        ResultsTableHeader(
            showTeam = !isTeams,
            showUciPoints = showUciPoints,
            valueHeader = valueHeader,
        )
        HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
        // m.t. dinámico: el 1º visible de cada grupo de gap muestra su gap real;
        // los siguientes con el mismo gap → m.t. (igual que applyTeamFilter web).
        var prevGap: String? = null
        visible.forEach { vm ->
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
                showTeam = !isTeams,
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

@Composable
private fun ResultsTableHeader(
    showTeam: Boolean,
    showUciPoints: Boolean,
    valueHeader: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
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
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
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
                // Chapa: en filas de corredor, la de su equipo; en la pestaña
                // Equipos, la del equipo casado por nombre (null si no casó).
                if (vm.team != null) TeamBadgeComposable(vm.team, size = 14)
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
) {
    val teams = remember(rows, byRider, byTeamOverride) { UciResultsLogic.collapseTtt(rows, byDorsal, isEn, byRider, byTeamOverride) }
    val winnerSecs = remember(teams) { UciResultsLogic.tttWinnerSecs(teams) }
    val expanded = remember(rows) { mutableStateMapOf<Int, Boolean>() }
    val teamHeader = stringResource(R.string.results_col_team)
    val timeHeader = stringResource(R.string.results_col_time)
    val showUciPoints = rows.any { it.uciPoints != null }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            HeaderCell("#", Modifier.width(32.dp))
            HeaderCell(teamHeader, Modifier.weight(1f))
            if (showUciPoints) HeaderCell("UCI", Modifier.width(44.dp), end = true)
            HeaderCell(timeHeader, Modifier.width(70.dp), end = true)
        }
        HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))

        teams.forEachIndexed { i, team ->
            val isOpen = expanded[i] == true
            // Fila de equipo (pulsable → despliega corredores).
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded[i] = !isOpen }
                    .padding(horizontal = 4.dp, vertical = 7.dp),
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
                    if (team.team != null) TeamBadgeComposable(team.team, size = 14)
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
