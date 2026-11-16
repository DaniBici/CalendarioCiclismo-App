package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RegionDetector
import app.calendariociclismo.android.util.StageVideoLogic

/**
 * Destinos de vídeo de una jornada terminada con clasificaciones propias
 * (docs/plans/videos-5-2.md, fase 7): `hasVideos` (vídeos propios distintos de
 * la emisión íntegra; abren la jornada en su panel Vídeos) y `reviveUrl` (la
 * emisión íntegra). Espejo de `cardVideoActions` (js/services/stage-videos.js).
 */
data class FinishedVideoTargets(val hasVideos: Boolean, val reviveUrl: String?) {
    companion object {
        fun of(day: EnrichedRaceDay, hasResults: Boolean): FinishedVideoTargets {
            if (!hasResults) return FinishedVideoTargets(false, null)
            val videos = StageVideoLogic.filterByRegion(day.videos, RegionDetector.allowedBroadcastGroups())
            val (hasVideos, revive) = StageVideoLogic.cardActions(day.broadcasts, videos)
            return FinishedVideoTargets(hasVideos, revive?.url?.takeIf { it.isNotEmpty() })
        }
    }
}

/**
 * Acción de vídeo de la tarjeta terminada: con vídeos y emisión íntegra, el
 * botón de TV abre un menú «Vídeos» / «Completa» («Videos» / «Broadcast»); con
 * uno de los dos, su botón. Glifo de TV, como la web (`finishedVideoActionHtml`).
 */
@Composable
fun FinishedVideoAction(
    onShowVideos: (() -> Unit)?,
    onRevive: (() -> Unit)?,
    glyph: Dp,
    modifier: Modifier = Modifier,
    buttonSize: Dp? = null,
) {
    val buttonModifier = if (buttonSize != null) Modifier.size(buttonSize) else Modifier
    @Composable
    fun TvGlyph(description: String) {
        Icon(
            imageVector = Icons.Outlined.Tv,
            contentDescription = description,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(glyph),
        )
    }
    when {
        onShowVideos != null && onRevive != null -> {
            var expanded by remember { mutableStateOf(false) }
            Box(modifier) {
                IconButton(onClick = { expanded = true }, modifier = buttonModifier) {
                    TvGlyph(LocaleHolder.t("Vídeos o emisión completa", "Videos or full broadcast"))
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    DropdownMenuItem(
                        text = { Text(LocaleHolder.t("Vídeos", "Videos"), style = CCText.S14) },
                        onClick = { expanded = false; onShowVideos() },
                    )
                    DropdownMenuItem(
                        text = { Text(LocaleHolder.t("Completa", "Broadcast"), style = CCText.S14) },
                        onClick = { expanded = false; onRevive() },
                    )
                }
            }
        }
        onShowVideos != null -> IconButton(onClick = onShowVideos, modifier = modifier.then(buttonModifier)) {
            TvGlyph(LocaleHolder.t("Vídeos", "Videos"))
        }
        onRevive != null -> IconButton(onClick = onRevive, modifier = modifier.then(buttonModifier)) {
            TvGlyph(stringResource(R.string.today_revive_cd))
        }
    }
}
