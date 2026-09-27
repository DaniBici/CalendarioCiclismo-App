package app.calendariociclismo.android.util

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * PDF de la lista de inscritos generado con el mismo código que la web.
 *
 * Carga `inscritos-pdf.html` en un WebView sin ventana; la página genera el PDF
 * con `js/inscritos-pdf.js` (fuente única del diseño, compartida con la web e
 * iOS) y lo devuelve en base64 por la interfaz `CCStartlistPdf`. El archivo se
 * guarda en `cacheDir/StartlistPdf/` y se abre con el visor del sistema a
 * través del FileProvider.
 */
object StartlistPdfExporter {
    private const val PAGE_URL = "https://calendariociclismo.app/inscritos-pdf.html"
    private const val TIMEOUT_MS = 45_000L
    private const val DIR = "StartlistPdf"

    class ExportException(message: String) : Exception(message)

    suspend fun export(context: Context, raceId: String, english: Boolean): File =
        withContext(Dispatchers.Main) {
            withTimeout(TIMEOUT_MS) { load(context.applicationContext, raceId, english) }
        }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private suspend fun load(context: Context, raceId: String, english: Boolean): File =
        suspendCancellableCoroutine { cont ->
            val webView = WebView(context)
            fun release() = webView.post { webView.stopLoading(); webView.destroy() }

            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
            webView.addJavascriptInterface(object {
                @JavascriptInterface
                fun onPdf(fileName: String, base64: String) {
                    val result = runCatching {
                        val dir = File(context.cacheDir, DIR).apply { mkdirs() }
                        val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "-")
                        File(dir, safeName).apply { writeBytes(Base64.decode(base64, Base64.DEFAULT)) }
                    }
                    release()
                    if (cont.isActive) {
                        result.onSuccess { cont.resume(it) }.onFailure { cont.resumeWithException(it) }
                    }
                }

                @JavascriptInterface
                fun onError(message: String) {
                    release()
                    if (cont.isActive) cont.resumeWithException(ExportException(message))
                }
            }, "CCStartlistPdf")
            webView.webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame && cont.isActive) {
                        release()
                        cont.resumeWithException(ExportException(error.description?.toString() ?: "network"))
                    }
                }
            }
            cont.invokeOnCancellation { release() }

            val url = Uri.parse(PAGE_URL).buildUpon()
                .appendQueryParameter("race", raceId)
                .appendQueryParameter("lang", if (english) "en" else "es")
                .build()
                .toString()
            webView.loadUrl(url)
        }

    /** Abre el PDF con el visor del sistema; si no hay ninguno, lo comparte. */
    fun open(context: Context, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/pdf")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(view)
        } catch (_: ActivityNotFoundException) {
            val send = Intent(Intent.ACTION_SEND)
                .setType("application/pdf")
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            context.startActivity(
                Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }
}
