import XCTest
@testable import CalendarioCiclismo

@MainActor
final class RegionServiceTests: XCTestCase {

    // MARK: - suggestedRegion (bucket de push_subscriptions.region)

    func test_madridSuggestsSpain() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Europe/Madrid"), .spain)
    }

    func test_canariasSuggestsSpain() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Atlantic/Canary"), .spain)
    }

    func test_ceutaSuggestsSpain() {
        // Aunque empieza por Africa/, está en SPAIN_TZS — España incluye Ceuta.
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Africa/Ceuta"), .spain)
    }

    func test_parisSuggestsEurope() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Europe/Paris"), .europe)
    }

    func test_reykjavikSuggestsEurope() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Atlantic/Reykjavik"), .europe)
    }

    func test_newYorkSuggestsAmericas() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "America/New_York"), .americas)
    }

    func test_honoluluSuggestsAmericas() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Pacific/Honolulu"), .americas)
    }

    func test_tokyoSuggestsAsia() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Asia/Tokyo"), .asia)
    }

    func test_sydneySuggestsAsia() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Australia/Sydney"), .asia)
    }

    func test_aucklandSuggestsAsia() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Pacific/Auckland"), .asia)
    }

    func test_lagosSuggestsAfrica() {
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Africa/Lagos"), .africa)
    }

    func test_unknownTzFallsBackToSpain() {
        // Preserva el baseline sin importar la TZ del dispositivo.
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "UTC"), .spain)
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Etc/Unknown"), .spain)
    }

    func test_neverSuggestsAll() {
        // `.all` no es un bucket detectable automáticamente.
        let tzs = ["Europe/Madrid", "Europe/Paris", "America/New_York",
                   "Asia/Tokyo", "Africa/Lagos", "UTC"]
        for tz in tzs {
            XCTAssertNotEqual(
                RegionService.suggestedRegion(timeZoneId: tz),
                .all,
                "TZ \(tz) sugirió .all"
            )
        }
    }

    // MARK: - allowedBroadcastGroups (paridad con la web)

    func test_spain_includesBaseline() {
        let groups = RegionService.allowedBroadcastGroups(timeZoneId: "Europe/Madrid")
        XCTAssertEqual(groups, ["ALL", "ES", "EUROPA"])
    }

    func test_france_showsOnlyItsFineGroup() {
        // Paridad web: un usuario francés no ve los canales de Bélgica o Italia.
        let groups = RegionService.allowedBroadcastGroups(timeZoneId: "Europe/Paris")
        XCTAssertEqual(groups, ["ALL", "FR", "EUROPA"])
    }

    func test_uk_ie_excludesPanEuropean() {
        // La marca paneuropea no opera en Reino Unido ni Irlanda.
        let groups = RegionService.allowedBroadcastGroups(timeZoneId: "Europe/London")
        XCTAssertEqual(groups, ["ALL", "UK_IE"])
    }

    func test_uncoveredEurope_showsPanEuropean() {
        // TZ europea sin grupo fino (p. ej. Moscú) → ALL + EUROPA.
        let groups = RegionService.allowedBroadcastGroups(timeZoneId: "Europe/Moscow")
        XCTAssertEqual(groups, ["ALL", "EUROPA"])
    }

    func test_americas_showsOnlyItsFineGroup() {
        XCTAssertEqual(
            RegionService.allowedBroadcastGroups(timeZoneId: "America/New_York"),
            ["ALL", "NORTEAM"]
        )
        XCTAssertEqual(
            RegionService.allowedBroadcastGroups(timeZoneId: "America/Argentina/Buenos_Aires"),
            ["ALL", "LATAM"]
        )
    }

    func test_asia_africa_and_mena() {
        XCTAssertEqual(
            RegionService.allowedBroadcastGroups(timeZoneId: "Asia/Tokyo"),
            ["ALL", "ASIAPAC"]
        )
        XCTAssertEqual(
            RegionService.allowedBroadcastGroups(timeZoneId: "Africa/Lagos"),
            ["ALL", "AFRICA"]
        )
        XCTAssertEqual(
            RegionService.allowedBroadcastGroups(timeZoneId: "Africa/Cairo"),
            ["ALL", "MENA"]
        )
    }

    func test_unknownTz_showsOnlyGlobal() {
        XCTAssertEqual(RegionService.allowedBroadcastGroups(timeZoneId: "UTC"), ["ALL"])
    }

    func test_isEuropean() {
        XCTAssertTrue(RegionService.isEuropean(timeZoneId: "Europe/Madrid"))
        XCTAssertTrue(RegionService.isEuropean(timeZoneId: "Atlantic/Reykjavik"))
        XCTAssertTrue(RegionService.isEuropean(timeZoneId: "Asia/Istanbul"))
        XCTAssertFalse(RegionService.isEuropean(timeZoneId: "America/New_York"))
        XCTAssertFalse(RegionService.isEuropean(timeZoneId: "Asia/Tokyo"))
        XCTAssertFalse(RegionService.isEuropean(timeZoneId: "UTC"))
    }
}
