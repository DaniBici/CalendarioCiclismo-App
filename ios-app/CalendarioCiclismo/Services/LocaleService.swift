import SwiftUI

/// Servicio centralizado de preferencia de idioma (español / inglés).
///
/// Sigue el mismo patrón que `ThemeService`:
/// - Preferencia persistida en `UserDefaults` con clave `app_locale`.
/// - Valor por defecto: `.spanish` (la app nació en español; el inglés
///   se introduce en 2.0 como feature opcional Premium).
/// - `@Observable` para que cambios recalculen el `\.locale` del entorno
///   en `CalendarioCiclismoApp.swift` en caliente.
///
/// El idioma se aplica de tres formas complementarias:
/// 1. `Locale` inyectado vía `.environment(\.locale, ...)` — afecta
///    a formateadores de fecha/número que respetan el environment.
/// 2. `Bundle` localizado inyectado vía `.environment(\.locale, ...)` y
///    `localizedBundle()` — para `LocalizedStringKey` lookups en runtime.
/// 3. `UserDefaults.standard.set([locale], forKey: "AppleLanguages")` para
///    que las APIs de sistema (push notification titles, etc.) usen el
///    idioma elegido en próximos arranques.
///
/// El cambio (1) y (2) son inmediatos. El cambio (3) requiere relanzar
/// la app para que UIKit/SwiftUI detecte el nuevo idioma del bundle.
/// Por eso al cambiar de idioma desde Ajustes mostramos un alert
/// invitando a reiniciar (las pantallas en runtime YA están traducidas
/// pero alertas del sistema y notificaciones programadas pueden tardar).
@MainActor @Observable
final class LocaleService {
    static let shared = LocaleService()

    /// Idiomas soportados por la app. Se amplía cuando se añadan más.
    enum AppLocale: String, CaseIterable, Identifiable {
        case spanish = "es"
        case english = "en"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .spanish: return "Español"
            case .english: return "English"
            }
        }

        /// `Locale` Foundation correspondiente. Se usa para inyectar en
        /// `\.locale` del environment SwiftUI.
        var locale: Locale {
            Locale(identifier: rawValue)
        }
    }

    private static let defaultsKey = "app_locale"
    private static let announcementDoneKey = "language_announcement_done"

    /// Preferencia actual. Observada por `CalendarioCiclismoApp` para aplicar
    /// `\.locale` en caliente.
    private(set) var current: AppLocale

    /// `true` cuando el usuario ya ha visto (y respondido a) la pantalla one-shot
    /// que anuncia que el inglés ya no es Premium en 2.1. Observada por
    /// `CalendarioCiclismoApp` para decidir si mostrar el paso de onboarding
    /// de idioma al primer arranque tras actualizar / instalar.
    private(set) var hasShownLanguageAnnouncement: Bool

    private init() {
        let raw = UserDefaults.standard.string(forKey: Self.defaultsKey)
            ?? AppLocale.spanish.rawValue
        let locale = AppLocale(rawValue: raw) ?? .spanish
        // Migración: usuarios que ya tenían inglés activado (eran Premium en 2.0)
        // no necesitan ver el anuncio — su elección está clara. Marcamos el flag
        // silenciosamente para que no se les interrumpa el arranque.
        let alreadyDone = UserDefaults.standard.bool(forKey: Self.announcementDoneKey)
        let migrateEnglishUser = !alreadyDone && locale == .english
        if migrateEnglishUser {
            UserDefaults.standard.set(true, forKey: Self.announcementDoneKey)
        }
        self.current = locale
        self.hasShownLanguageAnnouncement = alreadyDone || migrateEnglishUser
    }

    /// Marca el anuncio one-shot como visto. Llamado desde
    /// `LanguageAnnouncementOnboardingView` al pulsar cualquiera de las dos
    /// opciones (continuar en español / cambiar a inglés).
    func markLanguageAnnouncementShown() {
        UserDefaults.standard.set(true, forKey: Self.announcementDoneKey)
        hasShownLanguageAnnouncement = true
    }

    /// Persiste y publica el nuevo idioma. La aplicación efectiva al
    /// `Bundle.main` requiere reinicio de la app — para los Strings
    /// localizados en runtime, basta con inyectar el `Locale` en el
    /// environment SwiftUI.
    func setLocale(_ value: AppLocale) {
        UserDefaults.standard.set(value.rawValue, forKey: Self.defaultsKey)
        // AppleLanguages: para que pushes / alertas del sistema usen el
        // idioma correcto tras reiniciar la app.
        UserDefaults.standard.set([value.rawValue], forKey: "AppleLanguages")
        current = value
    }

    /// Devuelve el `Bundle` con los recursos localizados al idioma actual.
    /// Útil para vistas que necesitan recursos (.strings, .xib, imágenes
    /// con variantes por idioma) en runtime sin esperar al reinicio.
    func localizedBundle() -> Bundle {
        guard let path = Bundle.main.path(forResource: current.rawValue, ofType: "lproj"),
              let bundle = Bundle(path: path) else {
            return Bundle.main
        }
        return bundle
    }

    // MARK: - Helpers de traducción en caliente

    /// Helper para strings hardcodeados en vistas mientras no se migra a .strings.
    /// Usa `current` (reactivo a `@Observable`) — solo llamar desde contexto @MainActor.
    func t(_ es: String, _ en: String) -> String {
        current == .english ? en : es
    }

    /// Versión no-aislada del helper, para usar desde modelos y servicios sin @MainActor.
    /// Lee directamente de UserDefaults (misma fuente que `setLocale`).
    nonisolated static func t(_ es: String, _ en: String) -> String {
        let raw = UserDefaults.standard.string(forKey: "app_locale") ?? "es"
        return raw == "en" ? en : es
    }

    /// `true` si el idioma activo es inglés. No-aislado: válido desde cualquier contexto.
    nonisolated static var isEnglish: Bool {
        UserDefaults.standard.string(forKey: "app_locale") == "en"
    }

    /// `true` si el idioma del dispositivo no es español, independientemente de
    /// la preferencia de idioma de la app. Útil para mostrar contenido (nombres de
    /// carrera, tipos de etapa) en inglés a usuarios de países no hispanohablantes
    /// aunque no tengan Premium.
    nonisolated static var isDeviceNonSpanish: Bool {
        !(Locale.preferredLanguages.first?.hasPrefix("es") ?? true)
    }

    /// `true` si los contenidos (nombres de carrera, etiquetas de tipo de etapa)
    /// deben mostrarse en inglés. Dos condiciones lo activan:
    /// - El usuario tiene Premium y seleccionó inglés (`isEnglish`), O
    /// - El idioma principal del dispositivo no es español (`isDeviceNonSpanish`).
    nonisolated static var shouldShowEnglishContent: Bool {
        isEnglish || isDeviceNonSpanish
    }
}
