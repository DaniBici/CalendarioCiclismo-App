package app.calendariociclismo.android.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

/**
 * Registro de canales de notificación.
 *
 * Se llama desde `CalendarioCiclismoApp.onCreate` para que los canales existan
 * antes de mostrar cualquier notificación en Android 8+ (siempre en esta app,
 * minSdk 26).
 */
object NotificationChannels {
    const val CHANNEL_RACES = "races_v1"

    fun ensureCreated(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val races = NotificationChannel(
            CHANNEL_RACES,
            "Avisos de carreras",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Notificaciones cuando una carrera está a punto de empezar o tiene cambios relevantes."
            enableLights(true)
            enableVibration(true)
        }
        nm.createNotificationChannel(races)
    }
}
