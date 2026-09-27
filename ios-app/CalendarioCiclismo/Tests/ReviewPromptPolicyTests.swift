import XCTest
@testable import CalendarioCiclismo

final class ReviewPromptPolicyTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)
    private let day: TimeInterval = 24 * 60 * 60

    private func decide(
        isToday: Bool = true,
        firstDaysAgo: Double? = 10,
        views: Int = 15,
        meaningful: Bool = true,
        lastDaysAgo: Double? = nil,
        lastVersion: String? = nil,
        version: String = "5.0.9"
    ) -> Bool {
        ReviewPromptPolicy.shouldRequest(
            now: now,
            isToday: isToday,
            firstContentView: firstDaysAgo.map { now.addingTimeInterval(-$0 * day) },
            contentViews: views,
            meaningfulAction: meaningful,
            lastRequestAt: lastDaysAgo.map { now.addingTimeInterval(-$0 * day) },
            lastRequestVersion: lastVersion,
            currentVersion: version
        )
    }

    func test_firstRequest_needsThreeDaysViewsAndMeaningfulAction() {
        XCTAssertTrue(decide())
        XCTAssertFalse(decide(firstDaysAgo: 2))
        XCTAssertFalse(decide(views: 14))
        XCTAssertFalse(decide(meaningful: false))
        XCTAssertFalse(decide(isToday: false))
    }

    func test_repeat_needsNewVersionAndTwentyEightDays() {
        XCTAssertTrue(decide(lastDaysAgo: 28, lastVersion: "5.0.8"))
        XCTAssertFalse(decide(lastDaysAgo: 27, lastVersion: "5.0.8"))
        XCTAssertFalse(decide(lastDaysAgo: 60, lastVersion: "5.0.9"))
    }

    func test_repeat_needsRenewedEngagement() {
        XCTAssertFalse(decide(views: 3, lastDaysAgo: 40, lastVersion: "5.0.8"))
        XCTAssertFalse(decide(meaningful: false, lastDaysAgo: 40, lastVersion: "5.0.8"))
    }
}
