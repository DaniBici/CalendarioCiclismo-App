package app.calendariociclismo.android.ui.startlist

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.background
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.data.model.Team

/**
 * Tres franjas del cuadrado de colores (`teamStripes` de la web), en
 * Resultados, orden de salida e inscritos.
 */
@Composable
fun TeamColorBands(team: Team, modifier: Modifier = Modifier) {
    TeamColorBands(team.hasVisibleBadge, team.badgeTorsoSides, team.badgeTorsoCenter, team.badgeShorts, modifier)
}

/** Franjas tricolores; la visibilidad (colores curados) la resuelve el llamador. */
@Composable
fun TeamColorBands(visible: Boolean, torsoSides: String, torsoCenter: String, torsoShorts: String, modifier: Modifier = Modifier) {
    if (!visible) return
    Row(
        modifier = modifier
            .width(14.dp)
            .height(15.dp)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        androidx.compose.foundation.layout.Box(
            Modifier.weight(1f).fillMaxSize().background(parseColor(torsoSides, Color.Transparent))
        )
        androidx.compose.foundation.layout.Box(
            Modifier.weight(1f).fillMaxSize().background(parseColor(torsoCenter, Color.Transparent))
        )
        androidx.compose.foundation.layout.Box(
            Modifier.weight(1f).fillMaxSize().background(parseColor(torsoShorts, Color.Transparent))
        )
    }
}

private fun parseColor(colorStr: String, default: Color): Color {
    return try {
        Color(android.graphics.Color.parseColor(colorStr))
    } catch (e: Exception) {
        default
    }
}

/**
 * Fondo y texto editoriales de la cabecera de equipo (`teamHeaderColors` de la
 * web); null si falta o no es válido alguno de los dos.
 */
internal fun teamHeaderColors(team: Team?): Pair<Color, Color>? {
    team ?: return null
    val background = parseColor(team.headerBg.trim(), Color.Unspecified).takeIf { it != Color.Unspecified } ?: return null
    val text = parseColor(team.headerText.trim(), Color.Unspecified).takeIf { it != Color.Unspecified } ?: return null
    // Contraste mínimo 4,5:1 (WCAG AA): si la pareja editorial no llega, blanco o
    // negro, el que más contraste dé (como `teamHeaderColors` de la web).
    fun contrast(a: Color, b: Color): Float {
        val hi = maxOf(a.luminance(), b.luminance())
        val lo = minOf(a.luminance(), b.luminance())
        return (hi + 0.05f) / (lo + 0.05f)
    }
    if (contrast(background, text) >= 4.5f) return background to text
    val readable = if (contrast(background, Color.Black) > contrast(background, Color.White)) Color.Black else Color.White
    return background to readable
}
