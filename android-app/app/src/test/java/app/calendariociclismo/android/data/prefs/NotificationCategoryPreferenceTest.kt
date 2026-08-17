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
    }

    // ── DEFAULT_ENABLED ────────────────────────────────────────────

    @Test
    fun `DEFAULT_ENABLED solo contiene GENERAL`() {
        assertEquals(
            setOf(NotificationCategoryPreference.GENERAL),
            NotificationCategoryPreference.DEFAULT_ENABLED,
        )
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
    fun `fromStorage con cadena vacia devuelve DEFAULT_ENABLED`() {
        assertEquals(
            NotificationCategoryPreference.DEFAULT_ENABLED,
            NotificationCategoryPreference.fromStorage(""),
        )
    }

    @Test
    fun `fromStorage parsea CSV con valores conocidos`() {
        val parsed = NotificationCategoryPreference.fromStorage("general,race_start")
        assertEquals(
            setOf(
                NotificationCategoryPreference.GENERAL,
                NotificationCategoryPreference.RACE_START,
            ),
            parsed,
        )
    }

    @Test
    fun `fromStorage tolera espacios alrededor de los valores`() {
        val parsed = NotificationCategoryPreference.fromStorage("general, race_start , tv_start")
        assertEquals(
            setOf(
                NotificationCategoryPreference.GENERAL,
                NotificationCategoryPreference.RACE_START,
                NotificationCategoryPreference.TV_START,
            ),
            parsed,
        )
    }

    @Test
    fun `fromStorage ignora valores desconocidos`() {
        val parsed = NotificationCategoryPreference.fromStorage("general,bogus,results")
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

    @Test
    fun `toStorage solo serializa los elementos del set`() {
        val only = setOf(NotificationCategoryPreference.GENERAL)
        assertEquals("general", NotificationCategoryPreference.toStorage(only))
    }

    // ── toRawList ──────────────────────────────────────────────────

    @Test
    fun `toRawList preserva orden del enum`() {
        val all = setOf(
            NotificationCategoryPreference.RESULTS,
            NotificationCategoryPreference.GENERAL,
            NotificationCategoryPreference.RACE_START,
            NotificationCategoryPreference.TV_START,
        )
        assertEquals(
            listOf("general", "race_start", "tv_start", "results"),
            NotificationCategoryPreference.toRawList(all),
        )
    }

    @Test
    fun `toRawList con set unitario devuelve lista de un elemento`() {
        assertEquals(
            listOf("general"),
            NotificationCategoryPreference.toRawList(setOf(NotificationCategoryPreference.GENERAL)),
        )
    }

    // ── Round-trip ────────────────────────────────────────────────

    @Test
    fun `toStorage y fromStorage son round-trip seguros`() {
        val original = setOf(
            NotificationCategoryPreference.GENERAL,
            NotificationCategoryPreference.TV_START,
        )
        val csv = NotificationCategoryPreference.toStorage(original)
        val parsed = NotificationCategoryPreference.fromStorage(csv)
        assertEquals(original, parsed)
    }
}
