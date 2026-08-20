import XCTest
@testable import CalendarioCiclismo

/// Tests de la lógica pura de Fichajes (apps 4.0) — espejo 1:1 de
/// `TransfersLogicTest` (Android) y de las reglas de `js/fichajes.js` (web).
final class TransfersLogicTests: XCTestCase {

    private func transfer(
        id: String,
        riderId: String,
        type: String = "transfer",
        status: String = "confirmed",
        from: String? = nil,
        to: String? = nil,
        toName: String? = nil,
        contractUntil: Int? = nil,
        announcedAt: String? = "2026-07-10",
        createdAt: String? = nil,
        dateVisible: Bool = true,
        midSeason: Bool = false
    ) -> RiderTransfer {
        RiderTransfer(
            id: id, season: 2027, riderId: riderId, riderGender: "male",
            fromTeamId: from, fromTeamName: nil, toTeamId: to, toTeamName: toName,
            type: type, status: status, contractUntil: contractUntil,
            announcedAt: announcedAt, dateVisible: dateVisible, midSeason: midSeason, createdAt: createdAt
        )
    }

    private func rider(_ id: String, last: String, contractUntil: Int? = nil, currentTeamId: String? = "team_a") -> TransferRider {
        TransferRider(
            id: id, firstName: "Test", lastName: last, nationality: "es",
            currentTeamId: currentTeamId, contractUntil: contractUntil
        )
    }

    // MARK: - Feed

    func test_feedExcludesRumors() {
        let feed = TransfersLogic.confirmedFeed([
            transfer(id: "t1", riderId: "r1", status: "confirmed", to: "team_b"),
            transfer(id: "t2", riderId: "r2", status: "rumor", to: "team_b"),
        ])
        XCTAssertEqual(feed.map(\.id), ["t1"])
    }

    func test_feedShowsOnlyRealSignings() {
        // Solo fichajes reales (transfer con destino conocido). Fuera:
        // renovaciones, retiradas y fines de contrato sin destino (to='?').
        let feed = TransfersLogic.confirmedFeed([
            transfer(id: "sign", riderId: "r1", type: "transfer", to: "team_b"),
            transfer(id: "renew", riderId: "r2", type: "renewal", to: "team_a"),
            transfer(id: "retire", riderId: "r3", type: "retirement", from: "team_a"),
            transfer(id: "end", riderId: "r4", type: "transfer", from: "team_a", toName: "?"),
        ])
        XCTAssertEqual(feed.map(\.id), ["sign"])
    }

    func test_renewalFeedShowsOnlyConfirmedVisibleRenewals() {
        let feed = TransfersLogic.renewalFeed([
            transfer(id: "renew", riderId: "r1", type: "renewal", to: "team_a"),
            transfer(id: "sign", riderId: "r2", type: "transfer", to: "team_b"),
            transfer(id: "rumor", riderId: "r3", type: "renewal", status: "rumor", to: "team_a"),
            transfer(id: "hidden", riderId: "r4", type: "renewal", to: "team_a", dateVisible: false),
        ])
        XCTAssertEqual(feed.map(\.id), ["renew"])
    }

    func test_limitedFeedStopsAtMaxDays() {
        // 6 fechas distintas (1 fichaje cada una) → se cortan a 5.
        let feed = (1...6).map { transfer(id: "t\($0)", riderId: "r\($0)", to: "team_b", announcedAt: "2026-07-0\($0)") }
            .sorted { ($0.announcedAt ?? "") > ($1.announcedAt ?? "") }
        let out = TransfersLogic.limitedFeed(feed)
        XCTAssertEqual(Set(out.map { $0.announcedAt }).count, 5)
        XCTAssertEqual(out.count, 5)
    }

    func test_limitedFeedStopsAtMaxItems() {
        // 10 fichajes en 2 fechas → se cortan a 8 items.
        let feed = (1...10).map { transfer(id: "t\($0)", riderId: "r\($0)", to: "team_b", announcedAt: $0 <= 5 ? "2026-07-02" : "2026-07-01") }
        let out = TransfersLogic.limitedFeed(feed)
        XCTAssertEqual(out.count, 8)
    }

