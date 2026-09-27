import Foundation
import UserNotifications
import UIKit

/// Gestiona el registro y estado de las notificaciones push.
@MainActor
@Observable
final class NotificationManager: NSObject {
    static let shared = NotificationManager()

    /// Estado actual del permiso de notificaciones.
    var authorizationStatus: UNAuthorizationStatus = .notDetermined

    /// Indica si el usuario ha completado el onboarding de notificaciones.
    var hasCompletedOnboarding: Bool {
        get { UserDefaults.standard.bool(forKey: "push_onboarding_completed") }
        set { UserDefaults.standard.set(newValue, forKey: "push_onboarding_completed") }
    }

    /// Indica si las notificaciones están activas (permiso concedido + suscrito).
    var isSubscribed: Bool {
        get { UserDefaults.standard.bool(forKey: "push_subscribed") }
        set { UserDefaults.standard.set(newValue, forKey: "push_subscribed") }
    }

    /// Token del dispositivo (hex string).
    private(set) var deviceToken: String? {
        get { UserDefaults.standard.string(forKey: "push_device_token") }
        set { UserDefaults.standard.set(newValue, forKey: "push_device_token") }
    }

    /// Deep link recibido de una notificación para navegación.
    var pendingDeepLink: DeepLink?

    /// Tipos de deep link que puede recibir la app.
    enum DeepLink: Equatable {
        case tab(Int)          // Hoy, Resultados, Fichajes, CX y Calendario
        case race(String)      // raceId
        case stage(String)     // raceDayId
        case startlist(String) // raceId → vista de inscritos
        case startOrder(String) // raceDayId → orden de salida
        case profile(String)    // raceDayId → perfil de elevación de la jornada
        case routeMap(String)   // raceDayId → mapa del recorrido de la jornada
        case team(String)       // teamId → ficha del equipo en Mercado de Fichajes
        case cxRace(String, anchor: String?)
        case cxRaceSlug(String, anchor: String?)
        // Página de serie web: /ciclocross/torneos/<slug>/ y /en/cyclocross/series/<slug>.
        case cxTournamentSlug(String)
        /// Resultados nativos de una jornada (copa del widget): etapa nil = final
        /// o última clasificación; sufijo A/B de doble sector.
        case results(raceId: String, stageNumber: Int?, stageSuffix: String?)

        /// Parsea un string de deep link recibido de la notificación.
        static func parse(_ value: String) -> DeepLink? {
            if value.hasPrefix("cxRace/") {
                let parts = value.dropFirst(7).split(separator: "#", omittingEmptySubsequences: false)
                guard parts.count <= 2, let id = parts.first, validCxId(String(id)),
                      parts.count == 1 || validCxAnchor(String(parts[1])) else { return nil }
                return .cxRace(String(id), anchor: parts.count == 2 ? String(parts[1]) : nil)
            }
            // "results/{raceId}/{etapa|final}{sufijo}" → resultados nativos.
            if value.hasPrefix("results/") {
                let parts = value.dropFirst(8).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
                guard parts.count == 2, !parts[0].isEmpty else { return nil }
                if parts[1] == "final" { return .results(raceId: parts[0], stageNumber: nil, stageSuffix: nil) }
                guard let match = parts[1].wholeMatch(of: /(\d+)([A-Z]?)/), let number = Int(match.1) else { return nil }
                return .results(raceId: parts[0], stageNumber: number,
                                stageSuffix: match.2.isEmpty ? nil : String(match.2))
            }
            // Formato: "race/{id}", "stage/{id}", "startlist/{id}",
            // "startOrder/{id}", "perfil/{id}", "team/{id}" o nombre de pestaña.
            if value.hasPrefix("race/") {
                let id = String(value.dropFirst(5))
                return id.isEmpty ? nil : .race(id)
            }
            if value.hasPrefix("stage/") {
                let id = String(value.dropFirst(6))
                return id.isEmpty ? nil : .stage(id)
            }
            if value.hasPrefix("startlist/") {
                let id = String(value.dropFirst(10))
                return id.isEmpty ? nil : .startlist(id)
            }
            if value.hasPrefix("startOrder/") {
                let id = String(value.dropFirst(11))
                return id.isEmpty ? nil : .startOrder(id)
            }
            // "perfil/" apunta al perfil de elevación de una JORNADA (por
            // raceDayId), no a una ficha de corredor (esa solo existe en web).
            if value.hasPrefix("perfil/") {
                let id = String(value.dropFirst(7))
                return id.isEmpty ? nil : .profile(id)
            }
            // "mapa/" apunta al mapa del recorrido de una JORNADA (por raceDayId).
            if value.hasPrefix("mapa/") {
                let id = String(value.dropFirst(5))
                return id.isEmpty ? nil : .routeMap(id)
            }
            if value.hasPrefix("team/") {
                let id = String(value.dropFirst(5))
                return id.isEmpty ? nil : .team(id)
            }
            // Apps 5.0: CX ocupa la cuarta pestaña; Calendario pasa a la quinta.
            let tabMap: [String: Int] = [
                "today": 0, "results": 1, "transfers": 2, "cyclocross": 3,
                "month": 4, "season": 4, "calendar": 4, "search": 0,
                "subscribe": 5, "notifications": 6
            ]
            if let tabIndex = tabMap[value] {
                return .tab(tabIndex)
            }
            return nil
        }

