import XCTest
@testable import CalendarioCiclismo

@MainActor
final class DeepLinkTests: XCTestCase {
    func testMarketTabAndTeamDetailParseFromPushPayload() {
        XCTAssertEqual(NotificationManager.DeepLink.parse("transfers"), .tab(2))
        XCTAssertEqual(NotificationManager.DeepLink.parse("team/team_123"), .team("team_123"))
    }

    func testTeamDetailParsesFromCustomURL() {
        XCTAssertEqual(
            NotificationManager.DeepLink.fromURL(URL(string: "calendariociclismo://team/team_123")!),
            .team("team_123")
        )
    }
}
