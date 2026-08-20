import SwiftUI

/// Mini-perfil de elevación compacto para racecards de "Hoy".
///
/// Renderiza la silueta de altimetría más un set de indicadores circulares
/// (summits + waypoints de tipo sprint, bonificación, punto intermedio,
/// pavé y sterrato) sobre la curva.
///
/// Escala Y idéntica a `buildElevationSparkline` de la web:
/// `padding = max(100, 300 - range·0.1)`, `yMin = max(0, minAlt - padding)`,
/// `yMax = maxAlt + padding`. Esta referencia común evita que las apps
/// exageren el relieve en comparación con la web.
///
/// La silueta usa toda la altura del Canvas (padding mínimo de 1pt arriba y
/// abajo). Los indicadores se clampan dentro del Canvas para no cortarse
/// contra los bordes — su centro puede quedar ligeramente por encima o
/// por debajo de la curva si esta pasa muy cerca del borde.
struct MiniElevationProfile: View {
    let profile: ElevationProfile
    /// Summits a marcar sobre la curva (un círculo rojo con la categoría).
    var summits: [ProfileSummit] = []
    /// Waypoints a marcar sobre la curva (sprint, bonif., split, pavé, sterrato).
    /// Tipos no soportados se ignoran silenciosamente.
    var waypoints: [ProfileWaypoint] = []
    /// Color principal del trazado.
    var tint: Color = .accentColor
    /// Altura del Canvas. La anchura se adapta al contenedor.
    var height: CGFloat = 26
    /// Tipo primario de la etapa. Se conserva por compatibilidad de llamadas;
    /// la escala vertical es común para todos los tipos, igual que en la web.
    var primaryType: String? = nil
    /// Hora de salida (neutralizada). Junto con `endTime` activa el relleno
    /// temporal: la silueta se pinta gris y se tiñe de izquierda a derecha según
    /// el % de tiempo transcurrido entre salida y llegada (paridad con la web).
    var startTime: Date? = nil
    /// Hora estimada de llegada.
    var endTime: Date? = nil
    /// CRI/CRE: el reloj de pelotón no representa un avance único → sin relleno.
    var isTimeTrial: Bool = false
    /// En Competición, una crono sin horario usa el mismo fallback teñido que
    /// una jornada en línea. Hoy mantiene el gris actual por defecto.
    var usesLineFallbackWithoutTimeTrialSchedule: Bool = false
    /// Fuerza el perfil completado cuando la tarjeta ya está en modo resultados
    /// o Revive. Tiene prioridad sobre el caso CRI/CRE, que en directo se queda
    /// intencionadamente al 0%.
    var forceCompleted: Bool = false

    /// Radio del círculo del indicador en px. `nonisolated` para que el closure
    /// del `Canvas` (que se ejecuta fuera del MainActor en Swift 6) pueda leerla
    /// sin warnings.
    nonisolated static let indicatorRadius: CGFloat = 6
    /// Color neutro de la porción aún "no recorrida" cuando se muestra progreso.
    nonisolated static let progressBaseColor = Color(white: 0.6)

