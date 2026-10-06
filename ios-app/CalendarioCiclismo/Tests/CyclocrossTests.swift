import XCTest
@testable import CalendarioCiclismo

final class CyclocrossTests: XCTestCase {
    private let fixture = """
    {"id":"cx-1","name":"Prueba local","slug":"prueba","slugEn":"test","seasonKey":"2026-27","dateKey":"2027-01-29","endDateKey":"2027-01-31","class":"CM","isCancelled":false,"cx_race_categories":[
    {"category":"ME","startTimeUtc":"2027-01-31T14:00:00Z","dateKey":"2027-01-31","sortOrder":0,"isCancelled":false,"resultsStatus":"pending","durationFormat":"individual","durationRuleVersion":"2026-07-01","durationMinutes":60},
    {"category":"WE","dateKey":"2027-01-30","sortOrder":1,"isCancelled":false,"resultsStatus":"pending"}]}
    """

    private func race() throws -> CxRace { try JSONDecoder().decode(CxRace.self, from: Data(fixture.utf8)) }

    func testNationalRacesHiddenOnlyInEnglish() throws {
        let national = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"class\":\"CM\"", with: "\"class\":\"NAC\"").utf8))
        let defaults = UserDefaults.standard
        let previous = defaults.string(forKey: "app_locale")
        defer { defaults.set(previous, forKey: "app_locale") }
        defaults.set("en", forKey: "app_locale")
        XCTAssertTrue(CyclocrossPresentation.isHidden(national))
        XCTAssertFalse(CyclocrossPresentation.isHidden(try race()))
        defaults.set("es", forKey: "app_locale")
        XCTAssertFalse(CyclocrossPresentation.isHidden(national))
    }

    @MainActor
    func testTournamentHeaderUsesOnlyCurrentTournamentRounds() throws {
        func tournamentRace(_ id: String, _ tournamentId: String) throws -> CxRace {
            let payload = fixture.replacingOccurrences(of: "\"id\":\"cx-1\"", with: "\"id\":\"\(id)\",\"tournamentId\":\"\(tournamentId)\"")
            return try JSONDecoder().decode(CxRace.self, from: Data(payload.utf8))
        }
        let races = try [tournamentRace("target", "hg"), tournamentRace("other", "world")]
        let rounds = ["target": CxRound(n: 2, total: 7), "other": CxRound(n: 3, total: 15)]
        XCTAssertEqual(CyclocrossPresentation.tournamentRoundTotal("hg", races: races, rounds: rounds), 7)
        XCTAssertEqual(CyclocrossPresentation.tournamentRoundTotal("world", races: races, rounds: rounds), 15)
        XCTAssertEqual(CyclocrossPresentation.tournamentRoundTotal("missing", races: races, rounds: rounds), 0)
    }

    @MainActor
    func testDataRideSubhourTimesUseTimeSecondsLikeWeb() throws {
        let input = """
        [{"id":1,"raceId":"rochester","category":"ME","rank":1,"riderDisplay":"Winner","timeText":"57:41:00","timeSeconds":3461,"sortOrder":0},
        {"id":2,"raceId":"rochester","category":"ME","rank":2,"riderDisplay":"Second","timeText":"57:53:00","gapText":"+12","timeSeconds":3473,"sortOrder":1},
        {"id":3,"raceId":"rochester","category":"ME","rank":3,"riderDisplay":"Third","timeText":"58:15:00","gapText":"+34","timeSeconds":3495,"sortOrder":2}]
        """
        let vm = CyclocrossPresentation.resultRows(try JSONDecoder().decode([CxResult].self, from: Data(input.utf8)))
        XCTAssertEqual(vm[0].valueText, "57:41")
        XCTAssertEqual(vm[1].valueText, "+12\"")
        XCTAssertEqual(vm[2].valueText, "+34\"")
    }

    @MainActor
    func testResultTimesAndIrmShareRoadPresentationExceptLaps() throws {
        let input = """
        [{"id":1,"raceId":"canmore","category":"MJ","rank":1,"riderDisplay":"Winner","timeText":"42:09.2","sortOrder":0},
        {"id":2,"raceId":"canmore","category":"MJ","rank":2,"riderDisplay":"Second","timeText":"42:09.3","sortOrder":1},
        {"id":3,"raceId":"canmore","category":"MJ","rank":3,"riderDisplay":"Third","timeText":"42:39.7","sortOrder":2},
        {"id":4,"raceId":"canmore","category":"MJ","rank":4,"riderDisplay":"Lapped","irm":"LAP","gapText":"-2 LAPS","sortOrder":3},
        {"id":5,"raceId":"canmore","category":"MJ","rank":5,"riderDisplay":"Out","irm":"DNF","timeText":"7:16.9","sortOrder":4}]
        """
        let rows = try JSONDecoder().decode([CxResult].self, from: Data(input.utf8))
        let vm = CyclocrossPresentation.resultRows(rows)
        XCTAssertEqual(vm[0].valueText, "42:09")
        XCTAssertEqual(vm[1].valueKind, .sameTime)
        XCTAssertEqual(vm[2].rowGap, "+30\"")
        XCTAssertEqual(CyclocrossPresentation.lapsLost(rows[3]), 2)
        XCTAssertEqual(vm[3].rank, 4)
        XCTAssertNil(vm[4].rank)
        XCTAssertEqual(vm[4].valueText, "")
        XCTAssertNotNil(vm[4].rankBadge)
    }

    func testDatesUseActualCategoriesAndNeverAddRelayOrDerivedWU() throws {
        let race = try race()
        XCTAssertEqual(CyclocrossLogic.dates(race), ["2027-01-30", "2027-01-31"])
        XCTAssertTrue(CyclocrossLogic.categories(on: "2027-01-29", race: race).isEmpty)
        XCTAssertEqual(CyclocrossLogic.categories(on: "2027-01-30", race: race).map(\.category), ["WE"])
        XCTAssertEqual(CxMonth(year: 2027, month: 7).season, "2027-28")
        XCTAssertEqual(CxMonth(year: 2027, month: 8).season, "2027-28")
        XCTAssertEqual(CxMonth(year: 2027, month: 12).next, CxMonth(year: 2028, month: 1))
    }

    func testAgendaOrdersByHighestRankedScheduledCategory() throws {
        let date = "2027-01-30"
        func makeRace(_ name: String, raceClass: String = "C2", categories: [(String, String?, Bool)]) throws -> CxRace {
            let categoryRows = categories.enumerated().map { index, category -> [String: Any] in
                var row: [String: Any] = [
                    "category": category.0,
                    "dateKey": date,
                    "sortOrder": index,
                    "isCancelled": category.2,
                    "resultsStatus": "pending"
                ]
                if let startTime = category.1 { row["startTimeUtc"] = startTime }
                return row
            }
            let payload: [String: Any] = [
                "id": name,
                "name": name,
                "slug": name.lowercased().replacingOccurrences(of: " ", with: "-"),
                "seasonKey": "2026-27",
                "dateKey": date,
                "class": raceClass,
                "isCancelled": false,
                "cx_race_categories": categoryRows
            ]
            return try JSONDecoder().decode(CxRace.self, from: JSONSerialization.data(withJSONObject: payload))
        }

        let rows = try [
            makeRace("Élite tardía", categories: [("WE", "2027-01-30T10:00:00Z", false), ("ME", "2027-01-30T15:00:00Z", false)]),
            makeRace("Élite temprana", categories: [("WE", "2027-01-30T13:00:00Z", false), ("ME", "2027-01-30T14:00:00Z", false)]),
            makeRace("U23", categories: [("MU", "2027-01-30T13:00:00Z", false)]),
            makeRace("U23 femenina", categories: [("WJ", "2027-01-30T08:00:00Z", false), ("MJ", "2027-01-30T09:00:00Z", false), ("WU", "2027-01-30T13:30:00Z", false)]),
            makeRace("Sin élite", categories: [("ME", nil, false), ("MU", "2027-01-30T12:00:00Z", false), ("WE", "2027-01-30T16:00:00Z", false)]),
            makeRace("Élite cancelada", categories: [("ME", "2027-01-30T11:00:00Z", true), ("WE", "2027-01-30T17:00:00Z", false)]),
            makeRace("Junior masculino", categories: [("WJ", "2027-01-30T08:00:00Z", false), ("MJ", "2027-01-30T18:00:00Z", false)]),
            makeRace("Junior femenino", categories: [("WJ", "2027-01-30T19:00:00Z", false)]),
            makeRace("Sin horario", categories: [("ME", nil, false)]),
            makeRace("C1 temprana", raceClass: "C1", categories: [("ME", "2027-01-30T08:00:00Z", false)]),
            makeRace("Mundial tarde", raceClass: "CM", categories: [("ME", "2027-01-30T18:00:00Z", false)]),
            makeRace("Clase desconocida", raceClass: "X", categories: [("ME", "2027-01-30T07:00:00Z", false)])
        ]
        XCTAssertEqual(CyclocrossLogic.races(on: date, races: rows).map(\.name), [
            "Mundial tarde", "C1 temprana", "U23", "U23 femenina", "Élite temprana", "Élite tardía", "Sin élite", "Élite cancelada", "Junior masculino", "Junior femenino", "Sin horario", "Clase desconocida"
        ])
    }

    func testBoundariesDoNotPublishPendingResults() throws {
        let race = try race()
        let category = race.categories[0]
        XCTAssertEqual(CyclocrossLogic.timing(race: race, category: category, at: CyclocrossLogic.instant("2027-01-31T13:59:59Z")!).temporalState, .scheduled)
        XCTAssertEqual(CyclocrossLogic.timing(race: race, category: category, at: CyclocrossLogic.instant("2027-01-31T14:00:00Z")!).temporalState, .live)
        let final = CyclocrossLogic.timing(race: race, category: category, at: CyclocrossLogic.instant("2027-01-31T15:00:00Z")!)
        XCTAssertEqual(final.temporalState, .estimatedFinished)
        XCTAssertEqual(final.resultsStatus, "pending")
        XCTAssertEqual(CyclocrossLogic.timing(race: race, category: race.categories[1]).temporalState, .unknown)
        let unknown = fixture.replacingOccurrences(of: "\"durationRuleVersion\":\"2026-07-01\"", with: "\"durationRuleVersion\":null")
        let oldCache = try JSONDecoder().decode(CxRace.self, from: Data(unknown.utf8))
        XCTAssertNil(CyclocrossLogic.timing(race: oldCache, category: oldCache.categories[0]).estimatedEnd)
    }

    func testDurationUsesElapsedUTCMinutesThroughDST() throws {
        let race = try race()
        let grouped = """
        {"category":"WE","startTimeUtc":"2026-10-25T02:30:00+02:00","sortOrder":0,"isCancelled":false,"resultsStatus":"pending","durationFormat":"WE_WJ","durationRuleVersion":"2026-07-01","durationMinutes":45}
        """
        let category = try JSONDecoder().decode(CxCategory.self, from: Data(grouped.utf8))
        XCTAssertEqual(CyclocrossLogic.timing(race: race, category: category).estimatedEnd, CyclocrossLogic.instant("2026-10-25T01:15:00Z"))
    }

    func testPlaceholderCardsRequireDocumentsScheduleAndNonCancelled() throws {
        // Con Libro de Ruta/Mapa y horarios la card es clicable.
        let loaded = """
        {"id":"cx-1","name":"Prueba local","slug":"prueba","seasonKey":"2026-27","dateKey":"2026-12-05","class":"C1","isCancelled":false,
        "assets":[{"id":"a1","type":"map","url":"https://assets.example.org/map.png"}],
        "cx_race_categories":[{"category":"ME","startTimeUtc":"2026-12-05T13:00:00Z","dateKey":"2026-12-05","sortOrder":0,"isCancelled":false,"resultsStatus":"pending"}]}
        """
        let race = try JSONDecoder().decode(CxRace.self, from: Data(loaded.utf8))
        XCTAssertTrue(CyclocrossLogic.raceOpen(race))
        XCTAssertFalse(CyclocrossLogic.hasDocuments(race) == false)
        // Sin documento o sin horarios, la card es placeholder.
        let withoutDocs = """
        {"id":"cx-1","name":"Prueba local","slug":"prueba","seasonKey":"2026-27","dateKey":"2026-12-05","class":"C1","isCancelled":false,
        "cx_race_categories":[{"category":"ME","startTimeUtc":"2026-12-05T13:00:00Z","dateKey":"2026-12-05","sortOrder":0,"isCancelled":false,"resultsStatus":"pending"}]}
        """
        let noDocs = try JSONDecoder().decode(CxRace.self, from: Data(withoutDocs.utf8))
        XCTAssertFalse(CyclocrossLogic.raceOpen(noDocs))
        let withoutSchedule = loaded.replacingOccurrences(of: "\"startTimeUtc\":\"2026-12-05T13:00:00Z\",", with: "")
        let noSchedule = try JSONDecoder().decode(CxRace.self, from: Data(withoutSchedule.utf8))
        XCTAssertFalse(CyclocrossLogic.raceOpen(noSchedule))
        // Cancelada siempre, aunque tenga la carga mínima completa.
        XCTAssertTrue(CyclocrossLogic.raceOpen(race) && race.isCancelled == false)
        let cancelledData = loaded.replacingOccurrences(of: "\"isCancelled\":false", with: "\"isCancelled\":true")
        let cancelled = try JSONDecoder().decode(CxRace.self, from: Data(cancelledData.utf8))
        XCTAssertTrue(CyclocrossLogic.hasDocuments(cancelled))
        XCTAssertTrue(cancelled.isCancelled)
    }

    func testPublishedClassificationOpensRaceWithoutDocumentsOrSchedule() throws {
        let bare = """
        {"id":"cx-1","name":"Prueba local","slug":"prueba","seasonKey":"2026-27","dateKey":"2026-12-05","class":"C1","isCancelled":false,
        "cx_race_categories":[{"category":"ME","dateKey":"2026-12-05","sortOrder":0,"isCancelled":false,"resultsStatus":"pending"}]}
        """
        let race = try JSONDecoder().decode(CxRace.self, from: Data(bare.utf8))
        XCTAssertFalse(CyclocrossLogic.hasClassifications(race))
        XCTAssertFalse(CyclocrossLogic.raceOpen(race))
        for status in ["official", "provisional"] {
            let published = bare.replacingOccurrences(of: "\"resultsStatus\":\"pending\"", with: "\"resultsStatus\":\"\(status)\"")
            let withResults = try JSONDecoder().decode(CxRace.self, from: Data(published.utf8))
            XCTAssertTrue(CyclocrossLogic.hasClassifications(withResults))
            XCTAssertTrue(CyclocrossLogic.raceOpen(withResults))
        }
    }
    @MainActor
    func testCategoryCardsKeepClockUntilFinishAndSeparatePendingFromPublished() throws {
        let original = try race()
        XCTAssertEqual(CyclocrossPresentation.categoryCardState(race: original, category: original.categories[0], at: CyclocrossLogic.instant("2027-01-31T14:59:59Z")!), .time)
        let finish = CyclocrossLogic.instant("2027-01-31T15:00:00Z")!
        XCTAssertEqual(CyclocrossPresentation.categoryCardState(race: original, category: original.categories[0], at: finish), .awaiting)
        let later = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "14:00:00Z", with: "16:00:00Z").utf8))
        XCTAssertEqual(CyclocrossPresentation.categoryCardState(race: later, category: later.categories[0], at: finish), .time)
        for status in ["official", "provisional"] {
            let published = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"resultsStatus\":\"pending\"", with: "\"resultsStatus\":\"\(status)\"").utf8))
            XCTAssertEqual(CyclocrossPresentation.categoryCardState(race: published, category: published.categories[0], at: finish), .results)
        }
        // Solo Mundiales/Continentales/Copa del Mundo y los torneos Superprestige
        // y X2O hacen esperar resultados; el resto muestra su hora de salida.
        for cls in ["C1", "C2", "CN", "NAC"] {
            let national = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"class\":\"CM\"", with: "\"class\":\"\(cls)\"").utf8))
            XCTAssertEqual(CyclocrossPresentation.categoryCardState(race: national, category: national.categories[0], at: finish), .time)
        }
        let base = fixture.replacingOccurrences(of: "\"class\":\"CM\"", with: "\"class\":\"C1\"")
        for slug in ["superprestige", "x2o", "copadelmundo"] {
            let withTournament = try JSONDecoder().decode(CxRace.self, from: Data(base.replacingOccurrences(of: "\"cx_race_categories\":", with: "\"cx_tournaments\":{\"id\":\"t\",\"name\":\"Torneo\",\"slug\":\"\(slug)\"},\"cx_race_categories\":").utf8))
            XCTAssertEqual(CyclocrossPresentation.categoryCardState(race: withTournament, category: withTournament.categories[0], at: finish), .awaiting)
        }
        let copa = try JSONDecoder().decode(CxRace.self, from: Data(base.replacingOccurrences(of: "\"cx_race_categories\":", with: "\"cx_tournaments\":{\"id\":\"t\",\"name\":\"Copa de España\",\"slug\":\"copa\"},\"cx_race_categories\":").utf8))
        XCTAssertEqual(CyclocrossPresentation.categoryCardState(race: copa, category: copa.categories[0], at: finish), .time)
    }
    @MainActor
    func testAgendaFilterBigProAndSpain() throws {
        let base = try race() // class CM, sin país
        XCTAssertTrue(CyclocrossPresentation.matchesFilter(base, filter: .all))
        XCTAssertTrue(CyclocrossPresentation.matchesFilter(base, filter: .big))
        XCTAssertTrue(CyclocrossPresentation.matchesFilter(base, filter: .pro))
        XCTAssertFalse(CyclocrossPresentation.matchesFilter(base, filter: .spain))
        let national = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"class\":\"CM\"", with: "\"class\":\"NAC\"").utf8))
        XCTAssertFalse(CyclocrossPresentation.matchesFilter(national, filter: .big))
        XCTAssertFalse(CyclocrossPresentation.matchesFilter(national, filter: .pro))
        XCTAssertTrue(CyclocrossPresentation.matchesFilter(national, filter: .all))
        let superprestige = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"class\":\"CM\"", with: "\"class\":\"C1\"").replacingOccurrences(of: "\"cx_race_categories\":", with: "\"cx_tournaments\":{\"id\":\"t\",\"name\":\"Telenet Superprestige\",\"slug\":\"superprestige\"},\"cx_race_categories\":").utf8))
        XCTAssertTrue(CyclocrossPresentation.matchesFilter(superprestige, filter: .big))
        let c2 = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"class\":\"CM\"", with: "\"class\":\"C2\"").replacingOccurrences(of: "\"cx_race_categories\":", with: "\"cx_tournaments\":{\"id\":\"t\",\"name\":\"Copa de España\",\"slug\":\"copa\"},\"cx_race_categories\":").utf8))
        XCTAssertFalse(CyclocrossPresentation.matchesFilter(c2, filter: .big))
        XCTAssertTrue(CyclocrossPresentation.matchesFilter(c2, filter: .pro))
        let regional = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"class\":\"CM\"", with: "\"class\":\"NAC\",\"countryCode\":\"ES-MD\"").utf8))
        XCTAssertTrue(CyclocrossPresentation.matchesFilter(regional, filter: .spain))
        XCTAssertFalse(CyclocrossPresentation.matchesFilter(regional, filter: .big))
        XCTAssertFalse(CyclocrossPresentation.matchesFilter(regional, filter: .pro))
    }

    @MainActor
    func testCategoryBadgesOnlyWhenNoCategoryHasSchedule() throws {
        let race = try race()
        XCTAssertTrue(CyclocrossPresentation.usesCategoryBadges(race: race, categories: CyclocrossLogic.categories(on: "2027-01-30", race: race), at: CyclocrossLogic.instant("2027-01-30T10:00:00Z")!))
        XCTAssertFalse(CyclocrossPresentation.usesCategoryBadges(race: race, categories: CyclocrossLogic.categories(on: "2027-01-31", race: race), at: CyclocrossLogic.instant("2027-01-31T10:00:00Z")!))
        let resultsOnly = try JSONDecoder().decode(CxRace.self, from: Data("""
        {"id":"cx-2","name":"Con resultados","slug":"con","slugEn":"with","seasonKey":"2026-27","dateKey":"2027-01-30","class":"C2","isCancelled":false,"cx_race_categories":[{"category":"ME","dateKey":"2027-01-30","sortOrder":0,"resultsStatus":"official","isCancelled":false}]}
        """.utf8))
        XCTAssertFalse(CyclocrossPresentation.usesCategoryBadges(race: resultsOnly, categories: resultsOnly.categories, at: CyclocrossLogic.instant("2027-01-30T16:00:00Z")!))
        XCTAssertFalse(CyclocrossPresentation.usesCategoryBadges(race: race, categories: [], at: Date()))
    }

    func testResultsKeepTextBibsBigIntegersUnknownBonusesAndDurationsOver24Hours() throws {
        let text = """
        {"id":9007199254740993,"raceId":"cx-1","category":"ME","bib":"A12","riderDisplay":"Corredor local","sortOrder":0,"timeSeconds":90061,"bonusSeconds":null,"irm":"DF"}
        """
        let row = try JSONDecoder().decode(CxResult.self, from: Data(text.utf8))
        XCTAssertEqual(row.id, 9_007_199_254_740_993)
        XCTAssertEqual(row.bib, "A12")
        XCTAssertNil(row.bonusSeconds)
        XCTAssertEqual(CyclocrossLogic.duration(row.timeSeconds), "25:01:01")
        XCTAssertEqual(CyclocrossLogic.duration(nil), "—")
        let encoded = try JSONEncoder().encode(row)
        XCTAssertNil(try JSONDecoder().decode(CxResult.self, from: encoded).bonusSeconds)
    }

    @MainActor
    func testNeverReadsMarchThroughJulyAndOfflineStopsInFebruary() async throws {
        let remote = MemoryRemote(race: try race())
        let repo = CyclocrossRepository(remote: remote, store: MemoryStore())
        for month in 3...7 {
            let value = CxMonth(year: 2027, month: month)
            XCTAssertFalse(value.isActive)
            let cached = await repo.cachedMonth(season: "2026-27", month: value)
            XCTAssertNil(cached)
            do { _ = try await repo.month(season: "2026-27", month: value); XCTFail("No debe consultar meses fuera de CX") }
            catch CxRepositoryError.invalidMonth { }
        }
        XCTAssertTrue(remote.monthCalls.isEmpty)
        let date = CyclocrossLogic.instant("2027-02-15T12:00:00Z")!
        XCTAssertEqual(CyclocrossLogic.offlineMonths(at: date), [CxMonth(year: 2027, month: 2)])
        XCTAssertEqual(CyclocrossLogic.offlineMonths(at: CyclocrossLogic.instant("2027-05-12T12:00:00Z")!), [CxMonth(year: 2027, month: 8), CxMonth(year: 2027, month: 9)])
    }

    @MainActor
    func testInactiveDetailsAreHiddenFromNetworkAndOldCache() async throws {
        let inactive = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "2027-01-", with: "2027-03-").utf8))
        let remote = MemoryRemote(race: inactive)
        let store = MemoryStore()
        let repo = CyclocrossRepository(remote: remote, store: store)
        let fresh = try await repo.detail(id: inactive.id)
        XCTAssertNil(fresh)
        XCTAssertTrue(store.details.isEmpty)
        await store.saveDetail(CxDetail(race: inactive, startlist: [], results: [], broadcasts: [], videos: [], teams: [], standings: []))
        remote.failure = CxRepositoryError.invalidMonth
        let cached = await repo.cachedDetail(id: inactive.id)
        XCTAssertNil(cached)
        do { _ = try await repo.detail(id: inactive.id); XCTFail("Debe conservar el error de red sin recuperar la ficha excluida") }
        catch CxRepositoryError.invalidMonth { }
    }

    @MainActor
    func testMonthCacheIsLimitedReplacedAndUsedOfflineWithEnglishSlug() async throws {
        let race = try race()
        let remote = MemoryRemote(race: race)
        let store = MemoryStore()
        let repo = CyclocrossRepository(remote: remote, store: store)
        let month = CxMonth(year: 2027, month: 1)
        let initial = try await repo.month(season: "2026-27", month: month)
        XCTAssertFalse(initial.offline)
        _ = try await repo.detail(id: race.id)
        remote.failure = CxRepositoryError.invalidMonth
        let cached = try await repo.month(season: "2026-27", month: month)
        XCTAssertTrue(cached.offline)
        let cachedDetail = try await repo.detail(id: race.id)
        XCTAssertTrue(cachedDetail?.offline == true)
        XCTAssertEqual(cachedDetail?.data.race.id, race.id)
        let id = try await repo.raceId(forSlug: "test")
        XCTAssertEqual(id, race.id)
        let next = try await repo.nextDate(season: "2026-27", date: "2027-01-29")
        XCTAssertEqual(next, "2027-01-30")
        XCTAssertEqual(remote.monthCalls, [month, month])
        remote.failure = nil
        remote.rows = []
        let removed = try await repo.month(season: "2026-27", month: month)
        XCTAssertTrue(removed.data.isEmpty)
        remote.failure = CancellationError()
        do { _ = try await repo.month(season: "2026-27", month: month); XCTFail("No debe ocultar una cancelación") }
        catch is CancellationError { }
    }
    @MainActor
    func testAgendaJumpsWithOnlyOpeningAndTargetMonthsThenStopsInFebruary() async throws {
        let remote = MemoryRemote(race: try race())
        remote.next = "2027-02-07"
        let model = CyclocrossAgendaModel(repo: CyclocrossRepository(remote: remote, store: MemoryStore()), today: "2026-09-12")
        await model.open("2026-27")
        XCTAssertEqual(remote.monthCalls.map(\.key), ["2026-09", "2027-02"])
        XCTAssertEqual(model.months.map(\.key), ["2027-02"])
        XCTAssertEqual(model.jumpDate, "2027-02-07")
        XCTAssertFalse(model.canNext)
        await model.selectMonth(CxMonth(year: 2027, month: 3))
        XCTAssertEqual(remote.monthCalls.count, 2)
        await model.refresh()
        XCTAssertEqual(remote.monthCalls.map(\.key), ["2026-09", "2027-02", "2027-02"])
    }

    @MainActor
    func testTournamentAgendaFiltersSharedCacheAndOfflineNextDate() async throws {
        let original = try race()
        let own = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"id\":\"cx-1\"", with: "\"id\":\"own\",\"tournamentId\":\"t\"").utf8))
        let remote = MemoryRemote(race: original)
        remote.rows = [original, own]
        let store = MemoryStore()
        let repo = CyclocrossRepository(remote: remote, store: store)
        let model = CyclocrossAgendaModel(repo: repo, today: "2027-01-29", tournamentId: "t")
        await model.open("2026-27")
        let displayed = model.rows.compactMap { row -> String? in if case .race(let race, _) = row { return race.id }; return nil }
        XCTAssertEqual(displayed, ["own", "own"])
        XCTAssertEqual(store.months["2026-27:2027-01"]?.count, 2)
        remote.failure = URLError(.notConnectedToInternet)
        let next = try await repo.nextDate(season: "2026-27", date: "2027-01-29", tournamentId: "t")
        XCTAssertEqual(next, "2027-01-30")
        let absent = try await repo.nextDate(season: "2026-27", date: "2027-01-29", tournamentId: "absent")
        XCTAssertNil(absent)
        await model.refresh()
        XCTAssertEqual(model.months.map(\.key), model.allowed.map(\.key))
        XCTAssertNil(model.activeMonth)
        XCTAssertEqual(model.jumpDate, "2027-01-30")
    }

    @MainActor
    func testMonthSelectorLoadsOnlyTargetRestoresFailureAndReusesLoadedMonth() async throws {
        let remote = MemoryRemote(race: try race())
        remote.rows = []; remote.next = nil
        let model = CyclocrossAgendaModel(repo: CyclocrossRepository(remote: remote, store: MemoryStore()), today: "2026-09-12")
        await model.open("2026-27")
        await model.selectMonth(CxMonth(year: 2027, month: 2))
        XCTAssertEqual(remote.monthCalls.map(\.key), ["2026-09", "2027-02"])
        XCTAssertEqual(model.months.map(\.key), ["2027-02"])
        XCTAssertEqual(model.activeMonth?.key, "2027-02")
        XCTAssertEqual(model.jumpDate, "2027-02-01")
        await model.selectMonth(CxMonth(year: 2027, month: 1))
        XCTAssertEqual(model.months.map(\.key), ["2027-01"])
        await model.selectMonth(CxMonth(year: 2026, month: 9))
        XCTAssertEqual(remote.monthCalls.map(\.key), ["2026-09", "2027-02", "2027-01"])
        XCTAssertEqual(model.months.map(\.key), ["2026-09"])
        await model.selectMonth(CxMonth(year: 2027, month: 3))
        XCTAssertEqual(remote.monthCalls.count, 3)
        remote.failure = CxRepositoryError.invalidMonth
        await model.selectMonth(CxMonth(year: 2026, month: 10))
        XCTAssertEqual(model.months.map(\.key), ["2026-09"])
        XCTAssertEqual(model.activeMonth?.key, "2026-09")
        XCTAssertNotNil(model.error)
        remote.failure = nil
        await model.retry()
        XCTAssertEqual(remote.monthCalls.map(\.key), ["2026-09", "2027-02", "2027-01", "2026-10", "2026-10"])
        XCTAssertEqual(model.activeMonth?.key, "2026-10")
        XCTAssertNil(model.error)
    }

    @MainActor
    func testAgendaOutsideSeasonOpensAugustAndContainsExactlySevenMonths() async throws {
        let remote = MemoryRemote(race: try race())
        remote.rows = []; remote.next = nil
        let model = CyclocrossAgendaModel(repo: CyclocrossRepository(remote: remote, store: MemoryStore()), today: "2027-05-12")
        await model.open("2027-28")
        XCTAssertEqual(model.allowed.map(\.key), ["2027-08", "2027-09", "2027-10", "2027-11", "2027-12", "2028-01", "2028-02"])
        XCTAssertEqual(model.months.map(\.key), ["2027-08"])
        XCTAssertFalse(model.canPrevious)
        XCTAssertEqual(model.rows.map(\.id), ["empty:2027-08"])
        await model.selectMonth(CxMonth(year: 2027, month: 9))
        XCTAssertEqual(remote.monthCalls.map(\.key), ["2027-08", "2027-09"])
        remote.failure = CxRepositoryError.invalidMonth
        await model.refresh()
        XCTAssertTrue(model.offline)
        XCTAssertNil(model.error)
    }

    @MainActor
    func testRefreshAndReopeningKeepSelectedMonthWithoutRequestingScroll() async throws {
        let remote = MemoryRemote(race: try race())
        remote.rows = []; remote.next = nil
        let model = CyclocrossAgendaModel(repo: CyclocrossRepository(remote: remote, store: MemoryStore()), today: "2026-09-12")
        await model.open("2026-27")
        await model.selectMonth(CxMonth(year: 2026, month: 10))
        XCTAssertEqual(model.months.map(\.key), ["2026-10"])
        model.jumpDate = nil
        await model.refresh()
        XCTAssertEqual(remote.monthCalls.map(\.key), ["2026-09", "2026-10", "2026-10"])
        XCTAssertEqual(model.activeMonth?.key, "2026-10")
        XCTAssertNil(model.jumpDate)
        await model.open("2026-27")
        await model.selectMonth(CxMonth(year: 2026, month: 10))
        XCTAssertEqual(remote.monthCalls.count, 3)
        XCTAssertEqual(model.rows.map(\.id), ["empty:2026-10"])
        XCTAssertNil(model.jumpDate)
    }

    @MainActor
    func testRefreshReplacesRaceLogoAndScheduleAndRenewsRounds() async throws {
        let original = try race()
        let remote = MemoryRemote(race: original)
        remote.next = nil
        let repo = CyclocrossRepository(remote: remote, store: MemoryStore())
        let model = CyclocrossAgendaModel(repo: repo, today: "2027-01-29")
        await model.open("2026-27")
        await model.loadRounds()
        var object = try JSONSerialization.jsonObject(with: Data(fixture.utf8)) as! [String: Any]
        object["logoUrl"] = "https://example.org/new-logo.webp"
        var categories = object["cx_race_categories"] as! [[String: Any]]
        categories[0]["startTimeUtc"] = "2027-01-31T16:00:00Z"
        object["cx_race_categories"] = categories
        remote.rows = [try JSONDecoder().decode(CxRace.self, from: JSONSerialization.data(withJSONObject: object))]
        remote.seasonRounds = [original.id: CxRound(n: 2, total: 3)]
        await model.refresh()
        let updated = try XCTUnwrap(model.cache[CxMonth(year: 2027, month: 1)]?.data.first)
        XCTAssertEqual(updated.logoUrl, "https://example.org/new-logo.webp")
        XCTAssertEqual(updated.categories[0].startTimeUtc, "2027-01-31T16:00:00Z")
        XCTAssertEqual(model.rounds[original.id]?.n, 2)
        XCTAssertEqual(remote.roundsCalls, 2)
    }

    @MainActor
    func testChangingSeasonPreventsOldNextDateFromReplacingVisibleMonths() async throws {
        let remote = MemoryRemote(race: try race())
        remote.rows = []
        let entered = expectation(description: "Consulta puntual anterior iniciada")
        var resumeOld: CheckedContinuation<String?, Never>?
        remote.nextOverride = { season in
            if season == "2026-27" {
                return await withCheckedContinuation { continuation in resumeOld = continuation; entered.fulfill() }
            }
            return nil
        }
        let model = CyclocrossAgendaModel(repo: CyclocrossRepository(remote: remote, store: MemoryStore()), today: "2026-09-12")
        let old = Task { await model.open("2026-27") }
        await fulfillment(of: [entered], timeout: 2)
        await model.open("2027-28")
        resumeOld?.resume(returning: "2027-02-07")
        await old.value
        XCTAssertEqual(model.season, "2027-28")
        XCTAssertEqual(model.months.map(\.key), ["2027-08"])
        XCTAssertEqual(model.jumpDate, "2027-08-01")
        XCTAssertNil(model.error)
        XCTAssertFalse(model.busy)
    }

    @MainActor
    func testDerivedGeneralDoesNotAddMangaAndModeIsCategorySpecific() throws {
        let text = fixture.replacingOccurrences(of: "\"cx_race_categories\":", with: "\"cx_tournaments\":{\"id\":\"x2o\",\"name\":\"X2O\",\"slug\":\"x2o\",\"pointsScheme\":{\"categories\":{\"ME\":{\"mode\":\"time\"},\"WU\":{\"mode\":\"points\"}}}},\"cx_race_categories\":")
        let configured = try JSONDecoder().decode(CxRace.self, from: Data(text.utf8))
        let detail = CxDetail(race: configured, startlist: [], results: [], broadcasts: [], videos: [], teams: [], standings: [])
        XCTAssertEqual(CxDetailSelection.generalCategories(detail), [])
        XCTAssertFalse(configured.categories.contains { $0.category == "WU" })
        XCTAssertEqual(CxDetailSelection.from(anchor: "general-WU", detail: detail).section, .general)
        XCTAssertEqual(CxDetailSelection.from(anchor: nil, detail: detail).section, .programme)
        XCTAssertEqual(CxDetailSelection.from(anchor: nil, detail: detail).category, "ME")
        XCTAssertEqual(CxDetailSelection.from(anchor: "ME", detail: detail).section, .programme)
        XCTAssertEqual(CxDetailSelection.from(anchor: "inscritos-WE", detail: detail).section, .startlist)
        let pendingResults = CxDetailSelection.from(anchor: "resultados-ME", detail: detail)
        XCTAssertEqual(pendingResults.section, .results)
        XCTAssertEqual(pendingResults.category, "ME")
        XCTAssertEqual(CxDetailSelection.standingMode(detail, category: "ME"), "time")
        XCTAssertEqual(CxDetailSelection.standingMode(detail, category: "WU"), "points")
        XCTAssertNil(CxDetailSelection.standingMode(detail, category: "WE"))
    }

    @MainActor
    func testTournamentPaletteOverridesIndividualColorAndDoesNotInferMembership() throws {
        // Un caso por forma de identidad: varias palabras, prefijo de patrocinador
        // y diacríticos plegados.
        for (name, expected) in [("Copa del Mundo UCI", "#8B173D"), ("Telenet Superprestige", "#FFC600"), ("Copa de España", "#D71920")] {
            var object = try JSONSerialization.jsonObject(with: Data(fixture.utf8)) as! [String: Any]
            object["colorHex"] = "#123456"
            object["cx_tournaments"] = ["id": "t", "name": name, "slug": "torneo"]
            let race = try JSONDecoder().decode(CxRace.self, from: JSONSerialization.data(withJSONObject: object))
            XCTAssertEqual(CyclocrossPresentation.color(race), expected)
            object["cx_tournaments"] = ["id": "t", "name": name, "slug": "torneo", "colorHex": "#112233"]
            XCTAssertEqual(CyclocrossPresentation.color(try JSONDecoder().decode(CxRace.self, from: JSONSerialization.data(withJSONObject: object))), "#112233")
            object.removeValue(forKey: "cx_tournaments")
            object["name"] = name
            XCTAssertEqual(CyclocrossPresentation.color(try JSONDecoder().decode(CxRace.self, from: JSONSerialization.data(withJSONObject: object))), "#123456")
        }
    }

    @MainActor
    func testDetailSectionsRequirePublishedRowsAndNormalizeUnavailableAnchors() throws {
        let configured = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"pending\"", with: "\"official\"").utf8))
        let result = try JSONDecoder().decode(CxResult.self, from: Data(#"{"id":1,"raceId":"test","category":"ME","riderDisplay":"Rider","rank":1,"timeText":"1:00:00","points":40,"sortOrder":0}"#.utf8))
        let general = try JSONDecoder().decode(CxStanding.self, from: Data(#"{"id":"s","tournamentId":"t","seasonKey":"2026-27","category":"WU","rank":1,"riderDisplay":"Rider","points":50}"#.utf8))
        let empty = CxDetail(race: configured, startlist: [], results: [], broadcasts: [], videos: [], teams: [], standings: [])
        XCTAssertEqual(CxDetailSelection.sections(empty), [.programme])
        XCTAssertFalse(CxDetailSelection.showsSectionSelector(empty))
        for anchor in ["resultados-ME", "general-WU"] {
            let selection = CxDetailSelection.from(anchor: anchor, detail: empty).normalized(empty)
            XCTAssertEqual(selection.section, .programme)
            XCTAssertEqual(selection.category, "ME")
        }
        let published = CxDetail(race: configured, startlist: [], results: [result], broadcasts: [], videos: [], teams: [], standings: [general])
        XCTAssertEqual(CxDetailSelection.sections(published), [.programme, .results, .general])
        XCTAssertTrue(CxDetailSelection.showsSectionSelector(published))
        XCTAssertEqual(CxDetailSelection.resultCategories(published), ["ME"])
        XCTAssertEqual(CxDetailSelection.generalCategories(published), ["WU"])
        XCTAssertFalse(CxDetailSelection.actualCategories(published).contains("WU"))
        XCTAssertEqual(CxDetailSelection(section: .results, category: "WE").normalized(published).category, "ME")
        XCTAssertEqual(CxDetailSelection(section: .general, category: "ME").normalized(published).category, "WU")
        let noScheduleRace = try JSONDecoder().decode(CxRace.self, from: Data(fixture
            .replacingOccurrences(of: "\"pending\"", with: "\"official\"")
            .replacingOccurrences(of: "\"startTimeUtc\":\"2027-01-31T14:00:00Z\",", with: "")
            .utf8))
        let noSchedule = CxDetail(race: noScheduleRace, startlist: [], results: [result], broadcasts: [], videos: [], teams: [], standings: [general])
        XCTAssertEqual(CxDetailSelection.sections(noSchedule), [.results, .general])
        XCTAssertFalse(CxDetailSelection.showsSectionSelector(noSchedule))
        let pending = CxDetail(race: try JSONDecoder().decode(CxRace.self, from: Data(fixture.utf8)), startlist: [], results: [result], broadcasts: [], videos: [], teams: [], standings: [general])
        XCTAssertTrue(CxDetailSelection.resultCategories(pending).isEmpty)
        XCTAssertEqual(CyclocrossPresentation.resultRow(result).uciPoints, 40)
        XCTAssertEqual(CyclocrossPresentation.resultRow(result).riderName, "Rider")
        XCTAssertNil(CyclocrossPresentation.resultRow(result).team)
    }

    @MainActor
    func testResultAndStandingRowsResolveTeamStripesByNameOrAlias() throws {
        let team = try JSONDecoder().decode(CxTeam.self, from: Data(##"{"id":"t1","name":"Crelan - Corendon","uciCode":"CRC","colorHex":"#ff6600","badgeTorsoCenter":"#ff6600","badgeTorsoSides":"#002f6c","badgeShorts":"#002f6c","nameAliases":["Crelan-Corendon"]}"##.utf8))
        let neutral = try JSONDecoder().decode(CxTeam.self, from: Data(##"{"id":"t2","name":"Club Neutro","uciCode":"CLN","colorHex":"#000000"}"##.utf8))
        let teams = [team, neutral].map(\.roadTeam)
        XCTAssertTrue(teams[0].hasVisibleBadge)
        XCTAssertFalse(teams[1].hasVisibleBadge)
        let result = try JSONDecoder().decode(CxResult.self, from: Data(#"{"id":1,"raceId":"test","category":"ME","riderDisplay":"Rider","teamName":"Crelan-Corendon","rank":1,"sortOrder":0}"#.utf8))
        XCTAssertEqual(CyclocrossPresentation.resultRows([result], teams: teams).first?.team?.id, "t1")
        let standing = try JSONDecoder().decode(CxStanding.self, from: Data(#"{"id":"s","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":1,"riderDisplay":"Rider","teamName":"Crelan - Corendon","points":50}"#.utf8))
        XCTAssertEqual(CyclocrossPresentation.standingRow(standing, mode: "points", teams: teams).team?.id, "t1")
        XCTAssertNil(CyclocrossPresentation.standingRow(standing, mode: "points").team)
    }

    @MainActor
    func testGeneralUsesPriorPublicationBeforeResultsAndRequiresCurrentRoundAfterResults() throws {
        let race = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"pending\"", with: "\"official\"")
            .replacingOccurrences(of: "\"cx_race_categories\":", with: #""cx_tournaments":{"id":"t","name":"X2O","slug":"x2o","pointsScheme":{"categories":{"ME":{"mode":"time"},"WU":{"mode":"points","extras":{"derived":{"fromCategory":"ME"}}}}}},"cx_race_categories":"#).utf8))
        let result = try JSONDecoder().decode(CxResult.self, from: Data(#"{"id":1,"raceId":"test","category":"ME","riderDisplay":"Rider","rank":1,"sortOrder":0}"#.utf8))
        let rows = try JSONDecoder().decode([CxStanding].self, from: Data(#"[{"id":"s","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":1,"riderDisplay":"Rider","timeSeconds":90061},{"id":"u","tournamentId":"t","seasonKey":"2026-27","category":"WU","rank":1,"riderDisplay":"Rider","points":50}]"#.utf8))
        let prior = [CxStandingState(category: "ME", status: "ready", roundIds: ["prior"]), CxStandingState(category: "WU", status: "ready", roundIds: ["prior"])]
        var before = CxDetail(race: race, startlist: [], results: [], broadcasts: [], videos: [], teams: [], standings: rows, standingsState: prior)
        XCTAssertEqual(CxDetailSelection.generalCategories(before), ["ME", "WU"])
        var after = CxDetail(race: race, startlist: [], results: [result], broadcasts: [], videos: [], teams: [], standings: rows, standingsState: prior)
        XCTAssertTrue(CxDetailSelection.generalCategories(after).isEmpty)
        after.standingsState = [CxStandingState(category: "ME", status: "ready", roundIds: [race.id]), CxStandingState(category: "WU", status: "manual", roundIds: [race.id])]
        XCTAssertEqual(CxDetailSelection.generalCategories(after), ["ME", "WU"])
        after.standingsState = [CxStandingState(category: "ME", status: "needs_review", roundIds: [race.id])]
        XCTAssertTrue(CxDetailSelection.generalCategories(after).isEmpty)
        before.standingsState = nil
        XCTAssertEqual(CxDetailSelection.generalCategories(before), ["ME", "WU"])
        after.standingsState = nil
        XCTAssertTrue(CxDetailSelection.generalCategories(after).isEmpty)
        XCTAssertFalse(CxDetailSelection.actualCategories(before).contains("WU"))
    }

    @MainActor
    func testTimeStandingsShowLeaderTotalAndPressGaps() throws {
        let rows = try JSONDecoder().decode([CxStanding].self, from: Data(#"""
        [{"id":"e","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":5,"riderDisplay":"Hours","timeSeconds":8723},
        {"id":"a","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":1,"riderDisplay":"Leader","timeSeconds":5000},
        {"id":"b","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":2,"riderDisplay":"Same","timeSeconds":5000},
        {"id":"c","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":3,"riderDisplay":"Seconds","timeSeconds":5045},
        {"id":"d","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":4,"riderDisplay":"Minutes","timeSeconds":5105},
        {"id":"f","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":6,"riderDisplay":"Missing"}]
        """#.utf8))
        let values = CyclocrossPresentation.standingValues(rows, mode: "time", isEn: false)
        XCTAssertEqual(values.map(\.row.id), ["a", "b", "c", "d", "e", "f"])
        XCTAssertEqual(values.map(\.value.text), ["1:23:20", "m.t.", "+45\"", "+1'45\"", "+1:02:03", "—"])
        XCTAssertEqual(values.map(\.value.kind), [.winnerTime, .sameTime, .gap, .gap, .gap, .gap])
        XCTAssertEqual(CyclocrossPresentation.standingValues(rows, mode: "time", isEn: true)[1].value.text, "s.t.")
        XCTAssertEqual(CyclocrossPresentation.standingMode(scheme: nil, category: "ME", rows: rows), "time")
        XCTAssertNil(CyclocrossPresentation.standingsBreakdown(state: CxStandingState(category: "ME", status: "ready", roundIds: ["r1"],
            breakdown: [CxStandingBreakdownEntry(globalRiderId: "g", eligible: true, rounds: [])]), mode: "time"))
    }

    @MainActor
    func testStandingsBreakdownCellsMarkDroppedAndMissingRounds() throws {
        let state = try JSONDecoder().decode(CxStandingState.self, from: Data(#"""
        {"category":"ME","status":"ready","roundIds":["r1","r2","r3","r4","r5"],"breakdown":[
        {"globalRiderId":"g1","eligible":true,"rounds":[{"raceId":"r1","points":"40","retained":true,"sourceRank":1},
        {"raceId":"r2","points":25,"retained":false},{"raceId":"r3","points":"0","retained":true},
        {"raceId":"r4","points":"30","missing":true}]}]}
        """#.utf8))
        let row = try JSONDecoder().decode(CxStanding.self, from: Data(#"{"id":"s","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":1,"riderDisplay":"Rider","points":65,"globalRiderId":"g1"}"#.utf8))
        let breakdown = try XCTUnwrap(CyclocrossPresentation.standingsBreakdown(state: state, mode: "points"))
        XCTAssertEqual(breakdown.cells(row), [CxRoundCell(text: "40", dropped: false), CxRoundCell(text: "25", dropped: true),
            CxRoundCell(text: "-", dropped: false), CxRoundCell(text: "-", dropped: false), CxRoundCell(text: "-", dropped: false)])
        let headers = CyclocrossPresentation.roundHeaders(breakdown.roundIds, rounds: ["r1": CxRound(n: 3, total: 8)],
            races: [CxRaceRef(id: "r1", name: "Koksijde", nameEn: nil, raceClass: "CDM")])
        XCTAssertEqual(headers.map(\.label), ["#3", "#2", "#3", "#4", "#5"])
        XCTAssertEqual(headers[0].title, "Koksijde")
        XCTAssertTrue(headers[0].linked)
        XCTAssertFalse(headers[1].linked)
        // Una general manual o sin desglose muestra solo el total; un desglose
        // ilegible no invalida el estado.
        XCTAssertNil(CyclocrossPresentation.standingsBreakdown(state: CxStandingState(category: "ME", status: "manual", roundIds: state.roundIds, breakdown: state.breakdown), mode: "points"))
        XCTAssertNil(CyclocrossPresentation.standingsBreakdown(state: CxStandingState(category: "ME", status: "ready", roundIds: state.roundIds, breakdown: []), mode: "points"))
        let malformed = try JSONDecoder().decode(CxStandingState.self, from: Data(#"{"category":"ME","status":"ready","roundIds":["r1"],"breakdown":{"bad":true}}"#.utf8))
        XCTAssertEqual(malformed.roundIds, ["r1"])
        XCTAssertNil(malformed.breakdown)
    }

    @MainActor
    func testTournamentGeneralCategoriesNeedRowsAndUsableState() throws {
        let rows = try JSONDecoder().decode([CxStanding].self, from: Data(#"""
        [{"id":"1","tournamentId":"t","seasonKey":"2026-27","category":"WJ","rank":1,"riderDisplay":"A","points":1},
        {"id":"2","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":1,"riderDisplay":"B","points":1},
        {"id":"3","tournamentId":"t","seasonKey":"2026-27","category":"WE","rank":1,"riderDisplay":"C","points":1},
        {"id":"4","tournamentId":"t","seasonKey":"2026-27","category":"MU","rank":1,"riderDisplay":"D","points":1}]
        """#.utf8))
        let states = [CxStandingState(category: "ME", status: "ready", roundIds: []), CxStandingState(category: "WE", status: "needs_review", roundIds: []),
                      CxStandingState(category: "MU", status: "manual", roundIds: []), CxStandingState(category: "WU", status: "ready", roundIds: ["r1"])]
        XCTAssertEqual(CyclocrossPresentation.tournamentGeneralCategories(standings: rows, states: states), ["ME", "MU", "WJ"])
        XCTAssertTrue(CyclocrossPresentation.tournamentGeneralCategories(standings: [], states: states).isEmpty)
    }

    private func instant(_ value: String) -> Date { CyclocrossLogic.instant(value)! }

    /// Ficha de prueba con categorías, emisiones y resultados en JSON.
    private func mediaDetail(categories: String, broadcasts: String, results: String = "", videos: String = "", raceCancelled: Bool = false) throws -> CxDetail {
        let text = """
        {"race":{"id":"cx-1","name":"Prueba local","slug":"prueba","seasonKey":"2026-27","dateKey":"2027-01-29","endDateKey":"2027-01-31","class":"CM","isCancelled":\(raceCancelled),"cx_race_categories":[\(categories)]},
        "startlist":[],"results":[\(results)],"teams":[],"standings":[],"videos":[\(videos)],"broadcasts":[\(broadcasts)]}
        """
        return try JSONDecoder().decode(CxDetail.self, from: Data(text.utf8))
    }

    private func mediaCategory(_ code: String, date: String, start: String? = nil, status: String = "pending", minutes: Int? = nil, cancelled: Bool = false) -> String {
        let startField = start.map { "\"startTimeUtc\":\"\($0)\"," } ?? ""
        let duration = minutes.map { "\"durationFormat\":\"individual\",\"durationRuleVersion\":\"2026-07-01\",\"durationMinutes\":\($0)," } ?? ""
        return "{\"category\":\"\(code)\",\(startField)\(duration)\"dateKey\":\"\(date)\",\"sortOrder\":0,\"isCancelled\":\(cancelled),\"resultsStatus\":\"\(status)\"}"
    }

    private func mediaRow(_ id: String, category: String? = nil, country: String? = "ES", channel: String? = nil, url: String, order: Int = 0, revive: Bool = false, sporza: Bool = false) -> String {
        let fields = [category.map { "\"category\":\"\($0)\"" }, country.map { "\"country\":\"\($0)\"" }, channel.map { "\"channel\":\"\($0)\"" }].compactMap { $0 }
        return "{\"id\":\"\(id)\",\"raceId\":\"cx-1\",\(fields.map { $0 + "," }.joined())\"url\":\"\(url)\",\"sortOrder\":\(order),\"showInRevive\":\(revive),\"isSporza\":\(sporza)}"
    }

    func testCategoryConclusionUsesVerifiedDurationFallbackAndNextMorning() throws {
        let race = try race()
        let verified = race.categories[0]
        XCTAssertEqual(CyclocrossLogic.concludedAt(race: race, category: verified), instant("2027-01-31T15:30:00Z"))
        let detail = try mediaDetail(categories: [
            mediaCategory("ME", date: "2027-01-31", start: "2027-01-31T14:00:00Z", minutes: 50),
            mediaCategory("MU", date: "2027-01-31", start: "2027-01-31T11:00:00Z"),
            mediaCategory("WE", date: "2027-01-30"),
        ].joined(separator: ","), broadcasts: "")
        let byCode = Dictionary(uniqueKeysWithValues: detail.race.categories.map { ($0.category, $0) })
        XCTAssertEqual(CyclocrossLogic.concludedAt(race: detail.race, category: byCode["ME"]), instant("2027-01-31T15:20:00Z"))
        // Sin duración verificada cuenta 60 min; sin hora, 06:00 UTC del día siguiente.
        XCTAssertEqual(CyclocrossLogic.concludedAt(race: detail.race, category: byCode["MU"]), instant("2027-01-31T12:30:00Z"))
        XCTAssertEqual(CyclocrossLogic.concludedAt(race: detail.race, category: byCode["WE"]), instant("2027-01-31T06:00:00Z"))
        // Carrera sin categorías: último día de la carrera.
        XCTAssertEqual(CyclocrossLogic.concludedAt(race: detail.race, category: nil), instant("2027-02-01T06:00:00Z"))
    }

    @MainActor
    func testLiveTvFollowsProgrammeOrderRegionAndCategoryDeduplication() throws {
        let detail = try mediaDetail(categories: [
            mediaCategory("ME", date: "2027-01-31", start: "2027-01-31T14:00:00Z", minutes: 60),
            mediaCategory("WE", date: "2027-01-30"),
            mediaCategory("MU", date: "2027-01-31", start: "2027-01-31T11:00:00Z"),
        ].joined(separator: ","), broadcasts: [
            mediaRow("me-dup", category: "ME", url: "https://example.org/shared", order: 1),
            mediaRow("me-es", category: "ME", url: "https://example.org/shared"),
            mediaRow("mu-es", category: "MU", url: "https://example.org/shared"),
            mediaRow("we-be", category: "WE", country: "BE", url: "https://example.org/be"),
            mediaRow("common-es", url: "https://example.org/common"),
            mediaRow("invalid", url: "javascript:alert(1)"),
        ].joined(separator: ","))
        let before = instant("2027-01-29T12:00:00Z")
        let all = CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "ES"], showAll: true, at: before)
        XCTAssertEqual(all.tv.map(\.category), [nil, "WE", "MU", "ME"])
        XCTAssertEqual(all.tvRows.map(\.id), ["common-es", "we-be", "mu-es", "me-es"])
        let mine = CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "ES"], at: before)
        XCTAssertEqual(mine.tvRows.map(\.id), ["common-es", "mu-es", "me-es"])
        XCTAssertTrue(mine.hasHiddenTV)
        XCTAssertFalse(mine.showsRegionEmpty)
        let elsewhere = CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "FR"], at: before)
        XCTAssertTrue(elsewhere.showsLiveTV)
        XCTAssertTrue(elsewhere.showsRegionEmpty)
        XCTAssertTrue(elsewhere.hasHiddenTV)
        // «Todas» muestra todas las filas y retira el mensaje, como en carretera.
        let elsewhereAll = CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "FR"], showAll: true, at: before)
        XCTAssertFalse(elsewhereAll.showsRegionEmpty)
        XCTAssertEqual(elsewhereAll.tvRows.map(\.id), all.tvRows.map(\.id))
        // Sin filas de otras regiones no hay conmutador.
        let belgium = CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "ES", "BE"], at: before)
        XCTAssertFalse(belgium.hasHiddenTV)
        XCTAssertEqual(belgium.tvRows.map(\.id), all.tvRows.map(\.id))
        // WE concluye sin resultados: sale de la TV en directo y no pasa a Revive.
        let afterWomen = CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "ES"], showAll: true, at: instant("2027-01-31T07:00:00Z"))
        XCTAssertEqual(afterWomen.tv.map(\.category), [nil, "MU", "ME"])
        XCTAssertFalse(afterWomen.hasHiddenTV)
        XCTAssertTrue(afterWomen.revive.isEmpty)
        let over = CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "ES"], showAll: true, at: instant("2027-01-31T15:30:00Z"))
        XCTAssertFalse(over.showsLiveTV)
        XCTAssertTrue(over.tv.isEmpty)
        XCTAssertTrue(over.revive.isEmpty)
    }

    @MainActor
    func testReviveUsesRoadCriterionAndSkipsRowsStillLive() throws {
        let rows = [
            mediaRow("plain", category: "ME", channel: "Canal ES", url: "https://example.org/plain", order: 3),
            mediaRow("euro", category: "ME", channel: "Eurosport 1", url: "https://example.org/euro", order: 2),
            mediaRow("yt", category: "ME", channel: "Canal", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", order: 1),
            mediaRow("sporza", category: "ME", country: nil, channel: "Sporza", url: "https://example.org/sporza", sporza: true),
            mediaRow("common", url: "https://www.youtube.com/@cx"),
            mediaRow("be", category: "ME", country: "BE", url: "https://example.org/be", revive: true),
            mediaRow("dup", category: "ME", channel: "Otro", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", order: 5, revive: true),
        ].joined(separator: ",")
        let result = "{\"id\":1,\"raceId\":\"cx-1\",\"category\":\"ME\",\"riderDisplay\":\"Corredor local\",\"rank\":1,\"sortOrder\":0}"
        let categories = [
            mediaCategory("ME", date: "2027-01-30", start: "2027-01-30T14:00:00Z", status: "official", minutes: 60),
            mediaCategory("WE", date: "2027-01-31", start: "2027-01-31T12:00:00Z"),
        ].joined(separator: ",")
        let at = instant("2027-01-30T18:00:00Z")
        let detail = try mediaDetail(categories: categories, broadcasts: rows, results: result, videos: [
            "{\"id\":\"clip\",\"raceId\":\"cx-1\",\"title\":\"Vídeo\",\"url\":\"https://www.youtube.com/watch?v=dQw4w9WgXcQ\",\"sortOrder\":0}",
            "{\"id\":\"other\",\"raceId\":\"cx-1\",\"title\":\"Otro\",\"url\":\"https://example.org/replay\",\"sortOrder\":1}",
        ].joined(separator: ","))
        XCTAssertEqual(CyclocrossPresentation.videos(detail).map(\.id), ["clip"])
        let media = CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "ES"], at: at)
        // La fila global sigue en directo por WE: no se repite en Revive.
        XCTAssertEqual(media.tvRows.map(\.id), ["common"])
        XCTAssertEqual(media.revive.map(\.url.absoluteString), ["https://example.org/sporza", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://example.org/euro"])
        XCTAssertEqual(media.revive.map(\.title), ["Sporza", "Canal", "Eurosport 1"])
        // Sin resultados cargados no hay Revive aunque el estado sea oficial.
        let withoutRows = try mediaDetail(categories: categories, broadcasts: rows)
        XCTAssertTrue(CyclocrossPresentation.programmeMedia(withoutRows, allowedGroups: ["ALL", "ES"], at: at).revive.isEmpty)
        // Cancelada: solo cuentan las filas marcadas para Revive.
        let cancelled = try mediaDetail(categories: categories, broadcasts: rows, raceCancelled: true)
        let replay = CyclocrossPresentation.programmeMedia(cancelled, allowedGroups: ["ALL", "ES"], showAll: true, at: at)
        XCTAssertFalse(replay.showsLiveTV)
        XCTAssertEqual(replay.revive.map(\.title), ["Otro"])
    }

    @MainActor
    func testLiveTvShowsProgrammeWithoutScheduleAndKeepsDefaultSection() throws {
        // Temporada lejana: la TV sigue en directo con la hora real de la prueba.
        func detail(broadcasts: String) throws -> CxDetail {
            let text = """
            {"race":{"id":"cx-1","name":"Prueba local","slug":"prueba","seasonKey":"2098-99","dateKey":"2099-01-30","class":"C1","isCancelled":false,"cx_race_categories":[\(mediaCategory("ME", date: "2099-01-30"))]},
            "startlist":[{"id":"r1","raceId":"cx-1","category":"ME","firstName":"Uno","lastName":"Local","sortOrder":0}],
            "results":[],"teams":[],"standings":[],"videos":[],"broadcasts":[\(broadcasts)]}
            """
            return try JSONDecoder().decode(CxDetail.self, from: Data(text.utf8))
        }
        let withTv = try detail(broadcasts: mediaRow("tv", country: "ZZ", url: "https://example.org/tv"))
        XCTAssertTrue(CxDetailSelection.hasMedia(withTv, allowedGroups: ["ALL", "ES"], at: instant("2099-01-30T12:00:00Z")))
        XCTAssertEqual(CxDetailSelection.sections(withTv), [.programme, .startlist])
        XCTAssertTrue(CxDetailSelection.showsSectionSelector(withTv))
        XCTAssertEqual(CxDetailSelection.from(anchor: nil, detail: withTv).normalized(withTv).section, .startlist)
        let withoutTv = try detail(broadcasts: "")
        XCTAssertEqual(CxDetailSelection.sections(withoutTv), [.startlist])
        XCTAssertEqual(CxDetailSelection.from(anchor: nil, detail: withoutTv).normalized(withoutTv).section, .startlist)
    }

    @MainActor
    func testRaceWithoutCategoriesOnlyUsesGlobalRows() throws {
        let rows = [mediaRow("global", url: "https://example.org/global"), mediaRow("me", category: "ME", url: "https://example.org/me")].joined(separator: ",")
        let detail = try mediaDetail(categories: "", broadcasts: rows)
        XCTAssertEqual(CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "ES"], at: instant("2027-01-31T20:00:00Z")).tvRows.map(\.id), ["global"])
        XCTAssertFalse(CyclocrossPresentation.programmeMedia(detail, allowedGroups: ["ALL", "ES"], at: instant("2027-02-01T06:00:00Z")).showsLiveTV)
        let cancelled = try mediaDetail(categories: "", broadcasts: rows.replacingOccurrences(of: "\"showInRevive\":false", with: "\"showInRevive\":true"), raceCancelled: true)
        XCTAssertEqual(CyclocrossPresentation.programmeMedia(cancelled, allowedGroups: ["ALL", "ES"], at: instant("2027-01-29T12:00:00Z")).revive.map(\.url.absoluteString), ["https://example.org/global"])
    }

    @MainActor
    func testV4EncodesNullToPreserveCxAndEmptyArrayToClearIt() throws {
        func payload(_ ids: [String]?) throws -> [String: Any] {
            let params = SupabaseService.SetPushSubscriptionV4Params(p_token: "test-only", p_platform: "ios", p_is_active: false, p_region: "SPAIN", p_country_group: nil, p_language: "es", p_categories: ["general"], p_followed_races: ["road-1"], p_race_filters: [], p_followed_stages: ["stage-1"], p_followed_cx_races: ids)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(params)) as? [String: Any])
        }
        XCTAssertTrue(try payload(nil)["p_followed_cx_races"] is NSNull)
        XCTAssertEqual(try payload([])["p_followed_cx_races"] as? [String], [])
        XCTAssertEqual(try payload(["cx-1"])["p_followed_cx_races"] as? [String], ["cx-1"])
        XCTAssertEqual(try payload(["cx-1"])["p_followed_races"] as? [String], ["road-1"])
    }

    func testTournamentRoundsFollowStandingsContractOrder() {
        func row(_ id: String, _ tournamentId: String? = nil, _ dateKey: String, _ seasonKey: String? = "2026-27", entries: [CxRoundEntry] = []) -> CxRoundRow {
            CxRoundRow(id: id, tournamentId: tournamentId, dateKey: dateKey, seasonKey: seasonKey, cx_race_categories: entries)
        }
        let rows = [
            row("oct-late", "t1", "2026-10-03", entries: [CxRoundEntry(dateKey: "2026-10-04", startTimeUtc: "2026-10-04T15:00:00Z")]),
            row("sin-torneo", nil, "2026-10-03"),
            row("sin-hora", "t1", "2026-10-03", entries: [CxRoundEntry(dateKey: "2026-10-04", startTimeUtc: nil)]),
            row("oct-early", "t1", "2026-10-03", entries: [CxRoundEntry(dateKey: "2026-10-04", startTimeUtc: "2026-10-04T13:00:00Z"), CxRoundEntry(dateKey: "2026-10-04", startTimeUtc: "2026-10-04T11:00:00Z")]),
            row("fuera", "t1", "2027-03-01"),
            row("nov", "t1", "2026-11-01"),
            row("otra-temporada", "t1", "2025-10-01", "2025-26"),
            row("b", "t2", "2026-10-04"),
            row("a", "t2", "2026-10-04"),
            row("solitaria", "t3", "2026-12-05", entries: [CxRoundEntry(dateKey: "2027-03-01", startTimeUtc: "2027-03-01T11:00:00Z")]),
        ]
        let rounds = CyclocrossLogic.tournamentRounds(rows, season: "2026-27")
        XCTAssertEqual(rounds["oct-early"], CxRound(n: 1, total: 4))
        XCTAssertEqual(rounds["oct-late"], CxRound(n: 2, total: 4))
        XCTAssertEqual(rounds["sin-hora"], CxRound(n: 3, total: 4))
        XCTAssertEqual(rounds["nov"], CxRound(n: 4, total: 4))
        XCTAssertNil(rounds["fuera"])
        XCTAssertNil(rounds["sin-torneo"])
        XCTAssertNil(rounds["otra-temporada"])
        XCTAssertEqual(rounds["a"], CxRound(n: 1, total: 2))
        XCTAssertEqual(rounds["b"], CxRound(n: 2, total: 2))
        XCTAssertEqual(rounds["solitaria"], CxRound(n: 1, total: 1))
    }

    @MainActor
    func testSeasonRoundsFailSilentlyAndCachePerSeason() async throws {
        let remote = MemoryRemote(race: try race())
        let repo = CyclocrossRepository(remote: remote, store: MemoryStore())
        remote.roundsFailure = CxRepositoryError.invalidMonth
        let empty = await repo.rounds(season: "2026-27")
        XCTAssertTrue(empty.isEmpty)
        XCTAssertEqual(remote.roundsCalls, 1)
        remote.roundsFailure = nil
        remote.seasonRounds = ["cx-1": CxRound(n: 3, total: 8)]
        let rounds = await repo.rounds(season: "2026-27")
        XCTAssertEqual(rounds["cx-1"], CxRound(n: 3, total: 8))
        XCTAssertEqual(remote.roundsCalls, 2)
        let cached = await repo.rounds(season: "2026-27")
        XCTAssertEqual(cached["cx-1"], CxRound(n: 3, total: 8))
        XCTAssertEqual(remote.roundsCalls, 2)
    }

    @MainActor
    func testCxHighlightUsesOwnTargetAndHidesInactiveOrUnresolvedRaces() throws {
        let race = try race()
        let highlight = try JSONDecoder().decode(TodayHighlight.self, from: Data("{\"id\":\"highlight-1\",\"position\":0,\"targetType\":\"cxRace\",\"cxRaceId\":\"cx-1\"}".utf8))
        let item = try XCTUnwrap(TodayHighlightView.cx(highlight: highlight, race: race))
        if case .cxRace(let id) = item.target { XCTAssertEqual(id, "cx-1") } else { XCTFail("Debe resolver su destino CX") }
        XCTAssertNil(item.race)
        XCTAssertNil(item.raceDay)
        XCTAssertEqual(item.cxRace?.id, race.id)
        XCTAssertEqual(item.title, race.name)
        XCTAssertNil(TodayHighlightView.cx(highlight: highlight, race: nil))
        let inactive = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "2027-01-", with: "2027-03-").utf8))
        XCTAssertNil(TodayHighlightView.cx(highlight: highlight, race: inactive))
        let road = try JSONDecoder().decode(TodayHighlight.self, from: Data("{\"id\":\"highlight-old\",\"position\":0,\"targetType\":\"race\",\"raceId\":\"cx-1\"}".utf8))
        XCTAssertNil(road.cxRaceId)
        XCTAssertNil(TodayHighlightView.cx(highlight: road, race: race))
    }

    @MainActor
    func testCxTournamentHighlightResolvesSeriesTarget() throws {
        let tournament = try JSONDecoder().decode(CxTournament.self, from: Data("{\"id\":\"t1\",\"name\":\"Copa del Mundo\",\"slug\":\"world-cup\",\"seasonKey\":\"2026-27\",\"colorHex\":\"#8b173d\",\"logoUrl\":\"https://example.org/series.png\"}".utf8))
        let highlight = try JSONDecoder().decode(TodayHighlight.self, from: Data("{\"id\":\"highlight-t\",\"position\":0,\"targetType\":\"cxTournament\",\"cxTournamentId\":\"t1\"}".utf8))
        let item = try XCTUnwrap(TodayHighlightView.cxTournament(highlight: highlight, tournament: tournament))
        if case .cxTournament(let id) = item.target { XCTAssertEqual(id, "t1") } else { XCTFail("Debe resolver el torneo CX") }
        XCTAssertEqual(item.cxTournament?.slug, "world-cup")
        XCTAssertEqual(item.title, "Copa del Mundo")
        XCTAssertEqual(item.detail, "2026-27")
        XCTAssertEqual(item.logoUrl, "https://example.org/series.png")
        XCTAssertNil(TodayHighlightView.cxTournament(highlight: highlight, tournament: nil))
        let other = try JSONDecoder().decode(CxTournament.self, from: Data("{\"id\":\"t2\",\"name\":\"Otra\",\"slug\":\"otra\"}".utf8))
        XCTAssertNil(TodayHighlightView.cxTournament(highlight: highlight, tournament: other))
    }

}

@MainActor
private final class MemoryRemote: CxRemote {
    let race: CxRace
    var rows: [CxRace]
    var failure: Error?
    var next: String? = "2027-01-30"
    var nextOverride: ((String) async -> String?)?
    var monthCalls: [CxMonth] = []
    var seasonRounds: [String: CxRound] = [:]
    var roundsFailure: Error?
    var roundsCalls = 0
    var tournament: CxTournament?
    init(race: CxRace) { self.race = race; rows = [race] }
    func cxMonth(season: String, month: CxMonth) async throws -> [CxRace] { monthCalls.append(month); if let failure { throw failure }; return rows }
    func cxNextDate(season: String, date: String) async throws -> String? { if let failure { throw failure }; if let nextOverride { return await nextOverride(season) }; return next }
    func cxDetail(id: String) async throws -> CxDetail? { if let failure { throw failure }; return CxDetail(race: race, startlist: [], results: [], broadcasts: [], videos: [], teams: [], standings: []) }
    func cxRaceForSlug(_ slug: String) async throws -> CxRace? { if let failure { throw failure }; return race }
    func cxTournamentForSlug(_ slug: String) async throws -> CxTournament? { if let failure { throw failure }; return tournament }
    func cxSeasonRounds(season: String) async throws -> [String: CxRound] { roundsCalls += 1; if let roundsFailure { throw roundsFailure }; return seasonRounds }
}

@MainActor
private final class MemoryStore: CxStore {
    var months: [String: [CxRace]] = [:]
    var details: [String: CxDetail] = [:]
    func month(_ key: String) async -> [CxRace]? { months[key] }
    func saveMonth(_ races: [CxRace], key: String) async { months[key] = races }
    func knownMonths() async -> [String] { Array(months.keys) }
    func detail(_ id: String) async -> CxDetail? { details[id] }
    func saveDetail(_ detail: CxDetail) async { details[detail.race.id] = detail }
    func detailId(forSlug slug: String) async -> String? { details.values.first { $0.race.slug == slug || $0.race.slugEn == slug }?.race.id }
    func allDetails() async -> [CxDetail] { Array(details.values) }
}
