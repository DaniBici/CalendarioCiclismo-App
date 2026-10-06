package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * Tests del Modo Campeonatos — espejo de `ChampionshipsConfigTests.swift` (iOS)
 * y de `championshipSlot` en `js/campeonatos-config.js`.
 */
class ChampionshipsConfigTest {

    // ── Clasificación de slot ───────────────────────────────────

    @Test fun slot_table() {
        data class Case(val name: String, val gender: String?, val primaryType: String?, val expected: ChampionshipsConfig.Slot)
        val cases = listOf(
            Case("Campeonato de España de ruta", null, null, ChampionshipsConfig.Slot.LINEA_MASC),
            Case("Campeonato de España CRI", null, null, ChampionshipsConfig.Slot.CRI_MASC),
            Case("Campeonato Nacional contrarreloj", null, null, ChampionshipsConfig.Slot.CRI_MASC),
            Case("Campeonato de Francia femenino", null, null, ChampionshipsConfig.Slot.LINEA_FEM),
            Case("Championnat de France", "female", null, ChampionshipsConfig.Slot.LINEA_FEM),
            Case("Campeonato de Italia sub-23", null, null, ChampionshipsConfig.Slot.LINEA_SUB23_M),
            Case("Campeonato U23 CRI femenino", null, null, ChampionshipsConfig.Slot.CRI_SUB23_F),
            // Sin pista en el nombre → primaryType de la jornada.
            Case("Campeonato de Bélgica", null, "itt", ChampionshipsConfig.Slot.CRI_MASC),
            // "línea" en el nombre prevalece sobre primaryType=itt.
            Case("Campeonato de Bélgica en línea", null, "itt", ChampionshipsConfig.Slot.LINEA_MASC),
        )
        for (c in cases) {
            assertEquals("${c.name} gender=${c.gender} primaryType=${c.primaryType}", c.expected, slotOf(c.name, c.gender, c.primaryType))
        }
    }

    // ── Semana de campeonatos: filtro "Hoy" y bloqueo de filtros ─

    @Test fun champWeek_filterWindowsRelativeToRange() {
        fun shift(date: String, days: Long) = LocalDate.parse(date).plusDays(days).toString()
        val start = ChampionshipsConfig.RANGE_START
        val end = ChampionshipsConfig.RANGE_END
        val todayStart = ChampionshipsConfig.TODAY_FILTER_START

        // Bloqueo de filtros de Hoy: toda la semana, bordes incluidos.
        assertTrue("lock $start", ChampionshipsConfig.isChampWeekFilterLock(start))
        assertTrue("lock $end", ChampionshipsConfig.isChampWeekFilterLock(end))
        assertFalse("lock día previo", ChampionshipsConfig.isChampWeekFilterLock(shift(start, -1)))
        assertFalse("lock día posterior", ChampionshipsConfig.isChampWeekFilterLock(shift(end, 1)))

        // Filtro "Hoy": de TODAY_FILTER_START a RANGE_END; los primeros días sin filtro.
        assertTrue("today $todayStart", ChampionshipsConfig.isTodayFilterActive(todayStart))
        assertTrue("today $end", ChampionshipsConfig.isTodayFilterActive(end))
        assertFalse("today víspera de TODAY_FILTER_START", ChampionshipsConfig.isTodayFilterActive(shift(todayStart, -1)))
        assertFalse("today día posterior", ChampionshipsConfig.isTodayFilterActive(shift(end, 1)))
    }

    // ── Orden interno de la categoría CN en Hoy/Mes ─────────────

    @Test fun compare_nullWhenNotChampionship() {
        val a = pair("Campeonato de España Línea", "ES")
        val notCn = Race(id = "r2", name = "Tour", uciCategory = "2.UWT", countryCode = "FR")
        assertEquals(null, ChampionshipsConfig.compare(a.first, a.second, notCn, RaceDay(id = "x", dateKey = "d")))
    }

