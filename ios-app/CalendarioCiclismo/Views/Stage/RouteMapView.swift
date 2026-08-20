import SwiftUI
import MapKit

// MARK: - Marker model (mapa)

/// Punto-clave proyectado sobre el mapa: coordenada + estilo (color/letra) +
/// metadatos para el callout. Reutiliza la MISMA semántica de color/letra que
/// `ChartMarker` del perfil (`ElevationProfileView`), de modo que los pines del
/// mapa y los círculos del perfil hablan el mismo lenguaje visual.
private struct RouteMarker: Identifiable {
    enum Kind {
        case start
        case finish
        case summit(ProfileSummit)
        case waypoint(ProfileWaypoint)
    }
    let id: String
    let coordinate: CLLocationCoordinate2D
    let kind: Kind
    /// Texto del popup (nombre + km + categoría/altitud), ya localizado.
    let calloutTitle: String
    let calloutSubtitle: String?

    var color: Color {
        switch kind {
        case .start:  return .routeStartGreen
        case .finish: return .routeFinishRed
        case .summit: return .mapSummitRed
        case .waypoint(let wp):
            switch wp.type {
            case "bonus_sprint":        return .mapBonusSprint
            case "intermediate_sprint": return .mapIntSprint
            case "intermediate_split":  return .mapIntSplit
            case "cobblestone":         return .mapCobblestone
            case "sterrato":            return .mapSterratoTan
            default:                    return .gray
            }
        }
    }

    /// Glyph del centro del pin. Salida ▶ / meta 🏁 como la web; el resto usa
    /// letra (cat. de puerto, S/B) o SF Symbol para sprint-intermedio/sectores.
    var glyph: PinGlyph {
        switch kind {
        case .start:  return .text("▶")
        case .finish: return .text("🏁")
        case .summit(let s):
            return .text((s.category != nil && s.category != "M") ? s.category! : "•")
        case .waypoint(let wp):
            switch wp.type {
            case "bonus_sprint":        return .text("B")
            case "intermediate_sprint": return .text("S")
            case "intermediate_split":  return .symbol("stopwatch.fill")
            case "cobblestone":         return .symbol("square.grid.3x3.fill")
            case "sterrato":            return .symbol("circle.dotted")
            default:                    return .text("?")
            }
        }
    }

    enum PinGlyph {
        case text(String)
        case symbol(String)
    }
}

// MARK: - Pin view

/// Pin circular: círculo de color con halo blanco + glyph centrado. Mismo
/// lenguaje visual que los círculos del perfil de elevación.
private struct RoutePinView: View {
    let marker: RouteMarker

