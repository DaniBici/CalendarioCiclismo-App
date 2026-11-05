package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Clasificación de cada Campeonato Nacional en su slot del grid de Campeonatos:
 * dos carreras en el mismo slot se pisan sin aviso.
 */
class ChampionshipsConfigTest {

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

    private fun slotOf(name: String, gender: String? = null, primaryType: String? = null): ChampionshipsConfig.Slot {
        val race = Race(id = "r1", name = name, uciCategory = "CN", gender = gender, countryCode = "ES")
        val rd = RaceDay(id = "rd1", dateKey = "2026-06-27", primaryType = primaryType)
        return ChampionshipsConfig.slot(race, rd)
    }
}
