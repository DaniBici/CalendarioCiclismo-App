package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Fondo común de las bandas con flechas (documentos, etapas, categorías y
 * clasificaciones): el mismo en las celdas y en las zonas de flecha. Paridad:
 * iOS `AppTheme.railBackground`.
 */
val ColorScheme.railBackground: Color get() = surface

/**
 * Zona de flecha de una banda con desplazamiento: mismo fondo que las celdas,
 * filete de 1 dp en el lado del carril y flecha atenuada en el extremo. La
 * usan la tira de documentos y las bandas de etapas, categorías y
 * clasificaciones.
 */
@Composable
fun RailArrow(
    forward: Boolean,
    enabled: Boolean,
    label: String,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .width(48.dp)
            .fillMaxHeight()
            .background(colors.railBackground)
            .drawBehind {
                val x = if (forward) 0f else size.width
                drawLine(
                    color = colors.outlineVariant,
                    start = Offset(x, 0f),
                    end = Offset(x, size.height),
                    strokeWidth = 1.dp.toPx(),
                )
            }
            .clickable(
                enabled = enabled,
                role = Role.Button,
                onClickLabel = label,
                onClick = onClick,
            )
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = if (forward) Icons.AutoMirrored.Filled.KeyboardArrowRight
            else Icons.AutoMirrored.Filled.KeyboardArrowLeft,
            contentDescription = null,
            tint = colors.onSurfaceVariant.copy(alpha = if (enabled) 1f else 0.48f),
            modifier = Modifier.size(22.dp),
        )
    }
}
