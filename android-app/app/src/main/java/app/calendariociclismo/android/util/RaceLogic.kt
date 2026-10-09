package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

/**
 * Lógica de negocio de carreras — port literal de
 * `ios-app/.../Services/RaceLogic.swift` y `js/services/races.js`.
 *
 * Son funciones puras, sin dependencias de framework, para poder testearlas
 * como `junit` tests normales.
 */
object RaceLogic {

    /**
     * Orden del programa de una carrera: por número de etapa y, en dobles
     * sectores, por salida neutralizada; sin número de etapa, por fecha.
     */
    val raceProgramOrder: Comparator<RaceDay> = Comparator { a, b ->
        val na = a.stageNumber
        val nb = b.stageNumber
        if (na != null && nb != null) {
            if (na != nb) na.compareTo(nb)
            else {
                val tA = a.neutralStartTimeUtc?.let { DateFormatting.timestampToSeconds(it) }
                    ?: Double.MAX_VALUE
                val tB = b.neutralStartTimeUtc?.let { DateFormatting.timestampToSeconds(it) }
                    ?: Double.MAX_VALUE
                tA.compareTo(tB)
            }
        } else {
            a.dateKey.compareTo(b.dateKey)
        }
    }

    fun calendarYear(now: Instant = Instant.now()): Int = now.atOffset(ZoneOffset.UTC).year

    fun hasCalendarForYear(year: Int?, now: Instant = Instant.now()): Boolean =
        year != null && year >= calendarYear(now)

    enum class TodayRaceState { CANCELLED, REST, RESULTS, WAITING, RUNNING, SCHEDULED }

    fun todayRaceState(
        rd: RaceDay,
        hasInhouseResults: Boolean,
        now: Instant = Instant.now(),
    ): TodayRaceState {
        if (rd.isCancelledDay) return TodayRaceState.CANCELLED
        if (rd.isRestDay) return TodayRaceState.REST
        if (hasInhouseResults) return TodayRaceState.RESULTS
        if (rd.raceStatus == "finished") return TodayRaceState.WAITING
        val finish = runCatching { rd.estimatedFinishTimeUtc?.let(Instant::parse) }.getOrNull()
        if (finish != null && !now.isBefore(finish)) return TodayRaceState.WAITING
        if (rd.raceStatus == "running") return TodayRaceState.RUNNING
        val start = runCatching { rd.neutralStartTimeUtc?.let(Instant::parse) }.getOrNull()
        if (start != null && !now.isBefore(start)) return TodayRaceState.RUNNING
        return TodayRaceState.SCHEDULED
    }

    /**
     * Avance (0…1) del miniperfil de la tarjeta de Hoy. Espejo de
     * `profileProgress` (js/services/race-presentation.js): con resultados o
     * estado terminado, completo; crono en curso sin avance único (salidas
     * escalonadas); el resto, tiempo transcurrido entre salida real (o
     * neutralizada) y meta prevista.
     */
    fun profileProgress(
        rd: RaceDay,
        hasInhouseResults: Boolean,
        now: Instant = Instant.now(),
    ): Float {
        if (rd.isCancelledDay || rd.isRestDay) return 0f
        if (hasInhouseResults || rd.raceStatus == "finished") return 1f
        if (rd.primaryType == "itt" || rd.primaryType == "ttt") return 0f
        val startRaw = rd.realStartTimeUtc?.takeIf { it.isNotEmpty() } ?: rd.neutralStartTimeUtc
        val start = startRaw?.let { DateFormatting.parseIso(it) } ?: return 0f
        val finish = rd.estimatedFinishTimeUtc?.let { DateFormatting.parseIso(it) } ?: return 0f
        if (!finish.isAfter(start)) return 0f
        val elapsed = (now.toEpochMilli() - start.toEpochMilli()).toDouble()
        val total = (finish.toEpochMilli() - start.toEpochMilli()).toDouble()
        return (elapsed / total).coerceIn(0.0, 1.0).toFloat()
    }

    /** Carreras referenciadas por jornadas que no estaban en la consulta por
     * solapamiento de fechas del mes. */
    fun missingRaceIds(raceDays: List<RaceDay>, races: List<Race>): List<String> {
        val loadedIds = races.mapTo(hashSetOf()) { it.id }
        return raceDays.mapNotNull { it.raceId }.distinct().filterNot { it in loadedIds }
    }

