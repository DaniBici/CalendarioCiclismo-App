import XCTest
@testable import CalendarioCiclismo

final class SeasonChallengeLogicTests: XCTestCase {

    func test_entries_groupMembersAtFirstRaceAndKeepSingleMemberLoose() {
        let races = [
            race("a", "2027-01-22"), race("m1", "2027-01-23"), race("b", "2027-01-24"),
            race("m2", "2027-01-24"), race("w1", "2027-01-25"),
        ]
        let groups = [
            ChallengeGroup(id: "men", name: "Challenge Mallorca", raceIds: ["m1", "m2", "m3"]),
            ChallengeGroup(id: "women", name: "Challenge Mallorca femenina", raceIds: ["w1", "w2"]),
        ]
        let ids = SeasonChallengeLogic.entries(races: races, groups: groups).map { entry -> String in
            switch entry {
            case .race(let race): race.id
            case .challenge(let group, let members): "\(group.id):\(members.map(\.id).joined(separator: ","))"
            }
        }
        XCTAssertEqual(ids, ["a", "men:m1,m2", "b", "w1"])
    }

    func test_groupingStartDates_moveMembersToFirstRaceMonth() {
        let races = [race("m1", "2027-01-31"), race("m2", "2027-02-01"), race("x", "2027-02-01")]
        let groups = [ChallengeGroup(id: "g", name: "Challenge", raceIds: ["m1", "m2"])]
        XCTAssertEqual(
            SeasonChallengeLogic.groupingStartDates(races: races, groups: groups),
            ["m1": "2027-01-31", "m2": "2027-01-31"]
        )
    }

    private func race(_ id: String, _ startDate: String) -> Race {
        Race(
            id: id, name: id, nameEn: nil, uciCategory: "1.1", gender: nil,
            raceFormat: "one_day", countryCode: "ES", colorHex: nil, logoUrl: nil, websiteUrl: nil,
            hideFlag: false, isGrandTour: false, isCancelled: false, startDate: startDate,
            endDate: nil, year: 2027, slug: nil, originalName: nil, startlistImportedAt: nil,
            startlistProvisional: nil
        )
    }
}
