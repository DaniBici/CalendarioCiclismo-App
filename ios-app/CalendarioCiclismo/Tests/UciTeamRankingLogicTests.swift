import XCTest
@testable import CalendarioCiclismo

final class UciTeamRankingLogicTests: XCTestCase {
    private func row(_ rank: Int, _ category: String, gender: String = "male") -> UciTeamRankingRow {
        UciTeamRankingRow(
            gender: gender,
            rank: rank,
            previousRank: nil,
            uciTeamId: Int64(rank),
            teamId: "team-\(rank)",
            teamCategory: category,
            sourceName: "TEAM \(rank)",
            displayName: "Team \(rank)",
            teamCode: nil,
            countryCode: "ES",
            points: 100,
            rankingDate: "2026-07-28",
            sourceUrl: "https://dataride.uci.ch"
        )
    }

    func testInvitacionesMasculinasCuentanProTeamsNoPuestosAbsolutos() {
        let result = UciTeamRankingLogic.decorate([
            row(1, "WT"), row(8, "PT"), row(9, "WT"), row(15, "PT"),
            row(18, "PT"), row(21, "PT"), row(22, "PT"),
        ], gender: "male").filter { $0.row.teamCategory == "PT" }

        XCTAssertEqual(result.map(\.invitationTier), [
            .allWorldTour, .allWorldTour, .allWorldTour, .proSeries, .proSeries,
        ])
        XCTAssertTrue(result[0].explanation(isEnglish: false).contains("y a todas las pruebas UCI ProSeries"))
    }

    func testSoloProTeamFueraTop30QuedaExcluidoDeGrandesVueltas() {
        let result = UciTeamRankingLogic.decorate([
            row(30, "PT"), row(31, "PT"), row(40, "CT"),
        ], gender: "male")

        XCTAssertEqual(result.map(\.grandTourExcluded), [false, true, false])
        XCTAssertTrue(result[1].explanation(isEnglish: false).contains("top-30"))
        XCTAssertTrue(result[1].explanation(isEnglish: false).contains("2027"))
    }

    func testDosMejoresWomensProTeams() {
        let result = UciTeamRankingLogic.decorate([
            row(1, "WWT", gender: "female"),
            row(12, "PRW", gender: "female"),
            row(15, "PRW", gender: "female"),
            row(16, "PRW", gender: "female"),
        ], gender: "female")

        XCTAssertEqual(result.map(\.invitationTier), [
            .worldTour, .womensWorldTour, .womensWorldTour, .standard,
        ])
        XCTAssertFalse(result[1].explanation(isEnglish: false).contains("ProSeries"))
    }
}