    // ── Resultados post-carrera ─────────────────────────────────

    /** Comprueba si la hora actual supera `estimatedFinishTimeUtc + offsetMinutes`. Fallback: dateKey 18:00 UTC + offset. */
    fun raceTimeCheck(rd: RaceDay, offsetMinutes: Long): Boolean {
        val finishUtc = rd.estimatedFinishTimeUtc
        if (finishUtc != null) {
            try {
                val finish = Instant.parse(finishUtc)
                val parts = rd.dateKey.split("-").map { it.toInt() }
                val dateKeyMidnight = LocalDate.of(parts[0], parts[1], parts[2])
                    .atStartOfDay()
                    .toInstant(ZoneOffset.UTC)
                if (finish >= dateKeyMidnight) {
                    return Instant.now() >= finish.plusSeconds(offsetMinutes * 60)
                }
                // finish anterior al dateKey → ignorar, usar fallback
            } catch (_: Exception) { }
        }
        return try {
            val parts = rd.dateKey.split("-").map { it.toInt() }
            val fallback = LocalDate.of(parts[0], parts[1], parts[2])
                .atTime(18, 0)
                .toInstant(ZoneOffset.UTC)
            Instant.now() >= fallback.plusSeconds(offsetMinutes * 60)
        } catch (_: Exception) { false }
    }

    /** True si la carrera ya concluyó: >=30 min tras la hora estimada de llegada,
     *  con FALLBACK a `dateKey` 18:00 UTC cuando no hay hora de meta (lo aporta
     *  `raceTimeCheck`). Espejo de la `isRaceConcluded(rd)` exportada en
     *  `js/race-data-modal.js`, que NO exige `estimatedFinishTimeUtc`: los
     *  Campeonatos Nacionales no tienen hora de meta curada (lo usa la rejilla
     *  de Campeonatos). */
    fun isRaceConcluded(rd: RaceDay): Boolean {
        if (rd.isRestDay || rd.isCancelledDay) return false
        return raceTimeCheck(rd, 30)
    }

    /**
     * Estado del badge de TV en una celda compacta del Modo Campeonatos. Versión
     * reducida de `tvBadge` (js/race-assets.js) para una sola línea: no distingue
     * canales sociales ni estados none/pending/unavailable_es (la rejilla solo
     * entra aquí cuando ya hay cobertura de TV). Espejo de `championshipTvState`
     * en iOS (RaceLogic.swift) — mantener paridad.
     */
    sealed interface ChampionshipTvState {
        object Live : ChampionshipTvState                 // hora de TV ya pasó → "Live"
        data class Time(val display: String) : ChampionshipTvState  // hora futura
        object Label : ChampionshipTvState                // hay TV pero sin hora → "TV"
    }

    /** `refTs` = la hora de inicio (`startTimeUtc`) más temprana de los broadcasts;
     *  si ya pasó → Live; si es futura → Time; si no hay ninguna → Label. */
    fun championshipTvState(broadcasts: List<Broadcast>): ChampionshipTvState {
        val pairs = broadcasts.mapNotNull { b ->
            val ts = b.startTimeUtc ?: return@mapNotNull null
            runCatching { Instant.parse(ts) }.getOrNull()?.let { ts to it }
        }
        val earliest = pairs.minByOrNull { it.second } ?: return ChampionshipTvState.Label
        if (earliest.second <= Instant.now()) return ChampionshipTvState.Live
        val display = DateFormatting.formatTimeLocal(earliest.first) ?: return ChampionshipTvState.Label
        return ChampionshipTvState.Time(display)
    }

    // ── Filtro por grupo regional ───────────────────────────────

    /**
     * Baseline gratuito heredado de 1.4.4 — `ALL + ES + EUROPA`. Se usa como
     * default cuando el caller no tiene acceso a la preferencia regional del
     * usuario, así no degradamos lo gratis.
     */
    private val DEFAULT_BROADCAST_GROUPS = setOf("ALL", "ES", "EUROPA")

