package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.painterResource
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.theme.neutralFill
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.data.sync.ImageAssetCache
import app.calendariociclismo.android.ui.theme.CCRadius
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
 * Solo la imagen ajustada y el recorte de radio 4: sin caja, fondo, margen ni
 * borde en ninguna vista.
 *
 * Si el modo offline ha descargado el logo, pasa el fichero local a Coil para
 * que el render sea instantáneo y funcione sin red.
 */
@Composable
fun RaceLogo(
    url: String?,
    modifier: Modifier = Modifier,
    size: Dp = 32.dp,
    /** Sin logo, o si no carga, el hueco de la marca ([LogoPlaceholder]) en
     *  lugar de nada. Solo en carreras que admiten logo: nunca en los
     *  Campeonatos Nacionales. */
    placeholder: Boolean = false,
) {
    if (url.isNullOrBlank()) {
        if (placeholder) LogoPlaceholder(size = size, modifier = modifier)
        return
    }
    var failed by remember(url) { mutableStateOf(false) }
    if (failed && placeholder) {
        LogoPlaceholder(size = size, modifier = modifier)
        return
    }
    val context = LocalContext.current
    val cache   = ImageAssetCache.instance()

    // Prioridad: caché offline → bundle empaquetado → URL remota.
    val localFile = cache?.localLogoFile(url)
    val model: Any = localFile
        ?: cache?.bundledLogoAssetUri(url)
        ?: url

    val shape = RoundedCornerShape(CCRadius.Control)
    AsyncImage(
        model = ImageRequest.Builder(context)
            .data(model)
            .crossfade(true)
            .build(),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = modifier
            .size(size)
            .clip(shape),
        placeholder = null,
        error = null,
        fallback = null,
        onError = { failed = true },
    )
}

/**
 * Hueco de logotipo: la marca de la cabecera (calendario y bici) en gris tenue
 * sobre el relleno neutro, con el radio de control y el tamaño del logo, para
 * que filas y cabeceras no cambien de forma. Concepto de Alejandro Monteagudo
 * con la estética actual de la app (iOS: `LogoPlaceholder`; web:
 * `logoPlaceholderHtml`).
 */
@Composable
fun LogoPlaceholder(size: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(CCRadius.Control))
            .background(neutralFill),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_cc_header),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f),
            modifier = Modifier.fillMaxWidth(0.72f),
        )
    }
}
