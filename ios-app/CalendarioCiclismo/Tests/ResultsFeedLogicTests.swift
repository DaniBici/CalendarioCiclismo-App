import XCTest
@testable import CalendarioCiclismo

/// Construcción de entradas del feed de resultados: deduplicación de la general
/// final de un día, emparejamiento de la clasificación con su jornada, fechas
/// con stageDate NULL, filtro de ventana y reparto de categorías CX por día.
final class ResultsFeedLogicTests: XCTestCase {

    // Ventana por defecto de los tests.
    private let fromKey = "2026-06-01"
    private let toKey = "2026-06-10"

    // MARK: - Helpers

    private func makeRace(
        id: String,
        name: String,
        raceFormat: String = "stage_race",
        startDate: String? = nil,
        endDate: String? = nil,
        uciCategory: String? = "2.UWT",
        gender: String? = nil,
        countryCode: String? = nil,
        isGrandTour: Bool = false
    ) -> Race {
        Race(
            id: id,
            name: name,
            nameEn: nil,
            uciCategory: uciCategory,
            gender: gender,
            raceFormat: raceFormat,
            countryCode: countryCode,
            colorHex: nil,
            logoUrl: nil,
            websiteUrl: nil,
            hideFlag: false,
            isGrandTour: isGrandTour,
            isCancelled: false,
            startDate: startDate,
            endDate: endDate,
            year: 2026,
            slug: nil,
            originalName: nil,
            startlistImportedAt: nil,
            startlistProvisional: nil
        )
    }