    /**
     * Filtra broadcasts según los grupos de país permitidos por la preferencia
     * regional del usuario. Los broadcasts sin `country` se consideran globales
     * y siempre se muestran (compatibilidad con datos antiguos antes de que
     * existiera la columna).
     *
     * El default preserva el comportamiento gratuito previo a 2.0 (ALL+ES+EUROPA).
     * Los callers que quieren respetar la preferencia premium del usuario deben
     * pasar `RegionPreference.allowedBroadcastGroups`.
     */
    fun filterBroadcastsByRegion(
        broadcasts: List<Broadcast>,
        allowedGroups: Set<String> = DEFAULT_BROADCAST_GROUPS,
    ): List<Broadcast> =
        broadcasts.filter { broadcastMatchesRegion(it.country, allowedGroups) }

    fun broadcastMatchesRegion(country: String?, allowedGroups: Set<String>): Boolean =
        country.isNullOrEmpty() || country in allowedGroups

    /**
     * Prioridad del enlace del badge de TV en directo (Hoy / Competición). Decide a qué
     * emisión enlaza el badge cuando hay varias. Orden:
     *   0) YouTube
     *   1) otras redes sociales (Facebook, Instagram, X/Twitter, TikTok, Twitch, Kick)
     *   2) RTVE.es (pública estatal, por delante del resto de cadenas españolas)
     *   3) otras TV públicas en abierto: RTP1, CCMA (TV3 / Esport3 / 3Cat), EITB (ETB)
     *   4) resto de cadenas
     * Eurosport / HBO Max / Max son "una cadena más" (tier 4, sin trato especial).
     * Espejo de `broadcastLinkPriority` en `js/broadcast-priority.js` (web) e iOS.
     */
    fun broadcastLinkPriority(url: String?): Int {
        val u = (url ?: "").lowercase()
        if (u.contains("youtube.com") || u.contains("youtu.be")) return 0
        // `x.com` se ancla con `//` o `.` delante para no capturar `play.max.com`.
        if (u.contains("facebook.com") || u.contains("fb.watch") || u.contains("instagram.com") ||
            u.contains("tiktok.com") || u.contains("twitch.tv") || u.contains("kick.com") ||
            u.contains("twitter.com") || u.contains("//x.com") || u.contains(".x.com")
        ) return 1
        if (u.contains("rtve.es")) return 2
        if (u.contains("rtp.pt") || u.contains("ccma.cat") || u.contains("3cat.cat") || u.contains("eitb.")) return 3
        return 4
    }

    /** Hosts que deben intentar primero una app nativa antes del Custom Tab. */
    fun prefersNativeApp(url: String): Boolean {
        val host = runCatching { java.net.URI(url).host?.lowercase() }.getOrNull() ?: return false
        val domains = listOf(
            "youtube.com", "youtu.be", "hbomax.com", "play.max.com",
            "x.com", "twitter.com",
        )
        return domains.any { host == it || host.endsWith(".$it") }
    }

    private fun isEtbOnDemand(url: String): Boolean {
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals("etbon.eus", ignoreCase = true) &&
            uri.path.orEmpty().startsWith("/m/")
    }

    private fun isSocialReplay(url: String): Boolean {
        val host = runCatching { java.net.URI(url).host?.lowercase() }.getOrNull() ?: return false
        val domains = listOf(
            "youtube.com", "youtu.be", "facebook.com", "fb.watch", "instagram.com",
            "tiktok.com", "twitch.tv", "kick.com", "twitter.com", "x.com",
        )
        return domains.any { host == it || host.endsWith(".$it") }
    }

    fun isReviveBroadcast(broadcast: Broadcast): Boolean =
        isReviveBroadcast(broadcast.channel, broadcast.url, broadcast.showInRevive)

    /** Criterio Revive por canal, URL y marca editorial; lo comparte ciclocross. */
    fun isReviveBroadcast(channel: String?, url: String?, showInRevive: Boolean): Boolean {
        val link = url?.takeIf { it.isNotEmpty() } ?: return false
        if (showInRevive) return true
        val name = (channel ?: "").lowercase()
        return name.contains("eurosport") || name.contains("hbo max") ||
            isSocialReplay(link) || isEtbOnDemand(link)
    }

    fun shouldShowBroadcastNote(hasResults: Boolean, isRevive: Boolean, showInRevive: Boolean): Boolean =
        !hasResults && (!isRevive || showInRevive)

    fun hasReviveBroadcasts(
        broadcasts: List<Broadcast>, hasCurrentResults: Boolean, isCancelled: Boolean = false,
    ): Boolean = hasCurrentResults && reviveBroadcasts(broadcasts, isCancelled)
        .any { !it.url.isNullOrEmpty() }

