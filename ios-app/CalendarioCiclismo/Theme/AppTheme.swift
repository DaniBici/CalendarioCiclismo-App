import SwiftUI

/// Sistema de colores y tipografía — equivalente a los CSS variables de app.css.
enum AppTheme {

    // MARK: - Colores del tema (adaptables a light/dark)

    /// Color de acento principal.
    static let accent = Color("AccentColor")

    /// Azul de marca fijo (#1A73E8) para fondos destacados, idéntico en claro y
    /// oscuro — espejo del `--accent` de la web y del `primary` de Android.
    static let brandAccent = Color(hex: "1a73e8")

    /// Colores semánticos que se adaptan al modo claro/oscuro.
    static let background = Color(light: "eef1f5", dark: "141923")
    static let cardBackground = Color(light: "fafbfc", dark: "1e2632")
    static let cardBackgroundHover = Color(light: "e9edf3", dark: "202938")
    static let headerBackground = Color(light: "edf1f6", dark: "202938")
    static let secondaryBackground = Color(light: "e9edf3", dark: "293443")
    static let border = Color(light: "d8dee8", dark: "354252")
    static let borderLight = Color(light: "e4e8ef", dark: "293443")
    static let textPrimary = Color(.label)
    static let textMuted = Color(.secondaryLabel)
    static let textDim = Color(.tertiaryLabel)

    /// Superficie neutra de etiquetas y estado único de pulsación: texto al
    /// 8 %, como `--badge-neutral-bg` y `--hover-bg` de la web.
    static let neutralFill = Color.primary.opacity(0.08)
    /// Etiqueta neutra pulsada (`--badge-neutral-hover`).
    static let neutralFillPressed = Color.primary.opacity(0.14)

    // MARK: - Escala visual (espejo de css/app.css)

    /// Dos radios: 4 pt para controles y etiquetas, 8 pt para superficies.
    /// Los círculos se dibujan con `Circle`/`Capsule` solo donde son círculos.
    enum Radius {
        static let control: CGFloat = 4
        static let surface: CGFloat = 8
    }

    /// Escala tipográfica de siete tamaños (`--fs-1` a `--fs-7`). Cada tamaño
    /// escala con Dynamic Type según el estilo de texto más próximo.
    enum TextSize: CGFloat, CaseIterable {
        case s12 = 12, s13 = 13, s14 = 14, s16 = 16, s20 = 20, s28 = 28, s36 = 36

        var textStyle: Font.TextStyle {
            switch self {
            case .s12: return .caption
            case .s13: return .footnote
            case .s14: return .subheadline
            case .s16: return .callout
            case .s20: return .title3
            case .s28: return .title
            case .s36: return .largeTitle
            }
        }
    }

    // Colores fijos para badges y estados
    static let red = Color(light: "c5221f", dark: "ffb4ab")
    static let green = Color(light: "137333", dark: "6dd58c")
    static let blue = Color(light: "1a73e8", dark: "7fcfff")
    static let orange = Color(light: "e37400", dark: "ffb77c")

    // MARK: - Colores de badges UCI

    struct BadgeColor {
        let background: Color
        let foreground: Color
    }

    /// Categoría UCI y género: superficie neutra (el color queda para el tipo
    /// de etapa y los estados).
    static func categoryBadgeColor(for category: String?, highContrast: Bool = false) -> BadgeColor {
        neutralBadgeColor(highContrast: highContrast)
    }

    /// Etiqueta neutra con texto atenuado (categoría, género).
    static func neutralBadgeColor(highContrast: Bool = false) -> BadgeColor {
        let base = BadgeColor(background: neutralFill, foreground: textMuted)
        return highContrast ? highContrastBadgeColor(background: base.background, foreground: base.foreground, highContrast: true) : base
    }

    /// Etiqueta neutra de enlace (TV, Íntegra, dorsales, orden de salida,
    /// resultados): texto principal sobre la superficie neutra.
    static func neutralLinkBadgeColor(highContrast: Bool = false) -> BadgeColor {
        let base = BadgeColor(background: neutralFill, foreground: textPrimary)
        return highContrast ? highContrastBadgeColor(background: base.background, foreground: base.foreground, highContrast: true) : base
    }

    // MARK: - Colores de tipos de etapa

