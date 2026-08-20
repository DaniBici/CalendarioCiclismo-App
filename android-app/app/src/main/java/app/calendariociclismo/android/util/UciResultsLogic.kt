package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.RaceUciResultRow
import app.calendariociclismo.android.data.model.RaceUciStage
import app.calendariociclismo.android.data.model.ResolvedRider
import app.calendariociclismo.android.data.model.Team
import kotlin.math.floor

/**
 * Lógica pura de las clasificaciones UCI in-house — port literal de los helpers
 * de `js/resultados.js`. Sin dependencias de Compose ni de Android: todo es
 * testeable con JUnit (ver `UciResultsLogicTest`).
 *
 * Aquí vive: normalización de tiempos/gaps, puntos, IRM (DNF/DNS/OTL/DSQ), la
 * detección y colapso de CRE, y la construcción de las filas individuales (con
 * el gap efectivo ya resuelto). El "m.t." dinámico al filtrar por equipo lo
 * decide la UI sobre las filas VISIBLES (igual que `applyTeamFilter` en la web).
 */
object UciResultsLogic {

    /** Orden de las pestañas de clasificación. */
    val CLASS_ORDER = listOf("stage", "gc", "points", "kom", "youth", "teams")

    /** Etiquetas IRM (no clasificados). Fuente única, espejo de `js/uci-irm.js`. */
    fun irmLabel(code: String?, isEn: Boolean): String {
        if (code.isNullOrEmpty()) return ""
        return when (code) {
            "DNF", "ABD" -> if (isEn) "DNF" else "ABN"   // ABD = variante UCI de DNF
            "DNS" -> if (isEn) "DNS" else "NS"
            "OTL" -> if (isEn) "OTL" else "FC"
            "DSQ" -> if (isEn) "DSQ" else "EXP"
            else -> code   // fallback si la UCI introduce un código nuevo
        }
    }

    /**
     * ¿El código `irm` marca a quien NO completó la prueba (abandono / no salida /
     * fuera de control / descalificación)? Estos códigos sobre el rank 1 significan
     * que ese puesto es espurio (el ganador real es el primer clasificado SIN irm).
     * Se opone a códigos de "ruido" como LAP (doblada), que la UCI cuelga a veces de
     * la propia ganadora — esos NO descalifican. Espejo de `isAbandonIrm` en uci-irm.js.
     */
    fun isAbandonIrm(code: String?): Boolean =
        !code.isNullOrEmpty() && code in ABANDON_CODES

    private val ABANDON_CODES = setOf("DNF", "ABD", "DNS", "OTL", "DSQ")

    // ── Tiempos / gaps (port de resultados.js L44–72) ──────────────────────

    /** "H:MM:SS" | "MM:SS" | "SS" → segundos (o null si no parsea). */
    fun timeToSeconds(txt: String?): Int? {
        if (txt.isNullOrBlank()) return null
        val parts = txt.trim().split(":").map { it.toIntOrNull() ?: return null }
        return parts.fold(0) { acc, n -> acc * 60 + n }
    }

    /**
     * segundos → gap con la convención de la prensa ciclista (PCS):
     *   <1min → +SS"   ·   <1h → +M'SS"   ·   ≥1h → +H:MM:SS
     */
    fun secondsToGap(sec: Int?): String? {
        if (sec == null || sec < 0) return null
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        val ss = s.toString().padStart(2, '0')
        return when {
            h > 0 -> "+$h:${m.toString().padStart(2, '0')}:$ss"
            m > 0 -> "+$m'$ss\""
            else -> "+$s\""
        }
    }

    /**
     * Variante decimal: segundos ENTEROS siempre (regla de carretera: el tiempo
     * oficial se trunca al segundo). El floor también mata el error flotante de
     * derivar con decimales. Espejo del `Math.floor` de `secondsToGap` web.
     */
    fun secondsToGap(sec: Double?): String? {
        if (sec == null || sec < 0) return null
        return secondsToGap(kotlin.math.floor(sec).toInt())
    }

    /**
     * Normaliza un gap al formato de prensa. La UCI publica los gaps con ':'
     * como separador y SIN unidades ("+41"=41s, "+1:56"=1m56s, "+35:09"=35m09s,
     * "+1:02:41"=1h02m41s) → re-emitir como +SS"/+M'SS"/+H:MM:SS. Si ya trae las
     * marcas de prensa (' o ") se devuelve tal cual. Decimal-aware (como el
     * timeToSeconds de la web): un gap decimal suelto se trunca ("+36.98"→+36").
     */
    fun formatGap(gap: String?): String? {
        if (gap.isNullOrBlank()) return gap
        val t = gap.trim()
        if (t.contains("'") || t.contains("\"")) return t
        val sec = tttToSeconds(t.removePrefix("+"))
        return if (sec != null) secondsToGap(sec) else t
    }

    /** segundos → tiempo absoluto "H:MM:SS" (inverso de timeToSeconds; sin '+'). */
    fun secondsToTimeText(sec: Int?): String {
        if (sec == null || sec < 0) return ""
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        return "$h:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}"
    }

    // ── CRI: presentación de tiempos truncados (port de resultados.js L83–114) ──

    private val LEADING_ZERO_HOURS = Regex("^0+:(?=\\d)")
    private val LEADING_ZERO_FIRST = Regex("^0(?=\\d:)")
    private val TRAILING_DECIMALS = Regex("\\.\\d+$")

