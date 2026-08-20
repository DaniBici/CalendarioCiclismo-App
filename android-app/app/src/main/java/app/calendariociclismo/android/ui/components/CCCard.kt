package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Tarjeta canónica de la app — superficie pulida única extraída del cintillo
 * "Hoy" (TodayHighlightsBanner). Centraliza el "tratamiento de tarjeta" para
 * que toda la UI Android comparta el mismo lenguaje visual:
 *
 *  - Esquinas redondeadas (18dp por defecto, igual que el cintillo).
 *  - Elevación tonal Material 3 (2dp) en vez del blur de iOS.
 *  - Tinte de marca opcional muy leve sobre el contenedor (7% por defecto).
 *  - Hairline de borde para definir la tarjeta sobre fondos claros, donde el
 *    contenedor elevado casi se funde con el `background`.
 *
 * El contenido recibe el área interna ya recortada a la forma de la tarjeta;
 * cualquier `clickable`/ripple del contenido queda confinado a las esquinas.
 *
 * Paridad de referencia: `TodayHighlightsBanner.BannerCarousel`.
 */
@Composable
fun CCCard(
    modifier: Modifier = Modifier,
    /** Color de marca; si no es nulo, tiñe el contenedor a [accentAlpha]. */
    accent: Color? = null,
    accentAlpha: Float = 0.07f,
    cornerRadius: Int = 18,
    elevation: Int = 2,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(cornerRadius.dp)
    // Contenedor explícito según el modo:
    //  - Neutro (sin accent): gris frío `surfaceVariant`, fijado a mano para no
    //    depender del tinte de elevación de M3 (que reintroducía el rosado).
    //  - Listados (con accent): superficie blanca `surface` + velo de marca en
    //    el Box interior, conservando el aspecto previo de Hoy.
    val containerColor =
        if (accent != null) MaterialTheme.colorScheme.surface
        else MaterialTheme.colorScheme.surfaceVariant
    ElevatedCard(
        shape = shape,
        colors = CardDefaults.elevatedCardColors(containerColor = containerColor),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = elevation.dp),
        modifier = modifier,
    ) {
        Box(
            modifier = Modifier
                .clip(shape)
                // Tinte de marca muy leve sobre el contenedor de la tarjeta.
                .then(
                    if (accent != null) Modifier.background(accent.copy(alpha = accentAlpha))
                    else Modifier
                )
                // Hairline de definición sobre fondos claros.
                .border(
                    width = 0.5.dp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f),
                    shape = shape,
                ),
        ) {
            content()
        }
    }
}