    static func stageTypeBadgeColor(for type: String?, highContrast: Bool = false) -> BadgeColor {
        guard let type else { return BadgeColor(background: .gray.opacity(0.15), foreground: .gray) }
        let base: BadgeColor
        switch type {
        case "flat":
            base = BadgeColor(background: Color(hex: "8cdc64").opacity(0.15), foreground: Color(hex: "8cdc64"))
        case "rolling":
            base = BadgeColor(background: Color(hex: "7ab85a").opacity(0.15), foreground: Color(hex: "7ab85a"))
        case "cotas":
            base = BadgeColor(background: Color(hex: "bcb755").opacity(0.15), foreground: Color(light: "8a8420", dark: "d4cd6a"))
        case "medium_mountain":
            base = BadgeColor(background: Color(hex: "ffb750").opacity(0.15), foreground: Color(light: "b87400", dark: "ffb750"))
        case "high_mountain", "summit_finish", "chrono_climb":
            base = BadgeColor(background: Color(hex: "ff7864").opacity(0.15), foreground: Color(hex: "ff7864"))
        case "uphill_finish":
            base = BadgeColor(background: Color(hex: "ffa030").opacity(0.15), foreground: Color(light: "b86000", dark: "ffa030"))
        case "itt", "ttt":
            base = BadgeColor(background: Color(hex: "64c8ff").opacity(0.15), foreground: Color(hex: "64c8ff"))
        case "cobbles":
            base = BadgeColor(background: Color(hex: "a8a8a8").opacity(0.15), foreground: Color(hex: "a8a8a8"))
        case "sterrato":
            base = BadgeColor(background: Color(hex: "d4bc8c").opacity(0.15), foreground: Color(hex: "d4bc8c"))
        default:
            base = BadgeColor(background: .gray.opacity(0.15), foreground: .gray)
        }
        return highContrast ? highContrastBadgeColor(background: base.background, foreground: base.foreground, highContrast: true) : base
    }

    // MARK: - TV status colors

    /// Color con significado solo en los estados: en directo verde, «No TV
    /// España» rojo, sin confirmar naranja. Emisión con hora, Íntegra y Live
    /// texto previo van en la etiqueta neutra de enlace.
    static func tvStatusColor(for status: String?, hasBroadcasts: Bool, highContrast: Bool = false) -> BadgeColor {
        let base: BadgeColor
        if status == "livetext" || status == "tv_live" {
            base = BadgeColor(background: green.opacity(0.15), foreground: green)
        } else if status == "none" {
            base = BadgeColor(background: Color.gray.opacity(0.1), foreground: textDim)
        } else if status == "unavailable_es" {
            base = BadgeColor(background: red.opacity(0.15), foreground: red)
        } else if status == "pending" {
            base = BadgeColor(background: orange.opacity(0.15), foreground: orange)
        } else if status == "livetext_pre" || hasBroadcasts || status == "confirmed" {
            base = BadgeColor(background: neutralFill, foreground: textPrimary)
        } else {
            base = BadgeColor(background: Color.gray.opacity(0.1), foreground: textDim)
        }
        return highContrast ? highContrastBadgeColor(background: base.background, foreground: base.foreground, highContrast: true) : base
    }
}

// MARK: - Tipografía

/// Aplica un tamaño de la escala común con Dynamic Type.
private struct CCFontModifier: ViewModifier {
    @ScaledMetric private var size: CGFloat
    private let weight: Font.Weight

    init(size: AppTheme.TextSize, weight: Font.Weight) {
        _size = ScaledMetric(wrappedValue: size.rawValue, relativeTo: size.textStyle)
        self.weight = weight
    }

    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight))
    }
}

extension View {
    /// Fuente de la escala común (12, 13, 14, 16, 20, 28 y 36 pt).
    func ccFont(_ size: AppTheme.TextSize, weight: Font.Weight = .regular) -> some View {
        modifier(CCFontModifier(size: size, weight: weight))
    }
}

// MARK: - Color extensions

extension Color {
    /// Crea Color desde hex string (sin #).
    init(hex: String) {
        let h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let scanner = Scanner(string: h)
        var rgb: UInt64 = 0
        scanner.scanHexInt64(&rgb)

        let r = Double((rgb >> 16) & 0xFF) / 255
        let g = Double((rgb >> 8) & 0xFF) / 255
        let b = Double(rgb & 0xFF) / 255

        self.init(red: r, green: g, blue: b)
    }

    /// Color adaptable light/dark.
    init(light: String, dark: String) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light))
        })
    }
}
