package app.calendariociclismo.android.ui.results

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.ui.components.RailArrow
import app.calendariociclismo.android.ui.components.railBackground
import app.calendariociclismo.android.ui.theme.CCRadius
import kotlinx.coroutines.launch

/**
 * Celda de una banda con flechas (etapas, categorías y clasificaciones): su
 * clave, el ancho natural (texto y relleno) con el que se decide si caben y el
 * contenido, que recibe el tamaño que le da la banda.
 */
internal class BandCell(
    val key: String,
    val naturalWidth: Dp,
    val content: @Composable (Modifier) -> Unit,
)

/** Filete entre celdas: 1 dp a altura completa, el de la tira de documentos. */
@Composable
internal fun BandSeparator() {
    Box(
        Modifier
            .width(1.dp)
            .fillMaxHeight()
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

/**
 * Banda enmarcada de celdas: superficie y separadores de la tira de documentos.
 * Si las celdas caben en el ancho, la banda ocupa el 100 % y cada una el 1/n
 * (con cuatro categorías, el 25 %); si no caben, es un carril con flechas que
 * centra la celda activa. Paridad: iOS `ResultsStageSelector` y
 * `ResultsClassTabsBar`.
 */
@Composable
internal fun ResultsBand(
    cells: List<BandCell>,
    activeKey: String?,
    height: Dp,
    moreLabel: String,
    previousLabel: String,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(CCRadius.Surface))
            .background(MaterialTheme.colorScheme.railBackground),
    ) {
        val needed = cells.fold(0.dp) { sum, cell -> sum + cell.naturalWidth } +
            1.dp * (cells.size - 1).coerceAtLeast(0)
        if (needed <= maxWidth) {
            Row(Modifier.fillMaxSize()) {
                cells.forEachIndexed { index, cell ->
                    cell.content(Modifier.weight(1f).fillMaxHeight())
                    if (index < cells.lastIndex) BandSeparator()
                }
            }
        } else {
            ScrollingBand(cells, activeKey, moreLabel, previousLabel)
        }
    }
}

@Composable
private fun ScrollingBand(
    cells: List<BandCell>,
    activeKey: String?,
    moreLabel: String,
    previousLabel: String,
) {
    val scrollState = rememberScrollState()
    val scope = rememberCoroutineScope()
    val animationsEnabled = android.animation.ValueAnimator.areAnimatorsEnabled()
    // Posición de cada celda en el carril: la activa se centra al aparecer (sin
    // animación) y al cambiar (también tras un deslizamiento sobre la tabla).
    val bounds = remember { mutableStateMapOf<String, Pair<Int, Int>>() }
    val centered = remember { booleanArrayOf(false) }
    LaunchedEffect(activeKey, scrollState.viewportSize, activeKey?.let { bounds[it] }) {
        val (x, width) = activeKey?.let { bounds[it] } ?: return@LaunchedEffect
        val target = (x + width / 2 - scrollState.viewportSize / 2).coerceIn(0, scrollState.maxValue)
        if (animationsEnabled && centered[0]) scrollState.animateScrollTo(target) else scrollState.scrollTo(target)
        centered[0] = true
    }
    Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
        val hasOverflow = scrollState.maxValue > 0
        if (hasOverflow) {
            RailArrow(forward = false, enabled = scrollState.value > 0, label = previousLabel) {
                scope.launch {
                    val step = maxOf(80, scrollState.viewportSize * 3 / 4)
                    val target = (scrollState.value - step).coerceAtLeast(0)
                    if (animationsEnabled) scrollState.animateScrollTo(target) else scrollState.scrollTo(target)
                }
            }
        }
        Row(
            modifier = Modifier.weight(1f).fillMaxHeight().horizontalScroll(scrollState),
        ) {
            cells.forEachIndexed { index, cell ->
                Box(
                    Modifier
                        .width(cell.naturalWidth)
                        .fillMaxHeight()
                        .onGloballyPositioned { bounds[cell.key] = it.positionInParent().x.toInt() to it.size.width },
                ) { cell.content(Modifier.fillMaxSize()) }
                if (index < cells.lastIndex) BandSeparator()
            }
        }
        if (hasOverflow) {
            RailArrow(forward = true, enabled = scrollState.value < scrollState.maxValue, label = moreLabel) {
                scope.launch {
                    val step = maxOf(80, scrollState.viewportSize * 3 / 4)
                    val target = (scrollState.value + step).coerceAtMost(scrollState.maxValue)
                    if (animationsEnabled) scrollState.animateScrollTo(target) else scrollState.scrollTo(target)
                }
            }
        }
    }
}
