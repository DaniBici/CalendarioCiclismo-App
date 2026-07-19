import Foundation

/// Punto de la traza GPX: coordenada + km acumulado (haversine) + altitud opcional.
struct RoutePoint: Equatable {
    let lat: Double
    let lon: Double
    let km: Double
    let ele: Double?
}

/// Coordenada simple (resultado de proyectar un km sobre la traza).
struct LatLng: Equatable {
    let lat: Double
    let lon: Double
}

/// Lógica pura del mapa del recorrido, portada 1:1 de `js/mapa-pub.js` (web,
/// Leaflet). Sin estado, sin dependencias de UI ni de red → testeable en
/// aislamiento (espejo de `UciResultsLogic`). El espejo Kotlin se hará al
/// portar Android.
///
/// ⚠️ SIN segmentación de la traza: los GPX de ASO (fragmentados, que requerían
/// cortar en `<trkseg>` y en saltos > 1 km) se retiraron; los GPX limpios son
/// trazas continuas → una sola lista de puntos y una sola polilínea. Si en el
/// futuro reaparecieran saltos reales, habría que reintroducir la segmentación.
enum RouteMapLogic {

    // Ventana de búsqueda (km de GPX) alrededor del km escalado para el snap.
    static let snapWindowKm = 2.5
    // 1 m de diferencia de altitud pesa como `snapKmPenalty` km de desvío en el
    // score; alto = prioriza estar cerca del km esperado, bajo = prioriza clavar
    // la altitud. 8 da buen equilibrio (verificado en el circuito de Montjuïc).
    static let snapKmPenalty = 8.0

    // MARK: - Haversine