    fun reviveBroadcasts(broadcasts: List<Broadcast>, isCancelled: Boolean): List<Broadcast> =
        if (isCancelled) broadcasts.filter { it.showInRevive }
        else broadcasts.filter(::isReviveBroadcast)

    /** Primer URL Revive, incluidos los deep-links /m/ bajo demanda de ETB ON. */
    fun reviveUrl(broadcasts: List<Broadcast>): String? {
        val sorted = broadcasts.sortedBy { it.sortOrder }
        for (b in sorted) {
            val url = b.url ?: continue
            if (isReviveBroadcast(b)) return url
        }
        return null
    }

    // ── Tipo de etapa ───────────────────────────────────────────

    fun typeLabel(context: android.content.Context, type: String?): String =
        Constants.stageTypeLabel(context, type)

    /** @param countryCode Código de país ISO-2 de la carrera (ej. "fr"). Opcional. */
    fun resolveTypeLabel(
        context: android.content.Context,
        primary: String?,
        secondary: String?,
        countryCode: String? = null,
    ): String {
        if (primary == "sterrato" && countryCode?.uppercase() == "FR") {
            return context.getString(app.calendariociclismo.android.R.string.stage_doc_ribinou)
        }
        if (primary == "flat" && secondary == "summit_finish") return LocaleHolder.t("Monopuerto", "One-Climb")
        if (primary == "itt" && (secondary == "chrono_climb" || secondary == "summit_finish")) {
            return typeLabel(context, "chrono_climb")
        }
        val pLabel = typeLabel(context, primary)
        if (primary == "itt" || primary == "ttt") return pLabel
        return if (!secondary.isNullOrEmpty()) "$pLabel · ${typeLabel(context, secondary)}" else pLabel
    }

    // ── Rankings UCI ────────────────────────────────────────────

    /**
     * Rango de categoría: menor va antes. Tabla única, espejo de `categoryRank`
     * en `js/services/race-order.js`. Las grandes vueltas encabezan; el Tour del
     * Porvenir sube al nivel de las .1; las Pro y .1 del circuito asiático (salvo
     * la Japan Cup) bajan tras las .1 europeas; los continentales que no son el
     * Europeo bajan tras las .2U.
     */
    fun categoryRank(category: String?, name: String?, country: String?): Double {
        val n = name.orEmpty()
        if (n.containsIgnoreCase("giro de italia")) return 0.1
        if (n.containsIgnoreCase("tour de francia")) return 0.2
        if (n.containsIgnoreCase("la vuelta")) return 0.3

        val cat = category.orEmpty()
        val cc = country.orEmpty().uppercase()

        if ((cat == "1.2U" || cat == "2.2U") && n.containsIgnoreCase("tour del porvenir")) return 8.5
        if (cat == "CC" && !n.containsIgnoreCase("europa") && !n.containsIgnoreCase("europe")) return 14.5
        if (cat in listOf("1.Pro", "2.Pro", "1.1", "2.1") &&
            isAsiaCountry(cc) &&
            !n.containsIgnoreCase("japan cup")
        ) return 10.5

        return Constants.UCI_ORDER[cat] ?: 99.0
    }

    /** [categoryRank] de la carrera (null → 99). */
    fun raceCategoryRank(race: Race?): Double =
        categoryRank(race?.uciCategory, race?.name, race?.countryCode)

    private fun isAsiaCountry(cc: String): Boolean =
        cc in setOf("CN", "TH", "JP", "TW", "KR", "HK", "AZ")

    fun genderRank(gender: String?): Int = if (gender == "female") 2 else 1

    fun grandTourRank(race: Race?): Int = if (race?.isGrandTour == true) 0 else 1

    fun categoryTier(uci: String?): String? {
        if (uci == null) return null
        if (Constants.CATEGORY_TIERS["WC"]?.contains(uci) == true) return "wc"
        if (Constants.CATEGORY_TIERS["WT"]?.contains(uci) == true) return "wt"
        if (Constants.CATEGORY_TIERS["PRO"]?.contains(uci) == true) return "pro"
        if (Constants.CATEGORY_TIERS["MINOR"]?.contains(uci) == true) return "2"
        return if (uci.isEmpty()) null else "1"
    }

