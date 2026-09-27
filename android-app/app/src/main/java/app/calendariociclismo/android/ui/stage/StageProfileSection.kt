package app.calendariociclismo.android.ui.stage

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Asset
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.rememberApp
import coil3.compose.AsyncImage
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private enum class StageProfileMode { INTERACTIVE, OFFICIAL }

private sealed interface PdfPreviewState {
    data object Loading : PdfPreviewState
    data class Ready(val bitmap: Bitmap) : PdfPreviewState
    data object Error : PdfPreviewState
}

/**
 * Visor integrado de perfil para Jornada. Reproduce el contrato de la web:
 * muestra el perfil interactivo, el oficial o un selector entre ambos cuando
 * coexisten. El toque sobre el oficial conserva la apertura completa y offline
 * que ya ofrece la barra documental.
 */
@Composable
internal fun StageProfileSection(
    raceDay: RaceDay,
    race: Race?,
    officialProfile: Asset?,
    onOfficialProfileTap: (Asset) -> Unit,
) {
    val interactiveAvailable = raceDay.hasElevationProfile
    val visibleOfficial = officialProfile?.takeUnless { raceDay.profileNotViewable }
    if (!interactiveAvailable && visibleOfficial == null) return

    var preferredMode by rememberSaveable(raceDay.id) {
        mutableStateOf(
            if (interactiveAvailable) StageProfileMode.INTERACTIVE
            else StageProfileMode.OFFICIAL,
        )
    }
    val mode = when {
        interactiveAvailable && visibleOfficial != null -> preferredMode
        interactiveAvailable -> StageProfileMode.INTERACTIVE
        else -> StageProfileMode.OFFICIAL
    }

    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle(stringResource(R.string.stage_profile_title))
            if (interactiveAvailable && visibleOfficial != null) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    StageActionButton(
                        label = stringResource(R.string.stage_profile_mode_interactive),
                        onClick = { preferredMode = StageProfileMode.INTERACTIVE },
                        modifier = Modifier.weight(1f),
                        selected = mode == StageProfileMode.INTERACTIVE,
                    )
                    StageActionButton(
                        label = stringResource(R.string.stage_profile_mode_official),
                        onClick = { preferredMode = StageProfileMode.OFFICIAL },
                        modifier = Modifier.weight(1f),
                        selected = mode == StageProfileMode.OFFICIAL,
                    )
                }
            }

            when (mode) {
                StageProfileMode.INTERACTIVE -> {
                    raceDay.elevationProfile?.let { profile ->
                        ElevationChart(
                            profile = profile,
                            summits = raceDay.profileSummits.orEmpty(),
                            waypoints = raceDay.profileWaypoints.orEmpty(),
                            race = race,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(264.dp),
                        )
                    }
                }
                StageProfileMode.OFFICIAL -> visibleOfficial?.let { asset ->
                    OfficialProfilePreview(
                        asset = asset,
                        onOpen = { onOfficialProfileTap(asset) },
                    )
                }
            }
        }
    }
}

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
                    .fillMaxWidth()
                    .heightIn(min = 180.dp, max = 420.dp)
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
                .fillMaxWidth()
                .heightIn(min = 180.dp, max = 420.dp)
                .background(androidx.compose.ui.graphics.Color.White)
                .clickable(role = Role.Button, onClick = onOpen)
                .padding(4.dp),
        )
    }
}

@Composable
private fun ProfileLoading() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(220.dp),
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
            .fillMaxWidth()
            .padding(24.dp)
            .semantics {
                contentDescription = errorLabel
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = errorLabel,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = onOpen) {
            Text(stringResource(R.string.stage_profile_open))
        }
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
