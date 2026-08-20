import XCTest
@testable import CalendarioCiclismo

final class DateFormattingTests: XCTestCase {

    // MARK: - date(from:) / toDateKey

    func test_dateFromDateKey_parsesValidDate() {
        let date = DateFormatting.date(from: "2026-07-01")
        XCTAssertNotNil(date)
    }

    func test_dateFromDateKey_nilForInvalidFormat() {
        XCTAssertNil(DateFormatting.date(from: "01-07-2026"))
        XCTAssertNil(DateFormatting.date(from: "not-a-date"))
    }

    func test_toDateKey_roundTrip() {
        let key = "2026-07-01"
        let date = DateFormatting.date(from: key)!
        let back = DateFormatting.toDateKey(date)
        XCTAssertEqual(key, back)
    }

    // MARK: - todayKey

    func test_todayKey_hasDateKeyFormat() {
        let today = DateFormatting.todayKey()
        let pattern = try! NSRegularExpression(pattern: "^\\d{4}-\\d{2}-\\d{2}$")
        let range = NSRange(today.startIndex..., in: today)
        XCTAssertEqual(1, pattern.numberOfMatches(in: today, range: range))
    }

    // MARK: - formatDateShort

    func test_formatDateShort_nonEmptyForValidDate() {
        let result = DateFormatting.formatDateShort("2026-07-01")
        XCTAssertFalse(result.isEmpty)
        XCTAssertNotEqual("2026-07-01", result)
    }

    func test_formatDateShort_passthroughForInvalidDate() {
        XCTAssertEqual("not-a-date", DateFormatting.formatDateShort("not-a-date"))
    }

    // MARK: - formatDateLong

    func test_formatDateLong_containsYear() {
        let result = DateFormatting.formatDateLong("2026-07-01")
        XCTAssertTrue(result.contains("2026"))
    }

    func test_formatDateLong_containsSpanishMonth() {
        let result = DateFormatting.formatDateLong("2026-07-01").lowercased()
        XCTAssertTrue(result.contains("julio"))
    }

    func test_formatUciRankingUpdated_usesSamePatternInSpanishAndEnglish() {
        XCTAssertEqual(
            "Actualizado: martes, 28 de julio de 2026",
            DateFormatting.formatUciRankingUpdated("2026-07-28", isEnglish: false)
        )
        XCTAssertEqual(
            "Updated: Tuesday, 28 July 2026",
            DateFormatting.formatUciRankingUpdated("2026-07-28", isEnglish: true)
        )
    }

    // MARK: - formatDateRange

    func test_formatDateRange_emptyForNilStart() {
        XCTAssertEqual("", DateFormatting.formatDateRange(start: nil, end: nil))
    }

    func test_formatDateRange_singleDayForSameDate() {
        let result = DateFormatting.formatDateRange(start: "2026-04-12", end: "2026-04-12")
        XCTAssertFalse(result.contains("–"))
    }

    func test_formatDateRange_containsBothDaysForSameMonth() {
        let result = DateFormatting.formatDateRange(start: "2026-07-01", end: "2026-07-27")
        XCTAssertTrue(result.contains("1") || result.contains("01"))
        XCTAssertTrue(result.contains("27"))
    }

    // MARK: - formatMonthYear

    func test_formatMonthYear_containsYear() {
        let result = DateFormatting.formatMonthYear(year: 2026, month: 4)
        XCTAssertTrue(result.contains("2026"))
    }

    func test_formatMonthYear_containsSpanishMonthName() {
        let result = DateFormatting.formatMonthYear(year: 2026, month: 4).lowercased()
        XCTAssertTrue(result.contains("mayo"))
    }

    // MARK: - formatTimeMadrid

    func test_formatTimeMadrid_parsesISO8601() {
        let result = DateFormatting.formatTimeMadrid("2026-07-01T10:00:00Z")
        XCTAssertNotNil(result)
        let pattern = try! NSRegularExpression(pattern: "^\\d{2}:\\d{2}$")
        let range = NSRange(result!.startIndex..., in: result!)
        XCTAssertEqual(1, pattern.numberOfMatches(in: result!, range: range))
    }

    func test_formatTimeMadrid_nilForInvalidTimestamp() {
        XCTAssertNil(DateFormatting.formatTimeMadrid("not-a-timestamp"))
    }

    func test_formatTimeMadrid_summerCEST_UTC_plus_2() {
        // 10:00 UTC = 12:00 CEST (Madrid, verano)
        XCTAssertEqual("12:00", DateFormatting.formatTimeMadrid("2026-07-01T10:00:00Z"))
    }

    func test_formatTimeMadrid_winterCET_UTC_plus_1() {
        // 10:00 UTC = 11:00 CET (Madrid, invierno)
        XCTAssertEqual("11:00", DateFormatting.formatTimeMadrid("2026-01-15T10:00:00Z"))
    }

    // MARK: - timestampToSeconds

    func test_timestampToSeconds_positiveForValidTimestamp() {
        let secs = DateFormatting.timestampToSeconds("2026-07-01T10:00:00Z")
        XCTAssertNotNil(secs)
        XCTAssertGreaterThan(secs!, 0)
    }

    func test_timestampToSeconds_nilForInvalidTimestamp() {
        XCTAssertNil(DateFormatting.timestampToSeconds("not-a-timestamp"))
    }

    func test_timestampToSeconds_preservesChronologicalOrder() {
        let t1 = DateFormatting.timestampToSeconds("2026-07-01T08:00:00Z")!
        let t2 = DateFormatting.timestampToSeconds("2026-07-01T13:00:00Z")!
        XCTAssertLessThan(t1, t2)
    }

    // MARK: - previousDay / nextDay / dayOffset

    func test_previousDay_returnsCorrectDay() {
        XCTAssertEqual("2026-06-30", DateFormatting.previousDay("2026-07-01"))
    }

    func test_nextDay_returnsCorrectDay() {
        XCTAssertEqual("2026-07-02", DateFormatting.nextDay("2026-07-01"))
    }

    func test_previousDay_handlesMonthBoundary() {
        XCTAssertEqual("2026-06-30", DateFormatting.previousDay("2026-07-01"))
    }

    func test_nextDay_handlesYearBoundary() {
        XCTAssertEqual("2027-01-01", DateFormatting.nextDay("2026-12-31"))
    }

    func test_previousDay_nilForInvalidDate() {
        XCTAssertNil(DateFormatting.previousDay("not-a-date"))
    }

    func test_dayOffset_advancesNDays() {
        XCTAssertEqual("2026-07-08", DateFormatting.dayOffset(from: "2026-07-01", by: 7))
    }

    func test_dayOffset_retreatsWithNegativeValue() {
        XCTAssertEqual("2026-06-24", DateFormatting.dayOffset(from: "2026-07-01", by: -7))
    }
}
