import SwiftUI

/// Servicio centralizado de preferencia de tema (claro / oscuro / automático).
///
/// Sigue el mismo patrón que `Haptics` y `AnalyticsService`:
/// - Preferencia persistida en `UserDefaults` con clave `theme_preference`.
/// - Valor por defecto: `.system` (respetar el ajuste del sistema).
/// - `@Observable` para que cambios recalculen `preferredColorScheme` en el
///   root de la app (`CalendarioCiclismoApp.swift`) en caliente.
///
/// Uso:
/// ```swift
/// ContentView()
///     .preferredColorScheme(ThemeService.shared.preference.colorScheme)
/// ```
@MainActor @Observable
final class ThemeService {
    static let shared = ThemeService()

    /// Elecciones expuestas al usuario en Ajustes → Apariencia.
    enum ThemePreference: String, CaseIterable, Identifiable {
        case system
        case light
        case dark

        var id: String { rawValue }

        var label: String {
            switch self {
            case .system: return LocaleService.t("Automático", "Automatic")
            case .light:  return LocaleService.t("Claro", "Light")
            case .dark:   return LocaleService.t("Oscuro", "Dark")
            }
        }

        /// Icono SF Symbol para el selector.
        var icon: String {
            switch self {
            case .system: return "circle.lefthalf.filled"
            case .light:  return "sun.max"
            case .dark:   return "moon"
            }
        }

        /// Traducción a `ColorScheme` para `.preferredColorScheme`.
        /// `nil` = respetar el sistema.
        var colorScheme: ColorScheme? {
            switch self {
            case .system: return nil
            case .light:  return .light
            case .dark:   return .dark
            }
        }
    }

    private static let defaultsKey = "theme_preference"

    /// Preferencia actual. Observada por `CalendarioCiclismoApp` para aplicar
    /// `.preferredColorScheme` en caliente.
    private(set) var preference: ThemePreference

    private init() {
        let raw = UserDefaults.standard.string(forKey: Self.defaultsKey)
            ?? ThemePreference.system.rawValue
        self.preference = ThemePreference(rawValue: raw) ?? .system
    }

    /// Persiste y publica la nueva preferencia.
    func setPreference(_ value: ThemePreference) {
        UserDefaults.standard.set(value.rawValue, forKey: Self.defaultsKey)
        preference = value
    }
}
