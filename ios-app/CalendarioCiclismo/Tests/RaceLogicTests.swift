import XCTest
@testable import CalendarioCiclismo

final class RaceLogicTests: XCTestCase {

    @MainActor
    func test_uciCategoryName_expandsAcronymsAndNumericClasses() {
        XCTAssertEqual(RaceLogic.uciCategoryName("CC", english: false), "Campeonato continental")
        XCTAssertEqual(RaceLogic.uciCategoryName("1.UWT", english: false), "UCI WorldTour")
        XCTAssertEqual(RaceLogic.uciCategoryName("2.Pro", english: true), "UCI ProSeries")
        XCTAssertEqual(RaceLogic.uciCategoryName("2.2", english: false), "UCI 2.2")
        XCTAssertEqual(RaceLogic.uciCategoryName("NE", english: false), "NE")
        XCTAssertEqual(RaceLogic.uciCategoryName(nil, english: false), "")
    }


    func test_calendarYear_excludesHistoryAndUnknownYear_usingUTC() {
        let before = ISO8601DateFormatter().date(from: "2026-12-31T23:59:59Z")!
        let after = ISO8601DateFormatter().date(from: "2027-01-01T00:00:00Z")!
        XCTAssertEqual(RaceLogic.calendarYear(now: before), 2026)
        XCTAssertEqual(RaceLogic.calendarYear(now: after), 2027)
        XCTAssertFalse(RaceLogic.hasCalendarForYear(nil, now: before))
        XCTAssertFalse(RaceLogic.hasCalendarForYear(2025, now: before))
        XCTAssertTrue(RaceLogic.hasCalendarForYear(2026, now: before))
        XCTAssertFalse(RaceLogic.hasCalendarForYear(2026, now: after))
        XCTAssertTrue(RaceLogic.hasCalendarForYear(2027, now: after))
    }

    func test_missingRaceIds_returnsOnlyUnresolvedParentsWithoutDuplicates() {
        let loaded = makeRace(id: "tour", name: "Tour de Francia")
        let days = [
            makeRaceDay(id: "d1", raceId: "tour"),
            makeRaceDay(id: "d2", raceId: "renewi"),
            makeRaceDay(id: "d3", raceId: "renewi"),
        ]
        XCTAssertEqual(RaceLogic.missingRaceIds(raceDays: days, races: [loaded]), ["renewi"])
    }

    // MARK: - isRaceConcluded

    // Sin hora de meta cae al fallback de `dateKey` 18:00 UTC (igual que la web):
    // los Campeonatos Nacionales no tienen hora de meta y deben concluir igual.
    func test_isRaceConcluded_withAndWithoutFinishTime() {
        let cases: [(dateKey: String, finish: String?, expected: Bool)] = [
            ("2020-01-01", nil, true),
            ("2090-01-01", nil, false),
            ("2020-01-01", "2020-01-01T15:00:00Z", true),
            ("2090-01-01", "2090-01-01T15:00:00Z", false),
        ]
        for c in cases {
            let rd = makeRaceDay(dateKey: c.dateKey, estimatedFinishTimeUtc: c.finish)
            XCTAssertEqual(RaceLogic.isRaceConcluded(rd: rd), c.expected, "\(c.dateKey) meta=\(c.finish ?? "nil")")
        }
    }

    func test_todayRaceState_prioritizesCancelledRestAndResultsBeforeWaiting() {
        let finished = makeRaceDay(raceStatus: "finished")
        XCTAssertEqual(RaceLogic.todayRaceState(rd: makeRaceDay(isCancelledDay: true, raceStatus: "finished"), hasInhouseResults: true), .cancelled)
        XCTAssertEqual(RaceLogic.todayRaceState(rd: makeRaceDay(isRestDay: true, raceStatus: "finished"), hasInhouseResults: true), .rest)
        XCTAssertEqual(RaceLogic.todayRaceState(rd: finished, hasInhouseResults: true), .results)
    }

    func test_todayRaceState_waitsAfterFinishedStatusOrEstimatedFinish() {
        XCTAssertEqual(RaceLogic.todayRaceState(rd: makeRaceDay(raceStatus: "finished"), hasInhouseResults: false), .waiting)
        let now = ISO8601DateFormatter().date(from: "2026-01-01T15:00:01Z")!
        XCTAssertEqual(
            RaceLogic.todayRaceState(
                rd: makeRaceDay(estimatedFinishTimeUtc: "2026-01-01T15:00:00Z"),
                hasInhouseResults: false,
                now: now
            ),
            .waiting
        )
    }

