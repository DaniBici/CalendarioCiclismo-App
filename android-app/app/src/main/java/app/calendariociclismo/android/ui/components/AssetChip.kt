package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Row
import kotlinx.coroutines.launch

/**
 * Chip de acción usado en la lista de "documentación" de una jornada y en el
 * header de competición (Web oficial, Inscritos, Orden de salida, etc.).
 *
 * Celda de una tira de acciones: azul tenue, con icono sobre una etiqueta de
 * una línea. El separador dibujado por cada celda crea un único grupo continuo.
 */
@Composable
fun AssetChip(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    showTrailingSeparator: Boolean = true,
) {
    val colors = MaterialTheme.colorScheme
    val tileColor = colors.primary.copy(alpha = 0.09f)
    Column(
        modifier = Modifier
            .width(100.dp)
            .height(60.dp)
            .background(tileColor)
            .drawBehind {
                if (showTrailingSeparator) {
                    drawLine(
                        color = colors.primary.copy(alpha = 0.18f),
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
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = colors.primary,
            modifier = Modifier.size(14.dp),
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Medium,
            color = colors.primary,
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

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(60.dp),
    ) {
        Row(
            modifier = Modifier
                .horizontalScroll(scrollState)
                .height(60.dp),
            horizontalArrangement = Arrangement.spacedBy(0.dp),
            content = content,
        )
        if (scrollState.value > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .width(40.dp)
                    .fillMaxHeight()
            ) {
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .width(24.dp)
                        .fillMaxHeight()
                        .background(
                            Brush.horizontalGradient(
                                0f to cardColor,
                                0.3f to cardColor,
                                1f to cardColor.copy(alpha = 0f),
                            ),
                        ),
                )
                IconButton(
                    onClick = {
                        scope.launch {
                            scrollState.animateScrollTo(0)
                        }
                    },
                    modifier = Modifier.align(Alignment.CenterStart).fillMaxHeight().width(40.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .background(cardColor.copy(alpha = 0.96f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                            contentDescription = "Acciones anteriores",
                            tint = colors.primary,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }
        }
        if (scrollState.value < scrollState.maxValue) {
            Box(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .width(40.dp)
                    .fillMaxHeight()
            ) {
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .width(24.dp)
                        .fillMaxHeight()
                        .background(
                            Brush.horizontalGradient(
                                0f to cardColor.copy(alpha = 0f),
                                0.7f to cardColor,
                                1f to cardColor,
                            ),
                        ),
                )
                IconButton(
                    onClick = {
                        scope.launch {
                            scrollState.animateScrollTo(scrollState.maxValue)
                        }
                    },
                    modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(40.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .background(cardColor.copy(alpha = 0.96f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = "Más acciones",
                            tint = colors.primary,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }
        }
    }
}
