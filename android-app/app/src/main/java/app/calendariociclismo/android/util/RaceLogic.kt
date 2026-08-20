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

    /** True si mostrar botones de resultados en las race cards: >=30 min DESPUÉS de la llegada. */
    fun shouldShowResults(rd: RaceDay, race: Race?): Boolean {
        if (rd.isRestDay || rd.isCancelledDay) return false
        if (race?.fcId == null && race?.pcsSlug == null) return false
        return raceTimeCheck(rd, 30)
    }

    /** True si mostrar botones de resultados en la ficha de jornada: >=30 min ANTES de la llegada. */
    fun shouldShowResultsDetail(rd: RaceDay, race: Race?): Boolean {
        if (rd.isRestDay || rd.isCancelledDay) return false
        if (race?.fcId == null && race?.pcsSlug == null) return false
        return raceTimeCheck(rd, -30)
    }

    /** True si mostrar "Así está la carrera" — la etapa previa ha terminado y
     *  los resultados de la actual aún no están disponibles. */
    fun shouldShowPreviousResults(prevRd: RaceDay, currentRd: RaceDay, race: Race?): Boolean {
        if (race?.raceFormat == "one_day") return false
        if (race?.fcId == null && race?.pcsSlug == null) return false
        if (shouldShowResultsDetail(currentRd, race)) return false
        return raceTimeCheck(prevRd, 0)
    }

    /** True si la carrera ya concluyó: >=30 min tras la hora estimada de llegada,
     *  con FALLBACK a `dateKey` 18:00 UTC cuando no hay hora de meta (lo aporta
     *  `raceTimeCheck`). Espejo FIEL de la `isRaceConcluded(rd)` EXPORTADA en
     *  `js/race-data-modal.js`, que NO exige `estimatedFinishTimeUtc`: los
     *  Campeonatos Nacionales no tienen hora de meta curada y aun así deben
     *  mostrar los resultados FC/PCS al terminar (lo usa la rejilla de
     *  Campeonatos). El guard antiguo los dejaba como "no concluidos" siempre. */
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

    /** True si la carrera ya terminó pero no tiene fcId/pcsSlug (solo Revive). */
    fun noIdsAndPastDeadline(rd: RaceDay, race: Race?): Boolean {
        if (rd.isRestDay || rd.isCancelledDay) return false
        if (race?.fcId != null || race?.pcsSlug != null) return false
        return raceTimeCheck(rd, 0)
    }

    /** URL de FirstCycling para la etapa dada. */
    fun buildFcUrl(race: Race, stageNumber: Int?): String? {
        val fcId = race.fcId ?: return null
        val year = race.year ?: return null
        val base = "https://firstcycling.com/race.php?r=$fcId&y=$year"
        return if (stageNumber != null) "$base&e=${"%02d".format(stageNumber)}" else base
    }

    /** URL de ProCyclingStats para la etapa dada. */
    fun buildPcsUrl(race: Race, stageNumber: Int?, stageSuffix: String? = null): String? {
        val slug = race.pcsSlug ?: return null
        val year = race.year ?: return null
        val base = "https://www.procyclingstats.com/race/$slug/$year"
        return when {
            stageNumber == null -> "$base/result"
            stageNumber == 0 -> "$base/prologue/result"
            else -> {
                val suffix = stageSuffix?.lowercase().orEmpty()
                "$base/stage-$stageNumber$suffix/result"
            }
        }
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
        broadcasts.filter { b ->
            val c = b.country
            c.isNullOrEmpty() || c in allowedGroups
        }

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

    /** Primer URL de un broadcast Revive (Eurosport, HBO Max, YouTube, o showInRevive=true). */
    fun reviveUrl(broadcasts: List<Broadcast>): String? {
        val sorted = broadcasts.sortedBy { it.sortOrder }
        for (b in sorted) {
            val url = b.url ?: continue
            if (b.showInRevive) return url
            val channel = (b.channel ?: "").lowercase()
            if (channel.contains("eurosport") || channel.contains("hbo max")
                || url.contains("youtube.com") || url.contains("youtu.be")
            ) return url
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

    fun uciRank(category: String?, name: String?, country: String?): Double {
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

    fun proLevel(category: String?, name: String?, country: String?): Double {
        val n = name.orEmpty()
        if (n.containsIgnoreCase("giro de italia")) return 0.1
        if (n.containsIgnoreCase("tour de francia")) return 0.2
        if (n.containsIgnoreCase("la vuelta")) return 0.3

        val cat = category.orEmpty()
        val cc = country.orEmpty().uppercase()

        if (cat in listOf("1.Pro", "2.Pro", "1.1", "2.1") &&
            isAsiaCountry(cc) &&
            !n.containsIgnoreCase("japan cup")
        ) return 10.5

        val map = mapOf(
            "WC" to 1.0, "CC" to 2.0, "1.UWT" to 3.0, "2.UWT" to 4.0,
            "1.WWT" to 5.0, "2.WWT" to 6.0,
            "1.Pro" to 7.0, "2.Pro" to 8.0, "1.1" to 9.0, "2.1" to 10.0,
            "1.2" to 11.0, "2.2" to 12.0, "1.2U" to 13.0, "2.2U" to 14.0,
        )
        return map[cat] ?: 99.0
    }

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

        val lvlA = proLevel(rA?.uciCategory, rA?.name, rA?.countryCode)
        val lvlB = proLevel(rB?.uciCategory, rB?.name, rB?.countryCode)
        if (lvlA != lvlB) return@Comparator lvlA.compareTo(lvlB)

        val genA = genderRank(rA?.gender); val genB = genderRank(rB?.gender)
        if (genA != genB) return@Comparator genA.compareTo(genB)

        val catA = uciRank(rA?.uciCategory, rA?.name, rA?.countryCode)
        val catB = uciRank(rB?.uciCategory, rB?.name, rB?.countryCode)
        if (catA != catB) return@Comparator catA.compareTo(catB)

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

    /** Comparator estándar por categoría UCI. Ordena en sitio una lista. */
    val byCategory: Comparator<EnrichedRaceDay> = Comparator { a, b ->
        val phA = if (a.isPlaceholder || a.race?.isCancelled == true) 1 else 0
        val phB = if (b.isPlaceholder || b.race?.isCancelled == true) 1 else 0
        if (phA != phB) return@Comparator phA.compareTo(phB)

        val rA = a.race; val rB = b.race
        // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría.
        ChampionshipsConfig.compare(rA, a.raceDay, rB, b.raceDay)?.let { if (it != 0) return@Comparator it }

        val gtA = grandTourRank(rA); val gtB = grandTourRank(rB)
        if (gtA != gtB) return@Comparator gtA.compareTo(gtB)

        // Con miniperfil por delante de las que no lo tienen (dentro de su grupo, sigue el orden por categoría).
        val profA = if (a.raceDay.hasElevationProfile) 0 else 1
        val profB = if (b.raceDay.hasElevationProfile) 0 else 1
        if (profA != profB) return@Comparator profA.compareTo(profB)

        val lvlA = proLevel(rA?.uciCategory, rA?.name, rA?.countryCode)
        val lvlB = proLevel(rB?.uciCategory, rB?.name, rB?.countryCode)
        if (lvlA != lvlB) return@Comparator lvlA.compareTo(lvlB)

        val genA = genderRank(rA?.gender); val genB = genderRank(rB?.gender)
        if (genA != genB) return@Comparator genA.compareTo(genB)

        val catA = uciRank(rA?.uciCategory, rA?.name, rA?.countryCode)
        val catB = uciRank(rB?.uciCategory, rB?.name, rB?.countryCode)
        if (catA != catB) return@Comparator catA.compareTo(catB)

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
        val phA = if (a.isPlaceholder || a.race?.isCancelled == true) 1 else 0
        val phB = if (b.isPlaceholder || b.race?.isCancelled == true) 1 else 0
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
        val phA = if (a.isPlaceholder || a.race?.isCancelled == true) 1 else 0
        val phB = if (b.isPlaceholder || b.race?.isCancelled == true) 1 else 0
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
                (gender != "female" || cat == "WC" || cat == "CC") &&
                    cat != "1.2" && cat != "2.2" &&
                    ((cat != "1.2U" && cat != "2.2U") || isTourDelPorvenir(name))
            Constants.CategoryFilter.FEMALE ->
                (gender == "female" || cat == "WC" || cat == "CC") &&
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

    fun shouldShowFemaleIndicator(race: Race?): Boolean {
        if (race == null || !race.isFemale) return false
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