    // MARK: - needsLiveRefresh (refresco periódico de Hoy)

    func test_needsLiveRefresh_onlyWithRaceRunningSoonOrAwaitingResults() {
        let now = iso("2026-01-01T12:00:00Z")
        func item(_ rd: RaceDay, placeholder: Bool = false) -> EnrichedRaceDay {
            var enriched = EnrichedRaceDay(raceDay: rd, race: nil, broadcasts: [], assets: [])
            enriched.isPlaceholder = placeholder
            return enriched
        }
        let farAway = makeRaceDay(neutralStartTimeUtc: "2026-01-01T16:00:00Z")
        let soon = makeRaceDay(neutralStartTimeUtc: "2026-01-01T12:30:00Z")
        let running = makeRaceDay(raceStatus: "running")
        let awaiting = makeRaceDay(id: "rd-w", estimatedFinishTimeUtc: "2026-01-01T10:00:00Z")
        let stale = makeRaceDay(estimatedFinishTimeUtc: "2026-01-01T05:00:00Z")

        XCTAssertFalse(RaceLogic.needsLiveRefresh([item(farAway)], inhouseDayIds: [], now: now))
        XCTAssertTrue(RaceLogic.needsLiveRefresh([item(soon)], inhouseDayIds: [], now: now))
        XCTAssertTrue(RaceLogic.needsLiveRefresh([item(running)], inhouseDayIds: [], now: now))
        XCTAssertTrue(RaceLogic.needsLiveRefresh([item(awaiting)], inhouseDayIds: [], now: now))
        XCTAssertFalse(RaceLogic.needsLiveRefresh([item(awaiting)], inhouseDayIds: ["rd-w"], now: now))
        XCTAssertFalse(RaceLogic.needsLiveRefresh([item(stale)], inhouseDayIds: [], now: now))
        XCTAssertFalse(RaceLogic.needsLiveRefresh([item(running, placeholder: true)], inhouseDayIds: [], now: now))
        XCTAssertFalse(RaceLogic.needsLiveRefresh([item(makeRaceDay(isCancelledDay: true, raceStatus: "running"))], inhouseDayIds: [], now: now))
    }

    // MARK: - Decodificación ligera de RaceDay

    func test_raceDay_decodesElevationGainAliasAsProfileWithoutPoints() throws {
        let json = #"{"id":"rd","dateKey":"2026-01-01","isRestDay":false,"isCancelledDay":false,"editorialStatus":"published","hasAssets":false,"elevationGain":2480}"#
        let rd = try JSONDecoder().decode(RaceDay.self, from: Data(json.utf8))
        XCTAssertEqual(rd.elevationProfile?.elevationGain, 2480)
        XCTAssertFalse(rd.hasElevationProfile)

        let withoutGain = #"{"id":"rd","dateKey":"2026-01-01","isRestDay":false,"isCancelledDay":false,"editorialStatus":"published","hasAssets":false,"elevationGain":null}"#
        XCTAssertNil(try JSONDecoder().decode(RaceDay.self, from: Data(withoutGain.utf8)).elevationProfile)
    }

    // MARK: - profileProgress (espejo de js/services/race-presentation.js)

    private func iso(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }

    func test_profileProgress_clampsToScheduleAndSuppressesRunningTimeTrial() {
        let start = "2026-09-04T10:00:00Z", finish = "2026-09-04T14:00:00Z"
        let day = makeRaceDay(estimatedFinishTimeUtc: finish, neutralStartTimeUtc: start)
        XCTAssertEqual(RaceLogic.profileProgress(rd: day, hasInhouseResults: false, now: iso("2026-09-04T12:00:00Z")), 0.5)
        XCTAssertEqual(RaceLogic.profileProgress(rd: day, hasInhouseResults: false, now: iso("2026-09-04T09:00:00Z")), 0)
        XCTAssertEqual(RaceLogic.profileProgress(rd: day, hasInhouseResults: false, now: iso("2026-09-04T15:00:00Z")), 1)
        for type in ["itt", "ttt"] {
            let chrono = makeRaceDay(estimatedFinishTimeUtc: finish, primaryType: type, neutralStartTimeUtc: start)
            XCTAssertEqual(RaceLogic.profileProgress(rd: chrono, hasInhouseResults: false, now: iso("2026-09-04T12:00:00Z")), 0)
            XCTAssertEqual(RaceLogic.profileProgress(rd: chrono, hasInhouseResults: true, now: iso("2026-09-04T12:00:00Z")), 1)
            let finished = makeRaceDay(estimatedFinishTimeUtc: finish, raceStatus: "finished", primaryType: type, neutralStartTimeUtc: start)
            XCTAssertEqual(RaceLogic.profileProgress(rd: finished, hasInhouseResults: false, now: iso("2026-09-04T12:00:00Z")), 1)
        }
    }

