package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.neutralFill

/**
 * Botón de acción con `Button` de Material 3 y el radio de control. La acción
 * principal usa el acento; una opción seleccionada, el acento al 15 %; el
 * resto, la superficie neutra con texto principal.
 */
@Composable
fun CCActionButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primaryAction: Boolean = false,
    selected: Boolean? = null,
    enabled: Boolean = true,
    detail: String? = null,
) {
    val scheme = MaterialTheme.colorScheme
    val colors = when {
        primaryAction -> ButtonDefaults.buttonColors()
        selected == true -> ButtonDefaults.buttonColors(
            containerColor = scheme.primary.copy(alpha = 0.15f),
            contentColor = scheme.primary,
        )
        else -> ButtonDefaults.buttonColors(
            containerColor = neutralFill,
            contentColor = scheme.onSurface,
        )
    }
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(CCRadius.Control),
        colors = colors,
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
        modifier = modifier
            .sizeIn(minHeight = 48.dp)
            .then(
                if (selected != null) Modifier.semantics { this.selected = selected }
                else Modifier,
            ),
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(5.dp))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (detail != null) Text(
                text = detail,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
