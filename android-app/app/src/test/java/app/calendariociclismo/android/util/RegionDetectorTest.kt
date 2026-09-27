package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.prefs.RegionPreference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RegionDetectorTest {

    // ── suggestedRegion (bucket de push_subscriptions.region) ──────

    @Test
    fun `Madrid devuelve SPAIN`() {
        assertEquals(RegionPreference.SPAIN, RegionDetector.suggestedRegion("Europe/Madrid"))
    }

    @Test
    fun `Canarias devuelve SPAIN`() {
        assertEquals(RegionPreference.SPAIN, RegionDetector.suggestedRegion("Atlantic/Canary"))
    }

    @Test
    fun `Ceuta devuelve SPAIN aunque empiece por Africa`() {
        assertEquals(RegionPreference.SPAIN, RegionDetector.suggestedRegion("Africa/Ceuta"))
    }

    @Test
    fun `Paris devuelve EUROPE`() {
        assertEquals(RegionPreference.EUROPE, RegionDetector.suggestedRegion("Europe/Paris"))
    }

    @Test
    fun `Roma devuelve EUROPE`() {
        assertEquals(RegionPreference.EUROPE, RegionDetector.suggestedRegion("Europe/Rome"))
    }

    @Test
    fun `Reykjavik devuelve EUROPE aunque sea Atlantic`() {
        assertEquals(RegionPreference.EUROPE, RegionDetector.suggestedRegion("Atlantic/Reykjavik"))
    }

    @Test
    fun `Azores devuelve EUROPE`() {
        assertEquals(RegionPreference.EUROPE, RegionDetector.suggestedRegion("Atlantic/Azores"))
    }

    @Test
    fun `New York devuelve AMERICAS`() {
        assertEquals(RegionPreference.AMERICAS, RegionDetector.suggestedRegion("America/New_York"))
    }

    @Test
    fun `Buenos Aires devuelve AMERICAS`() {
        assertEquals(
            RegionPreference.AMERICAS,
            RegionDetector.suggestedRegion("America/Argentina/Buenos_Aires"),
        )
    }

    @Test
    fun `Honolulu se trata como AMERICAS aunque sea Pacific`() {
        assertEquals(RegionPreference.AMERICAS, RegionDetector.suggestedRegion("Pacific/Honolulu"))
    }

    @Test
    fun `Tokyo devuelve ASIA`() {
        assertEquals(RegionPreference.ASIA, RegionDetector.suggestedRegion("Asia/Tokyo"))
    }

    @Test
    fun `Sydney devuelve ASIA por Australia`() {
        assertEquals(RegionPreference.ASIA, RegionDetector.suggestedRegion("Australia/Sydney"))
    }

    @Test
    fun `Auckland devuelve ASIA por Pacific`() {
        assertEquals(RegionPreference.ASIA, RegionDetector.suggestedRegion("Pacific/Auckland"))
    }

    @Test
    fun `Indian Christmas devuelve ASIA`() {
        assertEquals(RegionPreference.ASIA, RegionDetector.suggestedRegion("Indian/Christmas"))
    }

    @Test
    fun `Lagos devuelve AFRICA`() {
        assertEquals(RegionPreference.AFRICA, RegionDetector.suggestedRegion("Africa/Lagos"))
    }

    @Test
    fun `Johannesburg devuelve AFRICA`() {
        assertEquals(
            RegionPreference.AFRICA,
            RegionDetector.suggestedRegion("Africa/Johannesburg"),
        )
    }

    @Test
    fun `TZ desconocida cae a SPAIN para preservar el baseline`() {
        assertEquals(RegionPreference.SPAIN, RegionDetector.suggestedRegion("UTC"))
        assertEquals(RegionPreference.SPAIN, RegionDetector.suggestedRegion("GMT"))
        assertEquals(RegionPreference.SPAIN, RegionDetector.suggestedRegion("Etc/Unknown"))
    }

    @Test
    fun `Nunca devuelve ALL`() {
        // ALL no es un bucket detectable automáticamente.
        val all = listOf(
            "Europe/Madrid", "Europe/Paris", "America/New_York",
            "Asia/Tokyo", "Africa/Lagos", "Pacific/Auckland",
            "UTC", "GMT", "Atlantic/Azores",
        )
        for (tz in all) {
            assert(RegionDetector.suggestedRegion(tz) != RegionPreference.ALL) {
                "TZ '$tz' devolvió ALL"
            }
        }
    }

    // ── allowedBroadcastGroups (paridad con la web) ────────────────

    @Test
    fun `España incluye baseline`() {
        assertEquals(
            setOf("ALL", "ES", "EUROPA"),
            RegionDetector.allowedBroadcastGroups("Europe/Madrid"),
        )
    }

    @Test
    fun `Francia muestra solo su grupo fino`() {
        // Paridad web: un usuario francés no ve los canales de Bélgica o Italia.
        assertEquals(
            setOf("ALL", "FR", "EUROPA"),
            RegionDetector.allowedBroadcastGroups("Europe/Paris"),
        )
    }

    @Test
    fun `UK_IE excluye el paneuropeo`() {
        assertEquals(
            setOf("ALL", "UK_IE"),
            RegionDetector.allowedBroadcastGroups("Europe/London"),
        )
    }

    @Test
    fun `Europa sin grupo fino muestra el paneuropeo`() {
        assertEquals(
            setOf("ALL", "EUROPA"),
            RegionDetector.allowedBroadcastGroups("Europe/Moscow"),
        )
    }

    @Test
    fun `America muestra solo su grupo fino`() {
        assertEquals(
            setOf("ALL", "NORTEAM"),
            RegionDetector.allowedBroadcastGroups("America/New_York"),
        )
        assertEquals(
            setOf("ALL", "LATAM"),
            RegionDetector.allowedBroadcastGroups("America/Argentina/Buenos_Aires"),
        )
    }

    @Test
    fun `Asia Africa y MENA`() {
        assertEquals(
            setOf("ALL", "ASIAPAC"),
            RegionDetector.allowedBroadcastGroups("Asia/Tokyo"),
        )
        assertEquals(
            setOf("ALL", "AFRICA"),
            RegionDetector.allowedBroadcastGroups("Africa/Lagos"),
        )
        assertEquals(
            setOf("ALL", "MENA"),
            RegionDetector.allowedBroadcastGroups("Africa/Cairo"),
        )
    }

    @Test
    fun `TZ desconocida muestra solo global`() {
        assertEquals(
            setOf("ALL"),
            RegionDetector.allowedBroadcastGroups("UTC"),
        )
    }

    // ── isEuropean ─────────────────────────────────────────────────

    @Test
    fun `isEuropean reconoce Europa cubierta y no cubierta`() {
        assertTrue(RegionDetector.isEuropean("Europe/Madrid"))
        assertTrue(RegionDetector.isEuropean("Atlantic/Reykjavik"))
        assertTrue(RegionDetector.isEuropean("Asia/Istanbul"))
        assertFalse(RegionDetector.isEuropean("America/New_York"))
        assertFalse(RegionDetector.isEuropean("Asia/Tokyo"))
        assertFalse(RegionDetector.isEuropean("UTC"))
    }
}
