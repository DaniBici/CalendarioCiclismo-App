package app.calendariociclismo.android.widget.today

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.calendariociclismo.android.CalendarioCiclismoApp
import java.time.Instant

/**
 * Redibuja todas las instancias del widget y programa el siguiente refresco.
 * Cada instancia obtiene sus datos en `provideGlance` (RPC `widget_day` o
 * copia local); aquí solo se leen esas copias para decidir cuándo volver.
 */
class TodayWidgetRefreshWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val context = applicationContext
        val ids = runCatching { GlanceAppWidgetManager(context).getGlanceIds(TodayCyclingWidget::class.java) }
            .getOrDefault(emptyList())
        if (ids.isEmpty()) return Result.success()

        // Primero se consultan los datos (una vez por configuración) para que
        // `provideGlance` encuentre la copia local recién descargada.
        val repository = WidgetDayRepository(context)
        val results = ids
            .map { WidgetConfig.from(getAppWidgetState(context, PreferencesGlanceStateDefinition, it)) }
            .distinct()
            .map { repository.load(it) }
        val version = System.currentTimeMillis()
        val widget = TodayCyclingWidget()
        for (id in ids) {
            runCatching {
                updateAppWidgetState(context, id) { it[WidgetConfig.KEY_VERSION] = version }
                widget.update(context, id)
            }.onFailure { Log.w(TAG, "Error redibujando widget: ${it.message}") }
        }
        (context as? CalendarioCiclismoApp)?.preferences?.setLastWidgetRefreshAt(System.currentTimeMillis())

        val now = Instant.now()
        val next = results.minOfOrNull { TodayWidgetScheduler.nextRefresh(now, it?.response, it?.fromCache ?: true) }
            ?: return Result.success()
        val slot = inputData.keyValueMap[TodayWidgetScheduler.KEY_SLOT] as? Int
        TodayWidgetScheduler.scheduleNext(context, next, slot)
        return Result.success()
    }

    companion object {
        private const val TAG = "TodayWidgetRefreshWorker"
    }
}
