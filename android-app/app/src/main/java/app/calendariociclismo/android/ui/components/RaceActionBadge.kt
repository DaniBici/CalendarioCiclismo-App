package app.calendariociclismo.android.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.util.LocaleHolder

@Composable
fun RaceActionBadge(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, primaryAction: Boolean = false, selected: Boolean? = null, enabled: Boolean = true, neutral: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    Row(modifier.clip(RoundedCornerShape(3.dp)).alpha(if (enabled) 1f else 0.38f)
        .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
        .then(if (selected != null) Modifier.semantics { this.selected = selected } else Modifier)
        .background(when {
            primaryAction -> colors.primary
            neutral -> colors.onSurfaceVariant.copy(alpha = if (selected == true) 0.18f else 0.10f)
            else -> colors.primary.copy(alpha = if (selected == true) 0.18f else 0.10f)
        })
        .padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        val foreground = when {
            primaryAction -> colors.onPrimary
            neutral -> colors.onSurfaceVariant
            else -> colors.primary
        }
        if (icon != null) Icon(icon, null, tint = foreground, modifier = Modifier.size(11.dp))
        if (label.isNotEmpty()) Text(label.uppercase(LocaleHolder.currentState), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = foreground)
    }
}

/** Copa de resultados solo-icono (patrón de las cards de Hoy): glifo
 *  secundario clicable de altura contenida para la agenda y el programa CX. */
@Composable
fun ResultsTrophyAction(onClick: () -> Unit, contentDescription: String, modifier: Modifier = Modifier, boxSize: Dp = 24.dp, glyphSize: Dp = 18.dp) {
    Box(modifier.size(boxSize).clickable(role = Role.Button, onClickLabel = contentDescription, onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.EmojiEvents, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(glyphSize))
    }
}

@Composable
fun RaceActionTile(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, selected: Boolean = false, fillWidth: Boolean = false, boxOnly: Boolean = false, neutral: Boolean = false, detail: @Composable () -> Unit = {}) {
    val color = if (neutral) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary
    // boxOnly: cuadro solo con la etiqueta para la agenda CX, que muestra la
    // hora o la copa fuera de la caja (mismo ancho, menos altura).
    val height = if (boxOnly) 26.dp else 40.dp
    Column((if (fillWidth) modifier.fillMaxWidth() else modifier.size(width = 40.dp, height = height)).height(height)
        .clip(RoundedCornerShape(3.dp))
        .clickable(role = Role.Button, onClick = onClick).semantics { this.selected = selected }
        .background(color.copy(alpha = if (selected) 0.18f else 0.10f)),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(label, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = color)
        if (!boxOnly) Box(Modifier.height(14.dp), contentAlignment = Alignment.Center) { detail() }
    }
}

@Composable
fun RaceCompetitionButton(label: String, onClick: () -> Unit) {
    Box(Modifier.size(16.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f), RoundedCornerShape(3.dp))
        .clickable(role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.Menu, label, Modifier.size(9.dp), tint = MaterialTheme.colorScheme.primary)
    }
}
