import Foundation
import WidgetKit

/// Vuelca en el App Group las preferencias que condicionan el widget y pide a
/// WidgetKit que lo recargue cuando cambian. El widget obtiene sus datos de la
/// RPC `widget_day`; la app ya no escribe ningún payload.
@MainActor
enum WidgetBridge {
    private static var observer: NSObjectProtocol?
    private static var pending: Task<Void, Never>?

    /// Sincroniza al arrancar y ante cualquier cambio de `UserDefaults` de la
    /// app (idioma, filtro fijado, seguimientos, filtro CX).
    static func start() {
        removeLegacyPayload()
        sync()
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification, object: nil, queue: .main
        ) { _ in
            Task { @MainActor in scheduleSync() }
        }
    }

    /// Al volver a primer plano: la región puede haber cambiado con la zona
    /// horaria y conviene refrescar los datos del widget.
    static func appBecameActive() {
        if !sync() { WidgetCenter.shared.reloadTimelines(ofKind: WidgetShared.kind) }
    }

    /// Payload que escribía la app hasta 5.0.8; el widget ya no lo lee.
    private static func removeLegacyPayload() {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WidgetShared.appGroupID)?
            .appending(path: "Caches/widget_today_payload.json") else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private static func scheduleSync() {
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            sync()
        }
    }

    /// Devuelve `true` si las preferencias cambiaron y se recargó el widget.
    @discardableResult
    static func sync() -> Bool {
        let defaults = UserDefaults.standard
        func csv(_ key: String) -> [String] {
            (defaults.string(forKey: key) ?? "").split(separator: ",").map(String.init).filter { !$0.isEmpty }.sorted()
        }
        let settings = WidgetSettings(
            locale: defaults.string(forKey: "app_locale") == "en" ? "en" : "es",
            broadcastGroups: RegionService.allowedBroadcastGroups().sorted(),
            roadFilter: defaults.string(forKey: "defaultFilter") ?? Constants.CategoryFilter.all.rawValue,
            cxFilter: defaults.string(forKey: "cx_default_filter") ?? CxAgendaFilter.all.rawValue,
            followedRaceIds: csv("followed_race_ids"),
            followedStageIds: csv("followed_stage_ids"),
            followedCxRaceIds: csv("followed_cx_race_ids")
        )
        guard settings.save() else { return false }
        WidgetCenter.shared.reloadAllTimelines()
        return true
    }
}
