package app.calendariociclismo.android.data.prefs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Tests para LocalePreference (parser tolerante + tags BCP-47 estables).
 * Sin dependencias Android — corre con JVM.
 */
class LocalePreferenceTest {

    @Test
    fun `tags son los esperados ISO 639-1`() {
        assertEquals("es", LocalePreference.SPANISH.tag)
        assertEquals("en", LocalePreference.ENGLISH.tag)
    }

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

    @Test
    fun `label tiene texto no vacio para cada idioma`() {
        for (pref in LocalePreference.entries) {
            assertNotNull(pref.label)
            assert(pref.label.isNotEmpty()) {
                "Label vacío para ${pref.name}"
            }
        }
    }

    @Test
    fun `etiquetas en idioma nativo`() {
        // Las etiquetas se muestran SIEMPRE en su idioma original
        // (un usuario en EN puede saber identificar "Español" y al revés).
        assertEquals("Español", LocalePreference.SPANISH.label)
        assertEquals("English", LocalePreference.ENGLISH.label)
    }
}
