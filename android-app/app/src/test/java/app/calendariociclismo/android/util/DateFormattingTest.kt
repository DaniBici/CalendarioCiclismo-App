package app.calendariociclismo.android.util

import org.junit.Assert.*
import org.junit.Test

class DateFormattingTest {
    @Test
    fun `otherDayLabel solo cuando la fecha local difiere de la jornada`() {
        // Tour de Okinawa 2026: 06:45 del domingo en Japón, 22:45 del sábado en Madrid.
        val madrid = java.time.ZoneId.of("Europe/Madrid")
        val tokyo = java.time.ZoneId.of("Asia/Tokyo")
        val start = "2026-11-07T21:45:00Z"
        assertEquals("sáb.", DateFormatting.otherDayLabel(start, "2026-11-08", madrid, isEnglish = false))
        assertEquals("Sat", DateFormatting.otherDayLabel(start, "2026-11-08", madrid, isEnglish = true))
        assertNull(DateFormatting.otherDayLabel(start, "2026-11-08", tokyo, isEnglish = false))
        // Llegada pasada la medianoche.
        assertEquals("dom.", DateFormatting.otherDayLabel("2026-11-07T23:30:00Z", "2026-11-07", madrid, isEnglish = false))
        assertNull(DateFormatting.otherDayLabel("2026-11-07T10:00:00Z", "2026-11-07", madrid, isEnglish = false))
    }
}
