import XCTest
@testable import CalendarioCiclismo

final class ChampionshipsConfigTests: XCTestCase {

    // MARK: - Clasificación de slot (espejo de championshipSlot web)

    func test_slot() {
        let cases: [(name: String, gender: String?, primaryType: String?, slot: ChampionshipsConfig.Slot)] = [
            ("Campeonato de España de ruta", nil, nil, .lineaMasc),
            ("Campeonato de España CRI", nil, nil, .criMasc),
            ("Campeonato Nacional contrarreloj", nil, nil, .criMasc),
            ("Campeonato de Francia femenino", nil, nil, .lineaFem),
            ("Championnat de France", "female", nil, .lineaFem),
            ("Campeonato de Italia sub-23", nil, nil, .lineaSub23M),
            ("Campeonato U23 CRI femenino", nil, nil, .criSub23F),
            ("Campeonato de Bélgica", nil, "itt", .criMasc),
            // Nombre dice "línea" → ruta, aunque primaryType sea itt.
            ("Campeonato de Bélgica en línea", nil, "itt", .lineaMasc),
        ]
        for c in cases {
            let race = makeRace(name: c.name, gender: c.gender)
            XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: makeRaceDay(primaryType: c.primaryType)), c.slot, c.name)
        }
    }

    // MARK: - Ventanas de la semana de Campeonatos

    /// El bloqueo de filtros de "Hoy" cubre la semana completa
    /// (`rangeStart`–`rangeEnd`); el filtro "Hoy" de la rejilla empieza en
    /// `todayFilterStart`, dentro de la semana, y termina con ella.
    func test_windowsFollowRangeConstants() {
        let start = ChampionshipsConfig.rangeStart
        let end = ChampionshipsConfig.rangeEnd
        let todayStart = ChampionshipsConfig.todayFilterStart
        let beforeWeek = DateFormatting.previousDay(start)!
        let afterWeek = DateFormatting.nextDay(end)!
        let beforeTodayFilter = DateFormatting.previousDay(todayStart)!
        XCTAssertGreaterThan(todayStart, start)
        XCTAssertLessThanOrEqual(todayStart, end)

        let lockCases: [(day: String, expected: Bool)] = [
            (beforeWeek, false), (start, true), (beforeTodayFilter, true), (end, true), (afterWeek, false),
        ]
        for c in lockCases {
            XCTAssertEqual(ChampionshipsConfig.isChampWeekFilterLock(today: c.day), c.expected, "bloqueo \(c.day)")
        }

        let todayFilterCases: [(day: String, expected: Bool)] = [
            (start, false), (beforeTodayFilter, false), (todayStart, true), (end, true), (afterWeek, false),
        ]
        for c in todayFilterCases {
            XCTAssertEqual(ChampionshipsConfig.isTodayFilterActive(today: c.day), c.expected, "filtro Hoy \(c.day)")
        }
    }

    // MARK: - Orden interno de la categoría CN en Hoy/Mes

    func test_compare_nilWhenNotChampionship() {
        let cn = makeRace(name: "Campeonato de España Línea")
        var notCn = makeRace(name: "Tour")
        notCn = Race(
            id: notCn.id, name: "Tour", nameEn: nil,
            uciCategory: "2.UWT", gender: nil, raceFormat: "stage_race",
            countryCode: "FR", colorHex: nil, logoUrl: nil, websiteUrl: nil,
            hideFlag: false, isGrandTour: false,
            isCancelled: false, startDate: nil, endDate: nil,
            year: 2026, slug: nil, originalName: nil, startlistImportedAt: nil,
            startlistProvisional: nil
        )
        XCTAssertNil(ChampionshipsConfig.compare(cn, makeRaceDay(), notCn, makeRaceDay()))
    }

    func test_compare_byCountryOrder() {
        let es = makeRace(name: "Campeonato de España Línea Élite Masc", country: "ES")
        let fr = makeRace(name: "Championnat de France Ligne Élite Homme", country: "FR")
        XCTAssertLessThan(ChampionshipsConfig.compare(es, makeRaceDay(), fr, makeRaceDay())!, 0)
    }

    func test_compare_allLineaBeforeAllCri() {
        let lineaFem = makeRace(name: "Campeonato de España Línea Élite Femenino", gender: "female")
        let criMasc = makeRace(name: "Campeonato de España CRI Élite Masculino")
        XCTAssertLessThan(
            ChampionshipsConfig.compare(lineaFem, makeRaceDay(), criMasc, makeRaceDay(primaryType: "itt"))!, 0
        )
    }

    func test_compare_blockOrderEliteMascFemSub23() {
        let a = makeRace(name: "Campeonato de España Línea Élite Masculino")
        let b = makeRace(name: "Campeonato de España Línea Élite Femenino", gender: "female")
        let c = makeRace(name: "Campeonato de España Línea sub-23 Masculino")
        let d = makeRace(name: "Campeonato de España Línea sub-23 Femenino", gender: "female")
        XCTAssertLessThan(ChampionshipsConfig.compare(a, makeRaceDay(), b, makeRaceDay())!, 0)
        XCTAssertLessThan(ChampionshipsConfig.compare(b, makeRaceDay(), c, makeRaceDay())!, 0)
        XCTAssertLessThan(ChampionshipsConfig.compare(c, makeRaceDay(), d, makeRaceDay())!, 0)
    }

    func test_countryIndex_absentGoesLast() {
        XCTAssertEqual(ChampionshipsConfig.countryIndex("ES"), 0)
        XCTAssertEqual(ChampionshipsConfig.countryIndex("ZZ"), ChampionshipsConfig.countryOrder.count)
        XCTAssertEqual(ChampionshipsConfig.countryIndex(nil), ChampionshipsConfig.countryOrder.count)
    }

    // MARK: - Clasificación CN para filtros Pro/Masc/Fem

    func test_isU23Championship() {
        XCTAssertTrue(ChampionshipsConfig.isU23Championship(makeRace(name: "Campeonato de España Línea sub-23 Masculino")))
        XCTAssertTrue(ChampionshipsConfig.isU23Championship(makeRace(name: "Campeonato de España CRI U23 Femenino")))
        XCTAssertFalse(ChampionshipsConfig.isU23Championship(makeRace(name: "Campeonato de España Línea Élite Masculino")))
    }

    func test_isFemaleChampionship() {
        XCTAssertTrue(ChampionshipsConfig.isFemaleChampionship(makeRace(name: "Campeonato de España Femenino")))
        XCTAssertTrue(ChampionshipsConfig.isFemaleChampionship(makeRace(name: "Championnat de France", gender: "female")))
        XCTAssertFalse(ChampionshipsConfig.isFemaleChampionship(makeRace(name: "Campeonato Masculino", gender: "female")))
        XCTAssertFalse(ChampionshipsConfig.isFemaleChampionship(makeRace(name: "Campeonato Élite", gender: "male")))
    }

    // MARK: - Helpers

    private func makeRace(name: String, gender: String? = nil, country: String = "ES") -> Race {
        Race(
            id: UUID().uuidString, name: name, nameEn: nil,
            uciCategory: "CN", gender: gender, raceFormat: "one_day",
            countryCode: country, colorHex: nil, logoUrl: nil, websiteUrl: nil,
            hideFlag: false, isGrandTour: false,
            isCancelled: false, startDate: "2026-06-27", endDate: "2026-06-27",
            year: 2026, slug: nil, originalName: nil, startlistImportedAt: nil,
            startlistProvisional: nil
        )
    }

    private func makeRaceDay(primaryType: String? = nil) -> RaceDay {
        RaceDay(
            id: UUID().uuidString, raceId: nil, dateKey: "2026-06-27", slug: nil,
            isRestDay: false, isCancelledDay: false, stageNumber: nil,
            startLocation: nil, finishLocation: nil, distanceKm: nil,
            primaryType: primaryType, secondaryType: nil,
            neutralStartTimeUtc: nil, estimatedFinishTimeUtc: nil,
            tvStatus: nil, description: nil, bonuses: nil, notes: nil,
            editorialStatus: "published", hasAssets: false,
            updatedAt: nil, countryCode: nil
        )
    }
}

