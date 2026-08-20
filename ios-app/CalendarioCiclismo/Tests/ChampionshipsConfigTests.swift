import XCTest
@testable import CalendarioCiclismo

final class ChampionshipsConfigTests: XCTestCase {

    // MARK: - Pertenencia al rango de fechas

    func test_dates_includeRangeBounds() {
        XCTAssertTrue(ChampionshipsConfig.dates.contains("2026-06-22"))
        XCTAssertTrue(ChampionshipsConfig.dates.contains("2026-06-28"))
    }

    func test_dates_excludeOutsideRange() {
        XCTAssertFalse(ChampionshipsConfig.dates.contains("2026-06-21"))
        XCTAssertFalse(ChampionshipsConfig.dates.contains("2026-06-29"))
    }

    // MARK: - Clasificación de slot (espejo de championshipSlot web)

    func test_slot_eliteMenRoadByDefault() {
        let race = makeRace(name: "Campeonato de España de ruta")
        XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: makeRaceDay()), .lineaMasc)
    }

    func test_slot_criByName() {
        let race = makeRace(name: "Campeonato de España CRI")
        XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: makeRaceDay()), .criMasc)
    }

    func test_slot_criByContrarrelojWord() {
        let race = makeRace(name: "Campeonato Nacional contrarreloj")
        XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: makeRaceDay()), .criMasc)
    }

    func test_slot_femaleByName() {
        let race = makeRace(name: "Campeonato de Francia femenino")
        XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: makeRaceDay()), .lineaFem)
    }

    func test_slot_femaleByGenderField() {
        let race = makeRace(name: "Championnat de France", gender: "female")
        XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: makeRaceDay()), .lineaFem)
    }

    func test_slot_sub23() {
        let race = makeRace(name: "Campeonato de Italia sub-23")
        XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: makeRaceDay()), .lineaSub23M)
    }

    func test_slot_sub23FemaleCri() {
        let race = makeRace(name: "Campeonato U23 CRI femenino")
        XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: makeRaceDay()), .criSub23F)
    }

    func test_slot_fallbackToPrimaryTypeItt() {
        let race = makeRace(name: "Campeonato de Bélgica")
        let rd = makeRaceDay(primaryType: "itt")
        XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: rd), .criMasc)
    }

    func test_slot_nameLineaOverridesPrimaryTypeItt() {
        // Nombre dice "línea" → ruta, aunque primaryType sea itt.
        let race = makeRace(name: "Campeonato de Bélgica en línea")
        let rd = makeRaceDay(primaryType: "itt")
        XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: rd), .lineaMasc)
    }

    // MARK: - Filtros → slots

    func test_filter_slots() {
        XCTAssertEqual(ChampionshipsConfig.Filter.all.slots.count, 8)
        XCTAssertEqual(ChampionshipsConfig.Filter.pro.slots, [.lineaMasc, .criMasc, .lineaFem, .criFem])
        XCTAssertEqual(ChampionshipsConfig.Filter.male.slots, [.lineaMasc, .criMasc])
        XCTAssertEqual(ChampionshipsConfig.Filter.female.slots, [.lineaFem, .criFem])
    }

    // MARK: - Filtro "Hoy" (rango 24–28 jun)

    func test_todayFilter_activeWithinRange() {
        XCTAssertTrue(ChampionshipsConfig.isTodayFilterActive(today: "2026-06-24"))
        XCTAssertTrue(ChampionshipsConfig.isTodayFilterActive(today: "2026-06-26"))
        XCTAssertTrue(ChampionshipsConfig.isTodayFilterActive(today: "2026-06-28"))
    }

    func test_todayFilter_inactiveBeforeAndAfter() {
        // Primeros dos días de campeonatos (22, 23) → sin filtro.
        XCTAssertFalse(ChampionshipsConfig.isTodayFilterActive(today: "2026-06-22"))
        XCTAssertFalse(ChampionshipsConfig.isTodayFilterActive(today: "2026-06-23"))
        // Después del 28 → sin filtro.
        XCTAssertFalse(ChampionshipsConfig.isTodayFilterActive(today: "2026-06-29"))
        XCTAssertFalse(ChampionshipsConfig.isTodayFilterActive(today: "2026-07-01"))
    }

    // ── Bloqueo de filtros de "Hoy" en la semana de campeonatos (22–28) ──

    func test_champWeekLock_activeWholeWeekIncl2223() {
        XCTAssertTrue(ChampionshipsConfig.isChampWeekFilterLock(today: "2026-06-22"))
        XCTAssertTrue(ChampionshipsConfig.isChampWeekFilterLock(today: "2026-06-23"))
        XCTAssertTrue(ChampionshipsConfig.isChampWeekFilterLock(today: "2026-06-25"))
        XCTAssertTrue(ChampionshipsConfig.isChampWeekFilterLock(today: "2026-06-28"))
    }

    func test_champWeekLock_inactiveOutsideWeek() {
        XCTAssertFalse(ChampionshipsConfig.isChampWeekFilterLock(today: "2026-06-21"))
        XCTAssertFalse(ChampionshipsConfig.isChampWeekFilterLock(today: "2026-06-29"))
        XCTAssertFalse(ChampionshipsConfig.isChampWeekFilterLock(today: "2026-07-01"))
    }

    func test_champWeekLock_filtersAreAllProMaleFemaleDefaultMale() {
        XCTAssertEqual(ChampionshipsConfig.champWeekHoyFilters, [.all, .pro, .male, .female])
        XCTAssertEqual(ChampionshipsConfig.champWeekHoyDefault, .male)
        XCTAssertFalse(ChampionshipsConfig.champWeekHoyFilters.contains(.uwt))
        XCTAssertFalse(ChampionshipsConfig.champWeekHoyFilters.contains(.wwt))
    }

    func test_todayFilter_isFirstAndAllowsAllSlots() {
        XCTAssertEqual(ChampionshipsConfig.Filter.allCases.first, .today)
        XCTAssertEqual(ChampionshipsConfig.Filter.today.slots, ChampionshipsConfig.Slot.allCases)
    }

    // MARK: - Orden interno de la categoría CN en Hoy/Mes

    func test_compare_nilWhenNotChampionship() {
        let cn = makeRace(name: "Campeonato de España Línea")
        var notCn = makeRace(name: "Tour")
        notCn = Race(
            id: notCn.id, name: "Tour", nameEn: nil, abbrev: nil,
            uciCategory: "2.UWT", gender: nil, raceFormat: "stage_race",
            countryCode: "FR", colorHex: nil, logoUrl: nil, websiteUrl: nil,
            fcId: nil, pcsSlug: nil, hideFlag: false, isGrandTour: false,
            isCancelled: false, startDate: nil, endDate: nil,
            year: 2026, slug: nil, originalName: nil, startlistImportedAt: nil,
            startlistProvisional: nil, enrichedStartlist: nil
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
            id: UUID().uuidString, name: name, nameEn: nil, abbrev: nil,
            uciCategory: "CN", gender: gender, raceFormat: "one_day",
            countryCode: country, colorHex: nil, logoUrl: nil, websiteUrl: nil,
            fcId: nil, pcsSlug: nil, hideFlag: false, isGrandTour: false,
            isCancelled: false, startDate: "2026-06-27", endDate: "2026-06-27",
            year: 2026, slug: nil, originalName: nil, startlistImportedAt: nil,
            startlistProvisional: nil, enrichedStartlist: nil
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
