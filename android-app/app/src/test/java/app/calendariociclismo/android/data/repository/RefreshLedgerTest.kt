package app.calendariociclismo.android.data.repository

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RefreshLedgerTest {
    private var now = 1_000L
    private val ledger = RefreshLedger { now }

    @Test
    fun keyIsFreshOnlyWithinTtl() {
        val key = RefreshLedger.monthKey("2026-10-01", "2026-10-31")
        assertFalse(ledger.isFresh(key, 600))

        ledger.mark(key)
        now += 599
        assertTrue(ledger.isFresh(key, 600))

        now += 1
        assertFalse(ledger.isFresh(key, 600))
    }

    @Test
    fun clockGoingBackwardsInvalidatesTheMark() {
        val key = RefreshLedger.dayKey("2026-10-07")
        ledger.mark(key)
        now -= 10
        assertFalse(ledger.isFresh(key, 600))
    }

    @Test
    fun clearForgetsEveryKey() {
        val key = RefreshLedger.racesYearKey(2026)
        ledger.mark(key)
        ledger.clear()
        assertFalse(ledger.isFresh(key, 3600))
    }
}
