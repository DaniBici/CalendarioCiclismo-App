import Foundation

/// Servicio centralizado de preferencias de tipo de notificación push.
///
/// Sigue el mismo patrón que `RegionService` y `LocaleService`:
/// - Conjunto persistido en `UserDefaults` con clave `notification_categories`
///   (CSV de rawValues).
/// - `.general` siempre presente (no se puede desactivar — es el baseline
///   gratuito heredado de 1.4.4 que cubre anuncios y novedades).
/// - El resto (`.raceStart`, `.tvStart`, `.results`) son features Premium en
///   Fase 6: en Fases 1-5 los toggles de UI están deshabilitados, así que en
///   la práctica todos los devices solo tienen `.general` activa.
/// - `@Observable` para que cambios en runtime disparen el upsert al server
///   sin esfuerzo desde la vista.
///
/// La regla "no degradar lo gratis" se cumple porque:
///  1. `.general` es el único valor activo por defecto.
///  2. La categoría `general` engloba TODO lo que la app gratuita 1.4.4
///     enviaba — anuncios admin, recordatorios manuales, novedades.
///  3. Las categorías Premium (`raceStart`, `tvStart`, `results`) NUNCA
///     estuvieron disponibles en la app gratuita, así que no degradan nada.
@MainActor @Observable
final class NotificationCategoryService {
    static let shared = NotificationCategoryService()

    /// Tipos de notificación expuestos al usuario en Ajustes. El rawValue
    /// coincide con el valor `category` en el Edge Function `send-push` y
    /// con el CHECK de `push_subscription_categories.category`.
    enum NotificationCategory: String, CaseIterable, Identifiable {
        case general   = "general"
        case raceStart = "race_start"
        case tvStart   = "tv_start"
        case results   = "results"

        var id: String { rawValue }

        /// True si esta categoría es feature Premium (todo lo que NO sea
        /// `.general`). En Fases 1-5 los toggles Premium están deshabilitados.
        var isPremium: Bool { self != .general }

        /// Etiqueta visible en la UI. Cadena fuente en español;
        /// `LocalizedStringKey(label)` resuelve la traducción contra el
        /// catálogo `Localizable.xcstrings`.
        var labelKey: String {
            switch self {
            case .general:   return "Anuncios y novedades"
            case .raceStart: return "Inicio de carrera"
            case .tvStart:   return "Inicio de emisión TV"
            case .results:   return "Resultados al cerrar la jornada"
            }
        }

        /// Subtítulo descriptivo bajo la etiqueta.
        var descriptionKey: String {
            switch self {
            case .general:   return "Mejoras de la app y avisos importantes"
            case .raceStart: return "T-30 min antes del banderazo"
            case .tvStart:   return "T-5 min antes de cada retransmisión"
            case .results:   return "Podio y clasificaciones tras la meta"
            }
        }

        /// SF Symbol decorativo para la fila.
        var icon: String {
            switch self {
            case .general:   return "megaphone"
            case .raceStart: return "flag.checkered"
            case .tvStart:   return "play.rectangle"
            case .results:   return "trophy"
            }
        }
    }

    private static let defaultsKey = "notification_categories"

    /// Conjunto de categorías activas. Siempre incluye `.general`.
    private(set) var enabled: Set<NotificationCategory>

    private init() {
        if let raw = UserDefaults.standard.string(forKey: Self.defaultsKey), !raw.isEmpty {
            let parsed: Set<NotificationCategory> = Set(
                raw.split(separator: ",").compactMap {
                    NotificationCategory(rawValue: String($0))
                }
            )
            // `.general` siempre se conserva para preservar el baseline gratuito.
            self.enabled = parsed.union([.general])
        } else {
            self.enabled = [.general]
        }
    }

    /// Activa o desactiva una categoría. La categoría `.general` no se puede
    /// desactivar (no-op). Persiste y publica el cambio.
    func setEnabled(_ category: NotificationCategory, _ value: Bool) {
        guard category != .general else { return }
        if value {
            enabled.insert(category)
        } else {
            enabled.remove(category)
        }
        persist()
    }

    /// True si la categoría está activa actualmente.
    func isEnabled(_ category: NotificationCategory) -> Bool {
        enabled.contains(category)
    }

    /// Lista ordenada de rawValues para enviar al server vía RPC.
    /// `.general` siempre va primero por convención.
    var enabledRaw: [String] {
        NotificationCategory.allCases
            .filter { enabled.contains($0) }
            .map { $0.rawValue }
    }

    private func persist() {
        let csv = NotificationCategory.allCases
            .filter { enabled.contains($0) }
            .map { $0.rawValue }
            .joined(separator: ",")
        UserDefaults.standard.set(csv, forKey: Self.defaultsKey)
    }
}
