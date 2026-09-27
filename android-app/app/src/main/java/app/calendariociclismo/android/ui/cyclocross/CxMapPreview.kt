package app.calendariociclismo.android.ui.cyclocross

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.stage.SectionCard
import app.calendariociclismo.android.ui.stage.SectionTitle
import app.calendariociclismo.android.util.LocaleHolder
import coil3.compose.AsyncImage

// maxHeight: la columna lateral de resultados muestra el mapa en pequeño,
// como la web.
@Composable
fun CxMapPreview(url: String, maxHeight: Dp = 480.dp) {
    var expanded by remember(url) { mutableStateOf(false) }
    var attempt by remember(url) { mutableIntStateOf(0) }
    var failed by remember(url, attempt) { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    val label = stringResource(R.string.asset_map)

    @Composable
    fun MapImage(modifier: Modifier) {
        key(url, attempt) {
            AsyncImage(model = url, contentDescription = label, contentScale = ContentScale.Fit,
                modifier = modifier, onError = { failed = true })
        }
    }

    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Mismo titular que Horarios y el resto de secciones de la jornada.
            SectionTitle(label)
            if (failed) {
                Text(LocaleHolder.t("No se ha podido cargar el mapa.", "The map could not be loaded."),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { attempt++ }) { Text(stringResource(R.string.cx_retry)) }
                    OutlinedButton(onClick = { uri.openUri(url) }) { Text(LocaleHolder.t("Abrir mapa", "Open map")) }
                }
            } else {
                MapImage(Modifier.fillMaxWidth().heightIn(min = minOf(220.dp, maxHeight), max = maxHeight).background(Color.White)
                    .clickable(role = Role.Button, onClickLabel = LocaleHolder.t("Ampliar mapa", "Expand map")) { expanded = true })
            }
        }
    }
    if (expanded) {
        var scale by remember(url) { mutableFloatStateOf(1f) }
        var offset by remember(url) { mutableStateOf(Offset.Zero) }
        Dialog(onDismissRequest = { expanded = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { uri.openUri(url) }) { Text(LocaleHolder.t("Abrir mapa", "Open map")) }
                    TextButton(onClick = { expanded = false }) { Text(stringResource(R.string.action_close)) }
                }
                Box(Modifier.weight(1f).fillMaxWidth().background(Color.White)
                    .pointerInput(url) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 8f)
                            offset = if (scale == 1f) Offset.Zero else offset + pan
                        }
                    }, contentAlignment = Alignment.Center) {
                    MapImage(Modifier.fillMaxSize().graphicsLayer {
                        scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y
                    })
                }
            }
        }
    }
}
