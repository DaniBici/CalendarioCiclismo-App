import Foundation

/// Obtiene los datos del widget de la RPC `widget_day` y conserva la última
/// respuesta válida en el App Group para mostrarla sin conexión.
enum WidgetDataSource {
    struct Result: Sendable {
        let response: WidgetDayResponse
        /// `true` si la red falló y se sirve la copia local.
        let fromCache: Bool
    }

    /// Días pedidos: hoy y mañana, para cambiar de jornada a medianoche sin red.
    static let days = 2

    static func load(scope: WidgetScope, discipline: WidgetDiscipline, now: Date = Date()) async -> Result? {
        let settings = WidgetSettings.load()
        let body = requestBody(settings: settings, scope: scope, discipline: discipline, now: now)
        let cacheURL = cacheFile(scope: scope, discipline: discipline)
        if let data = try? await fetch(body: body),
           let response = try? JSONDecoder.widget.decode(WidgetDayResponse.self, from: data) {
            if let cacheURL {
                try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? data.write(to: cacheURL, options: .atomic)
            }
            return Result(response: response, fromCache: false)
        }
        guard let cacheURL, let data = try? Data(contentsOf: cacheURL),
              let response = try? JSONDecoder.widget.decode(WidgetDayResponse.self, from: data) else { return nil }
        return Result(response: response, fromCache: true)
    }

    static func requestBody(settings: WidgetSettings, scope: WidgetScope, discipline: WidgetDiscipline, now: Date) -> [String: Any] {
        var body: [String: Any] = [
            "p_date": WidgetDates.key(now),
            "p_days": days,
            "p_locale": settings.locale,
            "p_broadcast_groups": settings.broadcastGroups,
            "p_disciplines": discipline.rpcValue,
        ]
        switch scope {
        case .appFilter:
            body["p_filter"] = settings.roadFilter
            body["p_cx_filter"] = settings.cxFilter
        case .all:
            body["p_filter"] = "all"
            body["p_cx_filter"] = "all"
        case .followed:
            body["p_race_ids"] = settings.followedRaceIds
            body["p_race_day_ids"] = settings.followedStageIds
            body["p_cx_race_ids"] = settings.followedCxRaceIds
        }
        return body
    }

    private static func fetch(body: [String: Any]) async throws -> Data {
        guard let info = Bundle.main.infoDictionary,
              let base = (info["SUPABASE_URL"] as? String).flatMap(URL.init(string:)),
              let key = info["SUPABASE_ANON_KEY"] as? String, !key.isEmpty else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: base.appending(path: "rest/v1/rpc/widget_day"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "apikey")
        // Las claves JWT heredadas también viajan como portador.
        if key.hasPrefix("eyJ") { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }

    private static func cacheFile(scope: WidgetScope, discipline: WidgetDiscipline) -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WidgetShared.appGroupID)?
            .appending(path: "Caches/widget_day_\(scope.rawValue)_\(discipline.rawValue).json")
    }
}
