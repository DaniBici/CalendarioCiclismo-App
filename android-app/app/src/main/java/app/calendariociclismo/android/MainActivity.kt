package app.calendariociclismo.android

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.navigation.compose.rememberNavController
import app.calendariociclismo.android.data.prefs.LocalePreference
import app.calendariociclismo.android.data.prefs.ThemePreference
import app.calendariociclismo.android.data.repository.CalendarRepository
import app.calendariociclismo.android.notifications.DeepLink
import app.calendariociclismo.android.util.CyclocrossLogic
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.widget.today.TodayWidgetScheduler
import app.calendariociclismo.android.ui.navigation.AppNavHost
import app.calendariociclismo.android.ui.navigation.Routes
import app.calendariociclismo.android.ui.onboarding.LanguageAnnouncementOnboardingScreen
import app.calendariociclismo.android.ui.onboarding.NotificationOnboardingScreen
import app.calendariociclismo.android.ui.onboarding.SupportIntroOnboardingScreen
import app.calendariociclismo.android.ui.support.SupportSheet
import app.calendariociclismo.android.ui.splash.SplashOverlay
import app.calendariociclismo.android.ui.theme.CalendarioCiclismoTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.Locale

/**
 * Única actividad de la app. Aloja el NavHost y procesa:
 *   - Deep links internos (`race/{id}`, `stage/{id}`, pestañas) provenientes
 *     de notificaciones (extra `EXTRA_DEEP_LINK`).
 *   - Android App Links (`https://calendariociclismo.app/competicion/{slug}`,
 *     `/jornada/{slug}`, etc.) desde la web.
 */
class MainActivity : ComponentActivity() {

    private val newIntentFlow = MutableSharedFlow<Intent>(extraBufferCapacity = 1)

