package app.calendariociclismo.android.widget.today

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.updateAll
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.calendariociclismo.android.CalendarioCiclismoApp
import app.calendariociclismo.android.util.DateFormatting

/**
 * Refresca los datos de hoy desde Supabase y redibuja el widget.
 *
 * Usado tanto en modo periódico (cada 90 min, NetworkType.CONNECTED) como
 * en one-shot al añadir el widget por primera vez (expedited).
 */
class TodayWidgetRefreshWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? CalendarioCiclismoApp ?: return Result.failure()
        val today = DateFormatting.todayKey()

        // Refresco de red — si falla, el widget re-renderiza con datos de Room existentes
        runCatching { app.repository.refreshDay(today) }
            .onFailure { Log.w(TAG, "Error refrescando datos para el widget: ${it.message}") }

        // Redibujar siempre (refreshDay ya llama updateAll si tiene éxito, pero esto
        // cubre el caso de fallo de red mostrando los datos cacheados actuales)
        runCatching { TodayCyclingWidget().updateAll(applicationContext) }
            .onFailure { Log.w(TAG, "Error redibujando widget: ${it.message}") }

        app.preferences.setLastWidgetRefreshAt(System.currentTimeMillis())
        return Result.success()
    }

    companion object {
        private const val TAG = "TodayWidgetRefreshWorker"
    }
}