    /**
     * Nombre legible de la categoría UCI para cabeceras: las siglas sin
     * contexto (CC, WC, NC) se escriben completas y las clases numéricas se
     * leen con el prefijo UCI («UCI 2.2»). Espejo de `uciCategoryName`
     * (`js/shared.js`).
     */
    fun uciCategoryName(uci: String?, english: Boolean = LocaleHolder.shouldShowEnglishContent): String {
        if (uci.isNullOrEmpty()) return ""
        val names = if (english) mapOf(
            "CC" to "Continental Championships", "WC" to "World Championships", "NC" to "National Championships",
            "UWT" to "UCI WorldTour", "WWT" to "UCI Women\u2019s WorldTour", "Pro" to "UCI ProSeries",
        ) else mapOf(
            "CC" to "Campeonato continental", "WC" to "Campeonato del mundo", "NC" to "Campeonato nacional",
            "UWT" to "UCI WorldTour", "WWT" to "UCI Women\u2019s WorldTour", "Pro" to "UCI ProSeries",
        )
        names[uci]?.let { return it }
        val parts = uci.split('.')
        if (parts.size > 1) names[parts[1]]?.let { return it }
        return if (parts.size > 1 && uci.first().isDigit()) "UCI $uci" else uci
    }

    // ── Ordenación ──────────────────────────────────────────────

    /**
     * Comparator equivalente a [byCategory] para [RaceDay] planos con acceso a
     * un raceMap externo. Usado en MonthScreen donde no hay [EnrichedRaceDay].
     */
    fun byCategoryWithRaceMap(raceMap: Map<String, Race>): Comparator<RaceDay> = Comparator { a, b ->
        val rA = a.raceId?.let { raceMap[it] }
        val rB = b.raceId?.let { raceMap[it] }

        val phA = if (a.editorialStatus == "placeholder" || rA?.isCancelled == true) 1 else 0
        val phB = if (b.editorialStatus == "placeholder" || rB?.isCancelled == true) 1 else 0
        if (phA != phB) return@Comparator phA.compareTo(phB)

        // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría.
        ChampionshipsConfig.compare(rA, a, rB, b)?.let { if (it != 0) return@Comparator it }

        val gtA = grandTourRank(rA); val gtB = grandTourRank(rB)
        if (gtA != gtB) return@Comparator gtA.compareTo(gtB)

        val catA = raceCategoryRank(rA); val catB = raceCategoryRank(rB)
        if (catA != catB) return@Comparator catA.compareTo(catB)

        val genA = genderRank(rA?.gender); val genB = genderRank(rB?.gender)
        if (genA != genB) return@Comparator genA.compareTo(genB)

        // Doble sector (misma carrera, mismo día): la etapa MÁS TEMPRANA primero.
        // Desempate por hora de salida; si falta, por el sufijo A/B (asignado en
        // orden cronológico por annotateDoubleSectors).
        val tA = a.neutralStartTimeUtc?.let { DateFormatting.timestampToSeconds(it) } ?: Double.MAX_VALUE
        val tB = b.neutralStartTimeUtc?.let { DateFormatting.timestampToSeconds(it) } ?: Double.MAX_VALUE
        if (tA != tB) return@Comparator tA.compareTo(tB)
        val sfx = (a.stageSuffix ?: "").compareTo(b.stageSuffix ?: "")
        if (sfx != 0) return@Comparator sfx

        (rA?.name ?: "").compareTo(rB?.name ?: "")
    }

    /**
     * Carreras sin jornada publicada y canceladas: van al final en todos los
     * órdenes de la agenda de Hoy, aunque estén destacadas.
     */
    fun isAgendaTail(item: EnrichedRaceDay): Boolean =
        item.isPlaceholder || item.race?.isCancelled == true

