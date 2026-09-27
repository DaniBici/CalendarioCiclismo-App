import FirebaseCore
import SwiftUI
import UserNotifications

/// Pasos del flujo de onboarding inicial. El orden refleja la prioridad: el
/// step más temprano que no esté completo es el que se muestra. `done` indica
/// que toda la secuencia se ha cumplido.
///
/// Flujo completo (instalación nueva 4.2.3):
///   language → notifications → premiumShowcase → done
///
/// Flujo para actualizaciones:
///   language → notifications → premiumShowcase → done
///
/// El paso de modo OFFLINE se retiró del onboarding en 4.0 (decisión Dani:
/// apenas aportaba; la función sigue disponible en Ajustes).
///
/// `language` es el anuncio one-shot de inglés gratis introducido en 2.1.
/// Los usuarios que ya tenían inglés activado en 2.0 (Premium) saltan este
/// paso automáticamente (migración en `LocaleService.init`).
///
/// `premiumShowcase` anuncia la retirada definitiva de publicidad y el modelo
/// voluntario Amigo. En 4.3.1 vuelve a mostrarse una vez para cubrir también
/// a quienes ya completaron la primera versión del anuncio en 4.3.0.
private enum OnboardingStep: Int, CaseIterable, Comparable {
    case language
    case notifications
    case premiumShowcase
    case done

    static func < (lhs: OnboardingStep, rhs: OnboardingStep) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    /// Calcula el primer step pendiente leyendo persistencia local.
    @MainActor
    static func firstPending() -> OnboardingStep {
        if !LocaleService.shared.hasShownLanguageAnnouncement { return .language }
        if !NotificationManager.shared.hasCompletedOnboarding { return .notifications }
        if !UserDefaults.standard.bool(forKey: "support_intro_v4_3_1_done") {
            return .premiumShowcase
        }
        return .done
    }
}

@main
struct CalendarioCiclismoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var themeService = ThemeService.shared
    @State private var localeService = LocaleService.shared
    @State private var currentStep: OnboardingStep = OnboardingStep.firstPending()
    @State private var showSplash = true
    @State private var splashDismissing = false
    @State private var supportIntroIsNewInstallation = CalendarioCiclismoApp.supportIntroAudience()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

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

                    onboardingOverlay()
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
            .preferredColorScheme(windowColorScheme)
            .transformEnvironment(\.colorScheme) { scheme in
                if let preference = themeService.preference.colorScheme {
                    scheme = preference
                }
            }
            .task {
                WidgetBridge.start()
                await withTaskGroup { group in
                    group.addTask { await preloadTodayData() }
                    group.addTask { try? await Task.sleep(for: .seconds(0.6)) }
                    await group.waitForAll()
                }
                splashDismissing = true
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

    /// Avanza al siguiente step pendiente con animación. Llamado desde el
    /// `onDismiss` de cada onboarding individual.
    private func advance() {
        let next = OnboardingStep.firstPending()
        if reduceMotion {
            currentStep = next
        } else {
            withAnimation(.easeInOut(duration: 0.5)) {
                currentStep = next
            }
        }
    }

    @ViewBuilder
    private func onboardingOverlay() -> some View {
        switch currentStep {
        case .language:
            LanguageAnnouncementOnboardingView(onDismiss: advance)
                .environment(\.locale, localeService.current.locale)
                .transition(.asymmetric(
                    insertion: .opacity,
                    removal: .move(edge: .leading)
                ))
                .zIndex(4)
        case .notifications:
            NotificationOnboardingView(onDismiss: advance)
                .environment(\.locale, localeService.current.locale)
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing),
                    removal: .move(edge: .leading)
                ))
                .zIndex(3)
        case .premiumShowcase:
            PremiumShowcaseOnboardingView(
                isNewInstallation: supportIntroIsNewInstallation,
                onDismiss: advance
            )
                .environment(\.locale, localeService.current.locale)
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing),
                    removal: .opacity
                ))
                .zIndex(1)
        case .done:
            EmptyView()
        }
    }

    /// Fija la audiencia antes de que la primera pantalla marque el idioma como
    /// completado. La clave versionada conserva el resultado entre relanzamientos
    /// si el usuario abandona el onboarding antes de llegar al anuncio de apoyo.
    private static func supportIntroAudience() -> Bool {
        let defaults = UserDefaults.standard
        let key = "support_intro_v4_3_new_installation"
        if defaults.object(forKey: key) != nil {
            return defaults.bool(forKey: key)
        }
        let isNewInstallation = !LocaleService.shared.hasShownLanguageAnnouncement
            && !NotificationManager.shared.hasCompletedOnboarding
        defaults.set(isNewInstallation, forKey: key)
        return isNewInstallation
    }

    private func preloadTodayData() async {
        guard SupabaseService.shared.configurationError == nil else { return }
        let today = DateFormatting.todayKey()
        let year = Int(today.prefix(4)) ?? 2026
        await withTaskGroup { group in
            group.addTask {
                guard let data = try? await SupabaseService.shared.loadDayComplete(dateKey: today) else { return }
                await CacheManager.shared.save(data, forKey: CacheManager.dayKey(today))
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
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                AnimatedRouteProfile(
                    lineColor: Color(light: "1a73e8", dark: "7fcfff"),
                    fillColor: Color(light: "1a73e8", dark: "7fcfff").opacity(0.18),
                    riderColor: Color(light: "1a73e8", dark: "ffffff")
                )
                .frame(height: 230)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea()

            // Mismo recurso y tamaño que UILaunchScreen. El contenedor completo
            // ignora el área segura para centrarlo sobre la pantalla física.
            Image("LaunchLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 100, height: 100)

            // Bloque separado del logo central que presenta el sistema al arrancar.
            VStack(spacing: 6) {
                Text("Calendario Ciclismo")
                    .font(.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color(light: "1f2937", dark: "ffffff"))
                Text("Ciclismo, al instante.")
                    .font(.body)
                    .foregroundStyle(Color(light: "536174", dark: "c4ccd7"))
            }
            .offset(y: 98)
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
