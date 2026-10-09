package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceUciStage

/**
 * Lógica pura del feed "Últimos resultados" — port literal de
 * `js/resultados-feed.js` (fetchEntries + cmpEntries), sin la parte de red.
 * Testeable con JUnit (ver `ResultsFeedLogicTest`).
 *
 * Reglas de las filas (espec Dani 2026-06-11, las mismas que la web):
 *  · Etapas de vueltas y pruebas de un día (estas SIN etiqueta de etapa) + las
 *    GENERALES FINALES de las vueltas, pegadas a su carrera y POR DELANTE de la
 *    etapa correspondiente.
 *  · Dentro de cada día, el MISMO orden canónico que las cards de Hoy
 *    (grandes vueltas → nivel pro → género → categoría UCI → hora → nombre).
 *  · stageDate puede venir NULL (volcados PDF, migración 090) → la fecha se
 *    resuelve por raceDayId→race_days.dateKey o por las fechas de la carrera, y
 *    el filtro de ventana se aplica DESPUÉS de resolver.
 *  · El feed solo contiene clasificaciones propias.
 */
object ResultsFeedLogic {

    enum class Kind { INHOUSE }

    data class ComplementaryClassification(
        val stageRef: String,
        val classKind: String,
        val labelEs: String,
        val labelEn: String,
        val colorHex: String? = null,
        val winner: String = "",
    )

    data class FeedEntry(
        val kind: Kind,
        /** General final de una vuelta (entrada propia, delante de su etapa). */
        val isGcFinal: Boolean = false,
        /** Fecha YA resuelta (stageDate → jornada → fechas de carrera). */
        val date: String,               // dateKey YYYY-MM-DD
        val race: Race,
        /** null = prueba de un día o general final (sin etiqueta de etapa). */
        val stageNumber: Int?,
        /** Sufijo de doble sector (A/B); vacío en jornadas ordinarias. */
        val stageSuffix: String = "",
        /** Jornada (ruta/km/tipos/hora); null en las generales finales. */
        val rd: RaceDay?,
        /** id de race_uci_stages — para resolver el ganador (rank 1). */
        val stageRefId: String? = null,
        /** Ganador: parte del winnerName crudo; el ViewModel lo refina con el
         *  nombre canónico de la ficha (o el equipo en CRE). */
        val winner: String = "",
        /** Orden dentro de la MISMA carrera: la general final (0) SIEMPRE por
         *  delante de la etapa (1). Solo lo consulta el comparador. */
        val subOrder: Int = 1,
        val isFeatured: Boolean = false,
        val complementary: List<ComplementaryClassification> = emptyList(),
    )

    /**
     * La UCI publica las etapas canceladas con una pseudo-fila "Cancelled Race"
     * como ganadora (pseudo-ficha race-cancelled del catálogo) → sin trofeo.
     * Espejo de `cleanWinner` en resultados-feed.js.
     */
    fun cleanWinner(name: String?): String {
        if (name.isNullOrEmpty()) return ""
        if (name.contains("cancel", ignoreCase = true)) return ""
        return name
    }

    private val nationAliases = mapOf("Great Britain" to "GB")
    private val nationNamesEs = mapOf("GB" to "Gran Bretaña")

    /** Nombre inglés de cada región ISO → código ISO. */
    private val nationCodeByEnglishName: Map<String, String> by lazy {
        val map = HashMap<String, String>()
        for (code in java.util.Locale.getISOCountries()) {
            val label = java.util.Locale("", code).getDisplayCountry(java.util.Locale.ENGLISH)
            if (label.isNotEmpty() && label != code) map[label] = code
        }
        map.putAll(nationAliases)
        map
    }

