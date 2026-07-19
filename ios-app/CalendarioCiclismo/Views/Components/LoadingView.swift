import SwiftUI

/// Vista de estado de carga.
struct LoadingView: View {
    var message: String = "Cargando..."
    var branded: Bool = false

    var body: some View {
        VStack(spacing: branded ? 16 : 12) {
            if branded {
                BrandedLogoView()
            } else {
                ProgressView()
                    .controlSize(.regular)
            }
            Text(message)
                .font(branded ? .subheadline.weight(.semibold) : .subheadline)
                .foregroundStyle(branded ? .primary : .secondary)
            if branded {
                PulsingDotsView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(message)
    }
}

/// Logo de la app con iconos de calendario y ciclista.
struct BrandedLogoView: View {
    @ScaledMetric(relativeTo: .title) private var calendarSize: CGFloat = 28
    @ScaledMetric(relativeTo: .title) private var cyclistSize: CGFloat = 32

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "calendar")
                .font(.system(size: calendarSize))
            Image(systemName: "figure.outdoor.cycle")
                .font(.system(size: cyclistSize))
        }
        .foregroundStyle(Color.accentColor)
        .accessibilityHidden(true)
    }
}

/// Tres puntos pulsantes animados.
struct PulsingDotsView: View {
    @State private var animating = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 6, height: 6)
                    // Animación ACOTADA a escala/opacidad (animation(_:body:)).
                    // Con `.animation(value:)` a secas, el repeatForever también
                    // animaba la POSICIÓN cuando la vista se recolocaba (cambio
                    // de pestaña / swap loading→contenido) → los puntos volaban
                    // cruzándose por el medio de la pantalla.
                    .animation(
                        reduceMotion ? nil :
                            .easeInOut(duration: 0.6)
                                .repeatForever(autoreverses: true)
                                .delay(Double(i) * 0.2)
                    ) { content in
                        content
                            .scaleEffect(animating ? 1.3 : 1.0)
                            .opacity(animating ? 1.0 : 0.3)
                    }
            }
        }
        .accessibilityHidden(true)
        .onAppear { animating = true }
    }
}

/// Vista de estado vacío.
struct EmptyStateView: View {
    let icon: String
    let title: String
    let subtitle: String?
    @ScaledMetric(relativeTo: .largeTitle) private var iconSize: CGFloat = 40

    init(icon: String = "calendar", title: String, subtitle: String? = nil) {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: iconSize))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .accessibilityElement(children: .combine)
    }
}

/// Vista de error con opción de reintentar.
struct ErrorView: View {
    let message: String
    let retry: (() -> Void)?
    @ScaledMetric(relativeTo: .largeTitle) private var iconSize: CGFloat = 40

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: iconSize))
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            Text("Error")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let retry {
                Button("Reintentar") { retry() }
                    .buttonStyle(.bordered)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .accessibilityElement(children: .combine)
    }
}
