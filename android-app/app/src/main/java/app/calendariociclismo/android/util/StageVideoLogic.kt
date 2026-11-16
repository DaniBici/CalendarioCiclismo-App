package app.calendariociclismo.android.util

import android.net.Uri
import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.RaceDayVideo

/**
 * Vídeos de una jornada de carretera. Espejo de `js/services/stage-videos.js`
 * (web) y `StageVideoLogic.swift` (iOS); docs/plans/videos-5-2.md.
 *
 * - Emisión convertida: emisión de Revive de la jornada con clasificaciones
 *   propias, de YouTube con vídeo fijo y `embeddable` distinto de `false`. Pasa
 *   a Vídeos como «Emisión de la etapa/carrera» (tipo `full`) y sale de Revive.
 * - Orden: emisión completa, resumen, último kilómetro y el resto; dentro de
 *   cada tipo, `sortOrder` (en `full`, primero `race_day_videos` y después las
 *   convertidas). El mismo vídeo (ID de YouTube o URL normalizada) aparece una
 *   vez; se conserva la fila de `race_day_videos`.
 */
object StageVideoLogic {
    private val KIND_RANK = mapOf("full" to 0, "summary" to 1, "last_km" to 2, "other" to 3)
    private val YOUTUBE_ID = Regex("^[A-Za-z0-9_-]{11}$")

    /** Posición del tipo en el orden de presentación (emisión completa, resumen, último km, resto). */
    fun kindRank(kind: String): Int = KIND_RANK[kind] ?: 3

    data class Entry(
        val id: String,
        val kind: String,
        /** `null` en las emisiones convertidas: el rótulo depende del formato de la carrera. */
        val title: String?,
        val titleEn: String?,
        val channel: String?,
        val url: String,
        val embeddable: Boolean?,
        val country: String?,
        val sortOrder: Int,
        val converted: Boolean,
    )

    data class MediaState(
        val entries: List<Entry>,
        /** Emisiones de Revive que no están en Vídeos. */
        val revive: List<Broadcast>,
        /** Clasificaciones propias y alguna emisión de Revive con enlace. */
        val hasRevive: Boolean,
    )

    /** ID de YouTube con vídeo fijo (`watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/`). */
    fun youtubeId(url: String?): String? {
        val uri = url?.trim()?.let { runCatching { Uri.parse(it) }.getOrNull() } ?: return null
        if (uri.scheme?.lowercase() != "https") return null
        val host = uri.host?.lowercase() ?: return null
        val parts = uri.pathSegments.orEmpty()
        val id = when {
            host == "youtu.be" && parts.size == 1 -> parts[0]
            host in setOf("youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com") -> when {
                parts == listOf("watch") -> uri.getQueryParameter("v")
                parts.size == 2 && parts[0] in setOf("live", "shorts", "embed") -> parts[1]
                else -> null
            }
            else -> null
        }
        return id?.takeIf { YOUTUBE_ID.matches(it) }
    }

    /** Identidad de un vídeo: ID de YouTube o URL sin protocolo, www, fragmento ni barra final. */
    fun videoKey(url: String?): String {
        if (url == null) return ""
        youtubeId(url)?.let { return "yt:$it" }
        val uri = runCatching { Uri.parse(url.trim()) }.getOrNull() ?: return url.trim()
        val host = uri.host?.lowercase()?.removePrefix("www.") ?: return url.trim()
        val path = (uri.encodedPath ?: "").trimEnd('/')
        val query = uri.encodedQuery?.let { "?$it" }.orEmpty()
        return "$host$path$query"
    }

    fun isConvertible(broadcast: Broadcast): Boolean =
        !broadcast.url.isNullOrEmpty() && broadcast.embeddable != false && youtubeId(broadcast.url) != null

    /** Emisiones convertidas de la jornada, en su orden. */
    fun convertedBroadcasts(broadcasts: List<Broadcast>, hasResults: Boolean, isCancelled: Boolean): List<Broadcast> {
        if (!hasResults) return emptyList()
        return RaceLogic.reviveBroadcasts(broadcasts.sortedBy { it.sortOrder }, isCancelled).filter(::isConvertible)
    }

    /** Vídeos de la jornada en el orden de presentación. */
    fun entries(broadcasts: List<Broadcast>, videos: List<RaceDayVideo>, hasResults: Boolean, isCancelled: Boolean): List<Entry> {
        val own = videos.filter { it.url.isNotEmpty() }.map { v ->
            Entry(v.id, if (v.kind in KIND_RANK) v.kind else "other", v.title, v.titleEn, v.channel, v.url,
                v.embeddable, v.country, v.sortOrder, converted = false)
        }
        val converted = convertedBroadcasts(broadcasts, hasResults, isCancelled).map { b ->
            Entry(b.id, "full", null, null, b.channel, b.url.orEmpty(), b.embeddable, b.country, b.sortOrder, converted = true)
        }
        val ordered = (own + converted).sortedWith(
            compareBy<Entry>({ KIND_RANK[it.kind] ?: 3 }, { if (it.converted) 1 else 0 }, { it.sortOrder })
        )
        val seen = mutableSetOf<String>()
        return ordered.filter { seen.add(videoKey(it.url)) }
    }

