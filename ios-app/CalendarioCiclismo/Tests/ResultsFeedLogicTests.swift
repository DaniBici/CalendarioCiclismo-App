import XCTest
@testable import CalendarioCiclismo

/// Port de los casos clave de `js/resultados-feed.js` vía `ResultsFeedLogicTest`
/// (Android): construcción de entradas (un día / generales finales / fallback),
/// resolución de fechas con stageDate NULL, filtro de ventana, cleanWinner y la
/// adyacencia de la general final con su etapa cuando varias vueltas acaban el
/// mismo día (la hora POR CARRERA-DÍA es la que la garantiza). Paridad 1:1 con
/// la suite de Android.
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
        isGrandTour: Bool = false,
        fcId: Int? = nil,
        pcsSlug: String? = nil
    ) -> Race {
        Race(
            id: id,
            name: name,
            nameEn: nil,
            abbrev: nil,
            uciCategory: uciCategory,
            gender: gender,
            raceFormat: raceFormat,
            countryCode: countryCode,
            colorHex: nil,
            logoUrl: nil,
            websiteUrl: nil,
            fcId: fcId,
            pcsSlug: pcsSlug,
            hideFlag: false,
            isGrandTour: isGrandTour,
            isCancelled: false,
            startDate: startDate,
            endDate: endDate,
            year: 2026,
            slug: nil,
            originalName: nil,
            startlistImportedAt: nil,
            startlistProvisional: nil,
            enrichedStartlist: nil
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
        races: [Race],
        isConcluded: (RaceDay, Race) -> Bool = { _, _ in false }
    ) -> [FeedEntry] {
        ResultsFeedLogic.buildEntries(
            stages: stages,
            raceDays: raceDays,
            races: races,
            fromKey: fromKey,
            toKey: toKey,
            isConcluded: isConcluded
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

    // MARK: - Generales finales de vueltas

    func testGeneralFinalDelanteDeSuEtapaYAdyacenciaConVariasVueltas() {
        // Dos vueltas idénticas en rango acaban el MISMO día; el desempate es la
        // hora POR CARRERA-DÍA. Las generales (sin rd) heredan la hora de su
        // carrera: sin esa precomputación compararían 999999 contra la hora real
        // de la otra carrera y los bloques se entrelazarían (este test fallaría).
        let raceA = makeRace(id: "A", name: "Vuelta A", endDate: "2026-06-07")
        let raceB = makeRace(id: "B", name: "Vuelta B", endDate: "2026-06-07")
        let rdA = makeRaceDay(id: "rdA", raceId: "A", dateKey: "2026-06-07", stageNumber: 8, neutralStartTimeUtc: "2026-06-07T08:00:00Z")
        let rdB = makeRaceDay(id: "rdB", raceId: "B", dateKey: "2026-06-07", stageNumber: 8, neutralStartTimeUtc: "2026-06-07T10:00:00Z")
        let stages = [
            makeStage(id: "a8", raceId: "A", classKind: "stage", stageNumber: 8, raceDayId: "rdA", stageDate: "2026-06-07", winnerName: "Wa"),
            makeStage(id: "agc", raceId: "A", classKind: "gc", stageDate: "2026-06-07", winnerName: "GCa", isFinal: true),
            makeStage(id: "b8", raceId: "B", classKind: "stage", stageNumber: 8, raceDayId: "rdB", stageDate: "2026-06-07", winnerName: "Wb"),
            makeStage(id: "bgc", raceId: "B", classKind: "gc", stageDate: "2026-06-07", winnerName: "GCb", isFinal: true),
        ]
        let entries = build(stages: stages, raceDays: [rdA, rdB], races: [raceA, raceB])

        XCTAssertEqual(entries.map(\.key), ["A#gcfinal", "A#8", "B#gcfinal", "B#8"])
        // La general final va marcada y POR DELANTE (subOrder 0 < 1).
        XCTAssertTrue(entries[0].isGcFinal)
        XCTAssertEqual(entries[0].subOrder, 0)
        XCTAssertEqual(entries[1].subOrder, 1)
        // Hora por carrera-día: la general hereda la hora de la etapa de su carrera.
        XCTAssertEqual(entries[0].sortTime, entries[1].sortTime)
        XCTAssertLessThan(entries[0].sortTime, entries[2].sortTime)
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

    // MARK: - cleanWinner

    func testCleanWinnerFiltraEtapasCanceladas() {
        // La UCI publica las etapas canceladas con una pseudo-fila "Cancelled
        // Race" como ganadora → sin trofeo.
        XCTAssertEqual(ResultsFeedLogic.cleanWinner("Race Cancelled"), "")
        XCTAssertEqual(ResultsFeedLogic.cleanWinner("Cancelled Race"), "")
        XCTAssertEqual(ResultsFeedLogic.cleanWinner("CANCELLED"), "")
        XCTAssertEqual(ResultsFeedLogic.cleanWinner(nil), "")
        XCTAssertEqual(ResultsFeedLogic.cleanWinner("Tadej Pogacar"), "Tadej Pogacar")

        let race = makeRace(id: "R", name: "Vuelta R")
        let rd = makeRaceDay(id: "rd1", raceId: "R", dateKey: "2026-06-03", stageNumber: 2)
        let s = makeStage(id: "s1", raceId: "R", classKind: "stage", stageNumber: 2, raceDayId: "rd1", winnerName: "Race Cancelled")
        let entries = build(stages: [s], raceDays: [rd], races: [race])
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].winner, "")
    }

    // MARK: - Fallback FC/PCS

    func testFallbackFcPcsCreaEntradaExtSoloSinInhouseYConcluida() {
        let race = makeRace(id: "R", name: "Vuelta R", fcId: 99)
        let rd = makeRaceDay(id: "rd1", raceId: "R", dateKey: "2026-06-03", stageNumber: 5)

        // Concluida y sin volcado in-house → entrada EXT.
        let ext = build(stages: [], raceDays: [rd], races: [race], isConcluded: { _, _ in true })
        XCTAssertEqual(ext.count, 1)
        XCTAssertEqual(ext[0].kind, .ext)
        XCTAssertEqual(ext[0].date, "2026-06-03")
        XCTAssertEqual(ext[0].stageNumber, 5)
        XCTAssertNotNil(ext[0].rd)

        // No concluida → nada.
        XCTAssertTrue(build(stages: [], raceDays: [rd], races: [race], isConcluded: { _, _ in false }).isEmpty)

        // Sin fcId/pcsSlug → nada.
        let sinIds = makeRace(id: "R2", name: "Vuelta R2")
        let rd2 = makeRaceDay(id: "rd2", raceId: "R2", dateKey: "2026-06-03", stageNumber: 5)
        XCTAssertTrue(build(stages: [], raceDays: [rd2], races: [sinIds], isConcluded: { _, _ in true }).isEmpty)

        // Día de descanso → nada.
        let rdRest = makeRaceDay(id: "rd3", raceId: "R", dateKey: "2026-06-04", stageNumber: nil, isRestDay: true)
        XCTAssertTrue(build(stages: [], raceDays: [rdRest], races: [race], isConcluded: { _, _ in true }).isEmpty)
    }

    func testFallbackNoDuplicaJornadasConInhouse() {
        // La etapa con volcado in-house NO genera además la fila EXT.
        let race = makeRace(id: "R", name: "Vuelta R", fcId: 99)
        let rd = makeRaceDay(id: "rd1", raceId: "R", dateKey: "2026-06-03", stageNumber: 5)
        let s = makeStage(id: "s1", raceId: "R", classKind: "stage", stageNumber: 5, raceDayId: "rd1", winnerName: "W")
        let entries = build(stages: [s], raceDays: [rd], races: [race], isConcluded: { _, _ in true })
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].kind, .inhouse)

        // Un día cubierto por su entrada única → tampoco genera EXT, y la
        // entrada EXT de un día va sin etiqueta de etapa (stageNumber nil).
        let oneDay = makeRace(id: "O", name: "Clásica", raceFormat: "one_day", startDate: "2026-06-05", fcId: 7)
        let rdO = makeRaceDay(id: "rdO", raceId: "O", dateKey: "2026-06-05", stageNumber: 1)
        let sO = makeStage(id: "s2", raceId: "O", classKind: "gc", stageDate: "2026-06-05", winnerName: "W", isFinal: true)
        let covered = build(stages: [sO], raceDays: [rdO], races: [oneDay], isConcluded: { _, _ in true })
        XCTAssertEqual(covered.count, 1)
        XCTAssertEqual(covered[0].kind, .inhouse)

        let extOneDay = build(stages: [], raceDays: [rdO], races: [oneDay], isConcluded: { _, _ in true })
        XCTAssertEqual(extOneDay.count, 1)
        XCTAssertEqual(extOneDay[0].kind, .ext)
        XCTAssertNil(extOneDay[0].stageNumber)
    }

    // MARK: - Orden de Campeonatos Nacionales (país → línea/CRI)

    func testDosCampeonatosNacionalesSeOrdenanPorPaisYLineaCri() {
        // Espec Dani: país (COUNTRY_ORDER) → línea masc/fem/sub23m/sub23f →
        // CRI masc/fem/sub23m/sub23f. Las CN son de un día; cada una entra como
        // gc final con su jornada (rd) → compareEntries aplica el orden. Mezcla
        // desordenada de ES (top-6), Francia y Gran Bretaña el mismo día.
        func cn(_ id: String, _ name: String, _ cc: String, _ gender: String) -> Race {
            makeRace(id: id, name: name, raceFormat: "one_day", startDate: "2026-06-05",
                     uciCategory: "CN", gender: gender, countryCode: cc)
        }
        let races = [
            cn("es-cri-f",     "Campeonato de España CRI femenino",          "ES", "female"),
            cn("fr-linea-m",   "Campeonato de Francia línea masculino",      "FR", "male"),
            cn("es-linea-m",   "Campeonato de España línea masculino",       "ES", "male"),
            cn("es-cri-m",     "Campeonato de España CRI masculino",         "ES", "male"),
            cn("gb-linea-f",   "Campeonato de Gran Bretaña línea femenino",   "GB", "female"),
            cn("es-linea-f",   "Campeonato de España línea femenino",        "ES", "female"),
            cn("es-cri-s23m",  "Campeonato de España CRI sub23 masculino",   "ES", "male"),
            cn("es-linea-s23m","Campeonato de España línea sub23 masculino", "ES", "male"),
        ]
        let stages = races.map {
            makeStage(id: "st-\($0.id)", raceId: $0.id, classKind: "gc",
                      stageDate: "2026-06-05", winnerName: "W", isFinal: true)
        }
        let rds = races.map {
            makeRaceDay(id: "rd-\($0.id)", raceId: $0.id, dateKey: "2026-06-05", stageNumber: nil)
        }
        let entries = build(stages: stages, raceDays: rds, races: races)
        XCTAssertEqual(
            entries.map(\.race.id),
            [
                // España (top-6): toda la línea antes que toda la CRI; dentro de
                // cada bloque, masc → fem → sub23 masc → sub23 fem.
                "es-linea-m", "es-linea-f", "es-linea-s23m",
                "es-cri-m", "es-cri-f", "es-cri-s23m",
                // Luego Francia, luego Gran Bretaña (orden de COUNTRY_ORDER).
                "fr-linea-m", "gb-linea-f",
            ]
        )
    }

    // MARK: - Orden cronológico inverso

    func testCronologiaInversaEntreDias() {
        let race = makeRace(id: "R", name: "Vuelta R")
        let rd1 = makeRaceDay(id: "rd1", raceId: "R", dateKey: "2026-06-02", stageNumber: 1)
        let rd2 = makeRaceDay(id: "rd2", raceId: "R", dateKey: "2026-06-03", stageNumber: 2)
        let stages = [
            makeStage(id: "s1", raceId: "R", classKind: "stage", stageNumber: 1, raceDayId: "rd1", winnerName: "W1"),
            makeStage(id: "s2", raceId: "R", classKind: "stage", stageNumber: 2, raceDayId: "rd2", winnerName: "W2"),
        ]
        let entries = build(stages: stages, raceDays: [rd1, rd2], races: [race])
        XCTAssertEqual(entries.map(\.date), ["2026-06-03", "2026-06-02"])
    }

    // MARK: - Ventana de carga

    func testVentanaInicialYCargarMas() {
        XCTAssertEqual(ResultsFeedLogic.initialFromKey(todayKey: "2026-06-14"), "2026-06-01")
        // Nunca antes del arranque de temporada.
        XCTAssertEqual(ResultsFeedLogic.initialFromKey(todayKey: "2026-01-05"), "2026-01-01")
        XCTAssertEqual(ResultsFeedLogic.extendedFromKey("2026-06-01"), "2026-05-18")
        XCTAssertEqual(ResultsFeedLogic.extendedFromKey("2026-01-10"), "2026-01-01")
    }
}