    func test_profileProgress_prefersRealStartAndIgnoresCancelledOrRestDays() {
        let start = "2026-09-04T10:00:00Z", finish = "2026-09-04T14:00:00Z"
        let real = makeRaceDay(estimatedFinishTimeUtc: finish, neutralStartTimeUtc: start, realStartTimeUtc: "2026-09-04T11:00:00Z")
        XCTAssertEqual(RaceLogic.profileProgress(rd: real, hasInhouseResults: false, now: iso("2026-09-04T10:30:00Z")), 0)
        XCTAssertEqual(RaceLogic.profileProgress(rd: real, hasInhouseResults: false, now: iso("2026-09-04T12:30:00Z")), 0.5)
        XCTAssertEqual(RaceLogic.profileProgress(rd: makeRaceDay(isCancelledDay: true, raceStatus: "finished"), hasInhouseResults: true), 0)
        XCTAssertEqual(RaceLogic.profileProgress(rd: makeRaceDay(isRestDay: true, raceStatus: "finished"), hasInhouseResults: true), 0)
        XCTAssertEqual(RaceLogic.profileProgress(rd: makeRaceDay(), hasInhouseResults: false), 0)
    }

    // MARK: - broadcastLinkPriority

    func test_broadcastLinkPriority_tiers() {
        let cases: [(url: String?, tier: Int)] = [
            ("https://www.youtube.com/watch?v=abc", 0),
            ("https://youtu.be/abc", 0),
            ("https://www.facebook.com/uci/videos/123", 1),
            ("https://www.instagram.com/p/abc", 1),
            ("https://twitter.com/uci", 1),
            ("https://x.com/uci", 1),
            ("https://www.twitch.tv/uci", 1),
            ("https://www.rtve.es/play/videos/directo/teledeporte/", 2),
            ("https://www.rtp.pt/play/direto/rtp1", 3),
            ("https://www.ccma.cat/3cat/directes/esport3/", 3),
            ("https://www.3cat.cat/3cat/directes/esport3/", 3),
            ("https://www.eitb.eus/es/directo/etb-1/", 3),
            ("https://www.eitb.tv/es/directo/", 3),
            ("https://www.eurosport.es/ciclismo/", 4),
            ("https://www.hbomax.com/es/es", 4),
            ("https://play.hbomax.com/sport/abc", 4),
            // play.max.com NO debe confundirse con x.com.
            ("https://play.max.com/show/abc", 4),
            ("https://www.france.tv/sport/cyclisme/", 4),
            (nil, 4),
            ("", 4),
        ]
        for c in cases {
            XCTAssertEqual(RaceLogic.broadcastLinkPriority(c.url), c.tier, c.url ?? "nil")
        }
    }

    func test_prefersNativeApp_matchesSupportedHostsAndSubdomains() {
        XCTAssertTrue(RaceLogic.prefersNativeApp(URL(string: "https://www.youtube.com/watch?v=abc")!))
        XCTAssertTrue(RaceLogic.prefersNativeApp(URL(string: "https://play.hbomax.com/sport/abc")!))
        XCTAssertTrue(RaceLogic.prefersNativeApp(URL(string: "https://x.com/uci")!))
    }

    func test_prefersNativeApp_rejectsBrowserOnlyAndLookalikeHosts() {
        XCTAssertFalse(RaceLogic.prefersNativeApp(URL(string: "https://www.rtve.es/play/")!))
        XCTAssertFalse(RaceLogic.prefersNativeApp(URL(string: "https://notyoutube.com/watch")!))
    }

    // MARK: - typeLabel

    func test_typeLabel_passthroughForUnknown() {
        XCTAssertEqual("unknown_type", RaceLogic.typeLabel("unknown_type"))
    }

    func test_typeLabel_emptyForNil() {
        XCTAssertEqual("", RaceLogic.typeLabel(nil))
    }

    // MARK: - resolveTypeLabel