    /**
     * Limpia un tiempo absoluto para PRESENTACIÓN: recorta el bloque de horas a
     * cero ("0:06:36"/"00:30:36" → "6:36"/"30:36"), el cero a la izquierda del
     * primer bloque y los DECIMALES enteros fuera ("1:04.869" → "1:04"): en
     * carretera el tiempo oficial se cuenta en segundos enteros (truncado). La UCI
     * publica los tiempos con formatos muy dispares (visto en las CRI del backfill).
     */
    fun cleanTimeText(txt: String?): String {
        if (txt.isNullOrBlank()) return ""
        var t = txt.trim()
        t = t.replace(LEADING_ZERO_HOURS, "")     // fuera el bloque de horas "0:"/"00:"
        t = t.replace(LEADING_ZERO_FIRST, "")     // "06:36" → "6:36"
        t = t.replace(TRAILING_DECIMALS, "")      // decimales fuera (segundos enteros)
        return t
    }

    /**
     * segundos → tiempo absoluto ("6:36" · "45:53" · "1:05:05"): sin horas a cero
     * y en segundos ENTEROS (truncado, regla de carretera).
     */
    fun secondsToAbsText(sec: Double?): String {
        if (sec == null || sec < 0) return ""
        val s0 = kotlin.math.floor(sec).toInt()
        val h = s0 / 3600
        val m = (s0 % 3600) / 60
        val s = s0 % 60
        val ss = s.toString().padStart(2, '0')
        return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$ss" else "$m:$ss"
    }

    /**
     * segundos (enteros) → tiempo absoluto en NOTACIÓN DE PRENSA: 20'52" (sub-hora;
     * ≥1h sigue el mismo escalón H:MM:SS que secondsToGap). Para el tiempo del
     * ganador de una CRI: "20:52.99" → 20'52" (truncado, segundos enteros).
     */
    fun secondsToPressTime(sec: Double?): String {
        if (sec == null || sec < 0) return ""
        val s0 = kotlin.math.floor(sec).toInt()
        val h = s0 / 3600
        val m = (s0 % 3600) / 60
        val s = s0 % 60
        if (h > 0) return "$h:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}"
        return "$m'${s.toString().padStart(2, '0')}\""
    }

    /**
     * CRI: señal doble — RaceTypeCode 'ITT' de DataRide en la etapa, o primaryType
     * 'itt' de la jornada (cubre las CRI de UN DÍA, que llegan con el bloque final
     * SIN raceType — p. ej. campeonatos CRI: classKind 'gc' + stageNumber null — Y
     * las que DataRide etiqueta mal, caso Tour of the Gila: IRR en todas). Aplica a
     * la clasificación de la etapa (o la final de un día); la GC del día y las
     * acumuladas siguen la lógica normal. Presentación (espec Dani 2026-06-10):
     * EXACTAMENTE como una etapa en línea — ganador con su tiempo OFICIAL (truncado
     * a segundos enteros, notación de prensa 20'52") y el resto con su diferencia
     * sobre los enteros (+1") y m.t. cuando el tiempo truncado coincide con el de
     * arriba: 20:52.99/20:53.00/20:53.05 → 20'52" / +1" / m.t. Espejo de la web.
     */
    fun isIttStage(
        classKind: String,
        isTeams: Boolean,
        stageRaceType: String?,
        raceDayPrimaryType: String?,
        stageNumber: Int?,
        isOneDay: Boolean,
    ): Boolean {
        val isTimeClass = !isPointsClass(classKind) && !isTeams
        return isTimeClass &&
            (stageRaceType == "ITT" || raceDayPrimaryType == "itt") &&
            (classKind == "stage" || (classKind == "gc" && stageNumber == null && isOneDay))
    }

    // ── Etapa CANCELADA: aviso + generales de la etapa anterior ────────────

    /**
     * Jornada mínima que necesita [applyCancelledStages] — evita depender del
     * modelo completo de RaceDay en la lógica pura (y en los tests).
     */
    data class StageDay(
        val id: String,
        val stageNumber: Int?,
        val dateKey: String?,
        val isCancelledDay: Boolean,
        val isRestDay: Boolean,
        val neutralStartTimeUtc: String? = null,
    )

    // ── Dobles sectores (etapa partida 3A/3B) ──────────────────────────────
    // Dos jornadas del mismo día comparten el MISMO entero stageNumber; se
    // distinguen por la hora de salida (A = la más temprana). Cada clasificación
    // lleva el raceDayId de SU sector → así 3A y 3B no se mezclan. Espejo de
    // `sectorSuffixMap`/`resultStageEntryKey` de js/services/races.js.

    /** raceDayId → sufijo ('A'/'B'…) y conjunto de stageNumber que son doble sector. */
    fun sectorSuffixMap(days: List<StageDay>): Pair<Map<String, String>, Set<Int>> {
        val groups = HashMap<String, MutableList<StageDay>>()
        for (d in days) {
            val sn = d.stageNumber ?: continue
            if (d.isRestDay) continue
            groups.getOrPut("${d.dateKey ?: ""}|$sn") { mutableListOf() }.add(d)
        }
        val suffixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        val suffixByDayId = HashMap<String, String>()
        val sectoredNums = HashSet<Int>()
        for (grp in groups.values) {
            if (grp.size < 2) continue
            val sorted = grp.sortedWith(
                compareBy({ it.neutralStartTimeUtc ?: "￿" }, { it.id })
            )
            sorted.forEachIndexed { i, d ->
                suffixByDayId[d.id] = if (i < suffixes.length) suffixes[i].toString() else ""
            }
            grp.first().stageNumber?.let { sectoredNums.add(it) }
        }
        return suffixByDayId to sectoredNums
    }

