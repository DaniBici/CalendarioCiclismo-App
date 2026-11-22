import FirebaseCore
import SwiftUI
import UserNotifications

@main
struct CalendarioCiclismoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var themeService = ThemeService.shared
    @State private var localeService = LocaleService.shared
    /// Bienvenida pendiente (idioma, notificaciones y apoyo). Mientras se
    /// muestra hace también de pantalla de arranque, sin `SplashView`.
    @State private var showsWelcome: Bool
    @State private var showSplash: Bool
    @State private var splashDismissing = false
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Self.configureBarAppearance()
        let welcomePending = WelcomeStep.firstPending() != .done
        _showsWelcome = State(initialValue: welcomePending)
        _showSplash = State(initialValue: !welcomePending)
    }

    /// Barra superior y barra de pestañas sobre la superficie de las tarjetas
    /// (blanca en claro, tono de tarjeta en oscuro) con el filete de borde,
    /// como la cabecera y la barra inferior de la web. La pestaña activa toma
    /// el acento del `tint` de `ContentView`.
    private static func configureBarAppearance() {
        let surface = UIColor(AppTheme.cardBackground)
        let border = UIColor(AppTheme.border)

        let navigation = UINavigationBarAppearance()
        navigation.configureWithOpaqueBackground()
        navigation.backgroundColor = surface
        navigation.shadowColor = border
        UINavigationBar.appearance().standardAppearance = navigation
        UINavigationBar.appearance().compactAppearance = navigation
        UINavigationBar.appearance().scrollEdgeAppearance = navigation
        UINavigationBar.appearance().compactScrollEdgeAppearance = navigation

        let tabs = UITabBarAppearance()
        tabs.configureWithOpaqueBackground()
        tabs.backgroundColor = surface
        tabs.shadowColor = border
        UITabBar.appearance().standardAppearance = tabs
        UITabBar.appearance().scrollEdgeAppearance = tabs
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                // Fondo raíz canónico. Evita que cualquier pantalla transparente,
                // transición o estado de carga deje ver el negro del hosting view.
                AppTheme.background
                    .ignoresSafeArea()

                if let configError = SupabaseService.shared.configurationError {
                    ErrorView(message: configError, retry: nil)
                        .environment(\.locale, localeService.current.locale)
                } else {
                    ContentView()
                        .environment(\.locale, localeService.current.locale)

                    if showsWelcome {
                        // La bienvenida se funde por sí misma antes de avisar.
                        WelcomeOnboardingView(onFinish: { showsWelcome = false })
                            .environment(\.locale, localeService.current.locale)
                            .zIndex(4)
                    }
                }

                if showSplash {
                    SplashView(dismissing: splashDismissing) {
                        showSplash = false
                        splashDismissing = false
                    }
                    // UILaunchScreen sigue el tema del dispositivo, no la
                    // preferencia seleccionada dentro de la app.
                    .environment(\.colorScheme, launchColorScheme)
                    .zIndex(10)
                }
            }
            // Burbujas de Hoy: solo con el arranque y la bienvenida terminados.
            .onChange(of: showsWelcome) { _, _ in TodayFiltersTip.appReady = !showsWelcome && !showSplash }
            .onChange(of: showSplash) { _, _ in TodayFiltersTip.appReady = !showsWelcome && !showSplash }
            .preferredColorScheme(windowColorScheme)
            .transformEnvironment(\.colorScheme) { scheme in
                if let preference = themeService.preference.colorScheme {
                    scheme = preference
                }
            }
            .task {
                TodayTips.configure()
                TodayFiltersTip.appReady = !showsWelcome && !showSplash
                WidgetBridge.start()
                // El splash continúa el arranque del sistema durante 0,6 s
                // (igual que Android) y no espera a la red: una carga lenta se
                // muestra dentro de Hoy, con la barra de pestañas visible. La
                // precarga sigue en segundo plano y llena la caché del día.
                let preload = Task { await preloadTodayData() }
                try? await Task.sleep(for: .seconds(0.6))
                splashDismissing = true
                await preload.value
                await NotificationManager.shared.checkCurrentStatus()
                // Reenviar el token al servidor si el usuario está suscrito
                // localmente. Cubre instalaciones que se quedaron "suscritas
                // en el dispositivo pero no en Supabase" por fallos previos
                // de registro.
                await NotificationManager.shared.healSubscriptionIfNeeded()
                // Sincronización diaria del modo offline si está activado
                await OfflineManager.shared.syncIfNeeded()
            }
            // Deep links entrantes desde URLs con scheme `calendariociclismo://`
            // (p. ej. el widget «Carreras de hoy»). Se delega al mismo enum
            // DeepLink que usan las push; ContentView observa `pendingDeepLink`.
            .onOpenURL { url in
                if let link = NotificationManager.DeepLink.fromURL(url) {
                    NotificationManager.shared.pendingDeepLink = link
                }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                ForegroundTap.sceneBecameActive()
                WidgetBridge.appBecameActive()
            }
        }
    }

    private var windowColorScheme: ColorScheme? {
        // Las barras del sistema conservan el contraste del lanzamiento hasta
        // que desaparece. El contenido ya se prepara con su tema seleccionado.
        showSplash ? launchColorScheme : themeService.preference.colorScheme
    }

    private var launchColorScheme: ColorScheme {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }
        // SwiftUI puede aplicar preferredColorScheme también a los traits de
        // la escena. La pantalla conserva la apariencia elegida en el sistema.
        return scene?.screen.traitCollection.userInterfaceStyle == .dark ? .dark : .light
    }

    private func preloadTodayData() async {
        // Limpieza de fichas de carrera antiguas y de la temporada en formato
        // anterior; no depende de la red.
        Task.detached(priority: .background) { await CacheManager.shared.purgeNavigationCache() }
        guard SupabaseService.shared.configurationError == nil else { return }
        let today = DateFormatting.todayKey()
        let year = Int(today.prefix(4)) ?? 2026
        await withTaskGroup { group in
            // Con Hoy de carretera retirada no hay día que precargar.
            if RoadTodayAvailability.isVisible(today: today) {
                group.addTask {
                    guard let data = try? await SupabaseService.shared.loadDayComplete(dateKey: today) else { return }
                    await CacheManager.shared.save(data, forKey: CacheManager.dayKey(today))
                }
            }
            group.addTask {
                guard let races = try? await SupabaseService.shared.racesByYear(year) else { return }
                await CacheManager.shared.save(races, forKey: CacheManager.yearRacesKey(year))
            }
        }
    }
}

