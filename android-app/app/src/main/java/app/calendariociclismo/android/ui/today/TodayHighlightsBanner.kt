package app.calendariociclismo.android.ui.today

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.SyncAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.TodayHighlight
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.LocaleHolder
import kotlinx.coroutines.delay

/**
 * Cintillo "Hoy" — carrusel horizontal con destacados editados desde panel admin
 * (tabla `today_highlights`). Aparece encima del selector de días.
 * Cada slide apunta a una jornada, startlist u orden de salida.
 *
 * Auto-advance cada 5s + swipe manual + dismiss persistente por hash de contenido.
 */
@Composable
fun TodayHighlightsBanner(navController: NavController) {
    val app = rememberApp()
    val context = LocalContext.current
    var items by remember { mutableStateOf<List<HighlightItem>>(emptyList()) }
    var dismissedHash by remember { mutableStateOf(loadDismissedHash(context)) }

    LaunchedEffect(Unit) {
        items = runCatching { loadHighlights(app) }.getOrElse { emptyList() }
    }

    val contentHash = remember(items) {
        items.joinToString("|") { "${it.highlight.id}:${it.highlight.targetType}:${it.highlight.position}:${it.highlight.updatedAt ?: ""}" }
    }
    val shouldShow = items.isNotEmpty() && dismissedHash != contentHash

    AnimatedVisibility(
        visible = shouldShow,
        enter = fadeIn(),
        exit = fadeOut(),
    ) {
        BannerCarousel(
            items = items,
            onTap = { item ->
                val race = item.race
                when {
                    item.highlight.targetType == "raceDay" && item.raceDay != null && race != null ->
                        // raceId pasado para que StageScreen pueda hidratar Room
                        // si la jornada no está cacheada localmente.
                        navController.navigate(Routes.stage(item.raceDay.id, race.id))
                    item.highlight.targetType == "race" && race != null ->
                        navController.navigate(Routes.race(race.id))
                    item.highlight.targetType == "startlist" && race != null ->
                        navController.navigate(Routes.startlist(race.id))
                    item.highlight.targetType == "startOrder" && item.raceDay != null ->
                        navController.navigate(Routes.startOrder(item.raceDay.id))
                    item.highlight.targetType == "championships" ->
                        navController.navigate(Routes.CHAMPIONSHIPS)
                    item.highlight.targetType == "transfers" ->
                        navController.navigate(Routes.TRANSFERS_HIGHLIGHT)
                }
            },
            onDismiss = {
                saveDismissedHash(context, contentHash)
                dismissedHash = contentHash
            },
        )
    }
}

private data class HighlightItem(
    val highlight: TodayHighlight,
    val race: Race?,
    val raceDay: RaceDay?,
) {
    val isChampionships: Boolean get() = highlight.targetType == "championships"
    val isTransfers: Boolean get() = highlight.targetType == "transfers"

    fun title(isEn: Boolean): String {
        val custom = if (isEn) highlight.customTitleEn ?: highlight.customTitle else highlight.customTitle
        if (!custom.isNullOrEmpty()) return custom
        race?.let { return it.localizedName }
        if (isChampionships) return LocaleHolder.t("Campeonatos Nacionales", "National Championships")
        if (isTransfers) return LocaleHolder.t("Mercado de Fichajes", "Transfer market")
        return ""
    }
    fun detailFallback(isEn: Boolean, today: String, tomorrow: String): String {
        val custom = if (isEn) highlight.customDetailEn ?: highlight.customDetail else highlight.customDetail
        if (!custom.isNullOrEmpty()) return custom
        if (isChampionships) {
            return DateFormatting.formatDateRange(ChampionshipsConfig.RANGE_START, ChampionshipsConfig.RANGE_END)
        }
        raceDay?.let { rd ->
            if (rd.dateKey == today)     return if (isEn) "Today"    else "Hoy"
            if (rd.dateKey == tomorrow)  return if (isEn) "Tomorrow" else "Mañana"
            return DateFormatting.formatDateShort(rd.dateKey)
        }
        return race?.startDate.orEmpty()
    }
}

