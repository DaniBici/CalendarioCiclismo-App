import Foundation

/// Vídeo de una jornada de carretera (tabla `race_day_videos`): emisión
/// completa, resumen, último kilómetro u otro, en YouTube o en otra plataforma.
/// Reglas de presentación en `StageVideoLogic` (espejo de
/// `js/services/stage-videos.js`).
struct RaceDayVideo: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let raceDayId: String
    let kind: String
    let title: String
    let titleEn: String?
    let channel: String?
    let url: String
    let embeddable: Bool?
    let country: String?
    let sortOrder: Int?
}
