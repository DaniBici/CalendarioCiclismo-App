package app.calendariociclismo.android.notifications

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.graphics.drawable.toBitmap
import app.calendariociclismo.android.CalendarioCiclismoApp
import app.calendariociclismo.android.MainActivity
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.prefs.NotificationCategoryPreference
import app.calendariociclismo.android.util.RegionDetector
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.toBitmap
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicInteger

/**
 * Servicio FCM. Maneja:
 *  - Nuevo token (`onNewToken`) → lo envía a Supabase.
 *  - Mensaje entrante (`onMessageReceived`) → construye una notificación
 *    con título, cuerpo, deep link y (si hay) imagen adjunta rich.
 *
 * El payload esperado (igual que iOS) incluye:
 *   - `title` / `body` en `notification.*` o `data.*`
 *   - `deepLink` en `data` (ej. "race/abc", "stage/xyz")
 *   - `image` en `data` (opcional, URL de imagen para BigPictureStyle)
 */
class CCFirebaseMessagingService : FirebaseMessagingService() {

    private val TAG = "CCFirebaseMsgSvc"
    private val scope = CoroutineScope(Dispatchers.IO)

    override fun onNewToken(token: String) {
        Log.i(TAG, "Nuevo token FCM recibido: ${token.take(12)}…")
        val app = applicationContext as? CalendarioCiclismoApp ?: return
        scope.launch {
            runCatching {
                app.preferences.setPushToken(token)
                if (app.preferences.snapshotPushEnabled()) {
                    app.supabaseService.upsertPushToken(
                        token,
                        isActive = true,
                        region = app.preferences.snapshotRegionPreference().name,
                        countryGroup = RegionDetector.detectedCountryGroup(),
                        language = app.preferences.snapshotAppLocale().tag,
                        categories = NotificationCategoryPreference.toRawList(
                            app.preferences.snapshotNotificationCategories()
                        ),
                    )
                }
            }.onFailure { Log.w(TAG, "Error al registrar nuevo token: ${it.message}") }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title
            ?: message.data["title"]
            ?: getString(R.string.app_name)
        val body = message.notification?.body
            ?: message.data["body"]
            ?: ""
        val deepLink = message.data["deepLink"] ?: message.data["deep_link"]
        val imageUrl = message.data["image"] ?: message.notification?.imageUrl?.toString()

        scope.launch {
            val bitmap = imageUrl?.let { loadBitmap(it) }
            showNotification(title, body, deepLink, bitmap)
        }
    }

    private suspend fun loadBitmap(url: String): Bitmap? {
        return runCatching {
            val loader = ImageLoader(this)
            val req = ImageRequest.Builder(this).data(url).build()
            when (val r = loader.execute(req)) {
                is SuccessResult -> r.image.toBitmap()
                else -> null
            }
        }.onFailure { Log.w(TAG, "Error cargando imagen: ${it.message}") }.getOrNull()
    }

    private fun showNotification(
        title: String,
        body: String,
        deepLink: String?,
        bigPicture: Bitmap?,
    ) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (!deepLink.isNullOrEmpty()) {
                putExtra(MainActivity.EXTRA_DEEP_LINK, deepLink)
            }
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pending = PendingIntent.getActivity(this, nextRequestCode(), intent, flags)

        val builder = NotificationCompat.Builder(this, NotificationChannels.CHANNEL_RACES)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(getColor(R.color.notification_accent))
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pending)

        if (bigPicture != null) {
            builder
                .setLargeIcon(bigPicture)
                .setStyle(
                    NotificationCompat.BigPictureStyle()
                        .bigPicture(bigPicture)
                        .bigLargeIcon(null as Bitmap?)
                        .setSummaryText(body)
                )
        } else {
            builder.setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(nextNotificationId(), builder.build())
    }

    companion object {
        private val requestCodeSeq = AtomicInteger(1000)
        private val notificationIdSeq = AtomicInteger(2000)
        fun nextRequestCode(): Int = requestCodeSeq.incrementAndGet()
        fun nextNotificationId(): Int = notificationIdSeq.incrementAndGet()
    }
}
