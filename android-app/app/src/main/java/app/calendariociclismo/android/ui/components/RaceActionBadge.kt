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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.ui.theme.BadgeColor
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.ui.theme.neutralBadgeColor
import app.calendariociclismo.android.ui.theme.neutralFill
import app.calendariociclismo.android.ui.theme.neutralLinkBadgeColor

/**
 * Etiqueta de acción de las tarjetas (Dorsales, Orden de salida, accesos de
 * ciclocross). `primaryAction` es la etiqueta neutra de enlace (texto
 * principal sobre gris al 8 %); `neutral`, la informativa (texto atenuado). El
 * acento queda solo para la selección (`selected`). Con `iconOnly` se muestra
 * solo el icono y la etiqueta queda para accesibilidad.
 */
@Composable
fun RaceActionBadge(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, primaryAction: Boolean = false, selected: Boolean? = null, enabled: Boolean = true, neutral: Boolean = false, iconOnly: Boolean = false) {
    val primary = MaterialTheme.colorScheme.primary
    val colors = when {
        primaryAction -> neutralLinkBadgeColor()
        neutral -> neutralBadgeColor()
        else -> BadgeColor(primary.copy(alpha = if (selected == true) 0.18f else 0.10f), primary)
    }
    val showsText = label.isNotEmpty() && !(iconOnly && icon != null)
    CCBadgeSurface(
        colors = colors,
        onClick = onClick,
        modifier = modifier
            .alpha(if (enabled) 1f else 0.38f)
            .semantics {
                if (selected != null) this.selected = selected
                if (!showsText) contentDescription = label
            },
        enabled = enabled,
        horizontalPadding = if (showsText) 8.dp else 6.dp,
    ) {
        if (icon != null) Icon(icon, null, tint = colors.foreground, modifier = Modifier.size(12.dp))
        if (showsText) Text(label, style = CCText.S12, fontWeight = FontWeight.SemiBold, color = colors.foreground)
    }
}

/**
 * Superficie de etiqueta Material 3 (`Surface`): radio de control (4 dp) y
 * color de estado. Con enlace usa `Surface(onClick)` nativo, con su estado de
 * pulsación; la etiqueta conserva su altura compacta, como en la web.
 */
@Composable
internal fun CCBadgeSurface(
    colors: BadgeColor,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    horizontalPadding: Dp = 8.dp,
    content: @Composable RowScope.() -> Unit,
) {
    val shape = RoundedCornerShape(CCRadius.Control)
    val row: @Composable () -> Unit = {
        Row(
            modifier = Modifier.padding(horizontal = horizontalPadding, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            content = content,
        )
    }
    if (onClick != null) {
        CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
            Surface(onClick = onClick, enabled = enabled, modifier = modifier, shape = shape, color = colors.background, contentColor = colors.foreground) { row() }
        }
    } else {
        Surface(modifier = modifier, shape = shape, color = colors.background, contentColor = colors.foreground) { row() }
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
        .clip(RoundedCornerShape(CCRadius.Control))
        .clickable(role = Role.Button, onClick = onClick).semantics { this.selected = selected }
        .background(color.copy(alpha = if (selected) 0.18f else 0.10f)),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(label, style = CCText.S12, fontWeight = FontWeight.SemiBold, color = color)
        if (!boxOnly) Box(Modifier.height(14.dp), contentAlignment = Alignment.Center) { detail() }
    }
}

@Composable
fun RaceCompetitionButton(label: String, onClick: () -> Unit) {
    // Acceso a la competición (`.race-card__overview-btn`): glifo atenuado sobre
    // la superficie neutra, radio 4.
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
        Surface(
            onClick = onClick,
            modifier = Modifier.size(20.dp),
            shape = RoundedCornerShape(CCRadius.Control),
            color = neutralFill,
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Menu, label, Modifier.size(12.dp))
            }
        }
    }
}
