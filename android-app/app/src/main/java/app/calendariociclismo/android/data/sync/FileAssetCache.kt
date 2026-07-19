package app.calendariociclismo.android.data.sync

import android.content.Context
import android.util.Log
import app.calendariociclismo.android.data.model.Asset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Caché en disco para los ficheros descargables de assets R2 (PDFs, mapas,
 * perfiles, rutómetros…). Port del tratamiento que hace `CacheManager.swift`
 * en iOS.
 *
 * Estrategia:
 *   - Ficheros bajo `filesDir/OfflineAssets/<id>.<ext>`.
 *   - Sidecar `<id>.url` con la URL remota descargada — si el admin re-sube el
 *     documento con URL nueva, el sidecar deja de coincidir y se redescarga.
 *   - Fallo silencioso en todas las operaciones: la caché es best-effort.
 *   - No descarga URLs externas. Solo las que pertenecen al CDN propio
 *     (filtradas vía [Asset.isDownloadableR2]).
 */
class FileAssetCache(
    appContext: Context,
    private val httpClient: OkHttpClient = defaultClient(),
) {
    private val tag = "FileAssetCache"
    private val rootDir: File = File(appContext.filesDir, DIR_NAME).apply {
        if (!exists()) mkdirs()
    }

    // ─── API pública ─────────────────────────────────────────────

    /**
     * Devuelve el fichero local del asset si existe Y la sidecar URL coincide
     * con la URL remota actual. `null` en cualquier otro caso.
     */
    fun localFile(asset: Asset): File? {
        val remote = asset.url?.takeIf { it.isNotEmpty() } ?: return null
        val file = fileFor(asset)
        if (!file.exists()) return null
        val sidecar = sidecarFor(asset.id)
        val saved = runCatching { sidecar.readText() }.getOrNull() ?: return null
        return if (saved == remote) file else null
    }

    /**
     * Descarga el asset si no está cacheado o si la URL cambió. Devuelve el
     * fichero local resultante, o `null` si no se puede descargar.
     */
    suspend fun download(asset: Asset): File? = withContext(Dispatchers.IO) {
        if (!asset.isDownloadableR2) return@withContext null
        val remote = asset.url?.takeIf { it.isNotEmpty() } ?: return@withContext null

        localFile(asset)?.let { return@withContext it }

        val dest = fileFor(asset)
        val sidecar = sidecarFor(asset.id)
        val tmp = File(rootDir, "${asset.id}.${asset.fileExtension}.tmp")

        try {
            val request = Request.Builder().url(remote).build()
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(tag, "HTTP ${response.code} descargando ${asset.id}")
                    return@withContext null
                }
                val body = response.body ?: return@withContext null
                tmp.outputStream().use { out ->
                    body.byteStream().use { input -> input.copyTo(out) }
                }
            }
            if (dest.exists()) dest.delete()
            if (!tmp.renameTo(dest)) {
                // renameTo puede fallar cross-device; copiar como fallback.
                tmp.copyTo(dest, overwrite = true)
                tmp.delete()
            }
            sidecar.writeText(remote)
            return@withContext dest
        } catch (t: Throwable) {
            Log.w(tag, "Error descargando ${asset.id}: ${t.message}")
            runCatching { tmp.delete() }
            return@withContext null
        }
    }

    /**
     * Descarga una colección de assets con concurrencia limitada
     * ([maxConcurrent], por defecto 4). Los ya cacheados con la misma URL se
     * saltan automáticamente.
     */
    suspend fun downloadAll(assets: List<Asset>, maxConcurrent: Int = 4) {
        val downloadable = assets.filter { it.isDownloadableR2 }
        if (downloadable.isEmpty()) return
        val semaphore = Semaphore(maxConcurrent)
        coroutineScope {
            downloadable.forEach { asset ->
                launch {
                    semaphore.withPermit { download(asset) }
                }
            }
        }
    }

    /**
     * Elimina todos los ficheros de assets cuyo ID NO esté en [keeping].
     * Se llama al final del sync para purgar documentación de jornadas caídas
     * fuera de la ventana offline.
     */
    fun purge(keeping: Set<String>) {
        val files = rootDir.listFiles() ?: return
        for (f in files) {
            val name = f.name
            val dot = name.indexOf('.')
            if (dot < 0) continue
            val id = name.substring(0, dot)
            if (id !in keeping) {
                runCatching { f.delete() }
            }
        }
    }

    /** Elimina TODOS los ficheros cacheados de assets R2. */
    fun clear() {
        val files = rootDir.listFiles() ?: return
        for (f in files) runCatching { f.delete() }
    }

    /** Tamaño total en bytes de todos los ficheros cacheados. */
    fun totalSize(): Long {
        val files = rootDir.listFiles() ?: return 0
        var total = 0L
        for (f in files) if (f.isFile) total += f.length()
        return total
    }

    // ─── Interno ────────────────────────────────────────────────

    private fun fileFor(asset: Asset): File =
        File(rootDir, "${asset.id}.${asset.fileExtension}")

    private fun sidecarFor(assetId: String): File =
        File(rootDir, "$assetId.url")

    companion object {
        private const val DIR_NAME = "OfflineAssets"

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
