import XCTest
@testable import CalendarioCiclismo

final class CyclocrossTests: XCTestCase {
    private let fixture = """
    {"id":"cx-1","name":"Prueba local","slug":"prueba","slugEn":"test","seasonKey":"2026-27","dateKey":"2027-01-29","endDateKey":"2027-01-31","class":"CM","isCancelled":false,"cx_race_categories":[
    {"category":"ME","startTimeUtc":"2027-01-31T14:00:00Z","dateKey":"2027-01-31","sortOrder":0,"isCancelled":false,"resultsStatus":"pending","durationFormat":"individual","durationRuleVersion":"2026-07-01","durationMinutes":60},
    {"category":"WE","dateKey":"2027-01-30","sortOrder":1,"isCancelled":false,"resultsStatus":"pending"}]}
    """

    private func race() throws -> CxRace { try JSONDecoder().decode(CxRace.self, from: Data(fixture.utf8)) }

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

    func testResultsKeepTextBibsBigIntegersUnknownBonusesAndDurationsOver24Hours() throws {
        let text = """
        {"id":9007199254740993,"raceId":"cx-1","category":"ME","bib":"A12","riderDisplay":"Corredor local","sortOrder":0,"timeSeconds":90061,"bonusSeconds":null,"irm":"DF"}
        """
        let row = try JSONDecoder().decode(CxResult.self, from: Data(text.utf8))
        XCTAssertEqual(row.id, 9_007_199_254_740_993)
        XCTAssertEqual(row.bib, "A12")
        XCTAssertNil(row.bonusSeconds)
        XCTAssertEqual(CyclocrossLogic.duration(row.timeSeconds), "25:01:01")
        XCTAssertEqual(CyclocrossLogic.duration(nil), "-")
        let encoded = try JSONEncoder().encode(row)
        XCTAssertNil(try JSONDecoder().decode(CxResult.self, from: encoded).bonusSeconds)
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
        XCTAssertEqual(model.jumpDate, "2027-01-30")
    }

