import XCTest
@testable import CalendarioCiclismo

final class AdaptiveLayoutPolicyTests: XCTestCase {
    private struct Item: Identifiable {
        let id: Int
        let featured: Bool
    }

    func testFeedColumnsRequireRegularWidthAndThreshold() {
        XCTAssertEqual(AdaptiveLayoutPolicy.feedColumns(width: 900, isRegular: false), 1)
        XCTAssertEqual(AdaptiveLayoutPolicy.feedColumns(width: 619, isRegular: true), 1)
        XCTAssertEqual(AdaptiveLayoutPolicy.feedColumns(width: 620, isRegular: true), 2)
    }

    func testStartlistColumnsAreBoundedFromOneToThree() {
        XCTAssertEqual(AdaptiveLayoutPolicy.startlistColumns(width: 900, isRegular: false), 1)
        XCTAssertEqual(AdaptiveLayoutPolicy.startlistColumns(width: 620, isRegular: true), 2)
        XCTAssertEqual(AdaptiveLayoutPolicy.startlistColumns(width: 920, isRegular: true), 3)
        XCTAssertEqual(AdaptiveLayoutPolicy.startlistColumns(width: 1_600, isRegular: true), 3)
    }

    func testFeaturedItemsSpanAndInterruptPairedRows() {
        let items = [
            Item(id: 1, featured: false), Item(id: 2, featured: false),
            Item(id: 3, featured: true), Item(id: 4, featured: false),
        ]
        let rows = AdaptiveLayoutPolicy.rows(items, columns: 2, spansAllColumns: \.featured)
        XCTAssertEqual(rows.map { $0.items.map(\.id) }, [[1, 2], [3], [4]])
        XCTAssertEqual(rows.map(\.spansAllColumns), [false, true, false])
    }

    func testWideDetailStartsAtConfiguredThreshold() {
        XCTAssertFalse(AdaptiveLayoutPolicy.usesWideDetail(width: 819, isRegular: true))
        XCTAssertTrue(AdaptiveLayoutPolicy.usesWideDetail(width: 820, isRegular: true))
    }

    func testMarketDistributionPreservesWholeCategoriesAtExactBreak() {
        XCTAssertEqual(
            AdaptiveLayoutPolicy.balancedBreak(counts: [3, 2, 5]),
            .init(blockIndex: 2, offset: 0)
        )
    }

    func testMarketDistributionSplitsLongCategoryAtBalancedRow() {
        XCTAssertEqual(
            AdaptiveLayoutPolicy.balancedBreak(counts: [2, 7, 1]),
            .init(blockIndex: 1, offset: 3)
        )
    }
}
