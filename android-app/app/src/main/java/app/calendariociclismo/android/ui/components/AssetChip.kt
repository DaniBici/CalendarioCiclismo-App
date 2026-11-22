package app.calendariociclismo.android.ui.components

import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import androidx.compose.foundation.background
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
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.launch

/** Ancho de una celda en la tira con desplazamiento y mínimo en la que reparte el ancho. */
private val AssetTileMinWidth = 100.dp

/**
 * Chip de acción usado en la lista de "documentación" de una jornada y en el
 * header de competición (Web oficial, Inscritos, Orden de salida, etc.).
 *
 * Celda de una tira de acciones: enlace neutro (icono gris sobre una etiqueta
 * de una línea a 13 seminegrita). El separador dibujado por cada celda crea
 * un único grupo continuo.
 *
 * `highlighted` pone la etiqueta y el icono en acento y negrita, sin relleno;
 * lo usa el primer chip ("Clasificaciones") de la tira de jornada. Paridad:
 * iOS `ActionStripTile`.
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
    val tileColor = colors.railBackground
    val iconColor = if (highlighted) colors.primary else colors.onSurfaceVariant
    val labelColor = if (highlighted) colors.primary else colors.onSurface
    // La celda destacada ("Clasificaciones") se ensancha con su etiqueta; el
    // resto conserva el ancho fijo de la tira. Cuando la tira reparte el ancho,
    // el que impone la tira prevalece sobre estos.
    val widthModifier = if (highlighted) Modifier.widthIn(min = AssetTileMinWidth) else Modifier.width(AssetTileMinWidth)
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
                tint = iconColor,
                modifier = Modifier.size(14.dp),
            )
        } else if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = iconColor,
                modifier = Modifier.size(14.dp),
            )
        }
        Text(
            text = label,
            style = CCText.S13,
            fontWeight = if (highlighted) FontWeight.Bold else FontWeight.SemiBold,
            color = labelColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Tira única de acciones, con flechas sincronizadas con el desplazamiento real.
 *
 * Si las celdas caben a su ancho mínimo (100 dp) se reparten a partes iguales
 * todo el ancho de la tira (tercios, mitades; una sola celda la ocupa entera),
 * sin hueco a la derecha y sin flechas; si no caben, conservan su ancho y la
 * tira se desplaza con flechas. La tira cuenta sus propias celdas: las
 * pantallas no las cuentan. Paridad: iOS `ResultsFittingRail`.
 */
@Composable
fun AssetActionStrip(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val cardColor = colors.railBackground

    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .height(60.dp)
            .clip(RoundedCornerShape(CCRadius.Surface))
            .background(cardColor),
    ) {
        ScrollingAssetStrip(stripWidthPx = with(LocalDensity.current) { maxWidth.roundToPx() }, content)
    }
}

/**
 * Celdas de la tira: reparten `stripWidthPx` a partes iguales si caben a
 * `AssetTileMinWidth`; si no, cada una mide su ancho natural (mínimo
 * `AssetTileMinWidth`). Al repartir, se desborda 1 px por la derecha para que
 * el filete final de la última celda quede fuera de la tira.
 */
@Composable
private fun AssetTiles(stripWidthPx: Int, content: @Composable () -> Unit) {
    Layout(content = content) { measurables, constraints ->
        val count = measurables.size
        val height = constraints.maxHeight
        if (count == 0) return@Layout layout(0, 0) {}
        val minWidth = AssetTileMinWidth.roundToPx()
        val distribute = count * minWidth <= stripWidthPx
        val placeables = if (distribute) {
            val width = (stripWidthPx + 1) / count
            measurables.map { it.measure(Constraints.fixed(width, height)) }
        } else {
            measurables.map {
                it.measure(Constraints(minWidth = minWidth, maxWidth = Constraints.Infinity, minHeight = height, maxHeight = height))
            }
        }
        val total = if (distribute) stripWidthPx else placeables.sumOf { it.width }
        layout(total, height) {
            var x = 0
            placeables.forEach { placeable ->
                placeable.placeRelative(x, 0)
                x += placeable.width
            }
        }
    }
}

@Composable
private fun ScrollingAssetStrip(stripWidthPx: Int, content: @Composable () -> Unit) {
    val scrollState = rememberScrollState()
    val scope = rememberCoroutineScope()
    val animationsEnabled = android.animation.ValueAnimator.areAnimatorsEnabled()

    Row(
        modifier = Modifier.fillMaxWidth().fillMaxHeight(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // `maxValue` vale Int.MAX_VALUE hasta la primera medición: sin ignorarlo, las
        // flechas salen un fotograma, estrechan la zona visible y, al repartir
        // el ancho, la tira se queda en desborde.
        val hasOverflow = scrollState.maxValue in 1 until Int.MAX_VALUE
        if (hasOverflow) {
            RailArrow(
                forward = false,
                enabled = scrollState.value > 0,
                label = stringResource(R.string.asset_actions_previous),
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
        Box(
            modifier = Modifier
                .weight(1f)
                .horizontalScroll(scrollState)
                .height(60.dp),
        ) {
            AssetTiles(stripWidthPx, content)
        }
        if (hasOverflow) {
            RailArrow(
                forward = true,
                enabled = scrollState.value < scrollState.maxValue,
                label = stringResource(R.string.asset_actions_more),
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