    /**
     * Selecciones nacionales: el catálogo guarda el nombre UCI en inglés
     * («France»). En castellano se muestra el nombre del país en castellano
     * («Francia», «Gran Bretaña»); en inglés, sin cambio. Un nombre que no es
     * un país se devuelve tal cual. Espejo de `localizedNationName` en
     * `js/resultados-feed.js`.
     */
    fun localizedNationName(name: String, isEnglish: Boolean): String {
        val trimmed = name.trim()
        if (isEnglish || trimmed.isEmpty()) return name
        val code = nationCodeByEnglishName[trimmed] ?: return name
        nationNamesEs[code]?.let { return it }
        return java.util.Locale("", code)
            .getDisplayCountry(java.util.Locale.forLanguageTag("es"))
            .ifEmpty { name }
    }

    /**
     * Construye las entradas del feed de un rango [fromKey, toKey] (ambos
     * inclusive), YA ordenadas: cronología inversa y, dentro del día, el orden
     * canónico de carreras. Espejo 1:1 de `fetchEntries` (sin red ni ganadores).
     *
     * @param stages   filas de race_uci_stages (keepForWeb, rowCount>0, stage|gc).
     * @param raceDays jornadas PUBLICADAS del rango (ruta/km/tipos/hora y
     *                 contexto de las filas in-house, vía raceDayId).
     * @param races    carreras implicadas (por stages y raceDays).
     */
    fun buildEntries(
        stages: List<RaceUciStage>,
        raceDays: List<RaceDay>,
        races: List<Race>,
        fromKey: String,
        toKey: String,
    ): List<FeedEntry> {
        // El feed recibe jornadas sin el campo transitorio stageSuffix. Se anotan
        // sobre copias para distinguir 1A/1B sin mutar los modelos del llamador.
        val days = raceDays.map { source ->
            source.copy().also { it.stageSuffix = source.stageSuffix }
        }.toMutableList()
        RaceLogic.annotateDoubleSectors(days)

        val rdById = days.associateBy { it.id }
        val rdsByRace = days.filter { it.raceId != null }.groupBy { it.raceId!! }
        // Jornada por (raceId, stageNumber): fallback cuando la clasificación
        // in-house NO trae raceDayId (el volcado precedió a la creación de la
        // jornada → race_uci_stages.raceDayId NULL; documentado en el runbook de saneo).
        // Sin él, la bandera/ruta de la etapa caen al país de la CARRERA e
        // ignoran el override por jornada (p. ej. Giro della Valle d'Aosta et1,
        // disputada en Francia, con race_days.countryCode = 'FR').
        // Un doble sector (3A/3B) comparte stageNumber → aquí ganaría uno
        // arbitrario; da igual (mismo día/país) y esta rama solo actúa sin raceDayId.
        val rdByRaceStage = days
            .filter { it.raceId != null && it.stageNumber != null }
            .associateBy { "${it.raceId}#${it.stageNumber}" }
        val raceById = races.associateBy { it.id }

        fun key(raceId: String, sn: Int?, suffix: String = "") =
            "$raceId#${sn?.toString() ?: "final"}$suffix"

        // Jornada de una clasificación: por raceDayId → por (raceId,stageNumber)
        // si el volcado no lo trajo → la única/primera jornada (un día). Fuente
        // única para entryRd y entryDate.
        fun rdFor(s: RaceUciStage, race: Race): RaceDay? =
            s.raceDayId?.let { rdById[it] }
                ?: s.stageNumber?.let { rdByRaceStage["${s.raceId}#$it"] }
                ?: if (race.isOneDay) rdsByRace[race.id]?.firstOrNull() else null

        // Fecha real de una clasificación: stageDate → jornada → fechas de carrera.
        // Los volcados PDF (migración 090) llegan con stageDate NULL — por eso el
        // fallback en cascada; el filtro de ventana va DESPUÉS de resolver.
        fun entryDate(s: RaceUciStage, race: Race): String? =
            s.stageDate
                ?: rdFor(s, race)?.dateKey
                ?: if (race.isOneDay) race.startDate else race.endDate

        fun entryRd(s: RaceUciStage, race: Race): RaceDay? = rdFor(s, race)

        // ── Entradas in-house ──────────────────────────────────────────
        val entries = mutableListOf<FeedEntry>()
        val seen = mutableSetOf<String>()
        // Una prueba de un día tiene UNA entrada; si primero llegó la fila
        // 'stage' y después la 'gc' FINAL, la final la "mejora" en sitio
        // (ganador + stageRef) sin duplicar. Índice por clave para mutar.
        val onedayIdx = mutableMapOf<String, Int>()
        val onedayHasFinal = mutableSetOf<String>()

        for (s in stages) {
            val race = raceById[s.raceId] ?: continue
            val date = entryDate(s, race) ?: continue
            if (date < fromKey || date > toKey) continue
            val isOneDay = race.isOneDay
            val isFinalGc = s.classKind == "gc" && (s.isFinalClassification || s.stageNumber == null)

            if (isOneDay) {
                // Una sola entrada por prueba de un día: final 'gc' preferida.
                val k = "${s.raceId}#oneday"
                if (k in seen) {
                    if (isFinalGc && k !in onedayHasFinal) {
                        val idx = onedayIdx[k]
                        if (idx != null) {
                            val prev = entries[idx]
                            entries[idx] = prev.copy(
                                winner = cleanWinner(s.winnerName).ifEmpty { prev.winner },
                                stageRefId = s.id,
                            )
                            onedayHasFinal.add(k)
                        }
                    }
                    continue
                }
                // Una gc NO final de un día se ignora (no es la clasificación).
                if (s.classKind == "gc" && !isFinalGc) continue
                seen.add(k)
                if (isFinalGc) onedayHasFinal.add(k)
                onedayIdx[k] = entries.size
                entries.add(
                    FeedEntry(
                        kind = Kind.INHOUSE, date = date, race = race,
                        stageNumber = null, subOrder = 1, rd = entryRd(s, race),
                        stageRefId = s.id, winner = cleanWinner(s.winnerName),
                    )
                )
            } else if (isFinalGc) {
                // General final de una vuelta: entrada propia, POR DELANTE de la
                // etapa de su carrera (subOrder 0 < 1; cmpEntries la pega a ella).
                val k = "${s.raceId}#gcfinal"
                if (k in seen) continue
                seen.add(k)
                entries.add(
                    FeedEntry(
                        kind = Kind.INHOUSE, isGcFinal = true, date = date, race = race,
                        stageNumber = null, subOrder = 0, rd = null,
                        stageRefId = s.id, winner = cleanWinner(s.winnerName),
                    )
                )
            } else if (s.classKind == "stage" && s.stageNumber != null) {
                val rd = entryRd(s, race)
                val suffix = rd?.stageSuffix.orEmpty()
                val k = key(s.raceId, s.stageNumber, suffix)
                if (k in seen) continue
                seen.add(k)
                entries.add(
                    FeedEntry(
                        kind = Kind.INHOUSE, date = date, race = race,
                        stageNumber = s.stageNumber, stageSuffix = suffix,
                        subOrder = 1, rd = rd,
                        stageRefId = s.id, winner = cleanWinner(s.winnerName),
                    )
                )
            }
            // Las gc por etapa (provisionales) de una vuelta NO son entradas.
        }

        return sortEntries(entries)
    }

