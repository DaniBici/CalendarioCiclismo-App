import SwiftUI

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
    let ml: CGFloat = 44
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

// MARK: - Chart Card

struct ElevationChartCard: View {
    let profile: ElevationProfile
    let summits: [ProfileSummit]
    let waypoints: [ProfileWaypoint]
    var profileColor: Color = .accentColor

    @Environment(\.colorScheme) private var colorScheme
    @State private var selectedMarker: ChartMarker?
    @State private var selectedClimb: ClimbInfo?
    @State private var cursorKm: Double?
    @State private var dragStartKm: Double?
    @State private var dragEndKm: Double?
    @State private var frozenSegment: SegmentMeasure?

    private struct SegmentMeasure {
        let startKm: Double
        let endKm: Double
        let distanceKm: Double
        let elevationMeters: Int
        let percentageGrade: Double
    }

    private struct ClimbInfo: Identifiable {
        let id: String
        let startKm: Double
        let endKm: Double
        let name: String?
        let category: String?
        let lengthKm: Double
        let avgGradient: Double
        let gain: Int
        let summitAlt: Int
    }

    private var visibleProfileColor: Color {
        ProfileColorContrast.adjusted(profileColor, for: colorScheme)
    }

    private var climbs: [ClimbInfo] {
        summits.compactMap { s in
            guard let summitKm = s.km,
                  let stats = s.climbStats(points: profile.points) else { return nil }
            let endKm = min(summitKm, profile.distance)
            let startAlt = altitudeOnCurveStatic(points: profile.points, km: s.startKm ?? 0) ?? 0
            let summitAlt = Double(s.altitude ?? Int(altitudeOnCurveStatic(points: profile.points, km: endKm) ?? 0))
            return ClimbInfo(
                id: "climb-\(summitKm)-\(s.name ?? "")",
                startKm: s.startKm ?? 0,
                endKm: endKm,
                name: s.name,
                category: s.category,
                lengthKm: stats.lengthKm,
                avgGradient: stats.avgGradient,
                gain: max(0, Int(summitAlt - startAlt)),
                summitAlt: Int(summitAlt)
            )
        }
    }

