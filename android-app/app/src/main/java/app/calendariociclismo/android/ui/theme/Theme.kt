package app.calendariociclismo.android.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.util.Log
import android.view.View
import android.view.WindowInsetsController
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import app.calendariociclismo.android.util.LocaleHolder
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Material 3 theme con paleta fija (sin dynamic color). Tomamos `LightAccent`
 * y `DarkAccent` como `primary`, de forma que el color principal sea el mismo
 * que en la web/iOS.
 */
private val LightScheme = lightColorScheme(
    primary = CCColors.LightAccent,
    onPrimary = CCColors.LightBg,
    primaryContainer = CCColors.LightCardHover,
    onPrimaryContainer = CCColors.LightText,
    secondary = CCColors.LightBlue,
    onSecondary = CCColors.LightBg,
    // El segmento activo del SegmentedButton de M3 usa secondaryContainer. Por
    // defecto es un lavanda/morado que no aparece en ninguna otra parte de la
    // app. Lo mapeamos al azul tenue de la marca (mismo lenguaje que las pills
    // de filtro: primary al ~15%, ver ChampionshipsScreen.FilterChips). Como el
    // segmento se rellena opaco, horneamos el azul al 14% sobre blanco.
    secondaryContainer = CCColors.LightSegmentedActive,
    onSecondaryContainer = CCColors.LightAccent,
    tertiary = CCColors.LightOrange,
    background = CCColors.LightBg,
    onBackground = CCColors.LightText,
    surface = CCColors.LightCard,
    onSurface = CCColors.LightText,
    surfaceVariant = CCColors.LightCardHover,
    onSurfaceVariant = CCColors.LightTextMuted,
    // Tinte de elevación neutralizado: igualado a la superficie neutra para que
    // los ElevatedCard NO añadan el morado/rosa por defecto de M3 al elevarse.
    // El color de las tarjetas neutras lo fija CCCard explícitamente.
    surfaceTint = CCColors.LightCardHover,
    outline = CCColors.LightOutline,
    error = CCColors.LightRed,
)

private val DarkScheme = darkColorScheme(
    primary = CCColors.DarkAccent,
    onPrimary = CCColors.LightBg,
    primaryContainer = CCColors.DarkCardHover,
    onPrimaryContainer = CCColors.DarkText,
    secondary = CCColors.DarkBlue,
    onSecondary = CCColors.DarkBg,
    // Igual que en Light: el segmento activo del SegmentedButton de M3 (que usa
    // secondaryContainer) salía con el morado por defecto de M3. Lo mapeamos a
    // un azul apagado que asienta sobre la superficie oscura, con texto/icono en
    // el azul claro (DarkBlue) para contraste.
    secondaryContainer = CCColors.DarkSegmentedActive,
    onSecondaryContainer = CCColors.DarkBlue,
    tertiary = CCColors.DarkOrange,
    background = CCColors.DarkBg,
    onBackground = CCColors.DarkText,
    surface = CCColors.DarkCard,
    onSurface = CCColors.DarkText,
    surfaceVariant = CCColors.DarkCardHover,
    onSurfaceVariant = CCColors.DarkTextMuted,
    // Tinte de elevación neutralizado (igual que Light): evita el tinte morado
    // por defecto de M3 al elevar tarjetas en modo oscuro.
    surfaceTint = CCColors.DarkCardHover,
    outline = CCColors.DarkOutline,
    error = CCColors.DarkRed,
)

private fun Context.findActivity(): Activity? {
    var ctx = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}

@Composable
fun CalendarioCiclismoTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    // Suscripción al locale a nivel de tema: cualquier cambio de idioma
    // recompone todo el árbol de UI, actualizando localizedName, stageLabel
    // y cualquier propiedad computed locale-dependiente en modelos y utils.
    @Suppress("UNUSED_VARIABLE") val localeKey = LocaleHolder.currentState

    val colorScheme = if (darkTheme) DarkScheme else LightScheme
    val view = LocalView.current

    // En modo claro queremos: fondo claro (background) con iconos del sistema
    // OSCUROS para que sean legibles. En modo oscuro: fondo oscuro con iconos
    // CLAROS. Aplicamos los DOS controles porque cada uno por sí solo no basta:
    //
    // 1. window.statusBarColor — pinta el fondo de la barra del color del tema.
    //    Está marcado como deprecated en API 35+ pero sigue siendo respetado
    //    porque el manifest no incluye windowOptOutEdgeToEdgeEnforcement.
    //    Sin esto, en API 35+ la barra queda transparente y los iconos se ven
    //    sobre el wallpaper o el contenido que haya pintado debajo.
    //
    // 2. isAppearanceLightStatusBars — controla el color de los iconos
    //    (true = oscuros, false = claros). findActivity() desempaqueta
    //    ContextWrapper porque LocalView.context puede ser un wrapper y el
    //    cast directo a Activity falla silenciosamente.
    if (!view.isInEditMode) {
        DisposableEffect(darkTheme) {
            val activity = view.context.findActivity()
            val window = activity?.window
            if (window != null) {
                val barBg = colorScheme.background.toArgb()
                @Suppress("DEPRECATION")
                window.statusBarColor = barBg
                @Suppress("DEPRECATION")
                window.navigationBarColor = barBg

                // Triple control de la apariencia de iconos. Cada API ataca una
                // capa distinta del sistema; aplicar las tres juntas garantiza
                // que al menos una efectiva en cualquier versión (API 26 → 37+).
                val lightIcons = !darkTheme

                // 1. WindowCompat (compat moderna, recomendada por Google)
                val controllerCompat = WindowCompat.getInsetsController(window, view)
                controllerCompat.isAppearanceLightStatusBars = lightIcons
                controllerCompat.isAppearanceLightNavigationBars = lightIcons

                // 2. WindowInsetsController nativo (API 30+) — en API 35+ esta
                // es la única ruta que respeta Android 16 Canary cuando la
                // versión compat no se aplica por algún cambio interno.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val nativeController = window.insetsController
                    if (nativeController != null) {
                        val statusMask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        val navMask = WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                        val appearance =
                            (if (lightIcons) statusMask else 0) or
                            (if (lightIcons) navMask else 0)
                        nativeController.setSystemBarsAppearance(appearance, statusMask or navMask)
                    }
                }

                // 3. systemUiVisibility legacy (API 23-29). En API 30+ es noop
                // pero no estorba; útil si algún OEM antiguo no respeta lo demás.
                @Suppress("DEPRECATION")
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                    val decor = window.decorView
                    val flag = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    decor.systemUiVisibility = if (lightIcons) {
                        decor.systemUiVisibility or flag
                    } else {
                        decor.systemUiVisibility and flag.inv()
                    }
                }

                onDispose { }
            } else {
                onDispose { }
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = CCTypography,
    ) {
        // Default global: cualquier `Text` sin `style` explícito hereda
        // `includeFontPadding=false` + `lineHeightStyle(trim=Both)`. Elimina
        // la necesidad de declarar un `tightTextStyle` local por componente
        // (antes en StartOrderRow y TodayHighlightsBanner).
        CompositionLocalProvider(LocalTextStyle provides CCDefaultTextStyle) {
            content()
        }
    }
}
