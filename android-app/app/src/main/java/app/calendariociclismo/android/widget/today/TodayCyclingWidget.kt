package app.calendariociclismo.android.widget.today

import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.net.Uri
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.drawable.toBitmap
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.provideContent
import androidx.glance.background
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
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.color.ColorProvider
import app.calendariociclismo.android.R
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.widget.today.model.TodayWidgetItem
import app.calendariociclismo.android.widget.today.model.TodayWidgetPayload
import app.calendariociclismo.android.widget.today.model.WidgetState
import coil3.SingletonImageLoader
import coil3.asDrawable
import coil3.request.ImageRequest
import coil3.request.SuccessResult

class TodayCyclingWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val payload = TodayWidgetRepository(context).buildPayload()
        val flagBitmaps = loadFlagBitmaps(context, payload)

        provideContent {
            GlanceTheme {
                WidgetRoot(context, payload, flagBitmaps)
            }
        }
    }

    private suspend fun loadFlagBitmaps(
        context: Context,
        payload: TodayWidgetPayload,
    ): Map<String, Bitmap> {
        val codes = mutableSetOf<String>()
        when (val s = payload.state) {
            is WidgetState.HasRaces -> s.items.forEach { it.countryCode?.let(codes::add) }
            is WidgetState.RestDay -> s.countryCode?.let(codes::add)
            is WidgetState.Cancelled -> s.countryCode?.let(codes::add)
            else -> Unit
        }
        val result = mutableMapOf<String, Bitmap>()
        for (code in codes) {
            loadFlagBitmap(context, code)?.let { result[code] = it }
        }
        return result
    }

    private suspend fun loadFlagBitmap(context: Context, countryCode: String): Bitmap? {
        val code = countryCode.lowercase()
        if (code.isEmpty()) return null
        return try {
            val loader = SingletonImageLoader.get(context)
            val request = ImageRequest.Builder(context)
                .data("file:///android_asset/flags/$code.svg")
                .size(80, 60)
                .build()
            val res = loader.execute(request)
            if (res is SuccessResult) {
                res.image.asDrawable(context.resources).toBitmap(80, 60)
            } else null
        } catch (_: Exception) {
            null
        }
    }
}

// ─── Paleta fija oscura — igual que iOS (siempre dark, fondo siempre negro/accent) ─

// day: accentColor(#1A73E8).mix(with: .black, by: 0.15) — igual que iOS light mode
// night: negro puro — igual que iOS dark mode
private val WgBg = ColorProvider(
    day   = Color(0xFF1662C5),
    night = Color(0xFF000000),
)
private val WgWhite   = ColorProvider(day = Color.White,            night = Color.White)
private val WgText    = WgWhite
private val WgAccent  = WgWhite
private val WgWarning = WgWhite
private val WgDivider = ColorProvider(day = Color(0x33FFFFFF),      night = Color(0x33FFFFFF))

// ─── Raíz ─────────────────────────────────────────────────────────────────────

@Composable
private fun WidgetRoot(context: Context, payload: TodayWidgetPayload, flags: Map<String, Bitmap>) {
    Box(
        modifier = GlanceModifier
            .fillMaxSize()
            .appWidgetBackground()
            .background(WgBg)
            .padding(16.dp),
        contentAlignment = Alignment.Center,
    ) {
        when (val s = payload.state) {
            is WidgetState.HasRaces ->
                if (s.items.all { it.isFinished })
                    AllCompletedContent(context)
                else if (s.items.size == 1)
                    SingleRaceContent(context, s.items[0], flags)
                else
                    MultiRaceContent(context, s.items, s.overflowCount, flags)
            is WidgetState.RestDay ->
                SpecialStateContent(context, s.raceName, s.countryCode, "Jornada de descanso", flags)
            is WidgetState.Cancelled ->
                SpecialStateContent(context, s.raceName, s.countryCode, "Jornada anulada", flags, isWarning = true)
            is WidgetState.Empty -> EmptyContent(context)
            WidgetState.Syncing -> SyncingContent()
        }
    }
}

// ─── Estado single (1 carrera activa con TV confirmada) ───────────────────────

