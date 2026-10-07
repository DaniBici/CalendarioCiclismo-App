package app.calendariociclismo.android.ui.today

import app.calendariociclismo.android.util.CxPresentation
import android.content.Context
import android.view.accessibility.AccessibilityManager
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.IconButton
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.SyncAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.TodayHighlight
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxTournament
import app.calendariociclismo.android.util.CyclocrossLogic
import kotlinx.coroutines.CancellationException
import app.calendariociclismo.android.ui.calendar.CalendarNavigation
import app.calendariociclismo.android.ui.components.CC_CARD_ELEVATION
import app.calendariociclismo.android.ui.components.RaceLogo
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.LocaleHolder
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Cintillo "Hoy" — carrusel horizontal con destacados editados desde panel admin
 * (tabla `today_highlights`). Aparece encima del selector de días.
 * Cada slide apunta a una jornada, startlist u orden de salida.
 *
 * Autoavance cada 5 s y navegación manual por gesto o flechas.
 */
@Composable
fun TodayHighlightsBanner(navController: NavController, scope: String = "road") {
    val app = rememberApp()
    val tapScope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<HighlightItem>>(emptyList()) }

    LaunchedEffect(scope) {
        items = runCatching { loadHighlights(app, scope) }.getOrElse { emptyList() }
    }

    AnimatedVisibility(
        visible = items.isNotEmpty(),
        enter = fadeIn(),
        exit = fadeOut(),
    ) {
        BannerCarousel(
            items = items,
            onTap = { item ->
                val race = item.race
                val tournament = item.cxTournament
                when {
                    item.highlight.targetType == "cxRace" && item.cxRace != null -> navController.navigate(Routes.cxRace(item.cxRace.id))
                    item.highlight.targetType == "cxTournament" && tournament != null ->
                        navController.navigate(Routes.cxTournament(
                            tournament.id,
                            tournament.seasonKey ?: CyclocrossLogic.season(java.time.LocalDate.now()),
                            if (LocaleHolder.shouldShowEnglishContent) tournament.nameEn?.takeIf(String::isNotBlank) ?: tournament.name else tournament.name,
                            tournament.logoUrl,
                        ))
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
                    // Calendario es pestaña: se fijan antes la subvista Temporada
                    // y el año para que CalendarScreen abra ya en ellos.
                    item.isSeason && item.highlight.seasonYear != null -> tapScope.launch {
                        app.preferences.setCalendarSubview("season")
                        CalendarNavigation.pendingSeasonYear.value = item.highlight.seasonYear
                        navController.navigate(Routes.CALENDAR) {
                            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                        }
                    }
                }
            },
        )
    }
}

