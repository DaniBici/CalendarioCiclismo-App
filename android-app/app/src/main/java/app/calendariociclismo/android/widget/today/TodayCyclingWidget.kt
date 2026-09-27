package app.calendariociclismo.android.widget.today

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.datastore.preferences.core.Preferences
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.drawable.toBitmap
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.currentState
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import app.calendariociclismo.android.CalendarioCiclismoApp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.widget.today.model.WidgetDayResponse
import app.calendariociclismo.android.widget.today.model.WidgetItem
import app.calendariociclismo.android.widget.today.model.WidgetNext
import app.calendariociclismo.android.widget.today.model.parseInstant
import coil3.SingletonImageLoader
import coil3.asDrawable
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import java.time.Instant
import java.time.LocalDate

/**
 * Widget «Carreras de hoy»: carretera y ciclocross del día con TV, texto en
 * directo y accesos de Hoy (copa y TV) al terminar. Sin spoilers. Datos de la
 * RPC `widget_day`; configuración por instancia (alcance y disciplina).
 */
class TodayCyclingWidget : GlanceAppWidget() {

    /** Tamaño real: el número de filas se ajusta a la altura disponible. */
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val repository = WidgetDayRepository(context)
        val initialPrefs = getAppWidgetState(context, PreferencesGlanceStateDefinition, id)
        val initial = loadSnapshot(context, repository, WidgetConfig.from(initialPrefs), initialPrefs[WidgetConfig.KEY_VERSION] ?: 0L)

        provideContent {
            // La sesión de Glance puede seguir viva entre actualizaciones: los
            // datos se recargan al cambiar la configuración o la versión que
            // incrementan el worker y la pantalla de configuración.
            val prefs = currentState<Preferences>()
            val config = WidgetConfig.from(prefs)
            val version = prefs[WidgetConfig.KEY_VERSION] ?: 0L
            var snapshot by remember { mutableStateOf(initial) }
            LaunchedEffect(config, version) {
                if (config != snapshot.config || version != snapshot.version) {
                    snapshot = loadSnapshot(context, repository, config, version)
                }
            }
            WidgetRoot(
                context = context,
                response = snapshot.result?.response,
                stale = snapshot.result?.let { it.fromCache && it.fetchedAt.isBefore(Instant.now().minusSeconds(3 * 3600)) } ?: false,
                scope = snapshot.config.scope,
                text = snapshot.text,
                flags = snapshot.flags,
            )
        }
    }

    private data class Snapshot(
        val config: WidgetConfig,
        val version: Long,
        val result: WidgetDayRepository.Result?,
        val text: WidgetText,
        val flags: Map<String, Bitmap>,
    )

    private suspend fun loadSnapshot(context: Context, repository: WidgetDayRepository, config: WidgetConfig, version: Long): Snapshot {
        val result = repository.load(config)
        val localeTag = result?.response?.locale
            ?: (context.applicationContext as? CalendarioCiclismoApp)?.preferences?.snapshotAppLocale()?.tag
            ?: "es"
        return Snapshot(config, version, result, WidgetText(context, localeTag), loadFlags(context, result?.response))
    }

    private suspend fun loadFlags(context: Context, response: WidgetDayResponse?): Map<String, Bitmap> {
        val codes = response?.days.orEmpty()
            .flatMap { day -> day.items.mapNotNull { it.countryCode } + listOfNotNull(day.next?.countryCode) }
            .map { it.lowercase() }
            .toSet()
        if (codes.isEmpty()) return emptyMap()
        val bundled = runCatching { context.assets.list("flags")?.toSet() }.getOrNull().orEmpty()
        val loader = SingletonImageLoader.get(context)
        val out = mutableMapOf<String, Bitmap>()
        for (code in codes) {
            val file = listOf(code, code.substringBefore('-')).map { "$it.svg" }.firstOrNull { it in bundled } ?: continue
            runCatching {
                val request = ImageRequest.Builder(context).data("file:///android_asset/flags/$file").size(80, 60).build()
                val res = loader.execute(request)
                if (res is SuccessResult) out[code] = res.image.asDrawable(context.resources).toBitmap(80, 60)
            }
        }
        return out
    }

    companion object {
        val WIDE = DpSize(250.dp, 110.dp)
        val LARGE = DpSize(250.dp, 260.dp)
    }
}

// ─── Paleta sobre fondo de marca (igual que iOS) ─────────────────────────────

