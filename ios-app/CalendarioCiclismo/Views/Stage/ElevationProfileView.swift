import SwiftUI
import UIKit.UIGestureRecognizerSubclass

// MARK: - Profile color contrast

/// Ajusta el color identificativo de una carrera solo cuando no alcanza el
/// contraste mínimo para elementos gráficos sobre la tarjeta del perfil.
enum ProfileColorContrast {
    static let minimumRatio = 3.0

    struct RGB: Equatable {
        let red: Double
        let green: Double
        let blue: Double

        fileprivate var relativeLuminance: Double {
            func linear(_ component: Double) -> Double {
                component <= 0.04045
                    ? component / 12.92
                    : pow((component + 0.055) / 1.055, 2.4)
            }

            return 0.2126 * linear(red)
                + 0.7152 * linear(green)
                + 0.0722 * linear(blue)
        }
    }

    static func contrastRatio(_ first: RGB, _ second: RGB) -> Double {
        let lighter = max(first.relativeLuminance, second.relativeLuminance)
        let darker = min(first.relativeLuminance, second.relativeLuminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    static func adjustedRGB(
        _ foreground: RGB,
        background: RGB,
        minimumRatio: Double = minimumRatio
    ) -> RGB {
        guard contrastRatio(foreground, background) < minimumRatio else {
            return foreground
        }

        // En claro se oscurece; en oscuro se aclara. Una búsqueda binaria
        // obtiene el cambio mínimo que cumple el umbral y conserva el matiz.
        let target = background.relativeLuminance > 0.5
            ? RGB(red: 0, green: 0, blue: 0)
            : RGB(red: 1, green: 1, blue: 1)
        var lowerBound = 0.0
        var upperBound = 1.0

        for _ in 0..<24 {
            let amount = (lowerBound + upperBound) / 2
            let candidate = mix(foreground, toward: target, amount: amount)
            if contrastRatio(candidate, background) >= minimumRatio {
                upperBound = amount
            } else {
                lowerBound = amount
            }
        }

        return mix(foreground, toward: target, amount: upperBound)
    }

    static func adjusted(_ color: Color, for colorScheme: ColorScheme) -> Color {
        let interfaceStyle: UIUserInterfaceStyle = colorScheme == .dark ? .dark : .light
        let traits = UITraitCollection(userInterfaceStyle: interfaceStyle)
        let resolved = UIColor(color).resolvedColor(with: traits)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0

        guard resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            return color
        }

        let background = colorScheme == .dark
            ? RGB(red: 30 / 255, green: 38 / 255, blue: 50 / 255)
            : RGB(red: 250 / 255, green: 251 / 255, blue: 252 / 255)
        let adjusted = adjustedRGB(
            RGB(red: Double(red), green: Double(green), blue: Double(blue)),
            background: background
        )
        return Color(
            red: adjusted.red,
            green: adjusted.green,
            blue: adjusted.blue,
            opacity: Double(alpha)
        )
    }

    private static func mix(_ color: RGB, toward target: RGB, amount: Double) -> RGB {
        RGB(
            red: color.red + (target.red - color.red) * amount,
            green: color.green + (target.green - color.green) * amount,
            blue: color.blue + (target.blue - color.blue) * amount
        )
    }
}

// MARK: - Color helpers

private extension Color {
    static let summitRed   = Color(hex: "c53030")
    static let finishRed   = Color(hex: "e63d3d")
    static let bonusSprint = Color(hex: "f9ab00")
    static let intSprint   = Color(hex: "0f9d58")
    static let intSplit    = Color(hex: "00838f")
    static let cobblestone = Color(hex: "8c8c8c")
    static let sterratoTan = Color(hex: "c4975a")
}

// MARK: - Marker model

private struct ChartMarker: Identifiable {
    enum Source {
        case summit(ProfileSummit)
        case waypoint(ProfileWaypoint)
        case combined(ProfileSummit, ProfileWaypoint)
    }
    let id: String
    let km: Double
    let source: Source
    let finishCompanion: Bool

    init(id: String, km: Double, source: Source, finishCompanion: Bool = false) {
        self.id = id
        self.km = km
        self.source = source
        self.finishCompanion = finishCompanion
    }

    var kind: String {
        switch source {
        case .summit, .combined: return "summit"
        case .waypoint(let wp): return wp.type
        }
    }

    var color: Color {
        switch source {
        case .summit, .combined: return .summitRed
        case .waypoint(let wp):
            switch wp.type {
            case "bonus_sprint":        return .bonusSprint
            case "intermediate_sprint": return .intSprint
            case "intermediate_split":  return .intSplit
            case "cobblestone":         return .cobblestone
            case "sterrato":            return .sterratoTan
            default:                    return .gray
            }
        }
    }

