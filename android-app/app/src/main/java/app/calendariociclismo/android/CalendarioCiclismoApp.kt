package app.calendariociclismo.android

import android.app.Application
import android.util.Log
import androidx.work.Configuration
import app.calendariociclismo.android.data.analytics.AnalyticsService
import app.calendariociclismo.android.data.local.AppDatabase
import app.calendariociclismo.android.data.prefs.AppPreferences
import app.calendariociclismo.android.data.prefs.RaceFollowMode
import app.calendariociclismo.android.data.premium.PremiumService
import app.calendariociclismo.android.data.remote.SupabaseService
import app.calendariociclismo.android.data.repository.CalendarRepository
import app.calendariociclismo.android.data.sync.ImageAssetCache
import app.calendariociclismo.android.data.sync.OfflineManager
import app.calendariociclismo.android.notifications.NotificationChannels
import app.calendariociclismo.android.notifications.PushNotificationManager
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.svg.SvgDecoder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * Application class. Actúa como contenedor DI manual: crea una instancia de
 * cada colaborador y la expone como propiedad para que los ViewModels /
 * actividades la obtengan con `applicationContext as CalendarioCiclismoApp`.
 *
 * También implementa `Configuration.Provider` para que WorkManager se
 * inicialice de forma perezosa (removimos el startup provider por defecto
 * en el manifest).
 */
class CalendarioCiclismoApp : Application(), Configuration.Provider, SingletonImageLoader.Factory {

    // ─── Scopes ───
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // ─── Dependencias ───
    lateinit var database: AppDatabase
        private set
    lateinit var supabaseService: SupabaseService
        private set
    lateinit var preferences: AppPreferences
        private set
    lateinit var repository: CalendarRepository
        private set
    lateinit var offlineManager: OfflineManager
        private set
    lateinit var imageAssetCache: ImageAssetCache
        private set
    lateinit var pushManager: PushNotificationManager
        private set
    lateinit var analytics: AnalyticsService
        private set
    lateinit var premium: PremiumService
        private set

    override fun onCreate() {
        super.onCreate()

        database = AppDatabase.get(this)
        supabaseService = SupabaseService()
        preferences = AppPreferences(this)
        repository = CalendarRepository(database, supabaseService, this)
        // Instanciar antes que OfflineManager para que el singleton
        // `ImageAssetCache.instance()` esté disponible nada más arrancar.
        imageAssetCache = ImageAssetCache(this)
        offlineManager = OfflineManager(this, preferences, repository, imageCache = imageAssetCache)
        pushManager = PushNotificationManager(this, preferences, supabaseService)
        analytics = AnalyticsService(this, preferences)
        premium = PremiumService(this, preferences, analytics, appScope)

        // Aplicar consentimiento de analytics ANTES de que Compose pueda llamar a
        // logScreenView. runBlocking es intencionado y acotado: solo lee DataStore
        // (~1-2 ms en caché). Sin esto, el LaunchedEffect de AppNavHost puede
        // disparar el primer screen_view mientras collectionEnabled sigue en false.
        runBlocking { analytics.applyStoredConsent() }

        NotificationChannels.ensureCreated(this)

        // Tareas de arranque en background.
        appScope.launch {
            bootstrap()
        }
    }

    private suspend fun bootstrap() {
        // 1. Consentimiento de analytics ya aplicado síncronamente en onCreate().
        // 2. Reprogramar sync periódica si offline sigue activado + disparar
        //    migración si el esquema de caché quedó obsoleto tras actualizar
        //    la app (ej: nuevos tipos de artefactos — banderas, logos, …).
        if (preferences.offlineEnabled.first()) {
            offlineManager.schedulePeriodic()
            val stored = preferences.snapshotOfflineCacheSchemaVersion()
            if (stored < OfflineManager.CACHE_SCHEMA_VERSION) {
                Log.i(
                    TAG,
                    "Esquema de caché offline desactualizado " +
                        "($stored < ${OfflineManager.CACHE_SCHEMA_VERSION}), " +
                        "disparando sync de migración",
                )
                offlineManager.runSyncNow()
            }
        }
        // 3. Refrescar el token FCM si el usuario ya estaba suscrito.
        if (preferences.pushEnabled.first()) {
            runCatching { pushManager.refreshToken() }
                .onFailure { Log.w(TAG, "refreshToken al arranque falló: ${it.message}") }
        }
        // 4. Al transicionar a Premium (free → paid), si el modo de seguimiento
        //    sigue en FOLLOW_ALL, cambiar a FOLLOW_RACES ("Selectas") para evitar
        //    que el usuario reciba notificaciones de TODAS las carreras nada más
        //    suscribirse. La lista existente de followedRaceIds se respeta: si
        //    está vacía, recibirá cero notificaciones hasta que siga una carrera
        //    manualmente. drop(1) ignora la emisión inicial del StateFlow (que
        //    refleja el estado persistido, no una transición real).
        appScope.launch {
            // StateFlow ya hace operator fusion con distinctUntilChanged
            // internamente (operator fusion docs); aplicarlo aquí emite un
            // warning deprecation. drop(1) ignora la emisión inicial.
            premium.isSubscribed
                .drop(1)
                .collect { subscribed ->
                    if (!subscribed) return@collect
                    val currentMode = preferences.snapshotRaceFollowMode()
                    if (currentMode != RaceFollowMode.FOLLOW_ALL) return@collect
                    preferences.setRaceFollowMode(RaceFollowMode.FOLLOW_RACES)
                    runCatching { pushManager.syncCategories() }
                        .onFailure {
                            Log.w(TAG, "syncCategories tras activar Premium falló: ${it.message}")
                        }
                }
        }
    }

    // Coil singleton con soporte SVG — necesario para banderas sub-nacionales (es-ct, es-pv, …)
    // que la web sirve desde flag-icons CDN como .svg pero flagcdn.com PNG no incluye.
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(SvgDecoder.Factory()) }
            .build()

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(Log.INFO)
            .build()

    companion object {
        private const val TAG = "CalendarioCiclismoApp"
    }
}
