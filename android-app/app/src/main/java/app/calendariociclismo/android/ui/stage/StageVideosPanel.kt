package app.calendariociclismo.android.ui.stage

import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import app.calendariociclismo.android.CalendarioCiclismoApp
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.StageVideoLogic

/**
 * Reproductor de YouTube integrado (`youtube-nocookie`), sin reproducción
 * automática: el usuario pulsa reproducir. Al salir de la composición, el
 * WebView se destruye y el vídeo deja de sonar. Mismo documento que la ficha CX
 * y que `YouTubeInlinePlayer` (iOS).
 */
@Composable
internal fun YouTubeInlinePlayer(youtubeId: String, modifier: Modifier = Modifier) {
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                // Con WRAP_CONTENT el WebView adopta la altura del contenido y
                // el iframe al 100 % queda a 0 px.
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = true
                webChromeClient = WebChromeClient()
                loadDataWithBaseURL("https://calendariociclismo.app", """
                    <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
                    <style>html,body{margin:0;width:100%;height:100%;background:#000}iframe{width:100%;height:100%;border:0}</style>
                    </head><body><iframe src="https://www.youtube-nocookie.com/embed/$youtubeId?playsinline=1"
                    title="YouTube" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe></body></html>
                """.trimIndent(), "text/html", "UTF-8", null)
            }
        },
        modifier = modifier.fillMaxWidth().aspectRatio(16f / 9f),
        onRelease = { it.destroy() },
    )
}

/** Evento `video_open` con los valores de la web (`platform`, `video_kind`). */
internal fun logVideoOpen(app: CalendarioCiclismoApp, url: String, kind: String) {
    app.analytics.logEvent("video_open", Bundle().apply {
        putString("platform", StageVideoLogic.platformKey(url))
        putString("video_kind", kind)
    })
}

/**
 * Filas de vídeos en acordeón (docs/plans/videos-5-2.md, D10): una fila por
 * vídeo en el orden de `StageVideoLogic`; la abierta, en seminegrita y sin
 * rótulo de estado, muestra el reproductor bajo su fila; abrir otra pliega la
 * abierta. Los vídeos que no se insertan llevan «<plataforma> ↗». Espejo de
 * `videoRowsHtml` (js/stage/videos-html.js) y de `StageVideoList` (iOS).
 *
 * @param openFirst el primer vídeo insertable nace abierto (jornada, resultados).
 * @param stateKey identidad del acordeón: al cambiar, vuelve al estado inicial.
 */
@Composable
internal fun StageVideoList(
    entries: List<StageVideoLogic.Entry>,
    oneDay: Boolean,
    stateKey: String,
    onExternalLinkTap: (String) -> Unit,
    openFirst: Boolean = true,
) {
    val app = rememberApp()
    val firstEmbeddable = entries.firstOrNull { StageVideoLogic.embeddedYouTubeId(it) != null }?.id
    var openId by rememberSaveable(stateKey) { mutableStateOf(if (openFirst) firstEmbeddable else null) }
    val english = LocaleHolder.current.language == "en"
    Column(Modifier.fillMaxWidth()) {
        entries.forEachIndexed { index, entry ->
            if (index > 0) PanelDivider()
            val title = StageVideoLogic.title(entry, oneDay, english)
            val youtubeId = StageVideoLogic.embeddedYouTubeId(entry)
            if (youtubeId != null) {
                val isOpen = openId == entry.id
                val watchLabel = LocaleHolder.t("Ver", "Watch")
                Column(Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clickable(role = Role.Button) {
                                openId = if (isOpen) null else entry.id
                                if (!isOpen) logVideoOpen(app, entry.url, entry.kind)
                            }
                            .semantics(mergeDescendants = true) { selected = isOpen }
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        VideoLabels(title, entry.channel, isOpen, Modifier.weight(1f))
                        if (!isOpen) {
                            Text(
                                text = watchLabel,
                                style = CCText.S13,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.primary,
                                maxLines = 1,
                            )
                        }
                    }
                    AnimatedVisibility(visible = isOpen, enter = fadeIn(), exit = fadeOut()) {
                        YouTubeInlinePlayer(
                            youtubeId = youtubeId,
                            modifier = Modifier
                                .padding(start = 16.dp, end = 16.dp, bottom = 12.dp)
                                .clip(RoundedCornerShape(6.dp)),
                        )
                    }
                }
            } else {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .padding(start = 16.dp, end = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    VideoLabels(title, entry.channel, false, Modifier.weight(1f))
                    PanelTextAction(
                        label = "${StageVideoLogic.platformLabel(entry.url)} ↗︎",
                        onClick = {
                            logVideoOpen(app, entry.url, entry.kind)
                            onExternalLinkTap(entry.url)
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun VideoLabels(title: String, channel: String?, isOpen: Boolean, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(
            text = title,
            style = CCText.S14,
            fontWeight = if (isOpen) FontWeight.SemiBold else FontWeight.Normal,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (!channel.isNullOrEmpty()) {
            Text(
                text = channel,
                style = CCText.S13,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Panel «Vídeos» de la jornada terminada (docs/plans/videos-5-2.md, D9). */
@Composable
internal fun StageVideosPanel(
    entries: List<StageVideoLogic.Entry>,
    oneDay: Boolean,
    stateKey: String,
    onExternalLinkTap: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    StagePanel(modifier) {
        PanelHeader(title = LocaleHolder.t("Vídeos", "Videos"))
        StageVideoList(entries, oneDay, stateKey, onExternalLinkTap)
    }
}
