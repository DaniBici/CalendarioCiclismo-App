package app.calendariociclismo.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Escala visual común (espejo de css/app.css e iOS `AppTheme`).
 *
 * Dos radios: 4 dp para controles y etiquetas, 8 dp para superficies. Los
 * círculos usan `CircleShape` solo donde son círculos.
 */
object CCRadius {
    val Control = 4.dp
    val Surface = 8.dp
}

/**
 * Escala tipográfica de siete tamaños (`--fs-1` a `--fs-7`): 12, 13, 14, 16,
 * 20, 28 y 36 sp. Ningún texto fija otro tamaño.
 */
object CCText {
    val S12: TextStyle get() = CCTextStyles.s12
    val S13: TextStyle get() = CCTextStyles.s13
    val S14: TextStyle get() = CCTextStyles.s14
    val S16: TextStyle get() = CCTextStyles.s16
    val S20: TextStyle get() = CCTextStyles.s20
    val S28: TextStyle get() = CCTextStyles.s28
    val S36: TextStyle get() = CCTextStyles.s36
}

internal object CCTextStyles {
    val s12 = ccTextStyle(FontWeight.Normal, 12.sp, 16.sp)
    val s13 = ccTextStyle(FontWeight.Normal, 13.sp, 18.sp)
    val s14 = ccTextStyle(FontWeight.Normal, 14.sp, 20.sp)
    val s16 = ccTextStyle(FontWeight.Normal, 16.sp, 22.sp)
    val s20 = ccTextStyle(FontWeight.SemiBold, 20.sp, 26.sp)
    val s28 = ccTextStyle(FontWeight.Bold, 28.sp, 34.sp)
    val s36 = ccTextStyle(FontWeight.Bold, 36.sp, 42.sp)
}

/**
 * Superficie neutra de etiquetas y estado único de pulsación: texto al 8 %
 * (`--badge-neutral-bg` y `--hover-bg` de la web).
 */
val neutralFill: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)

/** Etiqueta neutra pulsada (`--badge-neutral-hover`). */
val neutralFillPressed: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.14f)
