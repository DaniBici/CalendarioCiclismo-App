package app.calendariociclismo.android.data.prefs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationCategoryPreferenceTest {

    // ── storageValue ───────────────────────────────────────────────

    @Test
    fun `storageValue coincide con los valores aceptados por send-push`() {
        assertEquals("general", NotificationCategoryPreference.GENERAL.storageValue)
        assertEquals("race_start", NotificationCategoryPreference.RACE_START.storageValue)
        assertEquals("tv_start", NotificationCategoryPreference.TV_START.storageValue)
        assertEquals("results", NotificationCategoryPreference.RESULTS.storageValue)
        assertEquals("cyclocross", NotificationCategoryPreference.CYCLOCROSS.storageValue)
    }

    // ── fromStorage ────────────────────────────────────────────────

    @Test
    fun `fromStorage con null devuelve DEFAULT_ENABLED`() {
        assertEquals(
            NotificationCategoryPreference.DEFAULT_ENABLED,
            NotificationCategoryPreference.fromStorage(null),
        )
    }

    @Test
    fun `fromStorage ignora valores desconocidos y tolera espacios`() {
        val parsed = NotificationCategoryPreference.fromStorage("general, bogus , results")
        assertEquals(
            setOf(
                NotificationCategoryPreference.GENERAL,
                NotificationCategoryPreference.RESULTS,
            ),
            parsed,
        )
    }

    @Test
    fun `fromStorage siempre incluye GENERAL aunque no este en el CSV`() {
        // Regla "no degradar lo gratis": GENERAL nunca se puede perder.
        val parsed = NotificationCategoryPreference.fromStorage("race_start,tv_start")
        assertTrue(NotificationCategoryPreference.GENERAL in parsed)
        assertTrue(NotificationCategoryPreference.RACE_START in parsed)
        assertTrue(NotificationCategoryPreference.TV_START in parsed)
    }

    // ── toStorage ──────────────────────────────────────────────────

    @Test
    fun `toStorage serializa en orden de declaracion del enum`() {
        // Para evitar que el set unordered cambie el output entre runs.
        val unordered = linkedSetOf(
            NotificationCategoryPreference.RESULTS,
            NotificationCategoryPreference.GENERAL,
            NotificationCategoryPreference.TV_START,
        )
        assertEquals("general,tv_start,results", NotificationCategoryPreference.toStorage(unordered))
    }

    // ── Round-trip ────────────────────────────────────────────────

    @Test
    fun `avisos CX son opcionales y sobreviven a la persistencia sin perder carretera`() {
        val legacy = NotificationCategoryPreference.fromStorage("general,results")
        assertEquals(setOf(NotificationCategoryPreference.GENERAL, NotificationCategoryPreference.RESULTS), legacy)
        val selected = legacy + NotificationCategoryPreference.CYCLOCROSS
        assertEquals("general,results,cyclocross", NotificationCategoryPreference.toStorage(selected))
        assertEquals(selected, NotificationCategoryPreference.fromStorage(NotificationCategoryPreference.toStorage(selected)))
        assertEquals(listOf("general", "results", "cyclocross"), NotificationCategoryPreference.toRawList(selected))
    }
}