    var body: some View {
        Group {
            if forceCompleted {
                profileCanvas(progress: 1)
            } else if isTimeTrial, !usesLineFallbackWithoutTimeTrialSchedule || (startTime != nil && endTime != nil) {
                // CRI/CRE: siempre 0% (silueta gris, sin teñir). Cada corredor o
                // equipo sale en un momento distinto, así que un único reloj de
                // salida→llegada no representa el avance. Competición usa el
                // fallback de línea cuando aún no hay intervalo horario.
                profileCanvas(progress: 0)
            } else if let start = startTime, let end = endTime, end > start {
                // Auto-refresco cada 60 s mientras la etapa está en curso, para
                // que el relleno avance (paridad con `_updateProgressCards` web).
                TimelineView(.periodic(from: Date(), by: 60)) { context in
                    profileCanvas(progress: progressFraction(now: context.date, start: start, end: end))
                }
            } else {
                profileCanvas(progress: nil)
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }

    /// Fracción [0,1] de etapa transcurrida. Antes de la salida → 0 (gris);
    /// tras la llegada → 1 (teñido completo).
    private func progressFraction(now: Date, start: Date, end: Date) -> Double {
        let total = end.timeIntervalSince(start)
        guard total > 0 else { return 0 }
        return min(1, max(0, now.timeIntervalSince(start) / total))
    }

    /// Dibuja la silueta. `progress == nil` → tinte completo (aspecto clásico);
    /// `progress != nil` → base gris + porción teñida recortada al avance.
    private func profileCanvas(progress: Double?) -> some View {
        Canvas { ctx, size in
            guard profile.points.count >= 2 else { return }

            let xs = profile.points.map { $0.km }
            guard let xMin = xs.min(), let xMax = xs.max(), xMax > xMin else { return }

            // La silueta llega a sangre por el ancho [0, width]. Un mínimo de
            // padding superior evita que el trazo del pico se recorte arriba.
            // `bottomPad` eleva la BASELINE de la curva: el valor más bajo de la
            // silueta no se aplasta contra el borde, sino que se mantiene a
            // `bottomPad` del fondo. El relleno (fill) SÍ baja hasta el borde
            // inferior real (suelo de color hasta el borde, sin hueco). Los
            // indicadores tienen su propio clamp (no encogen la silueta).
            let topPad: CGFloat = 1
            let bottomPad: CGFloat = 3
            let plotW = max(1, size.width)
            let plotH = max(1, size.height - topPad - bottomPad)

            let minAlt = profile.minElevation.map(Double.init)
                ?? (profile.points.map { Double($0.alt) }.min() ?? 0)
            let maxAlt = profile.maxElevation.map(Double.init)
                ?? (profile.points.map { Double($0.alt) }.max() ?? 1000)
            // Misma escala que el miniperfil web, para todos los tipos de etapa.
            let range = maxAlt - minAlt
            let padding = max(100, 300 - range * 0.1)
            let yMin = max(0, minAlt - padding)
            let yMax = maxAlt + padding
            let yRange = max(yMax - yMin, 1)

            func project(km: Double, alt: Double) -> CGPoint {
                let xRatio = (km - xMin) / (xMax - xMin)
                let yRatio = (alt - yMin) / yRange
                return CGPoint(
                    x: plotW * xRatio,
                    y: topPad + plotH * (1 - yRatio),
                )
            }

            // Mantiene el centro del indicador dentro del Canvas para que el
            // círculo no se corte contra los bordes superior/inferior.
            func clampIndicator(_ pt: CGPoint) -> CGPoint {
                // La silueta llega a sangre, pero los círculos del indicador se
                // mantienen dentro del canvas para no recortarse contra los bordes.
                let r = Self.indicatorRadius + 1
                let clampedX = min(max(pt.x, r), size.width - r)
                let clampedY = min(max(pt.y, r), size.height - r)
                return CGPoint(x: clampedX, y: clampedY)
            }

            func point(at index: Int) -> CGPoint {
                let p = profile.points[index]
                return project(km: p.km, alt: Double(p.alt))
            }

            // Interpolación lineal sobre la polilínea — para colocar
            // indicadores cuya km caiga entre dos puntos del GPX.
            func interpAlt(at km: Double) -> Double {
                let pts = profile.points
                if km <= pts.first!.km { return Double(pts.first!.alt) }
                if km >= pts.last!.km  { return Double(pts.last!.alt) }
                for i in 0..<(pts.count - 1) {
                    let p0 = pts[i], p1 = pts[i + 1]
                    if km >= p0.km && km <= p1.km {
                        let span = p1.km - p0.km
                        if span <= 0 { return Double(p0.alt) }
                        let t = (km - p0.km) / span
                        return Double(p0.alt) + t * Double(p1.alt - p0.alt)
                    }
                }
                return Double(pts.last!.alt)
            }

            // Fill area bajo la curva. El relleno cierra en el borde inferior
            // real (`size.height`), no en la baseline de la curva, de modo que
            // la franja de `bottomPad` queda como suelo de color hasta el borde.
            var fillPath = Path()
            let firstPt = point(at: 0)
            let baseY = size.height
            fillPath.move(to: CGPoint(x: firstPt.x, y: baseY))
            fillPath.addLine(to: firstPt)
            for i in 1..<profile.points.count {
                fillPath.addLine(to: point(at: i))
            }
            let lastPt = point(at: profile.points.count - 1)
            fillPath.addLine(to: CGPoint(x: lastPt.x, y: baseY))
            fillPath.closeSubpath()
            // Trazo principal.
            var strokePath = Path()
            strokePath.move(to: firstPt)
            for i in 1..<profile.points.count {
                strokePath.addLine(to: point(at: i))
            }

            let lineStyle = StrokeStyle(lineWidth: 1.2, lineJoin: .round)
            if let progress {
                // Base gris (silueta completa) + porción teñida recortada al
                // % transcurrido: el relleno avanza de izquierda a derecha.
                ctx.fill(fillPath, with: .color(Self.progressBaseColor.opacity(0.28)))
                ctx.stroke(strokePath, with: .color(Self.progressBaseColor.opacity(0.5)), style: lineStyle)
                var tinted = ctx
                tinted.clip(to: Path(CGRect(x: 0, y: 0, width: size.width * CGFloat(progress), height: size.height)))
                tinted.fill(fillPath, with: .color(tint.opacity(0.20)))
                tinted.stroke(strokePath, with: .color(tint.opacity(0.95)), style: lineStyle)
            } else {
                ctx.fill(fillPath, with: .color(tint.opacity(0.15)))
                ctx.stroke(strokePath, with: .color(tint.opacity(0.85)), style: lineStyle)
            }

            // Indicadores: summits primero (los círculos más grandes/visibles),
            // luego waypoints. Si dos cmd caen exactamente en el mismo punto
            // priorizamos el summit por orden de dibujo. El centro se clampa
            // dentro del Canvas para evitar que los círculos se corten cuando
            // la curva pasa muy cerca del borde superior o inferior.
            for summit in summits {
                guard let rawKm = summit.km,
                      let km = clamp(rawKm, xMin, xMax) else { continue }
                let alt = interpAlt(at: km)
                let center = clampIndicator(project(km: km, alt: alt))
                Self.drawSummitIndicator(in: ctx, center: center,
                                        radius: Self.indicatorRadius,
                                        category: summit.category)
            }
            for wp in waypoints {
                guard Self.isSupportedWaypoint(wp.type) else { continue }
                guard let rawKm = wp.km,
                      let km = clamp(rawKm, xMin, xMax) else { continue }
                let alt = interpAlt(at: km)
                let center = clampIndicator(project(km: km, alt: alt))
                Self.drawWaypointIndicator(in: ctx, center: center,
                                          radius: Self.indicatorRadius,
                                          type: wp.type)
            }
        }
    }

    private func clamp(_ value: Double, _ lo: Double, _ hi: Double) -> Double? {
        guard hi > lo else { return nil }
        if value < lo || value > hi { return nil }
        return value
    }

    // MARK: - Indicator drawing

    /// Tipos de waypoint que se renderizan en el mini-perfil. `town` se
    /// excluye porque en la web es un triángulo decorativo y satura demasiado
    /// el espacio de 22-26 px de alto.
    nonisolated static func isSupportedWaypoint(_ type: String) -> Bool {
        switch type {
        case "intermediate_sprint", "bonus_sprint", "intermediate_split",
             "cobblestone", "sterrato":
            return true
        default:
            return false
        }
    }

    /// Color del círculo según el tipo. Espejo de `indicatorColor()` de
    /// `js/elevation-profile.js`.
    nonisolated static func waypointColor(_ type: String) -> Color {
        switch type {
        case "bonus_sprint":         return Color(red: 0.976, green: 0.671, blue: 0.0)   // #f9ab00
        case "intermediate_sprint":  return Color(red: 0.059, green: 0.616, blue: 0.345) // #0f9d58
        case "intermediate_split":   return Color(red: 0.0,   green: 0.514, blue: 0.561) // #00838f
        case "cobblestone":          return Color(red: 0.690, green: 0.690, blue: 0.690) // #b0b0b0
        case "sterrato":             return Color(red: 0.784, green: 0.659, blue: 0.439) // #c8a870
        default:                     return Color(red: 0.557, green: 0.565, blue: 0.600) // #8e9099
        }
    }

    nonisolated static let summitColor = Color(red: 0.773, green: 0.188, blue: 0.188) // #c53030

    /// Dibuja el círculo coloreado de un summit con la categoría en el
    /// centro. Categorías 'M' o nulas pintan el ideograma de montaña.
    nonisolated static func drawSummitIndicator(in ctx: GraphicsContext, center: CGPoint,
                                                radius: CGFloat, category: String?) {
        let circle = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius,
                                            width: radius * 2, height: radius * 2))
        ctx.fill(circle, with: .color(summitColor))
        ctx.stroke(circle, with: .color(.white), lineWidth: 0.8)

        let glyph: String
        if let cat = category, !cat.isEmpty, cat != "M" {
            glyph = cat
        } else {
            glyph = "▲"
        }
        let fontSize: CGFloat = glyph.count >= 2 ? radius * 0.95 : radius * 1.25
        let text = Text(glyph)
            .font(.system(size: fontSize, weight: .heavy, design: .rounded))
            .foregroundColor(.white)
        ctx.draw(text, at: center, anchor: .center)
    }

