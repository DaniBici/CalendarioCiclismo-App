package app.calendariociclismo.android.widget.today

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import app.calendariociclismo.android.widget.today.model.WidgetDayResponse
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Programación del widget:
 *  - periódico cada 60 min (red) como red de seguridad;
 *  - puntual en el siguiente cambio visible (salida, TV, meta, mangas CX),
 *    a medianoche y, con carreras en curso o a la espera de resultados,
 *    cada 20 min. Sin red, reintenta en 30 min con la copia local.
 */
object TodayWidgetScheduler {
    const val WORK_PERIODIC = "widget_today_refresh_periodic"
    private const val WORK_NOW = "widget_today_refresh_now"
    /** Dos ranuras alternas: el trabajo en curso nunca se reemplaza a sí mismo. */
    private val WORK_SLOTS = listOf("widget_today_refresh_next_a", "widget_today_refresh_next_b")
    const val KEY_SLOT = "slot"

    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<TodayWidgetRefreshWorker>(60, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun refreshNow(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NOW,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<TodayWidgetRefreshWorker>().build(),
        )
    }

    /**
     * Programa el siguiente refresco desde el worker que acaba de redibujar.
     * `currentSlot` es la ranura del worker en curso (null si es el periódico
     * o el inmediato).
     */
    fun scheduleNext(context: Context, at: Instant, currentSlot: Int?) {
        val target = if (currentSlot == 0) 1 else 0
        val delay = Duration.between(Instant.now(), at).coerceAtLeast(Duration.ofMinutes(1))
        val request = OneTimeWorkRequestBuilder<TodayWidgetRefreshWorker>()
            .setInitialDelay(delay.toMillis(), TimeUnit.MILLISECONDS)
            .setInputData(workDataOf(KEY_SLOT to target))
            .build()
        val manager = WorkManager.getInstance(context)
        manager.enqueueUniqueWork(WORK_SLOTS[target], ExistingWorkPolicy.REPLACE, request)
        if (currentSlot == null) manager.cancelUniqueWork(WORK_SLOTS[1 - target])
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).apply {
            cancelUniqueWork(WORK_PERIODIC)
            cancelUniqueWork(WORK_NOW)
            WORK_SLOTS.forEach(::cancelUniqueWork)
        }
    }

    internal fun nextRefresh(now: Instant, response: WidgetDayResponse?, fromCache: Boolean): Instant {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val midnight = today.plusDays(1).atStartOfDay(zone).toInstant().plusSeconds(60)
        if (response == null || fromCache) return minOf(now.plus(Duration.ofMinutes(30)), midnight)

        val items = response.day(today.toString())?.items.orEmpty()
        val pending = items.any { item ->
            when (item.raceState(now)) {
                WidgetRaceState.LIVE, WidgetRaceState.AWAITING -> true
                WidgetRaceState.SCHEDULED -> (item.start ?: item.tv?.start)
                    ?.let { Duration.between(now, it) < Duration.ofMinutes(90) } ?: false
                else -> false
            }
        }
        val transition = items.flatMap { it.transitionInstants }.filter { it.isAfter(now.plusSeconds(30)) }.minOrNull()
        val periodic = now.plus(if (pending) Duration.ofMinutes(20) else Duration.ofHours(2))
        return listOfNotNull(transition, periodic, midnight).min()
    }
}
