import XCTest
@testable import CalendarioCiclismo

@MainActor
final class NotificationCategoryServiceTests: XCTestCase {

    // MARK: - rawValue

    func test_rawValuesMatchServerCategories() {
        // Estos rawValues son contrato con send-push y la columna
        // push_subscription_categories.category. Si cambian, hay que tocar
        // la migración 040 en el server.
        XCTAssertEqual(NotificationCategoryService.NotificationCategory.general.rawValue, "general")
        XCTAssertEqual(NotificationCategoryService.NotificationCategory.raceStart.rawValue, "race_start")
        XCTAssertEqual(NotificationCategoryService.NotificationCategory.tvStart.rawValue, "tv_start")
        XCTAssertEqual(NotificationCategoryService.NotificationCategory.results.rawValue, "results")
        XCTAssertEqual(NotificationCategoryService.NotificationCategory.cyclocross.rawValue, "cyclocross")
    }

    // MARK: - allCases

    func test_allCases_orderIsStable() {
        XCTAssertEqual(
            NotificationCategoryService.NotificationCategory.allCases.map { $0.rawValue },
            ["general", "race_start", "tv_start", "results", "cyclocross"]
        )
    }

    func test_cyclocrossCanBeEnabledWithoutChangingRoadCategories() {
        let service = NotificationCategoryService.shared
        let before = service.enabled
        defer {
            for category in NotificationCategoryService.NotificationCategory.allCases {
                service.setEnabled(category, before.contains(category))
            }
        }
        service.setEnabled(.cyclocross, false)
        let road = service.enabled
        service.setEnabled(.cyclocross, true)
        XCTAssertEqual(service.enabled, road.union([.cyclocross]))
        XCTAssertTrue(service.enabledRaw.contains("cyclocross"))
        service.setEnabled(.cyclocross, false)
        XCTAssertEqual(service.enabled, road)
        XCTAssertTrue(service.enabled.contains(.general))
    }
}
