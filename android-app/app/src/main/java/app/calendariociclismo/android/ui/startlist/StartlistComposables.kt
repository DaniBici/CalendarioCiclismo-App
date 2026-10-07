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
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.data.model.Team

/**
 * Tres franjas de la equipación efectiva (`teamStripes` de la web), en
 * Resultados, orden de salida e inscritos. Sin chapas circulares.
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
