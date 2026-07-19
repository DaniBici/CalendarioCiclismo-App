package app.calendariociclismo.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * Tipografía M3 basada en la familia por defecto del sistema (San Francisco
 * en iOS / Roboto en Android). Tamaños alineados con la web.
 *
 * Todos los estilos desactivan el "font padding" legacy de Android
 * (`includeFontPadding=false`) y recortan ambos lados del line-height
 * (`trim = Both`), de forma que el alto visual de cada `Text` se ajusta al
 * glifo real — sin el colchón invisible de ~3-4dp arriba/abajo que añadía
 * el TextView clásico. Esto permite que el padding declarado en el layout
 * (paddings de Row/Column) controle realmente el espacio entre elementos.
 *
 * Compose Material 3 recomienda esta configuración por defecto desde 1.2.
 */
private val tightPlatformStyle = PlatformTextStyle(includeFontPadding = false)
private val tightLineHeightStyle = LineHeightStyle(
    alignment = LineHeightStyle.Alignment.Center,
    trim = LineHeightStyle.Trim.Both,
)

private fun ccTextStyle(
    weight: FontWeight,
    size: TextUnit,
    lineHeight: TextUnit,
): TextStyle = TextStyle(
    fontFamily = FontFamily.Default,
    fontWeight = weight,
    fontSize = size,
    lineHeight = lineHeight,
    platformStyle = tightPlatformStyle,
    lineHeightStyle = tightLineHeightStyle,
)

val CCTypography = Typography(
    headlineLarge  = ccTextStyle(FontWeight.Bold,     28.sp, 34.sp),
    headlineMedium = ccTextStyle(FontWeight.SemiBold, 22.sp, 28.sp),
    titleLarge     = ccTextStyle(FontWeight.SemiBold, 20.sp, 26.sp),
    titleMedium    = ccTextStyle(FontWeight.Medium,   17.sp, 22.sp),
    titleSmall     = ccTextStyle(FontWeight.Medium,   14.sp, 18.sp),
    bodyLarge      = ccTextStyle(FontWeight.Normal,   16.sp, 22.sp),
    bodyMedium     = ccTextStyle(FontWeight.Normal,   14.sp, 20.sp),
    bodySmall      = ccTextStyle(FontWeight.Normal,   12.sp, 16.sp),
    labelLarge     = ccTextStyle(FontWeight.Medium,   14.sp, 18.sp),
    labelSmall     = ccTextStyle(FontWeight.Medium,   11.sp, 14.sp),
)

/**
 * Default `TextStyle` para `Text` que no especifican un `style` propio.
 * Compose usa `LocalTextStyle.current` cuando no se le pasa estilo explícito;
 * proveer este valor a nivel de tema garantiza que todo `Text` del árbol
 * herede `includeFontPadding=false` + `lineHeightStyle(trim = Both)` sin
 * que cada componente lo declare individualmente.
 */
val CCDefaultTextStyle: TextStyle = TextStyle.Default.copy(
    platformStyle = tightPlatformStyle,
    lineHeightStyle = tightLineHeightStyle,
)
