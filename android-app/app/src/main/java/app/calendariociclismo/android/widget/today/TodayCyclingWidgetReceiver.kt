package app.calendariociclismo.android.widget.today

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class TodayCyclingWidgetReceiver : GlanceAppWidgetReceiver() {

    override val glanceAppWidget: GlanceAppWidget = TodayCyclingWidget()

    /** Primera instancia del widget añadida: iniciar ciclo de refresco. */
    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        schedulePeriodicRefresh(context)
        // One-shot expedited para cargar datos inmediatamente sin esperar al periódico
        val req = OneTimeWorkRequestBuilder<TodayWidgetRefreshWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_WIDGET_ONESHOT,
            ExistingWorkPolicy.REPLACE,
            req,
        )
    }

    /** Última instancia eliminada: detener ciclo de refresco. */
    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        WorkManager.getInstance(context).cancelUniqueWork(WORK_WIDGET_PERIODIC)
    }

    companion object {
        const val WORK_WIDGET_PERIODIC = "widget_today_refresh_periodic"
        const val WORK_WIDGET_ONESHOT = "widget_today_refresh_oneshot"

        fun schedulePeriodicRefresh(context: Context) {
            val req = PeriodicWorkRequestBuilder<TodayWidgetRefreshWorker>(90, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_WIDGET_PERIODIC,
                ExistingPeriodicWorkPolicy.KEEP,
                req,
            )
        }
    }
}
