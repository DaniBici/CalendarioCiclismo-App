package app.calendariociclismo.android.data.analytics

import android.content.Context
import android.os.Bundle
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.analytics.logEvent
import app.calendariociclismo.android.data.prefs.AppPreferences
import kotlinx.coroutines.flow.first

/**
 * Wrapper sobre Firebase Analytics que respeta el consentimiento del usuario.
 *
 * - Por defecto la recolección está **habilitada** (opt-out): Firebase arranca con
 *   `setAnalyticsCollectionEnabled(true)` aplicado desde [applyStoredConsent] en el
 *   primer arranque, y el usuario puede desactivarla desde Ajustes → Privacidad.
 * - La preferencia se almacena en [AppPreferences.analyticsEnabled] (default `true`).
 * - [logScreenView] y [logEvent] comprueban [collectionEnabled] en memoria antes de
 *   delegar a Firebase, añadiendo una capa de defensa adicional contra cualquier
 *   ventana de arranque donde el consentimiento aún no se haya aplicado.
 *
 * Uso desde Compose:
 * ```
 * val app = rememberApp()
 * app.analytics.logScreenView("today")
 * // Con parámetros personalizados:
 * val params = android.os.Bundle().apply {
 *   putString("race_id", "abc123")
 * }
 * app.analytics.logScreenView("race_detail", params)
 * ```
 */
class AnalyticsService(context: Context, private val preferences: AppPreferences) {

    private val firebase = FirebaseAnalytics.getInstance(context)

    /**
     * Cache en memoria del estado de consentimiento. Empieza en `true` (modelo
     * opt-out) y se actualiza en [applyStoredConsent] y [setEnabled].
     */
    @Volatile
    private var collectionEnabled: Boolean = true

    /** Aplica el estado de consentimiento almacenado en preferencias. */
    suspend fun applyStoredConsent() {
        val enabled = preferences.analyticsEnabled.first()
        collectionEnabled = enabled
        firebase.setAnalyticsCollectionEnabled(enabled)
    }

    /** Actualiza el consentimiento y persiste la preferencia. */
    suspend fun setEnabled(enabled: Boolean) {
        preferences.setAnalyticsEnabled(enabled)
        collectionEnabled = enabled
        firebase.setAnalyticsCollectionEnabled(enabled)
    }

    /** Registra la pantalla visible actual con parámetros opcionales. No-op si el usuario no ha dado consentimiento. */
    fun logScreenView(screenName: String, params: Bundle? = null) {
        if (!collectionEnabled) return
        val bundle = params ?: Bundle()
        bundle.putString(FirebaseAnalytics.Param.SCREEN_NAME, screenName)
        firebase.logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, bundle)
    }

    /** Registra un evento personalizado. No-op si el usuario no ha dado consentimiento. */
    fun logEvent(name: String, params: Bundle? = null) {
        if (!collectionEnabled) return
        firebase.logEvent(name, params)
    }
}