        /// Parsea una URL con scheme `calendariociclismo://`.
        ///
        /// Formas aceptadas:
        ///   - `calendariociclismo://race/{id}`       → `.race(id)`
        ///   - `calendariociclismo://stage/{id}`      → `.stage(id)`
        ///   - `calendariociclismo://startlist/{id}`  → `.startlist(id)`
        ///   - `calendariociclismo://startOrder/{id}` → `.startOrder(id)`
        ///   - `calendariociclismo://perfil/{id}`     → `.profile(id)`
        ///   - `calendariociclismo://mapa/{id}`       → `.routeMap(id)`
        ///   - `calendariociclismo://team/{id}`       → `.team(id)`
        ///   - `calendariociclismo://results/{raceId}/{etapa}` → `.results(...)`
        ///   - `calendariociclismo://tab/{name}`      → `.tab(index)`
        ///   - `calendariociclismo://{tabName}`       → `.tab(index)` (forma corta)
        ///
        /// Se reconstruye la forma que espera `parse(_:)` para reutilizar el
        /// parser existente y mantener una única fuente de verdad.
        static func fromURL(_ url: URL) -> DeepLink? {
            if url.scheme == "https" { return fromCxWebURL(url) }
            guard url.scheme == "calendariociclismo" else { return nil }
            // `URL.host` es el primer segmento tras `://`; el resto va en
            // `pathComponents` (el primero es siempre "/").
            guard let host = url.host, !host.isEmpty else { return nil }
            let extraSegments = url.pathComponents.filter { $0 != "/" }

            if host == "cxRace" || host == "cxrace" {
                guard url.user == nil, url.password == nil, url.port == nil,
                      extraSegments.count == 1 else { return nil }
                return parse("cxRace/" + extraSegments[0] + (url.fragment.map { "#" + $0 } ?? ""))
            }
            if host == "race" || host == "stage" || host == "startlist"
                || host == "startOrder" || host == "perfil" || host == "mapa" || host == "team" {
                guard let id = extraSegments.first, !id.isEmpty else { return nil }
                return parse("\(host)/\(id)")
            }
            if host == "results" {
                guard extraSegments.count == 2 else { return nil }
                return parse("results/" + extraSegments.joined(separator: "/"))
            }
            if host == "tab" {
                guard let name = extraSegments.first, !name.isEmpty else { return nil }
                return parse(name)
            }
            // Forma corta: calendariociclismo://today → "today"
            return parse(host)
        }
        private static func validCxId(_ value: String) -> Bool {
            value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
        }
        private static func validCxAnchor(_ value: String) -> Bool {
            value == "general" || CyclocrossLogic.categories.contains(value) ||
                CyclocrossLogic.categories.contains { value == "general-" + $0 || value == "inscritos-" + $0 }
        }
        private static func fromCxWebURL(_ url: URL) -> DeepLink? {
            guard url.host?.lowercased() == "calendariociclismo.app", url.user == nil,
                  url.password == nil, url.port == nil || url.port == 443 else { return nil }
            let segments = url.pathComponents.filter { $0 != "/" }
            let english = segments.first == "en"
            let prefix = english ? ["en", "cyclocross"] : ["ciclocross"]
            guard Array(segments.prefix(prefix.count)) == prefix else { return nil }
            let rest = Array(segments.dropFirst(prefix.count))
            if rest.isEmpty { return .tab(3) }
            // Página de serie: torneos/ en ES, series/ en EN.
            if rest.count == 2, rest[0] == (english ? "series" : "torneos"),
               rest[1].range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil {
                return .cxTournamentSlug(rest[1])
            }
            guard rest.count == 1, rest[0].range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil,
                  url.fragment == nil || validCxAnchor(url.fragment!) else { return nil }
            return .cxRaceSlug(rest[0], anchor: url.fragment)
        }
    }