internal data class HighlightItem(
    val highlight: TodayHighlight,
    val race: Race?,
    val raceDay: RaceDay?,
    val cxRace: CxRace? = null,
    val cxTournament: CxTournament? = null,
) {
    companion object {
        fun forCx(highlight: TodayHighlight, race: CxRace?): HighlightItem? =
            race?.takeIf { highlight.targetType == "cxRace" && it.id == highlight.cxRaceId && CyclocrossLogic.raceInSeason(it) }
                ?.let { HighlightItem(highlight, null, null, it) }
        fun forCxTournament(highlight: TodayHighlight, tournament: CxTournament?): HighlightItem? =
            tournament?.takeIf { highlight.targetType == "cxTournament" && it.id == highlight.cxTournamentId }
                ?.let { HighlightItem(highlight, null, null, cxTournament = it) }
    }
    val logoUrl: String? get() = cxRace?.let { app.calendariociclismo.android.util.CxPresentation.logo(it) } ?: cxTournament?.logoUrl ?: race?.logoUrl
    val accentHex: String? get() = race?.colorHex ?: cxRace?.colorHex ?: cxRace?.tournament?.colorHex ?: cxTournament?.colorHex
    val isChampionships: Boolean get() = highlight.targetType == "championships"
    val isTransfers: Boolean get() = highlight.targetType == "transfers"
    val isSeason: Boolean get() = highlight.targetType == "season"

    fun title(isEn: Boolean): String {
        val custom = if (isEn) highlight.customTitleEn ?: highlight.customTitle else highlight.customTitle
        if (!custom.isNullOrEmpty()) return custom
        race?.let { return it.localizedName }
        cxRace?.let { return if (isEn) it.nameEn?.takeIf(String::isNotBlank) ?: it.name else it.name }
        cxTournament?.let { return if (isEn) it.nameEn?.takeIf(String::isNotBlank) ?: it.name else it.name }
        if (isChampionships) return LocaleHolder.t("Campeonatos Nacionales", "National Championships")
        if (isTransfers) return LocaleHolder.t("Mercado de fichajes", "Transfer market")
        if (isSeason) highlight.seasonYear?.let { return LocaleHolder.t("Calendario $it", "$it calendar") }
        return ""
    }
    fun detailFallback(isEn: Boolean, today: String, tomorrow: String): String {
        val custom = if (isEn) highlight.customDetailEn ?: highlight.customDetail else highlight.customDetail
        if (!custom.isNullOrEmpty()) return custom
        if (isChampionships) {
            return DateFormatting.formatDateRange(ChampionshipsConfig.RANGE_START, ChampionshipsConfig.RANGE_END)
        }
        cxRace?.let { cx ->
            if (cx.endDateKey != null && cx.endDateKey != cx.dateKey) return DateFormatting.formatDateRange(cx.dateKey, cx.endDateKey)
            if (cx.dateKey == today) return if (isEn) "Today" else "Hoy"
            if (cx.dateKey == tomorrow) return if (isEn) "Tomorrow" else "Mañana"
            return DateFormatting.formatDateShort(cx.dateKey)
        }
        cxTournament?.let { return it.seasonKey.orEmpty() }
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
    scope: String = "road",
): List<HighlightItem> {
    val highlights = app.repository.todayHighlights(scope)
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

    val cxIds = highlights.filter { it.targetType == "cxRace" }.mapNotNull { it.cxRaceId }.distinct()
    // En inglés se descartan las carreras nacionales y los torneos solo
    // nacionales (CxPresentation.hiddenClasses).
    val cxRows = (try { app.supabaseService.cxRacesByIds(cxIds) } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { emptyList() })
        .filterNot(CxPresentation::isHidden)
    val cxById = cxRows.associateBy { it.id }
    val cxTournamentIds = highlights.filter { it.targetType == "cxTournament" }.mapNotNull { it.cxTournamentId }.distinct()
    val cxTournamentRows = (try { app.supabaseService.cxTournamentsByIds(cxTournamentIds) } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { emptyList() })
        .filter { app.cxRepository.tournamentIsVisible(it.id) }
    val cxTournamentById = cxTournamentRows.associateBy { it.id }
    return highlights.mapNotNull { h ->
        if (h.targetType == "cxRace") return@mapNotNull HighlightItem.forCx(h, h.cxRaceId?.let { cxById[it] })
        if (h.targetType == "cxTournament") return@mapNotNull HighlightItem.forCxTournament(h, h.cxTournamentId?.let { cxTournamentById[it] })
        val rd = h.raceDayId?.let { raceDaysById[it] }
        // Campeonatos, Fichajes y Calendario: destinos sin carrera (abren pantalla nativa).
        if (h.targetType == "championships" || h.targetType == "transfers") {
            return@mapNotNull HighlightItem(highlight = h, race = null, raceDay = null)
        }
        if (h.targetType == "season") {
            return@mapNotNull h.seasonYear?.let { HighlightItem(highlight = h, race = null, raceDay = null) }
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
) {
    val pagerState = rememberPagerState(pageCount = { items.size })
    val isEn = LocaleHolder.shouldShowEnglishContent
    val scope = rememberCoroutineScope()
    var autoAdvanceEnabled by remember(items) { mutableStateOf(true) }
    var programmaticScroll by remember { mutableStateOf(false) }
    val animationsEnabled = android.animation.ValueAnimator.areAnimatorsEnabled()
    val context = LocalContext.current
    val accessibilityManager = remember(context) {
        context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
    }
    var touchExplorationEnabled by remember(accessibilityManager) {
        mutableStateOf(accessibilityManager?.isTouchExplorationEnabled == true)
    }
    DisposableEffect(accessibilityManager) {
        val listener = AccessibilityManager.TouchExplorationStateChangeListener { enabled ->
            touchExplorationEnabled = enabled
        }
        accessibilityManager?.addTouchExplorationStateChangeListener(listener)
        onDispose {
            accessibilityManager?.removeTouchExplorationStateChangeListener(listener)
        }
    }

    // Auto-advance
    LaunchedEffect(pagerState, items.size, autoAdvanceEnabled, touchExplorationEnabled) {
        if (items.size <= 1 || !autoAdvanceEnabled || !animationsEnabled || touchExplorationEnabled) {
            return@LaunchedEffect
        }
        while (autoAdvanceEnabled) {
            delay(5000)
            val next = (pagerState.currentPage + 1) % items.size
            programmaticScroll = true
            runCatching { pagerState.animateScrollToPage(next) }
            programmaticScroll = false
        }
    }
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.isScrollInProgress }.collect { moving ->
            if (moving && !programmaticScroll) autoAdvanceEnabled = false
        }
    }

    if (items.getOrNull(pagerState.currentPage) == null) return
    val bannerBackground = MaterialTheme.colorScheme.surface

    // Tarjeta neutra (ElevatedCard de Material 3) con el radio de superficie y
    // la elevación común; sin tinte de carrera ni filete. Margen lateral
    // propio: el padre no aporta padding.
    ElevatedCard(
        shape = RoundedCornerShape(CCRadius.Surface),
        colors = CardDefaults.elevatedCardColors(containerColor = bannerBackground),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = CC_CARD_ELEVATION),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Box(modifier = Modifier.fillMaxWidth()) {
            HorizontalPager(
                state = pagerState,
                modifier = Modifier.fillMaxWidth(),
            ) { page ->
                val item = items[page]
                SlideContent(
                    item = item,
                    isEn = isEn,
                    hasControls = items.size > 1,
                    onTap = { autoAdvanceEnabled = false; onTap(item) },
                )
            }

            if (items.size > 1) {
                BannerArrow(
                    forward = false,
                    backgroundColor = bannerBackground,
                    modifier = Modifier.align(Alignment.CenterStart),
                ) {
                    autoAdvanceEnabled = false
                    val target = (pagerState.currentPage - 1 + items.size) % items.size
                    scope.launch {
                        if (animationsEnabled) pagerState.animateScrollToPage(target)
                        else pagerState.scrollToPage(target)
                    }
                }
                BannerArrow(
                    forward = true,
                    backgroundColor = bannerBackground,
                    modifier = Modifier.align(Alignment.CenterEnd),
                ) {
                    autoAdvanceEnabled = false
                    val target = (pagerState.currentPage + 1) % items.size
                    scope.launch {
                        if (animationsEnabled) pagerState.animateScrollToPage(target)
                        else pagerState.scrollToPage(target)
                    }
                }
            }
        }
    }
}

