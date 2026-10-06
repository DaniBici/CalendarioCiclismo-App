import XCTest
@testable import CalendarioCiclismo

@MainActor
final class RegionServiceTests: XCTestCase {

    // MARK: - suggestedRegion (bucket de push_subscriptions.region)

    func test_suggestedRegion() {
        let cases: [(tz: String, region: RegionService.RegionPreference)] = [
            ("Europe/Madrid", .spain),
            ("Atlantic/Canary", .spain),
            // Aunque empieza por Africa/, está en SPAIN_TZS — España incluye Ceuta.
            ("Africa/Ceuta", .spain),
            ("Europe/Paris", .europe),
            ("Atlantic/Reykjavik", .europe),
            ("America/New_York", .americas),
            ("Pacific/Honolulu", .americas),
            ("Asia/Tokyo", .asia),
            ("Australia/Sydney", .asia),
            ("Pacific/Auckland", .asia),
            ("Africa/Lagos", .africa),
            // TZ desconocida → España: preserva el baseline sin importar la TZ del dispositivo.
            ("UTC", .spain),
            ("Etc/Unknown", .spain),
        ]
        for c in cases {
            XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: c.tz), c.region, c.tz)
        }
    }

    // MARK: - allowedBroadcastGroups (paridad con la web)

    func test_allowedBroadcastGroups() {
        let cases: [(tz: String, groups: Set<String>)] = [
            ("Europe/Madrid", ["ALL", "ES", "EUROPA"]),
            // Un usuario francés no ve los canales de Bélgica o Italia.
            ("Europe/Paris", ["ALL", "FR", "EUROPA"]),
            // La marca paneuropea no opera en Reino Unido ni Irlanda.
            ("Europe/London", ["ALL", "UK_IE"]),
            // TZ europea sin grupo fino (p. ej. Moscú) → ALL + EUROPA.
            ("Europe/Moscow", ["ALL", "EUROPA"]),
            ("America/New_York", ["ALL", "NORTEAM"]),
            ("America/Argentina/Buenos_Aires", ["ALL", "LATAM"]),
            ("Asia/Tokyo", ["ALL", "ASIAPAC"]),
            ("Africa/Lagos", ["ALL", "AFRICA"]),
            ("Africa/Cairo", ["ALL", "MENA"]),
            ("UTC", ["ALL"]),
        ]
        for c in cases {
            XCTAssertEqual(RegionService.allowedBroadcastGroups(timeZoneId: c.tz), c.groups, c.tz)
        }
    }

    func test_isEuropean() {
        let cases: [(tz: String, expected: Bool)] = [
            ("Europe/Madrid", true),
            ("Atlantic/Reykjavik", true),
            ("Asia/Istanbul", true),
            ("America/New_York", false),
            ("Asia/Tokyo", false),
            ("UTC", false),
        ]
        for c in cases {
            XCTAssertEqual(RegionService.isEuropean(timeZoneId: c.tz), c.expected, c.tz)
        }
    }
}