    var body: some View {
        ZStack {
            Circle()
                .fill(.white)
                .frame(width: 26, height: 26)
                .shadow(color: .black.opacity(0.25), radius: 2, x: 0, y: 1)
            Circle()
                .fill(marker.color)
                .frame(width: 22, height: 22)
            switch marker.glyph {
            case .text(let s):
                Text(s)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
            case .symbol(let name):
                Image(systemName: name)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .accessibilityLabel(marker.calloutTitle)
    }
}

// MARK: - Callout (popup del marcador, espejo del bindPopup de Leaflet)

private struct RouteCallout: View {
    let marker: RouteMarker

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(marker.calloutTitle)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
            if let sub = marker.calloutSubtitle, !sub.isEmpty {
                Text(sub)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .frame(maxWidth: 220, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.18), radius: 5, x: 0, y: 2)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Main view

/// Mapa del recorrido de una etapa: gemelo del perfil de elevación pero con un
/// mapa MapKit a pantalla completa en lugar del gráfico. La línea sale del GPX
/// crudo (`raceDay.routeGpxUrl`, Supabase Storage); los marcadores de
/// `profileSummits`/`profileWaypoints` se proyectan por km sobre la traza con
/// `RouteMapLogic`. Header de etapa flotante arriba + bottom sheet con las cajas
/// de puntos clave. Espejo nativo de `js/mapa-pub.js`.
struct RouteMapView: View {
    let raceDay: RaceDay
    let race: Race?

    @State private var loadState: LoadState = .loading
    @State private var points: [RoutePoint] = []
    @State private var markers: [RouteMarker] = []
    @State private var lineCoords: [CLLocationCoordinate2D] = []
    @State private var camera: MapCameraPosition = .automatic
    @State private var detent: PresentationDetent = .height(180)
    // Marcador seleccionado (tap) → muestra un callout con nombre + km +
    // categoría/altitud, igual que el popup de Leaflet en la web. nil = ninguno.
    @State private var selectedMarkerId: String?

    private enum LoadState: Equatable { case loading, ready, error }

    private var routeColor: Color {
        if let hex = race?.colorHex { return Color(hex: hex) }
        return Color(hex: "d8442e")
    }

    private var navigationTitle: String {
        let stage = raceDay.stageLabel
        let raceName = race?.name ?? ""
        if stage.isEmpty { return raceName.isEmpty ? LocaleService.t("Mapa", "Map") : raceName }
        if raceName.isEmpty { return stage }
        return "\(raceName) · \(stage)"
    }

    var body: some View {
        ZStack {
            switch loadState {
            case .loading:
                LoadingView()
            case .error:
                errorState
            case .ready:
                mapContent
            }
        }
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onAppear {
            AnalyticsService.shared.logScreenView("route_map", parameters: [
                "race_day_id": raceDay.id,
                "stage_name": raceDay.stageLabel,
                "race_name": race?.name ?? "",
            ])
        }
    }

    // MARK: Map

    @ViewBuilder
    private var mapContent: some View {
        Map(position: $camera, selection: $selectedMarkerId) {
            // Recorrido: casing blanco grueso debajo + trazo del color encima.
            MapPolyline(coordinates: lineCoords)
                .stroke(.white, style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
            MapPolyline(coordinates: lineCoords)
                .stroke(routeColor, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))

            // Marcadores (salida/meta, puertos, sprints, sectores). Cada uno es
            // seleccionable (.tag) → al tocarlo se muestra su callout.
            ForEach(markers) { marker in
                Annotation("", coordinate: marker.coordinate, anchor: .center) {
                    // Un Button (no onTapGesture) recibe el tap de forma fiable
                    // dentro de una Annotation de MapKit; el gesture recognizer
                    // del mapa se come los onTapGesture del contenido custom.
                    Button {
                        selectedMarkerId = (selectedMarkerId == marker.id) ? nil : marker.id
                    } label: {
                        RoutePinView(marker: marker)
                    }
                    .buttonStyle(.plain)
                }
                .tag(marker.id)
            }

            // Callout del marcador seleccionado: popup anclado encima del pin,
            // espejo del bindPopup de Leaflet (nombre + km + cat/altitud).
            if let sel = selectedMarkerId, let m = markers.first(where: { $0.id == sel }) {
                Annotation("", coordinate: m.coordinate, anchor: .bottom) {
                    RouteCallout(marker: m)
                        .offset(y: -18)   // por encima del pin
                        .onTapGesture { selectedMarkerId = nil }
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .ignoresSafeArea(edges: .bottom)
        // Velo de blur que se DESVANECE hacia abajo detrás del header: blur total
        // bajo el status bar (para que hora/batería se lean sobre el mapa) que se
        // atenúa en gradiente hasta desaparecer. Evita el corte duro entre la
        // zona superior difuminada y el mapa nítido (se notaba en dispositivo).
        .overlay(alignment: .top) { topBlurVeil }
        .safeAreaInset(edge: .top) { floatingHeader }
        .sheet(isPresented: .constant(true)) {
            keyPointsSheet
                .presentationDetents([.height(180), .medium, .large], selection: $detent)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                .presentationBackground(.regularMaterial)
                .presentationDragIndicator(.visible)
                .interactiveDismissDisabled(true)
        }
    }

    // MARK: Floating header

    @ViewBuilder
    private var floatingHeader: some View {
        StageInfoHeader(raceDay: raceDay, race: race)
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.12), radius: 6, x: 0, y: 2)
            .padding(.horizontal, 12)
            .padding(.top, 4)
    }

    // Velo translúcido bajo el área de estado, con el blur desvaneciéndose hacia
    // abajo (máscara de gradiente opaco→transparente). Solo cubre la franja
    // superior; la tarjeta del header va por encima y queda intacta.
    @ViewBuilder
    private var topBlurVeil: some View {
        Rectangle()
            .fill(.regularMaterial)
            .mask(
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0.0),
                        .init(color: .black, location: 0.55),
                        .init(color: .clear, location: 1.0),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .frame(height: 130)
            .ignoresSafeArea(edges: .top)
            .allowsHitTesting(false)
    }

    // MARK: Error state

    @ViewBuilder
    private var errorState: some View {
        VStack(spacing: 12) {
            Image(systemName: "map")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(LocaleService.t("No se pudo cargar el mapa", "Couldn't load the map"))
                .font(.headline)
            Button {
                Task { await load(force: true) }
            } label: {
                Text(LocaleService.t("Reintentar", "Retry"))
                    .fontWeight(.semibold)
            }
            .buttonStyle(.bordered)
        }
        .padding()
    }

    // MARK: Bottom sheet — cajas de puntos clave

    private var summits: [ProfileSummit] {
        (raceDay.profileSummits ?? []).filter { $0.km != nil }
    }
    private var isTimeTrial: Bool {
        raceDay.primaryType == "itt" || raceDay.primaryType == "ttt"
    }
    private var sprints: [ProfileWaypoint] {
        let wps = raceDay.profileWaypoints ?? []
        return isTimeTrial
            ? wps.filter { $0.type == "intermediate_split" && $0.km != nil }
            : wps.filter { ($0.type == "intermediate_sprint" || $0.type == "bonus_sprint") && $0.km != nil }
    }
    private var sectors: [ProfileWaypoint] {
        (raceDay.profileWaypoints ?? []).filter { ($0.type == "cobblestone" || $0.type == "sterrato") && $0.km != nil }
    }

    @ViewBuilder
    private var keyPointsSheet: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(LocaleService.t("Puntos clave", "Key points"))
                    .font(.headline)
                    .padding(.top, 20)

                if summits.isEmpty && sprints.isEmpty && sectors.isEmpty {
                    Text(LocaleService.t("Sin puntos destacados", "No key points"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if !summits.isEmpty {
                    keyBox(title: "\(LocaleService.t("Puertos", "Climbs")) (\(summits.count))") {
                        ForEach(summits) { s in routeSummitRow(s) }
                    }
                }
                if !sprints.isEmpty {
                    let title = isTimeTrial
                        ? LocaleService.t("Puntos intermedios", "Splits")
                        : LocaleService.t("Sprints", "Sprints")
                    keyBox(title: "\(title) (\(sprints.count))") {
                        ForEach(sprints) { w in routeWaypointRow(w) }
                    }
                }
                if !sectors.isEmpty {
                    keyBox(title: "\(LocaleService.t("Sectores", "Sectors")) (\(sectors.count))") {
                        ForEach(sectors) { w in routeWaypointRow(w) }
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
    }

    @ViewBuilder
    private func keyBox<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    /// Distancia total de referencia para el km inverso (lo que falta a meta),
    /// igual que el perfil: `elevationProfile.distance` con respaldo a `distanceKm`.
    private var totalDistanceForRows: Double {
        raceDay.elevationProfile?.distance ?? raceDay.distanceKm ?? 0
    }
    private var profilePointsForRows: [ElevationPoint] {
        raceDay.elevationProfile?.points ?? []
    }

    // Filas IDÉNTICAS a las del perfil (`SummitRow`/`WaypointRow`): km inverso
    // ("-NN km" = lo que falta para meta; "Meta" si <0,5 km), y para puertos la
    // longitud + pendiente media (`climbStats`); altitud solo como respaldo.
    @ViewBuilder
    private func routeSummitRow(_ s: ProfileSummit) -> some View {
        let stats = s.climbStats(points: profilePointsForRows)
        HStack(spacing: 10) {
            pinDot(color: .mapSummitRed, text: (s.category != nil && s.category != "M") ? s.category! : "•")
            if let name = s.name, !name.isEmpty {
                Text(name).font(.subheadline)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                if let km = s.km {
                    let remaining = totalDistanceForRows - km
                    Text(remaining < 0.5 ? LocaleService.t("Meta", "Finish") : "-\(formatKmIntMap(remaining)) km")
                        .font(.subheadline.weight(.medium))
                }
                if let st = stats {
                    Text("\(formatKmMap(st.lengthKm)) · \(String(format: "%.1f%%", st.avgGradient))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if let alt = s.altitude {
                    Text(formatAltitudeMap(alt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 3)
    }

    @ViewBuilder
    private func routeWaypointRow(_ w: ProfileWaypoint) -> some View {
        HStack(spacing: 10) {
            pinDot(color: waypointColor(w.type), text: waypointDotText(w.type), symbol: waypointDotSymbol(w.type))
            VStack(alignment: .leading, spacing: 1) {
                if let name = w.name, !name.isEmpty {
                    Text(name).font(.subheadline)
                } else {
                    Text(waypointLabel(w.type))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let name = w.name, !name.isEmpty {
                    Text(waypointLabel(w.type))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                if let km = w.km {
                    Text("-\(formatKmIntMap(totalDistanceForRows - km)) km")
                        .font(.subheadline.weight(.medium))
                }
                if let len = w.lengthKm {
                    Text(formatKmMap(len))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 3)
    }

    @ViewBuilder
    private func pinDot(color: Color, text: String? = nil, symbol: String? = nil) -> some View {
        ZStack {
            Circle().fill(color).frame(width: 18, height: 18)
            if let symbol {
                Image(systemName: symbol).font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
            } else if let text {
                Text(text).font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
            }
        }
    }

    // MARK: Loading + projection

    private func load(force: Bool = false) async {
        if !force, loadState == .ready { return }
        loadState = .loading
        guard let urlStr = raceDay.routeGpxUrl, let url = URL(string: urlStr) else {
            loadState = .error
            return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let xml = String(decoding: data, as: UTF8.self)
            // Parsear fuera del hilo principal (GPX grandes).
            let parsed = await Task.detached(priority: .userInitiated) {
                RouteMapLogic.parseGpx(xml)
            }.value
            guard parsed.count >= 2 else {
                loadState = .error
                return
            }
            await MainActor.run {
                self.points = parsed
                self.lineCoords = parsed.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
                self.markers = buildMarkers(parsed)
                self.camera = .region(regionForRoute(parsed))
                self.loadState = .ready
            }
        } catch {
            await MainActor.run { self.loadState = .error }
        }
    }

    private func buildMarkers(_ pts: [RoutePoint]) -> [RouteMarker] {
        var result: [RouteMarker] = []
        let totalKm = raceDay.distanceKm ?? 0
        let kmUnit = LocaleService.shouldShowEnglishContent ? "km" : " km"

        // Salida y meta.
        if let first = pts.first {
            result.append(RouteMarker(
                id: "start",
                coordinate: CLLocationCoordinate2D(latitude: first.lat, longitude: first.lon),
                kind: .start,
                calloutTitle: LocaleService.t("Salida", "Start"),
                calloutSubtitle: "km 0"
            ))
        }
        if let last = pts.last {
            result.append(RouteMarker(
                id: "finish",
                coordinate: CLLocationCoordinate2D(latitude: last.lat, longitude: last.lon),
                kind: .finish,
                calloutTitle: LocaleService.t("Meta", "Finish"),
                calloutSubtitle: totalKm > 0 ? "km \(formatKmIntMap(totalKm))" : nil
            ))
        }

        // Puertos — snap por altitud.
        for s in summits {
            guard let km = s.km else { continue }
            let alt = s.altitude.map(Double.init)
            guard let ll = RouteMapLogic.markerLatLng(pts, officialKm: km, officialTotal: totalKm, altTarget: alt) else { continue }
            let cat = (s.category != nil && s.category != "M") ? " · \(LocaleService.t("Cat.", "Cat.")) \(s.category!)" : ""
            let altTxt = s.altitude.map { " · \(formatAltitudeMap($0))" } ?? ""
            result.append(RouteMarker(
                id: "summit-\(km)-\(s.name ?? "")",
                coordinate: CLLocationCoordinate2D(latitude: ll.lat, longitude: ll.lon),
                kind: .summit(s),
                calloutTitle: s.name ?? LocaleService.t("Puerto", "Climb"),
                calloutSubtitle: "\(formatKmIntMap(km))\(kmUnit)\(cat)\(altTxt)"
            ))
        }

        // Sprints / puntos intermedios — escalado por km.
        for w in sprints {
            guard let km = w.km,
                  let ll = RouteMapLogic.kmToLatLng(pts, officialKm: km, officialTotal: totalKm) else { continue }
            result.append(RouteMarker(
                id: "wp-\(km)-\(w.type)",
                coordinate: CLLocationCoordinate2D(latitude: ll.lat, longitude: ll.lon),
                kind: .waypoint(w),
                calloutTitle: w.name ?? waypointLabel(w.type),
                calloutSubtitle: "\(waypointLabel(w.type)) · \(formatKmIntMap(km))\(kmUnit)"
            ))
        }

        // Sectores (pavé / sterrato) — escalado por km.
        for w in sectors {
            guard let km = w.km,
                  let ll = RouteMapLogic.kmToLatLng(pts, officialKm: km, officialTotal: totalKm) else { continue }
            result.append(RouteMarker(
                id: "sec-\(km)-\(w.type)",
                coordinate: CLLocationCoordinate2D(latitude: ll.lat, longitude: ll.lon),
                kind: .waypoint(w),
                calloutTitle: w.name ?? waypointLabel(w.type),
                calloutSubtitle: "\(waypointLabel(w.type)) · \(formatKmIntMap(km))\(kmUnit)"
            ))
        }

        return result
    }

    /// Región que encuadra toda la traza, con un margen del 15 %.
    private func regionForRoute(_ pts: [RoutePoint]) -> MKCoordinateRegion {
        let lats = pts.map(\.lat), lons = pts.map(\.lon)
        guard let minLat = lats.min(), let maxLat = lats.max(),
              let minLon = lons.min(), let maxLon = lons.max() else {
            return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
                                      span: MKCoordinateSpan(latitudeDelta: 1, longitudeDelta: 1))
        }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2,
                                            longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(
            latitudeDelta: max(0.01, (maxLat - minLat) * 1.3),
            longitudeDelta: max(0.01, (maxLon - minLon) * 1.3)
        )
        return MKCoordinateRegion(center: center, span: span)
    }

    // MARK: Waypoint helpers (color/letra/label)

    private func waypointColor(_ type: String) -> Color {
        switch type {
        case "bonus_sprint":        return .mapBonusSprint
        case "intermediate_sprint": return .mapIntSprint
        case "intermediate_split":  return .mapIntSplit
        case "cobblestone":         return .mapCobblestone
        case "sterrato":            return .mapSterratoTan
        default:                    return .gray
        }
    }
    private func waypointDotText(_ type: String) -> String? {
        switch type {
        case "bonus_sprint":        return "B"
        case "intermediate_sprint": return "S"
        default:                    return nil
        }
    }
    private func waypointDotSymbol(_ type: String) -> String? {
        switch type {
        case "intermediate_split":  return "stopwatch.fill"
        case "cobblestone":         return "square.grid.3x3.fill"
        case "sterrato":            return "circle.dotted"
        default:                    return nil
        }
    }
    private func waypointLabel(_ type: String) -> String {
        switch type {
        case "bonus_sprint":        return LocaleService.t("Bonificación", "Bonus sprint")
        case "intermediate_sprint": return LocaleService.t("Sprint intermedio", "Intermediate sprint")
        case "intermediate_split":  return LocaleService.t("Punto intermedio", "Split")
        case "cobblestone":         return LocaleService.t("Pavé", "Cobbles")
        case "sterrato":            return LocaleService.t("Sterrato", "Gravel")
        default:                    return type
        }
    }
}

// MARK: - Colors (mapa)

private extension Color {
    static let mapSummitRed   = Color(hex: "c53030")
    static let mapBonusSprint = Color(hex: "f9ab00")
    static let mapIntSprint   = Color(hex: "0f9d58")
    static let mapIntSplit    = Color(hex: "00838f")
    static let mapCobblestone = Color(hex: "b0b0b0")
    static let mapSterratoTan = Color(hex: "c8a870")
    static let routeStartGreen = Color(hex: "0f9d58")
    static let routeFinishRed  = Color(hex: "c53030")
}

// MARK: - Formatting (file-private; idioma de CONTENIDO, como el perfil)

private func formatAltitudeMap(_ alt: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    let isEn = LocaleService.shouldShowEnglishContent
    f.groupingSeparator = isEn ? "," : "."
    f.locale = Locale(identifier: isEn ? "en_US" : "es_ES")
    return (f.string(from: NSNumber(value: alt)) ?? "\(alt)") + " m"
}

private func formatKmIntMap(_ km: Double) -> String {
    "\(Int(km.rounded()))"
}

private func formatKmMap(_ km: Double) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.minimumFractionDigits = km.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 1
    f.maximumFractionDigits = 1
    f.locale = Locale(identifier: LocaleService.shouldShowEnglishContent ? "en_US" : "es_ES")
    return (f.string(from: NSNumber(value: km)) ?? "\(km)") + " km"
}
