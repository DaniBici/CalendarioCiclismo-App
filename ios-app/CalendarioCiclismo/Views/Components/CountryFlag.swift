import SwiftUI

/// Bandera de país rectangular (20×15 pt). Los SVG viven empaquetados en
/// `Shared/Flags.xcassets/Flags/<code>.imageset` (catálogo compartido con el widget) con `preserves-vector-representation`
/// activado, así que iOS los renderiza nativamente como vectores a cualquier
/// escala — sin red, sin `WKWebView`, sin rasterización manual, sin parpadeo.
///
/// El código ISO se pasa en minúsculas, lo que permite banderas sub-nacionales
/// reales (es-ct, es-pv, gb-eng, gb-sct, gb-wls) ya incluidas en el set.
struct CountryFlag: View {
    let countryCode: String?
    /// Ancho de la bandera; el alto se deriva con la proporción 4:3 (20×15).
    /// Por defecto 20 pt, que es el tamaño usado en listas y cabeceras.
    var width: CGFloat = 20

    private var height: CGFloat { width * 15 / 20 }

    var body: some View {
        let code = Self.resolvedCode(countryCode)
        if !code.isEmpty {
            Image("Flags/\(code)")
                .resizable()
                .interpolation(.high)
                .scaledToFill()
                .frame(width: width, height: height)
                .clipped()
                .accessibilityLabel(AccessibilityCountryNames.name(for: countryCode) ?? "")
        }
    }

    /// Código realmente empaquetado. Si la variante regional no existe en esta
    /// build (p. ej. una autonomía añadida después), cae a la bandera del país
    /// (`es-an` → `es`). Así las versiones anteriores a 5.0.1 no quedan sin
    /// bandera ante códigos nuevos.
    private static func resolvedCode(_ raw: String?) -> String {
        guard let code = raw?.lowercased(), !code.isEmpty else { return "" }
        if UIImage(named: "Flags/\(code)") != nil { return code }
        if let base = code.split(separator: "-").first, UIImage(named: "Flags/\(base)") != nil {
            return String(base)
        }
        return ""
    }
}
