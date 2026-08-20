import XCTest
@testable import CalendarioCiclismo

/// Accessibility tests to prevent regressions in VoiceOver labels, hints, and descriptions.
final class AccessibilityTests: XCTestCase {

    // MARK: - Country Names

    func testCountryNameSpanish() {
        XCTAssertEqual(AccessibilityCountryNames.name(for: "ES"), "España")
        XCTAssertEqual(AccessibilityCountryNames.name(for: "FR"), "Francia")
        XCTAssertEqual(AccessibilityCountryNames.name(for: "IT"), "Italia")
        XCTAssertEqual(AccessibilityCountryNames.name(for: "BE"), "Bélgica")
    }

    func testCountryNameNilForInvalid() {
        XCTAssertNil(AccessibilityCountryNames.name(for: nil))
        XCTAssertNil(AccessibilityCountryNames.name(for: ""))
        XCTAssertNil(AccessibilityCountryNames.name(for: "X"))
    }

    func testCountryNameHandlesSubRegions() {
        // Sub-regions like "ES-CT" should resolve to first 2 chars
        let name = AccessibilityCountryNames.name(for: "ES-CT")
        XCTAssertEqual(name, "España")
    }

    // MARK: - Category Labels

    func testCategoryLabelWorldTour() {
        let desc = AccessibilityCategoryLabel.description(for: "1.UWT")
        XCTAssertEqual(desc, "Categoría UCI WorldTour")
    }

    func testCategoryLabelWorldChampionship() {
        let desc = AccessibilityCategoryLabel.description(for: "WC")
        XCTAssertEqual(desc, "Categoría Campeonato del Mundo")
    }

    func testCategoryLabelNil() {
        XCTAssertNil(AccessibilityCategoryLabel.description(for: nil))
        XCTAssertNil(AccessibilityCategoryLabel.description(for: ""))
    }

    func testCategoryLabelUnknownFallback() {
        let desc = AccessibilityCategoryLabel.description(for: "XYZ")
        XCTAssertEqual(desc, "Categoría XYZ")
    }

    // MARK: - Stage Type Descriptions

    func testStageTypeDescription() {
        let desc = AccessibilityStageType.description(primary: "flat", secondary: nil)
        XCTAssertEqual(desc, "Tipo de etapa: Llana")
    }

    func testStageTypeDescriptionCombo() {
        let desc = AccessibilityStageType.description(primary: "itt", secondary: "chrono_climb")
        XCTAssertEqual(desc, "Tipo de etapa: Cronoescalada")
    }

    func testStageTypeNil() {
        XCTAssertNil(AccessibilityStageType.description(primary: nil, secondary: nil))
        XCTAssertNil(AccessibilityStageType.description(primary: "", secondary: nil))
    }

    // MARK: - Stage Type Icons (color-blind support)

    func testStageTypeIconsExist() {
        XCTAssertNotNil(AccessibilityStageType.iconName(for: "flat"))
        XCTAssertNotNil(AccessibilityStageType.iconName(for: "high_mountain"))
        XCTAssertNotNil(AccessibilityStageType.iconName(for: "itt"))
        XCTAssertNotNil(AccessibilityStageType.iconName(for: "cobbles"))
        XCTAssertNotNil(AccessibilityStageType.iconName(for: "sterrato"))
    }

    func testStageTypeIconNilForUnknown() {
        XCTAssertNil(AccessibilityStageType.iconName(for: nil))
        XCTAssertNil(AccessibilityStageType.iconName(for: "unknown_type"))
    }

    // MARK: - TV Status Descriptions

    func testTVStatusConfirmed() {
        let desc = AccessibilityTVStatus.description(tvStatus: "confirmed", broadcasts: [])
        XCTAssertEqual(desc, "Televisada")
    }

    func testTVStatusPending() {
        let desc = AccessibilityTVStatus.description(tvStatus: "pending", broadcasts: [])
        XCTAssertEqual(desc, "Televisión por confirmar")
    }

    func testTVStatusNone() {
        let desc = AccessibilityTVStatus.description(tvStatus: "none", broadcasts: [])
        XCTAssertEqual(desc, "Sin televisión")
    }