    func test_feedSortsReverseChronological() {
        let feed = TransfersLogic.confirmedFeed([
            transfer(id: "old", riderId: "r1", to: "team_b", announcedAt: "2026-07-01"),
            transfer(id: "new", riderId: "r2", to: "team_b", announcedAt: "2026-07-12"),
            transfer(id: "mid", riderId: "r3", to: "team_b", announcedAt: "2026-07-05"),
        ])
        XCTAssertEqual(feed.map(\.id), ["new", "mid", "old"])
    }

    func test_feedPrioritizesNextSeasonSigningsOverMidSeasonOnSameDay() {
        let feed = TransfersLogic.confirmedFeed([
            transfer(id: "midSeason", riderId: "r1", to: "team_b", announcedAt: "2026-08-01", createdAt: "2026-08-01T12:00:00Z", midSeason: true),
            transfer(id: "nextSeason", riderId: "r2", to: "team_b", announcedAt: "2026-08-01", createdAt: "2026-08-01T09:00:00Z"),
        ])
        XCTAssertEqual(feed.map(\.id), ["nextSeason", "midSeason"])
    }

    func test_groupByDayKeepsOrderAndGroups() {
        let feed = [
            transfer(id: "a", riderId: "r1", to: "team_b", announcedAt: "2026-07-12"),
            transfer(id: "b", riderId: "r2", to: "team_b", announcedAt: "2026-07-12"),
            transfer(id: "c", riderId: "r3", to: "team_b", announcedAt: "2026-07-10"),
        ]
        let grouped = TransfersLogic.groupByDay(feed)
        XCTAssertEqual(grouped.count, 2)
        XCTAssertEqual(grouped[0].day, "2026-07-12")
        XCTAssertEqual(grouped[0].moves.count, 2)
        XCTAssertEqual(grouped[1].day, "2026-07-10")
    }

    // MARK: - Divisiones

    func test_divisionTeamsFiltersAndSortsAlphabetically() {
        let seasons = [
            season(teamId: "b", name: "Movistar", category: "WT"),
            season(teamId: "a", name: "Alpecin", category: "WT"),
            season(teamId: "c", name: "Lidl-Trek Women", category: "WWT"),
        ]
        let wt = TransfersLogic.divisionTeams(seasons, division: "WT")
        XCTAssertEqual(wt.map(\.name), ["Alpecin", "Movistar"])
    }

    private func season(teamId: String, name: String, category: String) -> TeamSeason {
        TeamSeason(
            teamId: teamId, year: 2027, name: name, category: category,
            badgeTorsoCenter: nil, badgeTorsoSides: nil, badgeShorts: nil,
            badgeInnerCircle: nil, headerBg: nil, headerText: nil,
            gender: nil, badgeVisible: false, continuityDoubt: nil
        )
    }

    // MARK: - Chapa efectiva (colores 2027 / antiguos / vacío)

    private func season(teamId: String, year: Int, badgeVisible: Bool, torso: String) -> TeamSeason {
        TeamSeason(
            teamId: teamId, year: year, name: "T", category: "WT",
            badgeTorsoCenter: torso, badgeTorsoSides: nil, badgeShorts: nil,
            badgeInnerCircle: nil, headerBg: nil, headerText: nil,
            gender: nil, badgeVisible: badgeVisible, continuityDoubt: nil
        )
    }

    func test_badgeSeasonPublishedUsesMarketColors() {
        let market = season(teamId: "a", year: 2027, badgeVisible: true, torso: "#new")
        let prev = ["a": season(teamId: "a", year: 2026, badgeVisible: true, torso: "#old")]
        let resolved = TransfersLogic.badgeSeason(for: market, prev: prev)
        XCTAssertEqual(resolved?.badgeTorsoCenter, "#new")
    }

    func test_badgeSeasonHiddenExistingUsesPrevColors() {
        let market = season(teamId: "a", year: 2027, badgeVisible: false, torso: "#new")
        let prev = ["a": season(teamId: "a", year: 2026, badgeVisible: true, torso: "#old")]
        let resolved = TransfersLogic.badgeSeason(for: market, prev: prev)
        XCTAssertEqual(resolved?.badgeTorsoCenter, "#old")
    }

    func test_badgeSeasonHiddenNewTeamIsNil() {
        // Equipo nuevo (sin fila 2026) → sin colores antiguos → chapa vacía.
        let market = season(teamId: "a", year: 2027, badgeVisible: false, torso: "#new")
        XCTAssertNil(TransfersLogic.badgeSeason(for: market, prev: [:]))
    }

    // MARK: - Detalle de equipo