@Composable
private fun SingleRaceContent(
    context: Context,
    item: TodayWidgetItem,
    flags: Map<String, Bitmap>,
) {
    val textColor = WgText
    val intent = deepLinkIntent(context, "calendariociclismo://stage/${item.raceDayId}")

    Column(
        modifier = GlanceModifier.fillMaxSize().clickable(actionStartActivity(intent)),
        verticalAlignment = Alignment.Vertical.Top,
    ) {
        // Cabecera: bandera + nombre en mayúsculas + categoría UCI
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.Vertical.CenterVertically,
        ) {
            FlagImage(item.countryCode, flags)
            Spacer(GlanceModifier.width(8.dp))
            Text(
                text = item.raceName,
                style = TextStyle(color = textColor, fontSize = 13.sp, fontWeight = FontWeight.Bold),
                maxLines = 1,
                modifier = GlanceModifier.defaultWeight(),
            )
            if (!item.uciCategory.isNullOrEmpty()) {
                Spacer(GlanceModifier.width(4.dp))
                Text(
                    text = item.uciCategory,
                    style = TextStyle(color = WgAccent, fontSize = 10.sp),
                )
            }
        }
        Spacer(GlanceModifier.height(2.dp))
        // Etapa + tipo completo (primary · secondary) + kilómetros a la derecha
        val stageLine = buildStageLine(item)
        val distanceText = item.distanceKm?.let { km ->
            if (km % 1.0 == 0.0) "${km.toInt()} km" else String.format("%.1f km", km)
        }
        if (stageLine.isNotEmpty() || distanceText != null) {
            Row(
                modifier = GlanceModifier.fillMaxWidth(),
                verticalAlignment = Alignment.Vertical.CenterVertically,
            ) {
                Text(
                    text = stageLine,
                    style = TextStyle(color = WgText, fontSize = 11.sp),
                    maxLines = 1,
                    modifier = GlanceModifier.defaultWeight(),
                )
                if (distanceText != null) {
                    Text(
                        text = distanceText,
                        style = TextStyle(color = WgText, fontSize = 11.sp),
                    )
                }
            }
        }
        // Ciudades de salida y llegada
        val route = item.routeDescription
        if (route != null) {
            Text(
                text = route,
                style = TextStyle(color = WgText, fontSize = 10.sp),
                maxLines = 1,
            )
        }
        Spacer(GlanceModifier.defaultWeight())
        // Badge de cobertura (izquierda) + hora de llegada estimada (derecha)
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.Vertical.CenterVertically,
        ) {
            val badge = coverageBadge(item)
            if (badge != null) {
                Text(
                    text = badge,
                    style = TextStyle(color = textColor, fontSize = 14.sp),
                )
            }
            Spacer(GlanceModifier.defaultWeight())
            val finishTime = item.estimatedFinishTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
            if (finishTime != null) {
                Text(
                    text = "🏁 $finishTime",
                    style = TextStyle(color = WgText, fontSize = 14.sp),
                )
            }
        }
        Spacer(GlanceModifier.height(4.dp))
        // Logo de la app en pie de vista
        Row(modifier = GlanceModifier.fillMaxWidth()) {
            Image(
                provider = ImageProvider(R.drawable.ic_launcher_foreground),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = GlanceModifier.height(22.dp).width(22.dp),
            )
            Spacer(GlanceModifier.defaultWeight())
        }
    }
}

// ─── Estado multi (2–3 carreras activas) ─────────────────────────────────────

@Composable
private fun MultiRaceContent(
    context: Context,
    items: List<TodayWidgetItem>,
    overflow: Int,
    flags: Map<String, Bitmap>,
) {
    Column(modifier = GlanceModifier.fillMaxSize()) {
        // Con < 3 carreras centrar verticalmente (spacer flexible en cabeza)
        if (items.size < 3) Spacer(GlanceModifier.defaultWeight())

        items.forEachIndexed { idx, item ->
            CompactRaceRow(context, item, flags)
            if (idx < items.size - 1) {
                Box(modifier = GlanceModifier.fillMaxWidth().height(1.dp).background(WgDivider)) {}
            }
        }

        Spacer(GlanceModifier.defaultWeight())

        // Pie: logo + contador de desbordamiento
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.Vertical.CenterVertically,
        ) {
            Image(
                provider = ImageProvider(R.drawable.ic_launcher_foreground),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = GlanceModifier.height(22.dp).width(22.dp),
            )
            Spacer(GlanceModifier.defaultWeight())
            if (overflow > 0) {
                val overflowIntent = deepLinkIntent(context, "calendariociclismo://tab/today")
                Text(
                    text = "+$overflow más ›",
                    style = TextStyle(color = WgText, fontSize = 11.sp),
                    modifier = GlanceModifier.clickable(actionStartActivity(overflowIntent)),
                )
            }
        }
    }
}