    /// Distancia en km entre dos coordenadas (radio terrestre 6371 km).
    static func haversineKm(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
        let r = 6371.0
        func toRad(_ x: Double) -> Double { x * .pi / 180 }
        let dLat = toRad(bLat - aLat)
        let dLon = toRad(bLon - aLon)
        let h = sin(dLat / 2) * sin(dLat / 2)
            + cos(toRad(aLat)) * cos(toRad(bLat)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * asin(min(1, sqrt(h)))
    }

    // MARK: - GPX parsing

    /// Parsea un GPX crudo a una lista plana de `RoutePoint` con km acumulado por
    /// haversine en el orden del fichero. Usa `<trkpt>`; si no hay, cae a
    /// `<rtept>` (mismo fallback que la web). Devuelve [] si no hay puntos.
    static func parseGpx(_ xml: String) -> [RoutePoint] {
        let raw = parseTrackPoints(xml)
        guard !raw.isEmpty else { return [] }

        var points: [RoutePoint] = []
        points.reserveCapacity(raw.count)
        var cum = 0.0
        var prev: (lat: Double, lon: Double)? = nil
        for p in raw {
            if let pr = prev {
                cum += haversineKm(pr.lat, pr.lon, p.lat, p.lon)
            }
            points.append(RoutePoint(lat: p.lat, lon: p.lon, km: cum, ele: p.ele))
            prev = (p.lat, p.lon)
        }
        return points
    }

    /// Extrae los `<trkpt>`/`<rtept>` (lat, lon, ele?) en orden de aparición.
    private static func parseTrackPoints(_ xml: String) -> [(lat: Double, lon: Double, ele: Double?)] {
        guard let data = xml.data(using: .utf8) else { return [] }
        let parser = XMLParser(data: data)
        let delegate = GpxParserDelegate()
        parser.delegate = delegate
        parser.parse()
        // Preferir trkpt; si el GPX solo trae rtept, usar esos.
        return delegate.trkpts.isEmpty ? delegate.rtepts : delegate.trkpts
    }

    // MARK: - Projection

    /// Proyecta un km de carrera (escalado a la longitud real del GPX) a `LatLng`.
    /// Escalado proporcional `officialKm/officialTotal × gpxTotal` + interpolación
    /// lineal entre los dos vértices que rodean el km objetivo.
    static func kmToLatLng(_ points: [RoutePoint], officialKm: Double, officialTotal: Double) -> LatLng? {
        guard let last = points.last else { return nil }
        let gpxTotal = last.km
        let targetKm = officialTotal > 0 ? (officialKm / officialTotal) * gpxTotal : officialKm
        var i = 1
        while i < points.count {
            if points[i].km >= targetKm {
                let a = points[i - 1], b = points[i]
                let span = (b.km - a.km) == 0 ? 1e-9 : (b.km - a.km)
                let f = (targetKm - a.km) / span
                return LatLng(lat: a.lat + (b.lat - a.lat) * f,
                              lon: a.lon + (b.lon - a.lon) * f)
            }
            i += 1
        }
        return LatLng(lat: last.lat, lon: last.lon)
    }

    /// Proyecta un punto-clave COMBINANDO km y altitud. En circuitos repetidos
    /// (mismo lugar pasado N veces) el escalado proporcional puro desvía cada
    /// pasada; si conocemos la altitud (`altTarget`), buscamos el punto del GPX
    /// que mejor case la altitud DENTRO de una ventana de km → cada pasada hace
    /// snap a SU cima real. Sin altitud o sin `ele` en el GPX → fallback al
    /// escalado proporcional (`kmToLatLng`), que va bien en lineales.
    static func markerLatLng(_ points: [RoutePoint], officialKm: Double, officialTotal: Double, altTarget: Double?) -> LatLng? {
        guard let last = points.last else { return nil }
        let hasEle = altTarget != nil && points.contains { $0.ele != nil }
        guard hasEle, let target = altTarget else {
            return kmToLatLng(points, officialKm: officialKm, officialTotal: officialTotal)
        }
        let gpxTotal = last.km
        let center = officialTotal > 0 ? (officialKm / officialTotal) * gpxTotal : officialKm
        var best: RoutePoint? = nil
        var bestScore = Double.infinity
        for p in points {
            guard let ele = p.ele else { continue }
            let dKm = abs(p.km - center)
            if dKm > snapWindowKm { continue }
            let score = abs(ele - target) + dKm * snapKmPenalty
            if score < bestScore { bestScore = score; best = p }
        }
        if let b = best { return LatLng(lat: b.lat, lon: b.lon) }
        return kmToLatLng(points, officialKm: officialKm, officialTotal: officialTotal)
    }
}

// MARK: - XMLParser delegate

/// Recoge los `<trkpt>`/`<rtept>` de un GPX. `lat`/`lon` son atributos; `<ele>`
/// es texto hijo, así que se acumula el contenido del elemento `ele` en curso.
private final class GpxParserDelegate: NSObject, XMLParserDelegate {
    var trkpts: [(lat: Double, lon: Double, ele: Double?)] = []
    var rtepts: [(lat: Double, lon: Double, ele: Double?)] = []

    private var curLat: Double?
    private var curLon: Double?
    private var curEle: Double?
    private var curKind: Kind?
    private var inEle = false
    private var eleText = ""

    private enum Kind { case trk, rte }

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String]) {
        let name = elementName.lowercased()
        if name == "trkpt" || name == "rtept" {
            curKind = name == "trkpt" ? .trk : .rte
            curLat = attributeDict["lat"].flatMap(Double.init)
            curLon = attributeDict["lon"].flatMap(Double.init)
            curEle = nil
        } else if name == "ele" {
            inEle = true
            eleText = ""
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inEle { eleText += string }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        let name = elementName.lowercased()
        if name == "ele" {
            inEle = false
            curEle = Double(eleText.trimmingCharacters(in: .whitespacesAndNewlines))
        } else if name == "trkpt" || name == "rtept" {
            if let lat = curLat, let lon = curLon, lat.isFinite, lon.isFinite {
                let tuple = (lat: lat, lon: lon, ele: curEle)
                if curKind == .trk { trkpts.append(tuple) } else { rtepts.append(tuple) }
            }
            curKind = nil
            curLat = nil
            curLon = nil
            curEle = nil
        }
    }
}
