package app.calendariociclismo.android.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.view.WindowInsetsController
import android.view.View
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.graphics.Color
import app.calendariociclismo.android.util.LocaleHolder
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.compose.ui.window.DialogWindowProvider

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
    outlineVariant = CCColors.LightBorder,
    onSurfaceVariant = CCColors.LightTextMuted,
    // Tramo de superficies tonales (contenedor de AlertDialog, menús): el
    // lavanda por defecto de M3 se sustituye por los neutros de marca, igual
    // que se neutralizó surfaceTint y secondaryContainer.
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = CCColors.LightCard,
    surfaceContainer = CCColors.LightCard,
    surfaceContainerHigh = CCColors.LightCard,
    surfaceContainerHighest = CCColors.LightCardHover,
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
    outlineVariant = CCColors.DarkBorder,
    onSurfaceVariant = CCColors.DarkTextMuted,
    // Tramo de superficies tonales neutro (igual que en Light).
    surfaceContainerLowest = CCColors.DarkBg,
    surfaceContainerLow = CCColors.DarkCard,
    surfaceContainer = CCColors.DarkCard,
    surfaceContainerHigh = CCColors.DarkCard,
    surfaceContainerHighest = CCColors.DarkCardHover,
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

    SystemBarsAppearance(darkTheme)

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

/** Actualiza la ventana de la Activity o la del diálogo que aloja este contenido. */
@Composable
internal fun SystemBarsAppearance(darkTheme: Boolean) {
    val view = LocalView.current
    // El fondo de las barras lo dibuja la Surface de MainActivity. Los atributos
    // XML fijan la apariencia inicial y este efecto aplica los cambios de tema.
    // No se usan colores de Window: Android 15+ impone barras transparentes.
    if (!view.isInEditMode) {
        DisposableEffect(darkTheme, view) {
            val window = generateSequence(view) { it.parent as? View }
                .filterIsInstance<DialogWindowProvider>()
                .firstOrNull()?.window ?: view.context.findActivity()?.window
            fun applyAppearance() {
                if (window == null) return
                val darkIcons = !darkTheme
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    isAppearanceLightStatusBars = darkIcons
                    isAppearanceLightNavigationBars = darkIcons
                }
                // Conserva la aplicación nativa que se verificó en Pixel 9a.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                    window.insetsController?.setSystemBarsAppearance(
                        if (darkIcons) mask else 0,
                        mask,
                    )
                }
            }
            applyAppearance()
            val reapply = Runnable { applyAppearance() }
            window?.decorView?.post(reapply)
            onDispose { window?.decorView?.removeCallbacks(reapply) }
        }
    }
}