    func test_resolveTypeLabel_monopuertoForFlatSummitFinish() {
        XCTAssertEqual("Monopuerto",
            RaceLogic.resolveTypeLabel(primary: "flat", secondary: "summit_finish"))
    }

    func test_resolveTypeLabel_ribinouForSterratoInFrance() {
        XCTAssertEqual("Ribinou",
            RaceLogic.resolveTypeLabel(primary: "sterrato", secondary: nil, countryCode: "FR"))
    }

    func test_resolveTypeLabel_sterratoOutsideFranceNotRibinou() {
        XCTAssertNotEqual("Ribinou",
            RaceLogic.resolveTypeLabel(primary: "sterrato", secondary: nil, countryCode: "IT"))
    }

    func test_resolveTypeLabel_ittWithChronoClimb() {
        let label = RaceLogic.resolveTypeLabel(primary: "itt", secondary: "chrono_climb")
        XCTAssertFalse(label.isEmpty)
        XCTAssertFalse(label.contains("·"), "ITT + chrono_climb debería devolver solo el label de chrono_climb")
    }

    func test_resolveTypeLabel_ittWithSummitFinishIsChronoClimb() {
        XCTAssertEqual(
            RaceLogic.typeLabel("chrono_climb"),
            RaceLogic.resolveTypeLabel(primary: "itt", secondary: "summit_finish")
        )
    }

    // MARK: - categoryTier

    func test_categoryTier() {
        let cases: [(category: String?, tier: String?)] = [
            ("1.UWT", "wt"),
            ("2.UWT", "wt"),
            ("WC", "wc"),
            (nil, nil),
        ]
        for c in cases {
            XCTAssertEqual(RaceLogic.categoryTier(c.category), c.tier, c.category ?? "nil")
        }
    }

    // MARK: - nameImpliesFemale

    func test_nameImpliesFemale() {
        // "Feminina"/"Feminino" (portugués/italiano, sin acento, vocal i) cuentan
        // como femenino igual que la web (patrón f[eé]minin[e]?).
        let cases: [(name: String?, expected: Bool)] = [
            ("Tour de Flandes Women", true),
            ("Vuelta a Burgos Femenino", true),
            ("Volta a Portugal Feminina", true),
            ("Giro Feminino", true),
            ("Tour de Francia", false),
            (nil, false),
        ]
        for c in cases {
            XCTAssertEqual(RaceLogic.nameImpliesFemale(c.name), c.expected, c.name ?? "nil")
        }
    }

    // MARK: - cleanFeminineDisplayName

    func test_cleanFeminineDisplayName() {
        let removed: [(name: String, marker: String)] = [
            ("Tour de Flandes Women", "women"),
            ("Vuelta a Burgos Femenino", "femenino"),
        ]
        for c in removed {
            XCTAssertFalse(RaceLogic.cleanFeminineDisplayName(c.name).lowercased().contains(c.marker), c.name)
        }
        // Nombre neutro y excepción conocida se conservan.
        for name in ["Tour de Francia", "Women Cycling Pro"] {
            XCTAssertEqual(RaceLogic.cleanFeminineDisplayName(name), name)
        }
    }

    // MARK: - raceTimeCheck dateKey guard

    func test_raceTimeCheck_ignoresFinishDateBeforeDateKey() {
        // estimatedFinishTimeUtc anterior al dateKey → guarda descarta y usa fallback
        // dateKey lejano en el futuro → fallback también devuelve false
        let rd = makeRaceDay(dateKey: "2099-12-31", estimatedFinishTimeUtc: "2026-05-01T22:49:00Z")
        XCTAssertFalse(RaceLogic.raceTimeCheck(rd: rd, offsetMinutes: 0))
    }

    func test_raceTimeCheck_usesFinishDateOnSameDayAsDateKey() {
        // estimatedFinishTimeUtc en el mismo día UTC que dateKey → válido, ya es pasado → true
        let rd = makeRaceDay(dateKey: "2026-01-01", estimatedFinishTimeUtc: "2026-01-01T18:00:00Z")
        XCTAssertTrue(RaceLogic.raceTimeCheck(rd: rd, offsetMinutes: 0))
    }

    // MARK: - reviveUrl