    func test_confirmedDepartureRemovesFromStaying() {
        let roster = [rider("r1", last: "Uno"), rider("r2", last: "Dos")]
        let moves = [transfer(id: "t1", riderId: "r1", from: "team_a", to: "team_b")]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: roster, teamId: "team_a")
        XCTAssertEqual(detail.staying.map(\.rider.id), ["r2"])
        XCTAssertEqual(detail.departures.map(\.id), ["t1"])
    }

    func test_departuresSortedByDestinationCategoryThenNameThenRetirement() {
        // WT → PT → resto → retirada; alfabético por nombre de destino.
        let moves = [
            transfer(id: "retire", riderId: "r0", type: "retirement", from: "team_a"),
            transfer(id: "toPt", riderId: "r1", type: "transfer", from: "team_a", to: "pt1"),
            transfer(id: "toWtB", riderId: "r2", type: "transfer", from: "team_a", to: "wtB"),
            transfer(id: "toWtA", riderId: "r3", type: "transfer", from: "team_a", to: "wtA"),
            transfer(id: "toCt", riderId: "r4", type: "transfer", from: "team_a", to: "ct1"),
        ]
        let cats = ["wtA": "WT", "wtB": "WT", "pt1": "PT", "ct1": "CT"]
        let names = ["wtA": "Alpha", "wtB": "Bravo", "pt1": "PtTeam", "ct1": "CtTeam"]
        let detail = TransfersLogic.teamDetail(
            transfers: moves, roster: [], teamId: "team_a",
            categoryByTeamId: cats, teamNameById: names
        )
        XCTAssertEqual(detail.departures.map(\.id), ["toWtA", "toWtB", "toPt", "toCt", "retire"])
    }

    func test_arrivalsSortedAlphabeticallyByLastName() {
        let riders = [
            "r1": TransferRider(id: "r1", firstName: "A", lastName: "Zeta", nationality: nil, currentTeamId: nil, contractUntil: nil),
            "r2": TransferRider(id: "r2", firstName: "B", lastName: "Alfa", nationality: nil, currentTeamId: nil, contractUntil: nil),
        ]
        let moves = [
            transfer(id: "t1", riderId: "r1", type: "transfer", to: "team_a"),
            transfer(id: "t2", riderId: "r2", type: "transfer", to: "team_a"),
        ]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: [], teamId: "team_a", ridersById: riders)
        XCTAssertEqual(detail.arrivals.map(\.id), ["t2", "t1"])
    }

    func test_arrivalsConfirmedBeforeRumors() {
        // Confirmados primero, rumores después; apellido dentro de cada grupo.
        let riders = [
            "r1": TransferRider(id: "r1", firstName: "A", lastName: "Zeta", nationality: nil, currentTeamId: nil, contractUntil: nil),
            "r2": TransferRider(id: "r2", firstName: "B", lastName: "Alfa", nationality: nil, currentTeamId: nil, contractUntil: nil),
            "r3": TransferRider(id: "r3", firstName: "C", lastName: "Beta", nationality: nil, currentTeamId: nil, contractUntil: nil),
        ]
        let moves = [
            transfer(id: "rumZeta", riderId: "r1", type: "transfer", status: "rumor", to: "team_a"),
            transfer(id: "confAlfa", riderId: "r2", type: "transfer", status: "confirmed", to: "team_a"),
            transfer(id: "confBeta", riderId: "r3", type: "transfer", status: "confirmed", to: "team_a"),
        ]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: [], teamId: "team_a", ridersById: riders)
        XCTAssertEqual(detail.arrivals.map(\.id), ["confAlfa", "confBeta", "rumZeta"])
    }

    func test_contractEndsSortedAlphabeticallyByLastName() {
        let riders = [
            "r1": TransferRider(id: "r1", firstName: "A", lastName: "Zeta", nationality: nil, currentTeamId: nil, contractUntil: nil),
            "r2": TransferRider(id: "r2", firstName: "B", lastName: "Alfa", nationality: nil, currentTeamId: nil, contractUntil: nil),
        ]
        let moves = [
            transfer(id: "t1", riderId: "r1", type: "transfer", from: "team_a", toName: "?"),
            transfer(id: "t2", riderId: "r2", type: "transfer", from: "team_a", toName: "?"),
        ]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: [], teamId: "team_a", ridersById: riders)
        XCTAssertEqual(detail.contractEnds.map(\.id), ["t2", "t1"])
    }

    func test_contractEndSeparatesFromDepartures() {
        // Fin de contrato sin destino (transfer to='?') → "Terminan contrato".
        // Un fichaje con destino y una retirada → "Se marchan".
        let roster = [rider("r1", last: "Fin"), rider("r2", last: "Ficha"), rider("r3", last: "Retira")]
        let moves = [
            transfer(id: "end", riderId: "r1", type: "transfer", from: "team_a", toName: "?"),
            transfer(id: "sign", riderId: "r2", type: "transfer", from: "team_a", to: "team_b"),
            transfer(id: "retire", riderId: "r3", type: "retirement", from: "team_a"),
        ]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: roster, teamId: "team_a")
        XCTAssertEqual(detail.contractEnds.map(\.id), ["end"])
        XCTAssertEqual(Set(detail.departures.map(\.id)), ["sign", "retire"])
        XCTAssertTrue(detail.staying.isEmpty)
    }

    func test_stayingSortedByContractYearDescending() {
        // 2030 → 2029 → 2028 → sin año (nil) al final; alfabético dentro de año.
        let roster = [
            rider("a", last: "Amid", contractUntil: 2028),
            rider("b", last: "Blank", contractUntil: nil),
            rider("c", last: "Ceil", contractUntil: 2030),
            rider("d", last: "Deep", contractUntil: 2029),
            rider("e", last: "Early", contractUntil: 2028),
        ]
        let detail = TransfersLogic.teamDetail(transfers: [], roster: roster, teamId: "team_a")
        XCTAssertEqual(detail.staying.map(\.rider.id), ["c", "d", "a", "e", "b"])
    }

    func test_stayingOnlyIncludesRidersFrom2026Roster() {
        // Continúan = solo quien YA estaba en el equipo (currentTeamId=team_a).
        // Un fichaje de fuera está en el roster 2027 pero su currentTeamId es
        // otro equipo → NO continúa (va a "Llegan").
        let roster = [
            rider("stay", last: "Local", currentTeamId: "team_a"),
            rider("newbie", last: "Fichaje", currentTeamId: "team_x"),
        ]
        let detail = TransfersLogic.teamDetail(transfers: [], roster: roster, teamId: "team_a")
        XCTAssertEqual(detail.staying.map(\.rider.id), ["stay"])
    }

    func test_rumoredDepartureAlsoRemovesFromStayingAndFlagsRumor() {
        // Regla Dani: el rumor de salida pasa al corredor a baja·Rumor (y a
        // alta·Rumor en el destino) — deja de listarse en "continúan".
        let roster = [rider("r1", last: "Uno")]
        let moves = [transfer(id: "t1", riderId: "r1", status: "rumor", from: "team_a", to: "team_b")]
        let detailA = TransfersLogic.teamDetail(transfers: moves, roster: roster, teamId: "team_a")
        XCTAssertTrue(detailA.staying.isEmpty)
        XCTAssertEqual(detailA.departures.first?.status, "rumor")
        let detailB = TransfersLogic.teamDetail(transfers: moves, roster: [], teamId: "team_b")
        XCTAssertEqual(detailB.arrivals.first?.status, "rumor")
    }

    func test_retirementCountsAsDeparture() {
        let roster = [rider("r1", last: "Uno")]
        let moves = [transfer(id: "t1", riderId: "r1", type: "retirement", from: "team_a")]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: roster, teamId: "team_a")
        XCTAssertTrue(detail.staying.isEmpty)
        XCTAssertEqual(detail.departures.first?.type, "retirement")
    }

    func test_renewalContractWinsOverProfileAndRumorFlagsRow() {
        let roster = [rider("r1", last: "Uno", contractUntil: 2027), rider("r2", last: "Dos", contractUntil: 2027)]
        let moves = [
            transfer(id: "t1", riderId: "r1", type: "renewal", to: "team_a", contractUntil: 2029),
            transfer(id: "t2", riderId: "r2", type: "renewal", status: "rumor", to: "team_a", contractUntil: 2030),
        ]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: roster, teamId: "team_a")
        let byId = Dictionary(uniqueKeysWithValues: detail.staying.map { ($0.rider.id, $0) })
        XCTAssertEqual(byId["r1"]?.contractUntil, 2029)
        XCTAssertEqual(byId["r1"]?.isRumor, false)
        XCTAssertEqual(byId["r2"]?.contractUntil, 2030)
        XCTAssertEqual(byId["r2"]?.isRumor, true)
    }

    func test_stayingFallsBackToProfileContract() {
        let roster = [rider("r1", last: "Uno", contractUntil: 2028)]
        let detail = TransfersLogic.teamDetail(transfers: [], roster: roster, teamId: "team_a")
        XCTAssertEqual(detail.staying.first?.contractUntil, 2028)
        XCTAssertEqual(detail.staying.first?.isRumor, false)
    }

    func test_stayingSortsByLastName() {
        let roster = [rider("r1", last: "Zubeldia"), rider("r2", last: "Aular")]
        let detail = TransfersLogic.teamDetail(transfers: [], roster: roster, teamId: "team_a")
        XCTAssertEqual(detail.staying.map(\.rider.id), ["r2", "r1"])
    }

    // MARK: - Etiquetas de equipo

    func test_teamLabelPrefersCatalogThenFreeTextThenUnknown() {
        let names = ["team_a": "Movistar 2027"]
        XCTAssertEqual(TransfersLogic.teamLabel(teamId: "team_a", freeText: nil, names: names, unknownLabel: "?"), "Movistar 2027")
        XCTAssertEqual(TransfersLogic.teamLabel(teamId: nil, freeText: "Júnior X", names: names, unknownLabel: "?"), "Júnior X")
        XCTAssertEqual(TransfersLogic.teamLabel(teamId: nil, freeText: nil, names: names, unknownLabel: "?"), "?")
    }

    func test_teamLabelUsesCurrentSeasonNameForOriginAndMarketNameForDestination() {
        // Mismo equipo, renombrado para el mercado: de dónde sale un corredor
        // se lee con el nombre de la temporada en curso; a dónde va, con el nuevo.
        let names = ["team_a": "Nuevo Sponsor 2027"]
        let namesPrev = ["team_a": "Viejo Sponsor 2026"]
        XCTAssertEqual(
            TransfersLogic.teamLabel(teamId: "team_a", freeText: nil, names: names,
                                     unknownLabel: "?", side: .from, namesPrev: namesPrev),
            "Viejo Sponsor 2026")
        XCTAssertEqual(
            TransfersLogic.teamLabel(teamId: "team_a", freeText: nil, names: names,
                                     unknownLabel: "?", side: .to, namesPrev: namesPrev),
            "Nuevo Sponsor 2027")
    }

    func test_teamLabelFallsBackToTheOtherSeasonWhenOnlyOneHasTheTeam() {
        // Continental sin fila en el mercado: el origen cae al nombre que haya.
        XCTAssertEqual(
            TransfersLogic.teamLabel(teamId: "team_b", freeText: nil, names: ["team_b": "Solo 2027"],
                                     unknownLabel: "?", side: .from, namesPrev: [:]),
            "Solo 2027")
        XCTAssertEqual(
            TransfersLogic.teamLabel(teamId: "team_c", freeText: nil, names: [:],
                                     unknownLabel: "?", side: .to, namesPrev: ["team_c": "Solo 2026"]),
            "Solo 2026")
    }

    func test_divisionGenderMapsCategories() {
        XCTAssertEqual(TransfersLogic.divisionGender("WT"), "male")
        XCTAssertEqual(TransfersLogic.divisionGender("WWT"), "female")
        XCTAssertEqual(TransfersLogic.divisionGender("PT"), "male")
        XCTAssertEqual(TransfersLogic.divisionGender("PRW"), "female")
        XCTAssertNil(TransfersLogic.divisionGender(nil))
    }

    // MARK: - Fecha oculta (mig. 123)

    /// La carga inicial del mercado no debe llenar el feed de anuncios viejos.
    func test_feedExcludesHiddenDateMoves() {
        let feed = TransfersLogic.confirmedFeed([
            transfer(id: "t1", riderId: "r1", to: "team_b", dateVisible: true),
            transfer(id: "t2", riderId: "r2", to: "team_b", dateVisible: false),
        ])
        XCTAssertEqual(feed.map(\.id), ["t1"])
    }

    /// Pero SÍ cuenta en el detalle de equipo: es como se puebla el mercado.
    func test_hiddenDateMoveStillCountsInTeamDetail() {
        let moves = [transfer(id: "t1", riderId: "r1", from: "team_a", to: "team_b", dateVisible: false)]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: [rider("r1", last: "Uno")], teamId: "team_a")
        XCTAssertEqual(detail.departures.map(\.id), ["t1"])
        XCTAssertTrue(detail.staying.isEmpty)   // sale de "continúan" igual
    }

    func test_midSeasonMoveDoesNotAppearAsNextMarketArrivalButKeepsRealRosterContract() {
        // El fichaje de agosto es informativo en el feed. Si más adelante se
        // registra contrato 2027+ en la afiliación, el corredor continúa; no
        // debe aparecer simultáneamente como una llegada del mercado.
        let moves = [transfer(id: "mid", riderId: "r1", from: "team_old", to: "team_a", midSeason: true)]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: [rider("r1", last: "Uno", contractUntil: 2029)], teamId: "team_a")
        XCTAssertTrue(detail.arrivals.isEmpty)
        XCTAssertEqual(detail.staying.map(\.id), ["r1"])
    }

    // MARK: - Duda del corredor (mig. 123)

    func test_feedExcludesDoubts() {
        let feed = TransfersLogic.confirmedFeed([
            transfer(id: "t1", riderId: "r1", type: "renewal", status: "doubt", to: "team_a"),
            transfer(id: "t2", riderId: "r2", to: "team_b"),
        ])
        XCTAssertEqual(feed.map(\.id), ["t2"])
    }

    /// Una renovación en duda saca al corredor de "continúan" y lo lleva a "en duda".
    func test_doubtMovesRiderOutOfStaying() {
        let moves = [transfer(id: "t1", riderId: "r1", type: "renewal", status: "doubt", to: "team_a")]
        let roster = [rider("r1", last: "Dudoso"), rider("r2", last: "Seguro")]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: roster, teamId: "team_a")

        XCTAssertEqual(detail.staying.map(\.rider.id), ["r2"])
        XCTAssertEqual(detail.doubtful.map(\.riderId), ["r1"])
        XCTAssertEqual(detail.doubtful.first?.rider?.lastName, "Dudoso")
    }

    /// Una duda NO pisa el contrato de la ficha (no es un hecho).
    func test_doubtDoesNotOverrideContract() {
        let moves = [transfer(id: "t1", riderId: "r1", type: "renewal", status: "doubt",
                              to: "team_a", contractUntil: 2030)]
        let roster = [rider("r1", last: "Dudoso", contractUntil: 2027)]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: roster, teamId: "team_a")
        // El de la FICHA, nunca el 2030 de la duda.
        XCTAssertEqual(detail.doubtful.first?.contractUntil, 2027)
    }

    /// Una renovación confirmada sigue mandando sobre el contrato de la ficha.
    func test_confirmedRenewalStillOverridesContract() {
        let moves = [transfer(id: "t1", riderId: "r1", type: "renewal", to: "team_a", contractUntil: 2030)]
        let detail = TransfersLogic.teamDetail(
            transfers: moves, roster: [rider("r1", last: "Uno", contractUntil: 2027)], teamId: "team_a")
        XCTAssertEqual(detail.staying.first?.contractUntil, 2030)
        XCTAssertFalse(detail.staying.first?.isRumor ?? true)
    }

    /// Una salida registrada gana a la duda: no puede estar en ambas listas.
    func test_departureWinsOverDoubt() {
        let moves = [
            transfer(id: "t1", riderId: "r1", type: "renewal", status: "doubt", to: "team_a"),
            transfer(id: "t2", riderId: "r1", from: "team_a", to: "team_b"),
        ]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: [rider("r1", last: "Uno")], teamId: "team_a")
        XCTAssertEqual(detail.departures.map(\.id), ["t2"])
        XCTAssertTrue(detail.doubtful.isEmpty)
        XCTAssertTrue(detail.staying.isEmpty)
    }

    /// Dudas ordenadas por apellido, como el resto de secciones.
    func test_doubtfulSortedByLastName() {
        let moves = [
            transfer(id: "t1", riderId: "r1", type: "renewal", status: "doubt", to: "team_a"),
            transfer(id: "t2", riderId: "r2", type: "renewal", status: "doubt", to: "team_a"),
        ]
        let roster = [rider("r1", last: "Zabala"), rider("r2", last: "Alonso")]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: roster, teamId: "team_a")
        XCTAssertEqual(detail.doubtful.map(\.riderId), ["r2", "r1"])
    }
}
