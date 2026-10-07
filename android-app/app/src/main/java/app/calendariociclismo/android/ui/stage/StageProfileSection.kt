package app.calendariociclismo.android.ui.stage

import app.calendariociclismo.android.ui.components.ccSegmentedColors
import app.calendariociclismo.android.ui.theme.CCRadius
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Asset
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.LocaleHolder
import coil3.compose.AsyncImage
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private sealed interface PdfPreviewState {
    data object Loading : PdfPreviewState
    data class Ready(val bitmap: Bitmap) : PdfPreviewState
    data object Error : PdfPreviewState
}

/**
 * Panel de perfil de la jornada. Reproduce el contrato de la web
 * (`js/stage/profile.js`): cabecera con el título, la lectura del perfil en
 * una línea de altura fija y el selector «Interactivo/Oficial» cuando
 * coexisten ambos formatos; debajo, el gráfico. El oficial (imagen o PDF) se
 * encaja en el mismo hueco que el interactivo, así que el panel no cambia de
 * tamaño al alternar. El estado de selección se comparte con Puntos clave.
 */
@Composable
internal fun StageProfileSection(
    raceDay: RaceDay,
    race: Race?,
    officialProfile: Asset?,
    onOfficialProfileTap: (Asset) -> Unit,
    selection: ProfileSelection,
    modifier: Modifier = Modifier,
) {
    val profile = raceDay.elevationProfile?.takeIf { raceDay.hasElevationProfile && it.points.size >= 2 }
    val visibleOfficial = officialProfile?.takeUnless { raceDay.profileNotViewable }
    if (profile == null && visibleOfficial == null) return
    val bothFormats = profile != null && visibleOfficial != null
    val showOfficial = when {
        bothFormats -> selection.official
        profile != null -> false
        else -> true
    }

    StagePanel(modifier) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            // Móvil: la lectura ocupa su propia línea reservada bajo el título.
            val narrow = maxWidth < ProfileReadoutInlineMinWidth
            val graphicHeight = profileGraphicHeight(maxWidth)
            Column(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = PanelHeaderMinHeight)
                        .padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PanelTitle(stringResource(R.string.stage_profile_title))
                        if (profile != null && !narrow) {
                            ProfileReadout(
                                profile = profile,
                                selection = selection,
                                visible = !showOfficial,
                                modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                            )
                        } else {
                            Spacer(Modifier.weight(1f))
                        }
                        if (bothFormats) {
                            // Control segmentado nativo, como el Picker de iOS.
                            val modes = listOf(
                                false to stringResource(R.string.stage_profile_mode_interactive),
                                true to stringResource(R.string.stage_profile_mode_official),
                            )
                            SingleChoiceSegmentedButtonRow(
                                modifier = Modifier.semantics {
                                    contentDescription = LocaleHolder.t("Tipo de perfil", "Profile format")
                                },
                            ) {
                                modes.forEachIndexed { index, (official, label) ->
                                    SegmentedButton(
                                        colors = ccSegmentedColors(),
                                        selected = showOfficial == official,
                                        onClick = { selection.official = official },
                                        shape = SegmentedButtonDefaults.itemShape(
                                            index = index,
                                            count = modes.size,
                                            baseShape = RoundedCornerShape(CCRadius.Control),
                                        ),
                                        icon = {},
                                    ) {
                                        Text(label, style = CCText.S13, maxLines = 1)
                                    }
                                }
                            }
                        }
                    }
                    if (profile != null && narrow) {
                        ProfileReadout(
                            profile = profile,
                            selection = selection,
                            visible = !showOfficial,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
                            alignEnd = false,
                        )
                    }
                }
                PanelDivider()
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(graphicHeight),
                ) {
                    if (!showOfficial && profile != null) {
                        ElevationChart(
                            profile = profile,
                            summits = raceDay.profileSummits.orEmpty(),
                            waypoints = raceDay.profileWaypoints.orEmpty(),
                            race = race,
                            selection = selection,
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else if (visibleOfficial != null) {
                        OfficialProfilePreview(
                            asset = visibleOfficial,
                            onOpen = { onOfficialProfileTap(visibleOfficial) },
                        )
                    }
                }
            }
        }
    }
}

