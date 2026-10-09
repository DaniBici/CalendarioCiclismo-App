import XCTest
@testable import CalendarioCiclismo

/// Accessibility tests to prevent regressions in VoiceOver labels, hints, and descriptions.
final class AccessibilityTests: XCTestCase {

    // MARK: - Mini-profile contrast

    func testMiniProfileContrastLightensDarkColorsWithWebThreshold() {
        for original in [
            MiniProfileColorContrast.RGB(red: 0, green: 0, blue: 0),
            MiniProfileColorContrast.RGB(red: 0.09, green: 0.08, blue: 0.41),
            MiniProfileColorContrast.RGB(red: 0, green: 0.2, blue: 0),
        ] {
            let adjusted = MiniProfileColorContrast.adjustedRGB(original, for: .dark)
            XCTAssertGreaterThanOrEqual(
                adjusted.relativeLuminance,
                MiniProfileColorContrast.darkMinimumLuminance
            )
        }
    }

    func testMiniProfileContrastDarkensLightColorsWithWebThreshold() {
        for original in [
            MiniProfileColorContrast.RGB(red: 1, green: 1, blue: 1),
            MiniProfileColorContrast.RGB(red: 1, green: 1, blue: 0),
            MiniProfileColorContrast.RGB(red: 1, green: 0.67, blue: 0.67),
        ] {
            let adjusted = MiniProfileColorContrast.adjustedRGB(original, for: .light)
            XCTAssertLessThanOrEqual(
                adjusted.relativeLuminance,
                MiniProfileColorContrast.lightMaximumLuminance
            )
        }
    }

    func testMiniProfileContrastPreservesColorInsideWebRange() {
        let original = MiniProfileColorContrast.RGB(red: 0.08, green: 0.28, blue: 0.65)
        XCTAssertEqual(
            MiniProfileColorContrast.adjustedRGB(original, for: .light),
            original
        )
    }

    // MARK: - Interactive profile contrast

    func testProfileColorContrastDarkensLightRaceColorOnLightBackground() {
        let background = ProfileColorContrast.RGB(
            red: 250.0 / 255.0,
            green: 251.0 / 255.0,
            blue: 252.0 / 255.0
        )
        let original = ProfileColorContrast.RGB(red: 1, green: 0.95, blue: 0.1)

        let adjusted = ProfileColorContrast.adjustedRGB(original, background: background)

        XCTAssertGreaterThanOrEqual(
            ProfileColorContrast.contrastRatio(adjusted, background),
            ProfileColorContrast.minimumRatio - 0.001
        )
        XCTAssertLessThan(adjusted.red, original.red)
    }

    func testProfileColorContrastLightensDarkRaceColorOnDarkBackground() {
        let background = ProfileColorContrast.RGB(
            red: 30.0 / 255.0,
            green: 38.0 / 255.0,
            blue: 50.0 / 255.0
        )
        let original = ProfileColorContrast.RGB(red: 0.01, green: 0.04, blue: 0.12)

        let adjusted = ProfileColorContrast.adjustedRGB(original, background: background)

        XCTAssertGreaterThanOrEqual(
            ProfileColorContrast.contrastRatio(adjusted, background),
            ProfileColorContrast.minimumRatio - 0.001
        )
        XCTAssertGreaterThan(adjusted.blue, original.blue)
    }

    func testProfileColorContrastPreservesColorThatAlreadyPasses() {
        let background = ProfileColorContrast.RGB(
            red: 250.0 / 255.0,
            green: 251.0 / 255.0,
            blue: 252.0 / 255.0
        )
        let original = ProfileColorContrast.RGB(red: 0.1, green: 0.2, blue: 0.7)

        XCTAssertEqual(
            ProfileColorContrast.adjustedRGB(original, background: background),
            original
        )
    }

    // MARK: - Country Names

    func testCountryName() {
        let cases: [(code: String?, name: String?)] = [
            ("ES", "España"),
            ("FR", "Francia"),
            ("BE", "Bélgica"),
            // Subregiones como "ES-CT" se resuelven por los dos primeros caracteres.
            ("ES-CT", "España"),
            (nil, nil),
            ("", nil),
            ("X", nil),
        ]
        for c in cases {
            XCTAssertEqual(AccessibilityCountryNames.name(for: c.code), c.name, c.code ?? "nil")
        }
    }

    // MARK: - Category Labels

    func testCategoryLabel() {
        let cases: [(category: String?, label: String?)] = [
            ("1.UWT", "Categoría UCI WorldTour"),
            ("WC", "Categoría Campeonato del Mundo"),
            ("XYZ", "Categoría XYZ"),
            (nil, nil),
            ("", nil),
        ]
        for c in cases {
            XCTAssertEqual(AccessibilityCategoryLabel.description(for: c.category), c.label, c.category ?? "nil")
        }
    }

    // MARK: - Stage Type Descriptions

