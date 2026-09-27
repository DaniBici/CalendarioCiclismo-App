package app.calendariociclismo.android.ui.components

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MiniElevationProfileContrastTest {
    @Test
    fun `dark theme lightens dark colors to the web threshold`() {
        listOf(Color.Black, Color(0xFF171568), Color(0xFF003300), Color(0xFF800000)).forEach { color ->
            val adjusted = adjustedMiniProfileColor(color, darkTheme = true)
            assertTrue(
                miniProfileRelativeLuminance(adjusted) >= MINI_PROFILE_DARK_MIN_LUMINANCE,
            )
        }
    }

    @Test
    fun `light theme darkens light colors to the web threshold`() {
        listOf(Color.White, Color.Yellow, Color.Green, Color(0xFFFFAAAA)).forEach { color ->
            val adjusted = adjustedMiniProfileColor(color, darkTheme = false)
            assertTrue(
                miniProfileRelativeLuminance(adjusted) <= MINI_PROFILE_LIGHT_MAX_LUMINANCE,
            )
        }
    }

    @Test
    fun `colors inside the web range are preserved`() {
        val color = Color(0xFF1447A6)
        assertEquals(color, adjustedMiniProfileColor(color, darkTheme = false))
    }

    @Test
    fun `correction preserves alpha`() {
        val color = Color(0x66000000)
        assertEquals(color.alpha, adjustedMiniProfileColor(color, darkTheme = true).alpha)
    }
}
