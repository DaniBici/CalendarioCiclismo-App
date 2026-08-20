import XCTest
@testable import CalendarioCiclismo

final class RaceLogicTests: XCTestCase {

    // MARK: - buildFcUrl

    func test_buildFcUrl_nilIfNoFcId() {
        let race = makeRace(fcId: nil, year: 2026)
        XCTAssertNil(RaceLogic.buildFcUrl(race: race, stageNumber: nil))
    }

    func test_buildFcUrl_baseUrlForOneDay() {
        let race = makeRace(fcId: 17, year: 2026)
        let url = RaceLogic.buildFcUrl(race: race, stageNumber: nil)
        XCTAssertEqual(url?.absoluteString, "https://firstcycling.com/race.php?r=17&y=2026")
    }

    func test_buildFcUrl_paddedStageNumber() {
        let race = makeRace(fcId: 17, year: 2026)
        let url = RaceLogic.buildFcUrl(race: race, stageNumber: 3)
        XCTAssertTrue(url?.absoluteString.hasSuffix("&e=03") == true)
    }

    func test_buildFcUrl_twoDigitStageNumber() {
        let race = makeRace(fcId: 17, year: 2026)
        let url = RaceLogic.buildFcUrl(race: race, stageNumber: 14)
        XCTAssertTrue(url?.absoluteString.hasSuffix("&e=14") == true)
    }

    // MARK: - buildPcsUrl

    func test_buildPcsUrl_nilIfNoPcsSlug() {
        let race = makeRace(pcsSlug: nil, year: 2026)
        XCTAssertNil(RaceLogic.buildPcsUrl(race: race, stageNumber: nil))
    }

    func test_buildPcsUrl_resultForOneDay() {
        let race = makeRace(pcsSlug: "tour-de-france", year: 2026)
        let url = RaceLogic.buildPcsUrl(race: race, stageNumber: nil)
        XCTAssertEqual(url?.absoluteString,
            "https://www.procyclingstats.com/race/tour-de-france/2026/result")
    }

    func test_buildPcsUrl_prologueForStageZero() {
        let race = makeRace(pcsSlug: "tour-de-france", year: 2026)
        let url = RaceLogic.buildPcsUrl(race: race, stageNumber: 0)
        XCTAssertEqual(url?.absoluteString,
            "https://www.procyclingstats.com/race/tour-de-france/2026/prologue/result")
    }

    func test_buildPcsUrl_stageUrlWithoutPadding() {
        let race = makeRace(pcsSlug: "giro-d-italia", year: 2026)
        let url = RaceLogic.buildPcsUrl(race: race, stageNumber: 5)
        XCTAssertEqual(url?.absoluteString,
            "https://www.procyclingstats.com/race/giro-d-italia/2026/stage-5/result")
    }

    // MARK: - isRaceConcluded

    // Sin hora de meta cae al fallback de `dateKey` 18:00 UTC (igual que la web):
    // los Campeonatos Nacionales no tienen hora de meta y deben concluir igual.
    func test_isRaceConcluded_pastDateNoFinishTime_true() {
        let rd = makeRaceDay(dateKey: "2020-01-01", estimatedFinishTimeUtc: nil)
        XCTAssertTrue(RaceLogic.isRaceConcluded(rd: rd))
    }

    func test_isRaceConcluded_futureDateNoFinishTime_false() {
        let rd = makeRaceDay(dateKey: "2090-01-01", estimatedFinishTimeUtc: nil)
        XCTAssertFalse(RaceLogic.isRaceConcluded(rd: rd))
    }

    func test_isRaceConcluded_trueWellInThePast() {
        let rd = makeRaceDay(dateKey: "2020-01-01", estimatedFinishTimeUtc: "2020-01-01T15:00:00Z")
        XCTAssertTrue(RaceLogic.isRaceConcluded(rd: rd))
    }

    func test_isRaceConcluded_falseFarInTheFuture() {
        let rd = makeRaceDay(dateKey: "2090-01-01", estimatedFinishTimeUtc: "2090-01-01T15:00:00Z")
        XCTAssertFalse(RaceLogic.isRaceConcluded(rd: rd))
    }

