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
    }

    // MARK: - allCases

    func test_allCases_hasFourEntries() {
        // Garantía contra olvidos: si añadimos una categoría nueva debería
        // tocarse explícitamente este test.
        XCTAssertEqual(NotificationCategoryService.NotificationCategory.allCases.count, 4)
    }

    func test_allCases_orderIsStable() {
        XCTAssertEqual(
            NotificationCategoryService.NotificationCategory.allCases.map { $0.rawValue },
            ["general", "race_start", "tv_start", "results"]
        )
    }

    // MARK: - labels and icons

    func test_eachCategoryHasNonEmptyLabel() {
        for cat in NotificationCategoryService.NotificationCategory.allCases {
            XCTAssertFalse(cat.labelKey.isEmpty)
            XCTAssertFalse(cat.descriptionKey.isEmpty)
            XCTAssertFalse(cat.icon.isEmpty)
        }
    }
}