    private func makeRaceDay(
        id: String,
        raceId: String,
        dateKey: String,
        stageNumber: Int? = 1,
        neutralStartTimeUtc: String? = nil,
        isRestDay: Bool = false,
        isCancelledDay: Bool = false,
        primaryType: String? = nil,
        countryCode: String? = nil
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
            estimatedFinishTimeUtc: nil,
            tvStatus: nil,
            description: nil,
            bonuses: nil,
            notes: nil,
            editorialStatus: "published",
            hasAssets: false,
            updatedAt: nil,
            countryCode: countryCode
        )
    }

    private func makeStage(
        id: String,
        raceId: String,
        classKind: String,
        stageNumber: Int? = nil,
        raceDayId: String? = nil,
        stageDate: String? = nil,
        winnerName: String? = nil,
        isFinal: Bool = false
    ) -> RaceUciStage {
        RaceUciStage(
            id: id,
            raceId: raceId,
            raceDayId: raceDayId,
            classKind: classKind,
            stageNumber: stageNumber,
            isFinalClassification: isFinal,
            keepForWeb: true,
            rowCount: 10,
            stageDate: stageDate,
            winnerName: winnerName
        )
    }

    private func build(
        stages: [RaceUciStage],
        raceDays: [RaceDay] = [],
        races: [Race]
    ) -> [FeedEntry] {
        ResultsFeedLogic.buildEntries(
            stages: stages,
            raceDays: raceDays,
            races: races,
            fromKey: fromKey,
            toKey: toKey
        )
    }

    // MARK: - Pruebas de un día

    func testUnDiaPrefiereGcFinalSobreLaFilaStage() {
        let race = makeRace(id: "O", name: "Clásica", raceFormat: "one_day", startDate: "2026-06-05")
        let sStage = makeStage(id: "s1", raceId: "O", classKind: "stage", stageDate: "2026-06-05", winnerName: "Ganadora Etapa")
        let sFinal = makeStage(id: "s2", raceId: "O", classKind: "gc", stageDate: "2026-06-05", winnerName: "Ganadora Final", isFinal: true)

        // Orden stage → gc final: la final actualiza la entrada existente.
        let entries = build(stages: [sStage, sFinal], races: [race])
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].winner, "Ganadora Final")
        XCTAssertEqual(entries[0].stageRefId, "s2")
        XCTAssertNil(entries[0].stageNumber)        // un día: sin etiqueta de etapa
        XCTAssertFalse(entries[0].isGcFinal)        // un día: SIN etiqueta "General final"

        // Orden gc final → stage: la fila stage redundante se ignora.
        let reversed = build(stages: [sFinal, sStage], races: [race])
        XCTAssertEqual(reversed.count, 1)
        XCTAssertEqual(reversed[0].winner, "Ganadora Final")
        XCTAssertEqual(reversed[0].stageRefId, "s2")
    }

    func testGcNoFinalDeUnDiaSeIgnora() {
        // "Stage General Classification" (GC del día) en un día → no es entrada.
        let race = makeRace(id: "O", name: "Clásica", raceFormat: "one_day", startDate: "2026-06-05")
        let gcDelDia = makeStage(id: "s1", raceId: "O", classKind: "gc", stageNumber: 1, stageDate: "2026-06-05", winnerName: "X")
        let entries = build(stages: [gcDelDia], races: [race])
        XCTAssertTrue(entries.isEmpty)
    }

    // MARK: - Override de país por jornada sin raceDayId en la clasificación

    func testEtapaSinRaceDayIdResuelveJornadaPorStageNumber() {
        // Giro della Valle d'Aosta: carrera italiana, et1 disputada en Francia.
        // El volcado in-house NO trajo raceDayId → la jornada (countryCode='FR')
        // se resuelve por stageNumber; sin ello la bandera caería al país de la carrera.
        let race = makeRace(id: "aosta", name: "Valle d'Aosta", raceFormat: "stage_race", uciCategory: "2.2U")
        let stages = [
            makeStage(id: "s1", raceId: "aosta", classKind: "stage", stageNumber: 1, raceDayId: nil, stageDate: "2026-06-03"),
            makeStage(id: "s2", raceId: "aosta", classKind: "stage", stageNumber: 2, raceDayId: nil, stageDate: "2026-06-04"),
        ]
        let days = [
            makeRaceDay(id: "d1", raceId: "aosta", dateKey: "2026-06-03", stageNumber: 1, countryCode: "FR"),
            makeRaceDay(id: "d2", raceId: "aosta", dateKey: "2026-06-04", stageNumber: 2, countryCode: "IT"),
        ]
        let entries = build(stages: stages, raceDays: days, races: [race])
        let e1 = entries.first { $0.stageNumber == 1 }
        let e2 = entries.first { $0.stageNumber == 2 }
        XCTAssertEqual(e1?.rd?.id, "d1")
        XCTAssertEqual(e1?.rd?.countryCode, "FR")
        XCTAssertEqual(e2?.rd?.countryCode, "IT")
    }

    func testRaceDayIdPresenteGanaAlFallbackPorStageNumber() {
        let race = makeRace(id: "x", name: "X", raceFormat: "stage_race", uciCategory: "2.1")
        let stages = [makeStage(id: "s1", raceId: "x", classKind: "stage", stageNumber: 1, raceDayId: "real", stageDate: "2026-06-03")]
        let days = [
            makeRaceDay(id: "real", raceId: "x", dateKey: "2026-06-03", stageNumber: 1, countryCode: "FR"),
            makeRaceDay(id: "decoy", raceId: "x", dateKey: "2026-06-03", stageNumber: 1, countryCode: "IT"),
        ]
        let entries = build(stages: stages, raceDays: days, races: [race])
        XCTAssertEqual(entries.first?.rd?.id, "real")
    }

    func testDobleSectorConserva1AY1BConSuGanadorYRutaPropios() {
        let race = makeRace(id: "baltic", name: "Baltic Chain Tour")
        let days = [
            makeRaceDay(id: "baltic-1a", raceId: "baltic", dateKey: "2026-06-03", stageNumber: 1,
                        neutralStartTimeUtc: "2026-06-03T08:00:00Z"),
            makeRaceDay(id: "baltic-1b", raceId: "baltic", dateKey: "2026-06-03", stageNumber: 1,
                        neutralStartTimeUtc: "2026-06-03T12:00:00Z"),
        ]
        let stages = [
            makeStage(id: "stage-1b", raceId: "baltic", classKind: "stage", stageNumber: 1,
                      raceDayId: "baltic-1b", stageDate: "2026-06-03", winnerName: "Romet Pajur"),
            makeStage(id: "stage-1a", raceId: "baltic", classKind: "stage", stageNumber: 1,
                      raceDayId: "baltic-1a", stageDate: "2026-06-03", winnerName: "Estonia"),
        ]

        let entries = build(stages: stages, raceDays: days, races: [race])

        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries.map(\.key), ["baltic#1A", "baltic#1B"])
        XCTAssertEqual(entries.map(\.stageSuffix), ["A", "B"])
        XCTAssertEqual(entries.map(\.winner), ["Estonia", "Romet Pajur"])
        XCTAssertEqual(entries.map { $0.rd?.id }, ["baltic-1a", "baltic-1b"])
    }

    func testUnaClasificacionEnlazadaNoCreaFallbackDelSectorHermano() {
        let race = makeRace(id: "baltic", name: "Baltic Chain Tour")
        let days = [
            makeRaceDay(id: "baltic-1a", raceId: "baltic", dateKey: "2026-06-03", stageNumber: 1,
                        neutralStartTimeUtc: "2026-06-03T08:00:00Z"),
            makeRaceDay(id: "baltic-1b", raceId: "baltic", dateKey: "2026-06-03", stageNumber: 1,
                        neutralStartTimeUtc: "2026-06-03T12:00:00Z"),
        ]
        let stages = [
            makeStage(id: "stage-1a", raceId: "baltic", classKind: "stage", stageNumber: 1,
                      raceDayId: "baltic-1a", stageDate: "2026-06-03", winnerName: "Estonia"),
        ]

        let entries = build(stages: stages, raceDays: days, races: [race])

        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries.map(\.kind), [.inhouse])
        XCTAssertEqual(entries.map(\.stageSuffix), ["A"])
    }

    // MARK: - Resolución de fechas (stageDate NULL — volcados PDF)

    func testFechaConStageDateNilSeResuelvePorJornada() {
        let race = makeRace(id: "R", name: "Vuelta R")
        let rd = makeRaceDay(id: "rdX", raceId: "R", dateKey: "2026-06-03", stageNumber: 2)
        let s = makeStage(id: "s1", raceId: "R", classKind: "stage", stageNumber: 2, raceDayId: "rdX", winnerName: "W")
        let entries = build(stages: [s], raceDays: [rd], races: [race])
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].date, "2026-06-03")
    }

    func testFechaConStageDateNilSeResuelvePorFechasDeCarrera() {
        // Un día sin raceDayId → startDate de la carrera.
        let oneDay = makeRace(id: "O", name: "Clásica", raceFormat: "one_day", startDate: "2026-06-04")
        let sOneDay = makeStage(id: "s1", raceId: "O", classKind: "stage", winnerName: "W")
        let e1 = build(stages: [sOneDay], races: [oneDay])
        XCTAssertEqual(e1.count, 1)
        XCTAssertEqual(e1[0].date, "2026-06-04")

        // General final de vuelta sin raceDayId → endDate de la carrera.
        let tour = makeRace(id: "R", name: "Vuelta R", endDate: "2026-06-06")
        let sFinal = makeStage(id: "s2", raceId: "R", classKind: "gc", winnerName: "W", isFinal: true)
        let e2 = build(stages: [sFinal], races: [tour])
        XCTAssertEqual(e2.count, 1)
        XCTAssertEqual(e2[0].date, "2026-06-06")
        XCTAssertTrue(e2[0].isGcFinal)
    }

    func testFiltroDeVentanaSeAplicaTrasResolverLaFecha() {
        // La fecha resuelta (vía jornada) cae FUERA del rango → la entrada no entra,
        // aunque su stageDate NULL pasara el filtro del servidor.
        let race = makeRace(id: "R", name: "Vuelta R")
        let rdFuera = makeRaceDay(id: "rdY", raceId: "R", dateKey: "2026-05-01", stageNumber: 1)
        let s = makeStage(id: "s1", raceId: "R", classKind: "stage", stageNumber: 1, raceDayId: "rdY", winnerName: "W")
        let entries = build(stages: [s], raceDays: [rdFuera], races: [race])
        XCTAssertTrue(entries.isEmpty)

        // Un día cuya startDate queda fuera → tampoco entra.
        let oneDay = makeRace(id: "O", name: "Clásica", raceFormat: "one_day", startDate: "2026-05-02")
        let sOneDay = makeStage(id: "s2", raceId: "O", classKind: "stage", winnerName: "W")
        XCTAssertTrue(build(stages: [sOneDay], races: [oneDay]).isEmpty)
    }

    // MARK: - Solo clasificaciones propias

    func testSinClasificacionPropiaNoCreaEntrada() {
        let race = makeRace(id: "R", name: "Vuelta R")
        let rd = makeRaceDay(id: "rd1", raceId: "R", dateKey: "2026-06-03", stageNumber: 5)

        XCTAssertTrue(build(stages: [], raceDays: [rd], races: [race]).isEmpty)
    }

    func testLaClasificacionPropiaSigueGenerandoSuEntrada() {
        let race = makeRace(id: "R", name: "Vuelta R")
        let rd = makeRaceDay(id: "rd1", raceId: "R", dateKey: "2026-06-03", stageNumber: 5)
        let s = makeStage(id: "s1", raceId: "R", classKind: "stage", stageNumber: 5, raceDayId: "rd1", winnerName: "W")
        let entries = build(stages: [s], raceDays: [rd], races: [race])
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].kind, .inhouse)

        let oneDay = makeRace(id: "O", name: "Clásica", raceFormat: "one_day", startDate: "2026-06-05")
        let rdO = makeRaceDay(id: "rdO", raceId: "O", dateKey: "2026-06-05", stageNumber: 1)
        let sO = makeStage(id: "s2", raceId: "O", classKind: "gc", stageDate: "2026-06-05", winnerName: "W", isFinal: true)
        let covered = build(stages: [sO], raceDays: [rdO], races: [oneDay])
        XCTAssertEqual(covered.count, 1)
        XCTAssertEqual(covered[0].kind, .inhouse)
    }

    // MARK: - Resultados de ciclocross

    private func cxRace(
        _ id: String,
        raceClass: String = "C2",
        season: String = "2026-27",
        cancelled: Bool = false,
        categories: [(code: String, date: String, status: String, winner: String?, cancelled: Bool)]
    ) throws -> CxRace {
        let rows = categories.enumerated().map { index, category -> [String: Any] in
            var row: [String: Any] = [
                "category": category.code, "dateKey": category.date, "sortOrder": index,
                "isCancelled": category.cancelled, "resultsStatus": category.status,
                "startTimeUtc": category.date + "T12:00:00Z"
            ]
            if let winner = category.winner { row["winnerName"] = winner }
            return row
        }
        let payload: [String: Any] = [
            "id": id, "name": id, "slug": id, "seasonKey": season,
            "dateKey": categories.first?.date ?? "2026-11-01", "class": raceClass,
            "isCancelled": cancelled, "cx_race_categories": rows
        ]
        return try JSONDecoder().decode(CxRace.self, from: JSONSerialization.data(withJSONObject: payload))
    }

    func testFeedCxAgrupaPorDiaYCategoria() throws {
        let sat = "2026-11-21", sun = "2026-11-22"
        let twoDays = try cxRace("Dos días", categories: [
            ("WJ", sun, "official", "Júnior", false),
            ("ME", sun, "provisional", "Élite", false),
            ("MU", sun, "pending", nil, false),
            ("WE", sat, "official", "Élite femenina", false)
        ])
        let worldCup = try cxRace("Copa", raceClass: "CDM", categories: [("ME", sun, "official", "Ganador", false)])
        let races = [
            twoDays, worldCup, twoDays,
            try cxRace("Sin ganador", categories: [("ME", sun, "official", " ", false)]),
            try cxRace("Categoría cancelada", categories: [("ME", sun, "official", "X", true)]),
            try cxRace("Cancelada", cancelled: true, categories: [("ME", sun, "official", "X", false)]),
            try cxRace("Otra temporada", season: "2025-26", categories: [("ME", sun, "official", "X", false)])
        ]
        let days = CxResultsFeedLogic.days(races: races, season: "2026-27")
        XCTAssertEqual(days.map(\.date), [sun, sat])
        XCTAssertEqual(days[0].entries.map(\.race.id), ["Copa", "Dos días"])
        XCTAssertEqual(days[0].entries[1].winners, [
            CxResultsFeedWinner(category: "ME", winner: "Élite"),
            CxResultsFeedWinner(category: "WJ", winner: "Júnior")
        ])
        XCTAssertEqual(days[0].entries[1].resultsAnchor, "resultados-ME")
        XCTAssertEqual(days[1].entries.map(\.race.id), ["Dos días"])
        XCTAssertEqual(days[1].entries[0].winners.map(\.category), ["WE"])
    }
}