    // MARK: - broadcastLinkPriority

    func test_broadcastLinkPriority_youtubeIsTier0() {
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.youtube.com/watch?v=abc"), 0)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://youtu.be/abc"), 0)
    }

    func test_broadcastLinkPriority_otherSocialIsTier1() {
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.facebook.com/uci/videos/123"), 1)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.instagram.com/p/abc"), 1)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://twitter.com/uci"), 1)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://x.com/uci"), 1)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.twitch.tv/uci"), 1)
    }

    func test_broadcastLinkPriority_rtveIsTier2() {
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.rtve.es/play/videos/directo/teledeporte/"), 2)
    }

    func test_broadcastLinkPriority_otherPublicTvIsTier3() {
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.rtp.pt/play/direto/rtp1"), 3)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.ccma.cat/3cat/directes/esport3/"), 3)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.3cat.cat/3cat/directes/esport3/"), 3)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.eitb.eus/es/directo/etb-1/"), 3)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.eitb.tv/es/directo/"), 3)
    }

    func test_broadcastLinkPriority_rtveBeatsCcmaAndEitb() {
        let rtve = RaceLogic.broadcastLinkPriority("https://www.rtve.es/play/videos/directo/teledeporte/")
        XCTAssertLessThan(rtve, RaceLogic.broadcastLinkPriority("https://www.eitb.eus/es/directo/etb-1/"))
        XCTAssertLessThan(rtve, RaceLogic.broadcastLinkPriority("https://www.ccma.cat/3cat/directes/esport3/"))
    }

    func test_broadcastLinkPriority_rtp1BeatsWbdForVoltaPortugal() {
        let rtp1 = RaceLogic.broadcastLinkPriority("https://www.rtp.pt/play/direto/rtp1")
        XCTAssertLessThan(rtp1, RaceLogic.broadcastLinkPriority("https://play.hbomax.com/sport/abc"))
        XCTAssertLessThan(rtp1, RaceLogic.broadcastLinkPriority("https://www.hbomax.com/gb/en/sports/cycling"))
    }

    func test_broadcastLinkPriority_eurosportAndHboAreJustAnotherChannel() {
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.eurosport.es/ciclismo/"), 4)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.hbomax.com/es/es"), 4)
        // play.max.com NO debe confundirse con x.com.
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://play.max.com/show/abc"), 4)
    }

    func test_broadcastLinkPriority_genericOrEmptyIsTier4() {
        XCTAssertEqual(RaceLogic.broadcastLinkPriority("https://www.france.tv/sport/cyclisme/"), 4)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority(nil), 4)
        XCTAssertEqual(RaceLogic.broadcastLinkPriority(""), 4)
    }

    // MARK: - typeLabel

    func test_typeLabel_nonEmptyForKnownType() {
        XCTAssertFalse(RaceLogic.typeLabel("flat").isEmpty)
        XCTAssertFalse(RaceLogic.typeLabel("mountain").isEmpty)
        XCTAssertFalse(RaceLogic.typeLabel("itt").isEmpty)
    }

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

    func test_categoryTier_wtFor1UWT() {
        XCTAssertEqual("wt", RaceLogic.categoryTier("1.UWT"))
    }

    func test_categoryTier_wtFor2UWT() {
        XCTAssertEqual("wt", RaceLogic.categoryTier("2.UWT"))
    }

    func test_categoryTier_wcForWC() {
        XCTAssertEqual("wc", RaceLogic.categoryTier("WC"))
    }

    func test_categoryTier_nilForNil() {
        XCTAssertNil(RaceLogic.categoryTier(nil))
    }

    func test_categoryTier_nilForEmpty() {
        XCTAssertNil(RaceLogic.categoryTier(""))
    }

    // MARK: - isColorDark

    func test_isColorDark_trueForBlack() {
        XCTAssertTrue(RaceLogic.isColorDark("#000000"))
    }

    func test_isColorDark_falseForWhite() {
        XCTAssertFalse(RaceLogic.isColorDark("#FFFFFF"))
    }

    func test_isColorDark_trueForNil() {
        XCTAssertTrue(RaceLogic.isColorDark(nil))
    }

    func test_isColorDark_trueForNavyBlue() {
        XCTAssertTrue(RaceLogic.isColorDark("#003366"))
    }

    // MARK: - nameImpliesFemale

    func test_nameImpliesFemale_trueForWomen() {
        XCTAssertTrue(RaceLogic.nameImpliesFemale("Tour de Flandes Women"))
    }

    func test_nameImpliesFemale_trueForFemenino() {
        XCTAssertTrue(RaceLogic.nameImpliesFemale("Vuelta a Burgos Femenino"))
    }

    func test_nameImpliesFemale_trueForFemininaPortuguese() {
        // "Feminina"/"Feminino" (portugués/italiano, sin acento, vocal i) deben
        // contar como femenino igual que la web (patrón f[eé]minin[e]?).
        XCTAssertTrue(RaceLogic.nameImpliesFemale("Volta a Portugal Feminina"))
        XCTAssertTrue(RaceLogic.nameImpliesFemale("Giro Feminino"))
    }

    func test_nameImpliesFemale_falseForNeutralName() {
        XCTAssertFalse(RaceLogic.nameImpliesFemale("Tour de Francia"))
    }

    func test_nameImpliesFemale_falseForNil() {
        XCTAssertFalse(RaceLogic.nameImpliesFemale(nil))
    }

    // MARK: - cleanFeminineDisplayName

    func test_cleanFeminineDisplayName_removesWomen() {
        let cleaned = RaceLogic.cleanFeminineDisplayName("Tour de Flandes Women")
        XCTAssertFalse(cleaned.lowercased().contains("women"))
    }

    func test_cleanFeminineDisplayName_removesFemenino() {
        let cleaned = RaceLogic.cleanFeminineDisplayName("Vuelta a Burgos Femenino")
        XCTAssertFalse(cleaned.lowercased().contains("femenino"))
    }

    func test_cleanFeminineDisplayName_keepsNeutralName() {
        let name = "Tour de Francia"
        XCTAssertEqual(name, RaceLogic.cleanFeminineDisplayName(name))
    }

    func test_cleanFeminineDisplayName_keepsKnownException() {
        let name = "Women Cycling Pro"
        XCTAssertEqual(name, RaceLogic.cleanFeminineDisplayName(name))
    }

    // MARK: - shouldShowResults

    func test_shouldShowResults_falseForRestDay() {
        let rd = makeRaceDay(isRestDay: true)
        let race = makeRace(fcId: 1)
        XCTAssertFalse(RaceLogic.shouldShowResults(rd: rd, race: race))
    }

    func test_shouldShowResults_falseForCancelledDay() {
        let rd = makeRaceDay(isCancelledDay: true)
        let race = makeRace(fcId: 1)
        XCTAssertFalse(RaceLogic.shouldShowResults(rd: rd, race: race))
    }

    func test_shouldShowResults_falseIfNoIds() {
        let rd = makeRaceDay()
        let race = makeRace(fcId: nil, pcsSlug: nil)
        XCTAssertFalse(RaceLogic.shouldShowResults(rd: rd, race: race))
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

    func test_reviveUrl_nilForEmptyBroadcasts() {
        XCTAssertNil(RaceLogic.reviveUrl(from: []))
    }

    func test_reviveUrl_returnsEurosportUrl() {
        let broadcasts = [makeBroadcast(channel: "Eurosport 1", url: "https://eurosport.com/live")]
        XCTAssertNotNil(RaceLogic.reviveUrl(from: broadcasts))
    }

    func test_reviveUrl_returnsYouTubeUrl() {
        let broadcasts = [makeBroadcast(channel: "Canal", url: "https://youtube.com/watch?v=abc")]
        XCTAssertNotNil(RaceLogic.reviveUrl(from: broadcasts))
    }

    func test_reviveUrl_returnsShowInReviveUrl() {
        let broadcasts = [makeBroadcast(channel: "Otro", url: "https://example.com", showInRevive: true)]
        XCTAssertNotNil(RaceLogic.reviveUrl(from: broadcasts))
    }

    func test_reviveUrl_nilForNonReviveBroadcast() {
        let broadcasts = [makeBroadcast(channel: "Canal local", url: "https://example.com")]
        XCTAssertNil(RaceLogic.reviveUrl(from: broadcasts))
    }

    // MARK: - reviveBroadcasts

    func test_reviveBroadcasts_excludesShowInReviveWithNoUrl() {
        let broadcasts = [makeBroadcast(channel: "Canal", url: nil, showInRevive: true)]
        XCTAssertTrue(RaceLogic.reviveBroadcasts(from: broadcasts).isEmpty)
    }

    func test_reviveBroadcasts_excludesEurosportWithNoUrl() {
        let broadcasts = [makeBroadcast(channel: "Eurosport 1", url: nil)]
        XCTAssertTrue(RaceLogic.reviveBroadcasts(from: broadcasts).isEmpty)
    }

    func test_reviveBroadcasts_includesShowInReviveWithUrl() {
        let broadcasts = [makeBroadcast(channel: "Canal", url: "https://example.com", showInRevive: true)]
        XCTAssertEqual(RaceLogic.reviveBroadcasts(from: broadcasts).count, 1)
    }

    // MARK: - sortByCategory: prioridad de miniperfil

    func test_sortByCategory_profileBeatsHigherCategoryWithoutProfile() {
        let conPerfil = makeEnriched(makeRace(name: "Con perfil", uciCategory: "2.2"), withProfile: true)
        let sinPerfil = makeEnriched(makeRace(name: "Sin perfil", uciCategory: "2.1"), withProfile: false)
        let ordenado = [sinPerfil, conPerfil].sorted(by: RaceLogic.sortByCategory)
        XCTAssertEqual(ordenado.first?.race?.name, "Con perfil")
    }

    func test_sortByCategory_withinProfileGroupKeepsCategoryOrder() {
        let pro = makeEnriched(makeRace(name: "Pro", uciCategory: "2.Pro"), withProfile: true)
        let dosDos = makeEnriched(makeRace(name: "DosDos", uciCategory: "2.2"), withProfile: true)
        let ordenado = [dosDos, pro].sorted(by: RaceLogic.sortByCategory)
        XCTAssertEqual(ordenado.map { $0.race?.name }, ["Pro", "DosDos"])
    }

    func test_sortByCategory_profileNotViewableCountsAsNoProfile() {
        let oculto = makeEnriched(makeRace(name: "Oculto", uciCategory: "2.1"), withProfile: true, notViewable: true)
        let visible = makeEnriched(makeRace(name: "Visible", uciCategory: "2.2"), withProfile: true)
        let ordenado = [oculto, visible].sorted(by: RaceLogic.sortByCategory)
        XCTAssertEqual(ordenado.first?.race?.name, "Visible")
    }

    // MARK: - Helpers

    private func makeRace(
        name: String = "Test Race",
        fcId: Int? = nil,
        pcsSlug: String? = nil,
        year: Int? = 2026,
        uciCategory: String? = "1.UWT",
        countryCode: String? = nil,
        gender: String? = nil,
        isGrandTour: Bool = false
    ) -> Race {
        Race(
            id: UUID().uuidString,
            name: name,
            nameEn: nil,
            abbrev: nil,
            uciCategory: uciCategory,
            gender: gender,
            raceFormat: nil,
            countryCode: countryCode,
            colorHex: nil,
            logoUrl: nil,
            websiteUrl: nil,
            fcId: fcId,
            pcsSlug: pcsSlug,
            hideFlag: false,
            isGrandTour: isGrandTour,
            isCancelled: false,
            startDate: nil,
            endDate: nil,
            year: year,
            slug: nil,
            originalName: nil,
            startlistImportedAt: nil,
            startlistProvisional: nil,
            enrichedStartlist: nil
        )
    }

    private func makeRaceDay(
        dateKey: String = "2026-01-01",
        isRestDay: Bool = false,
        isCancelledDay: Bool = false,
        estimatedFinishTimeUtc: String? = nil,
        stageNumber: Int? = 1
    ) -> RaceDay {
        RaceDay(
            id: UUID().uuidString,
            raceId: nil,
            dateKey: dateKey,
            slug: nil,
            isRestDay: isRestDay,
            isCancelledDay: isCancelledDay,
            stageNumber: stageNumber,
            startLocation: nil,
            finishLocation: nil,
            distanceKm: nil,
            primaryType: nil,
            secondaryType: nil,
            neutralStartTimeUtc: nil,
            estimatedFinishTimeUtc: estimatedFinishTimeUtc,
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

    /// EnrichedRaceDay con (o sin) miniperfil para los tests de orden.
    private func makeEnriched(
        _ race: Race,
        withProfile: Bool,
        notViewable: Bool = false
    ) -> EnrichedRaceDay {
        let profile = withProfile
            ? ElevationProfile(
                distance: 100, elevationGain: 500, elevationLoss: 0,
                minElevation: 0, maxElevation: 500,
                points: [ElevationPoint(km: 0, alt: 0), ElevationPoint(km: 100, alt: 500)])
            : nil
        let rd = RaceDay(
            id: UUID().uuidString, raceId: nil, dateKey: "2026-01-01", slug: nil,
            isRestDay: false, isCancelledDay: false, stageNumber: 1,
            startLocation: nil, finishLocation: nil,
            distanceKm: nil, primaryType: nil, secondaryType: nil,
            neutralStartTimeUtc: nil, estimatedFinishTimeUtc: nil,
            tvStatus: nil, description: nil, bonuses: nil, notes: nil,
            editorialStatus: "published", hasAssets: false,
            updatedAt: nil, countryCode: nil,
            elevationProfile: profile, profileNotViewable: notViewable)
        return EnrichedRaceDay(raceDay: rd, race: race, broadcasts: [], assets: [])
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

    // MARK: - matchesCategory con Campeonatos Nacionales (CN)
    // CN élite (masc/fem) cuentan como Pro; las sub23 quedan fuera de
    // Pro/Masc/Fem. Masc/Fem respetan el género de la prueba.

    private func cn(_ name: String, gender: String? = nil) -> Race {
        makeRace(name: name, uciCategory: "CN", countryCode: "ES", gender: gender)
    }

    func test_matchesCategory_cnEliteInPro() {
        XCTAssertTrue(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Masculino", gender: "male"), filter: .pro))
        XCTAssertTrue(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Femenino", gender: "female"), filter: .pro))
    }

    func test_matchesCategory_cnU23NotInPro() {
        XCTAssertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea sub-23 Masculino", gender: "male"), filter: .pro))
        XCTAssertFalse(RaceLogic.matchesCategory(cn("Campeonato de España CRI sub-23 Femenino", gender: "female"), filter: .pro))
    }

    func test_matchesCategory_cnMaleOnlyEliteMen() {
        XCTAssertTrue(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Masculino", gender: "male"), filter: .male))
        XCTAssertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Femenino", gender: "female"), filter: .male))
        XCTAssertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea sub-23 Masculino", gender: "male"), filter: .male))
    }

    func test_matchesCategory_cnFemaleOnlyEliteWomen() {
        XCTAssertTrue(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Femenino", gender: "female"), filter: .female))
        XCTAssertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Masculino", gender: "male"), filter: .female))
        XCTAssertFalse(RaceLogic.matchesCategory(cn("Campeonato de España CRI sub-23 Femenino", gender: "female"), filter: .female))
    }

    func test_matchesCategory_cnNotInUwtWwt() {
        XCTAssertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Masculino", gender: "male"), filter: .uwt))
        XCTAssertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Femenino", gender: "female"), filter: .wwt))
    }
}