/** Ancho mínimo del panel para llevar la lectura en la fila del título (600 px en la web). */
private val ProfileReadoutInlineMinWidth = 600.dp

/** Alto común de los dos formatos: 40 % del ancho entre 264 y 400 (`graphicHeight` de la web). */
internal fun profileGraphicHeight(width: Dp): Dp = (width * 0.4f).coerceIn(264.dp, 400.dp)

@Composable
private fun OfficialProfilePreview(
    asset: Asset,
    onOpen: () -> Unit,
) {
    val app = rememberApp()
    val context = LocalContext.current
    val isPdf = asset.fileExtension.equals("pdf", ignoreCase = true)

    if (isPdf) {
        val state by produceState<PdfPreviewState>(PdfPreviewState.Loading, asset.id, asset.url) {
            value = withContext(Dispatchers.IO) {
                runCatching {
                    val local = app.offlineManager.assetCache().localFile(asset)
                    val source = local ?: downloadProfileToCache(context.cacheDir, asset)
                    try {
                        renderPdfPreview(source)
                    } finally {
                        if (local == null) source.delete()
                    }
                }.fold(
                    onSuccess = { PdfPreviewState.Ready(it) },
                    onFailure = { PdfPreviewState.Error },
                )
            }
        }
        when (val current = state) {
            PdfPreviewState.Loading -> ProfileLoading()
            is PdfPreviewState.Ready -> Image(
                bitmap = current.bitmap.asImageBitmap(),
                contentDescription = stringResource(R.string.stage_profile_official_cd),
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .background(androidx.compose.ui.graphics.Color.White)
                    .clickable(role = Role.Button, onClick = onOpen)
                    .padding(4.dp),
            )
            PdfPreviewState.Error -> ProfileLoadError(onOpen)
        }
        return
    }

    val model by produceState<Any?>(null, asset.id, asset.url) {
        value = withContext(Dispatchers.IO) {
            app.offlineManager.assetCache().localFile(asset) ?: asset.url
        }
    }
    var failed by remember(asset.id) { mutableStateOf(false) }
    if (model == null) {
        ProfileLoading()
    } else if (failed) {
        ProfileLoadError(onOpen)
    } else {
        AsyncImage(
            model = model,
            contentDescription = stringResource(R.string.stage_profile_official_cd),
            contentScale = ContentScale.Fit,
            onError = { failed = true },
            modifier = Modifier
                .fillMaxSize()
                .background(androidx.compose.ui.graphics.Color.White)
                .clickable(role = Role.Button, onClick = onOpen)
                .padding(4.dp),
        )
    }
}

@Composable
private fun ProfileLoading() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun ProfileLoadError(onOpen: () -> Unit) {
    val errorLabel = stringResource(R.string.stage_profile_load_error)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp)
            .semantics {
                contentDescription = errorLabel
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
    ) {
        Text(
            text = errorLabel,
            style = CCText.S14,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        PanelTextAction(label = stringResource(R.string.stage_profile_open), onClick = onOpen)
    }
}

private fun downloadProfileToCache(cacheDir: File, asset: Asset): File {
    val remoteUrl = asset.url ?: error("Missing profile URL")
    val target = File.createTempFile("cc-profile-", ".pdf", cacheDir)
    val connection = URL(remoteUrl).openConnection() as HttpURLConnection
    connection.connectTimeout = 15_000
    connection.readTimeout = 20_000
    connection.instanceFollowRedirects = true
    try {
        connection.inputStream.use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        }
    } catch (error: Throwable) {
        target.delete()
        throw error
    } finally {
        connection.disconnect()
    }
    return target
}

private fun renderPdfPreview(source: File): Bitmap {
    ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        PdfRenderer(descriptor).use { renderer ->
            require(renderer.pageCount > 0)
            renderer.openPage(0).use { page ->
                val targetWidth = minOf(1600, page.width.coerceAtLeast(1))
                val scale = targetWidth.toFloat() / page.width.coerceAtLeast(1)
                val targetHeight = (page.height * scale).toInt().coerceAtLeast(1)
                return Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888).also { bitmap ->
                    bitmap.eraseColor(AndroidColor.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        }
    }
}
