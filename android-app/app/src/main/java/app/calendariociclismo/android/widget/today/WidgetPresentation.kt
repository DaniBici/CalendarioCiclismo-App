package app.calendariociclismo.android.widget.today

import android.content.Context
import android.content.res.Configuration
import app.calendariociclismo.android.R
import app.calendariociclismo.android.widget.today.model.WidgetItem
import app.calendariociclismo.android.widget.today.model.WidgetSession
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Estado temporal de una carrera en el instante de render. */
enum class WidgetRaceState { CANCELLED, REST, RESULTS, AWAITING, LIVE, SCHEDULED }

/** Distintivo de la columna derecha. Espejo del de iOS. */
data class WidgetBadge(
    val icon: Int?,
    val text: String,
    val emphasized: Boolean,
    /** Destino propio (texto en directo); null = el de la fila. */
    val url: String? = null,
)

/** Textos del widget en el idioma de la app (no el del sistema). */
class WidgetText(base: Context, localeTag: String) {
    val english = localeTag == "en"
    val locale: Locale = if (english) Locale.UK else Locale.forLanguageTag("es-ES")
    val context: Context = base.createConfigurationContext(
        Configuration(base.resources.configuration).apply { setLocale(locale) },
    )

    fun s(id: Int, vararg args: Any): String = context.getString(id, *args)

    fun time(instant: Instant?): String? =
        instant?.let { DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(it) }

    /** «mañana», «sáb 4 oct» / «tomorrow», «Sat 4 Oct». */
    fun day(dateKey: String, today: LocalDate): String {
        val date = runCatching { LocalDate.parse(dateKey) }.getOrNull() ?: return dateKey
        if (date == today.plusDays(1)) return s(R.string.widget_tomorrow)
        return DateTimeFormatter.ofPattern("EEE d MMM", locale).format(date).replace(".", "")
    }

    fun today(date: LocalDate): String =
        DateTimeFormatter.ofPattern("EEE d MMM", locale).format(date).replace(".", "")

    fun distance(km: Double?): String? {
        if (km == null || km <= 0) return null
        return if (km % 1.0 == 0.0) "${km.toInt()} km" else String.format(locale, "%.1f km", km)
    }
}

fun WidgetItem.raceState(now: Instant): WidgetRaceState {
    if (state == "cancelled") return WidgetRaceState.CANCELLED
    if (state == "rest") return WidgetRaceState.REST
    if (isCx) return cxState(now)
    if (hasResults == true) return WidgetRaceState.RESULTS
    if (raceStatus == "finished") return WidgetRaceState.AWAITING
    finish?.let { if (!now.isBefore(it)) return WidgetRaceState.AWAITING }
    if (raceStatus == "running") return WidgetRaceState.LIVE
    start?.let { if (!now.isBefore(it)) return WidgetRaceState.LIVE }
    return WidgetRaceState.SCHEDULED
}

private fun WidgetItem.cxState(now: Instant): WidgetRaceState {
    val active = sessions.orEmpty().filter { it.cancelled != true }
    if (active.isEmpty()) {
        val s = start ?: return WidgetRaceState.SCHEDULED
        return if (now.isBefore(s)) WidgetRaceState.SCHEDULED else WidgetRaceState.AWAITING
    }
    if (active.all { it.hasResults == true }) return WidgetRaceState.RESULTS
    if (active.any { it.isLive(now) }) return WidgetRaceState.LIVE
    val pending = active.any { s -> s.hasResults != true && (s.start?.isAfter(now) ?: true) }
    if (pending) return if (active.any { it.hasResults == true }) WidgetRaceState.LIVE else WidgetRaceState.SCHEDULED
    return WidgetRaceState.AWAITING
}

/** Sesiones CX que se muestran: las élite si existen; si no, todas. */
val WidgetItem.displaySessions: List<WidgetSession>
    get() {
        val active = sessions.orEmpty().filter { it.cancelled != true }
        return active.filter { it.elite == true }.ifEmpty { active }
    }

/** Instantes en los que cambia la presentación. */
val WidgetItem.transitionInstants: List<Instant>
    get() = buildList {
        start?.let(::add)
        finish?.let(::add)
        tv?.start?.let(::add)
        sessions.orEmpty().forEach { s -> s.start?.let(::add); s.finish?.let(::add) }
    }

/**
 * Distintivo de las carreras no terminadas. Espejo de `TVBadge` (Hoy):
 * «Live texto» solo con texto en directo; en el resto, el estado de TV.
 */
fun WidgetItem.badge(now: Instant, text: WidgetText): WidgetBadge? = when (raceState(now)) {
    WidgetRaceState.CANCELLED -> WidgetBadge(null, text.s(R.string.widget_cancelled), false)
    WidgetRaceState.REST, WidgetRaceState.RESULTS -> null
    WidgetRaceState.AWAITING -> WidgetBadge(R.drawable.ic_widget_finish, text.time(finish) ?: text.s(R.string.widget_finish), false)
    WidgetRaceState.LIVE, WidgetRaceState.SCHEDULED -> tvBadge(now, text)
}