    func test_reviveUrl() {
        let cases: [(label: String, broadcasts: [Broadcast], found: Bool)] = [
            ("vacío", [], false),
            ("Eurosport", [makeBroadcast(channel: "Eurosport 1", url: "https://eurosport.com/live")], true),
            ("YouTube", [makeBroadcast(channel: "Canal", url: "https://youtube.com/watch?v=abc")], true),
            ("red social", [makeBroadcast(channel: "Social", url: "https://www.instagram.com/reel/abc")], true),
            ("showInRevive en fuente desconocida",
             [makeBroadcast(channel: "Pidcock Racing", url: "https://video.example/race", showInRevive: true)], true),
            ("ETB a la carta sin marca",
             [makeBroadcast(channel: "ETB1", url: "https://etbon.eus/m/txirrindularitza-itzulia-5-12345")], true),
            ("ETB lineal sin marca", [makeBroadcast(channel: "ETB1", url: "https://etbon.eus/ch/etb-1")], false),
            ("canal sin revive", [makeBroadcast(channel: "Canal local", url: "https://example.com")], false),
        ]
        for c in cases {
            XCTAssertEqual(RaceLogic.reviveUrl(from: c.broadcasts) != nil, c.found, c.label)
        }
    }

    func test_hasReviveBroadcasts_requiresCurrentDayResults() {
        let broadcasts = [makeBroadcast(channel: "Pidcock Racing", url: "https://video.example/race", showInRevive: true)]
        XCTAssertTrue(RaceLogic.hasReviveBroadcasts(broadcasts, hasCurrentResults: true))
        XCTAssertFalse(RaceLogic.hasReviveBroadcasts(broadcasts, hasCurrentResults: false))
        XCTAssertTrue(RaceLogic.hasReviveBroadcasts(broadcasts, hasCurrentResults: true, isCancelled: true))
        XCTAssertFalse(RaceLogic.hasReviveBroadcasts(broadcasts, hasCurrentResults: false, isCancelled: true))
        XCTAssertFalse(RaceLogic.hasReviveBroadcasts([], hasCurrentResults: true))
    }

    func test_shouldShowBroadcastNote_hidesEveryNoteOnceResultsExist() {
        XCTAssertFalse(RaceLogic.shouldShowBroadcastNote(hasResults: true, isRevive: false, showInRevive: false))
        XCTAssertFalse(RaceLogic.shouldShowBroadcastNote(hasResults: true, isRevive: true, showInRevive: true))
    }

    func test_shouldShowBroadcastNote_preservesReviveRuleBeforeResults() {
        XCTAssertTrue(RaceLogic.shouldShowBroadcastNote(hasResults: false, isRevive: false, showInRevive: false))
        XCTAssertFalse(RaceLogic.shouldShowBroadcastNote(hasResults: false, isRevive: true, showInRevive: false))
        XCTAssertTrue(RaceLogic.shouldShowBroadcastNote(hasResults: false, isRevive: true, showInRevive: true))
    }

    func test_reviveBroadcasts_cancelledDayKeepsOnlyExplicitSelection() {
        let automatic = makeBroadcast(channel: "Eurosport 1", url: "https://eurosport.example/live")
        let selected = makeBroadcast(channel: "Canal", url: "https://video.example/selected", showInRevive: true)
        XCTAssertEqual(
            RaceLogic.reviveBroadcasts(from: [automatic, selected], isCancelled: true).map(\.id),
            [selected.id]
        )
    }

    // MARK: - reviveBroadcasts

    func test_reviveBroadcasts_requiresUrl() {
        XCTAssertTrue(RaceLogic.reviveBroadcasts(from: [makeBroadcast(channel: "Canal", url: nil, showInRevive: true)]).isEmpty)
        XCTAssertTrue(RaceLogic.reviveBroadcasts(from: [makeBroadcast(channel: "Eurosport 1", url: nil)]).isEmpty)
        XCTAssertEqual(
            RaceLogic.reviveBroadcasts(from: [makeBroadcast(channel: "Canal", url: "https://example.com", showInRevive: true)]).count, 1
        )
    }

    // MARK: - Orden de la agenda de Hoy (espejo de today-agenda-order.test.js)

    /// Domingo 11-10-2026: la París-Tours no debe quedar detrás de una 2.1 por
    /// tener esta miniperfil.
    private func parisToursAgenda() -> [EnrichedRaceDay] {
        [
            agendaItem("Tour de Kyushu", "2.1", country: "JP", start: "2026-10-11T01:00:00Z", withProfile: true),
            agendaItem("Tour de la Isla de Chongming", "2.WWT", gender: "female", country: "CN"),
            agendaItem("París-Tours", "1.Pro"),
            agendaItem("Hong Kong Cyclothon", "1.1", country: "HK", start: "2026-10-11T01:45:00Z"),
            agendaItem("Vuelta a Venezuela", "2.2", country: "VE"),
            agendaItem("París-Tours sub23", "1.2U"),
            agendaItem("Campeonato del Caribe", "1.2", country: nil, placeholder: true),
        ]
    }

