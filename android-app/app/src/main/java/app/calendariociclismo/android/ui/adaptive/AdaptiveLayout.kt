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
    /** Ancho máximo del cintillo de destacadas: en tablet horizontal queda
     *  centrado en lugar de recorrer toda la ventana (iOS: `headerStripMaxWidth`). */
    const val HEADER_STRIP_MAX_DP = 640
    /** Ancho de ventana mínimo para tres columnas de vídeos: tres tarjetas de
     *  unos 280 dp, márgenes de 16 dp y dos separaciones de 12 dp (iOS:
     *  `videoThreeColumnThreshold`, medido sobre el contenido). */
    const val VIDEO_THREE_COLUMN_MIN_DP = 900

    data class Row<T>(val items: List<T>, val spansAllColumns: Boolean)

    fun feedColumns(containerWidthDp: Float, info: AdaptiveLayoutInfo): Int =
        if (info.supportsTwoPanes && containerWidthDp >= TWO_COLUMN_MIN_DP) 2 else 1

    /** Columnas de los vídeos de ciclocross: dos con el ancho de dos columnas de
     *  Hoy y tres en un contenedor apaisado con ancho para tres tarjetas
     *  (tablet en horizontal). En vertical, dos. */
    fun videoColumns(containerWidthDp: Float, isLandscape: Boolean, info: AdaptiveLayoutInfo): Int {
        if (feedColumns(containerWidthDp, info) < 2) return 1
        return if (isLandscape && containerWidthDp >= VIDEO_THREE_COLUMN_MIN_DP) 3 else 2
    }

    fun startlistColumns(containerWidthDp: Float, info: AdaptiveLayoutInfo, spacingDp: Float = 12f): Int {
        if (!info.supportsTwoPanes) return 1
        val fitted = ((containerWidthDp + spacingDp) / (STARTLIST_CARD_MIN_DP + spacingDp)).toInt()
        return fitted.coerceIn(1, MAX_STARTLIST_COLUMNS)
    }

    fun usesWideDetail(containerWidthDp: Float, info: AdaptiveLayoutInfo): Boolean =
        info.supportsTwoPanes && containerWidthDp >= DETAIL_MIN_DP

    /** Elige un límite entre bloques completos minimizando la diferencia de carga. */
    fun balancedBlockBreak(counts: List<Int>): Int {
        if (counts.size < 2) return counts.size
        val total = counts.sum()
        return (1 until counts.size).minBy { boundary ->
            abs(total - 2 * counts.take(boundary).sum())
        }
    }

    fun <T> rows(items: List<T>, columns: Int): List<Row<T>> {
        if (columns <= 1) return items.map { Row(listOf(it), true) }
        return items.chunked(columns).map { Row(it, false) }
    }
}
