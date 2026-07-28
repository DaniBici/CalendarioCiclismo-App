import Foundation

/// Asset documental de una etapa: perfil, mapa, roadbook, etc. (tabla `assets`).
struct Asset: Codable, Identifiable, Hashable {
    let id: String
    let raceDayId: String
    let type: String?        // technicalGuide, startOrder, roadbook, profile, ports, map, live_text
    let sourceType: String?  // external
    let url: String?

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    /// Etiqueta en español del tipo de asset.
    var typeLabel: String {
        Constants.assetTexts[type ?? ""] ?? type ?? ""
    }

    // MARK: - Caché offline (R2)

    /// Host del CDN propio (Cloudflare R2) donde viven los assets generados
    /// por el panel admin. Las URLs externas (TV oficial, etc.) no se descargan.
    static let r2Host = "assets.calendariociclismo.app"

    /// `true` si la URL apunta a nuestro CDN y por tanto es segura de descargar
    /// para uso offline. `live_text` y cualquier URL externa se excluyen.
    var isDownloadableR2: Bool {
        guard let urlStr = url,
              !urlStr.isEmpty,
              let host = URL(string: urlStr)?.host else { return false }
        return host.lowercased() == Asset.r2Host && type != "technicalGuide"
    }

    /// Extensión del fichero (PDF, PNG, JPG…). Por defecto `pdf` si la URL no
    /// tiene extensión reconocible.
    var fileExtension: String {
        guard let urlStr = url,
              let ext = URL(string: urlStr)?.pathExtension.lowercased(),
              !ext.isEmpty else { return "pdf" }
        return ext
    }
}
