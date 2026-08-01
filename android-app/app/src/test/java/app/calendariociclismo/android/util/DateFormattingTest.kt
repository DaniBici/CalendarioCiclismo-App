package app.calendariociclismo.android.util

import org.junit.Assert.*
import org.junit.Test

class DateFormattingTest {

    // ── parseLocalDate ─────────────────────────────────────────────

    @Test
    fun `parseLocalDate parsea fecha valida`() {
        val date = DateFormatting.parseLocalDate("2026-07-01")
        assertNotNull(date)
        assertEquals(2026, date!!.year)
        assertEquals(7, date.monthValue)
        assertEquals(1, date.dayOfMonth)
    }

    @Test
    fun `parseLocalDate devuelve null para formato invalido`() {
        assertNull(DateFormatting.parseLocalDate("01-07-2026"))
        assertNull(DateFormatting.parseLocalDate("not-a-date"))
        assertNull(DateFormatting.parseLocalDate(""))
    }

    // ── todayKey ───────────────────────────────────────────────────

    @Test
    fun `todayKey devuelve formato YYYY-MM-DD`() {
        val today = DateFormatting.todayKey()
        assertTrue("Formato YYYY-MM-DD esperado", today.matches(Regex("\\d{4}-\\d{2}-\\d{2}")))
    }

    // ── formatDateShort ────────────────────────────────────────────

    @Test
    fun `formatDateShort devuelve cadena no vacia para fecha valida`() {
        val result = DateFormatting.formatDateShort("2026-07-01")
        assertTrue(result.isNotEmpty())
        assertNotEquals("2026-07-01", result)
    }

    @Test
    fun `formatDateShort devuelve la clave original para fecha invalida`() {
        assertEquals("not-a-date", DateFormatting.formatDateShort("not-a-date"))
    }

    // ── formatDateLong ─────────────────────────────────────────────

    @Test
    fun `formatDateLong contiene el anio para fecha valida`() {
        val result = DateFormatting.formatDateLong("2026-07-01")
        assertTrue(result.contains("2026"))
    }

    @Test
    fun `formatDateLong contiene mes en espaniol`() {
        val result = DateFormatting.formatDateLong("2026-07-01")
        assertTrue(result.lowercase().contains("julio"))
    }

    @Test
    fun `fecha de actualizacion UCI comparte patron en castellano e ingles`() {
        assertEquals(
            "Actualizado: martes, 28 de julio de 2026",
            DateFormatting.formatUciRankingUpdated("2026-07-28", isEnglish = false),
        )
        assertEquals(
            "Updated: Tuesday, 28 July 2026",
            DateFormatting.formatUciRankingUpdated("2026-07-28", isEnglish = true),
        )
    }

    // ── formatMonthYear ────────────────────────────────────────────

    @Test
    fun `formatMonthYear contiene anio`() {
        val result = DateFormatting.formatMonthYear(2026, 5)
        assertTrue(result.contains("2026"))
    }

    @Test
    fun `formatMonthYear contiene nombre del mes en espaniol`() {
        val result = DateFormatting.formatMonthYear(2026, 5).lowercase()
        assertTrue(result.contains("mayo"))
    }

    // ── formatDateRange ────────────────────────────────────────────

    @Test
    fun `formatDateRange mismo mes devuelve rango compacto`() {
        val result = DateFormatting.formatDateRange("2026-07-01", "2026-07-27")
        assertTrue(result.contains("–") || result.contains("-"))
        assertTrue(result.contains("1") && result.contains("27"))
    }

    @Test
    fun `formatDateRange misma fecha devuelve solo el dia`() {
        val result = DateFormatting.formatDateRange("2026-04-12", "2026-04-12")
        assertFalse(result.contains("–"))
    }

    @Test
    fun `formatDateRange devuelve cadena vacia si start es null`() {
        assertEquals("", DateFormatting.formatDateRange(null, null))
    }

    // ── formatTimeMadrid ───────────────────────────────────────────

    @Test
    fun `formatTimeMadrid parsea timestamp ISO 8601`() {
        val result = DateFormatting.formatTimeMadrid("2026-07-01T10:00:00Z")
        assertNotNull(result)
        assertTrue(result!!.matches(Regex("\\d{2}:\\d{2}")))
    }

    @Test
    fun `formatTimeMadrid devuelve null para timestamp invalido`() {
        assertNull(DateFormatting.formatTimeMadrid("not-a-timestamp"))
    }

    @Test
    fun `formatTimeMadrid aplica zona horaria Madrid en verano CEST UTC+2`() {
        // 10:00 UTC = 12:00 CEST (Madrid en verano)
        val result = DateFormatting.formatTimeMadrid("2026-07-01T10:00:00Z")
        assertEquals("12:00", result)
    }

    @Test
    fun `formatTimeMadrid aplica zona horaria Madrid en invierno CET UTC+1`() {
        // 10:00 UTC = 11:00 CET (Madrid en invierno)
        val result = DateFormatting.formatTimeMadrid("2026-01-15T10:00:00Z")
        assertEquals("11:00", result)
    }

    // ── previousDay / nextDay ──────────────────────────────────────

    @Test
    fun `previousDay devuelve el dia anterior`() {
        assertEquals("2026-06-30", DateFormatting.previousDay("2026-07-01"))
    }

    @Test
    fun `nextDay devuelve el dia siguiente`() {
        assertEquals("2026-07-02", DateFormatting.nextDay("2026-07-01"))
    }

    @Test
    fun `previousDay maneja cruce de mes`() {
        assertEquals("2026-06-30", DateFormatting.previousDay("2026-07-01"))
    }

    @Test
    fun `nextDay maneja cruce de anio`() {
        assertEquals("2027-01-01", DateFormatting.nextDay("2026-12-31"))
    }

    @Test
    fun `previousDay devuelve null para fecha invalida`() {
        assertNull(DateFormatting.previousDay("not-a-date"))
    }

    // ── timestampToSeconds ─────────────────────────────────────────

    @Test
    fun `timestampToSeconds parsea timestamp valido`() {
        val secs = DateFormatting.timestampToSeconds("2026-07-01T10:00:00Z")
        assertNotNull(secs)
        assertTrue(secs!! > 0.0)
    }

    @Test
    fun `timestampToSeconds devuelve null para timestamp invalido`() {
        assertNull(DateFormatting.timestampToSeconds("not-a-timestamp"))
    }

    @Test
    fun `timestampToSeconds preserva orden cronologico`() {
        val t1 = DateFormatting.timestampToSeconds("2026-07-01T08:00:00Z")!!
        val t2 = DateFormatting.timestampToSeconds("2026-07-01T13:00:00Z")!!
        assertTrue(t1 < t2)
    }

    // ── dayOffset ─────────────────────────────────────────────────

    @Test
    fun `dayOffset avanza N dias`() {
        assertEquals("2026-07-08", DateFormatting.dayOffset("2026-07-01", 7))
    }

    @Test
    fun `dayOffset retrocede N dias con valor negativo`() {
        assertEquals("2026-06-24", DateFormatting.dayOffset("2026-07-01", -7))
    }
}
