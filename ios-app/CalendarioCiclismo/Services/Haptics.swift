import SwiftUI
import UIKit

/// Servicio centralizado de feedback háptico.
///
/// Objetivos:
/// - Exponer un vocabulario **semántico** de eventos (`navigation`, `selection`,
///   `success`, …) en lugar de que cada vista elija directamente pesos de impacto.
///   Así se mantiene una identidad háptica consistente en toda la app.
/// - Respetar una preferencia del usuario (`haptics_enabled`) que se gestiona en
///   Ajustes y que se guarda en `UserDefaults`, siguiendo el patrón de
///   `OfflineManager` y `NotificationManager`.
/// - Respetar automáticamente los ajustes del sistema: los generadores de UIKit
///   no vibran si el usuario ha desactivado "Retornos del sistema" en
///   Ajustes → Sonidos y vibraciones, así que no hay que añadir nada extra.
///
/// Uso:
/// ```swift
/// Haptics.play(.navigation)   // al cambiar de día / mes
/// Haptics.play(.selection)    // al cambiar filtro, orden, etc.
/// Haptics.play(.success)      // tras una acción que termina bien
/// ```
///
/// Por qué @MainActor: los `UIFeedbackGenerator` deben invocarse desde el hilo
/// principal. Todas las vistas que los usan ya están en `@MainActor`, así que
/// marcar el enum evita warnings de concurrencia.
@MainActor
enum Haptics {

    /// Eventos semánticos. Cada caso se mapea internamente al tipo de generador
    /// y peso más apropiado. Si en el futuro se ajusta la identidad háptica de
    /// la app, basta con modificar este mapeo, sin tocar los sitios de llamada.
    enum Event {
        /// Navegación entre pantallas o días: cambio de día en la barra,
        /// prev/next mes, "Ir al día de hoy". Impacto ligero.
        case navigation

        /// Cambio de selección en un control discreto: filtro de categoría,
        /// orden, chip de mes. Usa `UISelectionFeedbackGenerator`, que es el
        /// retorno que Apple usa en pickers y segmentos.
        case selection

        /// Cruce de un límite al arrastrar (DateBarView al pasar de un día al
        /// siguiente durante el drag). Impacto muy ligero para no resultar
        /// pesado cuando se dispara repetidamente.
        case boundary

        /// Toggle de un ajuste (notificaciones, offline, haptics…). Impacto
        /// suave — más táctil que `navigation`, menos agresivo que `primary`.
        case toggle

        /// Acción primaria con compromiso: "Añadir calendario", botón de
        /// confirmación, suscribirse a un feed. Impacto medio.
        case primaryAction

        /// Confirmación de éxito tras una operación (sincronización completada,
        /// suscripción push OK, eliminación de datos OK).
        case success

        /// Aviso de precaución previo a una acción destructiva (mostrar alerta
        /// de confirmación) o resultado intermedio.
        case warning

        /// Error irrecuperable (fallo al eliminar datos, error de red al
        /// confirmar una acción, etc.).
        case error
    }

    // MARK: - Preferencia de usuario

    private enum Keys {
        static let enabled = "haptics_enabled"
    }

    /// Indica si el usuario ha habilitado los hápticos. Por defecto `true` en
    /// instalaciones limpias (la ausencia del valor se interpreta como activo).
    ///
    /// `nonisolated` porque sólo lee `UserDefaults` (thread-safe) y necesita
    /// ser accesible desde inicializadores de `@State` que pueden evaluarse
    /// fuera del `@MainActor`.
    nonisolated static var isEnabled: Bool {
        if UserDefaults.standard.object(forKey: Keys.enabled) == nil { return true }
        return UserDefaults.standard.bool(forKey: Keys.enabled)
    }

    /// Persiste el valor del toggle. Llamar desde la vista de Ajustes.
    nonisolated static func setEnabled(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: Keys.enabled)
    }

    // MARK: - Reproducción

    /// Dispara el feedback háptico correspondiente al evento. Es un no-op si la
    /// preferencia del usuario lo tiene desactivado o si el sistema ha
    /// deshabilitado hápticos globalmente.
    static func play(_ event: Event) {
        guard isEnabled else { return }

        switch event {
        case .navigation, .boundary:
            let g = UIImpactFeedbackGenerator(style: .light)
            g.impactOccurred()

        case .toggle:
            let g = UIImpactFeedbackGenerator(style: .soft)
            g.impactOccurred()

        case .primaryAction:
            let g = UIImpactFeedbackGenerator(style: .medium)
            g.impactOccurred()

        case .selection:
            let g = UISelectionFeedbackGenerator()
            g.selectionChanged()

        case .success:
            let g = UINotificationFeedbackGenerator()
            g.notificationOccurred(.success)

        case .warning:
            let g = UINotificationFeedbackGenerator()
            g.notificationOccurred(.warning)

        case .error:
            let g = UINotificationFeedbackGenerator()
            g.notificationOccurred(.error)
        }
    }
}
