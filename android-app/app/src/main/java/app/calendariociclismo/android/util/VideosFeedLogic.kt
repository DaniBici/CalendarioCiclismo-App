package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.CxDetail
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxResult
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.data.model.RaceDayVideo
import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.time.LocalDate
import java.util.Locale

/**
 * Jornada de carretera de la RPC `video_feed_days` (docs/plans/videos-5-2.md,
 * fase 5): jornadas con vídeos propios o, con clasificaciones propias, con
 * emisiones de Revive (`broadcasts` vacío sin ellas).
 */
@Serializable
data class VideoFeedDay(
    val id: String,
    val raceId: String? = null,
    val dateKey: String,
    val stageNumber: Int? = null,
    val stageSuffix: String? = null,
    val isCancelledDay: Boolean? = null,
    val distanceKm: Double? = null,
    val countryCode: String? = null,
    val neutralStartTimeUtc: String? = null,
    val race: RaceInfo? = null,
    val videos: List<Item> = emptyList(),
    val broadcasts: List<Item> = emptyList(),
) {
    @Serializable
    data class RaceInfo(
        val id: String,
        val name: String,
        val nameEn: String? = null,
        val countryCode: String? = null,
        val gender: String? = null,
        val raceFormat: String? = null,
        val uciCategory: String? = null,
        val isGrandTour: Boolean? = null,
        val logoUrl: String? = null,
    )

    @Serializable
    data class Item(
        val id: String,
        val kind: String? = null,
        val title: String? = null,
        val titleEn: String? = null,
        val channel: String? = null,
        val url: String? = null,
        val embeddable: Boolean? = null,
        val country: String? = null,
        val sortOrder: Int? = null,
        val showInRevive: Boolean? = null,
    )
}

/**
 * Tarjeta de la sección Vídeos: una carrera (jornada de carretera o prueba CX
 * en un día) con sus vídeos en el orden de la regla común y, después, las
 * emisiones de Revive que no están en ellos. Con vídeos o varias emisiones se
 * despliega; sin vídeos y con una sola emisión lleva el botón «Emisión ↗»
 * ([fullUrl]).
 */
data class VideoFeedEntry(
    val id: String,
    val date: String,
    val name: String,
    val subtitle: String,
    val logoUrl: String?,
    val countryCode: String?,
    val placeholderLogo: Boolean,
    val oneDay: Boolean,
    val rows: List<StageVideoLogic.Entry>,
    val expandable: Boolean,
    val fullUrl: String?,
    val fullLabel: String?,
    /** Jornada de carretera (panel Vídeos) o prueba CX (pestaña Vídeos). */
    val stageId: String?,
    val raceId: String?,
    val cxRaceId: String?,
    /** Carrera de origen, para los filtros de Hoy. */
    val roadRace: VideoFeedDay.RaceInfo? = null,
    val cxRace: CxRace? = null,
)

data class VideoFeedDayGroup(val date: String, val entries: List<VideoFeedEntry>)

/** Entradas de la sección Vídeos, espejo de `js/services/video-feed-entries.js`. */
object VideosFeedLogic {
    const val WINDOW_DAYS = 14L
    const val MORE_DAYS = 7L
    const val ROAD_SEASON_START = "2026-01-01"

    fun shift(key: String, days: Long): String = LocalDate.parse(key).plusDays(days).toString()

    private fun english() = LocaleHolder.current.language == "en"

    /** «Emisión» o «Emisión · <canal>». */
    fun broadcastLabel(channel: String?): String {
        val base = LocaleHolder.t("Emisión", "Broadcast")
        return if (channel.isNullOrEmpty()) base else "$base · $channel"
    }

    /** Fila de Revive en el acordeón: rótulo de la emisión completa (`title`
     *  null: «Emisión de la etapa/carrera») y su canal. */
    private fun reviveRow(id: String, url: String, channel: String?, embeddable: Boolean?, title: String? = null) =
        StageVideoLogic.Entry(
            id = "revive-$id", kind = "full", title = title, titleEn = title, channel = channel, url = url,
            embeddable = embeddable, country = null, sortOrder = 0, converted = title == null,
        )

