import Foundation

/// Contrato compartido entre la app y la extensión del widget (se compila en
/// ambos targets). La app vuelca aquí las preferencias que condicionan la
/// consulta `widget_day`; el widget solo las lee.
enum WidgetShared {
    static let appGroupID = "group.app.calendariociclismo"
    /// `kind` histórico del widget: se conserva para no romper los widgets ya
    /// añadidos a la pantalla de inicio.
    static let kind = "TodayCyclingWidget"
    static let settingsKey = "widget_settings_v1"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupID) }
}

/// Preferencias de la app que el widget necesita para pedir sus datos.
struct WidgetSettings: Codable, Equatable, Sendable {
    /// `es` o `en`.
    var locale: String
    /// Grupos de `broadcasts.country` visibles en la región del dispositivo.
    var broadcastGroups: [String]
    /// Filtro fijado en Hoy (`all|pro|uwt|wwt|male|female`).
    var roadFilter: String
    /// Filtro fijado en la agenda CX (`all|big|pro|spain`).
    var cxFilter: String
    var followedRaceIds: [String]
    var followedStageIds: [String]
    var followedCxRaceIds: [String]

    static let fallback = WidgetSettings(
        locale: Locale.preferredLanguages.first?.hasPrefix("en") == true ? "en" : "es",
        broadcastGroups: ["ALL", "ES", "EUROPA"],
        roadFilter: "all",
        cxFilter: "all",
        followedRaceIds: [],
        followedStageIds: [],
        followedCxRaceIds: []
    )

    static func load() -> WidgetSettings {
        guard let data = WidgetShared.defaults?.data(forKey: WidgetShared.settingsKey),
              let value = try? JSONDecoder().decode(WidgetSettings.self, from: data) else { return .fallback }
        return value
    }

    /// Guarda las preferencias. Devuelve `true` si han cambiado.
    @discardableResult
    func save() -> Bool {
        guard let defaults = WidgetShared.defaults else { return false }
        let current = defaults.data(forKey: WidgetShared.settingsKey)
            .flatMap { try? JSONDecoder().decode(WidgetSettings.self, from: $0) }
        guard current != self, let data = try? JSONEncoder().encode(self) else { return false }
        defaults.set(data, forKey: WidgetShared.settingsKey)
        return true
    }
}