private val WgBg = ColorProvider(day = Color(0xFF1662C5), night = Color(0xFF000000))
private val WgPrimary = ColorProvider(day = Color.White, night = Color.White)
private val WgSecondary = ColorProvider(day = Color(0xBDFFFFFF), night = Color(0xBDFFFFFF))
private val WgTertiary = ColorProvider(day = Color(0x7AFFFFFF), night = Color(0x7AFFFFFF))
private val WgDivider = ColorProvider(day = Color(0x2EFFFFFF), night = Color(0x2EFFFFFF))
private val WgBadge = ColorProvider(day = Color(0x2EFFFFFF), night = Color(0x2EFFFFFF))
private val WgLive = ColorProvider(day = Color(0xFF6DD58C), night = Color(0xFF6DD58C))

// ─── Raíz ─────────────────────────────────────────────────────────────────────

@Composable
private fun WidgetRoot(
    context: Context,
    response: WidgetDayResponse?,
    stale: Boolean,
    scope: WidgetScope,
    text: WidgetText,
    flags: Map<String, Bitmap>,
) {
    val size = LocalSize.current
    val now = Instant.now()
    val today = LocalDate.now()
    val day = response?.day(today.toString())
    val items = day?.items.orEmpty()
    val allCx = items.isNotEmpty() && items.all { it.isCx }
    val homeLink = if (allCx) "calendariociclismo://tab/cyclocross" else "calendariociclismo://tab/today"

    Box(
        modifier = GlanceModifier
            .fillMaxSize()
            .appWidgetBackground()
            .background(WgBg)
            .cornerRadius(20.dp)
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        when {
            day == null -> Message(context, homeLink, text.s(R.string.widget_unavailable), null, today, text, flags)
            items.isEmpty() -> Message(
                context,
                homeLink,
                text.s(if (scope == WidgetScope.FOLLOWED) R.string.widget_empty_followed else R.string.widget_empty),
                day.next,
                today,
                text,
                flags,
            )
            size.width < TodayCyclingWidget.WIDE.width -> SmallContent(context, items, now, text, flags, stale)
            size.height >= TodayCyclingWidget.LARGE.height ->
                ListContent(context, items, day.next, rowsFor(size.height.value, header = true), true, now, today, text, flags, stale)
            items.size == 1 -> SingleContent(context, items.first(), now, text, flags, stale)
            else -> ListContent(context, items, null, rowsFor(size.height.value, header = false), false, now, today, text, flags, stale)
        }
    }
}

/** Filas que caben en la altura disponible (≈40 dp por fila, más cabecera o pie). */
private fun rowsFor(heightDp: Float, header: Boolean): Int {
    val chrome = if (header) 60f else 44f
    return ((heightDp - chrome) / 40f).toInt().coerceIn(2, 9)
}

// ─── Pequeño: la carrera destacada ────────────────────────────────────────────

@Composable
private fun SmallContent(
    context: Context,
    items: List<WidgetItem>,
    now: Instant,
    text: WidgetText,
    flags: Map<String, Bitmap>,
    stale: Boolean,
) {
    val item = featuredItem(items, now) ?: return
    val state = item.raceState(now)
    Column(modifier = GlanceModifier.fillMaxSize().clickable(openLink(context, item.link))) {
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Flag(item.countryCode, flags, 20)
            Spacer(GlanceModifier.defaultWeight())
            if (stale) StaleDot()
        }
        Spacer(GlanceModifier.height(4.dp))
        Text(item.name, style = TextStyle(color = WgPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold), maxLines = 2)
        Text(item.detailLine(now, text), style = TextStyle(color = WgSecondary, fontSize = 11.sp), maxLines = 2)
        Spacer(GlanceModifier.defaultWeight())
        val actions = item.finishedActions(now)
        if (actions != null) {
            FinishedActions(context, actions, text, 20)
        } else {
            item.badge(now, text)?.let { BadgeView(context, it, 14) }
            if (state == WidgetRaceState.SCHEDULED || state == WidgetRaceState.LIVE) {
                item.tv?.channel?.let { Text(it, style = TextStyle(color = WgSecondary, fontSize = 10.sp), maxLines = 1) }
            }
        }
        Spacer(GlanceModifier.height(4.dp))
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Logo(14)
            Spacer(GlanceModifier.defaultWeight())
            if (items.size > 1) {
                Text("+${items.size - 1}", style = TextStyle(color = WgTertiary, fontSize = 11.sp, fontWeight = FontWeight.Medium))
            }
        }
    }
}