    /** Vídeos y Revive de la jornada. */
    fun mediaState(broadcasts: List<Broadcast>, videos: List<RaceDayVideo>, hasResults: Boolean, isCancelled: Boolean): MediaState {
        val list = entries(broadcasts, videos, hasResults, isCancelled)
        val keys = list.map { videoKey(it.url) }.toSet()
        val revive = RaceLogic.reviveBroadcasts(broadcasts.sortedBy { it.sortOrder }, isCancelled)
            .filter { videoKey(it.url) !in keys }
        return MediaState(list, revive, hasResults && revive.any { !it.url.isNullOrEmpty() })
    }

    /** Emisión que abre Revive en la tarjeta terminada: redes sociales antes que el resto, después `sortOrder`. */
    fun cardReviveBroadcast(broadcasts: List<Broadcast>): Broadcast? {
        fun social(url: String?): Int {
            val u = url.orEmpty().lowercase()
            return if ("youtube.com" in u || "youtu.be" in u || "facebook.com" in u) 0 else 1
        }
        return broadcasts.filter { RaceLogic.isReviveBroadcast(it) }
            .sortedWith(compareBy<Broadcast>({ social(it.url) }, { it.sortOrder }))
            .firstOrNull()
    }

    /**
     * Destinos de la tarjeta terminada: `hasVideos` (vídeos propios distintos de
     * Revive: la tarjeta lleva al panel Vídeos) y `revive` (la emisión íntegra).
     * Con los dos, menú «Vídeos» / «Completa».
     */
    fun cardActions(broadcasts: List<Broadcast>, videos: List<RaceDayVideo>): Pair<Boolean, Broadcast?> {
        val revive = cardReviveBroadcast(broadcasts)?.takeIf { !it.url.isNullOrEmpty() }
        val reviveKey = revive?.let { videoKey(it.url) }
        return videos.any { it.url.isNotEmpty() && videoKey(it.url) != reviveKey } to revive
    }

    /** Vídeos visibles con los grupos regionales del usuario. */
    fun filterByRegion(videos: List<RaceDayVideo>, allowedGroups: Set<String>): List<RaceDayVideo> =
        videos.filter { RaceLogic.broadcastMatchesRegion(it.country, allowedGroups) }.sortedBy { it.sortOrder }

    /** Rótulo del vídeo: las emisiones convertidas, según el formato de la carrera. */
    fun title(entry: Entry, oneDay: Boolean, english: Boolean): String =
        if (entry.converted) {
            if (english) (if (oneDay) "Race broadcast" else "Stage broadcast")
            else (if (oneDay) "Emisión de la carrera" else "Emisión de la etapa")
        } else if (english) entry.titleEn ?: entry.title.orEmpty() else entry.title.orEmpty()

    /** Reproductor integrado: YouTube con `embeddable` distinto de `false`; el resto se abre fuera. */
    fun embeddedYouTubeId(entry: Entry): String? = if (entry.embeddable == false) null else youtubeId(entry.url)

    private val PLATFORMS = listOf(
        "rtve.es" to "RTVE Play", "etbon.eus" to "ETB On", "eitb.eus" to "ETB On", "raiplay.it" to "RaiPlay",
        "rtbf.be" to "Auvio", "hbomax.com" to "HBO Max", "max.com" to "HBO Max", "sporza.be" to "Sporza",
        "vrt.be" to "VRT MAX", "rtp.pt" to "RTP Play", "3cat.cat" to "3Cat", "ccma.cat" to "3Cat",
        "youtube.com" to "YouTube", "youtu.be" to "YouTube", "facebook.com" to "Facebook", "fb.watch" to "Facebook",
        "instagram.com" to "Instagram", "x.com" to "X", "twitter.com" to "X", "tiktok.com" to "TikTok",
    )

    /** Plataforma del enlace externo («RTVE Play ↗»): nombre conocido o el dominio. */
    fun platformLabel(url: String): String {
        val host = runCatching { Uri.parse(url).host }.getOrNull()?.lowercase() ?: return ""
        return PLATFORMS.firstOrNull { (domain, _) -> host == domain || host.endsWith(".$domain") }?.second
            ?: host.removePrefix("www.")
    }

    /** Plataforma del evento `video_open`, con los valores de la web. */
    fun platformKey(url: String): String = when (platformLabel(url)) {
        "YouTube" -> "youtube"
        "RTVE Play" -> "rtve_play"
        "ETB On" -> "etb_on"
        "RaiPlay" -> "raiplay"
        "Auvio" -> "auvio"
        else -> "other"
    }
}
