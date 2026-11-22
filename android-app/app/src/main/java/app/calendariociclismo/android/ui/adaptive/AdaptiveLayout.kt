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
    /** Ancho mínimo del contenedor para lista y detalle en Fichajes: columna
     *  lateral de 280 dp y detalle de al menos 360 dp (iOS: size class regular). */
    const val LIST_DETAIL_MIN_DP = 640
    /** Ancho del contenedor desde el que la columna lateral de Fichajes pasa de
     *  280 a 320 dp (iOS: ancho ideal 320 pt, mínimo 280 pt). */
    const val LIST_DETAIL_WIDE_SIDEBAR_MIN_DP = 760
    const val LIST_DETAIL_SIDEBAR_DP = 280
    const val LIST_DETAIL_WIDE_SIDEBAR_DP = 320

    data class Row<T>(val items: List<T>, val spansAllColumns: Boolean)

    fun feedColumns(containerWidthDp: Float, info: AdaptiveLayoutInfo): Int =
        if (info.supportsTwoPanes && containerWidthDp >= TWO_COLUMN_MIN_DP) 2 else 1

    /** Fichajes con columna lateral y detalle en lugar de una sola columna. */
    fun usesListDetail(containerWidthDp: Float, info: AdaptiveLayoutInfo): Boolean =
        info.supportsTwoPanes && containerWidthDp >= LIST_DETAIL_MIN_DP

    fun listDetailSidebarDp(containerWidthDp: Float): Int =
        if (containerWidthDp >= LIST_DETAIL_WIDE_SIDEBAR_MIN_DP) LIST_DETAIL_WIDE_SIDEBAR_DP else LIST_DETAIL_SIDEBAR_DP

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

    fun <T> rows(items: List<T>, columns: Int): List<Row<T>> {
        if (columns <= 1) return items.map { Row(listOf(it), true) }
        return items.chunked(columns).map { Row(it, false) }
    }
}