// MARK: - Splash screen

private struct SplashView: View {
    let dismissing: Bool
    let onDismissed: () -> Void

    @State private var textOpacity: Double = 0
    @State private var opacity: Double = 1.0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Color("LaunchScreenBackground")
                .ignoresSafeArea()

            // Ocupa todo el splash para que el perfil quede anclado al borde
            // inferior, como en la animación web (no centrado bajo el logo).
            // Línea y punto en el acento en ambos temas, como la pantalla de
            // carga de la web.
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                AnimatedRouteProfile(
                    lineColor: AppTheme.brandAccent,
                    fillColor: AppTheme.brandAccent.opacity(0.18)
                )
                .frame(height: 230)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea()

            // Mismo recurso y tamaño que UILaunchScreen. El contenedor completo
            // ignora el área segura para centrarlo sobre la pantalla física. La
            // imagen lleva los símbolos por encima de su centro
            // (`LaunchBrandLayout`).
            Image("LaunchLogo")
                .resizable()
                .scaledToFit()
                .frame(width: LaunchBrandLayout.logoSize.width, height: LaunchBrandLayout.logoSize.height)

            // Bloque separado del logo central que presenta el sistema al arrancar.
            VStack(spacing: 6) {
                Text("Calendario Ciclismo")
                    .ccFont(.s28, weight: .bold)
                    .foregroundStyle(LaunchBrandLayout.titleColor)
                Text(LocaleService.t("Ciclismo, al instante.", "Cycling, instantly."))
                    .ccFont(.s16)
                    .foregroundStyle(LaunchBrandLayout.taglineColor)
            }
            .offset(y: LaunchBrandLayout.textDrop - LaunchBrandLayout.markLift)
            .opacity(textOpacity)
        }
        .ignoresSafeArea()
        .opacity(opacity)
        .onAppear {
            if reduceMotion {
                textOpacity = 1
            } else {
                withAnimation(.easeOut(duration: 0.25)) {
                    textOpacity = 1
                }
            }
        }
        .onChange(of: dismissing) { _, isDismissing in
            guard isDismissing else { return }
            if reduceMotion {
                onDismissed()
            } else {
                withAnimation(.easeOut(duration: 0.3)) {
                    opacity = 0
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    onDismissed()
                }
            }
        }
    }
}

// MARK: - AppDelegate para manejar notificaciones push

final class AppDelegate: NSObject, UIApplicationDelegate, @preconcurrency UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        FirebaseApp.configure()
        // AnalyticsService.shared se inicializa aquí para aplicar el consentimiento
        // almacenado (deshabilitado por defecto) antes del primer evento.
        _ = AnalyticsService.shared
        UNUserNotificationCenter.current().delegate = self

        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            await NotificationManager.shared.registerToken(deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Silenciar en simulador; en dispositivo real es un error real
    }

    // Notificación recibida con la app en foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        return [.banner, .sound, .badge]
    }

    // El usuario pulsa la notificación
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        await MainActor.run {
            NotificationManager.shared.handleNotification(userInfo: userInfo)
        }
    }
}