    /** Clave de agrupación sector-consciente: 'final' | '3' | '3A'. */
    fun resultStageEntryKey(
        stageNumber: Int?,
        raceDayId: String?,
        suffixByDayId: Map<String, String>,
        sectoredNums: Set<Int>,
    ): String {
        if (stageNumber == null) return "final"
        val sfx = if (stageNumber in sectoredNums && raceDayId != null) suffixByDayId[raceDayId].orEmpty() else ""
        return "$stageNumber$sfx"
    }

    /** Descompone una clave de entrada en (stageNumber, sufijo). */
    fun parseResultStageKey(key: String): Pair<Int?, String> {
        if (key == "final") return null to ""
        val m = Regex("^(\\d+)([A-Z]*)$").find(key) ?: return null to ""
        return m.groupValues[1].toInt() to m.groupValues[2]
    }

    /**
     * Una etapa CANCELADA no se corrió: sus propias clasificaciones (si el cron
     * llegó a volcar algo antes de la cancelación) NO se muestran, y su pantalla
     * se sintetiza — marcador de "Etapa" (que el render pinta como aviso de
     * cancelación) + las generales de la ETAPA ANTERIOR, porque la clasificación
     * no se movió. Sin etapa anterior con datos → solo el marcador.
     *
     * 100% PRESENTACIONAL: las mismas filas (mismo id de clasificación), no se
     * vuelca ni se duplica nada. Espejo de `js/resultados.js`.
     *
     * La "etapa anterior" es la anterior EN ORDEN CRONOLÓGICO (dateKey, luego
     * hora de salida) saltando descansos y otras canceladas. Eso cubre solo la
     * regla de los dobles sectores (la anterior de un sector B es su A; la del
     * día siguiente a un doble sector es el B): `stageNumber` es el MISMO entero
     * en A y B, así que solo el orden cronológico los distingue.
     *
     * @param stages las clasificaciones keepForWeb de la carrera.
     * @param days   las jornadas de la carrera (en cualquier orden: se ordenan aquí).
     * @return las clasificaciones a mostrar, con las canceladas ya sintetizadas.
     */
    fun applyCancelledStages(
        stages: List<RaceUciStage>,
        days: List<StageDay>,
        raceId: String = "",
    ): List<RaceUciStage> {
        val cancelled = days.filter { it.isCancelledDay && !it.isRestDay && it.stageNumber != null }
        if (cancelled.isEmpty()) return stages
        // Orden canónico: cronológico (dateKey, luego hora de salida). En un doble
        // sector esto ya distingue A de B aunque compartan stageNumber.
        val raced = days.filter { !it.isRestDay }
            .sortedWith(compareBy({ it.dateKey ?: "" }, { it.neutralStartTimeUtc ?: "" }))
        val (suffixByDayId, sectoredNums) = sectorSuffixMap(days)
        fun keyOf(st: RaceUciStage) = resultStageEntryKey(st.stageNumber, st.raceDayId, suffixByDayId, sectoredNums)
        val cancelledDayIds = cancelled.map { it.id }.toSet()
        // stageNumbers de canceladas NO sectorizadas (para el volcado sin raceDayId).
        val cancelledPlainNums = cancelled.mapNotNull { it.stageNumber }
            .filterNot { it in sectoredNums }.toSet()
        // La cancelada NO aporta sus propias clasificaciones: se descartan por
        // raceDayId (el SECTOR concreto) y, si el volcado no lo tiene, por
        // stageNumber SOLO cuando ese número no es doble sector.
        val kept = stages.filterNot { st ->
            (st.raceDayId != null && st.raceDayId in cancelledDayIds) ||
            (st.raceDayId == null && st.stageNumber != null && st.stageNumber in cancelledPlainNums)
        }
        val synthesized = mutableListOf<RaceUciStage>()
        for (day in cancelled) {
            val num = day.stageNumber ?: continue
            // Marcador de la pestaña "Etapa" (sin filas: lo pinta el aviso). id por
            // raceDayId → único aunque dos sectores del mismo número se cancelen.
            synthesized += RaceUciStage(
                id = "cancelled-${day.id}",
                raceId = stages.firstOrNull()?.raceId ?: raceId,
                raceDayId = day.id,
                classKind = "stage",
                stageNumber = num,
                keepForWeb = true,
                isCancelledStage = true,
            )
            // Etapa/sector anterior EN CARRERA, en orden cronológico (la del B es su A).
            val idx = raced.indexOfFirst { it.id == day.id }
            val prevDay = if (idx < 0) null else raced.take(idx).lastOrNull {
                !it.isCancelledDay && it.stageNumber != null
            }
            if (prevDay != null) {
                val prevKey = resultStageEntryKey(prevDay.stageNumber, prevDay.id, suffixByDayId, sectoredNums)
                val prevSfx = if (prevDay.stageNumber != null && prevDay.stageNumber in sectoredNums)
                    suffixByDayId[prevDay.id].orEmpty() else ""
                // Las copias se re-atribuyen al SECTOR cancelado (stageNumber + raceDayId
                // de la cancelada, criterio de agrupación) pero CONSERVAN su `id`: las
                // filas se piden por `id` → sigue leyendo las de la etapa anterior.
                synthesized += kept
                    .filter { keyOf(it) == prevKey && it.classKind != "stage" }
                    .map { it.copy(
                        stageNumber = num, raceDayId = day.id,
                        carriedFromStage = prevDay.stageNumber, carriedFromSuffix = prevSfx,
                    ) }
            }
        }
        return kept + synthesized
    }