private val WidgetItem.liveTextReplacesTv: Boolean
    get() = !liveTextUrl.isNullOrEmpty() && tv?.status in setOf(null, "none", "unavailable_es", "pending")

private fun WidgetItem.liveTextAlongside(now: Instant): Boolean {
    if (liveTextUrl.isNullOrEmpty() || liveTextReplacesTv) return false
    val s = start ?: return false
    val tvStart = tv?.start ?: return false
    return !now.isBefore(s) && now.isBefore(tvStart)
}

fun WidgetItem.tvBadge(now: Instant, text: WidgetText): WidgetBadge? {
    if (liveTextReplacesTv || liveTextAlongside(now)) {
        val started = start?.let { !now.isBefore(it) } ?: false
        return WidgetBadge(R.drawable.ic_widget_live_text, text.s(R.string.widget_live_text), started, liveTextUrl)
    }
    return when (tv?.status) {
        "time" -> {
            val tvStart = tv.start ?: return WidgetBadge(R.drawable.ic_widget_tv, "TV", false)
            when {
                !now.isBefore(tvStart) -> WidgetBadge(R.drawable.ic_widget_tv, text.s(R.string.tv_badge_live), true)
                start?.let { !tvStart.isAfter(it) } == true -> WidgetBadge(R.drawable.ic_widget_tv, text.s(R.string.widget_full_race), false)
                else -> WidgetBadge(R.drawable.ic_widget_tv, text.time(tvStart) ?: "TV", false)
            }
        }
        "confirmed" -> WidgetBadge(R.drawable.ic_widget_tv, "TV", false)
        "pending" -> WidgetBadge(R.drawable.ic_widget_tv, text.s(R.string.widget_unconfirmed), false)
        "unavailable_es" -> if (text.english) null else WidgetBadge(R.drawable.ic_widget_tv_off, text.s(R.string.widget_no_tv_spain), false)
        "none" -> WidgetBadge(R.drawable.ic_widget_tv_off, text.s(R.string.widget_no_tv), false)
        else -> null
    }
}

/** Carrera terminada con clasificación: mismos accesos que Hoy (copa y TV). */
fun WidgetItem.finishedActions(now: Instant): Pair<String?, String?>? {
    if (raceState(now) != WidgetRaceState.RESULTS) return null
    val results = resultsLink?.takeIf { it.isNotEmpty() }
    val revive = reviveUrl?.takeIf { it.isNotEmpty() }
    return if (results == null && revive == null) null else results to revive
}

/** Segunda línea. Sin spoilers: nunca incluye ganadores ni líderes. */
fun WidgetItem.detailLine(now: Instant, text: WidgetText): String = when (raceState(now)) {
    WidgetRaceState.REST -> text.s(R.string.widget_rest_day)
    WidgetRaceState.CANCELLED -> listOfNotNull(stageLabel, text.s(R.string.widget_cancelled_day)).joinToString(" · ")
    else -> if (isCx) cxScheduleLine(now, text) else listOfNotNull(stageLabel, typeLabel).joinToString(" · ")
}

private fun WidgetItem.cxScheduleLine(now: Instant, text: WidgetText): String {
    val line = displaySessions.joinToString(" · ") { s ->
        when {
            s.hasResults == true -> "${s.category} ${text.s(R.string.widget_session_finished)}"
            s.isLive(now) -> "${s.category} ${text.s(R.string.widget_session_live)}"
            else -> listOfNotNull(s.category, text.time(s.start)).joinToString(" ")
        }
    }
    return line.ifEmpty { tournament ?: category.orEmpty() }
}

/** Icono Unicode del tipo de etapa (Glance no admite SF Symbols ni ImageVector). */
fun stageTypeGlyph(primaryType: String?): String? = when (primaryType) {
    "flat" -> "→"
    "rolling" -> "〜"
    "cotas" -> "△"
    "medium_mountain", "high_mountain", "summit_finish", "uphill_finish", "monopuerto", "chrono_climb" -> "⛰"
    "itt", "ttt" -> "⏱"
    else -> null
}

/**
 * La carrera más relevante ahora: en directo, luego la próxima en salir,
 * luego la que espera resultados y, por último, la terminada. Respeta el
 * orden de importancia de la RPC dentro de cada grupo.
 */
fun featuredItem(items: List<WidgetItem>, now: Instant): WidgetItem? {
    val order = listOf(WidgetRaceState.LIVE, WidgetRaceState.SCHEDULED, WidgetRaceState.AWAITING, WidgetRaceState.RESULTS)
    for (state in order) items.firstOrNull { it.raceState(now) == state }?.let { return it }
    return items.firstOrNull()
}
