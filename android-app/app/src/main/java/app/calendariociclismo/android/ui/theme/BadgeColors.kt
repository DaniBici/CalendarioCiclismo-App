package app.calendariociclismo.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color

/**
 * Port Kotlin del enum de colores de badges de `ios-app/.../Theme/AppTheme.swift`.
 *
 * Cada badge tiene color de fondo (con opacidad baja) y color de texto/icono.
 */
data class BadgeColor(val background: Color, val foreground: Color)

private fun mix(bg: Color): Color = bg.copy(alpha = 0.15f)

/**
 * Categoría UCI y género: superficie neutra (el color queda para el tipo de
 * etapa y los estados).
 */
@Composable
@ReadOnlyComposable
@Suppress("UNUSED_PARAMETER")
fun categoryBadgeColor(category: String?): BadgeColor = neutralBadgeColor()

/** Etiqueta neutra con texto atenuado (categoría, género). */
@Composable
@ReadOnlyComposable
fun neutralBadgeColor(): BadgeColor =
    BadgeColor(neutralFill, MaterialTheme.colorScheme.onSurfaceVariant)

/**
 * Etiqueta neutra de enlace (TV, Íntegra, dorsales, orden de salida,
 * resultados): texto principal sobre la superficie neutra.
 */
@Composable
@ReadOnlyComposable
fun neutralLinkBadgeColor(): BadgeColor =
    BadgeColor(neutralFill, MaterialTheme.colorScheme.onSurface)

/** Colores de badge por tipo de etapa (llana, media montaña, CRI, etc). */
@Composable
@ReadOnlyComposable
fun stageTypeBadgeColor(type: String?): BadgeColor {
    val dark = isSystemInDarkTheme()
    return when (type) {
        "flat" -> BadgeColor(mix(Color(0xFF8CDC64)), Color(0xFF2E8B3A))
            .maybeDark(dark, Color(0xFF8CDC64))
        "rolling" -> BadgeColor(mix(Color(0xFF7AB85A)), Color(0xFF3D6D2A))
            .maybeDark(dark, Color(0xFF7AB85A))
        "cotas" -> BadgeColor(mix(Color(0xFFBCB755)), Color(0xFF8A8420))
            .maybeDark(dark, Color(0xFFD4CD6A))
        "medium_mountain" -> BadgeColor(mix(Color(0xFFFFB750)), Color(0xFFB87400))
            .maybeDark(dark, Color(0xFFFFB750))
        "high_mountain", "summit_finish", "chrono_climb" ->
            BadgeColor(mix(Color(0xFFFF7864)), Color(0xFFB1392A))
                .maybeDark(dark, Color(0xFFFF7864))
        "uphill_finish" -> BadgeColor(mix(Color(0xFFFFA030)), Color(0xFFB86000))
            .maybeDark(dark, Color(0xFFFFA030))
        "itt", "ttt" -> BadgeColor(mix(Color(0xFF64C8FF)), Color(0xFF1565C0))
            .maybeDark(dark, Color(0xFF64C8FF))
        "cobbles" -> BadgeColor(mix(Color(0xFFA8A8A8)), Color(0xFF4A4A4A))
            .maybeDark(dark, Color(0xFFBDBDBD))
        "sterrato" -> BadgeColor(mix(Color(0xFFD4BC8C)), Color(0xFF7B5C2F))
            .maybeDark(dark, Color(0xFFD4BC8C))
        else -> grayBadge(dark)
    }
}

/**
 * Colores del badge de TV. Color con significado solo en los estados: en
 * directo verde, «No TV España» rojo, sin confirmar naranja. Emisión con hora,
 * Íntegra y Live texto previo van en la etiqueta neutra de enlace.
 */
@Composable
@ReadOnlyComposable
fun tvStatusBadgeColor(
    status: String?,
    hasBroadcasts: Boolean,
    isLiveText: Boolean = false,
    isLiveTextPre: Boolean = false,
    isTvLive: Boolean = false,
): BadgeColor {
    val dark = isSystemInDarkTheme()
    val green = if (dark) Color(0xFF6DD58C) else Color(0xFF137333)
    return when {
        isLiveTextPre -> neutralLinkBadgeColor()
        isTvLive -> BadgeColor(mix(green), green)
        isLiveText -> BadgeColor(mix(green), green)
        status == "none" -> grayBadge(dark)
        status == "unavailable_es" -> {
            val fg = if (dark) Color(0xFFFFB4AB) else Color(0xFFC5221F)
            BadgeColor(mix(fg), fg)
        }
        status == "pending" -> {
            val fg = if (dark) Color(0xFFFFB77C) else Color(0xFFE37400)
            BadgeColor(mix(fg), fg)
        }
        hasBroadcasts || status == "confirmed" -> neutralLinkBadgeColor()
        else -> grayBadge(dark)
    }
}

private fun grayBadge(dark: Boolean): BadgeColor {
    val fg = if (dark) Color(0xFF8E9099) else Color(0xFF5F6368)
    return BadgeColor(mix(fg), fg)
}

/** Helper para dark mode: si estamos en dark, usamos [darkFg] como foreground. */
private fun BadgeColor.maybeDark(dark: Boolean, darkFg: Color): BadgeColor =
    if (dark) BadgeColor(mix(darkFg), darkFg) else this