    /**
     * Comparator estándar por categoría. Espejo de `compareAgendaByCategory`
     * (`js/services/today-agenda-order.js`): cola al final → Campeonatos
     * Nacionales → gran vuelta → [categoryRank] → sexo → hora de salida →
     * sector A/B → nombre. El miniperfil no interviene en el orden.
     */
    val byCategory: Comparator<EnrichedRaceDay> = Comparator { a, b ->
        val phA = if (isAgendaTail(a)) 1 else 0
        val phB = if (isAgendaTail(b)) 1 else 0
        if (phA != phB) return@Comparator phA.compareTo(phB)

        val rA = a.race; val rB = b.race
        // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría.
        ChampionshipsConfig.compare(rA, a.raceDay, rB, b.raceDay)?.let { if (it != 0) return@Comparator it }

        val gtA = grandTourRank(rA); val gtB = grandTourRank(rB)
        if (gtA != gtB) return@Comparator gtA.compareTo(gtB)

        val catA = raceCategoryRank(rA); val catB = raceCategoryRank(rB)
        if (catA != catB) return@Comparator catA.compareTo(catB)

        val genA = genderRank(rA?.gender); val genB = genderRank(rB?.gender)
        if (genA != genB) return@Comparator genA.compareTo(genB)

        // Doble sector (misma carrera, mismo día): la etapa MÁS TEMPRANA primero.
        // Desempate por hora de salida; si falta, por el sufijo A/B (asignado en
        // orden cronológico por annotateDoubleSectors).
        val tA = a.raceDay.neutralStartTimeUtc?.let { DateFormatting.timestampToSeconds(it) } ?: Double.MAX_VALUE
        val tB = b.raceDay.neutralStartTimeUtc?.let { DateFormatting.timestampToSeconds(it) } ?: Double.MAX_VALUE
        if (tA != tB) return@Comparator tA.compareTo(tB)
        val sfx = (a.raceDay.stageSuffix ?: "").compareTo(b.raceDay.stageSuffix ?: "")
        if (sfx != 0) return@Comparator sfx

        (rA?.name ?: "").compareTo(rB?.name ?: "")
    }

    fun earliestTvSeconds(item: EnrichedRaceDay): Double? {
        val times = item.broadcasts
            .mapNotNull { it.startTimeUtc }
            .mapNotNull { DateFormatting.timestampToSeconds(it) }
        return if (times.isEmpty()) null else times.min()
    }

    fun tvSortTier(item: EnrichedRaceDay): Int {
        val tv = item.raceDay.tvStatus.orEmpty()
        val hasBroadcasts = item.broadcasts.isNotEmpty()
        if (earliestTvSeconds(item) != null) return 0
        if (tv == "pending") return 2
        if (tv == "confirmed" || hasBroadcasts) return 1
        return 3
    }

    val byTvTime: Comparator<EnrichedRaceDay> = Comparator { a, b ->
        val phA = if (isAgendaTail(a)) 1 else 0
        val phB = if (isAgendaTail(b)) 1 else 0
        if (phA != phB) return@Comparator phA.compareTo(phB)

        val tierA = tvSortTier(a); val tierB = tvSortTier(b)
        if (tierA != tierB) return@Comparator tierA.compareTo(tierB)

        if (tierA == 0) {
            val hA = earliestTvSeconds(a) ?: 999999.0
            val hB = earliestTvSeconds(b) ?: 999999.0
            if (hA != hB) return@Comparator hA.compareTo(hB)
        }
        byCategory.compare(a, b)
    }

    val byFinishTime: Comparator<EnrichedRaceDay> = Comparator { a, b ->
        val phA = if (isAgendaTail(a)) 1 else 0
        val phB = if (isAgendaTail(b)) 1 else 0
        if (phA != phB) return@Comparator phA.compareTo(phB)

        val fA = a.raceDay.estimatedFinishTimeUtc?.let { DateFormatting.timestampToSeconds(it) }
        val fB = b.raceDay.estimatedFinishTimeUtc?.let { DateFormatting.timestampToSeconds(it) }

        if ((fA == null) != (fB == null)) return@Comparator if (fA != null) -1 else 1
        if (fA != null && fB != null && fA != fB) return@Comparator fA.compareTo(fB)
        byCategory.compare(a, b)
    }

    // ── Filtros de categoría ────────────────────────────────────

    private fun isTourDelPorvenir(name: String): Boolean =
        name.containsIgnoreCase("tour del porvenir")

    private fun isMixedRelayChampionship(category: String, name: String): Boolean =
        (category == "WC" || category == "CC") &&
            (name.containsIgnoreCase("relevo mixto") || name.containsIgnoreCase("mixed relay"))

