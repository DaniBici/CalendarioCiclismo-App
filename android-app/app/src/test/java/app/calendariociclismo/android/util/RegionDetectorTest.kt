package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.prefs.RegionPreference
import org.junit.Assert.assertEquals
import org.junit.Test

class RegionDetectorTest {

    // ── suggestedRegion (bucket de push_subscriptions.region) ──────

    @Test
    fun `suggestedRegion asigna el bucket continental por zona horaria`() {
        val cases = listOf(
            "Europe/Madrid" to RegionPreference.SPAIN,
            "Atlantic/Canary" to RegionPreference.SPAIN,
            "Africa/Ceuta" to RegionPreference.SPAIN,          // aunque empiece por Africa
            "Europe/Paris" to RegionPreference.EUROPE,
            "Atlantic/Reykjavik" to RegionPreference.EUROPE,   // aunque sea Atlantic
            "Atlantic/Azores" to RegionPreference.EUROPE,
            "America/New_York" to RegionPreference.AMERICAS,
            "Pacific/Honolulu" to RegionPreference.AMERICAS,   // aunque sea Pacific
            "Asia/Tokyo" to RegionPreference.ASIA,
            "Australia/Sydney" to RegionPreference.ASIA,
            "Pacific/Auckland" to RegionPreference.ASIA,
            "Indian/Christmas" to RegionPreference.ASIA,
            "Africa/Lagos" to RegionPreference.AFRICA,
        )
        for ((tz, expected) in cases) {
            assertEquals("TZ '$tz'", expected, RegionDetector.suggestedRegion(tz))
        }
    }

    @Test
    fun `suggestedRegion con TZ desconocida cae a SPAIN para preservar el baseline`() {
        for (tz in listOf("UTC", "GMT", "Etc/Unknown")) {
            assertEquals("TZ '$tz'", RegionPreference.SPAIN, RegionDetector.suggestedRegion(tz))
        }
    }

    // ── allowedBroadcastGroups (paridad con la web) ────────────────

    @Test
    fun `allowedBroadcastGroups en Europa muestra el grupo fino y el paneuropeo salvo UK_IE`() {
        val cases = listOf(
            "Europe/Madrid" to setOf("ALL", "ES", "EUROPA"),
            // Paridad web: un usuario francés no ve los canales de Bélgica o Italia.
            "Europe/Paris" to setOf("ALL", "FR", "EUROPA"),
            "Europe/London" to setOf("ALL", "UK_IE"),
            // Europa sin grupo fino → solo el paneuropeo.
            "Europe/Moscow" to setOf("ALL", "EUROPA"),
        )
        for ((tz, expected) in cases) {
            assertEquals("TZ '$tz'", expected, RegionDetector.allowedBroadcastGroups(tz))
        }
    }

    @Test
    fun `allowedBroadcastGroups fuera de Europa muestra solo su grupo fino`() {
        val cases = listOf(
            "America/New_York" to setOf("ALL", "NORTEAM"),
            "America/Argentina/Buenos_Aires" to setOf("ALL", "LATAM"),
            "Asia/Tokyo" to setOf("ALL", "ASIAPAC"),
            "Africa/Lagos" to setOf("ALL", "AFRICA"),
            "Africa/Cairo" to setOf("ALL", "MENA"),
            // TZ desconocida → solo global.
            "UTC" to setOf("ALL"),
        )
        for ((tz, expected) in cases) {
            assertEquals("TZ '$tz'", expected, RegionDetector.allowedBroadcastGroups(tz))
        }
    }

    // ── isEuropean ─────────────────────────────────────────────────

    @Test
    fun `isEuropean reconoce Europa cubierta y no cubierta`() {
        val cases = listOf(
            "Europe/Madrid" to true,
            "Atlantic/Reykjavik" to true,
            "Asia/Istanbul" to true,
            "America/New_York" to false,
            "Asia/Tokyo" to false,
            "UTC" to false,
        )
        for ((tz, expected) in cases) {
            assertEquals("TZ '$tz'", expected, RegionDetector.isEuropean(tz))
        }
    }
}