private suspend fun loadHighlights(
    app: app.calendariociclismo.android.CalendarioCiclismoApp,
): List<HighlightItem> {
    val highlights = app.repository.todayHighlights()
    if (highlights.isEmpty()) return emptyList()

    val raceIds = highlights.mapNotNull { it.raceId }.distinct()
    val rdIds   = highlights.mapNotNull { it.raceDayId }.distinct()

    val races    = if (raceIds.isNotEmpty()) app.repository.racesByIds(raceIds) else emptyList()
    val raceDays = if (rdIds.isNotEmpty())   app.repository.raceDaysByIds(rdIds) else emptyList()

    val racesById = races.associateBy { it.id }.toMutableMap()
    val raceDaysById = raceDays.associateBy { it.id }

    // Para entradas con solo raceDayId, traer carrera padre si falta
    val missingParents = raceDays.mapNotNull { it.raceId }.distinct().filterNot { racesById.containsKey(it) }
    if (missingParents.isNotEmpty()) {
        app.repository.racesByIds(missingParents).forEach { racesById[it.id] = it }
    }

    return highlights.mapNotNull { h ->
        val rd = h.raceDayId?.let { raceDaysById[it] }
        // Campeonatos y Fichajes: destinos sin carrera (abren pantalla nativa).
        if (h.targetType == "championships" || h.targetType == "transfers") {
            return@mapNotNull HighlightItem(highlight = h, race = null, raceDay = null)
        }
        val race = when {
            h.raceId != null     -> racesById[h.raceId]
            rd?.raceId != null   -> racesById[rd.raceId]
            else                 -> null
        } ?: return@mapNotNull null
        HighlightItem(highlight = h, race = race, raceDay = rd)
    }
}

@Composable
private fun BannerCarousel(
    items: List<HighlightItem>,
    onTap: (HighlightItem) -> Unit,
    onDismiss: () -> Unit,
) {
    val pagerState = rememberPagerState(pageCount = { items.size })
    val isEn = LocaleHolder.shouldShowEnglishContent

    // Auto-advance
    LaunchedEffect(pagerState, items.size) {
        if (items.size <= 1) return@LaunchedEffect
        while (true) {
            delay(5000)
            val next = (pagerState.currentPage + 1) % items.size
            runCatching { pagerState.animateScrollToPage(next) }
        }
    }

    val current = items.getOrNull(pagerState.currentPage) ?: return
    val accentColor = current.race?.colorHex?.let { parseHex(it) } ?: MaterialTheme.colorScheme.primary

    // Tarjeta estilo "App Store Today" — paridad con iOS pero idiomática
    // Material 3: ElevatedCard con elevación tonal en vez del blur de iOS.
    // El color de marca es un ACENTO (tinte 7% del contenedor + dot activo),
    // no el fondo a sangre. Margen lateral propio: el padre no aporta padding.
    ElevatedCard(
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.elevatedCardColors(),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 2.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                // Tinte de marca muy leve sobre el contenedor de la card.
                .background(accentColor.copy(alpha = 0.07f)),
        ) {
            Column {
                HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxWidth(),
                ) { page ->
                    val item = items[page]
                    SlideContent(
                        item = item,
                        isEn = isEn,
                        hasDots = items.size > 1,
                        onTap = { onTap(item) },
                    )
                }

                // Indicador de página (dots) — el activo con color de marca.
                if (items.size > 1) {
                    PageDots(
                        count = items.size,
                        current = pagerState.currentPage,
                        accent = accentColor,
                        modifier = Modifier
                            .align(Alignment.CenterHorizontally)
                            .padding(bottom = 10.dp),
                    )
                }
            }

            // X de cierre — discreta, sin caja, top-end.
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(30.dp),
            ) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = stringResource(R.string.today_highlight_dismiss),
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f),
                )
            }
        }
    }
}

