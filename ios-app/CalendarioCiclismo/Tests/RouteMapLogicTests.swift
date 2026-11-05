import XCTest
@testable import CalendarioCiclismo

/// Proyección del km oficial sobre la traza del mapa del recorrido, portada de
/// `js/mapa-pub.js`.
final class RouteMapLogicTests: XCTestCase {

    // MARK: - kmToLatLng (caso lineal)

    func testKmToLatLngProyectaPorEscaladoEInterpolacion() {
        // Traza recta: lat crece linealmente con la longitud. La latitud sirve de
        // "marca de progreso" para verificar la interpolación.
        var pts: [RoutePoint] = []
        var cum = 0.0
        var prev: (Double, Double)? = nil
        for i in 0...10 {
            let lat = Double(i)            // 0..10
            let lon = 0.0
            if let p = prev { cum += RouteMapLogic.haversineKm(p.0, p.1, lat, lon) }
            pts.append(RoutePoint(lat: lat, lon: lon, km: cum, ele: nil))
            prev = (lat, lon)
        }
        // officialTotal=100; pedir el km 50 → mitad de la traza → lat ≈ 5.
        let mid = RouteMapLogic.kmToLatLng(pts, officialKm: 50, officialTotal: 100)
        XCTAssertNotNil(mid)
        XCTAssertEqual(mid!.lat, 5.0, accuracy: 0.05)
        XCTAssertEqual(mid!.lon, 0.0, accuracy: 1e-9)

        // km 0 → inicio, km 100 → final.
        let start = RouteMapLogic.kmToLatLng(pts, officialKm: 0, officialTotal: 100)
        XCTAssertEqual(start!.lat, 0.0, accuracy: 0.05)
        let end = RouteMapLogic.kmToLatLng(pts, officialKm: 100, officialTotal: 100)
        XCTAssertEqual(end!.lat, 10.0, accuracy: 0.05)
    }

    // MARK: - markerLatLng (snap por altitud, circuito)

    func testMarkerLatLngSnapEligeLaPasadaConAltitudMasCercana() {
        // Circuito: la traza pasa dos veces por longitudes parecidas pero a
        // distinta altitud. Construimos puntos con lon como identificador de la
        // pasada (pasada 1 = lon ~0.00x, pasada 2 = lon ~1.00x) y altitud que
        // sube en la 2ª pasada. El snap por altTarget alto debe caer en la 2ª.
        var pts: [RoutePoint] = []
        var cum = 0.0
        var prev: (Double, Double)? = nil
        func push(_ lat: Double, _ lon: Double, _ ele: Double) {
            if let p = prev { cum += RouteMapLogic.haversineKm(p.0, p.1, lat, lon) }
            pts.append(RoutePoint(lat: lat, lon: lon, km: cum, ele: ele))
            prev = (lat, lon)
        }
        // Pasada 1 (altitudes bajas 100..130), avanza en lat.
        push(0.000, 0.0, 100)
        push(0.001, 0.0, 110)
        push(0.002, 0.0, 120)
        push(0.003, 0.0, 130)
        // Pasada 2 (altitudes altas 300..360), sigue avanzando en lat → km mayor.
        push(0.004, 0.0, 300)
        push(0.005, 0.0, 330)
        push(0.006, 0.0, 360)

        let total = pts.last!.km
        // El "summit" oficial está hacia la mitad del recorrido (ofilcialKm = total*0.5,
        // que escalado cae cerca de la frontera entre pasadas), pero su altitud (350)
        // es claramente la de la 2ª pasada → el snap debe elegir un punto alto.
        let officialKm = total * 0.5
        let ll = RouteMapLogic.markerLatLng(pts, officialKm: officialKm, officialTotal: total, altTarget: 350)
        XCTAssertNotNil(ll)
        // El punto elegido debe ser uno de los de altitud alta (lat >= 0.004).
        let chosen = pts.first { $0.lat == ll!.lat && $0.lon == ll!.lon }
        XCTAssertNotNil(chosen)
        XCTAssertGreaterThanOrEqual(chosen!.ele ?? 0, 300)
    }
}
