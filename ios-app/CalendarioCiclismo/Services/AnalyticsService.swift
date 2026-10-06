import FirebaseAnalytics
import Foundation

/// Wrapper sobre Firebase Analytics que respeta el consentimiento del usuario.
///
/// - Por defecto la recolección está **habilitada** (opt-out): si no hay preferencia
///   guardada, se trata como `true` y el usuario puede desactivarla desde
///   Ajustes → Privacidad.
/// - La preferencia se almacena en `UserDefaults` con la clave `analytics_enabled`.
///
/// Uso:
/// ```swift
/// AnalyticsService.shared.logScreenView("today")
/// // Con parámetros personalizados:
/// AnalyticsService.shared.logScreenView("race_detail", parameters: [
///     "race_id": raceId,
///     "race_name": "Tour de France"
/// ])
/// ```
@MainActor @Observable
final class AnalyticsService {
    static let shared = AnalyticsService()

    private static let defaultsKey = "analytics_enabled"
    private static let onboardingKey = "analytics_onboarding_done"

    /// Estado actual de consentimiento.
    private(set) var isEnabled: Bool

    /// Indica si el usuario ya ha visto la pantalla de onboarding de analytics.
    /// Conservado por compatibilidad histórica; el onboarding dedicado se eliminó
    /// en 1.4.5 al pasar al modelo opt-out.
    var hasCompletedOnboarding: Bool {
        get { UserDefaults.standard.bool(forKey: Self.onboardingKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.onboardingKey) }
    }

    private init() {
        // Default true cuando la clave no existe (opt-out). `bool(forKey:)` devuelve
        // `false` si la clave no está presente, así que detectamos ese caso con
        // `object(forKey:)` y aplicamos el default correcto.
        let stored = UserDefaults.standard.object(forKey: Self.defaultsKey) as? Bool
        let enabled = stored ?? true
        self.isEnabled = enabled
        Analytics.setAnalyticsCollectionEnabled(enabled)
    }

    /// Actualiza el consentimiento y persiste la preferencia.
    func setEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: Self.defaultsKey)
        isEnabled = enabled
        Analytics.setAnalyticsCollectionEnabled(enabled)
    }

    /// Registra la pantalla visible actual con parámetros opcionales.
    func logScreenView(_ screenName: String, parameters: [String: Any]? = nil) {
        // El contador de engagement es local e independiente del consentimiento:
        // decide cuándo tiene sentido invitar a contribuir, no perfila ni envía datos.
        ContributionPromptService.shared.recordContentScreenView(screenName)
        ReviewPromptService.shared.recordContentScreenView(screenName)
        guard isEnabled else { return }
        var eventParams: [String: Any] = [AnalyticsParameterScreenName: screenName]
        if let parameters = parameters {
            eventParams.merge(parameters) { _, new in new }
        }
        Analytics.logEvent(AnalyticsEventScreenView, parameters: eventParams)
    }

    /// Registra un evento personalizado con parámetros opcionales.
    func logEvent(_ name: String, parameters: [String: Any]? = nil) {
        guard isEnabled else { return }
        Analytics.logEvent(name, parameters: parameters)
    }
}

/// Decide de forma local y conservadora cuándo invitar a una persona que ya usa
/// la app a contribuir voluntariamente a su sostenimiento.
///
/// No se apoya en Firebase: funciona igual si se desactiva Analytics y solo
/// persiste contadores agregados en el dispositivo. La campaña admite como
/// máximo dos avisos: el primero tras 30 pantallas de contenido y 7 días de uso;
/// el segundo, si se pospone, tras 60 pantallas adicionales y 21 días.
@MainActor @Observable
final class ContributionPromptService {
    static let shared = ContributionPromptService()

