package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import app.calendariociclismo.android.R
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Row
import kotlinx.coroutines.launch

/**
 * Chip de acción usado en la lista de "documentación" de una jornada y en el
 * header de competición (Web oficial, Inscritos, Orden de salida, etc.).
 *
 * Celda de una tira de acciones: azul tenue, con icono sobre una etiqueta de
 * una línea. El separador dibujado por cada celda crea un único grupo continuo.
 *
 * `highlighted` invierte la celda al azul de marca con contenido blanco; lo usa
 * el primer chip ("Clasificaciones") de la tira de jornada.
 */
@Composable
fun AssetChip(
    icon: ImageVector? = null,
    iconPainter: Painter? = null,
    label: String,
    onClick: () -> Unit,
    showTrailingSeparator: Boolean = true,
    highlighted: Boolean = false,
) {
    val colors = MaterialTheme.colorScheme
    val tileColor = if (highlighted) colors.primary else colors.surfaceVariant
    val contentColor = if (highlighted) Color.White else colors.primary
    // La celda destacada ("Clasificaciones") se ensancha con su etiqueta; el
    // resto conserva el ancho fijo de la tira.
    val widthModifier = if (highlighted) Modifier.widthIn(min = 100.dp) else Modifier.width(100.dp)
    Column(
        modifier = widthModifier
            .height(60.dp)
            .background(tileColor)
            .drawBehind {
                if (showTrailingSeparator) {
                    drawLine(
                        color = colors.outlineVariant,
                        start = Offset(size.width, 0f),
                        end = Offset(size.width, size.height),
                        strokeWidth = 1.dp.toPx(),
                    )
                }
            }
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 7.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
    ) {
        if (iconPainter != null) {
            Icon(
                painter = iconPainter,
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(14.dp),
            )
        } else if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(14.dp),
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Medium,
            color = contentColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Tira única de acciones, con flechas sincronizadas con el desplazamiento real. */
@Composable
fun AssetActionStrip(
    modifier: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit,
) {
    val scrollState = rememberScrollState()
    val scope = rememberCoroutineScope()
    val colors = MaterialTheme.colorScheme
    val cardColor = colors.surfaceVariant
    val animationsEnabled = android.animation.ValueAnimator.areAnimatorsEnabled()

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(60.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(cardColor)
            .border(1.dp, colors.outlineVariant, RoundedCornerShape(8.dp)),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().fillMaxHeight(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val hasOverflow = scrollState.maxValue > 0
            if (hasOverflow) {
                AssetRailArrow(
                    forward = false,
                    enabled = scrollState.value > 0,
                    onClick = {
                        scope.launch {
                            val step = maxOf(80, scrollState.viewportSize * 3 / 4)
                            val target = (scrollState.value - step).coerceAtLeast(0)
                            if (animationsEnabled) scrollState.animateScrollTo(target)
                            else scrollState.scrollTo(target)
                        }
                    },
                )
            }
            Row(
                modifier = Modifier
                    .weight(1f)
                    .horizontalScroll(scrollState)
                    .height(60.dp),
                horizontalArrangement = Arrangement.spacedBy(0.dp),
                content = content,
            )
            if (hasOverflow) {
                AssetRailArrow(
                    forward = true,
                    enabled = scrollState.value < scrollState.maxValue,
                    onClick = {
                        scope.launch {
                            val step = maxOf(80, scrollState.viewportSize * 3 / 4)
                            val target = (scrollState.value + step).coerceAtMost(scrollState.maxValue)
                            if (animationsEnabled) scrollState.animateScrollTo(target)
                            else scrollState.scrollTo(target)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun AssetRailArrow(
    forward: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val label = stringResource(
        if (forward) R.string.asset_actions_more else R.string.asset_actions_previous,
    )
    Box(
        modifier = Modifier
            .width(48.dp)
            .fillMaxHeight()
            .background(colors.onSurfaceVariant.copy(alpha = if (enabled) 0.10f else 0.045f))
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
