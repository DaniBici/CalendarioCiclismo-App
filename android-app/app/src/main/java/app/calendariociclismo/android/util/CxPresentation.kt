package app.calendariociclismo.android.util

import androidx.annotation.StringRes
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.*
import java.net.URI
import java.time.Instant
import java.text.NumberFormat
import java.util.Locale
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

data class CxReplayLink(val title: String, val url: String, val sortOrder: Int)
data class CxMediaSelection(val tv: List<CxBroadcast>, val revive: List<CxReplayLink>, val hasHiddenTV: Boolean, val showsLiveTV: Boolean)
enum class CxCategoryCardState { TIME, AWAITING, RESULTS, CANCELLED }

/**
 * Filtros de la agenda de ciclocross, con la presentación de Hoy en Carretera:
 * Todas · Big (Mundial, Copa del Mundo, Continental y los torneos Superprestige,
 * X2O y HG Cross) · Pro (todo salvo las nacionales) · España (pruebas en España,
 * UCI o no).
 */
enum class CxAgendaFilter(@param:StringRes val labelRes: Int) {
    ALL(R.string.cx_filter_all),
    BIG(R.string.cx_filter_big),
    PRO(R.string.cx_filter_pro),
    SPAIN(R.string.cx_filter_spain),
}

enum class CxDetailSection { PROGRAMME, STARTLIST, RESULTS, GENERAL, VIDEOS }