    private override init() {
        super.init()
    }

    // MARK: - Public API

    /// Comprueba el estado actual del permiso sin pedirlo.
    func checkCurrentStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    /// Solicita permiso de notificaciones al usuario.
    @discardableResult
    func requestPermission() async -> Bool {
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound, .badge])
            await checkCurrentStatus()
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
            return granted
        } catch {
            await checkCurrentStatus()
            return false
        }
    }

    /// Registra el token del dispositivo en Supabase.
    func registerToken(_ tokenData: Data) async {
        let hex = tokenData.map { String(format: "%02x", $0) }.joined()
        deviceToken = hex
        guard isSubscribed else { return }
        await sendTokenToServer(hex, isActive: true)
    }

    /// Suscribirse a notificaciones: pide permiso y registra.
    func subscribe() async {
        let granted = await requestPermission()
        if granted {
            isSubscribed = true
            if let token = deviceToken {
                await sendTokenToServer(token, isActive: true)
            }
        }
    }

    /// Reenvía el token al servidor si el usuario está suscrito localmente.
    /// Cura suscripciones que pudieron fallar en releases previas (p. ej. el
    /// bug de RLS que rechazaba el upsert). Idempotente: si el token ya está
    /// registrado, el upsert no hace nada relevante.
    ///
    /// Doble camino para maximizar la recuperación:
    ///  1. Upsert directo con el token persistido en `UserDefaults` — cubre
    ///     el caso en el que APNs no reentregue el token en este arranque.
    ///  2. `registerForRemoteNotifications()` — fuerza a APNs a reentregar
    ///     el token vía el callback del AppDelegate, que vuelve a llamar a
    ///     `registerToken` y hace upsert. Cubre tokens rotados o perdidos.
    ///
    /// Si el permiso fue revocado en los ajustes del SO mientras la app
    /// estaba en segundo plano, sincroniza la baja con el servidor para
    /// evitar acumular tokens activos que nunca recibirán entregas.
    func healSubscriptionIfNeeded() async {
        guard isSubscribed else { return }
        await checkCurrentStatus()
        if authorizationStatus == .denied {
            await unsubscribe()
            return
        }
        if let token = deviceToken {
            await sendTokenToServer(token, isActive: true)
        }
        if authorizationStatus == .authorized || authorizationStatus == .provisional {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// Desuscribirse: desactiva el token en el servidor.
    func unsubscribe() async {
        isSubscribed = false
        if let token = deviceToken {
            await sendTokenToServer(token, isActive: false)
        }
    }

    /// Elimina permanentemente todos los datos del usuario del servidor y del dispositivo.
    func deleteAllData() async -> Bool {
        var remoteOk = true
        if let token = deviceToken {
            do {
                try await SupabaseService.shared.deletePushToken(token)
            } catch {
                remoteOk = false
            }
        }
        isSubscribed = false
        deviceToken = nil
        hasCompletedOnboarding = false
        return remoteOk
    }

    /// Procesa una notificación recibida.
    func handleNotification(userInfo: [AnyHashable: Any]) {
        if let raw = userInfo["deepLink"] as? String,
           let link = DeepLink.parse(raw) {
            pendingDeepLink = link
        }
    }

    // MARK: - Private

    private func sendTokenToServer(_ token: String, isActive: Bool) async {
        do {
            let region = RegionService.shared.current.rawValue
            let countryGroup = RegionService.shared.effectiveCountryGroup()
            let language = LocaleService.shared.current.rawValue
            let categories = NotificationCategoryService.shared.enabledRaw
            let followedRaces  = RaceFollowService.shared.followedRacesForRpc
            let raceFilters    = RaceFollowService.shared.raceFiltersForRpc
            let followedStages = RaceFollowService.shared.followedStagesForRpc
            try await SupabaseService.shared.upsertPushToken(
                token,
                isActive: isActive,
                region: region,
                countryGroup: countryGroup,
                language: language,
                categories: categories,
                followedRaces: followedRaces,
                raceFilters: raceFilters,
                followedStages: followedStages,
                followedCxRaces: RaceFollowService.shared.followedCxRacesForRpc
            )
        } catch {
            #if DEBUG
            print("[NotificationManager] Error enviando token al servidor: \(error.localizedDescription)")
            #endif
        }
    }
}