    fun matchesCategory(race: Race, filter: Constants.CategoryFilter): Boolean {
        if (filter == Constants.CategoryFilter.ALL) return true
        val cat = race.uciCategory.orEmpty()
        val gender = race.gender.orEmpty()
        val cc = race.countryCode.orEmpty().uppercase()
        val name = race.name

        // Campeonatos Nacionales: las élite (masc/fem) cuentan como "pro"; las
        // sub23 quedan fuera de Pro/Masc/Fem (igual que 1.2U/2.2U). Masc/Fem
        // respetan el género de la prueba. uwt/wwt no aplican a CN.
        if (cat == "CN") {
            if (ChampionshipsConfig.isU23Championship(race)) return false
            return when (filter) {
                Constants.CategoryFilter.PRO -> true
                Constants.CategoryFilter.MALE -> !ChampionshipsConfig.isFemaleChampionship(race)
                Constants.CategoryFilter.FEMALE -> ChampionshipsConfig.isFemaleChampionship(race)
                else -> false
            }
        }

        val baseMatch = when (filter) {
            Constants.CategoryFilter.ALL -> true
            Constants.CategoryFilter.PRO ->
                cat != "1.2" && cat != "2.2" &&
                    ((cat != "1.2U" && cat != "2.2U") || isTourDelPorvenir(name))
            Constants.CategoryFilter.UWT -> cat == "1.UWT" || cat == "2.UWT"
            Constants.CategoryFilter.WWT -> cat == "1.WWT" || cat == "2.WWT"
            Constants.CategoryFilter.MALE ->
                (gender == "male" || isMixedRelayChampionship(cat, name)) &&
                    cat != "1.2" && cat != "2.2" &&
                    ((cat != "1.2U" && cat != "2.2U") || isTourDelPorvenir(name))
            Constants.CategoryFilter.FEMALE ->
                (gender == "female" || isMixedRelayChampionship(cat, name)) &&
                    ((cat != "1.2U" && cat != "2.2U") || isTourDelPorvenir(name)) &&
                    ((cat != "1.2" && cat != "2.2") || cc in Constants.EUROPE_COUNTRIES)
        }

        if (!baseMatch) return false

        if (cat == "WC" || cat == "CC") {
            return name.containsIgnoreCase("europa") ||
                name.containsIgnoreCase("europe") ||
                name.containsIgnoreCase("mundo")
        }
        return true
    }

    fun filterByCategory(
        items: List<EnrichedRaceDay>,
        category: Constants.CategoryFilter,
    ): List<EnrichedRaceDay> {
        if (category == Constants.CategoryFilter.ALL) return items
        return items.filter { item ->
            val race = item.race ?: return@filter true
            matchesCategory(race, category)
        }
    }

    private val FEMALE_KEYWORDS = listOf(
        "femenino", "femenina", "féminas", "femeninos", "féminin", "féminine", "féminines",
        // "feminin" (sin acento) cubre feminina/feminino/feminine (portugués/italiano),
        // espejo del patrón f[eé]minin[e]? de la web.
        "feminin",
        "femmes", "women", "ladies", "donne", "dames", "elite women",
        "emakumeen", "women's elite", "pour dames",
    )

    fun nameImpliesFemale(name: String?): Boolean {
        if (name == null) return false
        val lower = name.lowercase()
        return FEMALE_KEYWORDS.any { lower.contains(it) }
    }

    /**
     * Indicador femenino: carreras femeninas cuyo nombre y categoría no lo
     * indican ya. 1.WWT y 2.WWT implican carrera femenina (espejo de
     * `categoryBadge` en `js/shared.js`).
     */
    fun shouldShowFemaleIndicator(race: Race?): Boolean {
        if (race == null || !race.isFemale) return false
        if (race.uciCategory?.endsWith("WWT") == true) return false
        return !nameImpliesFemale(race.name)
    }

    // ── Doble sector ────────────────────────────────────────────

    /**
     * Detecta dobles sectores: dos jornadas de la misma carrera, mismo día,
     * mismo stageNumber. Asigna `stageSuffix` ("A", "B", …) ordenando
     * por hora de inicio (neutralStartTimeUtc).
     *
     * Muta `days` en sitio igual que la versión Swift.
     */
    fun annotateDoubleSectors(days: MutableList<RaceDay>) {
        val groups = mutableMapOf<String, MutableList<Int>>()
        days.forEachIndexed { index, rd ->
            val sn = rd.stageNumber ?: return@forEachIndexed
            if (rd.isRestDay || rd.isCancelledDay) return@forEachIndexed
            val key = "${rd.raceId.orEmpty()}-${rd.dateKey}-$sn"
            groups.getOrPut(key) { mutableListOf() }.add(index)
        }

        val suffixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        for ((_, indices) in groups) {
            if (indices.size < 2) continue
            val sorted = indices.sortedBy { idx ->
                days[idx].neutralStartTimeUtc
                    ?.let { DateFormatting.timestampToSeconds(it) }
                    ?: Double.MAX_VALUE
            }
            sorted.forEachIndexed { suffixIdx, arrayIdx ->
                days[arrayIdx].stageSuffix =
                    if (suffixIdx < suffixes.length) suffixes[suffixIdx].toString() else ""
            }
        }
    }