object CxPresentation {
    fun categoryCardState(race: CxRace, category: CxCategory, at: Instant): CxCategoryCardState = when {
        race.isCancelled || category.isCancelled -> CxCategoryCardState.CANCELLED
        category.resultsStatus in listOf("official", "provisional") -> CxCategoryCardState.RESULTS
        CyclocrossLogic.timing(race, category, at).temporalState == CxTemporalState.ESTIMATED_FINISHED && awaitsResults(race) -> CxCategoryCardState.AWAITING
        else -> CxCategoryCardState.TIME
    }
    /**
     * La espera de resultados solo se muestra en pruebas con servidor de
     * resultados inmediato: Mundiales (CM), Continentales (CC) y Copa del Mundo
     * (CDM), más las pruebas de los torneos Copa del Mundo, Superprestige y X2O.
     * El resto de carreras nacionales no hacen esperar: sus resultados llegan
     * por la UCI más tarde o no se publican.
     */
    fun awaitsResults(race: CxRace): Boolean {
        if (race.raceClass in listOf("CM", "CC", "CDM")) return true
        val tournament = race.tournament ?: return false
        val identity = java.text.Normalizer.normalize(tournament.slug + " " + tournament.name, java.text.Normalizer.Form.NFD)
            .lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]"), "")
        return "superprestige" in identity || "x2o" in identity || "worldcup" in identity || "copadelmundo" in identity
    }
    /** Filtro de la agenda CX (Todas/Big/Pro/España). */
    /**
     * Clases de carrera ocultas con la app en inglés: la categoría nacional
     * española (y los futuros calendarios nacionales) está dirigida al público
     * hispanohablante. Espejo de `CyclocrossPresentation.hiddenClasses` (iOS)
     * y de `cxHiddenClasses` (web).
     */
    val hiddenClasses: List<String>
        get() = if (LocaleHolder.current.language == "en") listOf("NAC") else emptyList()

    fun isHidden(race: CxRace): Boolean = race.raceClass in hiddenClasses

    /** Aviso al abrir en inglés una carrera o un torneo solo nacional. */
    const val SPANISH_AUDIENCE_TITLE = "Available in Spanish"
    const val SPANISH_AUDIENCE_NOTICE = "This content is intended for Spanish-speaking audiences, mainly in Spain. Switch the app to Spanish to view it."

    fun matchesAgendaFilter(race: CxRace, filter: CxAgendaFilter): Boolean = when (filter) {
        CxAgendaFilter.ALL -> true
        CxAgendaFilter.SPAIN -> (race.countryCode ?: "").lowercase(Locale.ROOT).startsWith("es")
        CxAgendaFilter.PRO -> race.raceClass !in listOf("CN", "NAC")
        CxAgendaFilter.BIG -> {
            if (race.raceClass in listOf("CM", "CDM", "CC")) true
            else race.tournament?.let { tournament ->
                val identity = java.text.Normalizer.normalize(tournament.slug + " " + tournament.name, java.text.Normalizer.Form.NFD)
                    .lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]"), "")
                listOf("superprestige", "x2o", "worldcup", "copadelmundo", "exactcross", "hgcross").any { it in identity }
            } ?: false
        }
    }
    /** Una prueba sin ningún horario asociado usa badges en vez de cuadros. */
    fun usesCategoryBadges(race: CxRace, categories: List<CxCategory>, at: Instant): Boolean =
        categories.isNotEmpty() && categories.all {
            it.startTimeUtc.isNullOrEmpty() && categoryCardState(race, it, at) == CxCategoryCardState.TIME
        }
    fun link(value: String?): String? = value?.trim()?.takeIf { url ->
        runCatching { URI(url).let { it.scheme?.lowercase() in listOf("http", "https") && it.host != null } }.getOrDefault(false)
    }
    fun youtubeVideoId(value: String?): String? {
        val uri = runCatching { URI(value?.trim() ?: return null) }.getOrNull() ?: return null
        if (uri.scheme != "https") return null
        val parts = uri.path.orEmpty().split('/').filter { it.isNotEmpty() }
        val id = when (uri.host?.lowercase(Locale.ROOT)) {
            "youtu.be" -> parts.singleOrNull()
            "youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com" -> when {
                parts == listOf("watch") -> uri.rawQuery?.split('&')?.firstOrNull { it.startsWith("v=") }?.removePrefix("v=")
                parts.size == 2 && parts[0] in listOf("live", "shorts", "embed") -> parts[1]
                else -> null
            }
            else -> null
        }
        return id?.takeIf { Regex("^[A-Za-z0-9_-]{11}$").matches(it) }
    }
    fun videos(detail: CxDetail): List<CxVideo> {
        val categories = actualCategories(detail).toSet()
        return detail.videos.filter { it.category.isNullOrEmpty() || it.category in categories }
            .sortedBy { it.sortOrder }.distinctBy { youtubeVideoId(it.url) ?: it.id }
            .filter { youtubeVideoId(it.url) != null }
    }
    fun tournamentRoundTotal(tournamentId: String, races: List<CxRace>, rounds: Map<String, CxRound>): Int =
        races.asSequence().filter { it.tournamentId == tournamentId }
            .mapNotNull { rounds[it.id]?.total }.maxOrNull() ?: 0
    fun logo(race: CxRace): String? = link(race.logoUrl) ?: link(race.tournament?.logoUrl)
    fun color(race: CxRace): String? {
        fun valid(hex: String?): String? = hex?.takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) }
        race.tournament?.let { tournament ->
            valid(tournament.colorHex)?.let { return it }
            val identity = java.text.Normalizer.normalize(tournament.slug + " " + tournament.name, java.text.Normalizer.Form.NFD)
                .lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]"), "")
            when {
                "superprestige" in identity -> return "#FFC600"
                "x2o" in identity -> return "#00A8C7"
                "worldcup" in identity || "copadelmundo" in identity -> return "#8B173D"
                "copadeespana" in identity || "copaespana" in identity -> return "#D71920"
                "exactcross" in identity || "hgcross" in identity -> return "#E6342A"
                "coupedefrance" in identity || "copadefrancia" in identity -> return "#0055A4"
                "swisscyclocrosscup" in identity || "swisscxcup" in identity -> return "#D52B1E"
                "toitoi" in identity || "hsfsystem" in identity -> return "#E87524"
                "nationaltrophy" in identity -> return "#6B3FA0"
                "uscx" in identity -> return "#233C78"
                "girodelleregioni" in identity || "giroregioni" in identity || "giroditalia" in identity -> return "#E94B8A"
                "tacadeportugal" in identity || "tacaportugal" in identity -> return "#008657"
                else -> Unit
            }
        }
        return valid(race.colorHex)
    }
    fun raceClass(code: String, english: Boolean): String = if (code == "NAC") if (english) "Nat" else "Nac" else code
    private fun configured(race: CxRace): JsonObject? = race.tournament?.pointsScheme?.get("categories") as? JsonObject
    fun actualCategories(detail: CxDetail): List<String> = CyclocrossLogic.categories.filter { code ->
        detail.race.categories.any { it.category == code && (it.dateKey ?: detail.race.dateKey) in CyclocrossLogic.dates(detail.race) }
    }
    fun resultCategories(detail: CxDetail): List<String> = actualCategories(detail).filter { code ->
        detail.race.categories.any { it.category == code && it.resultsStatus in listOf("official", "provisional") }
            && detail.results.any { it.category == code }
    }
    fun generalCategories(detail: CxDetail): List<String> = CyclocrossLogic.categories.filter { code ->
        if (detail.standings.none { it.category == code }) return@filter false
        val extras = (configured(detail.race)?.get(code) as? JsonObject)?.get("extras") as? JsonObject
        val derived = extras?.get("derived") as? JsonObject
        val source = (derived?.get("fromCategory") as? JsonPrimitive)?.content ?: code
        val hasResults = source in resultCategories(detail)
        val state = detail.standingsState.firstOrNull { it.category == code }
        if (state == null) !hasResults else state.status in listOf("ready", "manual") && (!hasResults || detail.race.id in state.roundIds)
    }
    private fun hasScheduledProgramme(detail: CxDetail): Boolean {
        val actual = actualCategories(detail).toSet()
        return detail.race.categories.any { it.category in actual && it.startTimeUtc != null }
    }
    fun detailSections(detail: CxDetail): List<CxDetailSection> {
        val hasStartlist = detail.startlist.isNotEmpty()
        return (if (hasScheduledProgramme(detail)) listOf(CxDetailSection.PROGRAMME) else emptyList()) +
            (if (hasStartlist) listOf(CxDetailSection.STARTLIST) else emptyList()) +
            (if (resultCategories(detail).isEmpty()) emptyList() else listOf(CxDetailSection.RESULTS)) +
            (if (generalCategories(detail).isEmpty()) emptyList() else listOf(CxDetailSection.GENERAL)) +
            (if (videos(detail).isEmpty()) emptyList() else listOf(CxDetailSection.VIDEOS))
    }
    fun showsSectionSelector(detail: CxDetail): Boolean = detailSections(detail).size > 1 &&
        (hasScheduledProgramme(detail) || detail.startlist.isNotEmpty() || videos(detail).isNotEmpty())
    fun detailCategories(detail: CxDetail, section: CxDetailSection): List<String> = when (section) {
        CxDetailSection.RESULTS -> resultCategories(detail)
        CxDetailSection.GENERAL -> generalCategories(detail)
        CxDetailSection.VIDEOS -> emptyList()
        else -> actualCategories(detail)
    }
    fun normalizeSelection(detail: CxDetail, section: CxDetailSection, category: String?): Pair<CxDetailSection, String?> {
        val sections = detailSections(detail)
        val available = section.takeIf { it in sections } ?: sections.firstOrNull() ?: CxDetailSection.PROGRAMME
        val codes = detailCategories(detail, available)
        return available to (category?.takeIf { available == section && it in codes } ?: "ME".takeIf { it in codes } ?: codes.firstOrNull())
    }
    fun standingMode(race: CxRace, category: String?): String? =
        category?.let { code -> ((configured(race)?.get(code) as? JsonObject)?.get("mode") as? JsonPrimitive)?.content?.takeIf { it in listOf("time", "points") } }
    fun standingValue(row: CxStanding, mode: String?, locale: Locale): String = when (mode) {
        "time" -> CyclocrossLogic.duration(row.timeSeconds)
        "points" -> row.points?.let { NumberFormat.getNumberInstance(locale).format(it) } ?: "—"
        else -> "—"
    }
    /** Vueltas acreditadas por LAP o por su unidad explícita; nunca son un tiempo. */
    fun lapsLost(row: CxResult): Int? {
        if (row.irm != "LAP" && !Regex("LAPS?", RegexOption.IGNORE_CASE).containsMatchIn(row.gapText.orEmpty())) return null
        for (candidate in listOf(row.gapText, row.timeText.takeIf { row.irm == "LAP" })) {
            val text = candidate.orEmpty().trim().trim('\'', '"').removePrefix("@").trim()
            val match = Regex("^-?\\s*([1-9]\\d*)\\s*LAPS?$", RegexOption.IGNORE_CASE).matchEntire(text)
                ?: if (row.irm == "LAP") Regex("^-?\\s*([1-9]\\d*)$").matchEntire(text) else null
            match?.groupValues?.get(1)?.toIntOrNull()?.let { return it }
        }
        return null
    }
    private fun finishSeconds(row: CxResult?): Double? =
        (UciResultsLogic.tttToSeconds(row?.timeText) ?: row?.timeSeconds?.toDouble())?.takeIf { it.isFinite() && it > 0 }

    fun resultValue(row: CxResult, locale: Locale): String = resultRow(row, locale).valueText
    fun resultRows(rows: List<CxResult>, locale: Locale, teams: List<Team> = emptyList()): List<UciResultsLogic.ResultRowVM> =
        resultRows(rows, locale, UciResultsLogic.TeamMatcher(teams))
    fun resultRows(rows: List<CxResult>, locale: Locale, matcher: UciResultsLogic.TeamMatcher): List<UciResultsLogic.ResultRowVM> {
        val winnerSeconds = finishSeconds(rows.firstOrNull { it.rank == 1 && it.irm.isNullOrBlank() })
        var head = true
        return rows.sortedWith(compareBy<CxResult> { it.rank ?: Int.MAX_VALUE }.thenBy { it.sortOrder }).map { row ->
            val vm = resultRow(row, locale, winnerSeconds, head, matcher)
            if (row.rank != 1 && vm.valueKind != UciResultsLogic.ValueKind.SAME_TIME) head = false
            vm
        }
    }
    fun resultRow(row: CxResult, locale: Locale, winnerSeconds: Double? = null, head: Boolean = true, teams: List<Team> = emptyList()): UciResultsLogic.ResultRowVM =
        resultRow(row, locale, winnerSeconds, head, UciResultsLogic.TeamMatcher(teams))
    private fun resultRow(row: CxResult, locale: Locale, winnerSeconds: Double?, head: Boolean, matcher: UciResultsLogic.TeamMatcher): UciResultsLogic.ResultRowVM {
        val isEn = locale.language == "en"
        val irm = row.irm?.takeIf(String::isNotBlank)
        val seconds = finishSeconds(row)
        val laps = lapsLost(row)
        var gap = row.gapText?.takeIf(String::isNotBlank)
        if (irm.isNullOrEmpty() && laps == null && row.rank != 1) {
            val gapSeconds = UciResultsLogic.tttToSeconds(gap?.removePrefix("+"))
            if (gapSeconds != null && winnerSeconds != null && gapSeconds % 1.0 != 0.0)
                gap = UciResultsLogic.secondsToGap(kotlin.math.floor(winnerSeconds + gapSeconds) - kotlin.math.floor(winnerSeconds))
            if (gap == null && seconds != null && winnerSeconds != null && seconds >= winnerSeconds)
                gap = UciResultsLogic.secondsToGap(kotlin.math.floor(seconds) - kotlin.math.floor(winnerSeconds))
        }
        val formattedGap = UciResultsLogic.formatGap(gap).orEmpty()
        val (kind, value) = when {
            irm != null && irm != "LAP" -> UciResultsLogic.ValueKind.EMPTY to ""
            laps != null -> UciResultsLogic.ValueKind.RAW to if (isEn) "-$laps ${if (laps == 1) "lap" else "laps"}" else "-$laps ${if (laps == 1) "vuelta" else "vueltas"}"
            irm == "LAP" -> UciResultsLogic.ValueKind.RAW to if (isEn) "lap lost" else "vuelta perdida"
            row.rank != 1 && formattedGap.isNotEmpty() ->
                if (head && formattedGap == "+0\"") UciResultsLogic.ValueKind.SAME_TIME to ""
                else UciResultsLogic.ValueKind.GAP to formattedGap
            seconds != null -> (if (row.rank == 1) UciResultsLogic.ValueKind.WINNER_TIME else UciResultsLogic.ValueKind.RAW) to
                UciResultsLogic.cleanTimeText(row.timeText?.takeIf(String::isNotBlank) ?: CyclocrossLogic.duration(row.timeSeconds))
            else -> UciResultsLogic.ValueKind.EMPTY to ""
        }
        val rank = row.rank.takeUnless { UciResultsLogic.isAbandonIrm(irm) }
        val badge = if (rank != null) null else irm?.let { UciResultsLogic.irmLabel(it, isEn) } ?: row.rankText ?: "–"
        return classificationRow(rank, badge, row.riderDisplay, row.isoCode2, row.teamName, matcher, row.points, kind, value)
            .copy(rowGap = if (kind == UciResultsLogic.ValueKind.GAP && value != "+0\"") value else "")
    }
    fun standingRow(row: CxStanding, mode: String?, locale: Locale, teams: List<Team> = emptyList()): UciResultsLogic.ResultRowVM =
        standingRow(row, mode, locale, UciResultsLogic.TeamMatcher(teams))
    fun standingRow(row: CxStanding, mode: String?, locale: Locale, matcher: UciResultsLogic.TeamMatcher): UciResultsLogic.ResultRowVM = classificationRow(
        row.rank, null, row.riderDisplay, row.isoCode2, row.teamName, matcher, null,
        if (mode == "points") UciResultsLogic.ValueKind.POINTS else if (row.rank == 1) UciResultsLogic.ValueKind.WINNER_TIME else UciResultsLogic.ValueKind.RAW,
        standingValue(row, mode, locale))
    private fun classificationRow(rank: Int?, badge: String?, rider: String, country: String?, team: String?, matcher: UciResultsLogic.TeamMatcher, points: Double?,
                                  kind: UciResultsLogic.ValueKind, value: String) = UciResultsLogic.ResultRowVM(
        rank = rank, rankBadge = badge, isOut = rank == null, riderName = rider, countryCode = country.orEmpty(),
        teamName = team.orEmpty(), team = matcher.match(team), uciPoints = points, valueKind = kind, valueText = value, rowGap = "")

    fun programmeMedia(detail: CxDetail, allowedGroups: Set<String>, showAll: Boolean = false): CxMediaSelection {
        val selections = detail.race.categories.filter { it.category in actualCategories(detail) }.map { categoryMedia(detail, it, allowedGroups, showAll) }
        return CxMediaSelection(selections.flatMap { it.tv }.distinctBy { "${link(it.url) ?: it.id}|${it.country ?: "ALL"}|${it.channel ?: ""}" },
            selections.flatMap { it.revive }.distinctBy { it.url }, selections.any { it.showsLiveTV && it.hasHiddenTV }, selections.any { it.showsLiveTV })
    }
    fun categoryMedia(detail: CxDetail, category: CxCategory, allowedGroups: Set<String>, showAll: Boolean = false): CxMediaSelection =
        categoryMedia(detail.race, category, detail.broadcasts, category.resultsStatus in listOf("official", "provisional") && detail.results.any { it.category == category.category }, allowedGroups, showAll)

    fun categoryMedia(race: CxRace, category: CxCategory, allowedGroups: Set<String>): CxMediaSelection =
        categoryMedia(race, category, race.broadcasts, category.resultsStatus in listOf("official", "provisional"), allowedGroups, false)

    private fun categoryMedia(race: CxRace, category: CxCategory, sourceBroadcasts: List<CxBroadcast>, hasResults: Boolean, allowedGroups: Set<String>, showAll: Boolean): CxMediaSelection {
        fun applies(code: String?) = code.isNullOrEmpty() || code == category.category
        val cancelled = race.isCancelled || category.isCancelled
        val applicable = sourceBroadcasts.filter { applies(it.category) }.sortedBy { it.sortOrder }
        val broadcasts = applicable.distinctBy {
            listOf(link(it.url) ?: it.id, it.country ?: "ALL", it.channel.orEmpty())
        }
        val regional = broadcasts.filter { RaceLogic.broadcastMatchesRegion(it.country, allowedGroups) }
        val showsLiveTV = !cancelled && !hasResults && broadcasts.isNotEmpty()
        val replay = if (hasResults || cancelled) {
            applicable.filter { RaceLogic.broadcastMatchesRegion(it.country, allowedGroups) && (it.showInRevive || !cancelled && it.isSporza) }.mapNotNull { row ->
                link(row.url)?.let { CxReplayLink(row.channel ?: "TV", it, row.sortOrder) }
            }
        } else emptyList()
        return CxMediaSelection(if (showsLiveTV) if (showAll) broadcasts else regional else emptyList(),
            replay.sortedBy { it.sortOrder }.distinctBy { it.url }, regional.size < broadcasts.size, showsLiveTV)
    }
}
