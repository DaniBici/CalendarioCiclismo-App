package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.data.sync.ImageAssetCache
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade

/**
 * Logo de carrera cargado desde URL (Cloudflare R2).
 *
 * Port Compose de `ios-app/.../Views/Components/RaceLogo.swift`.
 * Si la URL es nula o en blanco NO se emite nada: el slot no ocupa espacio y el
 * contenido a su derecha se desplaza a ocuparlo. En un Row con `spacedBy`, el
 * espaciado solo se aplica entre hijos que sí emiten, así que tampoco queda
 * hueco de separación.
 *
 * Si el modo offline ha descargado el logo, pasa el fichero local a Coil para
 * que el render sea instantáneo y funcione sin red.
 */
@Composable
fun RaceLogo(
    url: String?,
    modifier: Modifier = Modifier,
    size: Dp = 32.dp,
) {
    if (url.isNullOrBlank()) return
    val context = LocalContext.current
    val cache   = ImageAssetCache.instance()

    // Prioridad: caché offline → bundle empaquetado → URL remota.
    val localFile = cache?.localLogoFile(url)
    val model: Any = localFile
        ?: cache?.bundledLogoAssetUri(url)
        ?: url

    AsyncImage(
        model = ImageRequest.Builder(context)
            .data(model)
            .crossfade(true)
            .build(),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(3.dp)),
        placeholder = null,
        error = null,
        fallback = null,
    )
}
