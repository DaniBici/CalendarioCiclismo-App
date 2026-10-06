package app.calendariociclismo.android.data.sync

import androidx.work.ExistingWorkPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineSyncThrottleTest {

    @Test
    fun `omite un intento automatico dentro del cooldown`() {
        assertTrue(
            OfflineSyncThrottle.shouldSkip(
                nowEpochSeconds = 10_000L,
                lastAttemptEpochSeconds = 9_999L,
            )
        )
    }

    @Test
    fun `permite un intento al terminar el cooldown`() {
        assertFalse(
            OfflineSyncThrottle.shouldSkip(
                nowEpochSeconds = 10_000L + OfflineSyncThrottle.COOLDOWN_SECONDS,
                lastAttemptEpochSeconds = 10_000L,
            )
        )
    }

    @Test
    fun `un ajuste de reloj hacia atras mantiene el guard activo`() {
        assertTrue(
            OfflineSyncThrottle.shouldSkip(
                nowEpochSeconds = 9_000L,
                lastAttemptEpochSeconds = 10_000L,
            )
        )
    }

    @Test
    fun `solo el refresco manual sustituye una cola o backoff pendiente`() {
        assertEquals(ExistingWorkPolicy.KEEP, OfflineManager.oneShotPolicy(force = false))
        assertEquals(ExistingWorkPolicy.REPLACE, OfflineManager.oneShotPolicy(force = true))
    }
}