    var label: String {
        switch source {
        case .summit(let s), .combined(let s, _): return s.category ?? "?"
        case .waypoint(let wp):
            switch wp.type {
            case "bonus_sprint":        return "B"
            case "intermediate_sprint": return "S"
            case "intermediate_split":  return "⏱"
            case "cobblestone":         return "P"
            case "sterrato":            return "·"
            default:                    return "?"
            }
        }
    }

    var textColor: Color {
        if case .waypoint(let wp) = source, wp.type == "bonus_sprint" { return .black }
        return .white
    }

    var secondaryColor: Color? {
        if finishCompanion { return .finishRed }
        guard case .combined(_, let wp) = source else { return nil }
        return ChartMarker(id: "secondary", km: km, source: .waypoint(wp)).color
    }

    var secondaryLabel: String? {
        if finishCompanion { return "" }
        guard case .combined(_, let wp) = source else { return nil }
        return ChartMarker(id: "secondary", km: km, source: .waypoint(wp)).label
    }

    var secondaryKind: String? {
        if finishCompanion { return "finish" }
        guard case .combined(_, let wp) = source else { return nil }
        return wp.type
    }

    var secondaryTextColor: Color {
        if finishCompanion { return .white }
        guard case .combined(_, let wp) = source, wp.type == "bonus_sprint" else { return .white }
        return .black
    }

    var lengthKm: Double? {
        switch source {
        case .waypoint(let wp), .combined(_, let wp): return wp.lengthKm
        case .summit: return nil
        }
    }

    var name: String? {
        switch source {
        case .summit(let s), .combined(let s, _): return s.name
        case .waypoint(let wp): return wp.name
        }
    }

    var altitude: Int? {
        switch source {
        case .summit(let s), .combined(let s, _): return s.altitude
        case .waypoint: return nil
        }
    }

    var secondaryDescription: String? {
        if finishCompanion { return LocaleService.t("Meta", "Finish") }
        guard case .combined(_, let wp) = source else { return nil }
        if let name = wp.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        switch wp.type {
        case "bonus_sprint":        return LocaleService.t("Bonificación", "Bonus sprint")
        case "intermediate_sprint": return LocaleService.t("Sprint intermedio", "Intermediate sprint")
        case "intermediate_split":  return LocaleService.t("Punto intermedio", "Intermediate point")
        case "cobblestone":         return LocaleService.t("Pavé", "Cobbles")
        case "sterrato":            return LocaleService.t("Sterrato", "Gravel")
        default:                     return wp.type
        }
    }
}

// MARK: - Chart geometry helper

private struct ChartGeometry {
    let size: CGSize
    let ml: CGFloat = 50
    let mr: CGFloat = 8
    let mt: CGFloat = 14
    let mb: CGFloat = 24
    let totalDistance: Double
    let yMin: Double
    let yMax: Double

    var plotWidth:  CGFloat { size.width - ml - mr }
    var plotHeight: CGFloat { size.height - mt - mb }

    func x(for km: Double) -> CGFloat {
        ml + CGFloat(km / totalDistance) * plotWidth
    }

    func y(for alt: Double) -> CGFloat {
        let frac = (alt - yMin) / (yMax - yMin)
        return mt + plotHeight * CGFloat(1 - frac)
    }

    func km(for screenX: CGFloat) -> Double {
        let clamped = max(ml, min(ml + plotWidth, screenX))
        return Double((clamped - ml) / plotWidth) * totalDistance
    }