// ─── Ancho con una sola carrera: ficha ampliada ──────────────────────────────

@Composable
private fun SingleContent(
    context: Context,
    item: WidgetItem,
    now: Instant,
    text: WidgetText,
    flags: Map<String, Bitmap>,
    stale: Boolean,
) {
    val state = item.raceState(now)
    Column(modifier = GlanceModifier.fillMaxSize()) {
        Column(modifier = GlanceModifier.fillMaxWidth().defaultWeight().clickable(openLink(context, item.link))) {
            Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Flag(item.countryCode, flags, 20)
                Spacer(GlanceModifier.width(8.dp))
                Text(
                    item.name,
                    style = TextStyle(color = WgPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold),
                    maxLines = 1,
                    modifier = GlanceModifier.defaultWeight(),
                )
                item.category?.let {
                    Text(
                        it,
                        style = TextStyle(color = WgPrimary, fontSize = 10.sp, fontWeight = FontWeight.Medium),
                        modifier = GlanceModifier.background(WgBadge).cornerRadius(4.dp).padding(horizontal = 5.dp, vertical = 2.dp),
                    )
                }
                if (stale) {
                    Spacer(GlanceModifier.width(6.dp))
                    StaleDot()
                }
            }
            Spacer(GlanceModifier.height(2.dp))
            if (item.isCx) {
                Text(item.tournament ?: "Ciclocross", style = TextStyle(color = WgSecondary, fontSize = 11.sp), maxLines = 1)
                item.displaySessions.forEach { s ->
                    Row(modifier = GlanceModifier.fillMaxWidth()) {
                        Text(s.label ?: s.category, style = TextStyle(color = WgSecondary, fontSize = 11.sp), modifier = GlanceModifier.defaultWeight())
                        val (label, color) = when {
                            s.hasResults == true -> text.s(R.string.widget_finished) to WgSecondary
                            s.isLive(now) -> text.s(R.string.widget_session_live) to WgLive
                            else -> (text.time(s.start) ?: "") to WgPrimary
                        }
                        Text(label, style = TextStyle(color = color, fontSize = 11.sp))
                    }
                }
            } else {
                Row(modifier = GlanceModifier.fillMaxWidth()) {
                    val line = listOfNotNull(stageTypeGlyph(item.primaryType), item.detailLine(now, text).ifEmpty { null }).joinToString(" ")
                    Text(line, style = TextStyle(color = WgSecondary, fontSize = 11.sp), maxLines = 1, modifier = GlanceModifier.defaultWeight())
                    text.distance(item.distanceKm)?.let { Text(it, style = TextStyle(color = WgSecondary, fontSize = 11.sp)) }
                }
                item.route?.let { Text(it, style = TextStyle(color = WgTertiary, fontSize = 10.sp), maxLines = 1) }
            }
        }
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            val actions = item.finishedActions(now)
            if (actions != null) {
                FinishedActions(context, actions, text, 20)
            } else {
                item.badge(now, text)?.let { BadgeView(context, it, 14) }
                if (!item.isCx && (state == WidgetRaceState.SCHEDULED || state == WidgetRaceState.LIVE)) {
                    item.tv?.channel?.let {
                        Spacer(GlanceModifier.width(10.dp))
                        Text(it, style = TextStyle(color = WgSecondary, fontSize = 11.sp), maxLines = 1)
                    }
                }
            }
            Spacer(GlanceModifier.defaultWeight())
            if (!item.isCx && state != WidgetRaceState.RESULTS && state != WidgetRaceState.AWAITING) {
                text.time(item.finish)?.let {
                    IconView(R.drawable.ic_widget_finish, 12, WgSecondary)
                    Spacer(GlanceModifier.width(3.dp))
                    Text(it, style = TextStyle(color = WgSecondary, fontSize = 12.sp))
                }
            }
        }
        Spacer(GlanceModifier.height(4.dp))
        Logo(16)
    }
}

// ─── Lista (ancho con varias carreras y grande) ──────────────────────────────

