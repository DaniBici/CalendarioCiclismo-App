package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.ui.theme.CCRadius

/** Elevación única de las tarjetas: cintillo, listados, detalle y mosaicos. */
val CC_CARD_ELEVATION: Dp = 2.dp

/**
 * Tarjeta canónica de la app: superficie neutra (`surface`) con el radio de
 * superficie ([CCRadius.Surface], 8 dp) y la elevación común. Sin tinte de
 * carrera ni filete: el color de carrera solo marca el avance de una jornada
 * en directo y el perfil recorrido. `cornerRadius = 0` queda para superficies
 * a sangre (listas a ancho completo).
 *
 * El contenido recibe el área interna ya recortada a la forma de la tarjeta;
 * cualquier `clickable`/ripple del contenido queda confinado a las esquinas.
 *
 * Paridad: iOS `CCCard` / `ccCardSurface`.
 */
@Composable
fun CCCard(
    modifier: Modifier = Modifier,
    cornerRadius: Dp = CCRadius.Surface,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(cornerRadius)
    ElevatedCard(
        shape = shape,
        colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = CC_CARD_ELEVATION),
        modifier = modifier,
    ) {
        Box(modifier = Modifier.clip(shape)) {
            content()
        }
    }
}
