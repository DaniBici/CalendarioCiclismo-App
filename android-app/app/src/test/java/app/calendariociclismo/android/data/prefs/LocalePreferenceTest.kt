package app.calendariociclismo.android.data.prefs

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tests para LocalePreference (parser tolerante + tags BCP-47 estables).
 * Sin dependencias Android — corre con JVM.
 */
class LocalePreferenceTest {

    @Test
    fun `fromStorage es tolerante con valores desconocidos`() {
        // Valor desconocido → vuelve al default español.
        assertEquals(LocalePreference.SPANISH, LocalePreference.fromStorage("xx"))
        assertEquals(LocalePreference.SPANISH, LocalePreference.fromStorage(""))
        assertEquals(LocalePreference.SPANISH, LocalePreference.fromStorage(null))
        assertEquals(LocalePreference.SPANISH, LocalePreference.fromStorage("ES"))
    }

    @Test
    fun `fromStorage roundtrip preserva el valor`() {
        for (pref in LocalePreference.entries) {
            val stored = pref.tag
            assertEquals(pref, LocalePreference.fromStorage(stored))
        }
    }
}
