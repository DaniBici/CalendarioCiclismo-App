import XCTest
@testable import CalendarioCiclismo

final class DateFormattingTests: XCTestCase {

    func test_otherDayLabel_dayOnlyWhenLocalDateDiffersFromDateKey() {
        // Tour de Okinawa 2026: 06:45 del domingo en Japón, 22:45 del sábado en Madrid.
        let madrid = TimeZone(identifier: "Europe/Madrid")!
        let tokyo = TimeZone(identifier: "Asia/Tokyo")!
        let start = "2026-11-07T21:45:00Z"
        XCTAssertEqual(DateFormatting.otherDayLabel(start, dateKey: "2026-11-08", timeZone: madrid, isEnglish: false), "sáb.")
        XCTAssertEqual(DateFormatting.otherDayLabel(start, dateKey: "2026-11-08", timeZone: madrid, isEnglish: true), "Sat")
        XCTAssertNil(DateFormatting.otherDayLabel(start, dateKey: "2026-11-08", timeZone: tokyo, isEnglish: false))
        // Llegada pasada la medianoche.
        XCTAssertEqual(DateFormatting.otherDayLabel("2026-11-07T23:30:00Z", dateKey: "2026-11-07", timeZone: madrid, isEnglish: false), "dom.")
        XCTAssertNil(DateFormatting.otherDayLabel("2026-11-07T10:00:00Z", dateKey: "2026-11-07", timeZone: madrid, isEnglish: false))
    }
}
