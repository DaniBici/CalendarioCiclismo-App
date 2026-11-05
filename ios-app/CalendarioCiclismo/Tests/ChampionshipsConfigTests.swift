import XCTest
@testable import CalendarioCiclismo

final class ChampionshipsConfigTests: XCTestCase {

    // MARK: - Clasificación de slot (espejo de championshipSlot web)

    func test_slot() {
        let cases: [(name: String, gender: String?, primaryType: String?, slot: ChampionshipsConfig.Slot)] = [
            ("Campeonato de España de ruta", nil, nil, .lineaMasc),
            ("Campeonato de España CRI", nil, nil, .criMasc),
            ("Campeonato Nacional contrarreloj", nil, nil, .criMasc),
            ("Campeonato de Francia femenino", nil, nil, .lineaFem),
            ("Championnat de France", "female", nil, .lineaFem),
            ("Campeonato de Italia sub-23", nil, nil, .lineaSub23M),
            ("Campeonato U23 CRI femenino", nil, nil, .criSub23F),
            ("Campeonato de Bélgica", nil, "itt", .criMasc),
            // Nombre dice "línea" → ruta, aunque primaryType sea itt.
            ("Campeonato de Bélgica en línea", nil, "itt", .lineaMasc),
        ]
        for c in cases {
            let race = makeRace(name: c.name, gender: c.gender)
            XCTAssertEqual(ChampionshipsConfig.slot(race: race, rd: makeRaceDay(primaryType: c.primaryType)), c.slot, c.name)
        }
    }

    // MARK: - Helpers

    private func makeRace(name: String, gender: String? = nil, country: String = "ES") -> Race {
        Race(
            id: UUID().uuidString, name: name, nameEn: nil,
            uciCategory: "CN", gender: gender, raceFormat: "one_day",
            countryCode: country, colorHex: nil, logoUrl: nil, websiteUrl: nil,
            hideFlag: false, isGrandTour: false,
            isCancelled: false, startDate: "2026-06-27", endDate: "2026-06-27",
            year: 2026, slug: nil, originalName: nil, startlistImportedAt: nil,
            startlistProvisional: nil
        )
    }

    private func makeRaceDay(primaryType: String? = nil) -> RaceDay {
        RaceDay(
            id: UUID().uuidString, raceId: nil, dateKey: "2026-06-27", slug: nil,
            isRestDay: false, isCancelledDay: false, stageNumber: nil,
            startLocation: nil, finishLocation: nil, distanceKm: nil,
            primaryType: primaryType, secondaryType: nil,
            neutralStartTimeUtc: nil, estimatedFinishTimeUtc: nil,
            tvStatus: nil, description: nil, bonuses: nil, notes: nil,
            editorialStatus: "published", hasAssets: false,
            updatedAt: nil, countryCode: nil
        )
    }
}