    func test_sortTodayAgenda_categoryIgnoresMiniProfile() {
        let sorted = RaceLogic.sortTodayAgenda(parisToursAgenda(), sortMode: .category, featuredRaceIds: [])
        XCTAssertEqual(sorted.map { $0.race?.name }, [
            "Tour de la Isla de Chongming", "París-Tours", "Tour de Kyushu", "Hong Kong Cyclothon",
            "Vuelta a Venezuela", "París-Tours sub23", "Campeonato del Caribe",
        ])
    }

    func test_sortTodayAgenda_featuredFirstOnlyInCategoryMode() {
        let items = parisToursAgenda()
        let featured: Set<String> = ["París-Tours"]
        XCTAssertEqual(RaceLogic.sortTodayAgenda(items, sortMode: .category, featuredRaceIds: featured).first?.race?.name, "París-Tours")
        XCTAssertEqual(RaceLogic.sortTodayAgenda(items, sortMode: .finishTime, featuredRaceIds: featured).first?.race?.name, "Tour de la Isla de Chongming")
    }

    func test_sortTodayAgenda_featuredCancelledStaysLast() {
        let items = [agendaItem("Cancelada", "1.UWT", cancelled: true), agendaItem("Normal", "1.2")]
        let sorted = RaceLogic.sortTodayAgenda(items, sortMode: .category, featuredRaceIds: ["Cancelada"])
        XCTAssertEqual(sorted.map { $0.race?.name }, ["Normal", "Cancelada"])
    }

    func test_sortTodayAgenda_tvTimeBreaksTiesByCategory() {
        let items = [
            agendaItem("Sin TV", "1.UWT"),
            agendaItem("TV tarde", "1.2", broadcasts: [makeBroadcast(startTimeUtc: "2026-10-11T14:00:00Z")]),
            agendaItem("TV pronto", "1.1", broadcasts: [makeBroadcast(startTimeUtc: "2026-10-11T12:00:00Z")]),
        ]
        let sorted = RaceLogic.sortTodayAgenda(items, sortMode: .tvTime, featuredRaceIds: [])
        XCTAssertEqual(sorted.map { $0.race?.name }, ["TV pronto", "TV tarde", "Sin TV"])
    }

    func test_categoryRank_appliesSingleTableExceptions() {
        XCTAssertEqual(RaceLogic.categoryRank(category: "2.UWT", name: "Tour de Francia", country: nil), 0.2)
        XCTAssertEqual(RaceLogic.categoryRank(category: "2.2U", name: "Tour del Porvenir", country: nil), 8.5)
        XCTAssertEqual(RaceLogic.categoryRank(category: "2.1", name: "Tour of Azerbaijan", country: "AZ"), 10.5)
        XCTAssertEqual(RaceLogic.categoryRank(category: "1.1", name: "Japan Cup", country: "JP"), 9)
        XCTAssertEqual(RaceLogic.categoryRank(category: "CC", name: "Campeonato Panamericano", country: nil), 14.5)
        XCTAssertEqual(RaceLogic.categoryRank(category: "CC", name: "Campeonato de Europa", country: nil), 2)
    }

    // MARK: - Indicador femenino

    func test_shouldShowFemaleIndicator_hiddenForWWTCategory() {
        XCTAssertFalse(RaceLogic.shouldShowFemaleIndicator(makeRace(name: "Tour de la Isla de Chongming", uciCategory: "2.WWT", gender: "female")))
        XCTAssertFalse(RaceLogic.shouldShowFemaleIndicator(makeRace(name: "Strade Bianche", uciCategory: "1.WWT", gender: "female")))
        XCTAssertTrue(RaceLogic.shouldShowFemaleIndicator(makeRace(name: "Vuelta a Burgos", uciCategory: "2.Pro", gender: "female")))
        XCTAssertFalse(RaceLogic.shouldShowFemaleIndicator(makeRace(name: "Vuelta a Burgos Féminas", uciCategory: "2.Pro", gender: "female")))
    }

    // MARK: - Helpers

