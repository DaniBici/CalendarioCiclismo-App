package app.calendariociclismo.android.data.model

import android.net.Uri
import app.calendariociclismo.android.util.Constants
import kotlinx.serialization.Serializable

/**
 * Asset documental de una etapa: perfil, mapa, roadbook, etc. (tabla `assets`).
 */
@Serializable
data class Asset(
    val id: String,
    val raceDayId: String,
    val type: String? = null,        // technicalGuide, startOrder, roadbook, profile, ports, map, live_text
    val sourceType: String? = null,  // external
    val url: String? = null,
) {
    /** Etiqueta localizada del tipo de asset (resuelve el `R.string.asset_*`). */
    fun typeLabel(context: android.content.Context): String =
        Constants.assetLabel(context, type)

    // ─── Caché offline (R2) ─────────────────────────────────────────

    /**
     * `true` si la URL apunta a nuestro CDN R2 y por tanto es segura de
     * descargar para uso offline. URLs externas (live_text, TV oficial, etc.)
     * se excluyen.
     */
    val isDownloadableR2: Boolean
        get() {
            val u = url?.takeIf { it.isNotEmpty() } ?: return false
            val host = runCatching { Uri.parse(u).host }.getOrNull() ?: return false
            return host.equals(R2_HOST, ignoreCase = true) && type != "technicalGuide"
        }

    /**
     * Extensión del fichero (pdf, png, jpg…). Por defecto `pdf` si la URL no
     * tiene extensión reconocible.
     */
    val fileExtension: String
        get() {
            val path = runCatching { Uri.parse(url ?: return@runCatching null).lastPathSegment }
                .getOrNull() ?: return "pdf"
            val dot = path.lastIndexOf('.')
            if (dot < 0 || dot == path.lastIndex) return "pdf"
            return path.substring(dot + 1).lowercase()
        }

    companion object {
        /**
         * Host del CDN propio (Cloudflare R2) donde viven los assets generados
         * por el panel admin. Las URLs externas (TV oficial, etc.) no se descargan.
         */
        const val R2_HOST = "assets.calendariociclismo.app"
    }
}
