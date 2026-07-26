import SwiftUI

/// Vista de estado de carga.
struct LoadingView: View {
    var message: String = "Cargando..."
    var branded: Bool = false

    var body: some View {
        Group {
            if branded {
                // En los cargadores de pantalla completa el perfil replica el
                // comportamiento de la web: ocupa todo el ancho y descansa en
                // el borde inferior, en lugar de quedar centrado con el texto.
                VStack(spacing: 0) {
                    // Bloques independientes: la identidad se centra en el
                    // espacio disponible y el perfil ocupa su propia franja
                    // inferior, sin poder pasar por detrás de ella.
                    VStack(spacing: 0) {
                        BrandedLogoView()
                            .padding(.bottom, 12)
                        Text(message)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        PulsingDotsView()
                            .padding(.top, 10)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    AnimatedRouteProfile()
                        .frame(maxWidth: .infinity)
                        .frame(height: 150)
                }
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.regular)
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(message)
    }
}

/// Perfil de carga compartido por los estados de espera y el splash propio.
/// No representa una carrera concreta y se genera localmente, sin red.
struct AnimatedRouteProfile: View {
    var lineColor: Color = .accentColor
    var fillColor: Color? = nil
    var riderColor: Color? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let points: [CGPoint] = [
        CGPoint(x: 0, y: 0.78), CGPoint(x: 0.06, y: 0.74), CGPoint(x: 0.14, y: 0.66),
        CGPoint(x: 0.22, y: 0.72), CGPoint(x: 0.31, y: 0.48), CGPoint(x: 0.40, y: 0.36),
        CGPoint(x: 0.48, y: 0.58), CGPoint(x: 0.58, y: 0.70), CGPoint(x: 0.66, y: 0.44),
        CGPoint(x: 0.74, y: 0.24), CGPoint(x: 0.81, y: 0.38), CGPoint(x: 0.88, y: 0.20),
        CGPoint(x: 0.94, y: 0.46), CGPoint(x: 1, y: 0.34),
    ]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: reduceMotion)) { context in
            let cycle = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.6)
            let progress = reduceMotion ? 1.0 : cycle / 2.6
            Canvas { graphics, size in
                let scaled = points.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
                guard let first = scaled.first else { return }
                var profile = Path()
                profile.move(to: first)
                for point in scaled.dropFirst() { profile.addLine(to: point) }

                var fill = profile
                fill.addLine(to: CGPoint(x: size.width, y: size.height))
                fill.addLine(to: CGPoint(x: 0, y: size.height))
                fill.closeSubpath()
                graphics.fill(fill, with: .color(fillColor ?? lineColor.opacity(0.12)))

                graphics.clip(to: Path(CGRect(x: 0, y: 0, width: size.width * progress, height: size.height)))
                graphics.stroke(profile, with: .color(lineColor), lineWidth: 3)

                guard !reduceMotion else { return }
                let rider = point(at: progress, in: scaled)
                graphics.fill(Path(ellipseIn: CGRect(x: rider.x - 6, y: rider.y - 6, width: 12, height: 12)), with: .color(riderColor ?? lineColor))
                graphics.fill(Path(ellipseIn: CGRect(x: rider.x - 2, y: rider.y - 2, width: 4, height: 4)), with: .color(.white.opacity(0.92)))
            }
        }
        .accessibilityHidden(true)
    }

    private func point(at progress: Double, in points: [CGPoint]) -> CGPoint {
        let x = max(0, min(1, progress)) * (points.last?.x ?? 0)
        let end = max(1, points.firstIndex(where: { $0.x >= x }) ?? points.count - 1)
        let start = points[end - 1]
        let finish = points[end]
        let fraction = max(0, min(1, (x - start.x) / (finish.x - start.x)))
        return CGPoint(x: x, y: start.y + (finish.y - start.y) * fraction)
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
