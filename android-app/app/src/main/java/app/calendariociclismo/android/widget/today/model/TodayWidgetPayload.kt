package app.calendariociclismo.android.widget.today.model

import java.time.Instant

data class TodayWidgetItem(
    val raceDayId: String,
    val raceId: String,
    val raceName: String,
    val countryCode: String?,
    val uciCategory: String?,
    val gender: String?,
    val stageLabel: String,
    val startLocation: String?,
    val finishLocation: String?,
    val startTimeUtc: String?,
    val estimatedFinishTimeUtc: String?,
    val primaryType: String?,
    val distanceKm: Double?,
    val typeLabel: String?,
    val channels: List<String>,
    val broadcastStartTimeUtc: String?,
    val tvStatus: String?,
    val hasLiveText: Boolean = false,
) {
    val isFinished: Boolean
        get() {
            val iso = estimatedFinishTimeUtc ?: return false
            return try { Instant.parse(iso).isBefore(Instant.now()) } catch (_: Exception) { false }
        }

    val routeDescription: String?
        get() {
            val s = startLocation?.takeIf { it.isNotEmpty() }
            val f = finishLocation?.takeIf { it.isNotEmpty() }
            return when {
                s != null && f != null -> if (s == f) s else "$s – $f"
                s != null -> s
                f != null -> f
                else -> null
            }
        }
}

sealed class WidgetState {
    data class HasRaces(
        val items: List<TodayWidgetItem>,
        val overflowCount: Int,
        val nextRaceDateKey: String? = null,
        val nextRaceName: String? = null,
    ) : WidgetState()

    data class RestDay(
        val raceName: String,
        val countryCode: String?,
    ) : WidgetState()

    data class Cancelled(
        val raceName: String,
        val countryCode: String?,
    ) : WidgetState()

    data class Empty(
        val nextRaceDateKey: String?,
    ) : WidgetState()

    object Syncing : WidgetState()
}

data class TodayWidgetPayload(
    val dateKey: String,
    val state: WidgetState,
)
