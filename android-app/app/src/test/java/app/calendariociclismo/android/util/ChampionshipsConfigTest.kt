package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests del Modo Campeonatos — espejo de `ChampionshipsConfigTests.swift` (iOS)
 * y de `championshipSlot` en `js/campeonatos-config.js`.
 */
class ChampionshipsConfigTest {

    // ── Pertenencia al rango de fechas ──────────────────────────

    @Test fun dates_includeRangeBounds() {
        assertTrue(ChampionshipsConfig.DATES.contains("2026-06-22"))
        assertTrue(ChampionshipsConfig.DATES.contains("2026-06-28"))
    }

    @Test fun dates_excludeOutsideRange() {
        assertFalse(ChampionshipsConfig.DATES.contains("2026-06-21"))
        assertFalse(ChampionshipsConfig.DATES.contains("2026-06-29"))
    }

    // ── Clasificación de slot ───────────────────────────────────

    @Test fun slot_eliteMenRoadByDefault() {
        assertEquals(ChampionshipsConfig.Slot.LINEA_MASC, slotOf("Campeonato de España de ruta"))
    }

    @Test fun slot_criByName() {
        assertEquals(ChampionshipsConfig.Slot.CRI_MASC, slotOf("Campeonato de España CRI"))
    }

    @Test fun slot_criByContrarrelojWord() {
        assertEquals(ChampionshipsConfig.Slot.CRI_MASC, slotOf("Campeonato Nacional contrarreloj"))
    }

    @Test fun slot_femaleByName() {
        assertEquals(ChampionshipsConfig.Slot.LINEA_FEM, slotOf("Campeonato de Francia femenino"))
    }

    @Test fun slot_femaleByGenderField() {
        assertEquals(ChampionshipsConfig.Slot.LINEA_FEM, slotOf("Championnat de France", gender = "female"))
    }

    @Test fun slot_sub23() {
        assertEquals(ChampionshipsConfig.Slot.LINEA_SUB23_M, slotOf("Campeonato de Italia sub-23"))
    }

    @Test fun slot_sub23FemaleCri() {
        assertEquals(ChampionshipsConfig.Slot.CRI_SUB23_F, slotOf("Campeonato U23 CRI femenino"))
    }

    @Test fun slot_fallbackToPrimaryTypeItt() {
        assertEquals(ChampionshipsConfig.Slot.CRI_MASC, slotOf("Campeonato de Bélgica", primaryType = "itt"))
    }

    @Test fun slot_nameLineaOverridesPrimaryTypeItt() {
        assertEquals(ChampionshipsConfig.Slot.LINEA_MASC, slotOf("Campeonato de Bélgica en línea", primaryType = "itt"))
    }

    // ── Filtros → slots ─────────────────────────────────────────

    @Test fun filter_slots() {
        assertEquals(8, ChampionshipsConfig.Filter.ALL.slots.size)
        assertEquals(
            listOf(
                ChampionshipsConfig.Slot.LINEA_MASC, ChampionshipsConfig.Slot.CRI_MASC,
                ChampionshipsConfig.Slot.LINEA_FEM, ChampionshipsConfig.Slot.CRI_FEM,
            ),
            ChampionshipsConfig.Filter.PRO.slots,
        )
        assertEquals(
            listOf(ChampionshipsConfig.Slot.LINEA_MASC, ChampionshipsConfig.Slot.CRI_MASC),
            ChampionshipsConfig.Filter.MALE.slots,
        )
        assertEquals(
            listOf(ChampionshipsConfig.Slot.LINEA_FEM, ChampionshipsConfig.Slot.CRI_FEM),
            ChampionshipsConfig.Filter.FEMALE.slots,
        )
    }

    // ── Filtro "Hoy" (rango 24–28 jun) ──────────────────────────

    @Test fun todayFilter_activeWithinRange() {
        assertTrue(ChampionshipsConfig.isTodayFilterActive("2026-06-24"))
        assertTrue(ChampionshipsConfig.isTodayFilterActive("2026-06-26"))
        assertTrue(ChampionshipsConfig.isTodayFilterActive("2026-06-28"))
    }

    @Test fun todayFilter_inactiveBeforeAndAfter() {
        // Primeros dos días de campeonatos (22, 23) → sin filtro.
        assertFalse(ChampionshipsConfig.isTodayFilterActive("2026-06-22"))
        assertFalse(ChampionshipsConfig.isTodayFilterActive("2026-06-23"))
        // Después del 28 → sin filtro.
        assertFalse(ChampionshipsConfig.isTodayFilterActive("2026-06-29"))
        assertFalse(ChampionshipsConfig.isTodayFilterActive("2026-07-01"))
    }

    // ── Bloqueo de filtros de "Hoy" en la semana de campeonatos (22–28) ──

    @Test fun champWeekLock_activeWholeWeekIncl2223() {
        assertTrue(ChampionshipsConfig.isChampWeekFilterLock("2026-06-22"))
        assertTrue(ChampionshipsConfig.isChampWeekFilterLock("2026-06-23"))
        assertTrue(ChampionshipsConfig.isChampWeekFilterLock("2026-06-25"))
        assertTrue(ChampionshipsConfig.isChampWeekFilterLock("2026-06-28"))
    }

    @Test fun champWeekLock_inactiveOutsideWeek() {
        assertFalse(ChampionshipsConfig.isChampWeekFilterLock("2026-06-21"))
        assertFalse(ChampionshipsConfig.isChampWeekFilterLock("2026-06-29"))
        assertFalse(ChampionshipsConfig.isChampWeekFilterLock("2026-07-01"))
    }

    @Test fun champWeekLock_filtersAreAllProMaleFemaleDefaultMale() {
        assertEquals(
            listOf(
                Constants.CategoryFilter.ALL,
                Constants.CategoryFilter.PRO,
                Constants.CategoryFilter.MALE,
                Constants.CategoryFilter.FEMALE,
            ),
            ChampionshipsConfig.CHAMP_WEEK_HOY_FILTERS,
        )
        assertEquals(Constants.CategoryFilter.MALE, ChampionshipsConfig.CHAMP_WEEK_HOY_DEFAULT)
        assertFalse(ChampionshipsConfig.CHAMP_WEEK_HOY_FILTERS.contains(Constants.CategoryFilter.UWT))
        assertFalse(ChampionshipsConfig.CHAMP_WEEK_HOY_FILTERS.contains(Constants.CategoryFilter.WWT))
    }

    @Test fun todayFilter_isFirstAndAllowsAllSlots() {
        assertEquals(ChampionshipsConfig.Filter.TODAY, ChampionshipsConfig.Filter.values().first())
        assertEquals(ChampionshipsConfig.Slot.values().toList(), ChampionshipsConfig.Filter.TODAY.slots)
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
