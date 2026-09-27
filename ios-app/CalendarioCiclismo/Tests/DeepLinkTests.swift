import XCTest
@testable import CalendarioCiclismo

@MainActor
final class DeepLinkTests: XCTestCase {
    func testMarketTabAndTeamDetailParseFromPushPayload() {
        XCTAssertEqual(NotificationManager.DeepLink.parse("transfers"), .tab(2))
        XCTAssertEqual(NotificationManager.DeepLink.parse("team/team_123"), .team("team_123"))
    }

    func testWidgetResultsLinkParsesStageFinalAndDoubleSector() {
        XCTAssertEqual(
            NotificationManager.DeepLink.fromURL(URL(string: "calendariociclismo://results/race_1/5")!),
            .results(raceId: "race_1", stageNumber: 5, stageSuffix: nil)
        )
        XCTAssertEqual(NotificationManager.DeepLink.parse("results/race_1/final"),
                       .results(raceId: "race_1", stageNumber: nil, stageSuffix: nil))
        XCTAssertEqual(NotificationManager.DeepLink.parse("results/race_1/3B"),
                       .results(raceId: "race_1", stageNumber: 3, stageSuffix: "B"))
        XCTAssertNil(NotificationManager.DeepLink.parse("results/race_1/x"))
        XCTAssertNil(NotificationManager.DeepLink.fromURL(URL(string: "calendariociclismo://results/race_1")!))
    }

    func testTeamDetailParsesFromCustomURL() {
        XCTAssertEqual(
            NotificationManager.DeepLink.fromURL(URL(string: "calendariociclismo://team/team_123")!),
            .team("team_123")
        )
    }
    func testFiveTabIndicesAndLegacyCalendarAliases() {
        XCTAssertEqual(NotificationManager.DeepLink.parse("cyclocross"), .tab(3))
        for alias in ["calendar", "month", "season"] { XCTAssertEqual(NotificationManager.DeepLink.parse(alias), .tab(4)) }
        XCTAssertEqual(NotificationManager.DeepLink.parse("subscribe"), .tab(5))
        XCTAssertEqual(NotificationManager.DeepLink.parse("notifications"), .tab(6))
        XCTAssertEqual(NotificationManager.DeepLink.parse("race/cx-123"), .race("cx-123"))
        XCTAssertEqual(NotificationManager.DeepLink.parse("cxRace/cx-123#ME"), .cxRace("cx-123", anchor: "ME"))
    }

    func testCxCustomAndPublicLinksKeepIdsSlugsAndSectionsSeparate() {
        XCTAssertEqual(NotificationManager.DeepLink.fromURL(URL(string: "calendariociclismo://cxRace/cx-123#inscritos-ME")!), .cxRace("cx-123", anchor: "inscritos-ME"))
        for (path, slug) in [("ciclocross/canmore", "canmore"), ("en/cyclocross/canmore-en", "canmore-en")] {
            XCTAssertEqual(NotificationManager.DeepLink.fromURL(URL(string: "https://calendariociclismo.app/\(path)/#general-WU")!), .cxRaceSlug(slug, anchor: "general-WU"))
        }
        for path in ["ciclocross/", "en/cyclocross/"] {
            XCTAssertEqual(NotificationManager.DeepLink.fromURL(URL(string: "https://calendariociclismo.app/\(path)")!), .tab(3))
        }
    }

    func testTournamentPagesResolveSeriesSlugsForBothLanguages() {
        XCTAssertEqual(NotificationManager.DeepLink.fromURL(URL(string: "https://calendariociclismo.app/ciclocross/torneos/copa-espana/")!), .cxTournamentSlug("copa-espana"))
        XCTAssertEqual(NotificationManager.DeepLink.fromURL(URL(string: "https://calendariociclismo.app/ciclocross/torneos/copa-espana")!), .cxTournamentSlug("copa-espana"))
        XCTAssertEqual(NotificationManager.DeepLink.fromURL(URL(string: "https://calendariociclismo.app/en/cyclocross/series/world-cup/")!), .cxTournamentSlug("world-cup"))
    }

    func testCxLinksRejectForeignHostsExtraSegmentsAndInvalidAnchors() {
        for value in ["cxRace/", "cxRace/x/y", "cxRace/x#relay", "cxRace/x#ME#WE", "cxRace/x#"] {
            XCTAssertNil(NotificationManager.DeepLink.parse(value), value)
        }
        for value in [
            "https://example.org/ciclocross/canmore/", "http://calendariociclismo.app/ciclocross/canmore/",
            "https://calendariociclismo.app/ciclocross/canmore/extra/", "https://calendariociclismo.app/ciclocross/a%2Fb/",
            "https://calendariociclismo.app/ciclocross/canmore/#relay", "https://calendariociclismo.app:444/ciclocross/canmore/",
            "https://user@calendariociclismo.app/ciclocross/canmore/", "calendariociclismo://cxRace/a%2Fb",
            "calendariociclismo://cxRace/x/y", "calendariociclismo://cxRace/x#relay",
            "https://calendariociclismo.app/ciclocross/series/canmore/", "https://calendariociclismo.app/en/cyclocross/torneos/canmore/",
            "https://calendariociclismo.app/ciclocross/torneos/canmore/extra/"
        ] { XCTAssertNil(NotificationManager.DeepLink.fromURL(URL(string: value)!), value) }
    }
}