    func altitudeAt(km targetKm: Double, points: [ElevationPoint]) -> Double? {
        guard points.count >= 2 else { return nil }
        if let exact = points.first(where: { $0.km == targetKm }) {
            return Double(exact.alt)
        }
        guard let idx = points.firstIndex(where: { $0.km > targetKm }), idx > 0 else {
            return Double(points.last!.alt)
        }
        let p0 = points[idx - 1]
        let p1 = points[idx]
        let t = (targetKm - p0.km) / (p1.km - p0.km)
        return Double(p0.alt) + t * Double(p1.alt - p0.alt)
    }
}

// MARK: - Selección del perfil

/// Tramo marcado sobre el perfil, en cualquier sentido.
struct ProfileRange: Equatable {
    var a: Double
    var b: Double
    /// Nombre del puerto o del punto clave; sin nombre se lee «Tramo».
    var label: String?
}

/// Selección compartida entre el perfil interactivo, su lectura en la cabecera
/// del panel y Puntos clave. Espejo del estado de `mountStageProfile`
/// (`js/stage/profile.js`).
struct ProfileSelection: Equatable {
    /// Punto a la vista: el del puntero o el fijado.
    var pointKm: Double?
    /// Punto fijado con un toque o desde Puntos clave.
    var pinnedKm: Double?
    var range: ProfileRange?
    /// Fila de Puntos clave pulsada.
    var pressedRowID: String?
}

/// Alto común del perfil interactivo y del oficial: el panel no cambia de
/// tamaño al alternar. Espejo de `graphicHeight` (`js/stage/profile.js`).
struct ProfileGraphicLayout: Layout {
    static func height(forWidth width: CGFloat) -> CGFloat {
        max(264, min(400, width * 0.4))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let proposed = proposal.width ?? 320
        let width = proposed.isFinite ? proposed : 320
        return CGSize(width: width, height: Self.height(forWidth: width))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews {
            subview.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
        }
    }
}

/// Lectura del perfil en una sola línea de altura fija: el punto señalado
/// («88,2 km · 939 m») o el tramo marcado (nombre, distancia, desniveles y
/// pendiente media, con «Quitar»). Sin selección queda vacía.
struct ProfileReadout: View {
    let points: [ElevationPoint]
    @Binding var selection: ProfileSelection
    var alignment: Alignment = .leading

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            if let range = selection.range,
               let stats = ProfileSegment.stats(points: points, from: range.a, to: range.b, interpolateAlt: { ProfileSegment.interpolateAlt(points: points, km: $0) }) {
                Text(range.label ?? LocaleService.t("Tramo", "Section"))
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .truncationMode(.tail)
                Group {
                    Text("\(ProfileFormat.km(stats.distance)) km").fontWeight(.bold)
                    Text("+\(ProfileFormat.meters(stats.ascent)) m").fontWeight(.bold)
                    Text("\u{2212}\(ProfileFormat.meters(stats.descent)) m")
                    Text("\(ProfileFormat.gradient(stats.gradient)) %")
                    Button(LocaleService.t("Quitar", "Clear")) {
                        selection.range = nil
                        selection.pressedRowID = nil
                    }
                    .buttonStyle(.borderless)
                    .fontWeight(.semibold)
                }
                .fixedSize()
                .layoutPriority(1)
            } else if let km = selection.pointKm {
                let altitude = ProfileSegment.interpolateAlt(points: points, km: km)
                Text("\(ProfileFormat.km(km)) km · \(ProfileFormat.meters(altitude)) m")
                    .fontWeight(.bold)
            }
        }
        .ccFont(.s13)
        .monospacedDigit()
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: alignment)
        .frame(height: 24)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Chart Card

/// Perfil interactivo: arrastrar en horizontal mide un tramo, un toque fija un
/// punto y un doble toque sobre un puerto marca del pie a la cima. El tramo
/// conserva el color del perfil y el resto queda velado; no se rotula nada
/// sobre el gráfico (la lectura vive en la cabecera del panel).
struct ElevationChartCard: View {
    let profile: ElevationProfile
    let summits: [ProfileSummit]
    let waypoints: [ProfileWaypoint]
    var profileColor: Color = .accentColor
    @Binding var selection: ProfileSelection

    @Environment(\.colorScheme) private var colorScheme
    @State private var dragStartKm: Double?
    @State private var lastTapDate: Date?
    @State private var lastTapX: CGFloat = 0

    /// Zona de un puerto, del pie a la cima.
    private struct ClimbZone {
        let startKm: Double
        let endKm: Double
        let name: String?
    }

    private var visibleProfileColor: Color {
        ProfileColorContrast.adjusted(profileColor, for: colorScheme)
    }

    private var climbs: [ClimbZone] {
        summits.compactMap { summit in
            guard let km = summit.km, let start = summit.startKm, start < km else { return nil }
            let startKm = max(0, start)
            let endKm = min(km, profile.distance)
            guard endKm - startKm >= 0.05 else { return nil }
            let name = summit.name?.trimmingCharacters(in: .whitespacesAndNewlines)
            return ClimbZone(startKm: startKm, endKm: endKm, name: name?.isEmpty == false ? name : nil)
        }
    }

