import XCTest
@testable import CalendarioCiclismo

/// Reglas de Fichajes (`js/fichajes.js`): qué entra en los feeds y cómo se
/// reparte cada corredor en el detalle de equipo.
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

    func test_feedShowsOnlyRealSignings() {
        // Solo fichajes reales confirmados, visibles y con destino conocido. Fuera:
        // renovaciones, retiradas, fines de contrato sin destino (to='?'), rumores,
        // dudas y movimientos con fecha oculta (la carga inicial del mercado no
        // debe llenar el feed de anuncios viejos).
        let feed = TransfersLogic.confirmedFeed([
            transfer(id: "sign", riderId: "r1", type: "transfer", to: "team_b"),
            transfer(id: "renew", riderId: "r2", type: "renewal", to: "team_a"),
            transfer(id: "retire", riderId: "r3", type: "retirement", from: "team_a"),
            transfer(id: "end", riderId: "r4", type: "transfer", from: "team_a", toName: "?"),
            transfer(id: "rumor", riderId: "r5", status: "rumor", to: "team_b"),
            transfer(id: "doubt", riderId: "r6", type: "renewal", status: "doubt", to: "team_a"),
            transfer(id: "hidden", riderId: "r7", to: "team_b", dateVisible: false),
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

    // MARK: - Detalle de equipo

    func test_confirmedDepartureRemovesFromStaying() {
        let roster = [rider("r1", last: "Uno"), rider("r2", last: "Dos")]
        let moves = [transfer(id: "t1", riderId: "r1", from: "team_a", to: "team_b")]
        let detail = TransfersLogic.teamDetail(transfers: moves, roster: roster, teamId: "team_a")
        XCTAssertEqual(detail.staying.map(\.rider.id), ["r2"])
        XCTAssertEqual(detail.departures.map(\.id), ["t1"])
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

    // MARK: - Fecha oculta (mig. 123)

    /// Un movimiento con fecha oculta no sale en el feed, pero sí cuenta en el
    /// detalle de equipo: es como se puebla el mercado.
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
}