    // ─── Carretera ───────────────────────────────────────────────

    fun roadEntries(days: List<VideoFeedDay>, allowedGroups: Set<String>, featured: Set<String> = emptySet()): List<VideoFeedEntry> =
        days.mapNotNull { day ->
            val race = day.race ?: return@mapNotNull null
            val broadcasts = day.broadcasts.map { item ->
                Broadcast(id = item.id, raceDayId = day.id, channel = item.channel, url = item.url,
                    sortOrder = item.sortOrder ?: 0, showInRevive = item.showInRevive == true,
                    country = item.country, embeddable = item.embeddable)
            }
            val videos = day.videos.mapNotNull { item ->
                val url = item.url ?: return@mapNotNull null
                val title = item.title ?: return@mapNotNull null
                RaceDayVideo(id = item.id, raceDayId = day.id, kind = item.kind ?: "other", title = title,
                    titleEn = item.titleEn, channel = item.channel, url = url, embeddable = item.embeddable,
                    country = item.country, sortOrder = item.sortOrder ?: 0)
            }
            val media = StageVideoLogic.mediaState(
                RaceLogic.filterBroadcastsByRegion(broadcasts, allowedGroups),
                StageVideoLogic.filterByRegion(videos, allowedGroups),
                hasResults = day.broadcasts.isNotEmpty(),
                isCancelled = day.isCancelledDay == true,
            )
            val revive = media.revive.filter { !it.url.isNullOrEmpty() }
            if (media.entries.isEmpty() && revive.isEmpty()) return@mapNotNull null
            val expandable = media.entries.isNotEmpty() || revive.size > 1
            val full = if (expandable) null else StageVideoLogic.cardReviveBroadcast(revive)
            val name = if (english()) race.nameEn?.takeIf { it.isNotBlank() } ?: race.name else race.name
            day to VideoFeedEntry(
                id = "road-${day.id}", date = day.dateKey, name = name, subtitle = roadSubtitle(day),
                logoUrl = race.logoUrl, countryCode = day.countryCode ?: race.countryCode,
                placeholderLogo = race.uciCategory != "CN", oneDay = race.raceFormat == "one_day",
                rows = media.entries + revive.map { reviveRow(it.id, it.url.orEmpty(), it.channel, it.embeddable) },
                expandable = expandable, fullUrl = full?.url, fullLabel = full?.let { broadcastLabel(it.channel) },
                stageId = day.id, raceId = day.raceId, cxRaceId = null, roadRace = race,
            )
        }.sortedWith { a, b -> compareRoad(a.first, b.first, featured) }.map { it.second }

    /** Etapa y distancia: «Etapa 5 · 182 km»; un día, solo la distancia. */
    private fun roadSubtitle(day: VideoFeedDay): String {
        val parts = mutableListOf<String>()
        val n = day.stageNumber
        if (n != null && day.race?.raceFormat != "one_day") {
            parts += if (n == 0) LocaleHolder.t("Prólogo", "Prologue") else "${LocaleHolder.t("Etapa", "Stage")} $n${day.stageSuffix.orEmpty()}"
        }
        day.distanceKm?.takeIf { it > 0 }?.let { km ->
            val format = NumberFormat.getNumberInstance(if (english()) Locale.UK else Locale.forLanguageTag("es-ES"))
                .apply { maximumFractionDigits = 1 }
            parts += "${format.format(km)} km"
        }
        return parts.joinToString(" · ")
    }

    /** Clave de una carrera destacada de carretera en un día (`featured_races_for_dates`). */
    fun featuredKey(dateKey: String, raceId: String?): String = "$dateKey|${raceId.orEmpty()}"

