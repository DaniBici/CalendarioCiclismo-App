package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.RaceDay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

/**
 * Formateo de desnivel y kilometraje en [RaceDay]: el separador de miles del
 * desnivel y el separador decimal del kilometraje siguen el IDIOMA DE CONTENIDO
 * (`LocaleHolder.shouldShowEnglishContent`), no el locale del dispositivo ni el
 * chrome de la UI. Regresión: el desnivel usaba `LocaleHolder.current` (chrome),
 * así que un dispositivo en inglés con la app en ES mostraba el punto español
 * ("+2.500 m") mientras el resto del contenido iba en inglés.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35]) // Robolectric 4.14.1 soporta hasta API 35; la app compila contra 36.
class RaceDayFormattingTest {

    private fun raceDayWithGain(gain: Int?) = RaceDay(
        id = "rd1",
        dateKey = "2026-01-01",
        elevationProfile = gain?.let { ElevationProfile(distance = 100.0, elevationGain = it) },
    )

    private fun raceDayWithDistance(km: Double?) = RaceDay(
        id = "rd1",
        dateKey = "2026-01-01",
        distanceKm = km,
    )

    /** App en español, dispositivo en español → todo en español (punto de miles). */
    private fun spanishContent() {
        LocaleHolder.system = Locale("es", "ES")
        LocaleHolder.current = Locale("es", "ES")
    }

    /** App en inglés (Premium) → contenido en inglés (coma de miles). */
    private fun englishAppContent() {
        LocaleHolder.system = Locale("es", "ES")
        LocaleHolder.current = Locale("en", "US")
    }

    /** App en ES pero dispositivo no-español → el contenido va en inglés.
     *  Este es el caso que disparaba el bug: `current` es ES (chrome) pero el
     *  contenido (km, desnivel) debe ir en inglés porque el sistema no es ES. */
    private fun nonSpanishDeviceContent() {
        LocaleHolder.system = Locale("en", "GB")
        LocaleHolder.current = Locale("es", "ES")
    }

    // ── Desnivel ───────────────────────────────────────────────────

    @Test
    fun `desnivel en espanol usa punto de miles`() {
        spanishContent()
        assertEquals("+2.500 m", raceDayWithGain(2500).elevationGainFormatted)
    }

    @Test
    fun `desnivel con app en ingles usa coma de miles`() {
        englishAppContent()
        assertEquals("+2,500 m", raceDayWithGain(2500).elevationGainFormatted)
    }

    @Test
    fun `desnivel sigue el contenido (no el chrome) en dispositivo no-espanol`() {
        // El bug: con `current` = ES esto devolvía "+2.500 m" (punto). Como el
        // contenido va en inglés (sistema no-ES), debe ser coma.
        nonSpanishDeviceContent()
        assertEquals("+2,500 m", raceDayWithGain(2500).elevationGainFormatted)
    }

    @Test
    fun `desnivel se redondea a la decena`() {
        spanishContent()
        assertEquals("+2.500 m", raceDayWithGain(2507).elevationGainFormatted)
    }

    @Test
    fun `desnivel de menos de mil no lleva separador`() {
        englishAppContent()
        assertEquals("+850 m", raceDayWithGain(850).elevationGainFormatted)
    }

    @Test
    fun `desnivel nulo devuelve null`() {
        spanishContent()
        assertNull(raceDayWithGain(null).elevationGainFormatted)
    }

    // ── Kilometraje (coherencia con el desnivel) ───────────────────

    @Test
    fun `kilometraje en espanol usa coma decimal`() {
        spanishContent()
        assertEquals("174,5 km", raceDayWithDistance(174.5).distanceFormatted)
    }

    @Test
    fun `kilometraje sigue el contenido en dispositivo no-espanol`() {
        nonSpanishDeviceContent()
        assertEquals("174.5 km", raceDayWithDistance(174.5).distanceFormatted)
    }
}
