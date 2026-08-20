package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.RaceUciResultRow
import app.calendariociclismo.android.data.model.ResolvedRider
import app.calendariociclismo.android.data.model.Team
import org.junit.Assert.*
import org.junit.Test

/**
 * Port de los casos clave de `js/resultados.js`: normalización de tiempos/gaps,
 * puntos, IRM, y el colapso de CRE (variantes A y B).
 */
class UciResultsLogicTest {

    // Helper: fila de resultado con lo mínimo.
    private fun row(
        rank: Int? = null,
        bib: String? = null,
        timeText: String? = null,
        gapText: String? = null,
        points: Int? = null,
        uciPoints: Double? = null,
        resultValue: String? = null,
        irm: String? = null,
        riderDisplay: String? = null,
        globalRiderId: String? = null,
        teamId: String? = null,
        sortOrder: Int = 0,
    ) = RaceUciResultRow(
        stageRef = "s", raceId = "r", rank = rank, rankText = null, bib = bib,
        riderDisplay = riderDisplay, globalRiderId = globalRiderId, teamId = teamId,
        resultValue = resultValue,
        timeText = timeText, gapText = gapText, points = points, uciPoints = uciPoints, irm = irm,
        sortOrder = sortOrder,
    )

    @Test
    fun `los puntos UCI se propagan sin mezclarse con los puntos de la clasificacion`() {
        val individual = UciResultsLogic.buildIndividualRows(
            rows = listOf(row(rank = 1, points = 50, uciPoints = 125.0)),
            classKind = "points",
            isTeams = false,
            byDorsal = emptyMap(),
            isEn = false,
        ).single()
        assertEquals("50", individual.valueText)
        assertEquals(125.0, individual.uciPoints)

        val ttt = UciResultsLogic.collapseTtt(
            rows = listOf(
                row(rank = 1, bib = "1", timeText = "20:00", uciPoints = 12.5),
                row(bib = "2", timeText = "20:10", uciPoints = 12.5),
            ),
            byDorsal = emptyMap(),
            isEn = false,
        ).single()
        assertEquals(12.5, ttt.uciPoints)
        assertEquals(listOf(12.5, 12.5), ttt.riders.map { it.uciPoints })
    }

    // Helper: equipo canónico con lo mínimo (chapa irrelevante para la lógica).
    private fun team(id: String, name: String, aliases: String? = null) = Team(
        id = id, name = name, badgeTorsoCenter = "#000000", badgeTorsoSides = "#000000",
        badgeShorts = "#000000", badgeInnerCircle = null, headerBg = "#000000",
        headerText = "#ffffff", nameAliases = aliases,
    )

    // ── timeToSeconds / secondsToGap / formatGap ───────────────────

    @Test
    fun `timeToSeconds parsea los tres formatos`() {
        assertEquals(41, UciResultsLogic.timeToSeconds("41"))
        assertEquals(116, UciResultsLogic.timeToSeconds("1:56"))
        assertEquals(3761, UciResultsLogic.timeToSeconds("1:02:41"))
        assertNull(UciResultsLogic.timeToSeconds(null))
        assertNull(UciResultsLogic.timeToSeconds("abc"))
        assertNull(UciResultsLogic.timeToSeconds(""))
    }

    @Test
    fun `secondsToGap usa la convencion de prensa`() {
        assertEquals("+7\"", UciResultsLogic.secondsToGap(7))
        assertEquals("+1'38\"", UciResultsLogic.secondsToGap(98))
        assertEquals("+1:02:41", UciResultsLogic.secondsToGap(3761))
        assertNull(UciResultsLogic.secondsToGap(null as Int?))
        assertNull(UciResultsLogic.secondsToGap(-3))
    }

    @Test
    fun `formatGap normaliza gaps UCI crudos`() {
        assertEquals("+41\"", UciResultsLogic.formatGap("+41"))
        assertEquals("+1'56\"", UciResultsLogic.formatGap("+1:56"))
        assertEquals("+35'09\"", UciResultsLogic.formatGap("+35:09"))
        // Ya formateado → intacto.
        assertEquals("+1'38\"", UciResultsLogic.formatGap("+1'38\""))
    }