    private var markers: [ChartMarker] {
        var result: [ChartMarker] = []
        var remainingWaypoints = waypoints.filter { $0.type != "town" }
        var finishAvailable = true
        for s in summits {
            guard let km = s.km else { continue }
            if finishAvailable && km == profile.distance {
                result.append(ChartMarker(
                    id: "summit-finish-\(km)-\(s.name ?? "")",
                    km: km,
                    source: .summit(s),
                    finishCompanion: true
                ))
                finishAvailable = false
            } else if let companionIndex = remainingWaypoints.firstIndex(where: { $0.km == km }) {
                let companion = remainingWaypoints.remove(at: companionIndex)
                result.append(ChartMarker(
                    id: "combined-\(km)-\(s.name ?? "")-\(companion.type)",
                    km: km,
                    source: .combined(s, companion)
                ))
            } else {
                result.append(ChartMarker(id: "summit-\(km)-\(s.name ?? "")", km: km, source: .summit(s)))
            }
        }
        for wp in remainingWaypoints {
            guard let km = wp.km else { continue }
            let atFinish = finishAvailable && km == profile.distance
            result.append(ChartMarker(
                id: "wp-\(km)-\(wp.type)\(atFinish ? "-finish" : "")",
                km: km,
                source: .waypoint(wp),
                finishCompanion: atFinish
            ))
            if atFinish { finishAvailable = false }
        }
        return result
    }

    private func geometry(size: CGSize) -> ChartGeometry {
        let minAlt = profile.minElevation.map { Double($0) } ?? (profile.points.map { Double($0.alt) }.min() ?? 0)
        let maxAlt = profile.maxElevation.map { Double($0) } ?? (profile.points.map { Double($0.alt) }.max() ?? 1000)
        return ChartGeometry(
            size: size,
            totalDistance: profile.distance,
            yMin: max(0, minAlt - 150),
            yMax: max(1100, maxAlt + 200)
        )
    }

    // Grid step for Y axis
    private func yGridStep(yMin: Double, yMax: Double) -> Double {
        let range = yMax - yMin
        if range <= 500  { return 100 }
        if range <= 1500 { return 200 }
        return 500
    }

    // Grid step for X axis
    private func xGridStep() -> Double {
        let d = profile.distance
        if d <= 60  { return 10 }
        if d <= 150 { return 20 }
        return 30
    }