    /// Dibuja un waypoint según su tipo. Sprint/bonificación → letra;
    /// punto intermedio → símbolo de reloj; pavé/sterrato → glifo.
    nonisolated static func drawWaypointIndicator(in ctx: GraphicsContext, center: CGPoint,
                                                  radius: CGFloat, type: String) {
        let color = waypointColor(type)
        let circle = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius,
                                            width: radius * 2, height: radius * 2))
        ctx.fill(circle, with: .color(color))
        ctx.stroke(circle, with: .color(.white), lineWidth: 0.8)

        switch type {
        case "intermediate_sprint":
            let text = Text("S")
                .font(.system(size: radius * 1.25, weight: .heavy, design: .rounded))
                .foregroundColor(.white)
            ctx.draw(text, at: center, anchor: .center)
        case "bonus_sprint":
            let text = Text("B")
                .font(.system(size: radius * 1.25, weight: .heavy, design: .rounded))
                .foregroundColor(.black)
            ctx.draw(text, at: center, anchor: .center)
        case "intermediate_split":
            let text = Text("⏱")
                .font(.system(size: radius * 1.15, weight: .bold))
                .foregroundColor(.white)
            ctx.draw(text, at: center, anchor: .center)
        case "cobblestone":
            let text = Text("◆")
                .font(.system(size: radius * 1.15, weight: .heavy))
                .foregroundColor(.white)
            ctx.draw(text, at: center, anchor: .center)
        case "sterrato":
            let text = Text("●")
                .font(.system(size: radius * 0.9, weight: .heavy))
                .foregroundColor(.white)
            ctx.draw(text, at: center, anchor: .center)
        default:
            break
        }
    }
}