    override fun onCreate(savedInstanceState: Bundle?) {
        // installSplashScreen() ANTES de super.onCreate().
        // En API 31+ delega al Splash Screen nativo; en <31 la compat library
        // genera la pantalla con fondo azul + icono.
        val splashScreen = installSplashScreen()

        super.onCreate(savedInstanceState)
        WindowCompat.enableEdgeToEdge(window)

        // Elimina la animación de salida del splash nativo para que la
        // transición al overlay Compose sea instantánea y sin parpadeo.
        splashScreen.setOnExitAnimationListener { it.remove() }

        // Lectura síncrona de la preferencia de tema para evitar que el primer
        // frame pinte con el tema del sistema y luego haga flip al del usuario.
        // DataStore cachea el valor en memoria, así que el runBlocking es ~1-2 ms
        // (mismo patrón que el consentimiento de analytics en CalendarioCiclismoApp).
        // Antes de leerla corre la migración 4.4.2: en el primer acceso de esta
        // versión la preferencia guardada cambia a Automático y el arranque
        // sigue el ajuste del dispositivo.
        val app = application as CalendarioCiclismoApp
        val initialTheme = runBlocking {
            app.preferences.applyThemeSystemOnFirstAccess()
            app.preferences.snapshotThemePreference()
        }

        // Idioma del usuario — antes de setContent para que getResources()
        // resuelva strings desde values/ o values-en/ en el primer frame.
        // setApplicationLocales además persiste el locale a nivel de app
        // (sobrevive a reinstalaciones del proceso) y cualquier cambio
        // posterior reinicia la activity automáticamente.
        val initialLocale = runBlocking { app.preferences.snapshotAppLocale() }
        // Capturar el locale del sistema ANTES de aplicar el override de la app.
        LocaleHolder.system = android.content.res.Resources.getSystem().configuration.locales.get(0)
            ?: java.util.Locale.getDefault()
        // DataStore es la fuente de verdad del idioma elegido por el usuario.
        // La race condition (SettingsScreen llama a LocaleManager antes de que
        // DataStore persista) se resuelve actualizando LocaleHolder síncronamente
        // en SettingsScreen antes de llamar a LocaleManager — así cuando onCreate
        // se ejecuta en la recreación, DataStore ya tiene el valor nuevo.
        LocaleHolder.current = Locale(initialLocale.tag)
        AppCompatDelegate.setApplicationLocales(
            LocaleListCompat.forLanguageTags(initialLocale.tag),
        )

        // Aplicar la apariencia de la status bar AQUÍ, sobre window.decorView,
        // y no desde un DisposableEffect en Compose. Razón:
        // WindowCompat.getInsetsController necesita una View attached al
        // Window — si pasamos LocalView.current desde Compose, la View aún
        // puede no estar attached al primer pase y la llamada queda en noop.
        // (El log "CCTheme" decía lightIcons=true pero dumpsys mostraba
        // mAppearance=0; esa discrepancia es exactamente este síntoma.)
        val systemDark =
            (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                Configuration.UI_MODE_NIGHT_YES
        val initialDark = when (initialTheme) {
            ThemePreference.SYSTEM -> systemDark
            ThemePreference.LIGHT -> false
            ThemePreference.DARK -> true
        }
        // Aplicamos el flag dos veces: inmediatamente (cubre el primer frame)
        // y vía decorView.post (cubre el caso en que el splash screen u otra
        // capa del sistema sobrescriba el flag tras nuestro setup inicial).
        fun applyBarsAppearance(dark: Boolean) {
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
        applyBarsAppearance(initialDark)
        window.decorView.post { applyBarsAppearance(initialDark) }

        setContent {
            val themePref by app.preferences.themePreference
                .collectAsState(initial = initialTheme)
            val systemDark = isSystemInDarkTheme()
            val darkTheme = when (themePref) {
                ThemePreference.SYSTEM -> systemDark
                ThemePreference.LIGHT  -> false
                ThemePreference.DARK   -> true
            }
            CalendarioCiclismoTheme(darkTheme = darkTheme) {
                val navController = rememberNavController()
                val pendingDeepLink = remember { mutableStateOf<DeepLink?>(null) }
                val scope = rememberCoroutineScope()

                // ── Splash state (replica el patrón iOS de SplashView) ──
                var showSplash by remember { mutableStateOf(true) }
                var splashDismissing by remember { mutableStateOf(false) }

                // Mínimo 0.6 s de splash (igual que iOS), luego lanza el cierre.
                LaunchedEffect(Unit) {
                    delay(600)
                    splashDismissing = true
                }

                // Deep link inicial (desde notificación o App Link). La
                // actividad se recrea (rotación, tema, pliegue) con el mismo
                // intent y la pila de navegación restaurada: sin la marca
                // guardada, el destino se volvía a abrir encima.
                var initialIntentHandled by rememberSaveable { mutableStateOf(false) }
                LaunchedEffect(Unit) {
                    if (initialIntentHandled) return@LaunchedEffect
                    initialIntentHandled = true
                    parseIntent(intent)?.let { pendingDeepLink.value = it }
                }

                // Warm-start: onNewIntent no re-dispara LaunchedEffect(Unit).
                // El flow recibe el intent nuevo y lo procesa igual.
                LaunchedEffect(Unit) {
                    newIntentFlow.collect { i ->
                        parseIntent(i)?.let { pendingDeepLink.value = it }
                    }
                }

                // Consumir deep link cuando esté listo
                LaunchedEffect(pendingDeepLink.value) {
                    val link = pendingDeepLink.value ?: return@LaunchedEffect
                    handleDeepLink(navController, link)
                    pendingDeepLink.value = null
                }

                // Onboarding: misma secuencia que iOS
                // (idioma 2.1 → notificaciones → showcase; el paso de modo
                // offline se retiró en 4.0 — la función vive solo en Ajustes)
                var onboardingStep by remember { mutableStateOf<OnboardingStep?>(null) }
                var supportIntroIsNewInstallation by remember { mutableStateOf(false) }
                val supportVisible by app.premium.supportVisible.collectAsState()

                LaunchedEffect(Unit) {
                    // Migración: si el usuario ya tiene push activado, marcar su
                    // onboarding como completado (compatibilidad 1.x). El paso de
                    // offline se retiró en 4.0 (vive solo en Ajustes).
                    val pushEnabled = app.preferences.pushEnabled.first()
                    if (pushEnabled) app.preferences.setNotifOnboardingDone(true)

                    // Migración 2.1: usuarios que ya tenían inglés activado en
                    // 2.0 (Premium) no necesitan ver el anuncio one-shot — su
                    // elección está clara. Marcamos el flag silenciosamente.
                    val currentLocale = app.preferences.snapshotAppLocale()
                    val languageDone = app.preferences.snapshotLanguageAnnouncementDone()
                    if (!languageDone && currentLocale == LocalePreference.ENGLISH) {
                        app.preferences.setLanguageAnnouncementDone(true)
                    }

                    supportIntroIsNewInstallation = app.preferences.initializeSupportIntroV43Audience()
                    onboardingStep = nextOnboardingStep(app)
                }

                Box(modifier = Modifier.fillMaxSize()) {
                    // El fondo ocupa toda la ventana. Solo el contenido interactivo
                    // consume barras, cámara y teclado, una vez para todas las rutas
                    // y el onboarding. Los diálogos tienen su propia ventana.
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background,
                    ) {
                        Box(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                            AppNavHost(navController = navController)

                            when (onboardingStep) {
                                OnboardingStep.Language -> LanguageAnnouncementOnboardingScreen(
                                    onDismiss = {
                                        scope.launch {
                                            onboardingStep = nextOnboardingStep(app)
                                        }
                                    },
                                )
                                OnboardingStep.Notifications -> NotificationOnboardingScreen(
                                    onDismiss = {
                                        scope.launch {
                                            onboardingStep = nextOnboardingStep(app)
                                        }
                                    },
                                )
                                OnboardingStep.SupportIntro -> SupportIntroOnboardingScreen(
                                    isNewInstallation = supportIntroIsNewInstallation,
                                    onDismiss = {
                                        scope.launch {
                                            onboardingStep = nextOnboardingStep(app)
                                        }
                                    },
                                )
                                else -> {} // null (loading) o Done
                            }
                        }
                    }

                    if (showSplash) {
                        SplashOverlay(
                            dismissing = splashDismissing,
                            onDismissed = {
                                showSplash = false
                                splashDismissing = false
                            },
                        )
                    }

                    if (supportVisible) {
                        SupportSheet(onDismiss = { app.premium.dismissSupport() })
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        newIntentFlow.tryEmit(intent)
    }

    /**
     * Llamado por el sistema cuando cambia la configuración (incluido el locale).
     * Actualiza `LocaleHolder.current` para que `DateFormatting` y `RaceDay`
     * emitan los textos correctos sin necesidad de reiniciar el proceso.
     */
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        val newLocale = newConfig.locales.get(0) ?: java.util.Locale.getDefault()
        LocaleHolder.current = newLocale
    }

    override fun onStart() {
        super.onStart()
        val app = application as CalendarioCiclismoApp
        lifecycleScope.launch {
            // Sincronizar baja si el permiso fue revocado en ajustes del SO
            app.pushManager.syncPermissionState(this@MainActivity)

            // Refrescar el widget si lleva más de 30 min sin actualizarse
            val lastRefreshMs = app.preferences.snapshotLastWidgetRefreshAt()
            if (System.currentTimeMillis() - lastRefreshMs > 30 * 60 * 1000L) {
                TodayWidgetScheduler.refreshNow(this@MainActivity)
            }
        }
    }

    /**
     * Parsea el Intent para extraer un DeepLink. Soporta:
     *   - Extra `EXTRA_DEEP_LINK` (enviado por FCM service)
     *   - Scheme custom `calendariociclismo://` (widget "Hoy en el ciclismo")
     *   - Android App Links HTTPS con path `/competicion/{slug}`, `/jornada/{slug}`,
     *     etc. (convertimos a `race/{slug}` o `stage/{slug}` — los ViewModels
     *     resuelven el slug contra Supabase).
     */
    private fun parseIntent(intent: Intent?): DeepLink? {
        if (intent == null) return null
        intent.getStringExtra(EXTRA_DEEP_LINK)?.let { raw ->
            return DeepLink.parse(raw)
        }
        val data = intent.data ?: return null
        DeepLink.fromUri(data)?.let { return it }
        // Scheme custom del widget — delega a DeepLink.fromUri.
        if (data.scheme == "calendariociclismo") {
            return null
        }
        if (data.scheme != "https" || data.host != "calendariociclismo.app") return null
        val segments = data.pathSegments
        return when {
            // Raíz `/` → pestaña Hoy.
            segments.isEmpty() -> DeepLink.Tab("today")
            // Páginas raíz de la web (mes.html, temporada.html, buscar.html) → tab equivalente.
            segments.size == 1 -> when (segments[0]) {
                "mes.html" -> DeepLink.Tab("month")
                "temporada.html" -> DeepLink.Tab("season")
                else -> null
            }
            else -> {
                // El último segmento del App Link HTTPS es un SLUG (no un id de
                // Room): `/competicion/<slug>/`, `/jornada/<slug>/`. Se emite una
                // variante por-slug que el handler resuelve a id antes de navegar.
                val slug = segments[1]
                when (segments[0]) {
                    "competicion" -> DeepLink.RaceSlug(slug)
                    "jornada" -> DeepLink.StageSlug(slug)
                    else -> null
                }
            }
        }
    }

    private suspend fun handleDeepLink(
        navController: androidx.navigation.NavController,
        link: DeepLink,
    ) {
        when (link) {
            is DeepLink.Race -> navController.navigate(Routes.race(link.id))
            is DeepLink.Stage -> navController.navigate(Routes.stage(link.id))
            is DeepLink.CxRace -> navController.navigate(Routes.cxRace(link.id, link.anchor))
            is DeepLink.CxRaceSlug -> {
                val app = application as CalendarioCiclismoApp
                lifecycleScope.launch {
                    val id = runCatching { app.cxRepository.raceIdForSlug(link.slug) }.getOrNull()
                    navController.navigate(id?.let { Routes.cxRace(it, link.anchor) } ?: Routes.CYCLOCROSS) {
                        launchSingleTop = true
                    }
                }
            }
            // Página de serie web (/ciclocross/torneos/<slug>/): el slug se
            // resuelve a torneo en Supabase. Sin resolución, caer a la pestaña CX.
            is DeepLink.CxTournamentSlug -> {
                val app = application as CalendarioCiclismoApp
                lifecycleScope.launch {
                    val tournament = runCatching { app.cxRepository.tournamentForSlug(link.slug) }.getOrNull()
                    val route = tournament?.let {
                        Routes.cxTournament(it.id, it.seasonKey ?: CyclocrossLogic.season(java.time.LocalDate.now()),
                            LocaleHolder.t(it.name, it.nameEn ?: it.name), it.logoUrl)
                    } ?: Routes.CYCLOCROSS
                    navController.navigate(route) { launchSingleTop = true }
                }
            }
            // App Link HTTPS (`/competicion/<slug>/`, `/jornada/<slug>/`): el
            // segmento es un SLUG, no un id de Room. La resolución slug → id va
            // a Supabase (suspende), así que se ejecuta en `lifecycleScope` —NO
            // en el LaunchedEffect que invoca esto, porque ese se cancela en
            // cuanto se limpia `pendingDeepLink` y abortaría la query a medias.
            // Espejo de `load(slug:)` en iOS. Si el slug no existe, caer a Hoy.
            is DeepLink.RaceSlug -> resolveSlugAndNavigate(navController) {
                raceIdForSlug(link.slug)?.let { Routes.race(it) }
            }
            is DeepLink.StageSlug -> resolveSlugAndNavigate(navController) {
                raceDayIdForSlug(link.slug)?.let { Routes.stage(it) }
            }
            is DeepLink.Startlist -> navController.navigate(Routes.startlist(link.id))
            is DeepLink.StartOrder -> navController.navigate(Routes.startOrder(link.id))
            is DeepLink.Profile -> navController.navigate(Routes.elevationProfile(link.id))
            is DeepLink.Team -> navController.navigate(Routes.transfersTeam(link.id))
            is DeepLink.Results -> navController.navigate(Routes.results(link.raceId, link.stage, suffix = link.suffix))
            is DeepLink.Tab -> {
                // Las antiguas pestañas Mes/Temporada viven ahora dentro de
                // Calendario: el link fija primero la subvista (DataStore) y
                // navega después, para que CalendarScreen ya la lea actualizada.
                val app = application as CalendarioCiclismoApp
                val route = when (link.name) {
                    "today" -> Routes.TODAY
                    "results" -> Routes.RESULTS_FEED
                    "calendar" -> Routes.CALENDAR
                    "cyclocross" -> Routes.CYCLOCROSS
                    "month" -> {
                        app.preferences.setCalendarSubview("month")
                        Routes.CALENDAR
                    }
                    "season" -> {
                        app.preferences.setCalendarSubview("season")
                        Routes.CALENDAR
                    }
                    // Mercado de fichajes (4.0). "search" ya no existe como
                    // pestaña: pushes/links antiguos caen a Hoy.
                    "transfers" -> Routes.TRANSFERS
                    "search" -> Routes.TODAY
                    "notifications", "subscribe" -> Routes.SETTINGS
                    else -> return
                }
                navController.navigate(route) {
                    launchSingleTop = true
                    popUpTo(Routes.TODAY)
                }
            }
        }
    }

    /**
     * Resuelve un deep-link por slug (App Link HTTPS) a una ruta de navegación
     * y navega. Corre en `lifecycleScope` (ligado a la Activity, no a la
     * composición) para que la query a Supabase no se cancele cuando el
     * `LaunchedEffect` que originó el deep-link se recompone/olvida. Si el slug
     * no resuelve a una ruta, cae a la pestaña Hoy en vez de un error muerto.
     */
    private fun resolveSlugAndNavigate(
        navController: androidx.navigation.NavController,
        resolve: suspend CalendarRepository.() -> String?,
    ) {
        val app = application as CalendarioCiclismoApp
        lifecycleScope.launch {
            val route = runCatching { app.repository.resolve() }.getOrNull()
            if (route != null) {
                navController.navigate(route)
            } else {
                navController.navigate(Routes.TODAY) {
                    launchSingleTop = true
                    popUpTo(Routes.TODAY)
                }
            }
        }
    }

    companion object {
        const val EXTRA_DEEP_LINK = "cc_deep_link"
    }
}

/**
 * Paso del flujo de onboarding inicial.
 * El orden refleja la prioridad: el step más temprano que no esté completo
 * es el que se muestra. `Done` indica que toda la secuencia se ha cumplido.
 *
 * Flujo completo (instalación nueva 4.0): Language → Notifications → SupportIntro → Done.
 * Flujo para actualizaciones (notif ya completado): Language → SupportIntro → Done.
 * El paso de modo OFFLINE se retiró del onboarding en 4.0 (decisión Dani:
 * apenas aportaba; la función sigue disponible en Ajustes).
 *
 * `Language` es el anuncio one-shot introducido en 2.1 (inglés ya no es Premium).
 * `SupportIntro` presenta el apoyo voluntario Amigo. A quien actualiza desde
 * una versión anterior a 4.3.1 le anuncia la retirada de publicidad y el icono
 * Fundador. Su clave versionada permite mostrarlo una sola vez.
 */
private enum class OnboardingStep { Language, Notifications, SupportIntro, Done }

/**
 * Calcula el siguiente onboarding pendiente leyendo persistencia local.
 * Llamado tras cerrar cada pantalla de onboarding.
 */
private suspend fun nextOnboardingStep(app: CalendarioCiclismoApp): OnboardingStep {
    val languageDone = app.preferences.languageAnnouncementDone.first()
    val notifDone = app.preferences.notifOnboardingDone.first()
    val supportIntroDone = app.preferences.supportIntroV43Done.first()
    return when {
        !languageDone -> OnboardingStep.Language
        !notifDone -> OnboardingStep.Notifications
        !supportIntroDone -> OnboardingStep.SupportIntro
        else -> OnboardingStep.Done
    }
}