    var body: some View {
        GeometryReader { geo in
            let g = geometry(size: geo.size)
            Canvas { ctx, _ in
                drawChart(ctx: &ctx, g: g)
            }
            .contentShape(Rectangle())
            .gesture(ProfileTouchGesture { event in
                handle(event, g: g)
            })
            .onContinuousHover { phase in
                // Puntero (iPad): el punto sigue al puntero; al salir queda el
                // fijado. Con un tramo marcado, el puntero no lo sustituye.
                guard dragStartKm == nil, selection.range == nil else { return }
                switch phase {
                case .active(let location):
                    selection.pointKm = g.km(for: location.x)
                    selection.pressedRowID = nil
                case .ended:
                    selection.pointKm = selection.pinnedKm
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LocaleService.t("Perfil interactivo", "Interactive profile"))
        .accessibilityValue(accessibilityCursorValue)
        .accessibilityHint(LocaleService.t(
            "Desliza hacia arriba o abajo para consultar distancia y altitud",
            "Swipe up or down to explore distance and altitude"
        ))
        .accessibilityAdjustableAction { direction in
            let current = selection.pinnedKm ?? 0
            let next: Double
            switch direction {
            case .increment: next = min(profile.distance, current + 1)
            case .decrement: next = max(0, current - 1)
            @unknown default: return
            }
            selection.range = nil
            selection.pressedRowID = nil
            selection.pinnedKm = next
            selection.pointKm = next
        }
    }

    private var accessibilityCursorValue: String {
        let km = selection.pointKm ?? 0
        let altitude = ProfileSegment.interpolateAlt(points: profile.points, km: km)
        return "\(ProfileFormat.km(km)) km · \(ProfileFormat.meters(altitude)) m"
    }

    // MARK: Gestos

    private func handle(_ event: ProfileTouchGesture.Event, g: ChartGeometry) {
        switch event {
        case .tap(let location):
            let km = g.km(for: location.x)
            let now = Date()
            // Doble toque sobre un puerto: su tramo, del pie a la cima. El
            // primer toque ya ha fijado el punto, como el doble clic de la web.
            if let last = lastTapDate, now.timeIntervalSince(last) < 0.35, abs(lastTapX - location.x) < 24,
               let climb = climbs.first(where: { km >= $0.startKm && km <= $0.endKm }) {
                lastTapDate = nil
                setRange(climb.startKm, climb.endKm, label: climb.name ?? LocaleService.t("Puerto", "Climb"))
                return
            }
            lastTapDate = now
            lastTapX = location.x
            selection.range = nil
            selection.pressedRowID = nil
            selection.pinnedKm = km
            selection.pointKm = km
        case .dragBegan(let start, let current):
            let startKm = g.km(for: start.x)
            dragStartKm = startKm
            lastTapDate = nil
            setRange(startKm, g.km(for: current.x), label: nil)
        case .dragChanged(let current):
            guard let startKm = dragStartKm else { return }
            setRange(startKm, g.km(for: current.x), label: nil)
        case .dragEnded:
            dragStartKm = nil
            if selection.range != nil { Haptics.play(.selection) }
        case .dragCancelled:
            dragStartKm = nil
        }
    }

    private func setRange(_ a: Double, _ b: Double, label: String?) {
        guard ProfileSegment.stats(points: profile.points, from: a, to: b, interpolateAlt: { ProfileSegment.interpolateAlt(points: profile.points, km: $0) }) != nil else { return }
        selection.range = ProfileRange(a: a, b: b, label: label)
        selection.pressedRowID = nil
    }

    // MARK: Canvas drawing

    private func drawChart(ctx: inout GraphicsContext, g: ChartGeometry) {
        let pts = profile.points
        guard pts.count >= 2 else { return }

        // Grid Y
        let yStep = yGridStep(yMin: g.yMin, yMax: g.yMax)
        let firstY = ceil(g.yMin / yStep) * yStep
        var yVal = firstY
        while yVal <= g.yMax {
            let yPos = g.y(for: yVal)
            var gridPath = Path()
            gridPath.move(to: CGPoint(x: g.ml, y: yPos))
            gridPath.addLine(to: CGPoint(x: g.ml + g.plotWidth, y: yPos))
            ctx.stroke(gridPath, with: .color(.secondary.opacity(0.2)),
                       style: StrokeStyle(lineWidth: 0.5, dash: [4, 4]))

            ctx.draw(
                Text("\(ProfileFormat.meters(yVal)) m").font(.system(size: 12)).foregroundStyle(Color.secondary),
                at: CGPoint(x: g.ml - 4, y: yPos),
                anchor: .trailing
            )
            yVal += yStep
        }

        // Grid X
        let xStep = xGridStep()
        var xVal = xStep
        while xVal < profile.distance - xStep * 0.3 {
            let xPos = g.x(for: xVal)
            var gridPath = Path()
            gridPath.move(to: CGPoint(x: xPos, y: g.mt))
            gridPath.addLine(to: CGPoint(x: xPos, y: g.mt + g.plotHeight))
            ctx.stroke(gridPath, with: .color(.secondary.opacity(0.2)),
                       style: StrokeStyle(lineWidth: 0.5, dash: [4, 4]))

            ctx.draw(
                Text(formatKmInt(xVal)).font(.system(size: 12)).foregroundStyle(Color.secondary),
                at: CGPoint(x: xPos, y: g.mt + g.plotHeight + 12),
                anchor: .center
            )
            xVal += xStep
        }

        // Relleno y línea del perfil. Las zonas de puerto no se sombrean: un
        // puerto se distingue al seleccionarlo.
        var fillPath = Path()
        let startPt = CGPoint(x: g.x(for: pts[0].km), y: g.y(for: Double(pts[0].alt)))
        fillPath.move(to: CGPoint(x: startPt.x, y: g.mt + g.plotHeight))
        fillPath.addLine(to: startPt)
        for pt in pts.dropFirst() {
            fillPath.addLine(to: CGPoint(x: g.x(for: pt.km), y: g.y(for: Double(pt.alt))))
        }
        let lastX = g.x(for: pts.last!.km)
        fillPath.addLine(to: CGPoint(x: lastX, y: g.mt + g.plotHeight))
        fillPath.closeSubpath()

        ctx.fill(fillPath, with: .color(visibleProfileColor.opacity(0.30)))

        var linePath = Path()
        linePath.move(to: startPt)
        for pt in pts.dropFirst() {
            linePath.addLine(to: CGPoint(x: g.x(for: pt.km), y: g.y(for: Double(pt.alt))))
        }
        ctx.stroke(linePath, with: .color(visibleProfileColor), style: StrokeStyle(lineWidth: 1.5))

        // Pavé/sterrato colored segments (those with lengthKm > 0)
        let segmentWaypoints = waypoints.filter { ($0.lengthKm ?? 0) > 0 && $0.km != nil }
        for wp in segmentWaypoints {
            guard let wpKm = wp.km else { continue }
            let segColor: Color = wp.type == "sterrato" ? .sterratoTan : .cobblestone
            let endKm = wpKm + (wp.lengthKm ?? 0)
            let segPts = profile.points.filter { $0.km >= wpKm && $0.km <= endKm }
            guard !segPts.isEmpty else { continue }

            var segPath = Path()
            let firstSegPt = CGPoint(x: g.x(for: segPts[0].km), y: g.y(for: Double(segPts[0].alt)))
            segPath.move(to: firstSegPt)
            for sp in segPts.dropFirst() {
                segPath.addLine(to: CGPoint(x: g.x(for: sp.km), y: g.y(for: Double(sp.alt))))
            }
            ctx.stroke(segPath, with: .color(segColor), style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
        }

        // Vertical guide lines for all markers
        for marker in markers {
            let xPos = g.x(for: marker.km)
            var guidePath = Path()
            guidePath.move(to: CGPoint(x: xPos, y: g.mt))
            guidePath.addLine(to: CGPoint(x: xPos, y: g.mt + g.plotHeight))
            ctx.stroke(guidePath, with: .color(marker.color.opacity(0.35)),
                       style: StrokeStyle(lineWidth: 0.75, dash: [3, 3]))
        }

        // Marker circles
        let markerRadius: CGFloat = 8
        for marker in markers {
            let alt = ProfileSegment.interpolateAlt(points: pts, km: marker.km)
            let cx = g.x(for: marker.km)
            let cy = g.y(for: alt)
            var badges: [(color: Color, label: String, textColor: Color, kind: String)] = [
                (marker.color, marker.label, marker.textColor, marker.kind)
            ]
            if let secondaryColor = marker.secondaryColor,
               let secondaryLabel = marker.secondaryLabel,
               let secondaryKind = marker.secondaryKind {
                badges.append((secondaryColor, secondaryLabel, marker.secondaryTextColor, secondaryKind))
            }
            let badgeStep: CGFloat = markerRadius * 1.6
            let centeredStartX = cx - badgeStep * CGFloat(badges.count - 1) / 2
            let startX = min(centeredStartX, g.size.width - markerRadius - badgeStep * CGFloat(badges.count - 1))
            for (index, badge) in badges.enumerated() {
                let badgeX = startX + CGFloat(index) * badgeStep
                let rect = CGRect(x: badgeX - markerRadius, y: cy - markerRadius,
                                  width: markerRadius * 2, height: markerRadius * 2)
                ctx.fill(Path(ellipseIn: rect), with: .color(badge.color))
                if badge.kind == "cobblestone" || badge.kind == "sterrato" {
                    drawSurfaceGlyph(type: badge.kind, context: ctx, center: CGPoint(x: badgeX, y: cy), diameter: markerRadius * 2)
                } else if badge.kind == "finish" {
                    let tile = markerRadius * 0.44
                    let origin = CGPoint(x: badgeX - tile, y: cy - tile)
                    var board = Path()
                    board.addRect(CGRect(x: origin.x, y: origin.y, width: tile * 2, height: tile * 2))
                    ctx.fill(board, with: .color(.white.opacity(0.3)))
                    var checks = Path()
                    checks.addRect(CGRect(x: origin.x, y: origin.y, width: tile, height: tile))
                    checks.addRect(CGRect(x: origin.x + tile, y: origin.y + tile, width: tile, height: tile))
                    ctx.fill(checks, with: .color(.white))
                } else {
                    // Glifo del marcador (categoría o letra), a tamaño de icono.
                    ctx.draw(
                        Text(badge.label)
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(badge.textColor),
                        at: CGPoint(x: badgeX, y: cy),
                        anchor: .center
                    )
                }
            }
        }

        drawSelection(ctx: &ctx, g: g)
    }

    /// Tramo: el resto del perfil se vela con el color de la tarjeta, de
    /// arriba al eje. Punto: guía vertical discontinua en el color de acento.
    private func drawSelection(ctx: inout GraphicsContext, g: ChartGeometry) {
        if let range = selection.range {
            let from = max(0, min(profile.distance, min(range.a, range.b)))
            let to = max(0, min(profile.distance, max(range.a, range.b)))
            let x1 = g.x(for: from), x2 = g.x(for: to)
            let left = g.ml, right = g.ml + g.plotWidth, bottom = g.mt + g.plotHeight + 1
            var dim = Path()
            dim.addRect(CGRect(x: left, y: 0, width: max(0, x1 - left), height: bottom))
            dim.addRect(CGRect(x: x2, y: 0, width: max(0, right - x2), height: bottom))
            ctx.fill(dim, with: .color(AppTheme.cardBackground.opacity(0.72)))
        } else if let km = selection.pointKm {
            let x = g.x(for: max(0, min(profile.distance, km)))
            var line = Path()
            line.move(to: CGPoint(x: x, y: g.mt))
            line.addLine(to: CGPoint(x: x, y: g.mt + g.plotHeight))
            ctx.stroke(line, with: .color(.accentColor), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
        }
    }
}

// MARK: - Gesto del perfil

/// Reconocedor del perfil (gráfico propio, sin control nativo equivalente).
/// Un arrastre que, superado el umbral de 6 pt, es predominantemente
/// horizontal mide un tramo; si es vertical, falla y deja paso al
/// desplazamiento de la página. Sin movimiento, es un toque.
private final class ProfileTouchRecognizer: UIGestureRecognizer {
    enum Kind { case none, tap, drag }

    static let threshold: CGFloat = 6

    private(set) var kind: Kind = .none
    private(set) var translation: CGPoint = .zero
    private var startLocation: CGPoint = .zero
    private weak var trackedTouch: UITouch?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard trackedTouch == nil, touches.count == 1, let touch = touches.first else {
            if state == .possible { state = .failed } else if kind == .drag { state = .cancelled }
            return
        }
        trackedTouch = touch
        kind = .none
        translation = .zero
        startLocation = touch.location(in: view)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let touch = trackedTouch, touches.contains(touch) else { return }
        let location = touch.location(in: view)
        translation = CGPoint(x: location.x - startLocation.x, y: location.y - startLocation.y)
        switch state {
        case .possible:
            guard hypot(translation.x, translation.y) >= Self.threshold else { return }
            if abs(translation.x) > abs(translation.y) {
                kind = .drag
                state = .began
            } else {
                state = .failed
            }
        case .began, .changed:
            state = .changed
        default:
            break
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let touch = trackedTouch, touches.contains(touch) else { return }
        if state == .possible {
            kind = .tap
            state = .ended
        } else if state == .began || state == .changed {
            state = .ended
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        state = state == .possible ? .failed : .cancelled
    }

    override func reset() {
        super.reset()
        trackedTouch = nil
        kind = .none
        translation = .zero
    }

    /// El desplazamiento de la página espera a que el perfil descarte el
    /// gesto (movimiento vertical) para empezar.
    override func shouldBeRequiredToFail(by otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        otherGestureRecognizer is UIPanGestureRecognizer && otherGestureRecognizer.view is UIScrollView
    }
}

private struct ProfileTouchGesture: UIGestureRecognizerRepresentable {
    enum Event {
        case tap(CGPoint)
        case dragBegan(start: CGPoint, current: CGPoint)
        case dragChanged(CGPoint)
        case dragEnded
        case dragCancelled
    }

    let onEvent: (Event) -> Void

    func makeUIGestureRecognizer(context: Context) -> ProfileTouchRecognizer {
        ProfileTouchRecognizer()
    }

    func handleUIGestureRecognizerAction(_ recognizer: ProfileTouchRecognizer, context: Context) {
        let location = context.converter.localLocation
        switch recognizer.state {
        case .began:
            let start = CGPoint(x: location.x - recognizer.translation.x, y: location.y - recognizer.translation.y)
            onEvent(.dragBegan(start: start, current: location))
        case .changed:
            onEvent(.dragChanged(location))
        case .ended:
            onEvent(recognizer.kind == .tap ? .tap(location) : .dragEnded)
        case .cancelled, .failed:
            if recognizer.kind == .drag { onEvent(.dragCancelled) }
        default:
            break
        }
    }
}

// MARK: - Summit list row

private struct SummitRow: View {
    let summit: ProfileSummit
    let totalDistance: Double
    let profilePoints: [ElevationPoint]

    var body: some View {
        let stats = summit.climbStats(points: profilePoints)
        HStack(spacing: 8) {
            GuideMarkerView(type: "summit", category: summit.category)
                .frame(width: 20, height: 20)
                .accessibilityHidden(true)
            if let name = summit.name, !name.isEmpty {
                Text(name)
                    .ccFont(.s14)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                if let km = summit.km {
                    let remaining = totalDistance - km
                    Text(remaining < 0.5 ? LocaleService.t("Meta", "Finish") : "\(ProfileFormat.km(remaining)) km")
                        .ccFont(.s14)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                if let s = stats {
                    Text("\(ProfileFormat.km(s.lengthKm)) km \(LocaleService.t("al", "at")) \(ProfileFormat.gradient(s.avgGradient)) %")
                        .ccFont(.s13)
                        .foregroundStyle(.secondary)
                } else if let alt = summit.altitude {
                    Text("\(ProfileFormat.meters(Double(alt))) m")
                        .ccFont(.s13)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

// MARK: - Waypoint list row

private struct WaypointRow: View {
    let marker: ChartMarker
    let totalDistance: Double

    private var typeLabel: String {
        guard case .waypoint(let wp) = marker.source else { return "" }
        switch wp.type {
        case "bonus_sprint":        return LocaleService.t("Sprint bonificación", "Bonus sprint")
        case "intermediate_sprint": return LocaleService.t("Sprint intermedio", "Intermediate sprint")
        case "intermediate_split":  return LocaleService.t("Punto intermedio", "Intermediate point")
        case "cobblestone":         return LocaleService.t("Pavé", "Cobbles")
        case "sterrato":            return LocaleService.t("Sterrato", "Gravel")
        default:                    return wp.type
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            GuideMarkerView(type: marker.kind, category: nil)
                .frame(width: 20, height: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let name = marker.name, !name.isEmpty {
                    Text(name)
                        .ccFont(.s14)
                    Text(typeLabel)
                        .ccFont(.s13)
                        .foregroundStyle(.secondary)
                } else {
                    Text(typeLabel)
                        .ccFont(.s14)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(ProfileFormat.km(max(0, totalDistance - marker.km))) km")
                    .ccFont(.s14)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                if let len = marker.lengthKm {
                    Text("\(ProfileFormat.km(len)) km")
                        .ccFont(.s13)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

// MARK: - Main view

struct ElevationProfileView: View {
    let raceDay: RaceDay
    let race: Race?

    @State private var selection = ProfileSelection()

    private var profile: ElevationProfile { raceDay.elevationProfile! }
    private var summits: [ProfileSummit]  { raceDay.profileSummits ?? [] }
    private var waypoints: [ProfileWaypoint] { raceDay.profileWaypoints ?? [] }

    private var profileColor: Color {
        if let hex = race?.colorHex { return Color(hex: hex) }
        return Color.accentColor
    }

    private var navigationTitle: String {
        let stage = raceDay.stageLabel
        let raceName = race?.localizedName ?? ""
        if stage.isEmpty { return raceName.isEmpty ? LocaleService.t("Perfil", "Profile") : raceName }
        if raceName.isEmpty { return stage }
        return "\(raceName) · \(stage)"
    }

    private var listWaypoints: [ChartMarker] {
        waypoints
            .filter { $0.type != "town" }
            .compactMap { wp in
                guard let km = wp.km else { return nil }
                return ChartMarker(id: "wp-\(km)-\(wp.type)", km: km, source: .waypoint(wp))
            }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Datos generales de la etapa, el mismo bloque que en la
                // jornada aparece encima de la documentación. Mantiene el
                // contexto (carrera, etapa, recorrido, distancia/desnivel)
                // por encima del perfil.
                StageInfoHeader(raceDay: raceDay, race: race)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .ccCardSurface()

                StagePanel {
                    VStack(alignment: .leading, spacing: 8) {
                        StagePanelTitle(LocaleService.t("Perfil", "Profile"))
                        ProfileReadout(points: profile.points, selection: $selection)
                    }
                } content: {
                    ProfileGraphicLayout {
                        ElevationChartCard(
                            profile: profile,
                            summits: summits,
                            waypoints: waypoints,
                            profileColor: profileColor,
                            selection: $selection
                        )
                    }
                    .padding(.vertical, 8)
                }

                if !summits.isEmpty {
                    StagePanel {
                        StagePanelTitle(LocaleService.t("Puertos", "Climbs"))
                    } content: {
                        ForEach(Array(summits.enumerated()), id: \.offset) { index, summit in
                            if index > 0 { Divider() }
                            SummitRow(summit: summit, totalDistance: profile.distance, profilePoints: profile.points)
                        }
                    }
                }

                if !listWaypoints.isEmpty {
                    StagePanel {
                        StagePanelTitle(LocaleService.t("Otros puntos", "Other points"))
                    } content: {
                        ForEach(Array(listWaypoints.enumerated()), id: \.offset) { index, marker in
                            if index > 0 { Divider() }
                            WaypointRow(marker: marker, totalDistance: profile.distance)
                        }
                    }
                }
            }
            .padding()
        }
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let race, race.isStageRace {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(destination: RaceDetailView(raceId: race.id)) {
                        RaceLogo(race.logoUrl, size: 24)
                    }
                    .accessibilityLabel(LocaleService.t("Ver todas las etapas de \(race.localizedName)", "View all stages of \(race.localizedName)"))
                }
            }
        }
        .onAppear {
            AnalyticsService.shared.logScreenView("elevation_profile", parameters: [
                "race_day_id": raceDay.id,
                "stage_name": raceDay.stageLabel,
                "race_name": race?.name ?? "",
            ])
        }
    }
}

// MARK: - Formatting helpers (file-private)

private func formatKmInt(_ km: Double) -> String {
    let rounded = Int(km.rounded())
    return "\(rounded)"
}
