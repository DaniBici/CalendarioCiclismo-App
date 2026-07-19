import XCTest
@testable import CalendarioCiclismo

/// Tests de la lógica pura del mapa del recorrido, portada de `js/mapa-pub.js`.
/// Cuando se porte Android, su `RouteMapLogicTest.kt` debe ser el espejo 1:1.
final class RouteMapLogicTests: XCTestCase {

    // MARK: - haversineKm

    func testHaversineUnGradoDeLatitudSonUnos111Km() {
        // 1° de latitud ≈ 111.19 km en el meridiano.
        let d = RouteMapLogic.haversineKm(0, 0, 1, 0)
        XCTAssertEqual(d, 111.19, accuracy: 0.5)
    }

    func testHaversineMismoPuntoEsCero() {
        XCTAssertEqual(RouteMapLogic.haversineKm(40.4, -3.7, 40.4, -3.7), 0, accuracy: 1e-9)
    }

    // MARK: - parseGpx

    func testParseGpxBasicoAcumulaKmYConservaEle() {
        // 3 trkpt en línea sobre el ecuador: (0,0) (0,1) (0,2).
        let xml = """
        <gpx><trk><trkseg>
          <trkpt lat="0" lon="0"><ele>10</ele></trkpt>
          <trkpt lat="0" lon="1"><ele>20</ele></trkpt>
          <trkpt lat="0" lon="2"><ele>30</ele></trkpt>
        </trkseg></trk></gpx>
        """
        let pts = RouteMapLogic.parseGpx(xml)
        XCTAssertEqual(pts.count, 3)
        XCTAssertEqual(pts[0].km, 0, accuracy: 1e-9)
        // km creciente y total ≈ suma de los dos tramos de ~111 km.
        XCTAssertGreaterThan(pts[1].km, pts[0].km)
        XCTAssertGreaterThan(pts[2].km, pts[1].km)
        let expectedTotal = RouteMapLogic.haversineKm(0, 0, 0, 1) + RouteMapLogic.haversineKm(0, 1, 0, 2)
        XCTAssertEqual(pts[2].km, expectedTotal, accuracy: 0.01)
        XCTAssertEqual(pts[0].ele, 10)
        XCTAssertEqual(pts[2].ele, 30)
    }

    func testParseGpxFallbackARtept() {
        // Sin trkpt, solo rtept → debe producir puntos.
        let xml = """
        <gpx><rte>
          <rtept lat="0" lon="0"/>
          <rtept lat="0" lon="1"/>
        </rte></gpx>
        """
        let pts = RouteMapLogic.parseGpx(xml)
        XCTAssertEqual(pts.count, 2)
        XCTAssertNil(pts[0].ele)
    }

    func testParseGpxSinEleDejaEleNil() {
        let xml = """
        <gpx><trk><trkseg>
          <trkpt lat="0" lon="0"/>
          <trkpt lat="0" lon="1"/>
        </trkseg></trk></gpx>
        """
        let pts = RouteMapLogic.parseGpx(xml)
        XCTAssertEqual(pts.count, 2)
        XCTAssertTrue(pts.allSatisfy { $0.ele == nil })
    }

    func testParseGpxVacioDevuelveVacio() {
        XCTAssertTrue(RouteMapLogic.parseGpx("<gpx></gpx>").isEmpty)
        XCTAssertTrue(RouteMapLogic.parseGpx("no es xml").isEmpty)
    }

    func testParseGpxTrkptTienePrioridadSobreRtept() {
        let xml = """
        <gpx>
          <rte><rtept lat="10" lon="10"/></rte>
          <trk><trkseg>
            <trkpt lat="0" lon="0"/>
            <trkpt lat="0" lon="1"/>
          </trkseg></trk>
        </gpx>
        """
        let pts = RouteMapLogic.parseGpx(xml)
        XCTAssertEqual(pts.count, 2)
        XCTAssertEqual(pts[0].lat, 0)  // del trk, no del rte
    }

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

    func testKmToLatLngVacioDevuelveNil() {
        XCTAssertNil(RouteMapLogic.kmToLatLng([], officialKm: 10, officialTotal: 100))
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

    func testMarkerLatLngSinEleCaeEnKmToLatLng() {
        // Mismos puntos pero sin altitud → debe devolver exactamente kmToLatLng.
        var pts: [RoutePoint] = []
        var cum = 0.0
        var prev: (Double, Double)? = nil
        for i in 0...10 {
            let lat = Double(i)
            if let p = prev { cum += RouteMapLogic.haversineKm(p.0, p.1, lat, 0) }
            pts.append(RoutePoint(lat: lat, lon: 0, km: cum, ele: nil))
            prev = (lat, 0)
        }
        let viaMarker = RouteMapLogic.markerLatLng(pts, officialKm: 50, officialTotal: 100, altTarget: 200)
        let viaKm = RouteMapLogic.kmToLatLng(pts, officialKm: 50, officialTotal: 100)
        XCTAssertEqual(viaMarker, viaKm)
    }

    func testMarkerLatLngConAltTargetNilCaeEnKmToLatLng() {
        var pts: [RoutePoint] = []
        pts.append(RoutePoint(lat: 0, lon: 0, km: 0, ele: 100))
        pts.append(RoutePoint(lat: 1, lon: 0, km: RouteMapLogic.haversineKm(0, 0, 1, 0), ele: 200))
        let viaMarker = RouteMapLogic.markerLatLng(pts, officialKm: 0, officialTotal: 0, altTarget: nil)
        let viaKm = RouteMapLogic.kmToLatLng(pts, officialKm: 0, officialTotal: 0)
        XCTAssertEqual(viaMarker, viaKm)
    }
}