    private func makeRace(
        id: String = UUID().uuidString,
        name: String = "Test Race",
        year: Int? = 2026,
        uciCategory: String? = "1.UWT",
        countryCode: String? = nil,
        gender: String? = nil,
        isGrandTour: Bool = false,
        isCancelled: Bool = false
    ) -> Race {
        Race(
            id: id,
            name: name,
            nameEn: nil,
            uciCategory: uciCategory,
            gender: gender,
            raceFormat: nil,
            countryCode: countryCode,
            colorHex: nil,
            logoUrl: nil,
            websiteUrl: nil,
            hideFlag: false,
            isGrandTour: isGrandTour,
            isCancelled: isCancelled,
            startDate: nil,
            endDate: nil,
            year: year,
            slug: nil,
            originalName: nil,
            startlistImportedAt: nil,
            startlistProvisional: nil
        )
    }

    private func makeRaceDay(
        id: String = UUID().uuidString,
        raceId: String? = nil,
        dateKey: String = "2026-01-01",
        isRestDay: Bool = false,
        isCancelledDay: Bool = false,
        estimatedFinishTimeUtc: String? = nil,
        stageNumber: Int? = 1,
        raceStatus: String? = nil,
        primaryType: String? = nil,
        neutralStartTimeUtc: String? = nil,
        realStartTimeUtc: String? = nil
    ) -> RaceDay {
        RaceDay(
            id: id,
            raceId: raceId,
            dateKey: dateKey,
            slug: nil,
            isRestDay: isRestDay,
            isCancelledDay: isCancelledDay,
            stageNumber: stageNumber,
            startLocation: nil,
            finishLocation: nil,
            distanceKm: nil,
            primaryType: primaryType,
            secondaryType: nil,
            neutralStartTimeUtc: neutralStartTimeUtc,
            realStartTimeUtc: realStartTimeUtc,
            estimatedFinishTimeUtc: estimatedFinishTimeUtc,
            tvStatus: nil,
            description: nil,
            bonuses: nil,
            notes: nil,
            editorialStatus: "published",
            hasAssets: false,
            updatedAt: nil,
            countryCode: nil,
            raceStatus: raceStatus
        )
    }

    /// Jornada de la agenda de Hoy para los tests de orden. El id de la carrera
    /// es su nombre, para poder marcarla como destacada.
    private func agendaItem(
        _ name: String,
        _ uciCategory: String,
        gender: String = "male",
        country: String? = "FR",
        start: String? = nil,
        withProfile: Bool = false,
        placeholder: Bool = false,
        cancelled: Bool = false,
        broadcasts: [Broadcast] = []
    ) -> EnrichedRaceDay {
        let race = makeRace(id: name, name: name, uciCategory: uciCategory, countryCode: country,
                            gender: gender, isCancelled: cancelled)
        let profile = withProfile
            ? ElevationProfile(
                distance: 100, elevationGain: 500, elevationLoss: 0,
                minElevation: 0, maxElevation: 500,
                points: [ElevationPoint(km: 0, alt: 0), ElevationPoint(km: 100, alt: 500)])
            : nil
        let rd = RaceDay(
            id: UUID().uuidString, raceId: name, dateKey: "2026-10-11", slug: nil,
            isRestDay: false, isCancelledDay: false, stageNumber: 1,
            startLocation: nil, finishLocation: nil,
            distanceKm: nil, primaryType: nil, secondaryType: nil,
            neutralStartTimeUtc: start, estimatedFinishTimeUtc: nil,
            tvStatus: nil, description: nil, bonuses: nil, notes: nil,
            editorialStatus: placeholder ? "placeholder" : "published", hasAssets: false,
            updatedAt: nil, countryCode: nil,
            elevationProfile: profile)
        return EnrichedRaceDay(raceDay: rd, race: race, broadcasts: broadcasts, assets: [], isPlaceholder: placeholder)
    }

    private func makeBroadcast(
        channel: String? = nil,
        url: String? = nil,
        showInRevive: Bool? = false,
        sortOrder: Int? = 0,
        startTimeUtc: String? = nil
    ) -> Broadcast {
        Broadcast(
            id: UUID().uuidString,
            raceDayId: "rd1",
            channel: channel,
            startTimeUtc: startTimeUtc,
            url: url,
            note: nil,
            sortOrder: sortOrder,
            showInRevive: showInRevive,
            country: nil
        )
    }

    // MARK: - championshipTvState