    func testTVStatusUnavailableES() {
        let desc = AccessibilityTVStatus.description(tvStatus: "unavailable_es", broadcasts: [])
        XCTAssertEqual(desc, "No disponible en España")
    }

    func testTVStatusNilForUnknown() {
        XCTAssertNil(AccessibilityTVStatus.description(tvStatus: nil, broadcasts: []))
        XCTAssertNil(AccessibilityTVStatus.description(tvStatus: "other", broadcasts: []))
    }

    // MARK: - Race Card Label

    func testRaceCardLabelIncludesName() {
        let raceDay = makeRaceDay()
        let race = makeRace(name: "Tour de Francia")
        let item = EnrichedRaceDay(raceDay: raceDay, race: race, broadcasts: [], assets: [])

        let label = AccessibilityRaceDescription.raceCardLabel(item: item)
        XCTAssertTrue(label.contains("Tour de Francia"))
    }

    func testRaceCardLabelIncludesCancelledStatus() {
        let raceDay = makeRaceDay()
        let race = makeRace(name: "Carrera X", isCancelled: true)
        let item = EnrichedRaceDay(raceDay: raceDay, race: race, broadcasts: [], assets: [])

        let label = AccessibilityRaceDescription.raceCardLabel(item: item)
        XCTAssertTrue(label.contains("cancelada"))
    }

    func testRaceCardLabelIncludesCategory() {
        let raceDay = makeRaceDay()
        let race = makeRace(name: "Tour", uciCategory: "1.UWT")
        let item = EnrichedRaceDay(raceDay: raceDay, race: race, broadcasts: [], assets: [])

        let label = AccessibilityRaceDescription.raceCardLabel(item: item)
        XCTAssertTrue(label.contains("WorldTour"))
    }

    func testRaceCardLabelIncludesRoute() {
        let raceDay = makeRaceDay(startLocation: "Madrid", finishLocation: "Barcelona")
        let race = makeRace(name: "Vuelta")
        let item = EnrichedRaceDay(raceDay: raceDay, race: race, broadcasts: [], assets: [])

        let label = AccessibilityRaceDescription.raceCardLabel(item: item)
        XCTAssertTrue(label.contains("Madrid"))
        XCTAssertTrue(label.contains("Barcelona"))
    }

    func testRaceCardLabelIncludesPlaceholderStatus() {
        let raceDay = makeRaceDay()
        let race = makeRace(name: "Test Race")
        var item = EnrichedRaceDay(raceDay: raceDay, race: race, broadcasts: [], assets: [])
        item.isPlaceholder = true

        let label = AccessibilityRaceDescription.raceCardLabel(item: item)
        XCTAssertTrue(label.contains("sin información detallada"))
    }

    // MARK: - Season Race Label

    func testSeasonRaceLabelIncludesDateRange() {
        let race = makeRace(name: "Giro", startDate: "2026-05-09", endDate: "2026-06-01")
        let label = AccessibilityRaceDescription.seasonRaceLabel(race: race)
        XCTAssertTrue(label.contains("Giro"))
    }

    func testSeasonRaceLabelIncludesStageRace() {
        let race = makeRace(name: "Vuelta", raceFormat: "stage_race")
        let label = AccessibilityRaceDescription.seasonRaceLabel(race: race)
        XCTAssertTrue(label.contains("carrera por etapas"))
    }

    // MARK: - Month Day Cell Label

    func testMonthDayCellNoRaces() {
        let label = AccessibilityRaceDescription.monthDayCellLabel(
            day: 15, month: 4, year: 2026, isToday: false, raceDays: [], raceMap: [:]
        )
        XCTAssertTrue(label.contains("15"))
        XCTAssertTrue(label.contains("sin carreras"))
    }

    func testMonthDayCellToday() {
        let label = AccessibilityRaceDescription.monthDayCellLabel(
            day: 8, month: 4, year: 2026, isToday: true, raceDays: [], raceMap: [:]
        )
        XCTAssertTrue(label.contains("hoy"))
    }

    // MARK: - Stage Row Label

