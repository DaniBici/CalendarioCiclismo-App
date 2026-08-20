import XCTest
@testable import CalendarioCiclismo

@MainActor
final class RegionServiceTests: XCTestCase {

    // MARK: - allowedBroadcastGroups

    func test_spain_includesBaseline() {
        let groups = RegionService.RegionPreference.spain.allowedBroadcastGroups
        XCTAssertTrue(groups.contains("ALL"))
        XCTAssertTrue(groups.contains("ES"))
        XCTAssertTrue(groups.contains("EUROPA"))
        XCTAssertEqual(groups.count, 3, "El baseline gratuito de SPAIN debe ser exactamente {ALL, ES, EUROPA}")
    }

    func test_europe_includesAllEuropeanGroups() {
        let groups = RegionService.RegionPreference.europe.allowedBroadcastGroups
        for required in ["ALL", "EUROPA", "ES", "PT", "FR", "BE", "NL", "IT",
                         "DE_AT_CH", "UK_IE", "SCANDI", "EE"] {
            XCTAssertTrue(groups.contains(required), "EUROPE debería incluir \(required)")
        }
    }

    func test_americas_excludesEurope() {
        let groups = RegionService.RegionPreference.americas.allowedBroadcastGroups
        XCTAssertEqual(groups, ["ALL", "NORTEAM", "LATAM"])
    }

    func test_asia_includesMENA() {
        let groups = RegionService.RegionPreference.asia.allowedBroadcastGroups
        XCTAssertTrue(groups.contains("ASIAPAC"))
        XCTAssertTrue(groups.contains("MENA"), "MENA cubre Oriente Medio y se incluye en ASIA")
    }

    func test_africa_includesMENA() {
        let groups = RegionService.RegionPreference.africa.allowedBroadcastGroups
        XCTAssertTrue(groups.contains("AFRICA"))
        XCTAssertTrue(groups.contains("MENA"), "MENA cubre Norte de África y se incluye en AFRICA")
    }

    func test_all_unionContainsEverything() {
        let allGroups = RegionService.RegionPreference.all.allowedBroadcastGroups
        // El bucket "ALL" del cliente debe ser superset de cualquier región concreta.
        for region in [RegionService.RegionPreference.spain, .europe, .americas, .asia, .africa] {
            XCTAssertTrue(
                region.allowedBroadcastGroups.isSubset(of: allGroups),
                "ALL no contiene los grupos de \(region.rawValue)"
            )
        }
    }

    // MARK: - suggestedRegion

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
        // Preserva el baseline gratuito sin importar la TZ del dispositivo.
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "UTC"), .spain)
        XCTAssertEqual(RegionService.suggestedRegion(timeZoneId: "Etc/Unknown"), .spain)
    }

    func test_neverSuggestsAll() {
        // .all solo se elige manualmente desde Ajustes.
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

    // MARK: - availableCountryGroups (sub-selector)

    func test_spain_singleCountryGroup() {
        XCTAssertEqual(RegionService.RegionPreference.spain.availableCountryGroups, ["ES"])
    }

    func test_europe_exposesAllEuropeanFineGroups() {
        let groups = RegionService.RegionPreference.europe.availableCountryGroups
        for expected in ["ES", "PT", "FR", "BE", "NL", "IT",
                         "DE_AT_CH", "UK_IE", "SCANDI", "EE"] {
            XCTAssertTrue(groups.contains(expected), "EUROPE debería exponer \(expected)")
        }
        // EUROPA (paneuropeo) NO debe aparecer como país elegible.
        XCTAssertFalse(groups.contains("EUROPA"))
        XCTAssertFalse(groups.contains("ALL"))
    }

    func test_americas_exposesTwoGroups() {
        XCTAssertEqual(
            Set(RegionService.RegionPreference.americas.availableCountryGroups),
            Set(["NORTEAM", "LATAM"])
        )
    }

    func test_all_doesNotExposeSubSelector() {
        // Por diseño: en ALL se mantiene la detección automática por TZ.
        XCTAssertTrue(RegionService.RegionPreference.all.availableCountryGroups.isEmpty)
    }

    func test_availableCountryGroups_isSubsetOfAllowedBroadcastGroups() {
        for bucket in RegionService.RegionPreference.allCases {
            for group in bucket.availableCountryGroups {
                XCTAssertTrue(
                    bucket.allowedBroadcastGroups.contains(group),
                    "\(group) está en availableCountryGroups de \(bucket.rawValue) pero no en allowedBroadcastGroups"
                )
            }
        }
    }
}