    func test_championshipTvState_labelWhenNoStartTimes() {
        let bcs = [makeBroadcast(channel: "Canal", url: "https://x.com")]
        XCTAssertEqual(RaceLogic.championshipTvState(broadcasts: bcs), .label)
    }

    func test_championshipTvState_labelWhenEmpty() {
        XCTAssertEqual(RaceLogic.championshipTvState(broadcasts: []), .label)
    }

    func test_championshipTvState_liveWhenEarliestStartInPast() {
        let bcs = [
            makeBroadcast(channel: "A", startTimeUtc: "2090-01-01T15:00:00Z"),
            makeBroadcast(channel: "B", startTimeUtc: "2020-01-01T15:00:00Z"),
        ]
        XCTAssertEqual(RaceLogic.championshipTvState(broadcasts: bcs), .live)
    }

    func test_championshipTvState_timeWhenStartInFuture() {
        let bcs = [makeBroadcast(channel: "A", startTimeUtc: "2090-01-01T15:00:00Z")]
        if case .time(let t) = RaceLogic.championshipTvState(broadcasts: bcs) {
            XCTAssertFalse(t.isEmpty)
        } else {
            XCTFail("Esperado .time para una hora de TV futura")
        }
    }

    func test_matchesCategory_worldAndContinentalRespectGender() {
        let worldMen = makeRace(name: "Campeonato del Mundo CRI masculino", uciCategory: "WC", gender: "male")
        let worldWomen = makeRace(name: "Campeonato del Mundo CRI femenino", uciCategory: "WC", gender: "female")
        let europeMen = makeRace(name: "Campeonato de Europa línea masculino", uciCategory: "CC", gender: "male")
        let europeWomen = makeRace(name: "Campeonato de Europa línea femenino", uciCategory: "CC", gender: "female")
        let mixedRelay = makeRace(name: "Campeonato del Mundo CRE relevo mixto", uciCategory: "WC", gender: nil)

        XCTAssertTrue(RaceLogic.matchesCategory(worldMen, filter: .male))
        XCTAssertFalse(RaceLogic.matchesCategory(worldMen, filter: .female))
        XCTAssertTrue(RaceLogic.matchesCategory(worldWomen, filter: .female))
        XCTAssertFalse(RaceLogic.matchesCategory(worldWomen, filter: .male))
        XCTAssertTrue(RaceLogic.matchesCategory(europeMen, filter: .male))
        XCTAssertFalse(RaceLogic.matchesCategory(europeMen, filter: .female))
        XCTAssertTrue(RaceLogic.matchesCategory(europeWomen, filter: .female))
        XCTAssertFalse(RaceLogic.matchesCategory(europeWomen, filter: .male))
        XCTAssertTrue(RaceLogic.matchesCategory(mixedRelay, filter: .male))
        XCTAssertTrue(RaceLogic.matchesCategory(mixedRelay, filter: .female))
        XCTAssertTrue(RaceLogic.matchesCategory(mixedRelay, filter: .pro))
    }

    // MARK: - matchesCategory con Campeonatos Nacionales (CN)
    // CN élite (masc/fem) cuentan como Pro; las sub23 quedan fuera de
    // Pro/Masc/Fem. Masc/Fem respetan el género de la prueba.

    private func cn(_ name: String, gender: String? = nil) -> Race {
        makeRace(name: name, uciCategory: "CN", countryCode: "ES", gender: gender)
    }

    func test_matchesCategory_cn() {
        let eliteM = cn("Campeonato de España Línea Élite Masculino", gender: "male")
        let eliteF = cn("Campeonato de España Línea Élite Femenino", gender: "female")
        let u23M = cn("Campeonato de España Línea sub-23 Masculino", gender: "male")
        let u23F = cn("Campeonato de España CRI sub-23 Femenino", gender: "female")
        let cases: [(race: Race, filter: Constants.CategoryFilter, expected: Bool)] = [
            (eliteM, .pro, true),
            (eliteF, .pro, true),
            (u23M, .pro, false),
            (u23F, .pro, false),
            (eliteM, .male, true),
            (eliteF, .male, false),
            (u23M, .male, false),
            (eliteF, .female, true),
            (eliteM, .female, false),
            (u23F, .female, false),
            (eliteM, .uwt, false),
            (eliteF, .wwt, false),
        ]
        for c in cases {
            XCTAssertEqual(RaceLogic.matchesCategory(c.race, filter: c.filter), c.expected, "\(c.race.name) / \(c.filter)")
        }
    }
}
