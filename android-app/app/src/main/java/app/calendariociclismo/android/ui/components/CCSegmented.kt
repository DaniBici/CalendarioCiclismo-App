package app.calendariociclismo.android.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButtonColors
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import app.calendariociclismo.android.ui.theme.neutralFill

/**
 * Colores de los controles segmentados nativos (`SegmentedButton`): sin
 * bordes, pista gris neutra (texto al 8 %) y la opción activa con el tinte de
 * acento al 15 % y el texto en acento, como los filtros de Hoy y el control
 * segmentado de iOS.
 */
@Composable
fun ccSegmentedColors(): SegmentedButtonColors {
    val accent = MaterialTheme.colorScheme.primary
    return SegmentedButtonDefaults.colors(
        activeContainerColor = accent.copy(alpha = 0.15f),
        activeContentColor = accent,
        activeBorderColor = Color.Transparent,
        inactiveContainerColor = neutralFill,
        inactiveContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        inactiveBorderColor = Color.Transparent,
        disabledActiveBorderColor = Color.Transparent,
        disabledInactiveBorderColor = Color.Transparent,
    )
}
