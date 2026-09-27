package app.calendariociclismo.android.notifications

import android.app.Application
import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
// API 27 usa BitmapFactory: ImageDecoder de API 28+ no decodifica archivos
// con el backend nativo de Robolectric en macOS. Se ejercita Coil completo.
@Config(sdk = [27], application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NotificationImagesTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()

    @Test
    fun largeLandscapeAndPortraitImagesAreDecodedWithinTheNotificationBudget() = runBlocking {
        for ((width, height) in listOf(4096 to 2048, 2048 to 4096)) {
            val source = File.createTempFile("notification-image-", ".png", context.cacheDir)
            try {
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                source.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()

                val decoded = loadNotificationBitmap(context, source)
                assertNotNull("Coil debe decodificar la imagen local", decoded)
                requireNotNull(decoded)
                assertTrue(decoded.width <= 1024 && decoded.height <= 1024)
                assertEquals(width.toDouble() / height, decoded.width.toDouble() / decoded.height, 0.01)
                assertNotEquals(Bitmap.Config.HARDWARE, decoded.config)
                assertTrue(decoded.allocationByteCount <= 1024 * 1024 * 4)
            } finally {
                source.delete()
            }
        }
    }

    @Test
    fun missingImageDoesNotPreventPostingTheTextNotification() = runBlocking {
        assertNull(loadNotificationBitmap(context, File(context.cacheDir, "missing-notification.png")))
    }
}