    /** Orden canónico de Hoy: destacadas (corona del panel), gran vuelta, categoría, género,
     *  salida y nombre. */
    private fun compareRoad(a: VideoFeedDay, b: VideoFeedDay, featured: Set<String>): Int {
        val fa = if (featuredKey(a.dateKey, a.race?.id) in featured) 0 else 1
        val fb = if (featuredKey(b.dateKey, b.race?.id) in featured) 0 else 1
        if (fa != fb) return fa - fb
        val ga = if (a.race?.isGrandTour == true) 0 else 1
        val gb = if (b.race?.isGrandTour == true) 0 else 1
        if (ga != gb) return ga - gb
        val ca = RaceLogic.categoryRank(a.race?.uciCategory, a.race?.name, a.race?.countryCode)
        val cb = RaceLogic.categoryRank(b.race?.uciCategory, b.race?.name, b.race?.countryCode)
        if (ca != cb) return ca.compareTo(cb)
        val sa = RaceLogic.genderRank(a.race?.gender)
        val sb = RaceLogic.genderRank(b.race?.gender)
        if (sa != sb) return sa - sb
        val ta = a.neutralStartTimeUtc ?: "~"
        val tb = b.neutralStartTimeUtc ?: "~"
        if (ta != tb) return ta.compareTo(tb)
        return (a.race?.name ?: "").compareTo(b.race?.name ?: "")
    }

    // ─── Ciclocross ──────────────────────────────────────────────

    /**
     * Tipo de un vídeo CX (carrera completa, resumen, meta y el resto):
     * `cx_videos` no guarda el tipo y sale de la convención de títulos de
     * cc-cx-carreras («Carrera completa …», «Resumen …», «Meta …»). Espejo de
     * `cxVideoKind` (web).
     */
    fun cxVideoKind(title: String): String {
        val value = title.trim().lowercase(Locale.ROOT)
        return when {
            value.startsWith("carrera completa") || value.startsWith("retransmisión completa") -> "full"
            value.startsWith("resumen") -> "summary"
            value == "meta" || value.startsWith("meta ") -> "last_km"
            else -> "other"
        }
    }

    /** Vídeo de una tarjeta CX con las claves de su orden: emisión convertida en
     *  «Carrera completa» y posición de su categoría ([CxPresentation.categoryRank]). */
    private class CxFeedVideo(val entry: StageVideoLogic.Entry, val converted: Boolean, val categoryRank: Int)

