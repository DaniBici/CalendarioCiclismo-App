import XCTest
@testable import CalendarioCiclismo

final class DateFormattingTests: XCTestCase {

    /// Las etiquetas de mes siguen `app_locale`; se fija en español y se
    /// restaura el valor previo para no depender del estado del simulador.
    private var originalLocaleRaw: String?

    override func setUp() {
        super.setUp()
        originalLocaleRaw = UserDefaults.standard.string(forKey: "app_locale")
        UserDefaults.standard.set("es", forKey: "app_locale")
    }

    override func tearDown() {
        if let raw = originalLocaleRaw {
            UserDefaults.standard.set(raw, forKey: "app_locale")
        } else {
            UserDefaults.standard.removeObject(forKey: "app_locale")
        }
        super.tearDown()
    }

    // MARK: - date(from:) / toDateKey

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

    // MARK: - formatDateShort

    func test_formatDateShort_passthroughForInvalidDate() {
        XCTAssertEqual("not-a-date", DateFormatting.formatDateShort("not-a-date"))
    }

    // MARK: - formatDateLong

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

    func test_formatMonthYear_containsSpanishMonthName() {
        let result = DateFormatting.formatMonthYear(year: 2026, month: 4).lowercased()
        XCTAssertTrue(result.contains("mayo"))
    }

    // MARK: - timestampToSeconds

    func test_timestampToSeconds_nilForInvalidTimestamp() {
        XCTAssertNil(DateFormatting.timestampToSeconds("not-a-timestamp"))
    }

    // MARK: - previousDay / nextDay / dayOffset

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