// MARK: - Cierre de temporada en Hoy

final class TodaySeasonTests: XCTestCase {

    func test_lastDay_2026IsOctober18() {
        XCTAssertEqual(TodaySeason.lastDay(today: "2026-09-27"), "2026-10-18")
        XCTAssertEqual(TodaySeason.lastDay(today: "2026-12-31"), "2026-10-18")
    }

    func test_clamp_movesLaterDatesToLastDay() {
        XCTAssertEqual(TodaySeason.clamp("2026-10-19", today: "2026-09-27"), "2026-10-18")
        XCTAssertEqual(TodaySeason.clamp("2026-11-02", today: "2026-11-02"), "2026-10-18")
        XCTAssertEqual(TodaySeason.clamp("2026-10-09", today: "2026-10-19"), "2026-10-09")
    }

    func test_yearWithoutClosingDate_hasNoLimit() {
        XCTAssertNil(TodaySeason.lastDay(today: "2027-01-02"))
        XCTAssertEqual(TodaySeason.clamp("2027-10-30", today: "2027-01-02"), "2027-10-30")
        XCTAssertTrue(TodaySeason.contains("2027-10-30", today: "2027-01-02"))
    }

    func test_contains_excludesDaysAfterLastDay() {
        XCTAssertTrue(TodaySeason.contains("2026-10-18", today: "2026-10-01"))
        XCTAssertFalse(TodaySeason.contains("2026-10-19", today: "2026-10-01"))
    }
}
