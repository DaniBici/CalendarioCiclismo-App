package app.calendariociclismo.android.notifications

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import app.calendariociclismo.android.data.prefs.AppPreferences
import app.calendariociclismo.android.data.prefs.NotificationCategoryPreference
import app.calendariociclismo.android.data.prefs.RaceFollowMode
import app.calendariociclismo.android.data.prefs.RaceGroupFilter
import app.calendariociclismo.android.data.remote.SupabaseService
import app.calendariociclismo.android.util.RegionDetector
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.tasks.await

/**
 * Port de `NotificationManager.swift`.
 *
 * Responsabilidades:
 *  - Obtener el token FCM actual.
 *  - Subirlo a Supabase (`push_subscriptions`) con `platform = "android"`.
 *  - Manejar suscripción / baja / borrado total.
 *
 * La solicitud del permiso `POST_NOTIFICATIONS` (Android 13+) se hace en la UI
 * con `rememberLauncherForActivityResult` — aquí solo gestionamos el token.
 */
class PushNotificationManager(
    private val context: Context,
    private val prefs: AppPreferences,
    private val api: SupabaseService,
) {
    private val TAG = "PushNotificationMgr"

    /** Solicita el token FCM al SDK y lo registra en Supabase. */
    suspend fun refreshToken(): String? {
        return runCatching {
            val token = FirebaseMessaging.getInstance().token.await()
            Log.i(TAG, "Token FCM obtenido: ${token.take(12)}…")
            prefs.setPushToken(token)
            api.upsertPushToken(
                token,
                isActive = true,
                region = currentRegion(),
                countryGroup = currentCountryGroup(),
                language = currentLanguage(),
                categories = currentCategories(),
                followedRaces = currentFollowedRaces(),
                raceFilters = currentRaceFilters(),
                followedStages = currentFollowedStages(),
                followedCxRaces = prefs.snapshotFollowedCxRaceIds().toList(),
            )
            token
        }.onFailure {
            Log.w(TAG, "No se pudo obtener/registrar token FCM: ${it.message}")
        }.getOrNull()
    }

    /** Activa la suscripción (después de que el permiso haya sido concedido). */
    suspend fun subscribe(): Boolean {
        prefs.setPushEnabled(true)
        val token = refreshToken() ?: return false
        runCatching {
            api.upsertPushToken(
                token,
                isActive = true,
                region = currentRegion(),
                countryGroup = currentCountryGroup(),
                language = currentLanguage(),
                categories = currentCategories(),
                followedRaces = currentFollowedRaces(),
                raceFilters = currentRaceFilters(),
                followedStages = currentFollowedStages(),
                followedCxRaces = prefs.snapshotFollowedCxRaceIds().toList(),
            )
        }.onFailure { Log.w(TAG, "Subscribe falló: ${it.message}") }
        return true
    }

    /** Marca el token como inactivo en el servidor. */
    suspend fun unsubscribe() {
        prefs.setPushEnabled(false)
        val token = currentToken() ?: return
        runCatching {
            api.upsertPushToken(
                token,
                isActive = false,
                region = currentRegion(),
                countryGroup = currentCountryGroup(),
                language = currentLanguage(),
                categories = currentCategories(),
                followedRaces = currentFollowedRaces(),
                raceFilters = currentRaceFilters(),
                followedStages = currentFollowedStages(),
                followedCxRaces = prefs.snapshotFollowedCxRaceIds().toList(),
            )
        }.onFailure { Log.w(TAG, "Unsubscribe falló: ${it.message}") }
    }

    /**
     * Re-envía el token con las categorías y preferencias de seguimiento actuales.
     * Lo llama la pantalla de Ajustes cuando el usuario cambia cualquier toggle.
     */
    suspend fun syncCategories() {
        val token = currentToken() ?: return
        runCatching {
            api.upsertPushToken(
                token,
                isActive = true,
                region = currentRegion(),
                countryGroup = currentCountryGroup(),
                language = currentLanguage(),
                categories = currentCategories(),
                followedRaces = currentFollowedRaces(),
                raceFilters = currentRaceFilters(),
                followedStages = currentFollowedStages(),
                followedCxRaces = prefs.snapshotFollowedCxRaceIds().toList(),
            )
        }.onFailure { Log.w(TAG, "syncCategories falló: ${it.message}") }
    }

    private suspend fun currentRegion(): String =
        RegionDetector.suggestedRegion().name

    /** Grupo fino `broadcasts.country` detectado por TZ. */
    private suspend fun currentCountryGroup(): String? =
        RegionDetector.detectedCountryGroup()

    private suspend fun currentLanguage(): String =
        prefs.snapshotAppLocale().tag

    private suspend fun currentCategories(): List<String> =
        NotificationCategoryPreference.toRawList(prefs.snapshotNotificationCategories())

    private suspend fun currentFollowedRaces(): List<String> {
        val mode = prefs.snapshotRaceFollowMode()
        return if (mode == RaceFollowMode.FOLLOW_RACES) prefs.snapshotFollowedRaceIds().toList()
        else emptyList()
    }

    private suspend fun currentRaceFilters(): List<String> {
        val mode = prefs.snapshotRaceFollowMode()
        return if (mode == RaceFollowMode.FOLLOW_FILTERS) RaceGroupFilter.toRawList(prefs.snapshotActiveRaceFilters())
        else emptyList()
    }

    private suspend fun currentFollowedStages(): List<String> =
        prefs.snapshotFollowedStageIds().toList()

    /**
     * Comprueba si el permiso de notificaciones sigue activo a nivel de SO.
     * Si el usuario lo revocó en Ajustes mientras la app estaba en segundo
     * plano, sincroniza la baja con el servidor para no acumular tokens activos
     * que nunca recibirán entregas. Debe llamarse al volver al primer plano.
     */
    suspend fun syncPermissionState(context: Context) {
        val pushEnabled = prefs.pushEnabled.firstOrNull() ?: return
        if (!pushEnabled) return
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            Log.i(TAG, "Permiso revocado en SO — sincronizando baja con el servidor")
            unsubscribe()
        }
    }

    /**
     * Borra permanentemente el registro del dispositivo (derecho de supresión).
     * Devuelve `true` si todo fue bien.
     */
    suspend fun deleteAllData(): Boolean {
        val token = currentToken()
        val remoteOk = if (token != null) {
            runCatching { api.deletePushToken(token) }.isSuccess
        } else true
        runCatching { FirebaseMessaging.getInstance().deleteToken().await() }
        prefs.setPushEnabled(false)
        prefs.setPushToken(null)
        return remoteOk
    }

    private suspend fun currentToken(): String? {
        val stored = prefs.pushToken.firstOrNull()
        if (stored != null) return stored
        return runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
    }
}
