import Foundation

// MARK: - Contrato de la RPC `widget_day` (supabase/migrations/*_widget_day.sql)

struct WidgetDayResponse: Codable, Sendable {
    let version: Int
    let generatedAt: Date
    let locale: String
    let days: [WidgetDay]

    func day(for key: String) -> WidgetDay? { days.first { $0.date == key } }
}

struct WidgetDay: Codable, Sendable {
    let date: String
    let items: [WidgetItem]
    let next: WidgetNext?
}

struct WidgetTV: Codable, Sendable, Hashable {
    /// `time | confirmed | pending | none | unavailable_es`
    let status: String?
    let channel: String?
    let channels: [String]?
    let startUtc: Date?
}

struct WidgetSession: Codable, Sendable, Hashable {
    let category: String
    let label: String?
    let elite: Bool?
    let startUtc: Date?
    let finishUtc: Date?
    let cancelled: Bool?
    let hasResults: Bool?
}

struct WidgetItem: Codable, Sendable, Hashable, Identifiable {
    /// `road | cx`
    let kind: String
    let id: String
    let raceId: String?
    let link: String
    let name: String
    let countryCode: String?
    let category: String?
    let gender: String?
    let grandTour: Bool?
    /// `race | rest | cancelled`
    let state: String
    let stageNumber: Int?
    let stageLabel: String?
    let primaryType: String?
    let typeLabel: String?
    let distanceKm: Double?
    let route: String?
    let tournament: String?
    let startUtc: Date?
    let finishUtc: Date?
    let raceStatus: String?
    let tv: WidgetTV?
    /// Texto en directo de la jornada (asset `live_text`).
    let liveTextUrl: String?
    let hasResults: Bool?
    /// Sin spoilers: accesos de Hoy a resultados (copa) y Revive (TV).
    let resultsLink: String?
    let reviveUrl: String?
    let sessions: [WidgetSession]?

    var isCX: Bool { kind == "cx" }
    var url: URL? { URL(string: link) }
    var liveTextURL: URL? { liveTextUrl.flatMap(URL.init(string:)) }
    var resultsURL: URL? { resultsLink.flatMap(URL.init(string:)) }
    var reviveURL: URL? { reviveUrl.flatMap(URL.init(string:)) }
}

struct WidgetNext: Codable, Sendable, Hashable {
    let date: String
    let kind: String
    let id: String
    let link: String
    let name: String
    let countryCode: String?
    let category: String?
    let stageLabel: String?
    let startUtc: Date?
    let tvStartUtc: Date?
    let tvChannel: String?

    var url: URL? { URL(string: link) }
}

// MARK: - Decodificación

extension JSONDecoder {
    /// PostgREST devuelve `timestamptz` con fracciones y desfase (`+00:00`).
    static let widget: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = WidgetDates.parse(raw) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Fecha no válida: \(raw)")
        }
        return decoder
    }()
}

enum WidgetDates {
    static func parse(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: raw) { return date }
        // Microsegundos de `now()`: se descartan las fracciones.
        let trimmed = raw.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        return plain.date(from: trimmed)
    }

    /// Clave `yyyy-MM-dd` en la zona del dispositivo.
    static func key(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func date(fromKey key: String) -> Date? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: key)
    }

    static func nextMidnight(after date: Date) -> Date {
        let calendar = Calendar.current
        return calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: date) ?? date)
    }
}