    /** Valor de puntos: `points` o, si null, un entero en resultValue/timeText. */
    fun pointsOf(row: RaceUciResultRow): Int? {
        row.points?.let { return it }
        row.resultValue?.trim()?.toIntOrNull()?.let { return it }
        return row.timeText?.trim()?.toIntOrNull()
    }

    fun isPointsClass(classKind: String): Boolean =
        classKind == "points" || classKind == "kom"

    // ── Detección de CRE (crono por equipos) — port de L550–565 ────────────

    /**
     * La UCI publica la etapa de CRE como "Stage Classification" listando TODOS
     * los corredores agrupados por equipo. Hay que colapsarla a una fila por
     * equipo. No nos fiamos de `isTeamEvent` (la UCI lo marca true en TODAS las
     * clasificaciones de una etapa CRE). Señal = classKind='stage' (o 'gc' final
     * de un día — caso CRE de carrera de un día, variante C) + jornada CRE en
     * nuestro catálogo (primaryType='ttt'), corroborado por la estructura
     * (ranks compartidos [A] o muchos rank=null entre clasificados [B]).
     */
    fun isTttStage(
        rows: List<RaceUciResultRow>,
        classKind: String,
        isTeams: Boolean,
        raceDayPrimaryType: String?,
        stageNumber: Int? = null,
        isOneDay: Boolean = false,
        stageRaceType: String? = null,
    ): Boolean {
        val isEligibleKind = classKind == "stage" ||
            (classKind == "gc" && stageNumber == null && isOneDay)
        if (isTeams || !isEligibleKind) return false
        // Una jornada CRI (primaryType='itt') NUNCA es una crono por equipos: aunque
        // tenga ex aequo reales (varios corredores con el mismo tiempo al cronómetro →
        // mismo puesto), no se colapsa por equipos. Sin este guard, ≥3 empates en una
        // CRI disparan la rama estructural `sharedRanks >= 3` y la pintan como CRE.
        if (raceDayPrimaryType == "itt" || stageRaceType == "ITT") return false
        val classified = rows.filter { it.irm.isNullOrEmpty() }
        // [A] nº de puestos con ≥2 corredores.
        val sharedRanks = classified
            .mapNotNull { it.rank }
            .groupingBy { it }
            .eachCount()
            .count { it.value >= 2 }
        // [B] compañeros sin rank.
        val nullRanks = classified.count { it.rank == null }
        val structural = sharedRanks >= 2 || nullRanks >= 2
        val dayIsTtt = raceDayPrimaryType == "ttt"
        // Con el tipo de jornada curado basta la estructura; sin él, exigir una
        // estructura MUY marcada para no colapsar una crono individual con empates.
        return structural && (dayIsTtt || sharedRanks >= 3 || nullRanks >= 6)
    }

    // ── Colapso de CRE a una fila por equipo — port de renderTttStage L400 ──

    data class TttRiderRow(
        val name: String,
        val countryCode: String,
        val timeText: String?,
        val uciPoints: Double?,
        val irm: String?,
    )

    data class TttTeamRow(
        val rank: Int?,
        val teamName: String,
        val team: Team?,
        val teamTimeText: String?,
        /** Puntos UCI de la fila líder del equipo; null hasta que lleguen datos. */
        val uciPoints: Double?,
        /** Tiempo del equipo en segundos (centésimas truncadas al comparar). */
        val teamSecs: Double?,
        val riders: List<TttRiderRow>,
    )

    /** "M:SS.cc" | "H:MM:SS.cc" | "SS.cc" → segundos float (conserva centésimas). */
    fun tttToSeconds(txt: String?): Double? {
        if (txt.isNullOrBlank()) return null
        val parts = txt.trim().split(":").map { it.toDoubleOrNull() ?: return null }
        return parts.fold(0.0) { acc, n -> acc * 60 + n }
    }

    /** Gap entre dos tiempos de equipo, TRUNCANDO a segundos enteros antes de
     *  restar (la clasificación oficial cuenta segundos enteros). */
    fun tttGapBetween(teamSecs: Double?, winnerSecs: Double?): String? {
        if (teamSecs == null || winnerSecs == null) return null
        return secondsToGap(teamSecs.toInt() - winnerSecs.toInt())
    }

