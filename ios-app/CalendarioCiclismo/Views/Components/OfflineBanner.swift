import SwiftUI

/// Banner sutil que indica que los datos mostrados provienen de la caché offline.
struct OfflineBanner: View {
    let ageLabel: String?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "icloud.slash")
                .font(.caption2)
            Text("Sin conexión")
                .ccFont(.s12, weight: .medium)
            if let ageLabel {
                Text("·")
                    .ccFont(.s12)
                Text(ageLabel)
                    .ccFont(.s12)
            }
        }
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity)
        .background(Color(.tertiarySystemBackground))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Datos offline\(ageLabel.map { ", \($0)" } ?? "")")
    }
}
