package app.calendariociclismo.android.util

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

/**
 * Etiquetas de tipo de jornada de [RaceLogic]: leen recursos de cadenas y
 * necesitan `Context`, por eso van bajo Robolectric. El resto de la lógica de
 * [RaceLogic] se prueba en JVM pura en [RaceLogicTest].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35]) // Robolectric 4.14.1 soporta hasta API 35; la app compila contra 36.
class RaceLogicTypeLabelTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        // Las etiquetas vía LocaleHolder.t() dependen del idioma; fijamos ES para
        // que `resolveTypeLabel` (p. ej. "Monopuerto") sea determinista.
        LocaleHolder.system = Locale("es", "ES")
        LocaleHolder.current = Locale("es", "ES")
    }

    // ── typeLabel ──────────────────────────────────────────────────

    @Test
    fun `typeLabel devuelve el tipo si no esta en el mapa`() {
        assertEquals("unknown_type", RaceLogic.typeLabel(context, "unknown_type"))
    }

    @Test
    fun `typeLabel devuelve cadena vacia para null`() {
        assertEquals("", RaceLogic.typeLabel(context, null))
    }

    // ── resolveTypeLabel ───────────────────────────────────────────

    @Test
    fun `resolveTypeLabel monopuerto para flat con summit_finish`() {
        assertEquals("Monopuerto", RaceLogic.resolveTypeLabel(context, "flat", "summit_finish"))
    }

    @Test
    fun `resolveTypeLabel sterrato en Francia devuelve Ribinou`() {
        assertEquals("Ribinou", RaceLogic.resolveTypeLabel(context, "sterrato", null, countryCode = "FR"))
    }

    @Test
    fun `resolveTypeLabel sterrato fuera de Francia no es Ribinou`() {
        assertNotEquals("Ribinou", RaceLogic.resolveTypeLabel(context, "sterrato", null, countryCode = "IT"))
    }

    @Test
    fun `resolveTypeLabel itt con chrono_climb es cronoescalada`() {
        assertFalse(RaceLogic.resolveTypeLabel(context, "itt", "chrono_climb").isEmpty())
    }

    @Test
    fun `resolveTypeLabel itt con final en alto es cronoescalada`() {
        assertEquals(
            RaceLogic.typeLabel(context, "chrono_climb"),
            RaceLogic.resolveTypeLabel(context, "itt", "summit_finish"),
        )
    }
}
