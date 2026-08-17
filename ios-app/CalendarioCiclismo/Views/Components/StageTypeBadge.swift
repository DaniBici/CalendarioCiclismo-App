import SwiftUI

/// Badge de tipo de etapa: "Llana", "Alta montaña", "CRI", etc.
struct StageTypeBadge: View {
    let primaryType: String?
    let secondaryType: String?
    var countryCode: String? = nil
    var compact: Bool = false
    @Environment(\.accessibilityShowButtonShapes) private var showButtonShapes

    private var isHighContrast: Bool { showButtonShapes }

    var body: some View {
        if let primary = primaryType, !primary.isEmpty {
            let label = RaceLogic.resolveTypeLabel(primary: primary, secondary: secondaryType, countryCode: countryCode)
            let resolvedColorType = resolveColorType(primary: primary, secondary: secondaryType)
            let colors = AppTheme.stageTypeBadgeColor(for: resolvedColorType, highContrast: isHighContrast)

            Text(label)
            .font(compact ? .system(size: 9) : .caption2)
            .fontWeight(.medium)
            .textCase(.uppercase)
            .padding(.horizontal, compact ? 6 : 8)
            .padding(.vertical, compact ? 1 : 3)
            .background(colors.background)
            .foregroundStyle(colors.foreground)
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .overlay(
                isHighContrast
                    ? RoundedRectangle(cornerRadius: 3).strokeBorder(colors.foreground, lineWidth: 1)
                    : nil
            )
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(AccessibilityStageType.description(primary: primary, secondary: secondaryType) ?? label)
        }
    }

    /// Resuelve el tipo de color: monopuerto (flat+summit_finish) y
    /// cronoescalada (itt+chrono_climb) usan colores especiales.
    private func resolveColorType(primary: String, secondary: String?) -> String {
        if primary == "flat" && secondary == "summit_finish" { return "high_mountain" }
        if primary == "itt" && (secondary == "chrono_climb" || secondary == "summit_finish") { return "chrono_climb" }
        return primary
    }
}
