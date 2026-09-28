import XCTest
@testable import CalendarioCiclismo

/// Vectores COMPARTIDOS con `js/__tests__/simplified-guide.test.js` y
/// `SimplifiedGuideTest.kt`. Mantener la paridad al cambiar la heurística.
final class SimplifiedGuideTests: XCTestCase {

    let start = "2026-04-26T08:00:00.000Z"  // 10:00 CEST
    let finish = "2026-04-26T14:20:00.000Z" // 16:20 CEST (380 min después)

    private func summit(km: Double, name: String? = nil, category: String? = nil,
                        startKm: Double? = nil, timeUtc: String? = nil,
                        footTimeUtc: String? = nil) -> ProfileSummit {
        ProfileSummit(name: name, km: km, altitude: nil, category: category,
                      side: nil, startKm: startKm, timeUtc: timeUtc, footTimeUtc: footTimeUtc)
    }

    private func waypoint(km: Double, name: String? = nil, type: String,
                          timeUtc: String? = nil) -> ProfileWaypoint {
        ProfileWaypoint(name: name, km: km, type: type, lengthKm: nil, timeUtc: timeUtc)
    }

    func test_startAndFinishAnchors() {
        let rows = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [], waypoints: [], primaryType: nil)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows.first?.type, "start")
        XCTAssertEqual(rows.first?.km, 0)
        XCTAssertEqual(rows.first?.kmToGo, 100)
        XCTAssertEqual(rows.last?.type, "finish")
        XCTAssertEqual(rows.last?.kmToGo, 0)
    }

    func test_interpolatesWaypointWithoutTime() {
        let rows = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [], waypoints: [waypoint(km: 50, type: "intermediate_sprint")],
            primaryType: nil)
        let sprint = rows.first { $0.type == "intermediate_sprint" }
        XCTAssertNotNil(sprint)
        XCTAssertTrue(sprint!.isEstimated)
        XCTAssertEqual(sprint!.timeUtc, "2026-04-26T11:10:00.000Z")
    }

    func test_manualSummitAnchorAndEstimatedFoot() {
        let summitTime = "2026-04-26T12:00:00.000Z"
        let rows = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [summit(km: 60, name: "Puerto", category: "1", startKm: 50, timeUtc: summitTime)],
            waypoints: [], primaryType: nil)
        let s = rows.first { $0.type == "summit" }
        XCTAssertEqual(s?.timeUtc, summitTime)
        XCTAssertEqual(s?.isEstimated, false)
        let foot = rows.first { $0.type == "climb_foot" }
        XCTAssertEqual(foot?.km, 50)
        XCTAssertTrue(foot!.isEstimated)
        XCTAssertEqual(foot?.timeUtc, "2026-04-26T11:20:00.000Z")
    }

    func test_footTimeUtcUsedAsRealAnchor() {
        let footTime = "2026-04-26T11:40:00.000Z"
        let summitTime = "2026-04-26T12:00:00.000Z"
        let rows = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [summit(km: 60, name: "Puerto", category: "1", startKm: 50,
                             timeUtc: summitTime, footTimeUtc: footTime)],
            waypoints: [], primaryType: nil)
        let foot = rows.first { $0.type == "climb_foot" }
        // Usa la hora real del rutómetro, NO la interpolación (que daría 11:20Z)
        XCTAssertEqual(foot?.timeUtc, footTime)
        XCTAssertEqual(foot?.isEstimated, false)
        XCTAssertTrue(SimplifiedGuide.hasGuide(rows))
    }

    func test_orderFootBeforeSummit() {
        let rows = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [summit(km: 60, name: "A", startKm: 50)],
            waypoints: [waypoint(km: 30, type: "intermediate_sprint")],
            primaryType: nil)
        XCTAssertEqual(rows.map { $0.type },
                       ["start", "intermediate_sprint", "climb_foot", "summit", "finish"])
    }

    func test_mergesSummitAndBonusOnlyAtExactDecimalKilometer() {
        let manualTime = "2026-04-26T12:00:00.000Z"
        let rows = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: nil, estimatedFinishTimeUtc: nil,
            summits: [summit(km: 60.5, name: "Puerto", category: "1")],
            waypoints: [
                waypoint(km: 60.5, name: "Bonificación", type: "bonus_sprint", timeUtc: manualTime),
                waypoint(km: 60.6, name: "Sprint", type: "intermediate_sprint"),
            ],
            primaryType: nil)
        let merged = rows.first { $0.type == "summit" }
        XCTAssertEqual(rows.filter { $0.km == 60.5 }.count, 1)
        XCTAssertEqual(merged?.secondaryType, "bonus_sprint")
        XCTAssertEqual(merged?.secondaryLabel, "Bonificación")
        XCTAssertEqual(merged?.timeUtc, manualTime)
        XCTAssertTrue(rows.contains { $0.km == 60.6 && $0.type == "intermediate_sprint" })
    }

    func test_mergesFinishWithSummitOrWaypointAtExactFinalKilometer() {
        let summitFinish = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: nil, estimatedFinishTimeUtc: finish,
            summits: [summit(km: 100, name: "Alto de meta", category: "1")],
            waypoints: [], primaryType: nil)
        XCTAssertEqual(summitFinish.count, 1)
        XCTAssertEqual(summitFinish[0].type, "summit")
        XCTAssertEqual(summitFinish[0].secondaryType, "finish")
        XCTAssertEqual(summitFinish[0].kmToGo, 0)
        XCTAssertEqual(summitFinish[0].timeUtc, finish)
        XCTAssertTrue(summitFinish[0].isEstimated)

        let waypointFinish = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: nil, estimatedFinishTimeUtc: finish,
            summits: [],
            waypoints: [waypoint(km: 100, name: "Sprint de meta", type: "bonus_sprint")],
            primaryType: nil)
        XCTAssertEqual(waypointFinish.count, 1)
        XCTAssertEqual(waypointFinish[0].type, "bonus_sprint")
        XCTAssertEqual(waypointFinish[0].secondaryType, "finish")
        XCTAssertEqual(waypointFinish[0].kmToGo, 0)
        XCTAssertEqual(waypointFinish[0].timeUtc, finish)
        XCTAssertTrue(waypointFinish[0].isEstimated)

        let withoutFinishTime = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: nil, estimatedFinishTimeUtc: nil,
            summits: [summit(km: 100, name: "Alto de meta", category: "1")],
            waypoints: [], primaryType: nil)
        XCTAssertEqual(withoutFinishTime.count, 1)
        XCTAssertEqual(withoutFinishTime[0].type, "summit")
        XCTAssertEqual(withoutFinishTime[0].secondaryType, "finish")
        XCTAssertNil(withoutFinishTime[0].timeUtc)
        XCTAssertTrue(withoutFinishTime[0].isEstimated)
    }

    func test_timeTrialNoInterpolation() {
        let splitTime = "2026-04-26T10:30:00.000Z"
        let rows = SimplifiedGuide.build(
            distanceKm: 40, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [],
            waypoints: [
                waypoint(km: 20, type: "intermediate_split", timeUtc: splitTime),
                waypoint(km: 10, type: "intermediate_sprint"),
                waypoint(km: 30, type: "intermediate_split"),
            ],
            primaryType: "itt")
        XCTAssertNil(rows.first { $0.type == "intermediate_sprint" })
        XCTAssertEqual(rows.first { $0.km == 20 }?.timeUtc, splitTime)
        XCTAssertNil(rows.first { $0.km == 30 }?.timeUtc)
    }

    func test_noDistanceOmitsFinishAndKmToGo() {
        let rows = SimplifiedGuide.build(
            distanceKm: nil, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [], waypoints: [waypoint(km: 20, type: "intermediate_sprint")],
            primaryType: nil)
        XCTAssertNil(rows.first { $0.type == "finish" })
        XCTAssertTrue(rows.allSatisfy { $0.kmToGo == nil })
    }

    func test_excludesKomAndSplitOnRoadStage() {
        let rows = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [],
            waypoints: [
                waypoint(km: 10, type: "kom"),
                waypoint(km: 20, type: "intermediate_split"),
                waypoint(km: 30, name: "Pavé", type: "cobblestone"),
            ],
            primaryType: nil)
        XCTAssertNil(rows.first { $0.type == "kom" })
        XCTAssertNil(rows.first { $0.type == "intermediate_split" })
        XCTAssertNotNil(rows.first { $0.type == "cobblestone" })
    }

    func test_hasGuide() {
        // opt-in: requiere ≥1 hora manual en un punto intermedio
        let onlyEnds = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [], waypoints: [], primaryType: nil)
        XCTAssertFalse(SimplifiedGuide.hasGuide(onlyEnds))

        // Solo interpolado → NO se muestra
        let interpolatedOnly = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [], waypoints: [waypoint(km: 50, type: "intermediate_sprint")],
            primaryType: nil)
        XCTAssertFalse(SimplifiedGuide.hasGuide(interpolatedOnly))

        // Con una hora manual del rutómetro → se muestra
        let withManual = SimplifiedGuide.build(
            distanceKm: 100, neutralStartTimeUtc: start, estimatedFinishTimeUtc: finish,
            summits: [],
            waypoints: [waypoint(km: 50, type: "intermediate_sprint", timeUtc: "2026-04-26T11:00:00.000Z")],
            primaryType: nil)
        XCTAssertTrue(SimplifiedGuide.hasGuide(withManual))
    }
}
