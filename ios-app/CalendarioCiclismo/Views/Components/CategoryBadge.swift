import SwiftUI

/// Badge de categoría UCI: "1.UWT", "WC", "1.Pro", etc.
struct CategoryBadge: View {
    let category: String?
    @Environment(\.accessibilityShowButtonShapes) private var showButtonShapes

    private var isHighContrast: Bool { showButtonShapes }

    var body: some View {
        if let cat = category, !cat.isEmpty {
            let colors = AppTheme.categoryBadgeColor(for: cat, highContrast: isHighContrast)
            Text(cat)
                .ccFont(.s12, weight: .semibold)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(colors.background)
                .foregroundStyle(colors.foreground)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
                .overlay(
                    isHighContrast
                        ? RoundedRectangle(cornerRadius: AppTheme.Radius.control).strokeBorder(colors.foreground, lineWidth: 1)
                        : nil
                )
                .accessibilityLabel(AccessibilityCategoryLabel.description(for: cat) ?? cat)
                .accessibilityIdentifier(AccessibilityID.filterButton("cat_\(cat)"))
        }
    }
}
