import XCTest
@testable import CalendarioCiclismo

/// Port de los casos clave de `js/resultados.js` vía `UciResultsLogicTest.kt`
/// (Android): normalización de tiempos/gaps, puntos, IRM, y el colapso de CRE
/// (variantes A y B). Paridad 1:1 con la suite de Android.
final class UciResultsLogicTests: XCTestCase {

    // Helper: fila de resultado con lo mínimo.
    private func row(
        rank: Int? = nil,
        bib: String? = nil,
        timeText: String? = nil,
        gapText: String? = nil,
        points: Int? = nil,
        uciPoints: Double? = nil,
        resultValue: String? = nil,
        irm: String? = nil,
        riderDisplay: String? = nil,
        globalRiderId: String? = nil,
        teamId: String? = nil,
        sortOrder: Int = 0
    ) -> RaceUciResultRow {
        RaceUciResultRow(
            stageRef: "s", raceId: "r", rank: rank, rankText: nil, bib: bib,
            riderDisplay: riderDisplay, globalRiderId: globalRiderId, teamId: teamId,
            resultValue: resultValue,
            timeText: timeText, gapText: gapText, points: points, uciPoints: uciPoints, irm: irm,
            sortOrder: sortOrder
        )
    }

    func testLosPuntosUCISePropaganSinMezclarseConLosPuntosDeLaClasificacion() {
        let individual = UciResultsLogic.buildIndividualRows(
            rows: [row(rank: 1, points: 50, uciPoints: 125.0)],
            classKind: "points",
            isTeams: false,
            byDorsal: [:],
            isEn: false
        ).first!
        XCTAssertEqual(individual.valueText, "50")
        XCTAssertEqual(individual.uciPoints, 125.0)

        let ttt = UciResultsLogic.collapseTtt(
            rows: [
                row(rank: 1, bib: "1", timeText: "20:00", uciPoints: 12.5),
                row(bib: "2", timeText: "20:10", uciPoints: 12.5),
            ],
            byDorsal: [:],
            isEn: false
        ).first!
        XCTAssertEqual(ttt.uciPoints, 12.5)
        XCTAssertEqual(ttt.riders.map(\.uciPoints), [12.5, 12.5])
    }

    // Helper: equipo canónico con lo mínimo (chapa irrelevante para la lógica).
    private func team(_ id: String, _ name: String, aliases: String? = nil) -> Team {
        Team(
            id: id, name: name, badgeTorsoCenter: "#000000", badgeTorsoSides: "#000000",
            badgeShorts: "#000000", badgeInnerCircle: nil, headerBg: "#000000",
            headerText: "#ffffff", nameAliases: aliases
        )
    }

    // ── timeToSeconds / secondsToGap / formatGap ───────────────────

    func testTimeToSecondsParseaLosTresFormatos() {
        XCTAssertEqual(UciResultsLogic.timeToSeconds("41"), 41)
        XCTAssertEqual(UciResultsLogic.timeToSeconds("1:56"), 116)
        XCTAssertEqual(UciResultsLogic.timeToSeconds("1:02:41"), 3761)
        XCTAssertNil(UciResultsLogic.timeToSeconds(nil))
        XCTAssertNil(UciResultsLogic.timeToSeconds("abc"))
        XCTAssertNil(UciResultsLogic.timeToSeconds(""))
    }

    func testSecondsToGapUsaLaConvencionDePrensa() {
        XCTAssertEqual(UciResultsLogic.secondsToGap(7), "+7\"")
        XCTAssertEqual(UciResultsLogic.secondsToGap(98), "+1'38\"")
        XCTAssertEqual(UciResultsLogic.secondsToGap(3761), "+1:02:41")
        XCTAssertNil(UciResultsLogic.secondsToGap(nil as Int?))
        XCTAssertNil(UciResultsLogic.secondsToGap(-3))
    }

    func testFormatGapNormalizaGapsUciCrudos() {
        XCTAssertEqual(UciResultsLogic.formatGap("+41"), "+41\"")
        XCTAssertEqual(UciResultsLogic.formatGap("+1:56"), "+1'56\"")
        XCTAssertEqual(UciResultsLogic.formatGap("+35:09"), "+35'09\"")
        // Ya formateado → intacto.
        XCTAssertEqual(UciResultsLogic.formatGap("+1'38\""), "+1'38\"")
    }

    // ── irmLabel ───────────────────────────────────────────────────

    func testIrmLabelMapeaEsYEn() {
        XCTAssertEqual(UciResultsLogic.irmLabel("DNF", isEn: false), "ABN")
        XCTAssertEqual(UciResultsLogic.irmLabel("DNF", isEn: true), "DNF")
        XCTAssertEqual(UciResultsLogic.irmLabel("DNS", isEn: false), "NS")
        XCTAssertEqual(UciResultsLogic.irmLabel("OTL", isEn: false), "FC")
        XCTAssertEqual(UciResultsLogic.irmLabel("DSQ", isEn: false), "EXP")
        // ABD = variante UCI de DNF → misma etiqueta.
        XCTAssertEqual(UciResultsLogic.irmLabel("ABD", isEn: false), "ABN")
        XCTAssertEqual(UciResultsLogic.irmLabel("ABD", isEn: true), "DNF")
        // Código desconocido → se devuelve tal cual.
        XCTAssertEqual(UciResultsLogic.irmLabel("XYZ", isEn: false), "XYZ")
        XCTAssertEqual(UciResultsLogic.irmLabel(nil, isEn: false), "")
    }

    // ── isAbandonIrm: abandono real vs ruido ───────────────────────

    func testIsAbandonIrmDistingueAbandonoRealDeRuido() {
        XCTAssertTrue(UciResultsLogic.isAbandonIrm("DNF"))
        XCTAssertTrue(UciResultsLogic.isAbandonIrm("ABD"))
        XCTAssertTrue(UciResultsLogic.isAbandonIrm("DNS"))
        XCTAssertTrue(UciResultsLogic.isAbandonIrm("OTL"))
        XCTAssertTrue(UciResultsLogic.isAbandonIrm("DSQ"))
        // 'LAP' (doblada) es RUIDO, no abandono.
        XCTAssertFalse(UciResultsLogic.isAbandonIrm("LAP"))
        XCTAssertFalse(UciResultsLogic.isAbandonIrm(nil))
        XCTAssertFalse(UciResultsLogic.isAbandonIrm(""))
    }

    // ── points(of:) ────────────────────────────────────────────────

    func testPointsUsaPointsOElEnteroDeResultValueOTimeText() {
        XCTAssertEqual(UciResultsLogic.points(of: row(points: 30)), 30)
        XCTAssertEqual(UciResultsLogic.points(of: row(resultValue: "25")), 25)
        XCTAssertEqual(UciResultsLogic.points(of: row(timeText: "12")), 12)
        XCTAssertNil(UciResultsLogic.points(of: row(timeText: "5:40:29")))
    }

    // ── buildIndividualRows: gaps ABSOLUTOS (caso A) ───────────────

