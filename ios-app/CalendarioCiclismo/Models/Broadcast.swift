import Foundation

/// Emisión de TV/streaming de una etapa (tabla `broadcasts` en Supabase).
struct Broadcast: Codable, Identifiable, Hashable {
    let id: String
    let raceDayId: String
    let channel: String?
    let startTimeUtc: String?
    let url: String?
    let note: String?
    let sortOrder: Int?
    let showInRevive: Bool?
    let country: String?

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    /// Hora de inicio formateada en la zona horaria del dispositivo.
    var startTimeLocal: String? {
        guard let ts = startTimeUtc else { return nil }
        return DateFormatting.formatTimeLocal(ts)
    }
}
