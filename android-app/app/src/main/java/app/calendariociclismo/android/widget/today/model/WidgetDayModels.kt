package app.calendariociclismo.android.widget.today.model

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.OffsetDateTime

// Contrato de la RPC `widget_day` (supabase/migrations/*_widget_day*.sql).
// Los instantes llegan como `timestamptz` ISO con desfase.

@Serializable
data class WidgetDayResponse(
    val version: Int = 1,
    val generatedAt: String? = null,
    val locale: String = "es",
    val days: List<WidgetDay> = emptyList(),
) {
    fun day(dateKey: String): WidgetDay? = days.firstOrNull { it.date == dateKey }
    val generatedInstant: Instant? get() = parseInstant(generatedAt)
}

@Serializable
data class WidgetDay(
    val date: String,
    val items: List<WidgetItem> = emptyList(),
    val next: WidgetNext? = null,
)

@Serializable
data class WidgetTv(
    /** `time | confirmed | pending | none | unavailable_es` */
    val status: String? = null,
    val channel: String? = null,
    val channels: List<String>? = null,
    val startUtc: String? = null,
) {
    val start: Instant? get() = parseInstant(startUtc)
}

@Serializable
data class WidgetSession(
    val category: String,
    val label: String? = null,
    val elite: Boolean? = null,
    val startUtc: String? = null,
    val finishUtc: String? = null,
    val cancelled: Boolean? = null,
    val hasResults: Boolean? = null,
) {
    val start: Instant? get() = parseInstant(startUtc)
    val finish: Instant? get() = parseInstant(finishUtc)

    /** Sin duración verificada, una manga se considera en curso una hora. */
    fun isLive(now: Instant): Boolean {
        if (hasResults == true || cancelled == true) return false
        val s = start ?: return false
        return !now.isBefore(s) && now.isBefore(finish ?: s.plusSeconds(3600))
    }
}

@Serializable
data class WidgetItem(
    /** `road | cx` */
    val kind: String,
    val id: String,
    val raceId: String? = null,
    val link: String,
    val name: String,
    val countryCode: String? = null,
    val category: String? = null,
    val gender: String? = null,
    val grandTour: Boolean? = null,
    /** `race | rest | cancelled` */
    val state: String = "race",
    val stageNumber: Int? = null,
    val stageLabel: String? = null,
    val primaryType: String? = null,
    val typeLabel: String? = null,
    val distanceKm: Double? = null,
    val route: String? = null,
    val tournament: String? = null,
    val startUtc: String? = null,
    val finishUtc: String? = null,
    val raceStatus: String? = null,
    val tv: WidgetTv? = null,
    /** Texto en directo de la jornada (asset `live_text`). */
    val liveTextUrl: String? = null,
    val hasResults: Boolean? = null,
    /** Sin spoilers: accesos de Hoy a resultados (copa) y Revive (TV). */
    val resultsLink: String? = null,
    val reviveUrl: String? = null,
    val sessions: List<WidgetSession>? = null,
) {
    val isCx: Boolean get() = kind == "cx"
    val start: Instant? get() = parseInstant(startUtc)
    val finish: Instant? get() = parseInstant(finishUtc)
}

@Serializable
data class WidgetNext(
    val date: String,
    val kind: String,
    val id: String,
    val link: String,
    val name: String,
    val countryCode: String? = null,
    val category: String? = null,
    val stageLabel: String? = null,
    val startUtc: String? = null,
    val tvStartUtc: String? = null,
    val tvChannel: String? = null,
)

internal fun parseInstant(raw: String?): Instant? =
    raw?.let { runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull() }