@Composable
private fun ListContent(
    context: Context,
    items: List<WidgetItem>,
    next: WidgetNext?,
    maxRows: Int,
    showsHeader: Boolean,
    now: Instant,
    today: LocalDate,
    text: WidgetText,
    flags: Map<String, Bitmap>,
    stale: Boolean,
) {
    val rows = items.take(maxRows)
    val overflow = items.size - rows.size
    Column(modifier = GlanceModifier.fillMaxSize()) {
        if (showsHeader) {
            Row(modifier = GlanceModifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    (text.s(R.string.widget_today_label) + " · " + text.today(today)).uppercase(text.locale),
                    style = TextStyle(color = WgTertiary, fontSize = 11.sp, fontWeight = FontWeight.Medium),
                    modifier = GlanceModifier.defaultWeight(),
                )
                if (stale) {
                    StaleDot()
                    Spacer(GlanceModifier.width(6.dp))
                }
                Logo(16)
            }
        } else if (rows.size < maxRows) {
            Spacer(GlanceModifier.defaultWeight())
        }
        rows.forEachIndexed { index, item ->
            RaceRow(context, item, now, text, flags)
            if (index < rows.size - 1) Divider()
        }
        Spacer(GlanceModifier.defaultWeight())
        if (showsHeader && next != null && rows.size < maxRows) {
            Divider()
            NextLine(context, next, today, text, flags)
        }
        if (!showsHeader || overflow > 0) {
            Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                if (!showsHeader) {
                    Logo(16)
                    if (stale) {
                        Spacer(GlanceModifier.width(6.dp))
                        StaleDot()
                    }
                }
                Spacer(GlanceModifier.defaultWeight())
                if (overflow > 0) {
                    Text(
                        text.s(R.string.widget_more, overflow) + " ›",
                        style = TextStyle(color = WgSecondary, fontSize = 11.sp),
                        modifier = GlanceModifier.clickable(openLink(context, "calendariociclismo://tab/today")),
                    )
                }
            }
        }
    }
}

@Composable
private fun RaceRow(context: Context, item: WidgetItem, now: Instant, text: WidgetText, flags: Map<String, Bitmap>) {
    val state = item.raceState(now)
    val dimmed = state == WidgetRaceState.REST || state == WidgetRaceState.CANCELLED
    val actions = item.finishedActions(now)
    val badge = if (actions == null) item.badge(now, text) else null
    val nameColor = if (dimmed) WgSecondary else WgPrimary
    Row(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            modifier = GlanceModifier.defaultWeight().clickable(openLink(context, item.link)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(modifier = GlanceModifier.width(24.dp)) { Flag(item.countryCode, flags, 20) }
            Column(modifier = GlanceModifier.defaultWeight()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(item.name, style = TextStyle(color = nameColor, fontSize = 13.sp, fontWeight = FontWeight.Bold), maxLines = 1)
                    if (item.isCx) {
                        Spacer(GlanceModifier.width(4.dp))
                        Text(
                            "CX",
                            style = TextStyle(color = WgSecondary, fontSize = 8.sp, fontWeight = FontWeight.Bold),
                            modifier = GlanceModifier.background(WgBadge).cornerRadius(3.dp).padding(horizontal = 3.dp),
                        )
                    }
                }
                val glyph = if (!item.isCx && state != WidgetRaceState.REST) stageTypeGlyph(item.primaryType) else null
                Text(
                    listOfNotNull(glyph, item.detailLine(now, text).ifEmpty { null }).joinToString(" "),
                    style = TextStyle(color = WgSecondary, fontSize = 11.sp),
                    maxLines = 1,
                )
            }
            if (badge != null && badge.url == null) {
                Spacer(GlanceModifier.width(4.dp))
                BadgeView(context, badge, 12)
            }
        }
        if (badge?.url != null) {
            Spacer(GlanceModifier.width(4.dp))
            BadgeView(context, badge, 12)
        }
        if (actions != null) FinishedActions(context, actions, text, 18)
    }
}

