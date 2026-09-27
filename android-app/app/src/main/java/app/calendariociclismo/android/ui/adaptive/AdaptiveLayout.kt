package app.calendariociclismo.android.ui.adaptive

import androidx.compose.material3.adaptive.collectFoldingFeaturesAsState
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.window.core.layout.WindowSizeClass
import androidx.window.layout.FoldingFeature
import kotlin.math.abs
import kotlin.math.max

enum class AdaptiveWidthClass { Compact, Medium, Expanded }

@Immutable
data class AdaptiveLayoutInfo(
    val widthClass: AdaptiveWidthClass,
    val heightIsCompact: Boolean,
    val verticalHingeWidth: Dp,
    val horizontalHingeHeight: Dp,
) {
    val supportsTwoPanes: Boolean
        get() = widthClass != AdaptiveWidthClass.Compact && !heightIsCompact

    val paneSpacing: Dp
        get() = max(16f, verticalHingeWidth.value + if (verticalHingeWidth > 0.dp) 12f else 0f).dp
}

@Composable
fun rememberAdaptiveLayoutInfo(): AdaptiveLayoutInfo {
    val adaptiveInfo = currentWindowAdaptiveInfo(supportLargeAndXLargeWidth = true)
    val windowSizeClass = adaptiveInfo.windowSizeClass
    val foldingFeatures by collectFoldingFeaturesAsState()
    val density = LocalDensity.current
    val verticalHinge = foldingFeatures.firstOrNull {
        it.isSeparating && it.orientation == FoldingFeature.Orientation.VERTICAL
    }
    val horizontalHinge = foldingFeatures.firstOrNull {
        it.isSeparating && it.orientation == FoldingFeature.Orientation.HORIZONTAL
    }
    return AdaptiveLayoutInfo(
        widthClass = when {
            windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND) ->
                AdaptiveWidthClass.Expanded
            windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND) ->
                AdaptiveWidthClass.Medium
            else -> AdaptiveWidthClass.Compact
        },
        heightIsCompact = !windowSizeClass.isHeightAtLeastBreakpoint(
            WindowSizeClass.HEIGHT_DP_MEDIUM_LOWER_BOUND,
        ),
        verticalHingeWidth = with(density) { (verticalHinge?.bounds?.width() ?: 0).toDp() },
        horizontalHingeHeight = with(density) { (horizontalHinge?.bounds?.height() ?: 0).toDp() },
    )
}

object AdaptiveLayoutPolicy {
    const val TWO_COLUMN_MIN_DP = 600
    const val DETAIL_MIN_DP = 840
    const val STARTLIST_CARD_MIN_DP = 290
    const val MAX_STARTLIST_COLUMNS = 3

    data class BalancedBreak(val blockIndex: Int, val offset: Int)

    data class Row<T>(val items: List<T>, val spansAllColumns: Boolean)

    fun feedColumns(containerWidthDp: Float, info: AdaptiveLayoutInfo): Int =
        if (info.supportsTwoPanes && containerWidthDp >= TWO_COLUMN_MIN_DP) 2 else 1

    fun startlistColumns(containerWidthDp: Float, info: AdaptiveLayoutInfo, spacingDp: Float = 12f): Int {
        if (!info.supportsTwoPanes) return 1
        val fitted = ((containerWidthDp + spacingDp) / (STARTLIST_CARD_MIN_DP + spacingDp)).toInt()
        return fitted.coerceIn(1, MAX_STARTLIST_COLUMNS)
    }

    fun usesWideDetail(containerWidthDp: Float, info: AdaptiveLayoutInfo): Boolean =
        info.supportsTwoPanes && containerWidthDp >= DETAIL_MIN_DP

    fun balancedBreak(counts: List<Int>): BalancedBreak {
        val target = (counts.sum() + 1) / 2
        var accumulated = 0
        counts.forEachIndexed { index, count ->
            when {
                accumulated + count < target -> accumulated += count
                accumulated + count == target -> return BalancedBreak(index + 1, 0)
                else -> return BalancedBreak(index, (target - accumulated).coerceAtLeast(0))
            }
        }
        return BalancedBreak(counts.size, 0)
    }

    /** Elige un límite entre bloques completos minimizando la diferencia de carga. */
    fun balancedBlockBreak(counts: List<Int>): Int {
        if (counts.size < 2) return counts.size
        val total = counts.sum()
        return (1 until counts.size).minBy { boundary ->
            abs(total - 2 * counts.take(boundary).sum())
        }
    }

    fun <T> rows(
        items: List<T>,
        columns: Int,
        spansAllColumns: (T) -> Boolean = { false },
    ): List<Row<T>> {
        if (columns <= 1) return items.map { Row(listOf(it), true) }
        val result = mutableListOf<Row<T>>()
        val pending = mutableListOf<T>()
        fun flush() {
            if (pending.isNotEmpty()) {
                result += Row(pending.toList(), false)
                pending.clear()
            }
        }
        items.forEach { item ->
            if (spansAllColumns(item)) {
                flush()
                result += Row(listOf(item), true)
            } else {
                pending += item
                if (pending.size == columns) flush()
            }
        }
        flush()
        return result
    }
}
