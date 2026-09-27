package app.calendariociclismo.android.util

/**
 * Criterio de la petición de reseña integrada de Google Play (espejo de
 * `ReviewPromptPolicy` en iOS). Primera petición: 3 días desde la primera
 * pantalla de contenido, 15 pantallas y una acción de interés. Siguientes:
 * versión de la app distinta de la última petición, al menos
 * [REPEAT_INTERVAL_MS] desde ella y de nuevo 15 pantallas y una acción de
 * interés. Siempre desde Hoy. Google Play aplica además su propio cupo.
 */
object ReviewPromptPolicy {
    const val FIRST_DELAY_MS = 3L * 24 * 60 * 60 * 1000
    const val REPEAT_INTERVAL_MS = 28L * 24 * 60 * 60 * 1000
    const val MINIMUM_CONTENT_VIEWS = 15

    fun shouldRequest(
        now: Long,
        isToday: Boolean,
        firstContentViewAt: Long?,
        contentViews: Int,
        meaningfulAction: Boolean,
        lastRequestAt: Long?,
        lastRequestVersion: String?,
        currentVersion: String,
    ): Boolean {
        if (!isToday || contentViews < MINIMUM_CONTENT_VIEWS || !meaningfulAction) return false
        if (lastRequestAt != null) {
            return now - lastRequestAt >= REPEAT_INTERVAL_MS && lastRequestVersion != currentVersion
        }
        val first = firstContentViewAt ?: return false
        return now - first >= FIRST_DELAY_MS
    }
}
