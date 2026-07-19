package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.prefs.RegionPreference
import org.junit.Assert.assertEquals
import org.junit.Test

class RegionDetectorTest {

    // ── SPAIN ──────────────────────────────────────────────────────

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

    // ── EUROPE ─────────────────────────────────────────────────────

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

    // ── AMERICAS ───────────────────────────────────────────────────

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

    // ── ASIA ───────────────────────────────────────────────────────

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

    // ── AFRICA ─────────────────────────────────────────────────────

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

    // ── Fallback ───────────────────────────────────────────────────

    @Test
    fun `TZ desconocida cae a SPAIN para preservar el baseline gratuito`() {
        assertEquals(RegionPreference.SPAIN, RegionDetector.suggestedRegion("UTC"))
        assertEquals(RegionPreference.SPAIN, RegionDetector.suggestedRegion("GMT"))
        assertEquals(RegionPreference.SPAIN, RegionDetector.suggestedRegion("Etc/Unknown"))
    }

    @Test
    fun `Nunca devuelve ALL`() {
        // ALL solo se elige manualmente desde Ajustes.
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

    // ── availableCountryGroups (sub-selector) ──────────────────────

    @Test
    fun `SPAIN tiene un solo grupo fino`() {
        assertEquals(listOf("ES"), RegionPreference.SPAIN.availableCountryGroups)
    }

    @Test
    fun `EUROPE expone los grupos europeos finos`() {
        val groups = RegionPreference.EUROPE.availableCountryGroups
        for (g in listOf("ES", "PT", "FR", "BE", "NL", "IT",
                         "DE_AT_CH", "UK_IE", "SCANDI", "EE")) {
            assert(g in groups) { "EUROPE debería exponer $g" }
        }
        assert("EUROPA" !in groups) { "EUROPA (paneuropeo) no debe estar en availableCountryGroups" }
        assert("ALL" !in groups) { "ALL no debe estar en availableCountryGroups" }
    }

    @Test
    fun `AMERICAS expone NORTEAM y LATAM`() {
        assertEquals(
            setOf("NORTEAM", "LATAM"),
            RegionPreference.AMERICAS.availableCountryGroups.toSet(),
        )
    }

    @Test
    fun `ASIA expone ASIAPAC y MENA`() {
        assertEquals(
            setOf("ASIAPAC", "MENA"),
            RegionPreference.ASIA.availableCountryGroups.toSet(),
        )
    }

    @Test
    fun `ALL no expone sub-selector`() {
        // Por diseño: en ALL se mantiene la detección automática por TZ.
        assert(RegionPreference.ALL.availableCountryGroups.isEmpty()) {
            "ALL no debe exponer sub-selector"
        }
    }

    @Test
    fun `availableCountryGroups es subset de allowedBroadcastGroups`() {
        for (bucket in RegionPreference.entries) {
            for (group in bucket.availableCountryGroups) {
                assert(group in bucket.allowedBroadcastGroups) {
                    "$group está en availableCountryGroups de $bucket pero no en allowedBroadcastGroups"
                }
            }
        }
    }

    // ── countryGroupLabelRes ───────────────────────────────────────

    @Test
    fun `countryGroupLabelRes cubre todos los grupos finos elegibles`() {
        // Cualquier grupo expuesto a usuarios via availableCountryGroups
        // necesita un string resource o se rompe la UI.
        val universe = RegionPreference.entries
            .flatMap { it.availableCountryGroups }
            .toSet()
        for (group in universe) {
            assert(RegionDetector.countryGroupLabelRes(group) != null) {
                "Falta string resource para grupo fino '$group'"
            }
        }
    }
}
