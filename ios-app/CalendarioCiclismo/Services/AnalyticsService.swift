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