    private func altitudeOnCurveStatic(points: [ElevationPoint], km targetKm: Double) -> Double? {
        guard points.count >= 2 else { return nil }
        if let exact = points.first(where: { $0.km == targetKm }) { return Double(exact.alt) }
        if targetKm <= points.first!.km { return Double(points.first!.alt) }
        if targetKm >= points.last!.km  { return Double(points.last!.alt) }
        guard let idx = points.firstIndex(where: { $0.km > targetKm }), idx > 0 else { return nil }
        let p0 = points[idx - 1], p1 = points[idx]
        let span = p1.km - p0.km
        if span <= 0 { return Double(p0.alt) }
        let t = (targetKm - p0.km) / span
        return Double(p0.alt) + t * Double(p1.alt - p0.alt)
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
            ZStack(alignment: .topLeading) {
                Canvas { ctx, _ in
                    drawChart(ctx: &ctx, g: g)
                }
                .gesture(
                    DragGesture(minimumDistance: 8)
                        .onChanged { v in
                            let g2 = geometry(size: geo.size)
                            let km = g2.km(for: v.location.x)
                            if dragStartKm == nil {
                                dragStartKm = km
                                frozenSegment = nil
                            }
                            dragEndKm = km
                            selectedMarker = nil
                        }
                        .onEnded { _ in
                            guard let start = dragStartKm, let end = dragEndKm, abs(end - start) >= 0.1 else {
                                dragStartKm = nil
                                dragEndKm = nil
                                return
                            }
                            let alt1 = altitudeOnCurve(km: start) ?? Double(profile.points.first?.alt ?? 0)
                            let alt2 = altitudeOnCurve(km: end) ?? Double(profile.points.last?.alt ?? 0)
                            let distance = abs(end - start)
                            let elevation = abs(alt2 - alt1)
                            let grade = distance > 0 ? (elevation / (distance * 1000)) * 100 : 0
                            frozenSegment = SegmentMeasure(
                                startKm: start,
                                endKm: end,
                                distanceKm: distance,
                                elevationMeters: Int(elevation),
                                percentageGrade: grade
                            )
                            dragStartKm = nil
                            dragEndKm = nil
                            Haptics.play(.primaryAction)
                        }
                )
                .onTapGesture { loc in
                    let g2 = geometry(size: geo.size)
                    let tapped = nearestMarker(at: loc, g: g2)
                    if let m = tapped {
                        selectedMarker = (selectedMarker?.id == m.id) ? nil : m
                        selectedClimb = nil
                    } else {
                        // Detectar tap dentro de una zona de puerto (área sombreada)
                        let tapKm = g2.km(for: loc.x)
                        if loc.y >= g2.mt && loc.y <= g2.mt + g2.plotHeight,
                           let climb = climbs.first(where: { tapKm >= $0.startKm && tapKm <= $0.endKm }) {
                            selectedClimb = (selectedClimb?.id == climb.id) ? nil : climb
                            selectedMarker = nil
                        } else {
                            selectedMarker = nil
                            selectedClimb = nil
                        }
                    }
                    frozenSegment = nil
                    dragStartKm = nil
                    dragEndKm = nil
                    cursorKm = nil
                }

                // Cursor overlay (drag en curso o segmento congelado)
                if dragStartKm != nil, let endKm = dragEndKm {
                    segmentDragOverlay(g: g, startKm: dragStartKm!, endKm: endKm, containerSize: geo.size)
                } else if let seg = frozenSegment {
                    segmentLineOverlay(g: g, startKm: seg.startKm, endKm: seg.endKm)
                } else if let ckm = cursorKm {
                    cursorOverlay(g: g, km: ckm, containerSize: geo.size)
                }

                // Callout overlay
                if let marker = selectedMarker {
                    calloutOverlay(g: g, marker: marker, containerSize: geo.size)
                }

                // Climb tooltip
                if let climb = selectedClimb {
                    climbTooltip(climb: climb)
                }

                // Segment measurement tooltip (congelado después del drag)
                if let seg = frozenSegment {
                    segmentTooltip(segment: seg)
                }
            }
        }
        .frame(height: 240)
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LocaleService.t("Perfil interactivo", "Interactive profile"))
        .accessibilityValue(accessibilityCursorValue)
        .accessibilityHint(LocaleService.t(
            "Desliza hacia arriba o abajo para consultar distancia y altitud",
            "Swipe up or down to explore distance and altitude"
        ))
        .accessibilityAdjustableAction { direction in
            let current = cursorKm ?? 0
            switch direction {
            case .increment:
                cursorKm = min(profile.distance, current + 1)
            case .decrement:
                cursorKm = max(0, current - 1)
            @unknown default:
                break
            }
        }
    }

    private var accessibilityCursorValue: String {
        let km = cursorKm ?? 0
        let altitude = Int((altitudeOnCurve(km: km) ?? Double(profile.points.first?.alt ?? 0)).rounded())
        return "\(formatKmDecimal(km)) · \(formatAltitude(altitude))"
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

            // Y label
            let label = formatAltitude(Int(yVal))
            ctx.draw(
                Text(label).font(.system(size: 9)).foregroundStyle(Color.secondary),
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

            let xLabel = formatKmInt(xVal)
            ctx.draw(
                Text(xLabel).font(.system(size: 9)).foregroundStyle(Color.secondary),
                at: CGPoint(x: xPos, y: g.mt + g.plotHeight + 12),
                anchor: .center
            )
            xVal += xStep
        }

        // Filled area + profile line
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

        // Climb zones — área bajo la curva entre startKm y km del summit
        for climb in climbs {
            let segPts: [ElevationPoint] = {
                var arr: [ElevationPoint] = []
                if let startAlt = altitudeOnCurve(km: climb.startKm) {
                    arr.append(ElevationPoint(km: climb.startKm, alt: Int(startAlt)))
                }
                arr.append(contentsOf: pts.filter { $0.km > climb.startKm && $0.km < climb.endKm })
                if let endAlt = altitudeOnCurve(km: climb.endKm) {
                    arr.append(ElevationPoint(km: climb.endKm, alt: Int(endAlt)))
                }
                return arr
            }()
            guard segPts.count >= 2 else { continue }

            var zonePath = Path()
            let first = CGPoint(x: g.x(for: segPts[0].km), y: g.y(for: Double(segPts[0].alt)))
            zonePath.move(to: CGPoint(x: first.x, y: g.mt + g.plotHeight))
            zonePath.addLine(to: first)
            for sp in segPts.dropFirst() {
                zonePath.addLine(to: CGPoint(x: g.x(for: sp.km), y: g.y(for: Double(sp.alt))))
            }
            zonePath.addLine(to: CGPoint(x: g.x(for: segPts.last!.km), y: g.mt + g.plotHeight))
            zonePath.closeSubpath()
            ctx.fill(zonePath, with: .color(Color.summitRed.opacity(0.22)))
        }

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
            guard let alt = altitudeOnCurve(km: marker.km) else { continue }
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
    }

    private func altitudeOnCurve(km targetKm: Double) -> Double? {
        let pts = profile.points
        guard pts.count >= 2 else { return nil }
        if let exact = pts.first(where: { $0.km == targetKm }) { return Double(exact.alt) }
        guard let idx = pts.firstIndex(where: { $0.km > targetKm }), idx > 0 else {
            return Double(pts.last!.alt)
        }
        let p0 = pts[idx - 1]
        let p1 = pts[idx]
        let t = (targetKm - p0.km) / (p1.km - p0.km)
        return Double(p0.alt) + t * Double(p1.alt - p0.alt)
    }

    private func nearestMarker(at loc: CGPoint, g: ChartGeometry) -> ChartMarker? {
        let hitRadius: CGFloat = 14
        var best: (marker: ChartMarker, dist: CGFloat)? = nil
        for marker in markers {
            guard let alt = altitudeOnCurve(km: marker.km) else { continue }
            let mx = g.x(for: marker.km)
            let my = g.y(for: alt)
            let dist = hypot(loc.x - mx, loc.y - my)
            if dist <= hitRadius {
                if best == nil || dist < best!.dist {
                    best = (marker, dist)
                }
            }
        }
        return best?.marker
    }

    // MARK: Cursor overlay

    @ViewBuilder
    private func cursorOverlay(g: ChartGeometry, km: Double, containerSize: CGSize) -> some View {
        let xPos = g.x(for: km)
        let alt = altitudeOnCurve(km: km)
        Canvas { ctx, _ in
            var path = Path()
            path.move(to: CGPoint(x: xPos, y: g.mt))
            path.addLine(to: CGPoint(x: xPos, y: g.mt + g.plotHeight))
            ctx.stroke(path, with: .color(.secondary.opacity(0.5)), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        }
        .allowsHitTesting(false)
        if let a = alt {
            let yPos = max(g.mt + 14, min(g.mt + g.plotHeight - 14, g.y(for: a)))
            Text(formatAltitude(Int(a)))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.primary)
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 3))
                .position(x: max(30, min(containerSize.width - 30, xPos)), y: yPos)
                .allowsHitTesting(false)
        }
    }

    // MARK: Segment line overlay (línea + puntos, sin tooltip vivo)

    @ViewBuilder
    private func segmentLineOverlay(g: ChartGeometry, startKm: Double, endKm: Double) -> some View {
        Canvas { ctx, _ in
            let x1 = g.x(for: startKm)
            let x2 = g.x(for: endKm)
            let alt1 = altitudeOnCurve(km: startKm) ?? Double(profile.points.first?.alt ?? 0)
            let alt2 = altitudeOnCurve(km: endKm) ?? Double(profile.points.last?.alt ?? 0)
            let y1 = g.y(for: alt1)
            let y2 = g.y(for: alt2)

            var path = Path()
            path.move(to: CGPoint(x: x1, y: y1))
            path.addLine(to: CGPoint(x: x2, y: y2))
            ctx.stroke(path, with: .color(.accentColor), style: StrokeStyle(lineWidth: 2.5))

            let markerRadius: CGFloat = 5
            ctx.fill(Path(ellipseIn: CGRect(x: x1 - markerRadius, y: y1 - markerRadius, width: markerRadius * 2, height: markerRadius * 2)), with: .color(.accentColor))
            ctx.fill(Path(ellipseIn: CGRect(x: x2 - markerRadius, y: y2 - markerRadius, width: markerRadius * 2, height: markerRadius * 2)), with: .color(.accentColor))
        }
        .allowsHitTesting(false)
    }

    // MARK: Segment drag overlay (mientras se arrastra)

    @ViewBuilder
    private func segmentDragOverlay(g: ChartGeometry, startKm: Double, endKm: Double, containerSize: CGSize) -> some View {
        segmentLineOverlay(g: g, startKm: startKm, endKm: endKm)

        let distance = abs(endKm - startKm)
        let alt1 = altitudeOnCurve(km: startKm) ?? Double(profile.points.first?.alt ?? 0)
        let alt2 = altitudeOnCurve(km: endKm) ?? Double(profile.points.last?.alt ?? 0)
        let elevation = abs(alt2 - alt1)
        let grade = distance > 0 ? (elevation / (distance * 1000)) * 100 : 0

        Text("\(formatKmDecimal(distance)) / +\(Int(elevation)) m / \(String(format: "%.1f", grade))%")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 3))
            .padding()
            .allowsHitTesting(false)
    }

    // MARK: Segment tooltip (congelado después del drag)

    @ViewBuilder
    private func segmentTooltip(segment: SegmentMeasure) -> some View {
        VStack(spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: "arrow.left.and.right")
                    .foregroundStyle(.secondary)
                Text(formatKmDecimal(segment.distanceKm))
                    .fontWeight(.semibold)
            }
            .font(.subheadline)

            HStack(spacing: 4) {
                Image(systemName: "arrow.up.right")
                    .foregroundStyle(.secondary)
                Text("+\(segment.elevationMeters) m")
                    .fontWeight(.semibold)
            }
            .font(.subheadline)

            HStack(spacing: 4) {
                Image(systemName: "percent")
                    .foregroundStyle(.secondary)
                Text(String(format: "%.1f%%", segment.percentageGrade))
                    .fontWeight(.semibold)
            }
            .font(.subheadline)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.12), radius: 6, x: 0, y: 2)
        .padding()
    }

    // MARK: Climb tooltip

    @ViewBuilder
    private func climbTooltip(climb: ClimbInfo) -> some View {
        let title = (climb.name?.isEmpty == false) ? climb.name! : "Puerto"
        let gradeStr = String(format: "%.1f%%", climb.avgGradient)
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            HStack(spacing: 6) {
                Text(formatKmDecimal(climb.lengthKm))
                Text("·")
                    .foregroundStyle(.secondary)
                Text(gradeStr)
                    .fontWeight(.semibold)
            }
            .font(.subheadline)
            Text("desnivel: \(climb.gain) m")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.12), radius: 6, x: 0, y: 2)
        .padding()
    }

    // MARK: Callout overlay

    @ViewBuilder
    private func calloutOverlay(g: ChartGeometry, marker: ChartMarker, containerSize: CGSize) -> some View {
        if let alt = altitudeOnCurve(km: marker.km) {
            let mx = g.x(for: marker.km)
            let my = g.y(for: alt)

            let calloutWidth: CGFloat = 160
            let calloutHeight: CGFloat = marker.secondaryDescription == nil ? 70 : 86
            let gap: CGFloat = 14
            let preferAbove = my > 90
            let calloutY = preferAbove ? my - gap - calloutHeight : my + gap
            let rawX = mx - calloutWidth / 2
            let clampedX = max(4, min(containerSize.width - calloutWidth - 4, rawX))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    markerBadge(color: marker.color, label: marker.label, textColor: marker.textColor, kind: marker.kind)
                    if let secondaryColor = marker.secondaryColor,
                       let secondaryLabel = marker.secondaryLabel,
                       let secondaryKind = marker.secondaryKind {
                        markerBadge(color: secondaryColor, label: secondaryLabel,
                                    textColor: marker.secondaryTextColor, kind: secondaryKind)
                    }
                }
                if let name = marker.name {
                    Text(name)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .lineLimit(2)
                }
                if let secondaryDescription = marker.secondaryDescription {
                    Text(secondaryDescription)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                HStack(spacing: 4) {
                    if let a = marker.altitude ?? (altitudeOnCurve(km: marker.km).map { Int($0) }) {
                        Text(formatAltitude(a))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text("· km \(formatKmInt(marker.km))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(10)
            .frame(width: calloutWidth, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            .shadow(color: .black.opacity(0.12), radius: 6, x: 0, y: 2)
            .position(x: clampedX + calloutWidth / 2, y: calloutY + calloutHeight / 2)
            .allowsHitTesting(false)
        }
    }

    private func markerBadge(color: Color, label: String, textColor: Color, kind: String) -> some View {
        ZStack {
            Circle().fill(color)
            if kind == "cobblestone" || kind == "sterrato" {
                GuideMarkerView(type: kind, category: nil)
            } else if kind == "finish" {
                Canvas { context, size in
                    let tile = min(size.width, size.height) / 2
                    var board = Path()
                    board.addRect(CGRect(x: 0, y: 0, width: tile * 2, height: tile * 2))
                    context.fill(board, with: .color(.white.opacity(0.3)))
                    var checks = Path()
                    checks.addRect(CGRect(x: 0, y: 0, width: tile, height: tile))
                    checks.addRect(CGRect(x: tile, y: tile, width: tile, height: tile))
                    context.fill(checks, with: .color(.white))
                }
                .frame(width: 7, height: 7)
            } else {
                Text(label)
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(textColor)
            }
        }
        .frame(width: 16, height: 16)
        .accessibilityHidden(true)
    }
}

// MARK: - Summit list row

private struct SummitRow: View {
    let summit: ProfileSummit
    let totalDistance: Double
    let profilePoints: [ElevationPoint]

    var body: some View {
        let stats = summit.climbStats(points: profilePoints)
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(Color.summitRed)
                    .frame(width: 18, height: 18)
                Text(summit.category ?? "?")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.white)
            }
            if let name = summit.name, !name.isEmpty {
                Text(name)
                    .font(.subheadline)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                if let km = summit.km {
                    let remaining = totalDistance - km
                    Text(remaining < 0.5 ? LocaleService.t("Meta", "Finish") : "-\(formatKmInt(remaining)) km")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
                if let s = stats {
                    Text("\(formatKmDecimal(s.lengthKm)) · \(String(format: "%.1f%%", s.avgGradient))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if let alt = summit.altitude {
                    Text(formatAltitude(alt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Waypoint list row

private struct WaypointRow: View {
    let marker: ChartMarker
    let totalDistance: Double

    private var typeLabel: String {
        guard case .waypoint(let wp) = marker.source else { return "" }
        switch wp.type {
        case "bonus_sprint":        return "Bonificación"
        case "intermediate_sprint": return "Sprint Int."
        case "intermediate_split":  return "Punto int."
        case "cobblestone":         return "Pavé"
        case "sterrato":            return "Sterrato"
        default:                    return wp.type
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            if marker.kind == "cobblestone" || marker.kind == "sterrato" {
                GuideMarkerView(type: marker.kind, category: nil)
                    .frame(width: 18, height: 18)
            } else {
                ZStack {
                    Circle()
                        .fill(marker.color)
                        .frame(width: 18, height: 18)
                    Text(marker.label)
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                if let name = marker.name, !name.isEmpty {
                    Text(name)
                        .font(.subheadline)
                } else {
                    Text(typeLabel)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let name = marker.name, !name.isEmpty {
                    Text(typeLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text("-\(formatKmInt(totalDistance - marker.km)) km")
                    .font(.subheadline)
                    .fontWeight(.medium)
                if let len = marker.lengthKm {
                    Text(formatKmDecimal(len))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Main view

struct ElevationProfileView: View {
    let raceDay: RaceDay
    let race: Race?

    private var profile: ElevationProfile { raceDay.elevationProfile! }
    private var summits: [ProfileSummit]  { raceDay.profileSummits ?? [] }
    private var waypoints: [ProfileWaypoint] { raceDay.profileWaypoints ?? [] }

    private var profileColor: Color {
        if let hex = race?.colorHex { return Color(hex: hex) }
        return Color.accentColor
    }

    private var navigationTitle: String {
        let stage = raceDay.stageLabel
        let raceName = race?.name ?? ""
        if stage.isEmpty { return raceName.isEmpty ? "Perfil" : raceName }
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
            VStack(alignment: .leading, spacing: 20) {
                // Datos generales de la etapa, el mismo bloque que en la
                // jornada aparece encima de la documentación. Mantiene el
                // contexto (carrera, etapa, recorrido, distancia/desnivel)
                // por encima del perfil.
                StageInfoHeader(raceDay: raceDay, race: race)
                    .padding()
                    .ccCardSurface()
                    .padding(.horizontal)

                ElevationChartCard(
                    profile: profile,
                    summits: summits,
                    waypoints: waypoints,
                    profileColor: profileColor
                )
                .padding(.horizontal)

                if !summits.isEmpty {
                    summitsSection
                        .padding(.horizontal)
                }

                if !listWaypoints.isEmpty {
                    waypointsSection
                        .padding(.horizontal)
                }
            }
            .padding(.vertical)
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
                    .accessibilityLabel("Ver todas las etapas de \(race.name)")
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

    // MARK: Summits section

    @ViewBuilder
    private var summitsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Puertos")
                .font(.headline)
            Divider()
            ForEach(summits) { summit in
                SummitRow(summit: summit, totalDistance: profile.distance, profilePoints: profile.points)
                if summit.id != summits.last?.id {
                    Divider().padding(.leading, 28)
                }
            }
        }
        .padding()
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Waypoints section

    @ViewBuilder
    private var waypointsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Otros puntos")
                .font(.headline)
            Divider()
            ForEach(listWaypoints) { marker in
                WaypointRow(marker: marker, totalDistance: profile.distance)
                if marker.id != listWaypoints.last?.id {
                    Divider().padding(.leading, 28)
                }
            }
        }
        .padding()
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Formatting helpers (file-private)

// Los separadores (miles y decimal) siguen el IDIOMA DE CONTENIDO, no el locale
// del dispositivo ni el chrome de la UI — igual que RaceDay.distanceFormatted /
// elevationGainFormatted y que Android (ElevationProfileScreen.formatAlt).

private func formatAltitude(_ alt: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    let isEn = LocaleService.shouldShowEnglishContent
    formatter.groupingSeparator = isEn ? "," : "."
    formatter.locale = Locale(identifier: isEn ? "en_US" : "es_ES")
    return (formatter.string(from: NSNumber(value: alt)) ?? "\(alt)") + " m"
}

private func formatKmInt(_ km: Double) -> String {
    let rounded = Int(km.rounded())
    return "\(rounded)"
}

private func formatKmDecimal(_ km: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.minimumFractionDigits = km.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 1
    formatter.maximumFractionDigits = 1
    formatter.locale = Locale(identifier: LocaleService.shouldShowEnglishContent ? "en_US" : "es_ES")
    return (formatter.string(from: NSNumber(value: km)) ?? "\(km)") + " km"
}