    func testStageTypeDescription() {
        let cases: [(primary: String?, secondary: String?, label: String?)] = [
            ("flat", nil, "Tipo de etapa: Llana"),
            ("itt", "chrono_climb", "Tipo de etapa: Cronoescalada"),
            (nil, nil, nil),
            ("", nil, nil),
        ]
        for c in cases {
            XCTAssertEqual(
                AccessibilityStageType.description(primary: c.primary, secondary: c.secondary), c.label,
                "\(c.primary ?? "nil") + \(c.secondary ?? "nil")"
            )
        }
    }

    // MARK: - TV Status Descriptions

    func testTVStatusDescription() {
        let cases: [(status: String?, label: String?)] = [
            ("confirmed", "Televisada"),
            ("pending", "Televisión por confirmar"),
            ("none", "Sin televisión"),
            ("unavailable_es", "No disponible en España"),
            (nil, nil),
            ("other", nil),
        ]
        for c in cases {
            XCTAssertEqual(AccessibilityTVStatus.description(tvStatus: c.status, broadcasts: []), c.label, c.status ?? "nil")
        }
    }

    // MARK: - Race Card Label

    func testRaceCardLabelIncludesRaceData() {
        let item = EnrichedRaceDay(
            raceDay: makeRaceDay(startLocation: "Madrid", finishLocation: "Barcelona"),
            race: makeRace(name: "Tour de Francia", uciCategory: "1.UWT"),
            broadcasts: [], assets: []
        )
        let label = AccessibilityRaceDescription.raceCardLabel(item: item)
        for fragment in ["Tour de Francia", "WorldTour", "Madrid", "Barcelona"] {
            XCTAssertTrue(label.contains(fragment), fragment)
        }
    }

    func testRaceCardLabelIncludesStatus() {
        let cancelled = EnrichedRaceDay(
            raceDay: makeRaceDay(), race: makeRace(name: "Carrera X", isCancelled: true), broadcasts: [], assets: []
        )
        var placeholder = EnrichedRaceDay(raceDay: makeRaceDay(), race: makeRace(name: "Test Race"), broadcasts: [], assets: [])
        placeholder.isPlaceholder = true
        let regular = EnrichedRaceDay(raceDay: makeRaceDay(), race: makeRace(name: "Carrera X"), broadcasts: [], assets: [])

        let cases: [(item: EnrichedRaceDay, waiting: Bool, fragment: String)] = [
            (cancelled, false, "cancelada"),
            (placeholder, false, "sin información detallada"),
            (regular, true, "esperando resultados"),
        ]
        for c in cases {
            let label = AccessibilityRaceDescription.raceCardLabel(item: c.item, isWaitingForResults: c.waiting)
            XCTAssertTrue(label.contains(c.fragment), c.fragment)
        }
    }

    // MARK: - Season Race Label

    func testSeasonRaceLabelIncludesStageRace() {
        let race = makeRace(name: "Vuelta", raceFormat: "stage_race")
        let label = AccessibilityRaceDescription.seasonRaceLabel(race: race)
        XCTAssertTrue(label.contains("carrera por etapas"))
    }

    // MARK: - Month Day Cell Label

    func testMonthDayCellLabel() {
        let empty = AccessibilityRaceDescription.monthDayCellLabel(
            day: 15, month: 4, year: 2026, isToday: false, raceDays: [], raceMap: [:]
        )
        XCTAssertTrue(empty.contains("15"))
        XCTAssertTrue(empty.contains("sin carreras"))
        XCTAssertFalse(empty.contains("hoy"))

        let today = AccessibilityRaceDescription.monthDayCellLabel(
            day: 8, month: 4, year: 2026, isToday: true, raceDays: [], raceMap: [:]
        )
        XCTAssertTrue(today.contains("hoy"))
    }

    // MARK: - Stage Row Label

    func testStageRowLabel() {
        let cases: [(raceDay: RaceDay, fragment: String)] = [
            (makeRaceDay(isRestDay: true), "Jornada de descanso"),
            (makeRaceDay(stageNumber: 5, isCancelledDay: true), "cancelada"),
        ]
        for c in cases {
            let item = EnrichedRaceDay(raceDay: c.raceDay, race: nil, broadcasts: [], assets: [])
            XCTAssertTrue(AccessibilityRaceDescription.stageRowLabel(item: item).contains(c.fragment), c.fragment)
        }
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
            uciCategory: uciCategory,
            gender: nil,
            raceFormat: raceFormat,
            countryCode: countryCode,
            colorHex: nil,
            logoUrl: nil,
            websiteUrl: nil,
            hideFlag: false,
            isGrandTour: false,
            isCancelled: isCancelled,
            startDate: startDate,
            endDate: endDate,
            year: 2026,
            slug: nil,
            originalName: nil,
            startlistImportedAt: nil,
            startlistProvisional: nil
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
