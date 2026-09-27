package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest

/**
 * Bandera de país rectangular (proporción 4:3, default 20×15 dp). Los SVG
 * viven empaquetados en `app/src/main/assets/flags/<code>.svg` — mismo set
 * que usa iOS (lipis/flag-icons v7.2.3, 4x3). Se cargan vía
 * `file:///android_asset/...` y los decodifica Coil con su `SvgDecoder` ya
 * registrado en `CalendarioCiclismoApp.newImageLoader`.
 *
 * Al ir por disco local no hay red, no hay parpadeo al cambiar de día ni al
 * entrar en otras vistas, y el render funciona offline desde el primer arranque.
 *
 * El código se pasa en minúsculas, lo que permite banderas sub-nacionales
 * (es-ct, es-pv, gb-eng, gb-sct, gb-wls) ya incluidas en el set.
 *
 * `height` permite ajustar el tamaño en contextos densos (p.ej. orden de
 * salida usa 11dp para alinear con la altura visual del glifo del nombre).
 * El ancho se calcula automáticamente preservando la proporción 4:3.
 */
@Composable
fun CountryFlag(
    countryCode: String?,
    modifier: Modifier = Modifier,
    height: Dp = 15.dp,
    countryName: String? = null,
) {
    if (countryCode.isNullOrBlank()) return
    val code = countryCode.lowercase()
    val context = LocalContext.current

    // Si la variante regional no está empaquetada en esta build (una autonomía
    // añadida después), cae a la bandera del país (`es-an` → `es`). Así las
    // versiones anteriores a 5.0.1 no quedan sin bandera ante códigos nuevos.
    val resolved = remember(code) {
        fun exists(candidate: String) = runCatching {
            context.assets.open("flags/$candidate.svg").use { true }
        }.getOrDefault(false)
        when {
            code.isBlank() -> ""
            exists(code) -> code
            '-' in code -> code.substringBefore('-').takeIf { exists(it) } ?: ""
            else -> ""
        }
    }
    if (resolved.isBlank()) return

    val request = remember(resolved) {
        val key = "flag_$resolved"
        ImageRequest.Builder(context)
            .data("file:///android_asset/flags/$resolved.svg")
            .memoryCacheKey(key)
            .placeholderMemoryCacheKey(key)
            .build()
    }

    AsyncImage(
        model = request,
        contentDescription = countryName,
        contentScale = ContentScale.Crop,
        modifier = modifier
            .size(width = height * 4 / 3, height = height)
            .clip(RoundedCornerShape(2.dp)),
    )
}
