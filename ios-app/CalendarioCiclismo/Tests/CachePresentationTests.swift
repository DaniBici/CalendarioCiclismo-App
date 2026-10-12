import XCTest
@testable import CalendarioCiclismo

final class CachePresentationTests: XCTestCase {
    func test_online_initialLoad_waitsForNetworkEvenWithCache() {
        XCTAssertEqual(CachePresentation.resolve(isOnline: true, isInitialLoad: true), .waitForNetwork)
    }

    func test_online_laterNavigation_showsCacheSilently() {
        XCTAssertEqual(CachePresentation.resolve(isOnline: true, isInitialLoad: false), .silent)
    }

    func test_offline_showsCacheWithBanner() {
        XCTAssertEqual(CachePresentation.resolve(isOnline: false, isInitialLoad: true), .offline)
        XCTAssertEqual(CachePresentation.resolve(isOnline: false, isInitialLoad: false), .offline)
    }
}

final class LoadingTimingTests: XCTestCase {
    func test_immediateHold_keepsMinimumVisibleTime() {
        XCTAssertEqual(LoadingTiming.remainingImmediateHold(elapsed: 0.05), LoadingTiming.minShow - 0.05, accuracy: 0.0001)
        XCTAssertEqual(LoadingTiming.remainingImmediateHold(elapsed: LoadingTiming.minShow), 0)
        XCTAssertEqual(LoadingTiming.remainingImmediateHold(elapsed: 5), 0)
    }
}