@Composable
private fun CompactRaceRow(
    context: Context,
    item: TodayWidgetItem,
    flags: Map<String, Bitmap>,
) {
    val intent = deepLinkIntent(context, "calendariociclismo://stage/${item.raceDayId}")
    val textColor = WgText
    val badge = coverageBadge(item)
    val secondLine = buildCompactSecondLine(item)

    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .clickable(actionStartActivity(intent))
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
        // Bandera con ancho fijo para alinear el texto de todas las filas
        FlagFixedWidth(item.countryCode, flags)
        Spacer(GlanceModifier.width(4.dp))
        // Nombre + segunda línea con etapa, tipo abreviado y hora de llegada
        Column(modifier = GlanceModifier.defaultWeight()) {
            Text(
                text = item.raceName,
                style = TextStyle(color = textColor, fontSize = 12.sp, fontWeight = FontWeight.Bold),
                maxLines = 1,
            )
            if (secondLine != null) {
                Text(
                    text = secondLine,
                    style = TextStyle(color = WgText, fontSize = 10.sp),
                    maxLines = 1,
                )
            }
        }
        // Badge de cobertura TV/Live
        if (badge != null) {
            Spacer(GlanceModifier.width(4.dp))
            Text(
                text = badge,
                style = TextStyle(color = WgText, fontSize = 10.sp),
            )
        }
        // Chevron indicador de navegación
        Spacer(GlanceModifier.width(4.dp))
        Text(
            text = "›",
            style = TextStyle(color = WgText, fontSize = 12.sp),
        )
    }
}

// ─── Estado todas completadas ─────────────────────────────────────────────────

@Composable
private fun AllCompletedContent(context: Context) {
    val intent = deepLinkIntent(context, "calendariociclismo://tab/today")
    Column(
        modifier = GlanceModifier.fillMaxSize().clickable(actionStartActivity(intent)),
        verticalAlignment = Alignment.Vertical.CenterVertically,
        horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
    ) {
        Image(
            provider = ImageProvider(R.drawable.ic_launcher_foreground),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = GlanceModifier.height(68.dp).width(68.dp),
        )
        Spacer(GlanceModifier.height(8.dp))
        Text(
            text = "Completadas todas las carreras de hoy",
            style = TextStyle(color = WgText, fontSize = 14.sp, fontWeight = FontWeight.Bold),
            maxLines = 2,
        )
    }
}

// ─── Estado vacío (sin carreras hoy) ─────────────────────────────────────────

@Composable
private fun EmptyContent(context: Context) {
    val intent = deepLinkIntent(context, "calendariociclismo://tab/today")
    Column(
        modifier = GlanceModifier.fillMaxSize().clickable(actionStartActivity(intent)),
        verticalAlignment = Alignment.Vertical.CenterVertically,
        horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
    ) {
        Image(
            provider = ImageProvider(R.drawable.ic_launcher_foreground),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = GlanceModifier.height(80.dp).width(80.dp),
        )
        Spacer(GlanceModifier.height(2.dp))
        Text(
            text = "No hay carreras hoy",
            style = TextStyle(color = WgText, fontSize = 14.sp, fontWeight = FontWeight.Bold),
        )
    }
}

// ─── Estado especial (descanso / anulada) — alineado a izquierda como iOS ─────

@Composable
private fun SpecialStateContent(
    context: Context,
    raceName: String,
    countryCode: String?,
    label: String,
    flags: Map<String, Bitmap>,
    isWarning: Boolean = false,
) {
    val intent = deepLinkIntent(context, "calendariociclismo://tab/today")
    Column(
        modifier = GlanceModifier.fillMaxSize().clickable(actionStartActivity(intent)),
        verticalAlignment = Alignment.Vertical.Top,
        horizontalAlignment = Alignment.Horizontal.Start,
    ) {
        Row(verticalAlignment = Alignment.Vertical.CenterVertically) {
            FlagImage(countryCode, flags)
            Spacer(GlanceModifier.width(6.dp))
            Text(
                text = raceName,
                style = TextStyle(color = WgText, fontSize = 15.sp, fontWeight = FontWeight.Bold),
                maxLines = 1,
            )
        }
        Spacer(GlanceModifier.height(6.dp))
        Text(
            text = label,
            style = TextStyle(color = if (isWarning) WgWarning else WgText, fontSize = 13.sp),
        )
    }
}

// ─── Estado sincronizando ─────────────────────────────────────────────────────

@Composable
private fun SyncingContent() {
    Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("Sincronizando…", style = TextStyle(color = WgText, fontSize = 12.sp))
    }
}