    @Test fun compare_byCountryOrder() {
        val es = pair("Campeonato de España Línea Élite Masc", "ES")
        val fr = pair("Championnat de France Ligne Élite Homme", "FR")
        assertTrue(ChampionshipsConfig.compare(es.first, es.second, fr.first, fr.second)!! < 0)
    }

    @Test fun compare_allLineaBeforeAllCri() {
        val lineaFem = pair("Campeonato de España Línea Élite Femenino", "ES", gender = "female")
        val criMasc = pair("Campeonato de España CRI Élite Masculino", "ES", primaryType = "itt")
        assertTrue(ChampionshipsConfig.compare(lineaFem.first, lineaFem.second, criMasc.first, criMasc.second)!! < 0)
    }

    @Test fun compare_blockOrderEliteMascFemSub23() {
        val a = pair("Campeonato de España Línea Élite Masculino", "ES")
        val b = pair("Campeonato de España Línea Élite Femenino", "ES", gender = "female")
        val c = pair("Campeonato de España Línea sub-23 Masculino", "ES")
        val d = pair("Campeonato de España Línea sub-23 Femenino", "ES", gender = "female")
        assertTrue(ChampionshipsConfig.compare(a.first, a.second, b.first, b.second)!! < 0)
        assertTrue(ChampionshipsConfig.compare(b.first, b.second, c.first, c.second)!! < 0)
        assertTrue(ChampionshipsConfig.compare(c.first, c.second, d.first, d.second)!! < 0)
    }

    @Test fun countryIndex_absentGoesLast() {
        assertEquals(0, ChampionshipsConfig.countryIndex("ES"))
        assertEquals(ChampionshipsConfig.COUNTRY_ORDER.size, ChampionshipsConfig.countryIndex("ZZ"))
        assertEquals(ChampionshipsConfig.COUNTRY_ORDER.size, ChampionshipsConfig.countryIndex(null))
    }

    // ── Clasificación CN para filtros Pro/Masc/Fem ──────────────

    @Test fun isU23Championship_detectsU23() {
        assertTrue(ChampionshipsConfig.isU23Championship(cnRace("Campeonato de España Línea sub-23 Masculino")))
        assertTrue(ChampionshipsConfig.isU23Championship(cnRace("Campeonato de España CRI U23 Femenino")))
        assertFalse(ChampionshipsConfig.isU23Championship(cnRace("Campeonato de España Línea Élite Masculino")))
    }

    @Test fun isFemaleChampionship_byNameAndGender() {
        assertTrue(ChampionshipsConfig.isFemaleChampionship(cnRace("Campeonato de España Femenino")))
        assertTrue(ChampionshipsConfig.isFemaleChampionship(cnRace("Championnat de France", gender = "female")))
        assertFalse(ChampionshipsConfig.isFemaleChampionship(cnRace("Campeonato Masculino", gender = "female")))
        assertFalse(ChampionshipsConfig.isFemaleChampionship(cnRace("Campeonato Élite", gender = "male")))
    }

    private fun cnRace(name: String, gender: String? = null): Race =
        Race(id = "r-$name", name = name, uciCategory = "CN", gender = gender, countryCode = "ES")

    // ── Helpers ─────────────────────────────────────────────────

    private fun slotOf(name: String, gender: String? = null, primaryType: String? = null): ChampionshipsConfig.Slot {
        val race = Race(id = "r1", name = name, uciCategory = "CN", gender = gender, countryCode = "ES")
        val rd = RaceDay(id = "rd1", dateKey = "2026-06-27", primaryType = primaryType)
        return ChampionshipsConfig.slot(race, rd)
    }

    private fun pair(name: String, cc: String, gender: String? = null, primaryType: String? = null): Pair<Race, RaceDay> {
        val race = Race(id = "r-$name", name = name, uciCategory = "CN", gender = gender, countryCode = cc)
        val rd = RaceDay(id = "rd-$name", dateKey = "2026-06-27", primaryType = primaryType)
        return race to rd
    }
}
