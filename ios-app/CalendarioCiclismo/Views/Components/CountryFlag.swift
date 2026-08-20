import SwiftUI

/// Bandera de país rectangular (20×15 pt). Los SVG viven empaquetados en
/// `Assets.xcassets/Flags/<code>.imageset` con `preserves-vector-representation`
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
        let code = countryCode?.lowercased() ?? ""
        if !code.isEmpty {
            Image("Flags/\(code)")
                .resizable()
                .interpolation(.high)
                .scaledToFill()
                .frame(width: width, height: height)
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .accessibilityLabel(AccessibilityCountryNames.name(for: countryCode) ?? "")
        }
    }
}