    /**
     * Agrupa las filas de una CRE por equipo (cubre las dos variantes UCI):
     *   A) todos los corredores del equipo comparten el rank del equipo;
     *   B) solo el líder trae rank, los compañeros van con rank=null detrás.
     * Recorre EN ORDEN (sortOrder) y abre equipo nuevo cuando el rank CAMBIA.
     * El equipo de cada fila se resuelve por dorsal (lo más fiable); si no hay
     * startlist (byDorsal vacío), se cae al arrastre por rank.
     */
    fun collapseTtt(
        rows: List<RaceUciResultRow>,
        byDorsal: Map<Int, ResolvedRider>,
        isEn: Boolean,
        byRider: Map<String, ResolvedRider> = emptyMap(),
        /** Override manual de equipo (mig. 112): el teamId del líder define el
         *  equipo de la fila colapsada, ganando a la resolución por dorsal. */
        byTeamOverride: Map<String, Team> = emptyMap(),
    ): List<TttTeamRow> {
        data class Group(var lead: RaceUciResultRow?, val riders: MutableList<RaceUciResultRow>)
        val order = ArrayList<String>()
        val byKey = LinkedHashMap<String, Group>()
        var prevRank: Int? = null
        var fallbackKey = 0
        var firstSeen = true

        for (r in rows) {
            val fromSl = r.dorsalInt?.let { byDorsal[it] }
            if (r.rank != null && (firstSeen || r.rank != prevRank)) fallbackKey++
            firstSeen = false
            val key = fromSl?.teamName?.takeIf { it.isNotEmpty() } ?: "__grp$fallbackKey"
            val g = byKey.getOrPut(key) { order.add(key); Group(null, ArrayList()) }
            if (g.lead == null && r.rank != null) g.lead = r
            g.riders.add(r)
            if (r.rank != null) prevRank = r.rank
        }

        val teamRows = order.map { key ->
            val g = byKey.getValue(key)
            val lead = g.lead ?: g.riders.first()
            val fromSl = lead.dorsalInt?.let { byDorsal[it] }
            val overrideTeam = lead.teamId?.let { byTeamOverride[it] }
            TttTeamRow(
                rank = g.lead?.rank,
                teamName = overrideTeam?.name
                    ?: fromSl?.teamName?.takeIf { it.isNotEmpty() }
                    ?: lead.riderDisplay.orEmpty(),
                team = overrideTeam ?: fromSl?.team,
                teamTimeText = g.lead?.timeText,
                uciPoints = g.lead?.uciPoints,
                teamSecs = g.lead?.let { tttToSeconds(it.timeText) },
                riders = g.riders.map { r ->
                    val fs = r.dorsalInt?.let { byDorsal[it] }
                    // Sin casar por dorsal → ficha por globalRiderId (bandera + nombre),
                    // igual que la web en las sub-filas de la CRE.
                    val fr = if (fs == null) r.globalRiderId?.let { byRider[it] } else null
                    val rider = fs ?: fr
                    TttRiderRow(
                        name = rider?.name?.takeIf { it.isNotEmpty() } ?: r.riderDisplay.orEmpty(),
                        countryCode = rider?.countryCode.orEmpty(),
                        timeText = r.timeText,
                        uciPoints = r.uciPoints,
                        irm = r.irm,
                    )
                },
            )
        }
        return teamRows
    }

    /** Tiempo del equipo ganador (rank 1) para calcular gaps de CRE. */
    fun tttWinnerSecs(teamRows: List<TttTeamRow>): Double? =
        teamRows.firstOrNull { it.rank == 1 && it.teamSecs != null }?.teamSecs

    // ── Matching de equipos por nombre (espejo de js/shared.js) ────────────

    /** Stopwords de nombre de equipo (las EFECTIVAS de `TEAM_STOPWORDS` en
     *  shared.js: los tokens llegan ya en minúsculas y sin acentos, así que las
     *  entradas acentuadas del set JS — 'féminin'/'féminine' — y '&' son inertes
     *  y no se portan). */
    private val TEAM_STOPWORDS = setOf(
        "pro", "procycling", "cycling", "team", "teams", "squad", "uci", "worldteam",
        "wt", "women", "womens", "feminin", "femenino",
        "continental", "development", "presented", "by", "the", "de", "la", "el", "of", "and",
    )

    private val COMBINING_MARKS = Regex("[\\u0300-\\u036f]")
    private val NON_ALNUM = Regex("[^a-z0-9]+")

    /** Normaliza un nombre de equipo para matching: minúsculas, sin acentos,
     *  solo letras/números, sin stopwords comunes. Port de `normalizeTeamName`. */
    fun normalizeTeamName(s: String?): String {
        if (s.isNullOrEmpty()) return ""
        val base = java.text.Normalizer.normalize(s.lowercase(), java.text.Normalizer.Form.NFD)
            .replace(COMBINING_MARKS, "")
            .replace(NON_ALNUM, " ")
            .trim()
        if (base.isEmpty()) return ""
        return base.split(" ").filter { it.isNotEmpty() && it !in TEAM_STOPWORDS }.joinToString(" ")
    }

    /** Busca en `teams` el equipo que corresponde al nombre crudo `teamName`
     *  (p. ej. "TEAM VISMA | LEASE A BIKE" de Tissot/UCI). Estrategia: coincidencia
     *  exacta normalizada (name + nameAliases) → subcadena. Port de `findMatchingTeam`. */
    fun findMatchingTeam(teamName: String?, teams: List<Team>): Team? {
        if (teamName.isNullOrEmpty() || teams.isEmpty()) return null
        val target = normalizeTeamName(teamName)
        if (target.isEmpty()) return null
        fun namesOf(t: Team): List<String> =
            (listOf(t.name) + (t.nameAliases ?: "").split("\n"))
                .map { normalizeTeamName(it) }
                .filter { it.isNotEmpty() }
        for (t in teams) {
            if (target in namesOf(t)) return t
        }
        // Fallback: contención (al menos 4 caracteres para evitar ruido).
        if (target.length >= 4) {
            for (t in teams) {
                val names = namesOf(t).filter { it.length >= 4 }
                if (names.any { it == target || it.contains(target) || target.contains(it) }) return t
            }
        }
        return null
    }

