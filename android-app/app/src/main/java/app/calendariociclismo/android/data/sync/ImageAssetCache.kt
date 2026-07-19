package app.calendariociclismo.android.data.sync

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Caché en disco para logos de carrera (R2). Port del tratamiento equivalente
 * en `CacheManager.swift` iOS.
 *
 * Estrategia:
 *   - Ficheros bajo `filesDir/OfflineImages/`.
 *   - Logos con nombre `logo_<sha1Prefix(url)>.<ext>`: si la URL cambia, el
 *     hash cambia y el fichero viejo se purga automáticamente al final del sync.
 *   - Fallo silencioso en todas las operaciones: la caché es best-effort.
 *
 * Las banderas van en `assets/flags/` (bundled) — no se gestionan aquí.
 *
 * El singleton [instance] permite que los componentes Compose consulten la
 * existencia de ficheros locales síncronamente durante el render.
 */
class ImageAssetCache(
    private val appContext: Context,
    private val httpClient: OkHttpClient = defaultClient(),
) {
    private val tag = "ImageAssetCache"
    private val rootDir: File = File(appContext.filesDir, DIR_NAME).apply {
        if (!exists()) mkdirs()
    }

    init {
        synchronized(Companion) {
            sharedInstance = this
        }
    }

    // ─── API pública ─────────────────────────────────────────────

    /** Fichero local del logo si existe para [remoteUrl], `null` en caso contrario. */
    fun localLogoFile(remoteUrl: String): File? {
        val name = logoFilename(remoteUrl) ?: return null
        val f = File(rootDir, name)
        return if (f.exists()) f else null
    }

    /**
     * URI `file:///android_asset/bundled_logos/<filename>` si el logo está
     * empaquetado en assets. Devuelve `null` si no existe.
     * Coil acepta esta URI directamente con el SvgDecoder ya registrado.
     */
    fun bundledLogoAssetUri(remoteUrl: String): String? {
        val name = logoFilename(remoteUrl) ?: return null
        return try {
            appContext.assets.open("bundled_logos/$name").close()
            "file:///android_asset/bundled_logos/$name"
        } catch (_: Throwable) {
            null
        }
    }

    /** Descarga el logo desde [remoteUrl] si no existe localmente. */
    suspend fun downloadLogo(remoteUrl: String): File? = withContext(Dispatchers.IO) {
        val name = logoFilename(remoteUrl) ?: return@withContext null
        val dest = File(rootDir, name)
        if (dest.exists()) return@withContext dest

        downloadTo(dest, remoteUrl, "logo $remoteUrl")
    }

    /** Descarga un conjunto de logos con concurrencia limitada. */
    suspend fun downloadLogos(urls: Set<String>, maxConcurrent: Int = 4) {
        val list = urls.filter { it.isNotEmpty() }
        if (list.isEmpty()) return
        val semaphore = Semaphore(maxConcurrent)
        coroutineScope {
            list.forEach { url ->
                launch { semaphore.withPermit { downloadLogo(url) } }
            }
        }
    }

    /**
     * Elimina ficheros de logos cuyo hash NO esté en el set retenido.
     * Se usa al final del sync.
     */
    fun purge(keepingLogoUrls: Set<String>) {
        val logoKeep: Set<String> = keepingLogoUrls.mapNotNull { logoFilename(it) }.toHashSet()
        val files = rootDir.listFiles() ?: return
        for (f in files) {
            if (f.name.startsWith("logo_") && f.name !in logoKeep) {
                runCatching { f.delete() }
            }
        }
    }

    /** Elimina TODAS las imágenes cacheadas. */
    fun clear() {
        val files = rootDir.listFiles() ?: return
        for (f in files) runCatching { f.delete() }
    }

    /** Tamaño total en bytes de los ficheros cacheados. */
    fun totalSize(): Long {
        val files = rootDir.listFiles() ?: return 0
        var total = 0L
        for (f in files) if (f.isFile) total += f.length()
        return total
    }

    // ─── Interno ─────────────────────────────────────────────────

    private fun downloadTo(dest: File, remote: String, label: String): File? {
        val tmp = File(rootDir, "${dest.name}.tmp")
        return try {
            val request = Request.Builder().url(remote).build()
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(tag, "HTTP ${response.code} descargando $label")
                    return null
                }
                val body = response.body ?: return null
                tmp.outputStream().use { out ->
                    body.byteStream().use { input -> input.copyTo(out) }
                }
            }
            if (dest.exists()) dest.delete()
            if (!tmp.renameTo(dest)) {
                tmp.copyTo(dest, overwrite = true)
                tmp.delete()
            }
            dest
        } catch (t: Throwable) {
            Log.w(tag, "Error descargando $label: ${t.message}")
            runCatching { tmp.delete() }
            null
        }
    }

    /** `logo_<sha1Prefix>.<ext>` — null si [remoteUrl] está mal formada. */
    private fun logoFilename(remoteUrl: String): String? {
        if (remoteUrl.isEmpty()) return null
        val hash = sha1Prefix(remoteUrl)
        val ext = try {
            val path = URI.create(remoteUrl).path ?: ""
            val dot = path.lastIndexOf('.')
            if (dot > 0 && dot < path.length - 1) {
                path.substring(dot + 1).lowercase().take(5)
            } else "img"
        } catch (_: Throwable) {
            "img"
        }
        return "logo_$hash.$ext"
    }

    private fun sha1Prefix(input: String): String {
        val digest = MessageDigest.getInstance("SHA-1").digest(input.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder()
        for (b in digest) sb.append(String.format("%02x", b))
        return sb.substring(0, 20) // 80 bits
    }

    companion object {
        private const val DIR_NAME = "OfflineImages"

        @Volatile
        private var sharedInstance: ImageAssetCache? = null

        /**
         * Instancia compartida para lectura síncrona desde componentes Compose.
         * El `CalendarioCiclismoApp` crea la primera instancia al arranque, por
         * lo que siempre estará disponible cuando la UI empiece a renderizar.
         */
        fun instance(): ImageAssetCache? = sharedInstance

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
