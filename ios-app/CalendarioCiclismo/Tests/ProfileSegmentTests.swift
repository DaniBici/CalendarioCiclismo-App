import XCTest
@testable import CalendarioCiclismo

/// Desnivel acumulado de un tramo del perfil.
final class ProfileSegmentTests: XCTestCase {

    private let points = [
        ElevationPoint(km: 0, alt: 100), ElevationPoint(km: 10, alt: 600),
        ElevationPoint(km: 20, alt: 300), ElevationPoint(km: 30, alt: 500),
    ]

    private func interpolateAlt(_ km: Double) -> Double {
        for index in 0..<(points.count - 1) {
            let a = points[index], b = points[index + 1]
            if km >= a.km && km <= b.km {
                return Double(a.alt) + (km - a.km) / (b.km - a.km) * Double(b.alt - a.alt)
            }
        }
        return Double(points[points.count - 1].alt)
    }

    func test_accumulatesAscentAndDescentWithInterpolatedEnds() throws {
        let stats = try XCTUnwrap(ProfileSegment.stats(points: points, from: 5, to: 25, interpolateAlt: interpolateAlt))
        XCTAssertEqual(stats.distance, 20)
        XCTAssertEqual(stats.startAlt, 350)
        XCTAssertEqual(stats.endAlt, 400)
        XCTAssertEqual(stats.ascent, 350)
        XCTAssertEqual(stats.descent, 300)
        XCTAssertEqual(stats.gradient, 0.25, accuracy: 0.005)
    }
}