    func testGapsDerivadosDeTiemposAbsolutos() {
        let rows = [
            row(rank: 1, timeText: "5:00:00"),
            row(rank: 2, timeText: "5:00:07"),
            row(rank: 3, timeText: "5:01:38"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        XCTAssertEqual(vms[0].valueKind, .winnerTime)
        XCTAssertEqual(vms[0].valueText, "5:00:00")
        XCTAssertEqual(vms[1].valueKind, .gap)
        XCTAssertEqual(vms[1].valueText, "+7\"")
        XCTAssertEqual(vms[2].valueText, "+1'38\"")
    }

    // ── buildIndividualRows: gaps DISFRAZADOS (caso B) ─────────────

    func testGapsDisfrazadosEnHhMmSsSinSigno() {
        // El rank 1 trae su tiempo total; el resto trae el GAP en HH:MM:SS sin '+'.
        let rows = [
            row(rank: 1, timeText: "5:00:00"),
            row(rank: 2, timeText: "00:00:07"),   // < ganador → es un gap
            row(rank: 3, timeText: "00:01:38"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        XCTAssertEqual(vms[0].valueText, "5:00:00")
        XCTAssertEqual(vms[1].valueText, "+7\"")
        XCTAssertEqual(vms[2].valueText, "+1'38\"")
    }

    func testGapCeroSeMarcaComoMismoTiempo() {
        let rows = [
            row(rank: 1, timeText: "4:00:00"),
            row(rank: 2, gapText: "+0"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        XCTAssertEqual(vms[1].valueKind, .sameTime)
    }

    func testIrmDejaLaCeldaDeValorVaciaYPoneLaEtiquetaEnElBadge() {
        let rows = [
            row(rank: 1, timeText: "4:00:00"),
            row(irm: "DNF", riderDisplay: "ABANDONA Pepe"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        XCTAssertTrue(vms[1].isOut)
        XCTAssertEqual(vms[1].valueKind, .empty)
        XCTAssertEqual(vms[1].rankBadge, "ABN")
        XCTAssertNil(vms[1].rank)
    }

    // ── rank 1 con irm de RUIDO (LAP) — la ganadora SÍ encabeza ────

    func testRank1ConLapGanaYLosGapsSeDerivanDelMinimoDeCabeza() {
        // Caso real: Dwars door de Westhoek 2026. La ganadora (rank 1) llega con
        // irm='LAP' (doblada) y SIN timeText. El grueso que cruzó con ella marca
        // 00:00:00 → cabeza=0 → m.t./+gap correctos. Carrera de un día (cabeza 0):
        // su celda de tiempo queda VACÍA (no se inventa "0:00:00").
        let rows = [
            row(rank: 1, bib: "25", timeText: nil, irm: "LAP", riderDisplay: "VENTURELLI"),
            row(rank: 2, bib: "30", timeText: "00:00:00"),
            row(rank: 3, bib: "31", timeText: "00:00:51"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        // La ganadora: encabeza con su número (no etiqueta), no está "out", celda vacía.
        XCTAssertEqual(vms[0].rank, 1)
        XCTAssertNil(vms[0].rankBadge)
        XCTAssertFalse(vms[0].isOut)
        XCTAssertEqual(vms[0].valueKind, .empty)
        XCTAssertEqual(vms[0].valueText, "")
        // El 2º cruzó con ella → mismo tiempo (m.t.). El 3º → +51".
        XCTAssertEqual(vms[1].valueKind, .sameTime)
        XCTAssertEqual(vms[2].valueKind, .gap)
        XCTAssertEqual(vms[2].valueText, "+51\"")
    }

    func testRank1ConLapYTiempoDeCabezaSignificativoMuestraEseTiempo() {
        // Variante con tiempo absoluto real (etapa por tiempo). La ganadora trae LAP
        // sin timeText, pero el grupo de cabeza tiene un tiempo > 0 → se le rotula ese.
        let rows = [
            row(rank: 1, bib: "25", timeText: nil, irm: "LAP"),
            row(rank: 2, bib: "30", timeText: "4:30:00"),
            row(rank: 3, bib: "31", timeText: "4:30:10"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        XCTAssertEqual(vms[0].valueKind, .winnerTime)
        XCTAssertEqual(vms[0].valueText, "4:30:00")
        XCTAssertEqual(vms[1].valueKind, .sameTime)   // cruzó con ella
        XCTAssertEqual(vms[2].valueText, "+10\"")
    }

    // ── REASIGNACIÓN DE COMISARIOS: gap 0 FUERA del bloque de cabeza ───────
    // Caso real (Baloise Ladies Tour 2026 et.5): incidente en los últimos 3 km → a la
    // corredora se le acredita el tiempo del grupo, pero conserva su puesto por orden
    // de llegada. Su fila NUNCA es m.t.: se pinta el gap explícito (+0").
    func test_commissaireReassignedRowKeepsExplicitGap() {
        let rows = [
            row(rank: 1, bib: "34", timeText: "2:42:24"),
            row(rank: 2, bib: "53", gapText: "+00"),
            row(rank: 3, bib: "6", gapText: "+00"),
            row(rank: 4, bib: "95", gapText: "+1:33"),
            row(rank: 5, bib: "21", gapText: "+00"),   // reasignada, la última
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        XCTAssertEqual(vms[0].valueKind, .winnerTime)
        XCTAssertEqual(vms[1].valueKind, .sameTime)   // bloque de cabeza
        XCTAssertEqual(vms[2].valueKind, .sameTime)   // bloque de cabeza
        XCTAssertEqual(vms[3].valueText, "+1'33\"")
        // La reasignada: gap explícito, NO m.t.
        XCTAssertEqual(vms[4].valueKind, .gap)
        XCTAssertEqual(vms[4].valueText, "+0\"")
    }

    // ── rank 1 con ABANDONO real (DNS) — el ganador es el 2º ───────

    func testRank1ConDnsEsEspurioYElGanadorRealEsElRank2() {
        // Caso real: Vuelta a Colombia Femenina et.3. La UCI deja rank 1 a Flórez con
        // irm='DNS' y sin tiempo; el ganador real es el rank 2 (03:32:40).
        let rows = [
            row(rank: 1, bib: "1", timeText: nil, irm: "DNS", riderDisplay: "FLOREZ"),
            row(rank: 2, bib: "2", timeText: "03:32:40", riderDisplay: "GANADORA"),
            row(rank: 3, bib: "3", timeText: "03:33:31"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        // El rank 1 DNS: # rotulado "NS" (no "1"), fila out, celda vacía, sin número.
        XCTAssertNil(vms[0].rank)
        XCTAssertEqual(vms[0].rankBadge, "NS")
        XCTAssertTrue(vms[0].isOut)
        XCTAssertEqual(vms[0].valueKind, .empty)
        // Un rank 1 abandonado NO es winnerRow → el tiempo de cabeza cae al MENOR de
        // los clasificados (el del rank 2). El rank 2 NO recibe el estilo de ganador
        // (no es winnerRow): su gap respecto al cabeza es 0 → m.t. (igual que la web).
        XCTAssertEqual(vms[1].rank, 2)
        XCTAssertEqual(vms[1].valueKind, .sameTime)
        // El rank 3 → gap respecto al cabeza (03:33:31 − 03:32:40 = 51").
        XCTAssertEqual(vms[2].valueKind, .gap)
        XCTAssertEqual(vms[2].valueText, "+51\"")
    }

    func testPuntosUsanCabeceraDePuntosYNoEstiloDeTiempo() {
        let rows = [
            row(rank: 1, resultValue: "50"),
            row(rank: 2, points: 30),
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "points", isTeams: false, byDorsal: [:], isEn: false)
        XCTAssertEqual(vms[0].valueKind, .points)
        XCTAssertEqual(vms[0].valueText, "50")
        XCTAssertEqual(vms[1].valueText, "30")
    }

    func testNombreYEquipoSeReconstruyenPorDorsal() {
        let byDorsal: [Int: ResolvedRider] = [
            11: ResolvedRider(name: "Tadej Pogačar", countryCode: "si", teamName: "UAE Team Emirates", team: nil),
        ]
        let rows = [row(rank: 1, bib: "11", timeText: "4:00:00", riderDisplay: "POGACAR Tadej")]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: byDorsal, isEn: false)
        XCTAssertEqual(vms[0].riderName, "Tadej Pogačar")
        XCTAssertEqual(vms[0].teamName, "UAE Team Emirates")
        XCTAssertEqual(vms[0].countryCode, "si")
    }

    func testFallbackARiderDisplaySiElDorsalNoCasa() {
        let rows = [row(rank: 1, bib: "999", timeText: "4:00:00", riderDisplay: "DESCONOCIDO Juan")]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        XCTAssertEqual(vms[0].riderName, "DESCONOCIDO Juan")
    }

    // ── CRI: helpers de tiempo truncado (cleanTimeText & cía.) ─────

    func testCleanTimeTextRecortaHorasACeroYDecimalesEnterosFuera() {
        XCTAssertEqual(UciResultsLogic.cleanTimeText("0:06:36"), "6:36")
        XCTAssertEqual(UciResultsLogic.cleanTimeText("00:30:36"), "30:36")
        // Decimales FUERA (el tiempo oficial se cuenta en segundos enteros).
        XCTAssertEqual(UciResultsLogic.cleanTimeText("1:04.869"), "1:04")
        XCTAssertEqual(UciResultsLogic.cleanTimeText("3:35.12"), "3:35")
        // Sin horas a cero ni decimales → intacto.
        XCTAssertEqual(UciResultsLogic.cleanTimeText("45:53"), "45:53")
        XCTAssertEqual(UciResultsLogic.cleanTimeText("4:35:42"), "4:35:42")
        XCTAssertEqual(UciResultsLogic.cleanTimeText(nil), "")
        XCTAssertEqual(UciResultsLogic.cleanTimeText(""), "")
    }

    func testSecondsToGapConDecimalesTruncaASegundosEnteros() {
        XCTAssertEqual(UciResultsLogic.secondsToGap(36.98), "+36\"")
        XCTAssertEqual(UciResultsLogic.secondsToGap(1.99), "+1\"")
        XCTAssertNil(UciResultsLogic.secondsToGap(-0.5))
        XCTAssertNil(UciResultsLogic.secondsToGap(nil as Double?))
    }

    func testSecondsToAbsTextSinHorasACeroYEnSegundosEnteros() {
        XCTAssertEqual(UciResultsLogic.secondsToAbsText(396.0), "6:36")
        XCTAssertEqual(UciResultsLogic.secondsToAbsText(2753.0), "45:53")
        XCTAssertEqual(UciResultsLogic.secondsToAbsText(3905.0), "1:05:05")
        // Truncado (no redondeo): 396.9 → 6:36.
        XCTAssertEqual(UciResultsLogic.secondsToAbsText(396.9), "6:36")
        XCTAssertEqual(UciResultsLogic.secondsToAbsText(nil), "")
        XCTAssertEqual(UciResultsLogic.secondsToAbsText(-1.0), "")
    }

    func testSecondsToPressTimeUsaNotacionDePrensaTruncada() {
        // "20:52.99" → 1252.99 → 20'52" (truncado, segundos enteros).
        XCTAssertEqual(UciResultsLogic.secondsToPressTime(1252.99), "20'52\"")
        XCTAssertEqual(UciResultsLogic.secondsToPressTime(396.0), "6'36\"")
        XCTAssertEqual(UciResultsLogic.secondsToPressTime(2753.0), "45'53\"")
        // ≥1h → mismo escalón H:MM:SS que secondsToGap.
        XCTAssertEqual(UciResultsLogic.secondsToPressTime(3905.0), "1:05:05")
        XCTAssertEqual(UciResultsLogic.secondsToPressTime(nil), "")
        XCTAssertEqual(UciResultsLogic.secondsToPressTime(-1.0), "")
    }

    // ── CRI: gate isIttStage ───────────────────────────────────────

    func testIsIttStageExigeIttOJornadaIttYSoloEtapaOFinalDeUnDia() {
        // Etapa de una carrera por etapas con RaceTypeCode ITT.
        XCTAssertTrue(UciResultsLogic.isIttStage(
            classKind: "stage", isTeams: false, stageRaceType: "ITT",
            raceDayPrimaryType: nil, stageNumber: 4, isOneDay: false))
        // CRI de un día: bloque final SIN raceType (gc + stageNumber nil) + jornada itt.
        XCTAssertTrue(UciResultsLogic.isIttStage(
            classKind: "gc", isTeams: false, stageRaceType: nil,
            raceDayPrimaryType: "itt", stageNumber: nil, isOneDay: true))
        // La GC del día de una etapa CRI NO cambia (acumulada → gaps normales).
        XCTAssertFalse(UciResultsLogic.isIttStage(
            classKind: "gc", isTeams: false, stageRaceType: "ITT",
            raceDayPrimaryType: nil, stageNumber: 4, isOneDay: false))
        XCTAssertFalse(UciResultsLogic.isIttStage(
            classKind: "gc", isTeams: false, stageRaceType: nil,
            raceDayPrimaryType: "itt", stageNumber: 4, isOneDay: false))
        // Etapa en línea → no.
        XCTAssertFalse(UciResultsLogic.isIttStage(
            classKind: "stage", isTeams: false, stageRaceType: "RR",
            raceDayPrimaryType: nil, stageNumber: 4, isOneDay: false))
        XCTAssertFalse(UciResultsLogic.isIttStage(
            classKind: "stage", isTeams: false, stageRaceType: nil,
            raceDayPrimaryType: nil, stageNumber: 4, isOneDay: false))
        // Puntos/montaña/equipos → nunca.
        XCTAssertFalse(UciResultsLogic.isIttStage(
            classKind: "points", isTeams: false, stageRaceType: "ITT",
            raceDayPrimaryType: nil, stageNumber: 4, isOneDay: false))
        XCTAssertFalse(UciResultsLogic.isIttStage(
            classKind: "teams", isTeams: true, stageRaceType: "ITT",
            raceDayPrimaryType: nil, stageNumber: 4, isOneDay: false))
        // gc final de un día pero la carrera NO es de un día → no.
        XCTAssertFalse(UciResultsLogic.isIttStage(
            classKind: "gc", isTeams: false, stageRaceType: nil,
            raceDayPrimaryType: "itt", stageNumber: nil, isOneDay: false))
    }

    // ── CRI: diferencias sobre tiempos truncados (como en línea) ───

    func testCriCanonicaGapsSobreEnterosTruncandoCadaTiempo() {
        // Espec Dani: 20:52.99 / 20:53.00 / 20:53.05 → 20'52" / +1" / m.t.
        // El gap se calcula truncando CADA tiempo (20:52 y 20:53 → +1", no +0");
        // el 3º comparte gap (+1") y el filtro/display lo rotula m.t. (pipeline
        // normal de en línea, gap idéntico al de la fila de arriba).
        let rows = [
            row(rank: 1, timeText: "20:52.99"),
            row(rank: 2, timeText: "20:53.00"),
            row(rank: 3, timeText: "20:53.05"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false, isItt: true)
        XCTAssertEqual(vms[0].valueKind, .winnerTime)
        XCTAssertEqual(vms[0].valueText, "20'52\"")
        XCTAssertEqual(vms[1].valueKind, .gap)
        XCTAssertEqual(vms[1].valueText, "+1\"")
        XCTAssertEqual(vms[2].valueText, "+1\"")
        // rowGap relleno → participan del m.t. dinámico del filtro por equipo.
        XCTAssertEqual(vms[1].rowGap, "+1\"")
        XCTAssertEqual(vms[2].rowGap, "+1\"")
    }

    func testCriConTiemposAbsolutosEnterosDerivaGapsComoEnLinea() {
        // Caso real: Boucles de la Mayenne 2026, prólogo → 6'36"/+1"/+6"/m.t./+7"
        // (el m.t. del 4º lo pone el display al compartir gap con el 3º).
        let rows = [
            row(rank: 1, timeText: "0:06:36"),
            row(rank: 2, timeText: "0:06:37"),
            row(rank: 3, timeText: "0:06:42"),
            row(rank: 4, timeText: "0:06:42"),
            row(rank: 5, timeText: "0:06:43"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false, isItt: true)
        XCTAssertEqual(vms[0].valueText, "6'36\"")
        XCTAssertEqual(vms[1].valueText, "+1\"")
        XCTAssertEqual(vms[2].valueText, "+6\"")
        XCTAssertEqual(vms[3].valueText, "+6\"")
        XCTAssertEqual(vms[4].valueText, "+7\"")
    }

    func testCriConMilesimasTruncaCadaTiempoAntesDeRestar() {
        // Caso real: Tour de Estonia 2026, prólogo → 1'04"/+2"/m.t./+3".
        let rows = [
            row(rank: 1, timeText: "1:04.869"),
            row(rank: 2, timeText: "1:06.124"),
            row(rank: 3, timeText: "1:06.953"),
            row(rank: 4, timeText: "1:07.300"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false, isItt: true)
        XCTAssertEqual(vms[0].valueText, "1'04\"")
        XCTAssertEqual(vms[1].valueText, "+2\"")
        XCTAssertEqual(vms[2].valueText, "+2\"")
        XCTAssertEqual(vms[3].valueText, "+3\"")
    }

    func testCriGapEnteroPublicadoFluyePorElPipelineNormal() {
        // Caso real: Giro 2026, et.10 (CRI). Ganador "45:53" + gap crudo "+1:53"
        // → 45'53" / +1'53" (notación de prensa, como una etapa en línea).
        let rows = [
            row(rank: 1, timeText: "45:53"),
            row(rank: 2, gapText: "+1:53"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false, isItt: true)
        XCTAssertEqual(vms[0].valueText, "45'53\"")
        XCTAssertEqual(vms[1].valueKind, .gap)
        XCTAssertEqual(vms[1].valueText, "+1'53\"")
    }

    func testCriGapPublicadoConDecimasSeDerivaDeLosTiemposTruncados() {
        // Caso real: Tour of the Gila 2026 (gap decimal publicado "+36.98").
        // floor(ganador+gap) − floor(ganador) → +37", no +36" (truncar el gap
        // estaría mal). Ganador "32:30.83" → 32'30".
        let rows = [
            row(rank: 1, timeText: "32:30.83"),
            row(rank: 2, gapText: "+36.98"),
            row(rank: 3, gapText: "+51.99"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false, isItt: true)
        XCTAssertEqual(vms[0].valueText, "32'30\"")
        XCTAssertEqual(vms[1].valueText, "+37\"")
        XCTAssertEqual(vms[2].valueText, "+52\"")
    }

    func testCriGapDecimalExactoSeTruncaViaFormatGap() {
        // Caso real: Tour de Romandía 2026, prólogo → 3'35"/+6"/m.t./+7". El gap
        // "+6.00" es entero (6.0) → no pasa por el floor de tiempos; formatGap lo
        // trunca a +6". El "+7.18" sí se deriva de los tiempos truncados.
        let rows = [
            row(rank: 1, timeText: "3:35.12"),
            row(rank: 2, gapText: "+6.00"),
            row(rank: 3, gapText: "+6.00"),
            row(rank: 4, gapText: "+7.18"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false, isItt: true)
        XCTAssertEqual(vms[0].valueText, "3'35\"")
        XCTAssertEqual(vms[1].valueText, "+6\"")
        XCTAssertEqual(vms[2].valueText, "+6\"")
        XCTAssertEqual(vms[3].valueText, "+7\"")
    }

    func testCriMismoTiempoTruncadoQueElGanadorEsMt() {
        // 2º con el MISMO tiempo truncado que el ganador → gap 0 → m.t. estático.
        let rows = [
            row(rank: 1, timeText: "20:52.99"),
            row(rank: 2, timeText: "20:52.995"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false, isItt: true)
        XCTAssertEqual(vms[1].valueKind, .sameTime)
    }

    func testCriUnTimeTextMenorQueElGanadorEsUnGapDisfrazado() {
        // Sin gapText: el fetcher guardó el gap COMO timeText ("00:00:27" = +27s).
        // Un tiempo menor que el del ganador es imposible → se trata como gap.
        let rows = [
            row(rank: 1, timeText: "00:30:36"),
            row(rank: 2, timeText: "00:00:27"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false, isItt: true)
        XCTAssertEqual(vms[0].valueText, "30'36\"")
        XCTAssertEqual(vms[1].valueText, "+27\"")
    }

    func testCriLosAbandonosSiguenConCeldaVaciaYEtiqueta() {
        let rows = [
            row(rank: 1, timeText: "0:06:36"),
            row(irm: "DNF", riderDisplay: "ABANDONA Pepe"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false, isItt: true)
        XCTAssertEqual(vms[1].valueKind, .empty)
        XCTAssertEqual(vms[1].rankBadge, "ABN")
    }

    func testSinIsIttUnaEtapaEnLineaConservaGapsYMt() {
        // Regresión: la convención de crono NO toca las etapas en línea ni las
        // generales (isItt=false): gaps derivados y m.t. como siempre.
        let rows = [
            row(rank: 1, timeText: "4:35:42"),
            row(rank: 2, timeText: "4:35:42"),
            row(rank: 3, timeText: "4:36:43"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(rows: rows, classKind: "stage", isTeams: false, byDorsal: [:], isEn: false)
        XCTAssertEqual(vms[0].valueText, "4:35:42")
        XCTAssertEqual(vms[1].valueKind, .sameTime)
        XCTAssertEqual(vms[2].valueText, "+1'01\"")
    }

    // ── normalizeTeamName / findMatchingTeam (pestaña Equipos) ─────

    func testNormalizeTeamNameMinusculasSinAcentosYSinStopwords() {
        XCTAssertEqual(UciResultsLogic.normalizeTeamName("LOTTO INTERMARCHE"), "lotto intermarche")
        XCTAssertEqual(UciResultsLogic.normalizeTeamName("Lotto Intermarché"), "lotto intermarche")
        // "pro", "cycling" y "team" son stopwords.
        XCTAssertEqual(UciResultsLogic.normalizeTeamName("TUDOR PRO CYCLING TEAM"), "tudor")
        // El separador '|' se pliega a espacio; "a" NO es stopword.
        XCTAssertEqual(UciResultsLogic.normalizeTeamName("TEAM VISMA | LEASE A BIKE"), "visma lease a bike")
        XCTAssertEqual(UciResultsLogic.normalizeTeamName("RED BULL - BORA - HANSGROHE"), "red bull bora hansgrohe")
        XCTAssertEqual(UciResultsLogic.normalizeTeamName(nil), "")
        XCTAssertEqual(UciResultsLogic.normalizeTeamName("Team"), "")   // solo stopwords
    }

    func testFindMatchingTeamCasaNombresCrudosDeLaFuenteContraElCatalogo() {
        // Casos reales del ARA 2026 (riderDisplay de Tissot vs nombre canónico).
        let teams = [
            team("t1", "Tudor"),
            team("t2", "Visma | Lease a Bike"),
            team("t3", "UAE Team Emirates-XRG"),
            team("t4", "Lotto Intermarché"),
            // Alias multilínea: el nombre histórico solo casa vía nameAliases.
            team("t5", "Decathlon CMA CGM", aliases: "Decathlon\nAG2R La Mondiale"),
        ]
        XCTAssertEqual(UciResultsLogic.findMatchingTeam("TUDOR PRO CYCLING TEAM", teams: teams)?.id, "t1")
        XCTAssertEqual(UciResultsLogic.findMatchingTeam("TEAM VISMA | LEASE A BIKE", teams: teams)?.id, "t2")
        XCTAssertEqual(UciResultsLogic.findMatchingTeam("UAE TEAM EMIRATES XRG", teams: teams)?.id, "t3")
        XCTAssertEqual(UciResultsLogic.findMatchingTeam("LOTTO INTERMARCHE", teams: teams)?.id, "t4")
        XCTAssertEqual(UciResultsLogic.findMatchingTeam("AG2R LA MONDIALE", teams: teams)?.id, "t5")
        XCTAssertNil(UciResultsLogic.findMatchingTeam("EQUIPO FANTASMA", teams: teams))
        XCTAssertNil(UciResultsLogic.findMatchingTeam(nil, teams: teams))
        XCTAssertNil(UciResultsLogic.findMatchingTeam("Tudor", teams: []))
    }

    func testFindMatchingTeamCasaLos22EquiposRealesDelAra2026() {
        // Verificación con datos REALES: los 22 riderDisplay de la clasificación de
        // equipos del Tour Auvergne-Rhône-Alpes 2026 (fuente Tissot) contra los 22
        // equipos canónicos de su startlist (names + nameAliases tal cual en BD).
        let raceTeams = [
            team("alpecin", "Alpecin-Premier Tech", aliases: "Alpecin"),
            team("bahrain", "Bahrain Victorious", aliases: "Bahrain"),
            team("cajarural", "Caja Rural-Seguros RGA", aliases: "Caja Rural"),
            team("cofidis", "Cofidis"),
            team("decathlon", "Decathlon CMA CGM", aliases: "Decathlon\nDecathlon CMA CGM Development"),
            team("ef", "EF Education-EasyPost", aliases: "Education First\nEF"),
            team("groupama", "Groupama-FDJ United", aliases: "Groupama FDJ\nGroupama"),
            team("jayco", "Jayco Alula", aliases: "Jayco"),
            team("lidl", "Lidl-Trek", aliases: "Lidl Trek\nLidl"),
            team("lotto", "Lotto Intermarché", aliases: "Lotto-Intermarché\\nLotto - Intermarché\\nLotto Dstny"),
            team("movistar", "Movistar", aliases: "Movistar Team"),
            team("netcompany", "Netcompany INEOS", aliases: "Net Company\nNetcompany-INEOS"),
            team("nsn", "NSN", aliases: "NSN Cycling Team"),
            team("picnic", "Picnic PostNL", aliases: "Picnic"),
            team("redbull", "Red Bull-BORA-hansgrohe", aliases: "Red Bull BORA\nRed Bull"),
            team("soudal", "Soudal Quick-Step", aliases: "Soudal\nSoudal-Quick Step\nSoudal Quick Step"),
            team("total", "TotalEnergies", aliases: "Total\nTotal Energies"),
            team("tudor", "Tudor", aliases: "Tudor Pro Cycling"),
            team("uae", "UAE Team Emirates-XRG", aliases: "UAE Team Emirates\nUAE Emirates\nUAE"),
            team("unox", "Uno-X Mobility", aliases: "Uno-X"),
            team("visma", "Visma | Lease a Bike", aliases: "Visma\nVisma | Lease a Bike Development"),
            team("xds", "XDS Astana"),
        ]
        let expected: [String: String] = [
            "ALPECIN-PREMIER TECH": "alpecin",
            "BAHRAIN VICTORIOUS": "bahrain",
            "CAJA RURAL-SEGUROS RGA": "cajarural",
            "COFIDIS": "cofidis",
            "DECATHLON CMA CGM TEAM": "decathlon",
            "EF EDUCATION - EASYPOST": "ef",
            "GROUPAMA-FDJ UNITED": "groupama",
            "LIDL-TREK": "lidl",
            "LOTTO INTERMARCHE": "lotto",
            "MOVISTAR TEAM": "movistar",
            "NETCOMPANY INEOS CYCLING TEAM": "netcompany",
            "NSN CYCLING TEAM": "nsn",
            "RED BULL - BORA - HANSGROHE": "redbull",
            "SOUDAL QUICK-STEP": "soudal",
            "TEAM JAYCO ALULA": "jayco",
            "TEAM PICNIC POSTNL": "picnic",
            "TEAM VISMA | LEASE A BIKE": "visma",
            "TOTALENERGIES": "total",
            "TUDOR PRO CYCLING TEAM": "tudor",
            "UAE TEAM EMIRATES XRG": "uae",
            "UNO-X MOBILITY": "unox",
            "XDS ASTANA TEAM": "xds",
        ]
        for (raw, teamId) in expected {
            XCTAssertEqual(
                UciResultsLogic.findMatchingTeam(raw, teams: raceTeams)?.id, teamId,
                "riderDisplay '\(raw)'"
            )
        }
    }

    func testFindMatchingTeamCaeAContencionConMinimoDe4Caracteres() {
        let teams = [team("t1", "Groupama-FDJ United"), team("t2", "NSN")]
        // "groupama fdj" ⊂ "groupama fdj united" → contención.
        XCTAssertEqual(UciResultsLogic.findMatchingTeam("GROUPAMA-FDJ", teams: teams)?.id, "t1")
        // "nsn" tiene <4 caracteres → NO entra en contención (evita ruido).
        XCTAssertNil(UciResultsLogic.findMatchingTeam("NSN MOBILITY", teams: teams))
    }

    func testPestanaEquiposCasaRiderDisplayParaChapaYNombreCanonico() {
        // Espejo del render web (resultados.js): fila de equipos = riderDisplay
        // crudo sin dorsal; casada → nombre del catálogo + chapa; sin casar → crudo.
        let raceTeams = [
            team("t1", "Groupama-FDJ United"),
            team("t2", "Visma | Lease a Bike"),
        ]
        let rows = [
            row(rank: 1, timeText: "28:56:59", riderDisplay: "GROUPAMA-FDJ UNITED"),
            row(rank: 2, gapText: "+44", riderDisplay: "TEAM VISMA | LEASE A BIKE"),
            row(rank: 3, gapText: "+1:10", riderDisplay: "EQUIPO DESCONOCIDO"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "teams", isTeams: true, byDorsal: [:], isEn: false, raceTeams: raceTeams
        )
        XCTAssertEqual(vms[0].riderName, "Groupama-FDJ United")
        XCTAssertEqual(vms[0].team?.id, "t1")
        XCTAssertEqual(vms[0].valueKind, .winnerTime)
        XCTAssertEqual(vms[0].valueText, "28:56:59")
        XCTAssertEqual(vms[1].riderName, "Visma | Lease a Bike")
        XCTAssertEqual(vms[1].team?.id, "t2")
        XCTAssertEqual(vms[1].valueText, "+44\"")
        // Sin casar → el crudo de la fuente, sin chapa.
        XCTAssertEqual(vms[2].riderName, "EQUIPO DESCONOCIDO")
        XCTAssertNil(vms[2].team)
        XCTAssertEqual(vms[2].valueText, "+1'10\"")
    }

    // ── isTttStage ─────────────────────────────────────────────────

    func testIsTttStageDetectaCreVarianteA() {
        let rows = [
            row(rank: 1, bib: "1"), row(rank: 1, bib: "2"), row(rank: 1, bib: "3"),
            row(rank: 2, bib: "11"), row(rank: 2, bib: "12"), row(rank: 2, bib: "13"),
        ]
        XCTAssertTrue(UciResultsLogic.isTttStage(rows: rows, classKind: "stage", isTeams: false, raceDayPrimaryType: "ttt"))
        // Sin el tipo de jornada curado, 2 ranks compartidos no basta (exige ≥3).
        XCTAssertFalse(UciResultsLogic.isTttStage(rows: rows, classKind: "stage", isTeams: false, raceDayPrimaryType: nil))
    }

    func testIsTttStageConEstructuraMuyMarcadaSeDisparaSinTipoDeJornada() {
        // 3 puestos con ≥2 corredores → suficiente aunque no sepamos que es CRE.
        let rows = [
            row(rank: 1, bib: "1"), row(rank: 1, bib: "2"),
            row(rank: 2, bib: "11"), row(rank: 2, bib: "12"),
            row(rank: 3, bib: "21"), row(rank: 3, bib: "22"),
        ]
        XCTAssertTrue(UciResultsLogic.isTttStage(rows: rows, classKind: "stage", isTeams: false, raceDayPrimaryType: nil))
    }

    func testIsTttStageDetectaCreVarianteB() {
        let rows = [
            row(rank: 1, bib: "1"), row(rank: nil, bib: "2"), row(rank: nil, bib: "3"),
            row(rank: 2, bib: "11"), row(rank: nil, bib: "12"), row(rank: nil, bib: "13"),
        ]
        XCTAssertTrue(UciResultsLogic.isTttStage(rows: rows, classKind: "stage", isTeams: false, raceDayPrimaryType: "ttt"))
    }

    func testIsTttStageNoSeDisparaEnUnaEtapaIndividualNormal() {
        let rows = [
            row(rank: 1, bib: "1", timeText: "4:00:00"),
            row(rank: 2, bib: "2", timeText: "4:00:05"),
            row(rank: 3, bib: "3", timeText: "4:00:10"),
        ]
        XCTAssertFalse(UciResultsLogic.isTttStage(rows: rows, classKind: "stage", isTeams: false, raceDayPrimaryType: "road"))
        // Tampoco en la pestaña de equipos (ya colapsada).
        XCTAssertFalse(UciResultsLogic.isTttStage(rows: rows, classKind: "stage", isTeams: true, raceDayPrimaryType: "ttt"))
        // gc de una vuelta por etapas (stageNumber != nil) no dispara aunque sea ttt.
        XCTAssertFalse(UciResultsLogic.isTttStage(rows: rows, classKind: "gc", isTeams: false, raceDayPrimaryType: "ttt", stageNumber: 3, isOneDay: false))
        // gc de un día, pero sin estructura CRE (todos con rank único) → no dispara.
        XCTAssertFalse(UciResultsLogic.isTttStage(rows: rows, classKind: "gc", isTeams: false, raceDayPrimaryType: "ttt", stageNumber: nil, isOneDay: true))
    }

    func testIsTttStageNoColapsaCriConExAequo() {
        // CRI (primaryType='itt' / raceType='ITT') con 3 empates dobles: sin el guard,
        // sharedRanks=3 dispararía la rama estructural y la pintaría como CRE.
        // Caso real: Tour de Beauce 2026 etapa 4 (puestos 49, 51, 88 empatados).
        let rows = [
            row(rank: 1, bib: "1", timeText: "0:10:04"),
            row(rank: 49, bib: "194", gapText: "+42"),
            row(rank: 49, bib: "94", gapText: "+42"),
            row(rank: 51, bib: "73", gapText: "+42"),
            row(rank: 51, bib: "64", gapText: "+42"),
            row(rank: 88, bib: "111", gapText: "+1:02"),
            row(rank: 88, bib: "93", gapText: "+1:02"),
        ]
        // Por tipo de jornada curado.
        XCTAssertFalse(UciResultsLogic.isTttStage(rows: rows, classKind: "stage", isTeams: false, raceDayPrimaryType: "itt"))
        // Por raceType de la etapa (jornada no mapeada).
        XCTAssertFalse(UciResultsLogic.isTttStage(rows: rows, classKind: "stage", isTeams: false, raceDayPrimaryType: nil, stageRaceType: "ITT"))
    }

    func testIsTttStageDetectaCreDeCarreraDeUnDiaVarianteC() {
        // Variante B con classKind='gc' — caso Ses Salines: líderes con rank, compañeros nil.
        let rows = [
            row(rank: 1, bib: "1"), row(rank: nil, bib: "2"), row(rank: nil, bib: "3"),
            row(rank: 2, bib: "11"), row(rank: nil, bib: "12"), row(rank: nil, bib: "13"),
        ]
        XCTAssertTrue(UciResultsLogic.isTttStage(rows: rows, classKind: "gc", isTeams: false, raceDayPrimaryType: "ttt", stageNumber: nil, isOneDay: true))
        // Sin isOneDay no dispara (es una GC de vuelta por etapas).
        XCTAssertFalse(UciResultsLogic.isTttStage(rows: rows, classKind: "gc", isTeams: false, raceDayPrimaryType: "ttt", stageNumber: nil, isOneDay: false))
    }

    // ── teamsInClass ───────────────────────────────────────────────

    func testTeamsInClassDevuelveLosEquiposEnOrdenAlfabetico() {
        let byDorsal: [Int: ResolvedRider] = [
            1: ResolvedRider(name: "G1", countryCode: "es", teamName: "Zeta Team", team: nil),
            2: ResolvedRider(name: "G2", countryCode: "es", teamName: "alfa squad", team: nil),
            3: ResolvedRider(name: "G3", countryCode: "fr", teamName: "Movistar", team: nil),
            4: ResolvedRider(name: "G4", countryCode: "fr", teamName: "alfa squad", team: nil),
            5: ResolvedRider(name: "G5", countryCode: "it", teamName: "", team: nil),   // sin equipo → fuera
        ]
        let rows = [
            row(rank: 1, bib: "1", sortOrder: 0),    // Zeta (1ª en filas)
            row(rank: 2, bib: "2", sortOrder: 1),    // alfa
            row(rank: 3, bib: "3", sortOrder: 2),    // Movistar
            row(rank: 4, bib: "4", sortOrder: 3),    // alfa (dup)
            row(rank: 5, bib: "5", sortOrder: 4),    // sin equipo
        ]
        // Orden alfabético ignorando mayúsculas, no el orden de aparición.
        XCTAssertEqual(
            UciResultsLogic.teamsInClass(rows: rows, byDorsal: byDorsal),
            ["alfa squad", "Movistar", "Zeta Team"]
        )
    }

    // ── collapseTtt ────────────────────────────────────────────────

    func testCollapseTttVarianteAAgrupaPorEquipoYCalculaGapsDeEquipo() {
        let byDorsal: [Int: ResolvedRider] = [
            1: ResolvedRider(name: "A1", countryCode: "es", teamName: "Equipo Alfa", team: nil),
            2: ResolvedRider(name: "A2", countryCode: "es", teamName: "Equipo Alfa", team: nil),
            11: ResolvedRider(name: "B1", countryCode: "fr", teamName: "Equipo Beta", team: nil),
            12: ResolvedRider(name: "B2", countryCode: "fr", teamName: "Equipo Beta", team: nil),
        ]
        let rows = [
            row(rank: 1, bib: "1", timeText: "32:33.50", sortOrder: 0),
            row(rank: 1, bib: "2", timeText: "32:35.00", sortOrder: 1),
            row(rank: 2, bib: "11", timeText: "32:40.00", sortOrder: 2),
            row(rank: 2, bib: "12", timeText: "32:41.00", sortOrder: 3),
        ]
        let teams = UciResultsLogic.collapseTtt(rows: rows, byDorsal: byDorsal, isEn: false)
        XCTAssertEqual(teams.count, 2)
        XCTAssertEqual(teams[0].teamName, "Equipo Alfa")
        XCTAssertEqual(teams[0].rank, 1)
        XCTAssertEqual(teams[0].riders.count, 2)
        let winner = UciResultsLogic.tttWinnerSecs(teams)
        // 32:40 − 32:33 = 7" (truncando centésimas).
        XCTAssertEqual(UciResultsLogic.tttGapBetween(teamSecs: teams[1].teamSecs, winnerSecs: winner), "+7\"")
    }

    func testCollapseTttVarianteBMantieneALosCompanerosEnSuEquipo() {
        let byDorsal: [Int: ResolvedRider] = [
            1: ResolvedRider(name: "A1", countryCode: "es", teamName: "Equipo Alfa", team: nil),
            2: ResolvedRider(name: "A2", countryCode: "es", teamName: "Equipo Alfa", team: nil),
            3: ResolvedRider(name: "A3", countryCode: "es", teamName: "Equipo Alfa", team: nil),
        ]
        let rows = [
            row(rank: 1, bib: "1", timeText: "30:00.00", sortOrder: 0),
            row(rank: nil, bib: "2", timeText: "30:00.00", sortOrder: 1),
            row(rank: nil, bib: "3", timeText: "30:02.00", sortOrder: 2),
        ]
        let teams = UciResultsLogic.collapseTtt(rows: rows, byDorsal: byDorsal, isEn: false)
        XCTAssertEqual(teams.count, 1)
        XCTAssertEqual(teams[0].riders.count, 3)
        XCTAssertEqual(teams[0].rank, 1)
    }

    // ── Fallback por globalRiderId (CN sin startlist con dorsal casable) ──
    // Espejo del `byRider` de la web: cuando la fila NO casa por dorsal pero
    // trae globalRiderId, su bandera/equipo/ficha salen de riders_* (campeonatos
    // nacionales y demás volcados in-house sin inscritos curados).

    func testByRiderRescataBanderaEquipoYNombreCuandoNoCasaPorDorsal() {
        var wt = team("t-wt", "Movistar Team")
        wt.category = "WT"
        // Sin startlist (byDorsal vacío) → todo se resuelve por byRider.
        let byRider: [String: ResolvedRider] = [
            "castrillo-pablo": ResolvedRider(
                name: "Pablo Castrillo", countryCode: "es", teamName: "Movistar Team",
                team: wt, globalRiderId: "castrillo-pablo"),
        ]
        let rows = [
            // riderDisplay crudo "APELLIDO Nombre"; bib NULL (no casa por dorsal).
            row(rank: 1, bib: nil, timeText: "30:00", riderDisplay: "CASTRILLO Pablo",
                globalRiderId: "castrillo-pablo"),
        ]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:],
            isEn: false, byRider: byRider
        )
        XCTAssertEqual(vms[0].countryCode, "es")            // bandera de la ficha
        XCTAssertEqual(vms[0].teamName, "Movistar Team")    // equipo actual
        XCTAssertEqual(vms[0].riderName, "Pablo Castrillo")  // nombre de la ficha gana al display crudo
        XCTAssertEqual(vms[0].team?.id, "t-wt")             // chapa del equipo actual
    }

    func testByDorsalTienePrioridadSobreByRider() {
        // La misma fila casa por dorsal Y tiene ficha: gana la startlist curada.
        let byDorsal: [Int: ResolvedRider] = [
            7: ResolvedRider(name: "Por Dorsal", countryCode: "fr", teamName: "Equipo Startlist",
                             team: nil, globalRiderId: "gid-7"),
        ]
        let byRider: [String: ResolvedRider] = [
            "gid-7": ResolvedRider(name: "Por Ficha", countryCode: "es", teamName: "Equipo Ficha",
                                   team: nil, globalRiderId: "gid-7"),
        ]
        let rows = [row(rank: 1, bib: "7", timeText: "30:00", globalRiderId: "gid-7")]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: byDorsal,
            isEn: false, byRider: byRider
        )
        XCTAssertEqual(vms[0].riderName, "Por Dorsal")
        XCTAssertEqual(vms[0].teamName, "Equipo Startlist")
        XCTAssertEqual(vms[0].countryCode, "fr")
    }

    func testByRiderSinFichaDejaLaFilaPelada() {
        // Fila sin dorsal y sin entrada en byRider (corredor amateur fuera del
        // catálogo): se mantiene con el riderDisplay crudo, sin bandera/equipo.
        let rows = [row(rank: 1, bib: nil, timeText: "30:00", riderDisplay: "AMATEUR Juan",
                        globalRiderId: "no-ficha")]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:],
            isEn: false, byRider: [:]
        )
        XCTAssertEqual(vms[0].riderName, "AMATEUR Juan")
        XCTAssertEqual(vms[0].teamName, "")
        XCTAssertEqual(vms[0].countryCode, "")
    }

    func testTeamsInClassUsaByRiderCuandoNoHayStartlist() {
        let byRider: [String: ResolvedRider] = [
            "g1": ResolvedRider(name: "R1", countryCode: "es", teamName: "Zeta Team", team: nil, globalRiderId: "g1"),
            "g2": ResolvedRider(name: "R2", countryCode: "fr", teamName: "alfa squad", team: nil, globalRiderId: "g2"),
        ]
        let rows = [
            row(rank: 1, bib: nil, globalRiderId: "g1", sortOrder: 0),
            row(rank: 2, bib: nil, globalRiderId: "g2", sortOrder: 1),
        ]
        XCTAssertEqual(
            UciResultsLogic.teamsInClass(rows: rows, byDorsal: [:], byRider: byRider),
            ["alfa squad", "Zeta Team"]
        )
    }

    // ── Override manual de equipo (mig. 112) ───────────────────────

    func testOverrideDeEquipoGanaAlDorsalEnBuildIndividualRows() {
        let byDorsal: [Int: ResolvedRider] = [
            11: ResolvedRider(name: "Corredor X", countryCode: "es", teamName: "Equipo Startlist",
                              team: team("ts", "Equipo Startlist"), globalRiderId: "gx"),
        ]
        let byTeamOverride: [String: Team] = ["tov": team("tov", "Equipo Override")]
        let rows = [row(rank: 1, bib: "11", timeText: "4:00:00", teamId: "tov")]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: byDorsal,
            isEn: false, byTeamOverride: byTeamOverride
        )
        XCTAssertEqual(vms[0].teamName, "Equipo Override")
        XCTAssertEqual(vms[0].team?.id, "tov")
        // El corredor (nombre/bandera/ficha) sigue saliendo del dorsal.
        XCTAssertEqual(vms[0].riderName, "Corredor X")
        XCTAssertEqual(vms[0].countryCode, "es")
    }

    func testSinOverrideElEquipoSigueResolviendosePorDorsal() {
        let byDorsal: [Int: ResolvedRider] = [
            11: ResolvedRider(name: "Corredor X", countryCode: "es", teamName: "Equipo Startlist",
                              team: team("ts", "Equipo Startlist"), globalRiderId: "gx"),
        ]
        let rows = [row(rank: 1, bib: "11", timeText: "4:00:00")]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: byDorsal, isEn: false
        )
        XCTAssertEqual(vms[0].teamName, "Equipo Startlist")
        XCTAssertEqual(vms[0].team?.id, "ts")
    }

    func testOverrideDeEquipoAplicaSinStartlistNiFicha() {
        let byTeamOverride: [String: Team] = ["tov": team("tov", "Equipo Override")]
        let rows = [row(rank: 1, bib: "999", timeText: "4:00:00", riderDisplay: "AMATEUR Juan", teamId: "tov")]
        let vms = UciResultsLogic.buildIndividualRows(
            rows: rows, classKind: "stage", isTeams: false, byDorsal: [:],
            isEn: false, byTeamOverride: byTeamOverride
        )
        XCTAssertEqual(vms[0].teamName, "Equipo Override")
        XCTAssertEqual(vms[0].team?.id, "tov")
        XCTAssertEqual(vms[0].riderName, "AMATEUR Juan")
    }

    func testTeamsInClassIncluyeElEquipoOverride() {
        let byTeamOverride: [String: Team] = ["tov": team("tov", "Alfa Override")]
        let rows = [row(rank: 1, bib: "999", globalRiderId: nil, teamId: "tov", sortOrder: 0)]
        XCTAssertEqual(
            UciResultsLogic.teamsInClass(rows: rows, byDorsal: [:], byRider: [:], byTeamOverride: byTeamOverride),
            ["Alfa Override"]
        )
    }

    func testOverrideDeEquipoAplicaALaFilaColapsadaDeCRE() {
        let byDorsal: [Int: ResolvedRider] = [
            1: ResolvedRider(name: "Líder", countryCode: "es", teamName: "Equipo Startlist",
                             team: team("ts", "Equipo Startlist"), globalRiderId: "g1"),
            2: ResolvedRider(name: "Gregario", countryCode: "es", teamName: "Equipo Startlist",
                             team: team("ts", "Equipo Startlist"), globalRiderId: "g2"),
        ]
        let byTeamOverride: [String: Team] = ["tov": team("tov", "Equipo Override")]
        let rows = [
            row(rank: 1, bib: "1", timeText: "1:00:00", teamId: "tov", sortOrder: 0),
            row(rank: 1, bib: "2", timeText: "1:00:00", teamId: "tov", sortOrder: 1),
        ]
        let teams = UciResultsLogic.collapseTtt(rows: rows, byDorsal: byDorsal, isEn: false, byTeamOverride: byTeamOverride)
        XCTAssertEqual(teams.count, 1)
        XCTAssertEqual(teams[0].teamName, "Equipo Override")
        XCTAssertEqual(teams[0].team?.id, "tov")
    }

    // ── applyCancelledStages: etapa cancelada ─────────────────────────────
    // Espejo 1:1 de UciResultsLogicTest.kt (Android).

    private func uciStage(_ id: String, _ stageNumber: Int?, _ classKind: String, raceDayId: String? = nil) -> RaceUciStage {
        RaceUciStage(id: id, raceId: "r1", raceDayId: raceDayId, classKind: classKind, stageNumber: stageNumber, keepForWeb: true)
    }

    private func stageDay(_ id: String, _ stageNumber: Int?, _ dateKey: String,
                          cancelled: Bool = false, rest: Bool = false, start: String? = nil) -> UciResultsLogic.StageDay {
        UciResultsLogic.StageDay(id: id, stageNumber: stageNumber, dateKey: dateKey,
                                 isCancelledDay: cancelled, isRestDay: rest, neutralStartTimeUtc: start)
    }

    private func day(
        _ stageNumber: Int?, _ dateKey: String,
        cancelled: Bool = false, rest: Bool = false, start: String? = nil
    ) -> UciResultsLogic.StageDay {
        UciResultsLogic.StageDay(
            id: "d\(stageNumber ?? -1)-\(dateKey)-\(start ?? "")",
            stageNumber: stageNumber, dateKey: dateKey,
            isCancelledDay: cancelled, isRestDay: rest, neutralStartTimeUtc: start
        )
    }

    func test_cancelledStage_showsNoticeAndCarriesPreviousGenerals() {
        // Caso real: Qinghai 2026 E6 cancelada, E5 con gc/points/kom.
        let stages = [
            uciStage("s5", 5, "stage"), uciStage("gc5", 5, "gc"),
            uciStage("p5", 5, "points"), uciStage("k5", 5, "kom"),
        ]
        let days = [day(5, "2026-07-15"), day(6, "2026-07-16", cancelled: true)]
        let out = UciResultsLogic.applyCancelledStages(stages, days: days)

        let s6 = out.filter { $0.stageNumber == 6 }
        XCTAssertEqual(s6.count, 4)
        XCTAssertTrue(s6.first { $0.classKind == "stage" }!.isCancelledStage)
        XCTAssertEqual(Set(s6.filter { !$0.isCancelledStage }.map(\.classKind)), ["gc", "points", "kom"])
        XCTAssertTrue(s6.filter { !$0.isCancelledStage }.allSatisfy { $0.carriedFromStage == 5 })
        XCTAssertEqual(out.filter { $0.stageNumber == 5 }.count, 4)
    }

    func test_cancelledStage_withoutPreviousRacedStage_showsOnlyNotice() {
        let days = [day(1, "2026-02-13", cancelled: true), day(2, "2026-02-14")]
        let out = UciResultsLogic.applyCancelledStages([], days: days, raceId: "r1")
        let s1 = out.filter { $0.stageNumber == 1 }
        XCTAssertEqual(s1.count, 1)
        XCTAssertTrue(s1[0].isCancelledStage)
        XCTAssertEqual(s1[0].raceId, "r1")
    }

    func test_cancelledStage_ignoresItsOwnDumpedClassifications() {
        let stages = [uciStage("gc4", 4, "gc"), uciStage("k5", 5, "kom")]
        let days = [day(4, "2026-07-14"), day(5, "2026-07-15", cancelled: true)]
        let out = UciResultsLogic.applyCancelledStages(stages, days: days)
        XCTAssertNil(out.first { $0.id == "k5" && $0.carriedFromStage == nil })
        XCTAssertEqual(Set(out.filter { $0.stageNumber == 5 }.map(\.classKind)), ["stage", "gc"])
    }

    func test_previousStage_skipsRestDaysAndOtherCancelledStages() {
        let stages = [uciStage("gc3", 3, "gc")]
        let days = [
            day(3, "2026-07-13"),
            day(nil, "2026-07-14", rest: true),
            day(4, "2026-07-15", cancelled: true),
            day(5, "2026-07-16", cancelled: true),
        ]
        let out = UciResultsLogic.applyCancelledStages(stages, days: days)
        XCTAssertEqual(out.first { $0.stageNumber == 4 && $0.classKind == "gc" }?.carriedFromStage, 3)
        XCTAssertEqual(out.first { $0.stageNumber == 5 && $0.classKind == "gc" }?.carriedFromStage, 3)
    }

    func test_doubleSector_cancelledBCarriesItsOwnA() {
        // Doble sector 3A/3B: MISMO stageNumber 3, distinto raceDayId, distinta hora.
        let stages = [uciStage("gcA", 3, "gc", raceDayId: "d3a")]
        let days = [
            stageDay("d3a", 3, "2026-07-13", start: "2026-07-13T08:00:00Z"),                    // sector A
            stageDay("d3b", 3, "2026-07-13", cancelled: true, start: "2026-07-13T15:00:00Z"),   // sector B, cancelado
        ]
        let out = UciResultsLogic.applyCancelledStages(stages, days: days)
        let bGc = out.first { $0.raceDayId == "d3b" && $0.classKind == "gc" }
        XCTAssertEqual(bGc?.carriedFromStage, 3)
        XCTAssertEqual(bGc?.carriedFromSuffix, "A")
        // El gc del sector A (raceDayId distinto del cancelado) NO se descarta.
        XCTAssertNotNil(out.first { $0.id == "gcA" && $0.raceDayId == "d3a" })
        XCTAssertTrue(out.first { $0.raceDayId == "d3b" && $0.classKind == "stage" }!.isCancelledStage)
    }

    func test_doubleSector_cancelledBDoesNotDropAsOwnClassifications() {
        // El descarte es por raceDayId (el SECTOR), no por número: la etapa del
        // sector A (mismo stageNumber 3) sobrevive al cancelarse el B.
        let stages = [
            uciStage("stageA", 3, "stage", raceDayId: "d3a"),
            uciStage("gcA", 3, "gc", raceDayId: "d3a"),
        ]
        let days = [
            stageDay("d3a", 3, "2026-07-13", start: "2026-07-13T08:00:00Z"),
            stageDay("d3b", 3, "2026-07-13", cancelled: true, start: "2026-07-13T15:00:00Z"),
        ]
        let out = UciResultsLogic.applyCancelledStages(stages, days: days)
        XCTAssertNotNil(out.first { $0.id == "stageA" })
        XCTAssertNotNil(out.first { $0.id == "gcA" })
    }

    func test_sectorSuffixMap_assignsABByStartTime() {
        let days = [
            stageDay("d3b", 3, "2026-07-13", start: "2026-07-13T15:00:00Z"),
            stageDay("d3a", 3, "2026-07-13", start: "2026-07-13T09:00:00Z"),
            stageDay("d2", 2, "2026-07-12", start: "2026-07-12T10:00:00Z"),
        ]
        let (suffixByDayId, sectoredNums) = UciResultsLogic.sectorSuffixMap(days)
        XCTAssertTrue(sectoredNums.contains(3))
        XCTAssertFalse(sectoredNums.contains(2))
        XCTAssertEqual(suffixByDayId["d3a"], "A")
        XCTAssertEqual(suffixByDayId["d3b"], "B")
        XCTAssertNil(suffixByDayId["d2"])
    }

    func test_resultStageEntryKey_buildsSectorAwareKeys() {
        let suffix = ["d3a": "A", "d3b": "B"]
        let sectored: Set<Int> = [3]
        XCTAssertEqual(UciResultsLogic.resultStageEntryKey(nil, nil, suffix, sectored), "final")
        XCTAssertEqual(UciResultsLogic.resultStageEntryKey(2, "d2", suffix, sectored), "2")
        XCTAssertEqual(UciResultsLogic.resultStageEntryKey(3, "d3a", suffix, sectored), "3A")
        XCTAssertEqual(UciResultsLogic.resultStageEntryKey(3, "d3b", suffix, sectored), "3B")
        XCTAssertEqual(UciResultsLogic.resultStageEntryKey(3, nil, suffix, sectored), "3")
    }

    func test_parseResultStageKey_splitsKeys() {
        XCTAssertNil(UciResultsLogic.parseResultStageKey("final").stageNumber)
        XCTAssertEqual(UciResultsLogic.parseResultStageKey("3").stageNumber, 3)
        XCTAssertEqual(UciResultsLogic.parseResultStageKey("3").suffix, "")
        XCTAssertEqual(UciResultsLogic.parseResultStageKey("3A").stageNumber, 3)
        XCTAssertEqual(UciResultsLogic.parseResultStageKey("3A").suffix, "A")
        XCTAssertEqual(UciResultsLogic.parseResultStageKey("0").stageNumber, 0)
    }

    func test_noCancelledStages_leavesListUntouched() {
        let stages = [uciStage("s1", 1, "stage"), uciStage("gc1", 1, "gc")]
        let days = [day(1, "2026-07-11"), day(2, "2026-07-12")]
        XCTAssertEqual(UciResultsLogic.applyCancelledStages(stages, days: days), stages)
    }
}