    // ── REASIGNACIÓN DE COMISARIOS: gap 0 FUERA del bloque de cabeza ───────
    // Caso real (Baloise Ladies Tour 2026 et.5): incidente en los últimos 3 km → a la
    // corredora se le acredita el tiempo del grupo, pero conserva su puesto por orden
    // de llegada. Su fila NUNCA es m.t.: se pinta el gap explícito (+0").
    @Test
    fun `reasignacion de comisarios conserva el gap explicito`() {
        val rows = listOf(
            row(rank = 1, bib = "34", timeText = "2:42:24"),
            row(rank = 2, bib = "53", gapText = "+00"),
            row(rank = 3, bib = "6", gapText = "+00"),
            row(rank = 4, bib = "95", gapText = "+1:33"),
            row(rank = 5, bib = "21", gapText = "+00"),   // reasignada, la última
        )
        val vms = UciResultsLogic.buildIndividualRows(
            rows = rows, classKind = "stage", isTeams = false, byDorsal = emptyMap(), isEn = false,
        )
        assertEquals(UciResultsLogic.ValueKind.WINNER_TIME, vms[0].valueKind)
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vms[1].valueKind)  // bloque de cabeza
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vms[2].valueKind)  // bloque de cabeza
        assertEquals("+1'33\"", vms[3].valueText)
        // La reasignada: gap explícito, NO m.t.
        assertEquals(UciResultsLogic.ValueKind.GAP, vms[4].valueKind)
        assertEquals("+0\"", vms[4].valueText)
    }

    // ── irmLabel ───────────────────────────────────────────────────

    @Test
    fun `irmLabel mapea ES y EN`() {
        assertEquals("ABN", UciResultsLogic.irmLabel("DNF", isEn = false))
        assertEquals("DNF", UciResultsLogic.irmLabel("DNF", isEn = true))
        assertEquals("NS", UciResultsLogic.irmLabel("DNS", isEn = false))
        assertEquals("FC", UciResultsLogic.irmLabel("OTL", isEn = false))
        assertEquals("EXP", UciResultsLogic.irmLabel("DSQ", isEn = false))
        // ABD = variante UCI de DNF → misma etiqueta.
        assertEquals("ABN", UciResultsLogic.irmLabel("ABD", isEn = false))
        assertEquals("DNF", UciResultsLogic.irmLabel("ABD", isEn = true))
        // Código desconocido → se devuelve tal cual.
        assertEquals("XYZ", UciResultsLogic.irmLabel("XYZ", isEn = false))
        assertEquals("", UciResultsLogic.irmLabel(null, isEn = false))
    }

    // ── isAbandonIrm: abandono real vs ruido ───────────────────────

    @Test
    fun `isAbandonIrm distingue abandono real de ruido`() {
        assertTrue(UciResultsLogic.isAbandonIrm("DNF"))
        assertTrue(UciResultsLogic.isAbandonIrm("ABD"))
        assertTrue(UciResultsLogic.isAbandonIrm("DNS"))
        assertTrue(UciResultsLogic.isAbandonIrm("OTL"))
        assertTrue(UciResultsLogic.isAbandonIrm("DSQ"))
        // 'LAP' (doblada) es RUIDO, no abandono.
        assertFalse(UciResultsLogic.isAbandonIrm("LAP"))
        assertFalse(UciResultsLogic.isAbandonIrm(null))
        assertFalse(UciResultsLogic.isAbandonIrm(""))
    }

    // ── pointsOf ───────────────────────────────────────────────────

    @Test
    fun `pointsOf usa points o el entero de resultValue o timeText`() {
        assertEquals(30, UciResultsLogic.pointsOf(row(points = 30)))
        assertEquals(25, UciResultsLogic.pointsOf(row(resultValue = "25")))
        assertEquals(12, UciResultsLogic.pointsOf(row(timeText = "12")))
        assertNull(UciResultsLogic.pointsOf(row(timeText = "5:40:29")))
    }

    // ── buildIndividualRows: gaps ABSOLUTOS (caso A) ───────────────

    @Test
    fun `gaps derivados de tiempos absolutos`() {
        val rows = listOf(
            row(rank = 1, timeText = "5:00:00"),
            row(rank = 2, timeText = "5:00:07"),
            row(rank = 3, timeText = "5:01:38"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false)
        assertEquals(UciResultsLogic.ValueKind.WINNER_TIME, vms[0].valueKind)
        assertEquals("5:00:00", vms[0].valueText)
        assertEquals(UciResultsLogic.ValueKind.GAP, vms[1].valueKind)
        assertEquals("+7\"", vms[1].valueText)
        assertEquals("+1'38\"", vms[2].valueText)
    }

    // ── buildIndividualRows: gaps DISFRAZADOS (caso B) ─────────────

    @Test
    fun `gaps disfrazados en HH MM SS sin signo`() {
        // El rank 1 trae su tiempo total; el resto trae el GAP en HH:MM:SS sin '+'.
        val rows = listOf(
            row(rank = 1, timeText = "5:00:00"),
            row(rank = 2, timeText = "00:00:07"),   // < ganador → es un gap
            row(rank = 3, timeText = "00:01:38"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false)
        assertEquals("5:00:00", vms[0].valueText)
        assertEquals("+7\"", vms[1].valueText)
        assertEquals("+1'38\"", vms[2].valueText)
    }

    @Test
    fun `gap cero se marca como mismo tiempo`() {
        val rows = listOf(
            row(rank = 1, timeText = "4:00:00"),
            row(rank = 2, gapText = "+0"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false)
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vms[1].valueKind)
    }

    @Test
    fun `IRM deja la celda de valor vacia y pone la etiqueta en el badge`() {
        val rows = listOf(
            row(rank = 1, timeText = "4:00:00"),
            row(irm = "DNF", riderDisplay = "ABANDONA Pepe"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false)
        assertTrue(vms[1].isOut)
        assertEquals(UciResultsLogic.ValueKind.EMPTY, vms[1].valueKind)
        assertEquals("ABN", vms[1].rankBadge)
        assertNull(vms[1].rank)
    }

    // ── rank 1 con irm de RUIDO (LAP) — la ganadora SÍ encabeza ────

    @Test
    fun `rank 1 con LAP gana y los gaps se derivan del minimo de cabeza`() {
        // Caso real: Dwars door de Westhoek 2026. La ganadora (rank 1) llega con
        // irm='LAP' (doblada) y SIN timeText. El grueso que cruzó con ella marca
        // 00:00:00 → cabeza=0 → m.t./+gap correctos. Carrera de un día (cabeza 0):
        // su celda de tiempo queda VACÍA (no se inventa "0:00:00").
        val rows = listOf(
            row(rank = 1, bib = "25", irm = "LAP", timeText = null, riderDisplay = "VENTURELLI"),
            row(rank = 2, bib = "30", timeText = "00:00:00"),
            row(rank = 3, bib = "31", timeText = "00:00:51"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false)
        // La ganadora: encabeza con su número (no etiqueta), no está "out", celda vacía.
        assertEquals(1, vms[0].rank)
        assertNull(vms[0].rankBadge)
        assertFalse(vms[0].isOut)
        assertEquals(UciResultsLogic.ValueKind.EMPTY, vms[0].valueKind)
        assertEquals("", vms[0].valueText)
        // El 2º cruzó con ella → mismo tiempo (m.t.). El 3º → +51".
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vms[1].valueKind)
        assertEquals(UciResultsLogic.ValueKind.GAP, vms[2].valueKind)
        assertEquals("+51\"", vms[2].valueText)
    }

    @Test
    fun `rank 1 con LAP y tiempo de cabeza significativo muestra ese tiempo`() {
        // Variante con tiempo absoluto real (etapa por tiempo). La ganadora trae LAP
        // sin timeText, pero el grupo de cabeza tiene un tiempo > 0 → se le rotula ese.
        val rows = listOf(
            row(rank = 1, bib = "25", irm = "LAP", timeText = null),
            row(rank = 2, bib = "30", timeText = "4:30:00"),
            row(rank = 3, bib = "31", timeText = "4:30:10"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false)
        assertEquals(UciResultsLogic.ValueKind.WINNER_TIME, vms[0].valueKind)
        assertEquals("4:30:00", vms[0].valueText)
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vms[1].valueKind)   // cruzó con ella
        assertEquals("+10\"", vms[2].valueText)
    }

    // ── rank 1 con ABANDONO real (DNS) — el ganador es el 2º ───────

    @Test
    fun `rank 1 con DNS es espurio y el ganador real es el rank 2`() {
        // Caso real: Vuelta a Colombia Femenina et.3. La UCI deja rank 1 a Flórez con
        // irm='DNS' y sin tiempo; el ganador real es el rank 2 (03:32:40).
        val rows = listOf(
            row(rank = 1, bib = "1", irm = "DNS", timeText = null, riderDisplay = "FLOREZ"),
            row(rank = 2, bib = "2", timeText = "03:32:40", riderDisplay = "GANADORA"),
            row(rank = 3, bib = "3", timeText = "03:33:31"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false)
        // El rank 1 DNS: # rotulado "NS" (no "1"), fila out, celda vacía, sin número.
        assertNull(vms[0].rank)
        assertEquals("NS", vms[0].rankBadge)
        assertTrue(vms[0].isOut)
        assertEquals(UciResultsLogic.ValueKind.EMPTY, vms[0].valueKind)
        // Un rank 1 abandonado NO es winnerRow → el tiempo de cabeza cae al MENOR de
        // los clasificados (el del rank 2). El rank 2 NO recibe el estilo de ganador
        // (no es winnerRow): su gap respecto al cabeza es 0 → m.t. (igual que la web).
        assertEquals(2, vms[1].rank)
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vms[1].valueKind)
        // El rank 3 → gap respecto al cabeza (03:33:31 − 03:32:40 = 51").
        assertEquals(UciResultsLogic.ValueKind.GAP, vms[2].valueKind)
        assertEquals("+51\"", vms[2].valueText)
    }

    @Test
    fun `puntos usan cabecera de puntos y no estilo de tiempo`() {
        val rows = listOf(
            row(rank = 1, resultValue = "50"),
            row(rank = 2, points = 30),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "points", false, emptyMap(), isEn = false)
        assertEquals(UciResultsLogic.ValueKind.POINTS, vms[0].valueKind)
        assertEquals("50", vms[0].valueText)
        assertEquals("30", vms[1].valueText)
    }

    @Test
    fun `nombre y equipo se reconstruyen por dorsal`() {
        val byDorsal = mapOf(
            11 to ResolvedRider("Tadej Pogačar", "si", "UAE Team Emirates", null),
        )
        val rows = listOf(row(rank = 1, bib = "11", timeText = "4:00:00", riderDisplay = "POGACAR Tadej"))
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, byDorsal, isEn = false)
        assertEquals("Tadej Pogačar", vms[0].riderName)
        assertEquals("UAE Team Emirates", vms[0].teamName)
        assertEquals("si", vms[0].countryCode)
    }

    @Test
    fun `fallback a riderDisplay si el dorsal no casa`() {
        val rows = listOf(row(rank = 1, bib = "999", timeText = "4:00:00", riderDisplay = "DESCONOCIDO Juan"))
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false)
        assertEquals("DESCONOCIDO Juan", vms[0].riderName)
    }

    // ── CRI: helpers de tiempo truncado (cleanTimeText & cía.) ─────

    @Test
    fun `cleanTimeText recorta horas a cero y decimales enteros fuera`() {
        assertEquals("6:36", UciResultsLogic.cleanTimeText("0:06:36"))
        assertEquals("30:36", UciResultsLogic.cleanTimeText("00:30:36"))
        // Decimales FUERA (el tiempo oficial se cuenta en segundos enteros).
        assertEquals("1:04", UciResultsLogic.cleanTimeText("1:04.869"))
        assertEquals("3:35", UciResultsLogic.cleanTimeText("3:35.12"))
        // Sin horas a cero ni decimales → intacto.
        assertEquals("45:53", UciResultsLogic.cleanTimeText("45:53"))
        assertEquals("4:35:42", UciResultsLogic.cleanTimeText("4:35:42"))
        assertEquals("", UciResultsLogic.cleanTimeText(null))
        assertEquals("", UciResultsLogic.cleanTimeText(""))
    }

    @Test
    fun `secondsToGap con decimales trunca a segundos enteros`() {
        assertEquals("+36\"", UciResultsLogic.secondsToGap(36.98))
        assertEquals("+1\"", UciResultsLogic.secondsToGap(1.99))
        assertNull(UciResultsLogic.secondsToGap(-0.5))
        assertNull(UciResultsLogic.secondsToGap(null as Double?))
    }

    @Test
    fun `secondsToAbsText sin horas a cero y en segundos enteros`() {
        assertEquals("6:36", UciResultsLogic.secondsToAbsText(396.0))
        assertEquals("45:53", UciResultsLogic.secondsToAbsText(2753.0))
        assertEquals("1:05:05", UciResultsLogic.secondsToAbsText(3905.0))
        // Truncado (no redondeo): 396.9 → 6:36.
        assertEquals("6:36", UciResultsLogic.secondsToAbsText(396.9))
        assertEquals("", UciResultsLogic.secondsToAbsText(null))
        assertEquals("", UciResultsLogic.secondsToAbsText(-1.0))
    }

    @Test
    fun `secondsToPressTime usa notacion de prensa truncada`() {
        // "20:52.99" → 1252.99 → 20'52" (truncado, segundos enteros).
        assertEquals("20'52\"", UciResultsLogic.secondsToPressTime(1252.99))
        assertEquals("6'36\"", UciResultsLogic.secondsToPressTime(396.0))
        assertEquals("45'53\"", UciResultsLogic.secondsToPressTime(2753.0))
        // ≥1h → mismo escalón H:MM:SS que secondsToGap.
        assertEquals("1:05:05", UciResultsLogic.secondsToPressTime(3905.0))
        assertEquals("", UciResultsLogic.secondsToPressTime(null))
        assertEquals("", UciResultsLogic.secondsToPressTime(-1.0))
    }

    // ── CRI: gate isIttStage ───────────────────────────────────────

    @Test
    fun `isIttStage exige ITT o jornada itt y solo etapa o final de un dia`() {
        // Etapa de una carrera por etapas con RaceTypeCode ITT.
        assertTrue(UciResultsLogic.isIttStage("stage", false, "ITT", null, 4, false))
        // CRI de un día: bloque final SIN raceType (gc + stageNumber null) + jornada itt.
        assertTrue(UciResultsLogic.isIttStage("gc", false, null, "itt", null, true))
        // La GC del día de una etapa CRI NO cambia (acumulada → gaps normales).
        assertFalse(UciResultsLogic.isIttStage("gc", false, "ITT", null, 4, false))
        assertFalse(UciResultsLogic.isIttStage("gc", false, null, "itt", 4, false))
        // Etapa en línea → no.
        assertFalse(UciResultsLogic.isIttStage("stage", false, "RR", null, 4, false))
        assertFalse(UciResultsLogic.isIttStage("stage", false, null, null, 4, false))
        // Puntos/montaña/equipos → nunca.
        assertFalse(UciResultsLogic.isIttStage("points", false, "ITT", null, 4, false))
        assertFalse(UciResultsLogic.isIttStage("teams", true, "ITT", null, 4, false))
        // gc final de un día pero la carrera NO es de un día → no.
        assertFalse(UciResultsLogic.isIttStage("gc", false, null, "itt", null, false))
    }

    // ── CRI: diferencias sobre tiempos truncados (como en línea) ───

    @Test
    fun `CRI canonica gaps sobre enteros truncando cada tiempo`() {
        // Espec Dani: 20:52.99 / 20:53.00 / 20:53.05 → 20'52" / +1" / m.t.
        // El gap se calcula truncando CADA tiempo (20:52 y 20:53 → +1", no +0");
        // el 3º comparte gap (+1") y el filtro/display lo rotula m.t. (pipeline
        // normal de en línea, gap idéntico al de la fila de arriba).
        val rows = listOf(
            row(rank = 1, timeText = "20:52.99"),
            row(rank = 2, timeText = "20:53.00"),
            row(rank = 3, timeText = "20:53.05"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false, isItt = true)
        assertEquals(UciResultsLogic.ValueKind.WINNER_TIME, vms[0].valueKind)
        assertEquals("20'52\"", vms[0].valueText)
        assertEquals(UciResultsLogic.ValueKind.GAP, vms[1].valueKind)
        assertEquals("+1\"", vms[1].valueText)
        assertEquals("+1\"", vms[2].valueText)
        // rowGap relleno → participan del m.t. dinámico del filtro por equipo.
        assertEquals("+1\"", vms[1].rowGap)
        assertEquals("+1\"", vms[2].rowGap)
    }

    @Test
    fun `CRI con tiempos absolutos enteros deriva gaps como en linea`() {
        // Caso real: Boucles de la Mayenne 2026, prólogo → 6'36"/+1"/+6"/m.t./+7"
        // (el m.t. del 4º lo pone el display al compartir gap con el 3º).
        val rows = listOf(
            row(rank = 1, timeText = "0:06:36"),
            row(rank = 2, timeText = "0:06:37"),
            row(rank = 3, timeText = "0:06:42"),
            row(rank = 4, timeText = "0:06:42"),
            row(rank = 5, timeText = "0:06:43"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false, isItt = true)
        assertEquals("6'36\"", vms[0].valueText)
        assertEquals("+1\"", vms[1].valueText)
        assertEquals("+6\"", vms[2].valueText)
        assertEquals("+6\"", vms[3].valueText)
        assertEquals("+7\"", vms[4].valueText)
    }

    @Test
    fun `CRI con milesimas trunca cada tiempo antes de restar`() {
        // Caso real: Tour de Estonia 2026, prólogo → 1'04"/+2"/m.t./+3".
        val rows = listOf(
            row(rank = 1, timeText = "1:04.869"),
            row(rank = 2, timeText = "1:06.124"),
            row(rank = 3, timeText = "1:06.953"),
            row(rank = 4, timeText = "1:07.300"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false, isItt = true)
        assertEquals("1'04\"", vms[0].valueText)
        assertEquals("+2\"", vms[1].valueText)
        assertEquals("+2\"", vms[2].valueText)
        assertEquals("+3\"", vms[3].valueText)
    }

    @Test
    fun `CRI gap entero publicado fluye por el pipeline normal`() {
        // Caso real: Giro 2026, et.10 (CRI). Ganador "45:53" + gap crudo "+1:53"
        // → 45'53" / +1'53" (notación de prensa, como una etapa en línea).
        val rows = listOf(
            row(rank = 1, timeText = "45:53"),
            row(rank = 2, gapText = "+1:53"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false, isItt = true)
        assertEquals("45'53\"", vms[0].valueText)
        assertEquals(UciResultsLogic.ValueKind.GAP, vms[1].valueKind)
        assertEquals("+1'53\"", vms[1].valueText)
    }

    @Test
    fun `CRI gap publicado con decimas se deriva de los tiempos truncados`() {
        // Caso real: Tour of the Gila 2026 (gap decimal publicado "+36.98").
        // floor(ganador+gap) − floor(ganador) → +37", no +36" (truncar el gap
        // estaría mal). Ganador "32:30.83" → 32'30".
        val rows = listOf(
            row(rank = 1, timeText = "32:30.83"),
            row(rank = 2, gapText = "+36.98"),
            row(rank = 3, gapText = "+51.99"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false, isItt = true)
        assertEquals("32'30\"", vms[0].valueText)
        assertEquals("+37\"", vms[1].valueText)
        assertEquals("+52\"", vms[2].valueText)
    }

    @Test
    fun `CRI gap decimal exacto se trunca via formatGap`() {
        // Caso real: Tour de Romandía 2026, prólogo → 3'35"/+6"/m.t./+7". El gap
        // "+6.00" es entero (6.0) → no pasa por el floor de tiempos; formatGap lo
        // trunca a +6". El "+7.18" sí se deriva de los tiempos truncados.
        val rows = listOf(
            row(rank = 1, timeText = "3:35.12"),
            row(rank = 2, gapText = "+6.00"),
            row(rank = 3, gapText = "+6.00"),
            row(rank = 4, gapText = "+7.18"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false, isItt = true)
        assertEquals("3'35\"", vms[0].valueText)
        assertEquals("+6\"", vms[1].valueText)
        assertEquals("+6\"", vms[2].valueText)
        assertEquals("+7\"", vms[3].valueText)
    }

    @Test
    fun `CRI mismo tiempo truncado que el ganador es mt`() {
        // 2º con el MISMO tiempo truncado que el ganador → gap 0 → m.t. estático.
        val rows = listOf(
            row(rank = 1, timeText = "20:52.99"),
            row(rank = 2, timeText = "20:52.995"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false, isItt = true)
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vms[1].valueKind)
    }

    @Test
    fun `CRI un timeText menor que el ganador es un gap disfrazado`() {
        // Sin gapText: el fetcher guardó el gap COMO timeText ("00:00:27" = +27s).
        // Un tiempo menor que el del ganador es imposible → se trata como gap.
        val rows = listOf(
            row(rank = 1, timeText = "00:30:36"),
            row(rank = 2, timeText = "00:00:27"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false, isItt = true)
        assertEquals("30'36\"", vms[0].valueText)
        assertEquals("+27\"", vms[1].valueText)
    }

    @Test
    fun `CRI los abandonos siguen con celda vacia y etiqueta`() {
        val rows = listOf(
            row(rank = 1, timeText = "0:06:36"),
            row(irm = "DNF", riderDisplay = "ABANDONA Pepe"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false, isItt = true)
        assertEquals(UciResultsLogic.ValueKind.EMPTY, vms[1].valueKind)
        assertEquals("ABN", vms[1].rankBadge)
    }

    @Test
    fun `sin isItt una etapa en linea conserva gaps y mt`() {
        // Regresión: la convención de crono NO toca las etapas en línea ni las
        // generales (isItt=false): gaps derivados y m.t. como siempre.
        val rows = listOf(
            row(rank = 1, timeText = "4:35:42"),
            row(rank = 2, timeText = "4:35:42"),
            row(rank = 3, timeText = "4:36:43"),
        )
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, emptyMap(), isEn = false)
        assertEquals("4:35:42", vms[0].valueText)
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vms[1].valueKind)
        assertEquals("+1'01\"", vms[2].valueText)
    }

    // ── normalizeTeamName / findMatchingTeam (pestaña Equipos) ─────

    @Test
    fun `normalizeTeamName minusculas sin acentos y sin stopwords`() {
        assertEquals("lotto intermarche", UciResultsLogic.normalizeTeamName("LOTTO INTERMARCHE"))
        assertEquals("lotto intermarche", UciResultsLogic.normalizeTeamName("Lotto Intermarché"))
        // "pro", "cycling" y "team" son stopwords.
        assertEquals("tudor", UciResultsLogic.normalizeTeamName("TUDOR PRO CYCLING TEAM"))
        // El separador '|' se pliega a espacio; "a" NO es stopword.
        assertEquals("visma lease a bike", UciResultsLogic.normalizeTeamName("TEAM VISMA | LEASE A BIKE"))
        assertEquals("red bull bora hansgrohe", UciResultsLogic.normalizeTeamName("RED BULL - BORA - HANSGROHE"))
        assertEquals("", UciResultsLogic.normalizeTeamName(null))
        assertEquals("", UciResultsLogic.normalizeTeamName("Team"))   // solo stopwords
    }

    @Test
    fun `findMatchingTeam casa nombres crudos de la fuente contra el catalogo`() {
        // Casos reales del ARA 2026 (riderDisplay de Tissot vs nombre canónico).
        val teams = listOf(
            team("t1", "Tudor"),
            team("t2", "Visma | Lease a Bike"),
            team("t3", "UAE Team Emirates-XRG"),
            team("t4", "Lotto Intermarché"),
            // Alias multilínea: el nombre histórico solo casa vía nameAliases.
            team("t5", "Decathlon CMA CGM", aliases = "Decathlon\nAG2R La Mondiale"),
        )
        assertEquals("t1", UciResultsLogic.findMatchingTeam("TUDOR PRO CYCLING TEAM", teams)?.id)
        assertEquals("t2", UciResultsLogic.findMatchingTeam("TEAM VISMA | LEASE A BIKE", teams)?.id)
        assertEquals("t3", UciResultsLogic.findMatchingTeam("UAE TEAM EMIRATES XRG", teams)?.id)
        assertEquals("t4", UciResultsLogic.findMatchingTeam("LOTTO INTERMARCHE", teams)?.id)
        assertEquals("t5", UciResultsLogic.findMatchingTeam("AG2R LA MONDIALE", teams)?.id)
        assertNull(UciResultsLogic.findMatchingTeam("EQUIPO FANTASMA", teams))
        assertNull(UciResultsLogic.findMatchingTeam(null, teams))
        assertNull(UciResultsLogic.findMatchingTeam("Tudor", emptyList()))
    }

    @Test
    fun `findMatchingTeam casa los 22 equipos reales del ARA 2026`() {
        // Verificación con datos REALES: los 22 riderDisplay de la clasificación de
        // equipos del Tour Auvergne-Rhône-Alpes 2026 (fuente Tissot) contra los 22
        // equipos canónicos de su startlist (names + nameAliases tal cual en BD).
        val raceTeams = listOf(
            team("alpecin", "Alpecin-Premier Tech", aliases = "Alpecin"),
            team("bahrain", "Bahrain Victorious", aliases = "Bahrain"),
            team("cajarural", "Caja Rural-Seguros RGA", aliases = "Caja Rural"),
            team("cofidis", "Cofidis"),
            team("decathlon", "Decathlon CMA CGM", aliases = "Decathlon\nDecathlon CMA CGM Development"),
            team("ef", "EF Education-EasyPost", aliases = "Education First\nEF"),
            team("groupama", "Groupama-FDJ United", aliases = "Groupama FDJ\nGroupama"),
            team("jayco", "Jayco Alula", aliases = "Jayco"),
            team("lidl", "Lidl-Trek", aliases = "Lidl Trek\nLidl"),
            team("lotto", "Lotto Intermarché", aliases = "Lotto-Intermarché\\nLotto - Intermarché\\nLotto Dstny"),
            team("movistar", "Movistar", aliases = "Movistar Team"),
            team("netcompany", "Netcompany INEOS", aliases = "Net Company\nNetcompany-INEOS"),
            team("nsn", "NSN", aliases = "NSN Cycling Team"),
            team("picnic", "Picnic PostNL", aliases = "Picnic"),
            team("redbull", "Red Bull-BORA-hansgrohe", aliases = "Red Bull BORA\nRed Bull"),
            team("soudal", "Soudal Quick-Step", aliases = "Soudal\nSoudal-Quick Step\nSoudal Quick Step"),
            team("total", "TotalEnergies", aliases = "Total\nTotal Energies"),
            team("tudor", "Tudor", aliases = "Tudor Pro Cycling"),
            team("uae", "UAE Team Emirates-XRG", aliases = "UAE Team Emirates\nUAE Emirates\nUAE"),
            team("unox", "Uno-X Mobility", aliases = "Uno-X"),
            team("visma", "Visma | Lease a Bike", aliases = "Visma\nVisma | Lease a Bike Development"),
            team("xds", "XDS Astana"),
        )
        val expected = mapOf(
            "ALPECIN-PREMIER TECH" to "alpecin",
            "BAHRAIN VICTORIOUS" to "bahrain",
            "CAJA RURAL-SEGUROS RGA" to "cajarural",
            "COFIDIS" to "cofidis",
            "DECATHLON CMA CGM TEAM" to "decathlon",
            "EF EDUCATION - EASYPOST" to "ef",
            "GROUPAMA-FDJ UNITED" to "groupama",
            "LIDL-TREK" to "lidl",
            "LOTTO INTERMARCHE" to "lotto",
            "MOVISTAR TEAM" to "movistar",
            "NETCOMPANY INEOS CYCLING TEAM" to "netcompany",
            "NSN CYCLING TEAM" to "nsn",
            "RED BULL - BORA - HANSGROHE" to "redbull",
            "SOUDAL QUICK-STEP" to "soudal",
            "TEAM JAYCO ALULA" to "jayco",
            "TEAM PICNIC POSTNL" to "picnic",
            "TEAM VISMA | LEASE A BIKE" to "visma",
            "TOTALENERGIES" to "total",
            "TUDOR PRO CYCLING TEAM" to "tudor",
            "UAE TEAM EMIRATES XRG" to "uae",
            "UNO-X MOBILITY" to "unox",
            "XDS ASTANA TEAM" to "xds",
        )
        expected.forEach { (raw, teamId) ->
            assertEquals("riderDisplay '$raw'", teamId, UciResultsLogic.findMatchingTeam(raw, raceTeams)?.id)
        }
    }

    @Test
    fun `findMatchingTeam cae a contencion con minimo de 4 caracteres`() {
        val teams = listOf(team("t1", "Groupama-FDJ United"), team("t2", "NSN"))
        // "groupama fdj" ⊂ "groupama fdj united" → contención.
        assertEquals("t1", UciResultsLogic.findMatchingTeam("GROUPAMA-FDJ", teams)?.id)
        // "nsn" tiene <4 caracteres → NO entra en contención (evita ruido).
        assertNull(UciResultsLogic.findMatchingTeam("NSN MOBILITY", teams))
    }

    @Test
    fun `pestana equipos casa riderDisplay para chapa y nombre canonico`() {
        // Espejo del render web (resultados.js): fila de equipos = riderDisplay
        // crudo sin dorsal; casada → nombre del catálogo + chapa; sin casar → crudo.
        val raceTeams = listOf(
            team("t1", "Groupama-FDJ United"),
            team("t2", "Visma | Lease a Bike"),
        )
        val rows = listOf(
            row(rank = 1, riderDisplay = "GROUPAMA-FDJ UNITED", timeText = "28:56:59"),
            row(rank = 2, riderDisplay = "TEAM VISMA | LEASE A BIKE", gapText = "+44"),
            row(rank = 3, riderDisplay = "EQUIPO DESCONOCIDO", gapText = "+1:10"),
        )
        val vms = UciResultsLogic.buildIndividualRows(
            rows, "teams", true, emptyMap(), isEn = false, raceTeams = raceTeams,
        )
        assertEquals("Groupama-FDJ United", vms[0].riderName)
        assertEquals("t1", vms[0].team?.id)
        assertEquals(UciResultsLogic.ValueKind.WINNER_TIME, vms[0].valueKind)
        assertEquals("28:56:59", vms[0].valueText)
        assertEquals("Visma | Lease a Bike", vms[1].riderName)
        assertEquals("t2", vms[1].team?.id)
        assertEquals("+44\"", vms[1].valueText)
        // Sin casar → el crudo de la fuente, sin chapa.
        assertEquals("EQUIPO DESCONOCIDO", vms[2].riderName)
        assertNull(vms[2].team)
        assertEquals("+1'10\"", vms[2].valueText)
    }

    // ── isTttStage ─────────────────────────────────────────────────

    @Test
    fun `isTttStage detecta CRE variante A (ranks compartidos)`() {
        val rows = listOf(
            row(rank = 1, bib = "1"), row(rank = 1, bib = "2"), row(rank = 1, bib = "3"),
            row(rank = 2, bib = "11"), row(rank = 2, bib = "12"), row(rank = 2, bib = "13"),
        )
        assertTrue(UciResultsLogic.isTttStage(rows, "stage", false, "ttt"))
        // Sin el tipo de jornada curado, 2 ranks compartidos no basta (exige ≥3).
        assertFalse(UciResultsLogic.isTttStage(rows, "stage", false, null))
    }

    @Test
    fun `isTttStage con estructura muy marcada se dispara sin tipo de jornada`() {
        // 3 puestos con ≥2 corredores → suficiente aunque no sepamos que es CRE.
        val rows = listOf(
            row(rank = 1, bib = "1"), row(rank = 1, bib = "2"),
            row(rank = 2, bib = "11"), row(rank = 2, bib = "12"),
            row(rank = 3, bib = "21"), row(rank = 3, bib = "22"),
        )
        assertTrue(UciResultsLogic.isTttStage(rows, "stage", false, null))
    }

    @Test
    fun `isTttStage detecta CRE variante B (solo el lider trae rank)`() {
        val rows = listOf(
            row(rank = 1, bib = "1"), row(rank = null, bib = "2"), row(rank = null, bib = "3"),
            row(rank = 2, bib = "11"), row(rank = null, bib = "12"), row(rank = null, bib = "13"),
        )
        assertTrue(UciResultsLogic.isTttStage(rows, "stage", false, "ttt"))
    }

    @Test
    fun `isTttStage no se dispara en una etapa individual normal`() {
        val rows = listOf(
            row(rank = 1, bib = "1", timeText = "4:00:00"),
            row(rank = 2, bib = "2", timeText = "4:00:05"),
            row(rank = 3, bib = "3", timeText = "4:00:10"),
        )
        assertFalse(UciResultsLogic.isTttStage(rows, "stage", false, "road"))
        // Tampoco en la pestaña de equipos (ya colapsada).
        assertFalse(UciResultsLogic.isTttStage(rows, "stage", true, "ttt"))
        // gc de una vuelta por etapas (stageNumber != null) no dispara aunque sea ttt.
        assertFalse(UciResultsLogic.isTttStage(rows, "gc", false, "ttt", stageNumber = 3, isOneDay = false))
        // gc de un día, pero sin estructura CRE (todos con rank único) → no dispara.
        assertFalse(UciResultsLogic.isTttStage(rows, "gc", false, "ttt", stageNumber = null, isOneDay = true))
    }

    @Test
    fun `isTttStage no colapsa una CRI con ex aequo reales`() {
        // CRI (primaryType='itt' / raceType='ITT') con 3 empates dobles: sin el guard,
        // sharedRanks=3 dispararía la rama estructural y la pintaría como CRE.
        // Caso real: Tour de Beauce 2026 etapa 4 (puestos 49, 51, 88 empatados).
        val rows = listOf(
            row(rank = 1, bib = "1", timeText = "0:10:04"),
            row(rank = 49, bib = "194", gapText = "+42"),
            row(rank = 49, bib = "94", gapText = "+42"),
            row(rank = 51, bib = "73", gapText = "+42"),
            row(rank = 51, bib = "64", gapText = "+42"),
            row(rank = 88, bib = "111", gapText = "+1:02"),
            row(rank = 88, bib = "93", gapText = "+1:02"),
        )
        // Por tipo de jornada curado.
        assertFalse(UciResultsLogic.isTttStage(rows, "stage", false, "itt"))
        // Por raceType de la etapa (jornada no mapeada).
        assertFalse(UciResultsLogic.isTttStage(rows, "stage", false, null, stageRaceType = "ITT"))
    }

    @Test
    fun `isTttStage detecta CRE de carrera de un dia (variante C, gc + isOneDay)`() {
        // Variante B con classKind='gc' — caso Ses Salines: líderes con rank, compañeros null.
        val rows = listOf(
            row(rank = 1, bib = "1"), row(rank = null, bib = "2"), row(rank = null, bib = "3"),
            row(rank = 2, bib = "11"), row(rank = null, bib = "12"), row(rank = null, bib = "13"),
        )
        assertTrue(UciResultsLogic.isTttStage(rows, "gc", false, "ttt", stageNumber = null, isOneDay = true))
        // Sin isOneDay no dispara (es una GC de vuelta por etapas).
        assertFalse(UciResultsLogic.isTttStage(rows, "gc", false, "ttt", stageNumber = null, isOneDay = false))
    }

    // ── teamsInClass ───────────────────────────────────────────────

    @Test
    fun `teamsInClass devuelve los equipos en orden alfabetico (case-insensitive)`() {
        val byDorsal = mapOf(
            1 to ResolvedRider("G1", "es", "Zeta Team", null),
            2 to ResolvedRider("G2", "es", "alfa squad", null),
            3 to ResolvedRider("G3", "fr", "Movistar", null),
            4 to ResolvedRider("G4", "fr", "alfa squad", null),
            5 to ResolvedRider("G5", "it", "", null),    // sin equipo → fuera
        )
        val rows = listOf(
            row(rank = 1, bib = "1", sortOrder = 0),     // Zeta (1º en filas)
            row(rank = 2, bib = "2", sortOrder = 1),     // alfa
            row(rank = 3, bib = "3", sortOrder = 2),     // Movistar
            row(rank = 4, bib = "4", sortOrder = 3),     // alfa (dup)
            row(rank = 5, bib = "5", sortOrder = 4),     // sin equipo
        )
        // Orden alfabético ignorando mayúsculas, no el orden de aparición.
        assertEquals(listOf("alfa squad", "Movistar", "Zeta Team"), UciResultsLogic.teamsInClass(rows, byDorsal))
    }

    // ── collapseTtt ────────────────────────────────────────────────

    @Test
    fun `collapseTtt variante A agrupa por equipo y calcula gaps de equipo`() {
        val byDorsal = mapOf(
            1 to ResolvedRider("A1", "es", "Equipo Alfa", null),
            2 to ResolvedRider("A2", "es", "Equipo Alfa", null),
            11 to ResolvedRider("B1", "fr", "Equipo Beta", null),
            12 to ResolvedRider("B2", "fr", "Equipo Beta", null),
        )
        val rows = listOf(
            row(rank = 1, bib = "1", timeText = "32:33.50", sortOrder = 0),
            row(rank = 1, bib = "2", timeText = "32:35.00", sortOrder = 1),
            row(rank = 2, bib = "11", timeText = "32:40.00", sortOrder = 2),
            row(rank = 2, bib = "12", timeText = "32:41.00", sortOrder = 3),
        )
        val teams = UciResultsLogic.collapseTtt(rows, byDorsal, isEn = false)
        assertEquals(2, teams.size)
        assertEquals("Equipo Alfa", teams[0].teamName)
        assertEquals(1, teams[0].rank)
        assertEquals(2, teams[0].riders.size)
        val winner = UciResultsLogic.tttWinnerSecs(teams)
        // 32:40 − 32:33 = 7" (truncando centésimas).
        assertEquals("+7\"", UciResultsLogic.tttGapBetween(teams[1].teamSecs, winner))
    }

    @Test
    fun `collapseTtt variante B (solo lider con rank) mantiene a los companeros en su equipo`() {
        val byDorsal = mapOf(
            1 to ResolvedRider("A1", "es", "Equipo Alfa", null),
            2 to ResolvedRider("A2", "es", "Equipo Alfa", null),
            3 to ResolvedRider("A3", "es", "Equipo Alfa", null),
        )
        val rows = listOf(
            row(rank = 1, bib = "1", timeText = "30:00.00", sortOrder = 0),
            row(rank = null, bib = "2", timeText = "30:00.00", sortOrder = 1),
            row(rank = null, bib = "3", timeText = "30:02.00", sortOrder = 2),
        )
        val teams = UciResultsLogic.collapseTtt(rows, byDorsal, isEn = false)
        assertEquals(1, teams.size)
        assertEquals(3, teams[0].riders.size)
        assertEquals(1, teams[0].rank)
    }

    // ── Fallback por globalRiderId (CN sin startlist con dorsal casable) ──
    // Espejo del `byRider` de la web: cuando la fila NO casa por dorsal pero
    // trae globalRiderId, su bandera/equipo/ficha salen de riders_* (campeonatos
    // nacionales y demás volcados in-house sin inscritos curados).

    @Test
    fun `byRider rescata bandera, equipo y nombre cuando no casa por dorsal`() {
        val wt = team("t-wt", "Movistar Team").copy(category = "WT")
        // Sin startlist (byDorsal vacío) → todo se resuelve por byRider.
        val byRider = mapOf(
            "castrillo-pablo" to ResolvedRider(
                "Pablo Castrillo", "es", "Movistar Team", wt, "castrillo-pablo"),
        )
        val rows = listOf(
            // riderDisplay crudo "APELLIDO Nombre"; bib NULL (no casa por dorsal).
            row(rank = 1, bib = null, timeText = "30:00", riderDisplay = "CASTRILLO Pablo",
                globalRiderId = "castrillo-pablo"),
        )
        val vms = UciResultsLogic.buildIndividualRows(
            rows, "stage", false, emptyMap(), isEn = false, byRider = byRider,
        )
        assertEquals("es", vms[0].countryCode)             // bandera de la ficha
        assertEquals("Movistar Team", vms[0].teamName)     // equipo actual
        assertEquals("Pablo Castrillo", vms[0].riderName)  // nombre de la ficha gana al display crudo
        assertEquals("t-wt", vms[0].team?.id)              // chapa del equipo actual
    }

    @Test
    fun `byDorsal tiene prioridad sobre byRider`() {
        // La misma fila casa por dorsal Y tiene ficha: gana la startlist curada.
        val byDorsal = mapOf(
            7 to ResolvedRider("Por Dorsal", "fr", "Equipo Startlist", null, "gid-7"),
        )
        val byRider = mapOf(
            "gid-7" to ResolvedRider("Por Ficha", "es", "Equipo Ficha", null, "gid-7"),
        )
        val rows = listOf(row(rank = 1, bib = "7", timeText = "30:00", globalRiderId = "gid-7"))
        val vms = UciResultsLogic.buildIndividualRows(
            rows, "stage", false, byDorsal, isEn = false, byRider = byRider,
        )
        assertEquals("Por Dorsal", vms[0].riderName)
        assertEquals("Equipo Startlist", vms[0].teamName)
        assertEquals("fr", vms[0].countryCode)
    }

    @Test
    fun `byRider sin ficha deja la fila pelada`() {
        // Fila sin dorsal y sin entrada en byRider (corredor amateur fuera del
        // catálogo): se mantiene con el riderDisplay crudo, sin bandera/equipo.
        val rows = listOf(
            row(rank = 1, bib = null, timeText = "30:00", riderDisplay = "AMATEUR Juan",
                globalRiderId = "no-ficha"),
        )
        val vms = UciResultsLogic.buildIndividualRows(
            rows, "stage", false, emptyMap(), isEn = false, byRider = emptyMap(),
        )
        assertEquals("AMATEUR Juan", vms[0].riderName)
        assertEquals("", vms[0].teamName)
        assertEquals("", vms[0].countryCode)
    }

    @Test
    fun `teamsInClass usa byRider cuando no hay startlist`() {
        val byRider = mapOf(
            "g1" to ResolvedRider("R1", "es", "Zeta Team", null, "g1"),
            "g2" to ResolvedRider("R2", "fr", "alfa squad", null, "g2"),
        )
        val rows = listOf(
            row(rank = 1, bib = null, globalRiderId = "g1", sortOrder = 0),
            row(rank = 2, bib = null, globalRiderId = "g2", sortOrder = 1),
        )
        assertEquals(
            listOf("alfa squad", "Zeta Team"),
            UciResultsLogic.teamsInClass(rows, emptyMap(), byRider),
        )
    }

    // ── Override manual de equipo (mig. 112) ───────────────────────

    @Test
    fun `override de equipo gana al dorsal en buildIndividualRows`() {
        val byDorsal = mapOf(
            11 to ResolvedRider("Corredor X", "es", "Equipo Startlist", team("ts", "Equipo Startlist"), "gx"),
        )
        val byTeamOverride = mapOf("tov" to team("tov", "Equipo Override"))
        val rows = listOf(row(rank = 1, bib = "11", timeText = "4:00:00", teamId = "tov"))
        val vms = UciResultsLogic.buildIndividualRows(
            rows, "stage", false, byDorsal, isEn = false,
            byTeamOverride = byTeamOverride,
        )
        assertEquals("Equipo Override", vms[0].teamName)
        assertEquals("tov", vms[0].team?.id)
        // El corredor (nombre/bandera/ficha) sigue saliendo del dorsal.
        assertEquals("Corredor X", vms[0].riderName)
        assertEquals("es", vms[0].countryCode)
    }

    @Test
    fun `sin override el equipo sigue resolviendose por dorsal`() {
        val byDorsal = mapOf(
            11 to ResolvedRider("Corredor X", "es", "Equipo Startlist", team("ts", "Equipo Startlist"), "gx"),
        )
        val rows = listOf(row(rank = 1, bib = "11", timeText = "4:00:00"))
        val vms = UciResultsLogic.buildIndividualRows(rows, "stage", false, byDorsal, isEn = false)
        assertEquals("Equipo Startlist", vms[0].teamName)
        assertEquals("ts", vms[0].team?.id)
    }

    @Test
    fun `override de equipo aplica sin startlist ni ficha`() {
        // Fila sin dorsal casable ni globalRiderId: el override es la única fuente.
        val byTeamOverride = mapOf("tov" to team("tov", "Equipo Override"))
        val rows = listOf(row(rank = 1, bib = "999", riderDisplay = "AMATEUR Juan", timeText = "4:00:00", teamId = "tov"))
        val vms = UciResultsLogic.buildIndividualRows(
            rows, "stage", false, emptyMap(), isEn = false,
            byTeamOverride = byTeamOverride,
        )
        assertEquals("Equipo Override", vms[0].teamName)
        assertEquals("tov", vms[0].team?.id)
        assertEquals("AMATEUR Juan", vms[0].riderName)
    }

    @Test
    fun `teamsInClass incluye el equipo override`() {
        val byTeamOverride = mapOf("tov" to team("tov", "Alfa Override"))
        val rows = listOf(
            row(rank = 1, bib = "999", globalRiderId = null, teamId = "tov", sortOrder = 0),
        )
        assertEquals(
            listOf("Alfa Override"),
            UciResultsLogic.teamsInClass(rows, emptyMap(), emptyMap(), byTeamOverride),
        )
    }

    @Test
    fun `override de equipo aplica a la fila colapsada de CRE`() {
        val byDorsal = mapOf(
            1 to ResolvedRider("Líder", "es", "Equipo Startlist", team("ts", "Equipo Startlist"), "g1"),
            2 to ResolvedRider("Gregario", "es", "Equipo Startlist", team("ts", "Equipo Startlist"), "g2"),
        )
        val byTeamOverride = mapOf("tov" to team("tov", "Equipo Override"))
        val rows = listOf(
            row(rank = 1, bib = "1", timeText = "1:00:00", teamId = "tov", sortOrder = 0),
            row(rank = 1, bib = "2", timeText = "1:00:00", teamId = "tov", sortOrder = 1),
        )
        val teams = UciResultsLogic.collapseTtt(rows, byDorsal, isEn = false, byTeamOverride = byTeamOverride)
        assertEquals(1, teams.size)
        assertEquals("Equipo Override", teams[0].teamName)
        assertEquals("tov", teams[0].team?.id)
    }

    // ── applyCancelledStages: etapa cancelada ─────────────────────────────

    private fun uciStage(
        id: String,
        stageNumber: Int?,
        classKind: String,
        raceDayId: String? = null,
    ) = app.calendariociclismo.android.data.model.RaceUciStage(
        id = id, raceId = "r1", classKind = classKind, stageNumber = stageNumber,
        keepForWeb = true, raceDayId = raceDayId,
    )

    private fun stageDay(
        id: String, stageNumber: Int?, dateKey: String,
        cancelled: Boolean = false, rest: Boolean = false, start: String? = null,
    ) = UciResultsLogic.StageDay(id, stageNumber, dateKey, cancelled, rest, start)

    private fun day(
        stageNumber: Int?,
        dateKey: String,
        cancelled: Boolean = false,
        rest: Boolean = false,
        start: String? = null,
    ) = UciResultsLogic.StageDay(
        id = "d$stageNumber-$dateKey-${start ?: ""}",
        stageNumber = stageNumber,
        dateKey = dateKey,
        isCancelledDay = cancelled,
        isRestDay = rest,
        neutralStartTimeUtc = start,
    )

    @Test
    fun `cancelled stage shows notice and carries previous generals`() {
        // Caso real: Qinghai 2026 E6 cancelada, E5 con gc/points/kom.
        val stages = listOf(
            uciStage("s5", 5, "stage"), uciStage("gc5", 5, "gc"),
            uciStage("p5", 5, "points"), uciStage("k5", 5, "kom"),
        )
        val days = listOf(day(5, "2026-07-15"), day(6, "2026-07-16", cancelled = true))
        val out = UciResultsLogic.applyCancelledStages(stages, days)

        val s6 = out.filter { it.stageNumber == 6 }
        // Marcador de "Etapa" + las 3 generales arrastradas (NO la de etapa).
        assertEquals(4, s6.size)
        assertTrue(s6.first { it.classKind == "stage" }.isCancelledStage)
        assertEquals(setOf("gc", "points", "kom"), s6.filter { !it.isCancelledStage }.map { it.classKind }.toSet())
        assertTrue(s6.filter { !it.isCancelledStage }.all { it.carriedFromStage == 5 })
        // La E5 sigue intacta.
        assertEquals(4, out.filter { it.stageNumber == 5 }.size)
    }

    @Test
    fun `cancelled stage without previous raced stage shows only the notice`() {
        // Cancelación en la etapa 1: no hay general que arrastrar.
        val days = listOf(day(1, "2026-02-13", cancelled = true), day(2, "2026-02-14"))
        val out = UciResultsLogic.applyCancelledStages(emptyList(), days, raceId = "r1")
        val s1 = out.filter { it.stageNumber == 1 }
        assertEquals(1, s1.size)
        assertTrue(s1[0].isCancelledStage)
        assertEquals("r1", s1[0].raceId)
    }

    @Test
    fun `cancelled stage ignores its own dumped classifications`() {
        // Si el cron volcó algo antes de la cancelación, no se muestra.
        val stages = listOf(
            uciStage("gc4", 4, "gc"),
            uciStage("k5", 5, "kom"),      // volcada en la etapa cancelada
        )
        val days = listOf(day(4, "2026-07-14"), day(5, "2026-07-15", cancelled = true))
        val out = UciResultsLogic.applyCancelledStages(stages, days)
        // La kom propia de la E5 desaparece; queda el marcador + la gc de la E4.
        assertNull(out.firstOrNull { it.id == "k5" })
        assertEquals(setOf("stage", "gc"), out.filter { it.stageNumber == 5 }.map { it.classKind }.toSet())
    }

    @Test
    fun `previous stage skips rest days and other cancelled stages`() {
        val stages = listOf(uciStage("gc3", 3, "gc"))
        val days = listOf(
            day(3, "2026-07-13"),
            day(null, "2026-07-14", rest = true),
            day(4, "2026-07-15", cancelled = true),
            day(5, "2026-07-16", cancelled = true),
        )
        val out = UciResultsLogic.applyCancelledStages(stages, days)
        // Ambas canceladas arrastran la general de la 3 (la última CORRIDA).
        assertEquals(3, out.first { it.stageNumber == 4 && it.classKind == "gc" }.carriedFromStage)
        assertEquals(3, out.first { it.stageNumber == 5 && it.classKind == "gc" }.carriedFromStage)
    }

    @Test
    fun `double sector - cancelled B carries its own A, same stageNumber`() {
        // Doble sector 3A/3B: MISMO stageNumber 3, distinto raceDayId, distinta hora.
        // El sector B cancelado arrastra la general del sector A.
        val stages = listOf(uciStage("gcA", 3, "gc", raceDayId = "d3a"))
        val days = listOf(
            stageDay("d3a", 3, "2026-07-13", start = "2026-07-13T08:00:00Z"),                    // sector A
            stageDay("d3b", 3, "2026-07-13", cancelled = true, start = "2026-07-13T15:00:00Z"),  // sector B, cancelado
        )
        val out = UciResultsLogic.applyCancelledStages(stages, days)
        val bGc = out.first { it.raceDayId == "d3b" && it.classKind == "gc" }
        assertEquals(3, bGc.carriedFromStage)
        assertEquals("A", bGc.carriedFromSuffix)
        // El gc del sector A (raceDayId distinto del cancelado) NO se descarta.
        assertNotNull(out.firstOrNull { it.id == "gcA" && it.raceDayId == "d3a" })
        // Marcador de cancelación en el sector B.
        assertTrue(out.first { it.raceDayId == "d3b" && it.classKind == "stage" }.isCancelledStage)
    }

    @Test
    fun `double sector - cancelled B does not drop A's own dumped classifications`() {
        // Si el cron volcó la etapa del sector A (mismo stageNumber 3), no debe
        // borrarse al cancelarse el B: el descarte es por raceDayId, no por número.
        val stages = listOf(
            uciStage("stageA", 3, "stage", raceDayId = "d3a"),
            uciStage("gcA", 3, "gc", raceDayId = "d3a"),
        )
        val days = listOf(
            stageDay("d3a", 3, "2026-07-13", start = "2026-07-13T08:00:00Z"),
            stageDay("d3b", 3, "2026-07-13", cancelled = true, start = "2026-07-13T15:00:00Z"),
        )
        val out = UciResultsLogic.applyCancelledStages(stages, days)
        assertNotNull(out.firstOrNull { it.id == "stageA" })
        assertNotNull(out.firstOrNull { it.id == "gcA" })
    }

    // ── Dobles sectores: mapa/clave de agrupación ─────────────────────────

    @Test
    fun `sectorSuffixMap assigns A B by start time`() {
        val days = listOf(
            stageDay("d3b", 3, "2026-07-13", start = "2026-07-13T15:00:00Z"),
            stageDay("d3a", 3, "2026-07-13", start = "2026-07-13T09:00:00Z"),
            stageDay("d2", 2, "2026-07-12", start = "2026-07-12T10:00:00Z"),
        )
        val (suffixByDayId, sectoredNums) = UciResultsLogic.sectorSuffixMap(days)
        assertTrue(sectoredNums.contains(3))
        assertFalse(sectoredNums.contains(2))
        assertEquals("A", suffixByDayId["d3a"])
        assertEquals("B", suffixByDayId["d3b"])
        assertNull(suffixByDayId["d2"])
    }

    @Test
    fun `resultStageEntryKey builds sector-aware keys`() {
        val suffix = mapOf("d3a" to "A", "d3b" to "B")
        val sectored = setOf(3)
        assertEquals("final", UciResultsLogic.resultStageEntryKey(null, null, suffix, sectored))
        assertEquals("2", UciResultsLogic.resultStageEntryKey(2, "d2", suffix, sectored))
        assertEquals("3A", UciResultsLogic.resultStageEntryKey(3, "d3a", suffix, sectored))
        assertEquals("3B", UciResultsLogic.resultStageEntryKey(3, "d3b", suffix, sectored))
        // Sector sin raceDayId (volcado antes de crear la jornada) → número pelado.
        assertEquals("3", UciResultsLogic.resultStageEntryKey(3, null, suffix, sectored))
    }

    @Test
    fun `parseResultStageKey splits keys`() {
        assertEquals(null to "", UciResultsLogic.parseResultStageKey("final"))
        assertEquals(3 to "", UciResultsLogic.parseResultStageKey("3"))
        assertEquals(3 to "A", UciResultsLogic.parseResultStageKey("3A"))
        assertEquals(0 to "", UciResultsLogic.parseResultStageKey("0"))
    }

    @Test
    fun `no cancelled stages leaves the list untouched`() {
        val stages = listOf(uciStage("s1", 1, "stage"), uciStage("gc1", 1, "gc"))
        val days = listOf(day(1, "2026-07-11"), day(2, "2026-07-12"))
        assertEquals(stages, UciResultsLogic.applyCancelledStages(stages, days))
    }
}