    private enum Key {
        static let firstContentView = "contribution_prompt_v4_2_4_first_content_view"
        static let contentViews = "contribution_prompt_v4_2_4_content_views"
        static let promptCount = "contribution_prompt_v4_2_4_prompt_count"
        static let lastPromptViews = "contribution_prompt_v4_2_4_last_prompt_views"
        static let lastPromptDate = "contribution_prompt_v4_2_4_last_prompt_date"
        static let meaningfulAction = "contribution_prompt_v4_2_4_meaningful_action"
    }

    private let eligibleScreens: Set<String> = [
        "today", "results_feed", "results", "race_detail", "stage_detail",
        "startlist", "start_order", "elevation_profile", "route_map",
        "month", "season", "transfers", "transfers_team"
    ]

    private(set) var shouldPresent = false

    private init() {}

    func recordContentScreenView(_ screenName: String) {
        guard eligibleScreens.contains(screenName),
              !PremiumService.shared.isSubscribed,
              !PremiumService.shared.legacyPremiumEntitlementActive else { return }

        let defaults = UserDefaults.standard
        if meaningfulScreens.contains(screenName) {
            defaults.set(true, forKey: Key.meaningfulAction)
        }
        if defaults.object(forKey: Key.firstContentView) == nil {
            defaults.set(Date(), forKey: Key.firstContentView)
        }
        defaults.set(defaults.integer(forKey: Key.contentViews) + 1, forKey: Key.contentViews)

        // Solo se presenta al volver a la portada, nunca durante una consulta
        // concreta ni inmediatamente al abrir la app.
        guard screenName == "today", isEligibleToPresent else { return }
        shouldPresent = true
        AnalyticsService.shared.logEvent("contribution_prompt_view", parameters: [
            "prompt_number": defaults.integer(forKey: Key.promptCount) + 1,
        ])
    }

    func deferPrompt() { registerDecision("later") }
    func openSupport() { registerDecision("open_support") }

    private var isEligibleToPresent: Bool {
        let defaults = UserDefaults.standard
        let promptCount = defaults.integer(forKey: Key.promptCount)
        guard promptCount < 2,
              let firstView = defaults.object(forKey: Key.firstContentView) as? Date,
              Date().timeIntervalSince(firstView) >= 7 * 24 * 60 * 60,
              defaults.bool(forKey: Key.meaningfulAction)
        else { return false }

        let views = defaults.integer(forKey: Key.contentViews)
        if promptCount == 0 { return views >= 30 }

        guard let lastPrompt = defaults.object(forKey: Key.lastPromptDate) as? Date,
              Date().timeIntervalSince(lastPrompt) >= 21 * 24 * 60 * 60
        else { return false }
        return views - defaults.integer(forKey: Key.lastPromptViews) >= 60
    }

    private let meaningfulScreens: Set<String> = [
        "race_detail", "stage_detail", "results", "startlist", "start_order",
        "elevation_profile", "route_map", "transfers_team"
    ]

    private func registerDecision(_ action: String) {
        let defaults = UserDefaults.standard
        let nextCount = defaults.integer(forKey: Key.promptCount) + 1
        defaults.set(nextCount, forKey: Key.promptCount)
        defaults.set(defaults.integer(forKey: Key.contentViews), forKey: Key.lastPromptViews)
        defaults.set(Date(), forKey: Key.lastPromptDate)
        shouldPresent = false
        AnalyticsService.shared.logEvent("contribution_prompt_action", parameters: [
            "action": action,
            "prompt_number": nextCount,
        ])
    }
}

/// Criterio de la petición de reseña nativa (espejo de `ReviewPromptPolicy`
/// en Android). Primera petición: 3 días desde la primera pantalla de
/// contenido, 15 pantallas y una acción de interés. Siguientes: versión de la
/// app distinta de la última petición, al menos `repeatInterval` desde ella y
/// de nuevo 15 pantallas y una acción de interés. Siempre desde Hoy. El
/// sistema decide además si la muestra (Apple: 3 veces al año como máximo).
enum ReviewPromptPolicy {
    static let firstDelay: TimeInterval = 3 * 24 * 60 * 60
    static let repeatInterval: TimeInterval = 28 * 24 * 60 * 60
    static let minimumContentViews = 15

