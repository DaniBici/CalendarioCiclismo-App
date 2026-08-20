package app.calendariociclismo.android.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Parsea un hex string ("#RRGGBB" o "RRGGBB", con o sin alpha) a `Color`.
 * Devuelve `fallback` si la cadena es nula o inválida, para que las call sites
 * no tengan que envolver todo en try/catch.
 */
fun colorFromHex(hex: String?, fallback: Color = Color(0xFF888888)): Color {
    if (hex.isNullOrEmpty()) return fallback
    val clean = hex.removePrefix("#")
    return try {
        when (clean.length) {
            6 -> Color(
                red = clean.substring(0, 2).toInt(16) / 255f,
                green = clean.substring(2, 4).toInt(16) / 255f,
                blue = clean.substring(4, 6).toInt(16) / 255f,
            )
            8 -> Color(
                alpha = clean.substring(0, 2).toInt(16) / 255f,
                red = clean.substring(2, 4).toInt(16) / 255f,
                green = clean.substring(4, 6).toInt(16) / 255f,
                blue = clean.substring(6, 8).toInt(16) / 255f,
            )
            else -> fallback
        }
    } catch (_: NumberFormatException) {
        fallback
    }
}

/**
 * Paleta de la app, portada desde `css/app.css` para mantener paridad visual
 * con la web y el iOS (que también reutiliza esos tokens vía SwiftUI).
 */
object CCColors {
    // ─── Dark ───
    val DarkBg = Color(0xFF111318)
    val DarkCard = Color(0xFF1C1E24)
    val DarkCardHover = Color(0xFF24262D)
    val DarkBorder = Color(0xFF2E3038)
    val DarkOutline = Color(0xFF938F99)  // para Switch thumb, OutlinedTextField, etc.
    val DarkText = Color(0xFFE2E2E9)
    val DarkTextMuted = Color(0xFF8E9099)
    val DarkAccent = Color(0xFF1A73E8)
    val DarkRed = Color(0xFFFFB4AB)
    val DarkGreen = Color(0xFF6DD58C)
    val DarkBlue = Color(0xFF7FCFFF)
    val DarkOrange = Color(0xFFFFB77C)
    // Fondo del segmento activo del SegmentedButton (secondaryContainer) — azul
    // de marca apagado (~22%) horneado sobre la superficie oscura DarkCard, para
    // sustituir el morado por defecto de M3. Texto/icono = DarkBlue.
    val DarkSegmentedActive = Color(0xFF1C314F)

    // ─── Light ───
    val LightBg = Color(0xFFFFFFFF)
    val LightCard = Color(0xFFFFFFFF)
    // Gris neutro balanceado para superficies elevadas neutras (tarjetas de
    // detalle y Ajustes). Antes 0xFFF1F3F4, que tenía un punto cálido y, al
    // mezclarse sobre blanco, daba un tono rosado/lila perceptible. Este valor
    // tiene R=G=B equilibrados (gris puro) para que la superficie no tire ni a
    // rosa ni a azul.
    val LightCardHover = Color(0xFFEFEFF1)
    val LightBorder = Color(0xFFE0E0E0)
    val LightOutline = Color(0xFF747775)  // para Switch thumb, OutlinedTextField, etc.
    val LightText = Color(0xFF1F1F1F)
    val LightTextMuted = Color(0xFF5F6368)
    val LightAccent = Color(0xFF1A73E8)
    val LightRed = Color(0xFFC5221F)
    val LightGreen = Color(0xFF137333)
    val LightBlue = Color(0xFF1A73E8)
    val LightOrange = Color(0xFFE37400)
    // Fondo del segmento activo del SegmentedButton (secondaryContainer) — azul
    // de marca al ~14% horneado sobre blanco (el segmento se rellena opaco), para
    // sustituir el lavanda por defecto de M3. Texto/icono = LightAccent.
    val LightSegmentedActive = Color(0xFFDFEBFC)
}
