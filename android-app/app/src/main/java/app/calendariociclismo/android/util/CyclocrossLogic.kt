package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.CxCategory
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.data.model.CxRoundRow
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.YearMonth
import java.util.Locale

enum class CxTemporalState { UNKNOWN, SCHEDULED, LIVE, ESTIMATED_FINISHED, CANCELLED }

data class CxTiming(
    val temporalState: CxTemporalState,
    val resultsStatus: String,
    val estimatedEnd: Instant?,
)

object CyclocrossLogic {
    val categories = listOf("ME", "WE", "MU", "WU", "MJ", "WJ")
    private val classes = listOf("CM", "CDM", "CC", "C1", "C2", "CN", "NAC")
    const val durationVersion = "2026-07-01"

    fun season(date: LocalDate): String {
        val year = date.year - if (date.monthValue <= 2) 1 else 0
        return String.format(Locale.ROOT, "%04d-%02d", year, (year + 1) % 100)
    }

    fun months(season: String): List<YearMonth> {
        val start = season.substringBefore('-').toInt()
        require(season == String.format(Locale.ROOT, "%04d-%02d", start, (start + 1) % 100))
        return (0L..6L).map { YearMonth.of(start, 8).plusMonths(it) }
    }

    fun offlineMonths(date: LocalDate): List<YearMonth> {
        val opening = YearMonth.from(date).takeIf { it in months(season(date)) } ?: YearMonth.of(date.year, 8)
        return listOf(opening, opening.plusMonths(1)).filter { it in months(season(opening.atDay(1))) }
    }

    fun raceInSeason(race: CxRace): Boolean = runCatching {
        val allowed = months(race.seasonKey)
        listOfNotNull(race.dateKey, race.endDateKey).all { YearMonth.from(LocalDate.parse(it)) in allowed }
    }.getOrDefault(false)

    /** Documento de carrera (Libro de Ruta o Mapa) cargado en el panel. */
    fun hasDocuments(race: CxRace): Boolean {
        val docs = setOf("technicalGuide", "map")
        return race.assets.any { !it.url.isNullOrEmpty() && it.type in docs }
    }

    /** La ficha se abre desde el calendario con la carga mínima completa (un
     *  documento y algún horario) o si alguna de las pruebas ya publicó sus
     *  clasificaciones. */
    fun raceOpen(race: CxRace): Boolean =
        hasDocuments(race) && race.categories.any { it.startTimeUtc != null } ||
            hasClassifications(race)

    /** Estados de `resultsStatus` con clasificación publicada. */
    fun hasClassifications(race: CxRace): Boolean =
        race.categories.any { it.resultsStatus in publishedResultsStatuses }

    private val publishedResultsStatuses = setOf("official", "provisional")

    fun categoriesOn(race: CxRace, date: String): List<CxCategory> =
        race.categories.filter { it.category in categories && date.take(7) in months(race.seasonKey).map(YearMonth::toString) && (it.dateKey ?: race.dateKey) == date }
            .sortedBy { categories.indexOf(it.category) }

    fun dates(race: CxRace): List<String> {
        val dates = if (race.categories.isEmpty()) listOf(race.dateKey)
        else race.categories.filter { it.category in categories }.map { it.dateKey ?: race.dateKey }.distinct().sorted()
        val allowed = months(race.seasonKey).map(YearMonth::toString)
        return dates.filter { it.take(7) in allowed }
    }

    fun racesOn(races: List<CxRace>, date: String): List<CxRace> = races.filter { date in dates(it) }
        .sortedWith(compareBy<CxRace> { classes.indexOf(it.raceClass).takeIf { index -> index >= 0 } ?: classes.size }
            .thenBy { race -> agendaTime(race, date) }
            .thenBy { it.name.lowercase(Locale.ROOT) })

    /** Hora de la categoría programada de mayor rango, según `categories`. */
    private fun agendaTime(race: CxRace, date: String): Instant =
        categoriesOn(race, date).asSequence().filterNot { it.isCancelled }
            .mapNotNull { parseInstant(it.startTimeUtc) }
            .firstOrNull() ?: Instant.MAX

    fun parseInstant(value: String?): Instant? = value?.let { runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull() }

    fun timing(race: CxRace, category: CxCategory, at: Instant = Instant.now()): CxTiming {
        val verified = category.durationRuleVersion == durationVersion &&
            (category.durationFormat == "individual" || (category.durationFormat == "WE_WJ" && category.category in listOf("WE", "WJ")))
        val start = parseInstant(category.startTimeUtc)
        val minutes = category.durationMinutes?.takeIf { verified && it > 0 }
        val end = if (start != null && minutes != null) start.plusSeconds(minutes.toLong() * 60) else null
        val state = when {
            race.isCancelled || category.isCancelled -> CxTemporalState.CANCELLED
            start == null || end == null -> CxTemporalState.UNKNOWN
            at < start -> CxTemporalState.SCHEDULED
            at < end -> CxTemporalState.LIVE
            else -> CxTemporalState.ESTIMATED_FINISHED
        }
        return CxTiming(state, category.resultsStatus, end)
    }

    /** Duración acumulada: nunca se formatea como hora civil ni se recorta a 24 h. */
    fun duration(seconds: Long?): String = seconds?.takeIf { it >= 0 }?.let {
        String.format(Locale.ROOT, "%d:%02d:%02d", it / 3600, it / 60 % 60, it % 60)
    } ?: "—"

    /** Fecha civil válida dentro de los meses de la temporada CX. */
    private fun dateInSeason(date: String, allowed: List<String>): Boolean =
        runCatching { YearMonth.from(LocalDate.parse(date)).toString() in allowed }.getOrDefault(false)

    /**
     * Número de prueba (n/total) por carrera y torneo, con el orden del contrato
     * de generales CX: coalesce(fecha de categoría, fecha de carrera), hora de
     * salida con nulos al final y race.id. Una carrera con varias categorías
     * cuenta como una sola ronda; las canceladas conservan su número.
     */
    fun tournamentRounds(rows: List<CxRoundRow>, season: String): Map<String, CxRound> {
        val allowed = runCatching { months(season).map(YearMonth::toString) }.getOrNull() ?: return emptyMap()
        val groups = rows.filter { !it.tournamentId.isNullOrEmpty() && it.seasonKey == season && dateInSeason(it.dateKey, allowed) }
            .groupBy { it.tournamentId!! }
        fun key(row: CxRoundRow): Pair<String, Instant> {
            val entries = row.categories.map { (it.dateKey ?: row.dateKey) to (parseInstant(it.startTimeUtc) ?: Instant.MAX) }
                .filter { dateInSeason(it.first, allowed) }
            val list = if (entries.isEmpty()) listOf(row.dateKey to Instant.MAX) else entries
            return list.minWith(compareBy({ it.first }, { it.second }))
        }
        val rounds = mutableMapOf<String, CxRound>()
        for (group in groups.values) {
            val ordered = group.map { it to key(it) }
                .sortedWith(compareBy({ it.second.first }, { it.second.second }, { it.first.id }))
            ordered.forEachIndexed { index, (row, _) -> rounds[row.id] = CxRound(index + 1, ordered.size) }
        }
        return rounds
    }
}