// ─── Imagen de bandera ────────────────────────────────────────────────────────

@Composable
private fun FlagImage(countryCode: String?, flags: Map<String, Bitmap>) {
    val bitmap = countryCode?.let { flags[it] }
    if (bitmap != null) {
        Image(
            provider = ImageProvider(Icon.createWithBitmap(bitmap)),
            contentDescription = countryCode,
            modifier = GlanceModifier.width(20.dp).height(15.dp),
        )
    } else if (!countryCode.isNullOrEmpty()) {
        Text(
            text = countryCode.uppercase().take(2),
            style = TextStyle(color = WgText, fontSize = 9.sp),
        )
    }
}

// Versión con ancho fijo para garantizar alineación en filas compactas
@Composable
private fun FlagFixedWidth(countryCode: String?, flags: Map<String, Bitmap>) {
    val bitmap = countryCode?.let { flags[it] }
    if (bitmap != null) {
        Image(
            provider = ImageProvider(Icon.createWithBitmap(bitmap)),
            contentDescription = countryCode,
            modifier = GlanceModifier.width(22.dp).height(15.dp),
        )
    } else {
        Spacer(GlanceModifier.width(22.dp))
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Emojis equivalentes a los SF Symbols del widget iOS (stageTypeIcon).
private fun stageTypeEmoji(primaryType: String?): String? = when (primaryType) {
    "flat"                                         -> "→"
    "rolling"                                      -> "〜"
    "cotas"                                        -> "△"
    "medium_mountain"                              -> "⛰"
    "high_mountain", "summit_finish",
    "uphill_finish", "monopuerto",
    "chrono_climb"                                 -> "⛰"
    "itt", "ttt"                                   -> "⏱"
    "cobbles"                                      -> "▦"
    "sterrato"                                     -> "≋"
    else                                           -> null
}

private fun stageTypeAbbrev(primaryType: String?): String? = when (primaryType) {
    "flat"                                         -> "Ll"
    "rolling"                                      -> "Sin"
    "medium_mountain"                              -> "mM"
    "high_mountain", "summit_finish",
    "uphill_finish"                                -> "aM"
    "monopuerto"                                   -> "Monop"
    "chrono_climb"                                 -> "CREsc"
    "cobbles"                                      -> "Pavé"
    "sterrato"                                     -> "Strr"
    "cotas"                                        -> "Cotas"
    "itt"                                          -> "CRI"
    "ttt"                                          -> "CRE"
    else                                           -> null
}

// Línea etapa + tipo completo para vista single (con emoji de tipo antes del label)
private fun buildStageLine(item: TodayWidgetItem): String {
    val parts = mutableListOf<String>()
    if (item.stageLabel.isNotEmpty()) parts += item.stageLabel
    val emoji = stageTypeEmoji(item.primaryType)
    item.typeLabel?.let { tl ->
        parts += if (emoji != null) "$emoji $tl" else tl
    }
    return parts.joinToString(" · ")
}

// Segunda línea compacta para filas multi: etapa · emoji+abbrev · 🏁 hora meta
private fun buildCompactSecondLine(item: TodayWidgetItem): String? {
    val parts = mutableListOf<String>()
    if (item.stageLabel.isNotEmpty()) parts += item.stageLabel
    val abbrev = stageTypeAbbrev(item.primaryType)
        ?: item.typeLabel?.split(" · ")?.firstOrNull()
    if (abbrev != null) {
        val emoji = stageTypeEmoji(item.primaryType)
        parts += if (emoji != null) "$emoji $abbrev" else abbrev
    }
    val finishTime = item.estimatedFinishTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
    if (finishTime != null) parts += "🏁 $finishTime"
    return if (parts.isEmpty()) null else parts.joinToString(" · ")
}

// Badge de cobertura con la misma jerarquía de prioridad que el widget iOS
private fun coverageBadge(item: TodayWidgetItem): String? {
    if (item.tvStatus == "unavailable_es") return "NO ESP"
    val broadcastTime = item.broadcastStartTimeUtc?.let { DateFormatting.formatTimeLocal(it) }
    if (broadcastTime != null) return "📺 $broadcastTime"
    if (item.tvStatus == "pending") return "TBC"
    if (item.channels.isNotEmpty() || item.tvStatus == "confirmed") return "TV"
    if (item.hasLiveText) return "Live"
    if (item.tvStatus == "none") return "Sin TV"
    return null
}

private fun deepLinkIntent(context: Context, url: String): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { setPackage(context.packageName) }
