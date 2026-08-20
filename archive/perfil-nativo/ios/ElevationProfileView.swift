import SwiftUI

// MARK: - Color helpers

private extension Color {
    static let summitRed   = Color(hex: "c53030")
    static let bonusSprint = Color(hex: "f9ab00")
    static let intSprint   = Color(hex: "0f9d58")
    static let intSplit    = Color(hex: "00838f")
    static let cobblestone = Color(hex: "b0b0b0")
    static let sterratoTan = Color(hex: "c8a870")
}

// MARK: - Marker model

private struct ChartMarker: Identifiable {
    enum Source {
        case summit(ProfileSummit)
        case waypoint(ProfileWaypoint)
    }
    let id: String
    let km: Double
    let source: Source

    var color: Color {
        switch source {
        case .summit: return .summitRed
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
        case .summit(let s):  return s.category ?? "?"
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

    var lengthKm: Double? {
        if case .waypoint(let wp) = source { return wp.lengthKm }
        return nil
    }

    var name: String? {
        switch source {
        case .summit(let s):   return s.name
        case .waypoint(let wp): return wp.name
        }
    }

    var altitude: Int? {
        if case .summit(let s) = source { return s.altitude }
        return nil
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

private struct ElevationChartCard: View {
    let profile: ElevationProfile
    let summits: [ProfileSummit]
    let waypoints: [ProfileWaypoint]
    var profileColor: Color = .accentColor

    @State private var selectedMarker: ChartMarker?
    @State private var cursorKm: Double?

    private var markers: [ChartMarker] {
        var result: [ChartMarker] = []
        for s in summits {
            result.append(ChartMarker(id: "summit-\(s.km)-\(s.name ?? "")", km: s.km, source: .summit(s)))
        }
        for wp in waypoints where wp.type != "town" {
            result.append(ChartMarker(id: "wp-\(wp.km)-\(wp.type)", km: wp.km, source: .waypoint(wp)))
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
                            cursorKm = g2.km(for: v.location.x)
                            selectedMarker = nil
                        }
                        .onEnded { _ in cursorKm = nil }
                )
                .onTapGesture { loc in
                    let g2 = geometry(size: geo.size)
                    let tapped = nearestMarker(at: loc, g: g2)
                    if let m = tapped {
                        selectedMarker = (selectedMarker?.id == m.id) ? nil : m
                    } else {
                        selectedMarker = nil
                    }
                    cursorKm = nil
                }

                // Cursor overlay
                if let ckm = cursorKm {
                    cursorOverlay(g: g, km: ckm, containerSize: geo.size)
                }

                // Callout overlay
                if let marker = selectedMarker {
                    calloutOverlay(g: g, marker: marker, containerSize: geo.size)
                }
            }
        }
        .frame(height: 240)
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
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

        ctx.fill(fillPath, with: .color(profileColor.opacity(0.30)))

        var linePath = Path()
        linePath.move(to: startPt)
        for pt in pts.dropFirst() {
            linePath.addLine(to: CGPoint(x: g.x(for: pt.km), y: g.y(for: Double(pt.alt))))
        }
        ctx.stroke(linePath, with: .color(profileColor), style: StrokeStyle(lineWidth: 1.5))

        // Pavé/sterrato colored segments (those with lengthKm > 0)
        let segmentWaypoints = waypoints.filter { ($0.lengthKm ?? 0) > 0 }
        for wp in segmentWaypoints {
            let segColor: Color = wp.type == "sterrato" ? .sterratoTan : .cobblestone
            let endKm = wp.km + (wp.lengthKm ?? 0)
            let segPts = profile.points.filter { $0.km >= wp.km && $0.km <= endKm }
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
            let rect = CGRect(x: cx - markerRadius, y: cy - markerRadius,
                              width: markerRadius * 2, height: markerRadius * 2)
            ctx.fill(Path(ellipseIn: rect), with: .color(marker.color))

            ctx.draw(
                Text(marker.label)
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white),
                at: CGPoint(x: cx, y: cy),
                anchor: .center
            )
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
                .background(.regularMaterial, in: Capsule())
                .position(x: max(30, min(containerSize.width - 30, xPos)), y: yPos)
                .allowsHitTesting(false)
        }
    }

    // MARK: Callout overlay

    @ViewBuilder
    private func calloutOverlay(g: ChartGeometry, marker: ChartMarker, containerSize: CGSize) -> some View {
        if let alt = altitudeOnCurve(km: marker.km) {
            let mx = g.x(for: marker.km)
            let my = g.y(for: alt)

            let calloutWidth: CGFloat = 160
            let calloutHeight: CGFloat = 70
            let gap: CGFloat = 14
            let preferAbove = my > 90
            let calloutY = preferAbove ? my - gap - calloutHeight : my + gap
            let rawX = mx - calloutWidth / 2
            let clampedX = max(4, min(containerSize.width - calloutWidth - 4, rawX))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Circle()
                        .fill(marker.color)
                        .frame(width: 10, height: 10)
                    if case .summit(let s) = marker.source, let cat = s.category {
                        Text(cat.uppercased())
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundStyle(marker.color)
                    }
                }
                if let name = marker.name {
                    Text(name)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .lineLimit(2)
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
}

// MARK: - Summit list row

private struct SummitRow: View {
    let summit: ProfileSummit

    var body: some View {
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
                if let alt = summit.altitude {
                    Text(formatAltitude(alt))
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
                Text("km \(formatKmInt(summit.km))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Waypoint list row

private struct WaypointRow: View {
    let marker: ChartMarker

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
            ZStack {
                Circle()
                    .fill(marker.color)
                    .frame(width: 18, height: 18)
                Text(marker.label)
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.white)
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
                if let len = marker.lengthKm {
                    Text(formatKmDecimal(len))
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
                Text("km \(formatKmInt(marker.km))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
            .map { wp in
                ChartMarker(id: "wp-\(wp.km)-\(wp.type)", km: wp.km, source: .waypoint(wp))
            }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                statsRow
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
    }

    // MARK: Stats row

    @ViewBuilder
    private var statsRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Línea 1: recorrido (salida – meta)
            if let route = raceDay.routeDescription {
                HStack(spacing: 8) {
                    Image(systemName: "mappin.and.ellipse")
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(route)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                        if raceDay.isSingleCity {
                            Text("Salida y meta")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }

            // Línea 2: distancia + desnivel positivo
            HStack(spacing: 16) {
                Label {
                    Text(formatKmDecimal(profile.distance))
                        .fontWeight(.semibold)
                } icon: {
                    Image(systemName: "arrow.left.and.right")
                        .foregroundStyle(.secondary)
                }
                .font(.subheadline)

                if let gain = profile.elevationGain {
                    Label {
                        Text("+\(formatElevation(gain))")
                            .fontWeight(.semibold)
                    } icon: {
                        Image(systemName: "arrow.up.right")
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                }
            }
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
                SummitRow(summit: summit)
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
                WaypointRow(marker: marker)
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

private func formatAltitude(_ alt: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.groupingSeparator = "."
    formatter.locale = Locale(identifier: "es_ES")
    return (formatter.string(from: NSNumber(value: alt)) ?? "\(alt)") + " m"
}

private func formatElevation(_ val: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.groupingSeparator = "."
    formatter.locale = Locale(identifier: "es_ES")
    return (formatter.string(from: NSNumber(value: val)) ?? "\(val)") + " m"
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
    formatter.locale = Locale(identifier: "es_ES")
    return (formatter.string(from: NSNumber(value: km)) ?? "\(km)") + " km"
}