    /**
     * Cronología inversa; dentro del día, orden canónico de carreras (las
     * generales finales pegadas a su carrera y por delante).
     *
     * ⚠️ La hora de desempate se PRECOMPUTA por (date, raceId) = mínimo
     * neutralStartTimeUtc de los rd de las entradas de esa carrera ese día, y se
     * asigna a TODAS sus entradas: las generales finales no tienen rd, y si cada
     * entrada usara su propio rd compararían 999999 contra la hora real de otras
     * carreras → comparador NO transitivo y bloques de carrera entrelazados
     * (bug real cazado en la web).
     */
    fun sortEntries(entries: List<FeedEntry>): List<FeedEntry> {
        val timeByRaceDay = HashMap<String, Double>()
        for (e in entries) {
            val t = e.rd?.neutralStartTimeUtc?.let { DateFormatting.timestampToSeconds(it) } ?: continue
            val k = "${e.date}#${e.race.id}"
            val prev = timeByRaceDay[k]
            if (prev == null || t < prev) timeByRaceDay[k] = t
        }
        fun sortTime(e: FeedEntry): Double =
            timeByRaceDay["${e.date}#${e.race.id}"] ?: 999999.0

        return entries.sortedWith(
            Comparator { a, b ->
                val byDate = b.date.compareTo(a.date)   // DESC
                if (byDate != 0) byDate else cmpEntries(a, b, sortTime(a), sortTime(b))
            }
        )
    }