    static func shouldRequest(
        now: Date,
        isToday: Bool,
        firstContentView: Date?,
        contentViews: Int,
        meaningfulAction: Bool,
        lastRequestAt: Date?,
        lastRequestVersion: String?,
        currentVersion: String
    ) -> Bool {
        guard isToday, contentViews >= minimumContentViews, meaningfulAction else { return false }
        if let lastRequestAt {
            return now.timeIntervalSince(lastRequestAt) >= repeatInterval
                && lastRequestVersion != currentVersion
        }
        guard let firstContentView else { return false }
        return now.timeIntervalSince(firstContentView) >= firstDelay
    }
}

/// Requests the native Store review prompt after demonstrated engagement.
@MainActor @Observable
final class ReviewPromptService {
    static let shared = ReviewPromptService()

    private enum Key {
        static let firstContentView = "review_prompt_first_content_view"
        static let contentViews = "review_prompt_content_views"
        static let meaningfulAction = "review_prompt_meaningful_action"
        /// Marca heredada (una única petición por instalación); se migra a
        /// `lastRequestAt` / `lastRequestVersion`.
        static let requested = "review_prompt_requested"
        static let lastRequestAt = "review_prompt_last_request_at"
        static let lastRequestVersion = "review_prompt_last_request_version"
    }

    private let eligibleScreens: Set<String> = [
        "today", "results_feed", "results", "race_detail", "stage_detail",
        "startlist", "start_order", "elevation_profile", "route_map",
        "month", "season", "transfers", "transfers_team"
    ]
    private let meaningfulScreens: Set<String> = [
        "race_detail", "stage_detail", "results", "startlist", "start_order",
        "elevation_profile", "route_map", "transfers_team"
    ]

    private(set) var shouldRequest = false

    private static var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }

    private init() {
        // Quien ya recibió la petición única anterior empieza a contar el
        // intervalo desde esta actualización.
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: Key.requested), defaults.object(forKey: Key.lastRequestAt) == nil {
            defaults.set(Date(), forKey: Key.lastRequestAt)
            defaults.set(Self.currentVersion, forKey: Key.lastRequestVersion)
        }
        defaults.removeObject(forKey: Key.requested)
    }

    func recordContentScreenView(_ screenName: String) {
        guard eligibleScreens.contains(screenName), !shouldRequest else { return }

        let defaults = UserDefaults.standard
        if defaults.object(forKey: Key.firstContentView) == nil {
            defaults.set(Date(), forKey: Key.firstContentView)
        }
        if meaningfulScreens.contains(screenName) {
            defaults.set(true, forKey: Key.meaningfulAction)
        }
        defaults.set(defaults.integer(forKey: Key.contentViews) + 1, forKey: Key.contentViews)

        shouldRequest = ReviewPromptPolicy.shouldRequest(
            now: Date(),
            isToday: screenName == "today",
            firstContentView: defaults.object(forKey: Key.firstContentView) as? Date,
            contentViews: defaults.integer(forKey: Key.contentViews),
            meaningfulAction: defaults.bool(forKey: Key.meaningfulAction),
            lastRequestAt: defaults.object(forKey: Key.lastRequestAt) as? Date,
            lastRequestVersion: defaults.string(forKey: Key.lastRequestVersion),
            currentVersion: Self.currentVersion
        )
    }

    /// Registra la petición y reinicia el uso acumulado para la siguiente.
    func markRequested() {
        let defaults = UserDefaults.standard
        defaults.set(Date(), forKey: Key.lastRequestAt)
        defaults.set(Self.currentVersion, forKey: Key.lastRequestVersion)
        defaults.set(0, forKey: Key.contentViews)
        defaults.set(false, forKey: Key.meaningfulAction)
        shouldRequest = false
    }
}
