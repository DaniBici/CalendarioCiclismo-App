package app.calendariociclismo.android.util

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewPromptPolicyTest {
    private val now = 1_790_000_000_000L
    private val day = 24L * 60 * 60 * 1000

    private fun decide(
        isToday: Boolean = true,
        firstDaysAgo: Long? = 10,
        views: Int = 15,
        meaningful: Boolean = true,
        lastDaysAgo: Long? = null,
        lastVersion: String? = null,
        version: String = "5.0.9",
    ) = ReviewPromptPolicy.shouldRequest(
        now = now,
        isToday = isToday,
        firstContentViewAt = firstDaysAgo?.let { now - it * day },
        contentViews = views,
        meaningfulAction = meaningful,
        lastRequestAt = lastDaysAgo?.let { now - it * day },
        lastRequestVersion = lastVersion,
        currentVersion = version,
    )

    @Test
    fun `la primera peticion exige tres dias, pantallas y una accion de interes`() {
        assertTrue(decide())
        assertFalse(decide(firstDaysAgo = 2))
        assertFalse(decide(views = 14))
        assertFalse(decide(meaningful = false))
        assertFalse(decide(isToday = false))
    }

    @Test
    fun `repetir exige version nueva y veintiocho dias`() {
        assertTrue(decide(lastDaysAgo = 28, lastVersion = "5.0.8"))
        assertFalse(decide(lastDaysAgo = 27, lastVersion = "5.0.8"))
        assertFalse(decide(lastDaysAgo = 60, lastVersion = "5.0.9"))
    }

    @Test
    fun `repetir exige uso renovado`() {
        assertFalse(decide(views = 3, lastDaysAgo = 40, lastVersion = "5.0.8"))
        assertFalse(decide(meaningful = false, lastDaysAgo = 40, lastVersion = "5.0.8"))
    }
}