@Composable
private fun BannerArrow(
    forward: Boolean,
    backgroundColor: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    // Botón nativo sobre la propia superficie del cintillo.
    IconButton(
        onClick = onClick,
        modifier = modifier
            .width(40.dp)
            .height(48.dp)
            .background(backgroundColor),
    ) {
        Icon(
            imageVector = if (forward) Icons.AutoMirrored.Filled.KeyboardArrowRight
            else Icons.AutoMirrored.Filled.KeyboardArrowLeft,
            contentDescription = if (forward) {
                LocaleHolder.t("Destacado siguiente", "Next highlight")
            } else {
                LocaleHolder.t("Destacado anterior", "Previous highlight")
            },
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(22.dp),
        )
    }
}

@Composable
private fun SlideContent(item: HighlightItem, isEn: Boolean, hasControls: Boolean, onTap: () -> Unit) {
    val today = DateFormatting.todayKey()
    val tomorrow = remember(today) {
        val parts = today.split("-").map { it.toInt() }
        val cal = java.util.Calendar.getInstance().apply { set(parts[0], parts[1] - 1, parts[2]) }
        cal.add(java.util.Calendar.DAY_OF_YEAR, 1)
        "%04d-%02d-%02d".format(cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH) + 1, cal.get(java.util.Calendar.DAY_OF_MONTH))
    }
    val title = item.title(isEn)
    val detail = item.detailFallback(isEn, today, tomorrow)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) {
                contentDescription = "$title, $detail"
            }
            .clickable(role = Role.Button, onClick = onTap)
            .padding(
                start = if (hasControls) 40.dp else 14.dp,
                end = if (hasControls) 40.dp else 14.dp,
                top = 14.dp,
                bottom = 14.dp,
            ),
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
        } else if (item.isSeason) {
            // Mismo icono que la pestaña Calendario.
            Box(
                modifier = Modifier.size(34.dp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.CalendarMonth,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(26.dp),
                )
            }
        } else if (!item.logoUrl.isNullOrBlank()) {
            Box(
                modifier = Modifier.size(34.dp),
                contentAlignment = Alignment.Center,
            ) {
                RaceLogo(url = item.logoUrl, size = 34.dp)
            }
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            // El título utiliza todo el ancho central disponible entre el
            // identificador y la flecha lateral del carrusel. El recorte del
            // line-height + includeFontPadding=false ya viene
            // por defecto del tema (CCDefaultTextStyle vía LocalTextStyle).
            Text(
                title,
                style = CCText.S14,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            // Subtítulo + chevron en la misma fila — el chevron no compite por
            // espacio con el título.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    detail,
                    style = CCText.S13,
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

private fun parseHex(hex: String): Color? {
    val h = hex.removePrefix("#")
    if (h.length != 6) return null
    return runCatching {
        val v = h.toLong(16).toInt()
        Color(android.graphics.Color.rgb((v shr 16) and 0xFF, (v shr 8) and 0xFF, v and 0xFF))
    }.getOrNull()
}