    // ── Filas individuales (etapa/general/jóvenes/puntos/montaña) ──────────

    /** Tipo del valor de la celda de resultado. */
    enum class ValueKind { WINNER_TIME, GAP, SAME_TIME, POINTS, RAW, EMPTY }

    /** Una fila individual ya resuelta para la UI. El gap "crudo" (rowGap) se
     *  usa para recalcular m.t. al filtrar por equipo. */
    data class ResultRowVM(
        val rank: Int?,
        /** Texto a mostrar en la columna # cuando no hay rank (IRM o "–"). */
        val rankBadge: String?,
        val isOut: Boolean,            // tiene IRM (DNF/DNS/OTL/DSQ)
        val riderName: String,
        val countryCode: String,
        val teamName: String,
        val team: Team?,
        /** Columna opcional entre identidad y resultado; null no reserva espacio. */
        val uciPoints: Double?,
        val valueKind: ValueKind,
        /** Valor a pintar (tiempo del ganador, gap, puntos, o crudo). */
        val valueText: String,
        /** Gap real de la fila (para el m.t. dinámico). Vacío si no aplica. */
        val rowGap: String,
    )

    /**
     * Construye las filas individuales de una clasificación NO-CRE, resolviendo
     * el corredor por dorsal y el gap efectivo (port de la lógica de
     * `renderClassification` en resultados.js L568–724, sin el filtro por equipo).
     *
     * La UCI publica los tiempos de forma inconsistente; se normalizan dos casos
     * (solo en clasificaciones por tiempo, y solo si NO viene gapText):
     *   A) TIEMPOS ABSOLUTOS → gap = tiempo − ganador.
     *   B) GAPS DISFRAZADOS: el rank 1 trae su tiempo total, el resto el gap en
     *      HH:MM:SS sin '+'. Señal: algún rank>1 con timeText < ganador.
     */
    fun buildIndividualRows(
        rows: List<RaceUciResultRow>,
        classKind: String,
        isTeams: Boolean,
        byDorsal: Map<Int, ResolvedRider>,
        isEn: Boolean,
        raceTeams: List<Team> = emptyList(),
        /** CRI (ver [isIttStage]): el ganador sale en notación de prensa truncada
         *  (20'52"); el resto fluye por el pipeline normal de gaps/m.t. */
        isItt: Boolean = false,
        /** Fallback por globalRiderId para las filas que NO casan por dorsal
         *  (carreras SIN startlist: campeonatos nacionales y demás volcados
         *  in-house sin inscritos curados) → bandera + equipo actual + ficha,
         *  igual que `byRider` en la web. Vacío = comportamiento previo. */
        byRider: Map<String, ResolvedRider> = emptyMap(),
        /** Override MANUAL de equipo (mig. 112): teamId → equipo canónico. Cuando
         *  la fila trae teamId, GANA a la resolución por dorsal/globalRiderId.
         *  Vacío = comportamiento previo. */
        byTeamOverride: Map<String, Team> = emptyMap(),
    ): List<ResultRowVM> {
        val isPts = isPointsClass(classKind)
        val isTimeClass = !isPts && !isTeams

        // El rank 1 puede traer un `irm`. Hay que distinguir dos cosas opuestas:
        //   · RUIDO (p. ej. irm='LAP' = doblada): la corredora SÍ ganó; la UCI cuelga
        //     el código por error. Caso real: Dwars door de Westhoek 2026 — la ganadora
        //     llegó con LAP y SIN timeText. Debe encabezar como ganadora.
        //   · ABANDONO real (DNF/DNS/OTL/DSQ/ABD): ese rank 1 es espurio (no compitió);
        //     el ganador real es el primer clasificado SIN irm. Caso real: Vuelta a
        //     Colombia Femenina — rank 1 con DNS, el tiempo de cabeza es el del rank 2.
        // → `winnerRow` solo cuenta como ganadora si su irm NO es de abandono.
        val rank1Row = rows.firstOrNull { it.rank == 1 }
        val winnerRow = rank1Row?.takeUnless { isAbandonIrm(it.irm) }
        // Clasificado a efectos de TIEMPO: el ganador (ruido aparte) o cualquier fila
        // con puesto sin irm. Un rank 1 con abandono NO cuenta.
        fun isRankedFinisher(r: RaceUciResultRow) =
            (winnerRow != null && r === winnerRow) || (r.rank != null && r.irm.isNullOrEmpty())
        // Si el ganador no trae timeText (el LAP de arriba), el tiempo de cabeza es el
        // MENOR de los clasificados: el grueso del grupo que cruzó con él marca 00:00:00
        // → winnerSec=0 y los gaps se derivan bien. En Colombia, ese mínimo es el rank 2.
        // Tiempos en Double vía tttToSeconds (espejo del timeToSeconds de la web,
        // donde Number() conserva decimales): las CRI cortas publican décimas/
        // centésimas ("20:52.99") que el parser entero no entiende. El gap oficial
        // se calcula sobre los enteros TRUNCANDO cada tiempo antes de restar.
        val minFinisherSec = if (isTimeClass) {
            rows.filter { isRankedFinisher(it) }.mapNotNull { tttToSeconds(it.timeText) }.minOrNull()
        } else null

        val winnerSec = if (isTimeClass) {
            tttToSeconds(winnerRow?.timeText) ?: minFinisherSec
        } else null
        val allTimed = isTimeClass && winnerSec != null &&
            rows.none { !it.gapText.isNullOrBlank() } &&
            rows.filter { it.rank != null && it !== winnerRow && it.irm.isNullOrEmpty() }
                .all { tttToSeconds(it.timeText) != null }
        val gapsDisguised = allTimed && rows.any {
            it.rank != null && it !== winnerRow && it.irm.isNullOrEmpty() &&
                (tttToSeconds(it.timeText) ?: Double.MAX_VALUE) < winnerSec!!
        }
        val deriveGaps = allTimed && !gapsDisguised

        // ¿Esta fila marca "mismo tiempo que la ganadora"? Mira el gap publicado y,
        // si no lo hay, el tiempo absoluto (cuando los gaps se derivan).
        fun isZeroGapRow(r: RaceUciResultRow): Boolean {
            val raw = r.gapText?.trim().orEmpty()
            if (raw.isNotEmpty()) {
                return tttToSeconds(raw.removePrefix("+")) == 0.0
            }
            if (!deriveGaps || winnerSec == null) return false
            val sec = tttToSeconds(r.timeText) ?: return false
            return floor(sec) == floor(winnerSec)
        }
        // Último índice del BLOQUE DE CABEZA: las filas que llegaron con la ganadora,
        // contiguas desde el rank 1. Una fila con gap 0 FUERA de ese bloque no cruzó
        // con el grupo: es una REASIGNACIÓN DE COMISARIOS (incidente en los últimos
        // 3 km → se le acredita el tiempo del grupo con el que rodaba, pero conserva
        // su puesto por orden de llegada; UCI 2.6.027). Caso real: Baloise Ladies Tour
        // 2026 et.5, Manly 97ª con el tiempo de la ganadora.
        // Esas filas NUNCA se colapsan a "m.t.": el m.t. es una abreviatura que sólo
        // significa algo dentro de un grupo contiguo en meta, y aquí mentiría sobre
        // cómo terminó. Se pinta su gap explícito (+0" incluido).
        val headBlockEnd: Int = run {
            if (!isTimeClass) return@run -1
            // Ancla = el primer CLASIFICADO real. Normalmente es winnerRow; si el rank 1
            // es un abandono espurio (DNS), el cabeza es el primer clasificado sin irm,
            // que marca el tiempo de referencia (mismo criterio que minFinisherSec).
            val w = rows.indexOfFirst { isRankedFinisher(it) }
            if (w < 0) return@run -1
            var last = w
            var i = w + 1
            while (i < rows.size) {
                val r = rows[i]
                // Los abandonos van al final y no rompen el bloque si aún no empezaron.
                if (r.rank == null || !r.irm.isNullOrEmpty()) break
                if (!isZeroGapRow(r)) break
                last = i
                i++
            }
            last
        }

        return rows.mapIndexed { rowIndex, r ->
            val fromSl = r.dorsalInt?.let { byDorsal[it] }
            // Sin casar por dorsal (carrera sin startlist): caer al enriquecido por
            // globalRiderId (bandera + equipo actual + ficha de riders_*). null si la
            // fila no tiene ficha (corredor amateur fuera del catálogo).
            val fromRider = if (fromSl == null) r.globalRiderId?.let { byRider[it] } else null
            val resolved = fromSl ?: fromRider
            // Pestaña Equipos: la fila ES un equipo (riderDisplay = nombre crudo de
            // la fuente, sin dorsal) → se casa por NOMBRE contra los equipos
            // canónicos de la startlist para chapa + nombre del catálogo (espejo
            // de la web). Sin casar → el crudo de la fuente, sin chapa.
            val matchedTeam = if (isTeams) findMatchingTeam(r.riderDisplay, raceTeams) else null
            // Override manual de equipo (panel): gana a dorsal/globalRiderId. No
            // aplica en la pestaña Equipos (la fila ES un equipo, casado por nombre).
            val overrideTeam = if (isTeams) null else r.teamId?.let { byTeamOverride[it] }
            // Nombre: startlist (curado) → ficha por globalRiderId (orden natural) →
            // riderDisplay (fallback de la fuente). La ficha gana al riderDisplay para
            // que las CN sin startlist no muestren el "APELLIDO Nombre" crudo de la UCI.
            val riderName = matchedTeam?.name
                ?: resolved?.name?.takeIf { it.isNotEmpty() }
                ?: r.riderDisplay.orEmpty()
            val teamName = overrideTeam?.name ?: resolved?.teamName.orEmpty()
            val cc = resolved?.countryCode.orEmpty()

            val isWinner = winnerRow != null && r === winnerRow
            // Un rank 1 con abandono real es espurio: a efectos de render se trata
            // como cualquier abandono (etiqueta en #, celda vacía), NO como puesto.
            val isRealAbandon = isAbandonIrm(r.irm)

            // Gap efectivo: el de la UCI, o el normalizado. El ganador (winnerRow)
            // nunca recibe gap aquí (ni siquiera con un irm de ruido).
            var effGap = r.gapText
            // Gap publicado CON décimas ("+36.98", Tour of the Gila): el gap oficial
            // en segundos enteros se deriva de los TIEMPOS truncados — floor(ganador
            // + gap) − floor(ganador) —, NO truncando el gap (20:52.99 y 20:53.00 son
            // +1", no +0"). Con gaps enteros el resultado es idéntico → no se toca.
            if (!effGap.isNullOrBlank() && winnerSec != null && r.rank != null && !isWinner && r.irm.isNullOrEmpty()) {
                val gs = tttToSeconds(effGap.trim().removePrefix("+"))
                if (gs != null && gs % 1.0 != 0.0) {
                    effGap = secondsToGap(kotlin.math.floor(winnerSec + gs) - kotlin.math.floor(winnerSec))
                }
            }
            if (effGap.isNullOrBlank() && r.rank != null && !isWinner && r.irm.isNullOrEmpty()) {
                val sec = tttToSeconds(r.timeText)
                if (sec != null) {
                    // El gap oficial se calcula sobre tiempos TRUNCADOS a segundos
                    // enteros, truncando CADA tiempo antes de restar (cronos con
                    // décimas: 20:52.99 y 20:53.00 → 20:52 y 20:53 → +1", no +0").
                    // deriveGaps ⇒ winnerSec != null (allTimed lo garantiza).
                    effGap = when {
                        deriveGaps -> secondsToGap(
                            kotlin.math.floor(sec) - kotlin.math.floor(winnerSec ?: 0.0)
                        )
                        gapsDisguised -> secondsToGap(sec)
                        else -> effGap
                    }
                }
            }
            effGap = formatGap(effGap)

            var rowGap = ""
            val (kind, value) = when {
                // Abandono real (o cualquier irm que NO sea el ganador) → celda vacía.
                !r.irm.isNullOrEmpty() && !isWinner -> ValueKind.EMPTY to ""
                isPts -> {
                    val pts = pointsOf(r)
                    ValueKind.POINTS to (pts?.toString() ?: r.resultValue.orEmpty())
                }
                isWinner -> {
                    // Tiempo de la ganadora: el suyo si lo trae; si la UCI lo omitió
                    // (caso LAP), el tiempo de cabeza derivado SOLO si es significativo
                    // (>0). En una carrera de un día sin tiempo absoluto el cabeza es
                    // 00:00:00 → no inventamos un "0" ni rotulamos nada: celda vacía.
                    // cleanTimeText: la UCI publica "00:30:36"/"0:06:36" → "30:36"/"6:36".
                    // CRI: el tiempo del ganador va en notación de prensa y TRUNCADO a
                    // segundos enteros ("20:52.99" → 20'52"); el resto de la fila fluye
                    // por el MISMO pipeline de gaps/m.t. que una etapa en línea.
                    val winIttSec = if (isItt) {
                        kotlin.math.floor(tttToSeconds(r.timeText) ?: winnerSec ?: -1.0)
                    } else -1.0
                    val wt = if (isItt && winIttSec >= 0) {
                        secondsToPressTime(winIttSec)
                    } else {
                        cleanTimeText(r.timeText).ifEmpty {
                            winnerSec?.takeIf { it > 0 }?.let { secondsToAbsText(it) }.orEmpty()
                        }
                    }
                    if (wt.isNotEmpty()) ValueKind.WINNER_TIME to wt else ValueKind.EMPTY to ""
                }
                !effGap.isNullOrBlank() && effGap == "+0\"" && rowIndex <= headBlockEnd ->
                    ValueKind.SAME_TIME to ""
                !effGap.isNullOrBlank() -> { rowGap = effGap; ValueKind.GAP to effGap }
                else -> ValueKind.RAW to (r.timeText ?: r.resultValue.orEmpty())
            }

            // Columna #: un abandono real se rotula con su etiqueta corta AUNQUE la UCI
            // le haya dejado un rank (rank 1 con DNS → "NS", no "1"). Un rank con irm de
            // ruido (LAP en el ganador) conserva su número. Sin rank ni irm → guion.
            val rankBadge = when {
                isRealAbandon -> irmLabel(r.irm, isEn)
                r.rank != null -> null
                !r.irm.isNullOrEmpty() -> irmLabel(r.irm, isEn)
                else -> r.rankText ?: "–"
            }
            // El número de puesto se anula para un abandono real (mostramos su etiqueta).
            val rankNum = if (isRealAbandon) null else r.rank

            ResultRowVM(
                rank = rankNum,
                rankBadge = rankBadge,
                isOut = isRealAbandon,
                riderName = riderName,
                countryCode = cc,
                teamName = teamName,
                team = if (isTeams) matchedTeam else (overrideTeam ?: resolved?.team),
                uciPoints = r.uciPoints,
                valueKind = kind,
                valueText = value,
                rowGap = rowGap,
            )
        }
    }

    /** Equipos presentes en una clasificación individual (para el filtro),
     *  ordenados alfabéticamente (case-insensitive), como la web. Cae a `byRider`
     *  (globalRiderId) cuando la fila no casa por dorsal (CN sin startlist). */
    fun teamsInClass(
        rows: List<RaceUciResultRow>,
        byDorsal: Map<Int, ResolvedRider>,
        byRider: Map<String, ResolvedRider> = emptyMap(),
        byTeamOverride: Map<String, Team> = emptyMap(),
    ): List<String> =
        rows.mapNotNull { r ->
            val override = r.teamId?.let { byTeamOverride[it]?.name }
            val fromSl = r.dorsalInt?.let { byDorsal[it] }
            val fromRider = if (fromSl == null) r.globalRiderId?.let { byRider[it] } else null
            override ?: (fromSl ?: fromRider)?.teamName
        }
            .filter { it.isNotEmpty() }
            .distinct()
            .sortedWith(String.CASE_INSENSITIVE_ORDER)
}
