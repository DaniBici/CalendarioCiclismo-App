import SwiftUI

/// Sistema de colores y tipografía — equivalente a los CSS variables de app.css.
enum AppTheme {

    // MARK: - Colores del tema (adaptables a light/dark)

    /// Color de acento principal.
    static let accent = Color("AccentColor")

    /// Colores semánticos que se adaptan al modo claro/oscuro.
    static let background = Color(.systemBackground)
    static let cardBackground = Color(.secondarySystemBackground)
    static let cardBackgroundHover = Color(.tertiarySystemBackground)
    static let border = Color(.separator)
    static let borderLight = Color(.opaqueSeparator)
    static let textPrimary = Color(.label)
    static let textMuted = Color(.secondaryLabel)
    static let textDim = Color(.tertiaryLabel)

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

    static func categoryBadgeColor(for category: String?, highContrast: Bool = false) -> BadgeColor {
        guard let cat = category else { return BadgeColor(background: .gray.opacity(0.15), foreground: .gray) }
        let tier = RaceLogic.categoryTier(cat)
        let base: BadgeColor
        switch tier {
        case "wc":
            base = BadgeColor(background: Color.purple.opacity(0.15), foreground: Color(hex: "d2b4ff"))
        case "wt":
            let wtFg = Color(light: "1a73e8", dark: "5ba3f5")
            base = BadgeColor(background: wtFg.opacity(0.15), foreground: wtFg)
        case "pro":
            base = BadgeColor(background: Color.gray.opacity(0.15), foreground: Color.gray)
        case "2":
            base = BadgeColor(background: Color.gray.opacity(0.15), foreground: Color.gray)
        default:
            base = BadgeColor(background: Color.gray.opacity(0.15), foreground: Color.gray)
        }
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

    static func tvStatusColor(for status: String?, hasBroadcasts: Bool, highContrast: Bool = false) -> BadgeColor {
        let base: BadgeColor
        if status == "livetext" {
            base = BadgeColor(background: green.opacity(0.15), foreground: green)
        } else if status == "livetext_pre" {
            base = BadgeColor(background: blue.opacity(0.15), foreground: blue)
        } else if status == "tv_live" {
            base = BadgeColor(background: green.opacity(0.15), foreground: green)
        } else if status == "none" {
            base = BadgeColor(background: Color.gray.opacity(0.15), foreground: Color.gray)
        } else if status == "unavailable_es" {
            base = BadgeColor(background: red.opacity(0.15), foreground: red)
        } else if status == "pending" {
            base = BadgeColor(background: orange.opacity(0.15), foreground: orange)
        } else if hasBroadcasts || status == "confirmed" {
            base = BadgeColor(background: blue.opacity(0.15), foreground: blue)
        } else {
            base = BadgeColor(background: Color.gray.opacity(0.15), foreground: Color.gray)
        }
        return highContrast ? highContrastBadgeColor(background: base.background, foreground: base.foreground, highContrast: true) : base
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
