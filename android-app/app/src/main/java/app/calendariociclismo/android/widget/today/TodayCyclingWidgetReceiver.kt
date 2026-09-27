package app.calendariociclismo.android.widget.today

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

class TodayCyclingWidgetReceiver : GlanceAppWidgetReceiver() {

    override val glanceAppWidget: GlanceAppWidget = TodayCyclingWidget()

    /** Primera instancia añadida: iniciar el ciclo de refresco. */
    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        TodayWidgetScheduler.schedulePeriodic(context)
        TodayWidgetScheduler.refreshNow(context)
    }

    /** Última instancia eliminada: detener el ciclo de refresco. */
    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        TodayWidgetScheduler.cancel(context)
    }
}