    // ── Número de etapa teórico (placeholders) ──────────────────

    /** Índice 1-based del lunes `dateKey` dentro de la carrera, o 0 si no es lunes. */
    private fun mondayIndex(race: Race, dateKey: String): Int {
        val targetDate = DateFormatting.parseLocalDate(dateKey) ?: return 0
        if (targetDate.dayOfWeek.value != 1) return 0 // Monday = 1 en java.time
        val startDate = race.startDate?.let { DateFormatting.parseLocalDate(it) } ?: return 0

        var count = 0
        var d = startDate
        while (!d.isAfter(targetDate)) {
            if (d.dayOfWeek.value == 1) count += 1
            d = d.plusDays(1)
        }
        return count
    }

    fun isRaceDay(race: Race, dateKey: String): Boolean {
        val start = race.startDate ?: return false
        val end = race.endDate ?: return false
        if (dateKey < start || dateKey > end) return false

        val durationDays = race.durationDays ?: 0
        val isGrandTourFormat = race.isStageRace && durationDays > 13

        if (isGrandTourFormat) {
            val mi = mondayIndex(race, dateKey)
            if (mi > 0) {
                if (durationDays <= 23 && mi == 1) return true
                return false
            }
        }
        return true
    }

    fun theoreticalStageNumber(race: Race, dateKey: String): Int? {
        if (!race.isStageRace) return null
        val startDate = race.startDate?.let { DateFormatting.parseLocalDate(it) } ?: return null
        val targetDate = DateFormatting.parseLocalDate(dateKey) ?: return null

        var stage = 0
        var d: LocalDate = startDate
        while (!d.isAfter(targetDate)) {
            val dk = d.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd"))
            if (isRaceDay(race, dk)) stage += 1
            d = d.plusDays(1)
        }
        return if (stage > 0) stage else null
    }

    // ── Limpieza de nombres femeninos ───────────────────────────

    private val FEMALE_NAME_EXCEPTIONS = listOf(
        "women cycling pro", "sanremo women", "tour de feminin",
    )

    private val CLEAN_FEMININE_REGEX = Regex(
        """\s*\b(women'?s?\s+elite|femenino|femenina|féminas|femeninos|féminin|féminine|femmes|women'?s?|ladies|donne|dames|elite women|emakumeen|pour dames)\b\s*""",
        RegexOption.IGNORE_CASE,
    )
    private val DOUBLE_SPACE_REGEX = Regex("""  +""")
    private val TRIM_DASHES_REGEX = Regex("""^[\s\-–]+|[\s\-–]+$""")

    /** Limpia los sufijos femeninos cuando se aplica filtro WWT/Femenino. */
    fun cleanFeminineDisplayName(name: String): String {
        val lower = name.lowercase()
        if (FEMALE_NAME_EXCEPTIONS.any { lower.contains(it) }) return name

        var cleaned = CLEAN_FEMININE_REGEX.replace(name, " ")
        cleaned = DOUBLE_SPACE_REGEX.replace(cleaned, " ")
        cleaned = cleaned.trim()
        cleaned = TRIM_DASHES_REGEX.replace(cleaned, "")
        return cleaned.ifEmpty { name }
    }

    // ── Helpers privados ────────────────────────────────────────

    private fun String.containsIgnoreCase(other: String): Boolean =
        contains(other, ignoreCase = true)

    /** Días entre dos dateKeys. Útil para tests. */
    @Suppress("unused")
    fun daysBetween(fromDateKey: String, toDateKey: String): Long? {
        val a = DateFormatting.parseLocalDate(fromDateKey) ?: return null
        val b = DateFormatting.parseLocalDate(toDateKey) ?: return null
        return ChronoUnit.DAYS.between(a, b)
    }
}
