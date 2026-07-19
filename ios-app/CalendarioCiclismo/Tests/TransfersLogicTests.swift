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
        contractUntil: Int? = nil,
        announcedAt: String? = "2026-07-10",
        createdAt: String? = nil,
        dateVisible: Bool = true
    ) -> RiderTransfer {
        RiderTransfer(
            id: id, season: 2027, riderId: riderId, riderGender: "male",
            fromTeamId: from, fromTeamName: nil, toTeamId: to, toTeamName: nil,
            type: type, status: status, contractUntil: contractUntil,
            announcedAt: announcedAt, dateVisible: dateVisible, createdAt: createdAt
        )
    }

    private func rider(_ id: String, last: String, contractUntil: Int? = nil) -> TransferRider {
        TransferRider(
            id: id, firstName: "Test", lastName: last, nationality: "es",
            currentTeamId: "team_a", contractUntil: contractUntil
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

    func test_feedSortsReverseChronological() {
        let feed = TransfersLogic.confirmedFeed([
            transfer(id: "old", riderId: "r1", to: "team_b", announcedAt: "2026-07-01"),
            transfer(id: "new", riderId: "r2", to: "team_b", announcedAt: "2026-07-12"),
            transfer(id: "mid", riderId: "r3", to: "team_b", announcedAt: "2026-07-05"),
        ])
        XCTAssertEqual(feed.map(\.id), ["new", "mid", "old"])
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