/** Indicador de página estilo iOS: punto activo con color de marca, resto tenue. */
@Composable
private fun PageDots(
    count: Int,
    current: Int,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { idx ->
            val active = idx == current
            Box(
                modifier = Modifier
                    .size(if (active) 7.dp else 6.dp)
                    .clip(CircleShape)
                    .background(
                        if (active) accent
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.28f)
                    ),
            )
        }
    }
}

@Composable
private fun SlideContent(item: HighlightItem, isEn: Boolean, hasDots: Boolean, onTap: () -> Unit) {
    val today = DateFormatting.todayKey()
    val tomorrow = remember(today) {
        val parts = today.split("-").map { it.toInt() }
        val cal = java.util.Calendar.getInstance().apply { set(parts[0], parts[1] - 1, parts[2]) }
        cal.add(java.util.Calendar.DAY_OF_YEAR, 1)
        "%04d-%02d-%02d".format(cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH) + 1, cal.get(java.util.Calendar.DAY_OF_MONTH))
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onTap)
            // Padding inferior menor cuando hay dots debajo, para que el bloque
            // no quede descompensado verticalmente.
            .padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = if (hasDots) 12.dp else 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Slot de logo de tamaño fijo (34dp): reserva el espacio aunque el logo
        // aún no haya cargado, evitando saltos de layout. Cuando NO hay logo (ni
        // icono de campeonatos) no se emite nada: el slot no ocupa espacio y el
        // texto se desplaza a la izquierda a ocuparlo (el spacing del Row solo
        // se aplica entre hijos que sí emiten). Paridad con iOS.
        if (item.isChampionships) {
            // Mismo logo que la fila de Campeonatos de Mes/Temporada: el globo
            // Europa/África (`ic_globe_europe_africa`) teñido con el accent, en vez
            // del antiguo `Icons.Filled.Flag`. Paridad con iOS.
            Box(
                modifier = Modifier.size(34.dp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_globe_europe_africa),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(26.dp),
                )
            }
        } else if (item.isTransfers) {
            // Mismo icono que la pestaña Fichajes (flechas de intercambio).
            Box(
                modifier = Modifier.size(34.dp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.SyncAlt,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(26.dp),
                )
            }
        } else if (!item.race?.logoUrl.isNullOrBlank()) {
            Box(
                modifier = Modifier.size(34.dp),
                contentAlignment = Alignment.Center,
            ) {
                RaceLogo(url = item.race?.logoUrl, size = 34.dp)
            }
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            // Título con padding derecho propio (32dp) para no chocar con la X.
            // El recorte del line-height + includeFontPadding=false ya viene
            // por defecto del tema (CCDefaultTextStyle vía LocalTextStyle).
            Text(
                item.title(isEn),
                // Mismo peso que el título del día en la barra superior (Medium).
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                lineHeight = 16.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(end = 32.dp),
            )
            // Subtítulo + chevron en la misma fila — el chevron no compite por
            // espacio con el título.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    item.detailFallback(isEn, today, tomorrow),
                    fontWeight = FontWeight.Normal,
                    fontSize = 12.sp,
                    lineHeight = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    modifier = Modifier.size(12.dp),
                )
            }
        }
    }
}

// ─── Helpers ────────────────────────────────────────────────────────

private const val PREF_FILE = "today_highlights_prefs"
private const val PREF_KEY = "dismissed_hash"

private fun loadDismissedHash(context: android.content.Context): String? =
    context.getSharedPreferences(PREF_FILE, android.content.Context.MODE_PRIVATE)
        .getString(PREF_KEY, null)

private fun saveDismissedHash(context: android.content.Context, hash: String) {
    context.getSharedPreferences(PREF_FILE, android.content.Context.MODE_PRIVATE)
        .edit().putString(PREF_KEY, hash).apply()
}

private fun parseHex(hex: String): Color? {
    val h = hex.removePrefix("#")
    if (h.length != 6) return null
    return runCatching {
        val v = h.toLong(16).toInt()
        Color(android.graphics.Color.rgb((v shr 16) and 0xFF, (v shr 8) and 0xFF, v and 0xFF))
    }.getOrNull()
}
