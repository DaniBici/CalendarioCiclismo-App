package app.calendariociclismo.android.data.map

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cache
import okhttp3.CacheControl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Descarga del GPX del mapa interactivo con tiempos máximos y caché HTTP en
 * disco. Storage responde con `no-cache` y ETag: la caché revalida con una
 * petición condicional (304 sin cuerpo) y, sin red, sirve la última copia.
 */
object RouteGpxLoader {
    private const val CACHE_DIR = "route-gpx"
    private const val CACHE_BYTES = 20L * 1024 * 1024

    @Volatile
    private var client: OkHttpClient? = null

    private fun client(context: Context): OkHttpClient =
        client ?: synchronized(this) {
            client ?: OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .callTimeout(60, TimeUnit.SECONDS)
                .cache(Cache(File(context.applicationContext.cacheDir, CACHE_DIR), CACHE_BYTES))
                .build()
                .also { client = it }
        }

    /** Texto del GPX en [url]; lanza [IOException] si no hay red ni copia en caché. */
    suspend fun load(context: Context, url: String): String = withContext(Dispatchers.IO) {
        val http = client(context)
        try {
            fetch(http, Request.Builder().url(url).build())
        } catch (network: IOException) {
            // Sin red: última copia guardada, aunque no se pueda revalidar.
            val cached = Request.Builder().url(url).cacheControl(CacheControl.FORCE_CACHE).build()
            runCatching { fetch(http, cached) }.getOrElse { throw network }
        }
    }

    private fun fetch(http: OkHttpClient, request: Request): String =
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
            response.body?.string() ?: throw IOException("Respuesta vacía")
        }
}
