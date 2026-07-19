package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.ui.theme.stageTypeBadgeColor
import app.calendariociclismo.android.util.RaceLogic

/**
 * Badge de tipo de etapa ("Llana", "Alta montaña", "CRI", …).
 *
 * Equivalente de `ios-app/.../Views/Components/StageTypeBadge.swift` — resuelve
 * combinaciones especiales (Monopuerto = flat + summit_finish, Cronoescalada = itt
 * + chrono_climb) y les asigna color diferenciado.
 */
@Composable
fun StageTypeBadge(
    primaryType: String?,
    secondaryType: String?,
    countryCode: String? = null,
    modifier: Modifier = Modifier,
) {
    if (primaryType.isNullOrBlank()) return
    val context = LocalContext.current
    val label = RaceLogic.resolveTypeLabel(
        context = context,
        primary = primaryType,
        secondary = secondaryType,
        countryCode = countryCode,
    )
    val colorKey = when {
        primaryType == "flat" && secondaryType == "summit_finish" -> "high_mountain"
        primaryType == "itt" && secondaryType == "chrono_climb" -> "chrono_climb"
        else -> primaryType
    }
    val colors = stageTypeBadgeColor(colorKey)
    Row(
        modifier = modifier
            .background(colors.background, RoundedCornerShape(3))
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            color = colors.foreground,
        )
    }
}