    /**
     * Como en Hoy, las carreras destacadas del día (`featured_races_for_dates`,
     * claves `fecha#raceId`) abren ese día con todas sus entradas juntas; el
     * resto conserva el orden canónico. Espejo de `featuredRank` en
     * resultados-feed.js. `sortedWith` es estable.
     */
    fun featuredFirst(entries: List<FeedEntry>, selected: Set<String>): List<FeedEntry> {
        if (selected.isEmpty()) return entries
        return entries.sortedWith(
            compareByDescending<FeedEntry> { it.date }.thenBy { if ("${it.date}#${it.race.id}" in selected) 0 else 1 }
        )
    }

    /**
     * Orden canónico de carreras dentro del día — espejo de `cmpEntries` en
     * resultados-feed.js: Campeonatos Nacionales → gran vuelta → categoryRank →
     * sexo → hora → nombre. PRIMERO:
     * misma carrera → la general final SIEMPRE por delante de su etapa.
     */
    fun cmpEntries(a: FeedEntry, b: FeedEntry, sortTimeA: Double, sortTimeB: Double): Int {
        if (a.race.id == b.race.id) {
            val sub = a.subOrder - b.subOrder
            if (sub != 0) return sub
            val stage = (a.stageNumber ?: Int.MAX_VALUE).compareTo(b.stageNumber ?: Int.MAX_VALUE)
            if (stage != 0) return stage
            return a.stageSuffix.compareTo(b.stageSuffix)
        }
        val rA = a.race
        val rB = b.race
        // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría
        // (espejo de cmpEntries en resultados-feed.js). El rd da el primaryType para
        // el slot; las CN son siempre de un día, así que su rd no es null (la general
        // final, única entrada sin rd, nunca es CN). Si faltara, se cae al genérico.
        val rdA = a.rd; val rdB = b.rd
        if (rdA != null && rdB != null) {
            ChampionshipsConfig.compare(rA, rdA, rB, rdB)?.let { if (it != 0) return it }
        }
        val gt = RaceLogic.grandTourRank(rA) - RaceLogic.grandTourRank(rB)
        if (gt != 0) return gt
        val cat = RaceLogic.raceCategoryRank(rA).compareTo(RaceLogic.raceCategoryRank(rB))
        if (cat != 0) return cat
        val gen = RaceLogic.genderRank(rA.gender) - RaceLogic.genderRank(rB.gender)
        if (gen != 0) return gen
        if (sortTimeA != sortTimeB) return sortTimeA.compareTo(sortTimeB)
        return rA.name.compareTo(rB.name)
    }

    // ── Helpers puros de la resolución de ganadores ────────────────────────

    /**
     * ¿El ganador de esta entrada es un EQUIPO (CRE)? Señales (espejo web): la
     * jornada es 'ttt' (variante B de la UCI: solo el líder lleva rank 1) o
     * varios corredores comparten el rank 1 (variante A). Las generales finales
     * nunca (su rank 1 es un corredor).
     */
    fun isCreEntry(entry: FeedEntry, winnerRiderIds: List<String>): Boolean {
        if (entry.kind != Kind.INHOUSE || entry.stageRefId == null || entry.isGcFinal) return false
        return entry.rd?.primaryType == "ttt" || winnerRiderIds.size > 1
    }
}