    func testStageRowRestDay() {
        let raceDay = makeRaceDay(isRestDay: true)
        let item = EnrichedRaceDay(raceDay: raceDay, race: nil, broadcasts: [], assets: [])
        let label = AccessibilityRaceDescription.stageRowLabel(item: item)
        XCTAssertTrue(label.contains("Jornada de descanso"))
    }

    func testStageRowCancelledDay() {
        let raceDay = makeRaceDay(stageNumber: 5, isCancelledDay: true)
        let item = EnrichedRaceDay(raceDay: raceDay, race: nil, broadcasts: [], assets: [])
        let label = AccessibilityRaceDescription.stageRowLabel(item: item)
        XCTAssertTrue(label.contains("cancelada"))
    }

    // MARK: - Accessibility Identifiers

    func testAccessibilityIDsAreUnique() {
        let ids = [
            AccessibilityID.tabToday,
            AccessibilityID.tabResults,
            AccessibilityID.tabTransfers,
            AccessibilityID.tabCalendar,
            AccessibilityID.settingsButton,
            AccessibilityID.dateBar,
            AccessibilityID.categoryFilters,
            AccessibilityID.sortMenu,
            AccessibilityID.raceList,
            AccessibilityID.previousDayButton,
            AccessibilityID.nextDayButton,
            AccessibilityID.monthNavPrevious,
            AccessibilityID.monthNavNext,
            AccessibilityID.monthTitle,
            AccessibilityID.yearPicker,
            AccessibilityID.countryPicker,
            AccessibilityID.stageHeader,
            AccessibilityID.timeSection,
            AccessibilityID.broadcastSection,
            AccessibilityID.assetSection,
        ]
        XCTAssertEqual(ids.count, Set(ids).count, "All accessibility identifiers must be unique")
    }

    func testDynamicAccessibilityIDs() {
        XCTAssertEqual(AccessibilityID.raceCard("abc"), "race_card_abc")
        XCTAssertEqual(AccessibilityID.stageRow("xyz"), "stage_row_xyz")
        XCTAssertEqual(AccessibilityID.monthDay(15), "month_day_15")
        XCTAssertEqual(AccessibilityID.filterButton("pro"), "filter_pro")
        XCTAssertEqual(AccessibilityID.feedCard("wt"), "feed_card_wt")
    }

    // MARK: - Helpers

    private func makeRace(
        name: String,
        uciCategory: String? = nil,
        countryCode: String? = nil,
        isCancelled: Bool = false,
        startDate: String? = nil,
        endDate: String? = nil,
        raceFormat: String? = nil
    ) -> Race {
        Race(
            id: UUID().uuidString,
            name: name,
            nameEn: nil,
            abbrev: nil,
            uciCategory: uciCategory,
            gender: nil,
            raceFormat: raceFormat,
            countryCode: countryCode,
            colorHex: nil,
            logoUrl: nil,
            websiteUrl: nil,
            fcId: nil,
            pcsSlug: nil,
            hideFlag: false,
            isGrandTour: false,
            isCancelled: isCancelled,
            startDate: startDate,
            endDate: endDate,
            year: 2026,
            slug: nil,
            originalName: nil,
            startlistImportedAt: nil,
            startlistProvisional: nil,
            enrichedStartlist: nil
        )
    }

    private func makeRaceDay(
        stageNumber: Int? = nil,
        isRestDay: Bool = false,
        isCancelledDay: Bool = false,
        startLocation: String? = nil,
        finishLocation: String? = nil,
        distanceKm: Double? = nil,
        primaryType: String? = nil,
        secondaryType: String? = nil
    ) -> RaceDay {
        RaceDay(
            id: UUID().uuidString,
            raceId: nil,
            dateKey: "2026-04-08",
            slug: nil,
            isRestDay: isRestDay,
            isCancelledDay: isCancelledDay,
            stageNumber: stageNumber,
            startLocation: startLocation,
            finishLocation: finishLocation,
            distanceKm: distanceKm,
            primaryType: primaryType,
            secondaryType: secondaryType,
            neutralStartTimeUtc: nil,
            estimatedFinishTimeUtc: nil,
            tvStatus: nil,
            description: nil,
            bonuses: nil,
            notes: nil,
            editorialStatus: "published",
            hasAssets: false,
            updatedAt: nil,
            countryCode: nil
        )
    }
}
