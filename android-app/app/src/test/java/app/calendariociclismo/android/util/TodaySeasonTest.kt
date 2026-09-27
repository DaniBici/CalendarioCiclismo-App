package app.calendariociclismo.android.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TodaySeasonTest {

    @Test
    fun `el ultimo dia de 2026 es el 18 de octubre`() {
        assertEquals("2026-10-18", TodaySeason.lastDay("2026-09-27"))
        assertEquals("2026-10-18", TodaySeason.lastDay("2026-12-31"))
    }

    @Test
    fun `las fechas posteriores del mismo ano se llevan al ultimo dia`() {
        assertEquals("2026-10-18", TodaySeason.clamp("2026-10-19", "2026-09-27"))
        assertEquals("2026-10-18", TodaySeason.clamp("2026-11-02", "2026-11-02"))
        assertEquals("2026-10-09", TodaySeason.clamp("2026-10-09", "2026-10-19"))
    }

    @Test
    fun `un ano sin cierre configurado no tiene limite`() {
        assertNull(TodaySeason.lastDay("2027-01-02"))
        assertEquals("2027-10-30", TodaySeason.clamp("2027-10-30", "2027-01-02"))
        assertTrue(TodaySeason.contains("2027-10-30", "2027-01-02"))
    }

    @Test
    fun `los dias tras el cierre no son navegables`() {
        assertTrue(TodaySeason.contains("2026-10-18", "2026-10-01"))
        assertFalse(TodaySeason.contains("2026-10-19", "2026-10-01"))
    }
}