    /**
     * Una entrada por prueba y día con vídeos o Revive: la fecha de cada vídeo
     * o emisión es la de su categoría o, sin categoría, la de la prueba. Vídeos
     * con las emisiones convertidas al final; delante, por categoría (ME, WE,
     * MU, WU, MJ, WJ), tipo y orden recibido (decisión de Dani, 2026-11-14), y
     * al final las filas de Revive, por categoría. Espejo de `byCxOrder` (web).
     */
    fun cxEntries(races: List<CxRace>, allowedGroups: Set<String>, rounds: Map<String, CxRound>): List<VideoFeedEntry> {
        val out = mutableListOf<VideoFeedEntry>()
        for (race in races) {
            if (race.isCancelled) continue
            // Categorías con resultados publicados: la agenda trae el estado, no
            // las filas, y Revive pide resultados en la categoría (como la web).
            val published = race.categories.filter { it.resultsStatus in listOf("official", "provisional") }
                .map { CxResult(id = 0, raceId = race.id, category = it.category, riderDisplay = "") }
            val detail = CxDetail(race = race, results = published, broadcasts = race.broadcasts, videos = race.videos)
            val videos = CxPresentation.videos(detail, allowedGroups)
            val revive = CxPresentation.programmeMedia(detail, allowedGroups).revive
            if (videos.isEmpty() && revive.isEmpty()) continue
            val broadcastIds = race.broadcasts.mapTo(mutableSetOf()) { it.id }
            fun dateOf(code: String?): String =
                code?.let { c -> race.categories.firstOrNull { it.category == c } }?.dateKey ?: race.dateKey
            val byDate = linkedMapOf<String, Triple<MutableList<CxFeedVideo>, MutableList<StageVideoLogic.Entry>, MutableList<String>>>()
            fun bucket(date: String) = byDate.getOrPut(date) { Triple(mutableListOf(), mutableListOf(), mutableListOf()) }
            for (video in videos) {
                val title = if (english()) video.titleEn?.takeIf { it.isNotBlank() } ?: video.title else video.title
                // Emisión convertida: la que ya es «Carrera completa» por ser emisión;
                // un vídeo propio titulado «Carrera completa …» no lo es.
                val isBroadcast = video.id in broadcastIds
                val kind = if (isBroadcast) "full" else cxVideoKind(video.title)
                bucket(dateOf(video.category)).first += CxFeedVideo(
                    StageVideoLogic.Entry(
                        id = video.id, kind = kind, title = title, titleEn = title, channel = video.channel,
                        url = video.url, embeddable = null, country = null, sortOrder = video.sortOrder, converted = false,
                    ),
                    converted = isBroadcast,
                    categoryRank = CxPresentation.categoryRank(video.category),
                )
            }
            for (link in revive) {
                val (es, en) = CxPresentation.fullRaceTitle(link.category)
                val title = if (english()) en else es
                val bucket = bucket(dateOf(link.category))
                bucket.second += reviveRow("${link.url}-${link.category.orEmpty()}", link.url, link.title, null, title)
                bucket.third += link.url
            }
            val subtitle = cxSubtitle(race, rounds[race.id])
            val name = if (english()) race.nameEn?.takeIf { it.isNotBlank() } ?: race.name else race.name
            for ((date, lists) in byDate) {
                val (own, reviveRows, urls) = lists
                val expandable = own.isNotEmpty() || reviveRows.size > 1
                // Clave: emisión convertida al final, categoría canónica, tipo e índice
                // original (decisión de Dani, 2026-11-14).
                val ordered = own.withIndex().sortedWith(
                    compareBy<IndexedValue<CxFeedVideo>>(
                        { it.value.converted },
                        { it.value.categoryRank },
                        { StageVideoLogic.kindRank(it.value.entry.kind) },
                        { it.index },
                    ),
                ).map { it.value.entry }
                out += VideoFeedEntry(
                    id = "cx-${race.id}-$date", date = date, name = name, subtitle = subtitle,
                    logoUrl = CxPresentation.logo(race), countryCode = race.countryCode?.takeIf { it.isNotBlank() },
                    placeholderLogo = race.raceClass != "CN", oneDay = true, rows = ordered + reviveRows,
                    expandable = expandable,
                    fullUrl = if (expandable) null else urls.firstOrNull(),
                    fullLabel = if (expandable) null else reviveRows.firstOrNull()?.channel.let(::broadcastLabel),
                    stageId = null, raceId = null, cxRaceId = race.id, cxRace = race,
                )
            }
        }
        return out
    }

    /** Torneo, manga n/total y sede, como la fila CX de Resultados. */
    private fun cxSubtitle(race: CxRace, round: CxRound?): String {
        val parts = mutableListOf<String>()
        race.tournament?.let { parts += LocaleHolder.t(it.name, it.nameEn?.takeIf { name -> name.isNotBlank() } ?: it.name) }
        CxPresentation.roundLabel(round)?.let { parts += it }
        race.venue?.trim()?.takeIf { it.isNotEmpty() && it != race.name }?.let { parts += it }
        return parts.joinToString(" · ")
    }

    /** Días de [fromKey, toKey] en orden cronológico inverso; ciclocross en el
     *  orden de la agenda. */
    fun days(entries: List<VideoFeedEntry>, fromKey: String?, toKey: String, cxRaces: List<CxRace> = emptyList(), cxFeatured: Set<String> = emptySet()): List<VideoFeedDayGroup> {
        val inWindow = entries.filter { (fromKey == null || it.date >= fromKey) && it.date <= toKey }
        return inWindow.map { it.date }.distinct().sortedDescending().map { date ->
            var list = inWindow.filter { it.date == date }
            if (cxRaces.isNotEmpty()) {
                val order = CyclocrossLogic.racesOn(cxRaces, date, cxFeatured).map { it.id }
                list = list.withIndex().sortedWith(compareBy({ order.indexOf(it.value.cxRaceId).let { i -> if (i < 0) Int.MAX_VALUE else i } }, { it.index }))
                    .map { it.value }
            }
            VideoFeedDayGroup(date, list)
        }
    }
}
