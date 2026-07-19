package app.calendariociclismo.android.ui.startorder

import android.os.Bundle
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.StartOrderData
import app.calendariociclismo.android.data.model.StartOrderEntry
import app.calendariociclismo.android.data.model.StartOrderRaceDay
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CountryFlag
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.stage.StageInfoHeaderCard
import app.calendariociclismo.android.util.LocaleHolder
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private sealed class StartOrderState {
    object Loading : StartOrderState()
    data class Ready(val data: StartOrderData) : StartOrderState()
    data class Error(val message: String) : StartOrderState()
    object Empty : StartOrderState()
}

private enum class StartOrderFilter { ALL, TT, GC }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StartOrderScreen(
    raceDayId: String,
    navController: NavController,
) {
    val app = rememberApp()
    var state by remember { mutableStateOf<StartOrderState>(StartOrderState.Loading) }
    var filter by remember { mutableStateOf(StartOrderFilter.ALL) }
    var isRefreshing by remember { mutableStateOf(false) }
    val unknownError = stringResource(R.string.startlist_error_unknown)

    suspend fun load() {
        runCatching { app.repository.loadStartOrderData(raceDayId) }
            .onSuccess { data ->
                state = if (data == null) StartOrderState.Empty else StartOrderState.Ready(data)
            }
            .onFailure { error ->
                state = StartOrderState.Error(error.message ?: unknownError)
            }
    }

    LaunchedEffect(raceDayId) { load() }

    LaunchedEffect(state) {
        val ready = state as? StartOrderState.Ready ?: return@LaunchedEffect
        app.analytics.logScreenView(
            "start_order",
            Bundle().apply {
                putString("race_day_id", raceDayId)
                putString("race_name", ready.data.race?.name.orEmpty())
                ready.data.fullRaceDay?.let { putString("stage_name", it.stageLabel) }
            }
        )
    }

    val pullRefreshState = rememberPullToRefreshState()

    // Sin TopAppBar: la flecha de back va integrada en `StageInfoHeaderCard`
    // (misma cabecera que la vista de perfil) para paridad con el resto de
    // detalles de jornada.
    Scaffold { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (val current = state) {
                is StartOrderState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator()
                }
                is StartOrderState.Error -> Text(
                    current.message,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    color = MaterialTheme.colorScheme.error,
                )
                is StartOrderState.Empty -> Text(
                    stringResource(R.string.start_order_empty),
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                is StartOrderState.Ready -> {
                    PullToRefreshBox(
                        isRefreshing = isRefreshing,
                        onRefresh = { isRefreshing = true },
                        state = pullRefreshState,
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        LaunchedEffect(isRefreshing) {
                            if (isRefreshing) {
                                delay(300)
                                load()
                                isRefreshing = false
                            }
                        }
                        StartOrderContent(
                            data = current.data,
                            filter = filter,
                            onFilterChange = { filter = it },
                            onBack = { navController.popBackStack() },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StartOrderContent(
    data: StartOrderData,
    filter: StartOrderFilter,
    onFilterChange: (StartOrderFilter) -> Unit,
    onBack: () -> Unit,
) {
    val raceDay = data.raceDay
    // CRE (contrarreloj por equipos): salen equipos, no corredores. La vista
    // muestra solo Salida + Equipo (sin dorsal, sin bandera, sin corredor) y
    // sin los filtros TT/GC (que se basan en dorsales de corredor).
    val isTtt = raceDay.primaryType == "ttt"
    val ttSet = raceDay.startOrderTtDorsals?.toSet().orEmpty()
    val gcSet = raceDay.startOrderGcDorsals?.toSet().orEmpty()
    val hasTt = !isTtt && ttSet.isNotEmpty()
    val hasGc = !isTtt && gcSet.isNotEmpty()
    val hasAnyFilter = hasTt || hasGc

    val filtered = when (filter) {
        StartOrderFilter.ALL -> data.entries
        StartOrderFilter.TT  -> data.entries.filter { it.dorsal in ttSet }
        StartOrderFilter.GC  -> data.entries.filter { it.dorsal in gcSet }
    }

    val userTz = TimeZone.getDefault()
    val raceTzId = raceDay.timezone
    val raceTz = raceTzId?.let { runCatching { TimeZone.getTimeZone(it) }.getOrNull() }
    val shouldConvert = raceTz != null && raceTz.id != userTz.id && data.entries.isNotEmpty() && run {
        val probe = raceLocalInstant(raceDay.effectiveDate, data.entries.first().startTime, raceTz)
        probe != null && formatTime(probe, raceTz) != formatTime(probe, userTz)
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Header igual al de perfil (StageInfoHeaderCard) — paridad visual.
        item {
            if (data.fullRaceDay != null) {
                StageInfoHeaderCard(
                    raceDay = data.fullRaceDay,
                    race = data.race,
                    onBack = onBack,
                )
            }
        }
        if (hasAnyFilter) {
            item {
                StartOrderFilterBar(
                    filter = filter,
                    onFilterChange = onFilterChange,
                    hasTt = hasTt,
                    hasGc = hasGc
                )
            }
        }
        if (shouldConvert) {
            item {
                StartOrderTimezoneNote(
                    userTz = userTz,
                    raceTz = raceTz!!,
                    rdDate = raceDay.effectiveDate,
                    locationLabel = headerLocationLabel(raceDay, raceTzId),
                )
            }
        }
        item { StartOrderTableHeader(isTtt = isTtt) }
        // Filas como UN SOLO item del LazyColumn — meterlas como items
        // independientes hacía que el `spacedBy(16.dp)` del LazyColumn se
        // aplicara entre cada [fila + divider], generando 16dp de aire
        // encima del nombre que rompía la simetría con el divider inferior.
        item {
            Column {
                val rowLocationLabel = headerLocationLabel(raceDay, raceTzId)
                filtered.forEach { entry ->
                    StartOrderRow(
                        entry = entry,
                        rdDate = raceDay.effectiveDate,
                        userTz = userTz,
                        raceTz = raceTz.takeIf { shouldConvert },
                        isTtt = isTtt,
                        locationLabel = rowLocationLabel,
                    )
                    HorizontalDivider(
                        thickness = 0.5.dp,
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
                    )
                }
            }
        }
    }
}

// El header propio se reemplazó por `StageInfoHeaderCard` (importado de
// ui/stage) para paridad visual total con la vista de perfil.

@Composable
private fun StartOrderFilterBar(
    filter: StartOrderFilter,
    onFilterChange: (StartOrderFilter) -> Unit,
    hasTt: Boolean,
    hasGc: Boolean,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StartOrderFilterPill(
            label = stringResource(R.string.start_order_filter_all),
            selected = filter == StartOrderFilter.ALL,
            onClick = { onFilterChange(StartOrderFilter.ALL) },
        )
        if (hasTt) StartOrderFilterPill(
            label = stringResource(R.string.start_order_filter_tt),
            selected = filter == StartOrderFilter.TT,
            onClick = { onFilterChange(StartOrderFilter.TT) },
        )
        if (hasGc) StartOrderFilterPill(
            label = stringResource(R.string.start_order_filter_gc),
            selected = filter == StartOrderFilter.GC,
            onClick = { onFilterChange(StartOrderFilter.GC) },
        )
    }
}

/**
 * Pill de filtro con la estética canónica de la app (igual que `CategoryChip`
 * de Hoy/Mes/Temporada): cápsula redondeada, fondo surfaceVariant, seleccionado
 * con primary al 15% + texto SemiBold. Sustituye al `FilterChip` de M3, que
 * desentonaba con su borde y check propios.
 */
@Composable
private fun StartOrderFilterPill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val primary = MaterialTheme.colorScheme.primary
    val background = if (selected) primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant
    val foreground = if (selected) primary else MaterialTheme.colorScheme.onSurfaceVariant
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        color = foreground,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(background)
            .semantics {
                role = Role.Button
                this.selected = selected
            }
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

@Composable
private fun StartOrderTimezoneNote(
    userTz: TimeZone,
    raceTz: TimeZone,
    rdDate: String?,
    locationLabel: String,
) {
    val refDate = rdDate?.let {
        runCatching {
            SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(it)
        }.getOrNull()
    } ?: Date()
    val userOffset = tzOffsetLabel(userTz, refDate)
    val raceOffset = tzOffsetLabel(raceTz, refDate)
    // Nota informativa neutra en CCCard (antes Card surfaceVariant 60%).
    CCCard(cornerRadius = 12) {
        Text(
            stringResource(R.string.start_order_tz_note, userOffset, locationLabel, raceOffset),
            modifier = Modifier.padding(10.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun StartOrderTableHeader(isTtt: Boolean) {
    Row(
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            stringResource(R.string.start_order_col_time),
            modifier = Modifier.width(72.dp),
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (isTtt) {
            // CRE: solo Salida + Equipo.
            Text(
                stringResource(R.string.start_order_col_team),
                modifier = Modifier.weight(1f),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Text(
                stringResource(R.string.start_order_col_bib),
                modifier = Modifier.width(36.dp),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                stringResource(R.string.start_order_col_rider),
                modifier = Modifier.weight(1f),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StartOrderRow(
    entry: StartOrderEntry,
    rdDate: String?,
    userTz: TimeZone,
    raceTz: TimeZone?,
    isTtt: Boolean,
    locationLabel: String,
) {
    val timeData = if (raceTz != null) {
        convertedTime(rdDate, entry.startTime, raceTz, userTz)
    } else {
        entry.startTime to null
    }
    val hasName = !entry.riderName.isNullOrEmpty()
    val hasTeam = !entry.teamName.isNullOrEmpty()

    // Solo es interactivo cuando se está convirtiendo a hora del usuario
    // (raceTz != null): si no, la hora mostrada YA es la oficial de la sede.
    // Al tocar, tooltip con la hora oficial original — paridad con iOS y con
    // el tooltip `title=` de la web.
    val tooltipState = rememberTooltipState(isPersistent = false)
    val scope = rememberCoroutineScope()
    val tooltipText = if (locationLabel.isEmpty()) {
        stringResource(R.string.start_order_tz_tooltip_no_loc, entry.startTime)
    } else {
        stringResource(R.string.start_order_tz_tooltip, entry.startTime, locationLabel)
    }

    // El padding VERTICAL se aplica DENTRO de la Column corredor (no en el
    // Row exterior) para que sea el mismo arriba y abajo respecto a los
    // dividers de la tabla. El Row padre sin padding vertical hace que hora
    // y dorsal se centren respecto a la altura real de la Column corredor.
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val timeRow: @Composable () -> Unit = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                timeData.second?.let {
                    Text(
                        it,
                        fontSize = 10.sp,
                        lineHeight = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
                Text(
                    timeData.first,
                    fontSize = 12.sp,
                    lineHeight = 14.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                )
            }
        }
        if (raceTz != null) {
            TooltipBox(
                positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
                tooltip = { PlainTooltip { Text(tooltipText) } },
                state = tooltipState,
                modifier = Modifier
                    .width(72.dp)
                    .clickable { scope.launch { tooltipState.show() } },
            ) {
                timeRow()
            }
        } else {
            Box(modifier = Modifier.width(72.dp)) { timeRow() }
        }
        if (isTtt) {
            // CRE: solo el nombre del equipo (sin dorsal, sin bandera, sin corredor).
            Text(
                if (hasTeam) entry.teamName!! else "—",
                fontSize = 14.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (hasTeam) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 8.dp),
            )
        } else {
            Text(
                entry.dorsal.toString(),
                fontSize = 12.sp,
                lineHeight = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.width(36.dp),
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    entry.countryCode?.takeIf { it.isNotEmpty() }?.let {
                        CountryFlag(countryCode = it)
                    }
                    Text(
                        if (hasName) entry.riderName!! else "—",
                        fontSize = 14.sp,
                        lineHeight = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (hasName) MaterialTheme.colorScheme.onSurface
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                entry.teamName?.takeIf { it.isNotEmpty() }?.let {
                    Text(
                        it,
                        fontSize = 12.sp,
                        lineHeight = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

// MARK: - Helpers

private fun raceLocalInstant(date: String?, time: String?, tz: TimeZone): Date? {
    if (date.isNullOrEmpty() || time.isNullOrEmpty()) return null
    val dateParts = runCatching { date.split("-").map { it.toInt() } }.getOrNull()?.takeIf { it.size == 3 }
        ?: return null
    val tParts = runCatching { time.split(":").map { it.toInt() } }.getOrNull() ?: return null
    val cal = Calendar.getInstance(tz)
    cal.set(dateParts[0], dateParts[1] - 1, dateParts[2], tParts[0], tParts.getOrElse(1) { 0 }, tParts.getOrElse(2) { 0 })
    cal.set(Calendar.MILLISECOND, 0)
    return cal.time
}

private fun formatTime(date: Date, tz: TimeZone): String {
    val f = SimpleDateFormat("HH:mm:ss", Locale.US)
    f.timeZone = tz
    return f.format(date)
}

private fun convertedTime(rdDate: String?, raceTime: String, raceTz: TimeZone, userTz: TimeZone): Pair<String, String?> {
    val instant = raceLocalInstant(rdDate, raceTime, raceTz) ?: return raceTime to null
    val userStr = formatTime(instant, userTz)
    val calUser = Calendar.getInstance(userTz).apply { time = instant }
    val userKey = "%04d-%02d-%02d".format(
        calUser.get(Calendar.YEAR),
        calUser.get(Calendar.MONTH) + 1,
        calUser.get(Calendar.DAY_OF_MONTH)
    )
    val shift = if (rdDate != null && userKey != rdDate) {
        val baseFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = userTz }
        val d1 = baseFmt.parse(rdDate)
        val d2 = baseFmt.parse(userKey)
        if (d1 != null && d2 != null) {
            val diff = ((d2.time - d1.time) / (24L * 3600 * 1000)).toInt()
            (if (diff > 0) "+" else "") + diff + "d"
        } else null
    } else null
    return userStr to shift
}

private fun tzOffsetLabel(tz: TimeZone, atDate: Date): String {
    val secs = tz.getOffset(atDate.time) / 1000
    val sign = if (secs >= 0) "+" else "-"
    val absMin = kotlin.math.abs(secs) / 60
    val h = absMin / 60
    val m = absMin % 60
    return if (m == 0) "GMT$sign$h" else "GMT$sign$h:%02d".format(m)
}

private fun headerLocationLabel(rd: StartOrderRaceDay, raceTzId: String?): String {
    val isEn = LocaleHolder.shouldShowEnglishContent
    val loc = if (isEn) rd.startLocationEn ?: rd.startLocation else rd.startLocation
    if (!loc.isNullOrEmpty()) return loc
    return raceTzId?.substringAfterLast('/')?.replace('_', ' ') ?: ""
}