@Composable
private fun NextLine(context: Context, next: WidgetNext, today: LocalDate, text: WidgetText, flags: Map<String, Bitmap>) {
    Row(
        modifier = GlanceModifier.fillMaxWidth().padding(top = 6.dp).clickable(openLink(context, next.link)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = GlanceModifier.width(24.dp)) { Flag(next.countryCode, flags, 18) }
        Column(modifier = GlanceModifier.defaultWeight()) {
            Text(
                (text.s(R.string.widget_next) + " · " + text.day(next.date, today)).uppercase(text.locale),
                style = TextStyle(color = WgTertiary, fontSize = 10.sp, fontWeight = FontWeight.Medium),
            )
            Text(
                listOfNotNull(next.name, next.stageLabel).joinToString(" · "),
                style = TextStyle(color = WgPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold),
                maxLines = 1,
            )
        }
        val tvTime = text.time(parseInstant(next.tvStartUtc))
        val startTime = text.time(parseInstant(next.startUtc))
        when {
            tvTime != null -> BadgeView(context, WidgetBadge(R.drawable.ic_widget_tv, tvTime, false), 12)
            startTime != null -> Text(startTime, style = TextStyle(color = WgSecondary, fontSize = 12.sp))
        }
    }
}

// ─── Mensajes ────────────────────────────────────────────────────────────────

@Composable
private fun Message(
    context: Context,
    homeLink: String,
    title: String,
    next: WidgetNext?,
    today: LocalDate,
    text: WidgetText,
    flags: Map<String, Bitmap>,
) {
    Column(modifier = GlanceModifier.fillMaxSize().clickable(openLink(context, homeLink))) {
        Logo(16)
        Spacer(GlanceModifier.defaultWeight())
        Text(title, style = TextStyle(color = WgPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold), maxLines = 3)
        Spacer(GlanceModifier.defaultWeight())
        if (next != null) NextLine(context, next, today, text, flags)
    }
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

@Composable
private fun BadgeView(context: Context, badge: WidgetBadge, fontSize: Int) {
    val color = if (badge.emphasized) WgLive else WgSecondary
    val modifier = badge.url?.let { GlanceModifier.clickable(openLink(context, it)) } ?: GlanceModifier
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        badge.icon?.let {
            IconView(it, fontSize, color)
            Spacer(GlanceModifier.width(3.dp))
        }
        Text(badge.text, style = TextStyle(color = color, fontSize = fontSize.sp, fontWeight = FontWeight.Medium), maxLines = 1)
    }
}

/** Copa (resultados) y TV (Revive), con la iconografía de Hoy. */
@Composable
private fun FinishedActions(context: Context, actions: Pair<String?, String?>, text: WidgetText, size: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        actions.first?.let { link ->
            Box(
                modifier = GlanceModifier.size((size + 14).dp).clickable(openLink(context, link)),
                contentAlignment = Alignment.Center,
            ) { IconView(R.drawable.ic_widget_trophy, size, WgSecondary, text.s(R.string.widget_results)) }
        }
        actions.second?.let { url ->
            Box(
                modifier = GlanceModifier.size((size + 14).dp).clickable(openLink(context, url)),
                contentAlignment = Alignment.Center,
            ) { IconView(R.drawable.ic_widget_tv, size, WgSecondary, text.s(R.string.widget_revive)) }
        }
    }
}

@Composable
private fun IconView(res: Int, size: Int, color: androidx.glance.unit.ColorProvider, description: String? = null) {
    Image(
        provider = ImageProvider(res),
        contentDescription = description,
        colorFilter = ColorFilter.tint(color),
        modifier = GlanceModifier.size(size.dp),
    )
}

@Composable
private fun Flag(code: String?, flags: Map<String, Bitmap>, width: Int) {
    val bitmap = code?.lowercase()?.let { flags[it] } ?: return
    Image(
        provider = ImageProvider(Icon.createWithBitmap(bitmap)),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = GlanceModifier.width(width.dp).height((width * 3 / 4).dp),
    )
}

/** Marca de Calendario Ciclismo (calendario + bicicleta) de la cabecera de la app. */
@Composable
private fun Logo(height: Int) {
    Image(
        provider = ImageProvider(R.drawable.ic_cc_header),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        colorFilter = ColorFilter.tint(WgPrimary),
        modifier = GlanceModifier.height(height.dp).width((height * 74 / 32).dp),
    )
}

@Composable
private fun Divider() {
    Box(modifier = GlanceModifier.fillMaxWidth().height(1.dp).background(WgDivider)) {}
}

@Composable
private fun StaleDot() {
    Box(modifier = GlanceModifier.size(6.dp).cornerRadius(3.dp).background(WgTertiary)) {}
}

/** Enlaces internos a la app y externos (texto en directo, Revive). */
private fun openLink(context: Context, url: String) = actionStartActivity(
    Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        if (url.startsWith("calendariociclismo://")) setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    },
)