    @MainActor
    func testGeneralRequiresOfficialResultsAndCurrentRound() throws {
        let race = try JSONDecoder().decode(CxRace.self, from: Data(fixture.replacingOccurrences(of: "\"pending\"", with: "\"official\"")
            .replacingOccurrences(of: "\"cx_race_categories\":", with: #""cx_tournaments":{"id":"t","name":"X2O","slug":"x2o","pointsScheme":{"categories":{"ME":{"mode":"time"},"WU":{"mode":"points","extras":{"derived":{"fromCategory":"ME"}}}}}},"cx_race_categories":"#).utf8))
        let result = try JSONDecoder().decode(CxResult.self, from: Data(#"{"id":1,"raceId":"test","category":"ME","riderDisplay":"Rider","rank":1,"sortOrder":0}"#.utf8))
        let rows = try JSONDecoder().decode([CxStanding].self, from: Data(#"[{"id":"s","tournamentId":"t","seasonKey":"2026-27","category":"ME","rank":1,"riderDisplay":"Rider","timeSeconds":90061},{"id":"u","tournamentId":"t","seasonKey":"2026-27","category":"WU","rank":1,"riderDisplay":"Rider","points":50}]"#.utf8))
        let prior = [CxStandingState(category: "ME", status: "ready", roundIds: ["prior"]), CxStandingState(category: "WU", status: "ready", roundIds: ["prior"])]
        var before = CxDetail(race: race, startlist: [], results: [], broadcasts: [], videos: [], teams: [], standings: rows, standingsState: prior)
        XCTAssertTrue(CxDetailSelection.generalCategories(before).isEmpty)
        var after = CxDetail(race: race, startlist: [], results: [result], broadcasts: [], videos: [], teams: [], standings: rows, standingsState: prior)
        XCTAssertTrue(CxDetailSelection.generalCategories(after).isEmpty)
        after.standingsState = [CxStandingState(category: "ME", status: "ready", roundIds: [race.id]), CxStandingState(category: "WU", status: "manual", roundIds: [race.id])]
        XCTAssertEqual(CxDetailSelection.generalCategories(after), ["ME", "WU"])
        after.standingsState = [CxStandingState(category: "ME", status: "needs_review", roundIds: [race.id])]
        XCTAssertTrue(CxDetailSelection.generalCategories(after).isEmpty)
        before.standingsState = nil
        XCTAssertTrue(CxDetailSelection.generalCategories(before).isEmpty)
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
        XCTAssertEqual(values.map(\.value.text), ["1:23:20", "m.t.", "+45\"", "+1'45\"", "+1:02:03", "-"])
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
        func row(_ id: String, _ tournamentId: String? = nil, _ dateKey: String, _ seasonKey: String? = "2026-27", cancelled: Bool = false, entries: [CxRoundEntry] = []) -> CxRoundRow {
            CxRoundRow(id: id, tournamentId: tournamentId, dateKey: dateKey, seasonKey: seasonKey, isCancelled: cancelled, cx_race_categories: entries)
        }
        let rows = [
            row("oct-late", "t1", "2026-10-03", entries: [CxRoundEntry(dateKey: "2026-10-04", startTimeUtc: "2026-10-04T15:00:00Z")]),
            row("sin-torneo", nil, "2026-10-03"),
            row("cancelada", "t1", "2026-10-02", cancelled: true),
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
        XCTAssertNil(rounds["cancelada"])
        XCTAssertNil(rounds["fuera"])
        XCTAssertNil(rounds["sin-torneo"])
        XCTAssertNil(rounds["otra-temporada"])
        XCTAssertEqual(rounds["a"], CxRound(n: 1, total: 2))
        XCTAssertEqual(rounds["b"], CxRound(n: 2, total: 2))
        XCTAssertEqual(rounds["solitaria"], CxRound(n: 1, total: 1))
    }

    func testTournamentRoundsFromCachedRacesCountMonthOverlapOnce() throws {
        func cached(_ id: String) throws -> CxRace {
            let json = fixture.replacingOccurrences(of: "\"id\":\"cx-1\"", with: "\"id\":\"\(id)\",\"tournamentId\":\"t1\"")
            return try JSONDecoder().decode(CxRace.self, from: Data(json.utf8))
        }
        let a = try cached("a"), b = try cached("b")
        // La carrera «a» figura en dos meses de la caché (enero y febrero).
        let rounds = CyclocrossLogic.tournamentRounds(races: [a, b, a], season: "2026-27")
        XCTAssertEqual(rounds.count, 2)
        XCTAssertEqual(rounds["a"], CxRound(n: 1, total: 2))
        XCTAssertEqual(rounds["b"], CxRound(n: 2, total: 2))
    }
}

@MainActor
private final class MemoryRemote: CxRemote {
    let race: CxRace
    var rows: [CxRace]
    var failure: Error?
    /// Retiene la consulta de un mes hasta que la prueba la libere.
    var monthGate: ((String) async -> Void)?
    var monthCalls: [CxMonth] = []
    var indexCalls = 0
    var dayCalls: [String] = []
    /// Retiene la consulta de un día hasta que la prueba la libere.
    var dayGate: ((String) async -> Void)?
    var seasonRounds: [String: CxRound] = [:]
    var roundsFailure: Error?
    var roundsCalls = 0
    var tournament: CxTournament?
    /// Destacadas; nil simula un fallo de lectura.
    var featured: Set<String>?
    init(race: CxRace) { self.race = race; rows = [race] }
    func cxFeaturedRaceIds() async throws -> Set<String> {
        guard let featured else { throw URLError(.badServerResponse) }
        return featured
    }
    func cxMonth(season: String, month: CxMonth) async throws -> [CxRace] {
        monthCalls.append(month)
        let snapshot = rows
        if let monthGate { await monthGate(season) }
        if let failure { throw failure }
        return snapshot
    }
    func cxSeasonIndex(season: String) async throws -> [CxRace] {
        indexCalls += 1
        let snapshot = rows
        if let monthGate { await monthGate(season) }
        if let failure { throw failure }
        return snapshot
    }
    func cxDay(season: String, dateKey: String) async throws -> [CxRace] {
        dayCalls.append(dateKey)
        let snapshot = rows
        if let dayGate { await dayGate(dateKey) }
        if let failure { throw failure }
        return snapshot.filter { CyclocrossLogic.dates($0).contains(dateKey) }
    }
    func cxDetail(id: String) async throws -> CxDetail? { if let failure { throw failure }; return CxDetail(race: race, startlist: [], results: [], broadcasts: [], videos: [], teams: [], standings: []) }
    func cxRaceForSlug(_ slug: String) async throws -> CxRace? { if let failure { throw failure }; return race }
    func cxTournamentForSlug(_ slug: String) async throws -> CxTournament? { if let failure { throw failure }; return tournament }
    func cxSeasonRounds(season: String) async throws -> [String: CxRound] { roundsCalls += 1; if let roundsFailure { throw roundsFailure }; return seasonRounds }
}

@MainActor
private final class MemoryStore: CxStore {
    var months: [String: [CxRace]] = [:]
    var details: [String: CxDetail] = [:]
    var featuredIds: [String]?
    func featured() async -> [String]? { featuredIds }
    func saveFeatured(_ ids: [String]) async { featuredIds = ids }
    func month(_ key: String) async -> [CxRace]? { months[key] }
    func saveMonth(_ races: [CxRace], key: String) async { months[key] = races }
    func knownMonths() async -> [String] { Array(months.keys) }
    func detail(_ id: String) async -> CxDetail? { details[id] }
    func saveDetail(_ detail: CxDetail) async { details[detail.race.id] = detail }
    func detailId(forSlug slug: String) async -> String? { details.values.first { $0.race.slug == slug || $0.race.slugEn == slug }?.race.id }
    func allDetails() async -> [CxDetail] { Array(details.values) }
}
