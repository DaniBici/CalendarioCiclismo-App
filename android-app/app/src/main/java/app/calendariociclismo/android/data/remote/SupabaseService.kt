package app.calendariociclismo.android.data.remote

import app.calendariociclismo.android.BuildConfig
import app.calendariociclismo.android.data.model.Asset
import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.ChallengeGroup
import app.calendariociclismo.android.data.model.DayData
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.FeaturedRaceSelection
import app.calendariociclismo.android.data.model.FeedStartlistIdentityRow
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceDayElevationData
import app.calendariociclismo.android.data.model.RaceClassificationConfig
import app.calendariociclismo.android.data.model.RaceUciResultRow
import app.calendariociclismo.android.data.model.RaceUciStage
import app.calendariociclismo.android.data.model.RiderProfile
import app.calendariociclismo.android.data.model.RiderTransfer
import app.calendariociclismo.android.data.model.StartOrderEntry
import app.calendariociclismo.android.data.model.StartOrderRaceDay
import app.calendariociclismo.android.data.model.StartlistRider
import app.calendariociclismo.android.data.model.StartlistRiderResolved
import app.calendariociclismo.android.data.model.StartlistTeam
import app.calendariociclismo.android.data.model.TodayHighlight
import app.calendariociclismo.android.data.model.Team
import app.calendariociclismo.android.data.model.TeamSeason
import app.calendariociclismo.android.data.model.UciRank1Row
import app.calendariociclismo.android.data.model.UciTeamRankingRow
import app.calendariociclismo.android.data.model.applyingElevation
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.RaceLogic
import io.github.jan.supabase.annotations.SupabaseInternal
import io.github.jan.supabase.annotations.SupabaseExperimental
import io.github.jan.supabase.postgrest.RpcMethod
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.PostgrestRequestBuilder
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.postgrest.rpc
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import app.calendariociclismo.android.data.model.*
import app.calendariociclismo.android.data.repository.CxRemote
import java.time.YearMonth

/**
 * Servicio centralizado para acceso a datos de Supabase.
 *
 * Port del `SupabaseService.swift` iOS. Expone las mismas queries contra
 * las mismas tablas (`races`, `race_days`, `broadcasts`, `assets`,
 * `startlist_teams`, `startlist_riders`, `challenge_groups`,
 * `push_subscriptions`).
 */
@OptIn(SupabaseInternal::class)
class SupabaseService : CxRemote {

    private val cxAgendaColumns = "id,name,nameEn,slug,slugEn,seasonKey,dateKey,endDateKey,class,countryCode,venue,tournamentId,colorHex,logoUrl,isCancelled,timezone," +
        "assets(type,url)," +
        "cx_tournaments(id,name,nameEn,slug,colorHex,logoUrl)," +
        "cx_race_categories(category,startTimeUtc,dateKey,sortOrder,isCancelled,resultsStatus,startlistImportedAt,winnerName,durationFormat,durationRuleVersion,durationMinutes,durationRuleSourceUrl)"

    override suspend fun cxMonth(season: String, month: YearMonth): List<CxRace> =
        client.from("cx_races").select(columns = Columns.raw(cxAgendaColumns)) {
            filter {
                eq("seasonKey", season)
                eq("editorialStatus", "published")
                lte("dateKey", month.atEndOfMonth().toString())
                or { gte("dateKey", month.atDay(1).toString()); gte("endDateKey", month.atDay(1).toString()) }
            }
            order("dateKey", Order.ASCENDING)
            order("id", Order.ASCENDING)
        }.decodeList()

    override suspend fun cxRacesByIds(ids: List<String>): List<CxRace> = ids.distinct().chunked(100).flatMap { batch ->
        client.from("cx_races").select(columns = Columns.raw(cxAgendaColumns)) {
            filter { eq("editorialStatus", "published"); isIn("id", batch) }
        }.decodeList<CxRace>().filter { app.calendariociclismo.android.util.CyclocrossLogic.raceInSeason(it) }
    }

    suspend fun cxTournamentsByIds(ids: List<String>): List<CxTournament> = ids.distinct().chunked(100).flatMap { batch ->
        client.from("cx_tournaments").select(columns = Columns.raw("id,name,nameEn,slug,seasonKey,colorHex,logoUrl")) {
            filter { isIn("id", batch) }
        }.decodeList<CxTournament>()
    }

    @OptIn(SupabaseExperimental::class)
    override suspend fun cxNextDate(season: String, date: String): String? =
        client.postgrest.rpc("cx_next_race_date", method = RpcMethod.GET) {
            // En la versión 2.6.1, rpc(parameters, GET) conserva comillas JSON en strings.
            params["p_season_key"] = listOf(season)
            params["p_date_key"] = listOf(date)
        }.decodeAs()

    override suspend fun cxNextDate(season: String, date: String, excluding: List<String>): String? {
        if (excluding.isEmpty()) return cxNextDate(season, date)
        return client.postgrest.rpc(
            "cx_next_race_date",
            buildJsonObject {
                put("p_season_key", JsonPrimitive(season))
                put("p_date_key", JsonPrimitive(date))
                put("p_exclude_classes", JsonArray(excluding.map(::JsonPrimitive)))
            },
        ).decodeAs()
    }

    /** Datos del widget «Carreras de hoy» (RPC `widget_day`), en JSON crudo. */
    suspend fun widgetDay(params: JsonObject): String =
        client.postgrest.rpc("widget_day", params).data

    @Serializable
    private data class CxIdEntry(val id: String)

    override suspend fun cxTournamentHasRaces(tournamentId: String, excluding: List<String>): Boolean =
        client.from("cx_races").select(columns = Columns.raw("id")) {
            filter {
                eq("tournamentId", tournamentId); eq("editorialStatus", "published")
                excluding.forEach { neq("class", it) }
            }
            limit(1)
        }.decodeList<CxIdEntry>().isNotEmpty()

    @Serializable
    private data class CxDateEntry(val dateKey: String, val cx_race_categories: List<Category>) {
        @Serializable data class Category(val dateKey: String? = null, val isCancelled: Boolean)
    }

    override suspend fun cxTournamentNextDate(season: String, date: String, tournamentId: String): String? =
        cxTournamentNextDate(season, date, tournamentId, emptyList())

    override suspend fun cxTournamentNextDate(season: String, date: String, tournamentId: String, excluding: List<String>): String? {
        val last = app.calendariociclismo.android.util.CyclocrossLogic.months(season).last().atEndOfMonth().toString()
        val rows = mutableListOf<CxDateEntry>()
        var offset = 0L
        while (true) {
            val page = client.from("cx_races").select(columns = Columns.raw("dateKey,cx_race_categories(dateKey,isCancelled)")) {
                filter {
                    eq("seasonKey", season); eq("tournamentId", tournamentId)
                    eq("editorialStatus", "published"); eq("isCancelled", false)
                    gte("dateKey", "${season.take(4)}-08-01"); lte("dateKey", last)
                    or { gte("dateKey", date); gte("endDateKey", date) }
                    excluding.forEach { neq("class", it) }
                }
                order("id", Order.ASCENDING); range(offset, offset + 999)
            }.decodeList<CxDateEntry>()
            rows += page
            if (page.size < 1000) break
            offset += 1000
        }
        return rows.flatMap { race -> if (race.cx_race_categories.isEmpty()) listOf(race.dateKey) else race.cx_race_categories.filterNot { it.isCancelled }.map { it.dateKey ?: race.dateKey } }
            .filter { it >= date && runCatching { YearMonth.from(java.time.LocalDate.parse(it)) in app.calendariociclismo.android.util.CyclocrossLogic.months(season) }.getOrDefault(false) }.minOrNull()
    }

    override suspend fun cxRaceForSlug(slug: String): CxRace? =
        client.from("cx_races").select(columns = Columns.raw(cxAgendaColumns)) {
            filter { eq("editorialStatus", "published"); or { eq("slug", slug); eq("slugEn", slug) } }
            limit(1)
        }.decodeList<CxRace>().firstOrNull()

    override suspend fun cxTournamentForSlug(slug: String): CxTournament? =
        client.from("cx_tournaments").select(columns = Columns.raw("id,name,nameEn,slug,seasonKey,colorHex,logoUrl")) {
            filter { eq("slug", slug) }
            limit(1)
        }.decodeList<CxTournament>().firstOrNull()

    override suspend fun cxSeasonRounds(season: String): Map<String, CxRound> {
        val last = app.calendariociclismo.android.util.CyclocrossLogic.months(season).last().atEndOfMonth().toString()
        val rows = mutableListOf<CxRoundRow>()
        var offset = 0L
        while (true) {
            val page = client.from("cx_races").select(columns = Columns.raw("id,tournamentId,dateKey,seasonKey,isCancelled,cx_race_categories(dateKey,startTimeUtc,isCancelled)")) {
                filter {
                    eq("seasonKey", season); eq("editorialStatus", "published")
                    gte("dateKey", "${season.take(4)}-08-01"); lte("dateKey", last)
                }
                order("id", Order.ASCENDING); range(offset, offset + 999)
            }.decodeList<CxRoundRow>()
            rows += page
            if (page.size < 1000) break
            offset += 1000
        }
        return app.calendariociclismo.android.util.CyclocrossLogic.tournamentRounds(rows, season)
    }

    // Orden por columna configurable: las tablas sin `id` (p. ej.
    // cx_standings_state, cuya clave es tournamentId+seasonKey+category) no
    // admiten el orden por defecto.
    private suspend inline fun <reified T : Any> cxRows(table: String, filters: Map<String, String>, orderColumn: String = "id"): List<T> {
        val rows = mutableListOf<T>()
        var offset = 0L
        while (true) {
            val page = client.from(table).select {
                filter { filters.forEach { (key, value) -> eq(key, value) } }
                order(orderColumn, Order.ASCENDING)
                range(offset, offset + 999)
            }.decodeList<T>()
            rows.addAll(page)
            if (page.size < 1000) return rows
            offset += 1000
        }
    }

    // Catálogo de equipos de ciclocross: se pide completo y paginado desde cada
    // ficha y general; cambia poco, así que se conserva en memoria una hora.
    private val cxTeamsMutex = Mutex()
    private var cxTeamsCache: Pair<Long, List<CxTeam>>? = null

    private suspend fun cxTeamsCatalog(): List<CxTeam> = cxTeamsMutex.withLock {
        val now = System.currentTimeMillis() / 1000
        cxTeamsCache?.let { (fetchedAt, teams) ->
            if (now - fetchedAt < CX_TEAMS_TTL_SECONDS) return@withLock teams
        }
        val fresh = cxRows<CxTeam>("cx_teams", emptyMap())
        cxTeamsCache = now to fresh
        fresh
    }

    /**
     * Lee todas las páginas de una consulta. PostgREST corta cada respuesta en
     * su tope de filas por respuesta aunque se pida un `limit` mayor; las
     * páginas de [PAGE_SIZE] quedan por debajo de ese tope. [block] debe
     * ordenar por una clave única para que las páginas no se solapen ni salten
     * filas.
     */
    private suspend inline fun <reified T : Any> selectAllPages(
        table: String,
        columns: Columns = Columns.ALL,
        crossinline block: PostgrestRequestBuilder.() -> Unit,
    ): List<T> {
        val all = mutableListOf<T>()
        var offset = 0L
        while (true) {
            val page = client.from(table).select(columns = columns) {
                block()
                range(offset, offset + PAGE_SIZE - 1)
            }.decodeList<T>()
            all.addAll(page)
            if (page.size < PAGE_SIZE) return all
            offset += PAGE_SIZE
        }
    }

    /**
     * Ejecuta [fetch] por lotes de [size] identificadores con un máximo de
     * [MAX_PARALLEL_REQUESTS] peticiones simultáneas. Los lotes acotan la URL
     * de los filtros `in.(…)`.
     */
    private suspend fun <T> inChunks(
        ids: List<String>,
        size: Int,
        fetch: suspend (List<String>) -> List<T>,
    ): List<T> {
        val unique = ids.filter { it.isNotEmpty() }.distinct()
        if (unique.isEmpty()) return emptyList()
        if (unique.size <= size) return fetch(unique)
        val permits = Semaphore(MAX_PARALLEL_REQUESTS)
        return coroutineScope {
            unique.chunked(size)
                .map { chunk -> async { permits.withPermit { fetch(chunk) } } }
                .awaitAll()
                .flatten()
        }
    }

    // General de la página de torneo: estados y filas por torneo y temporada,
    // catálogo de equipos, puntuación configurada y carreras de sus rondas.
    override suspend fun cxTournamentGeneral(tournamentId: String, seasonKey: String): CxTournamentGeneral = coroutineScope {
        val filters = mapOf("tournamentId" to tournamentId, "seasonKey" to seasonKey)
        val tournament = async {
            client.from("cx_tournaments").select(columns = Columns.raw("id,name,nameEn,slug,seasonKey,colorHex,logoUrl,pointsScheme")) {
                filter { eq("id", tournamentId) }
            }.decodeList<CxTournament>().firstOrNull()
        }
        val states = async { cxRows<CxStandingState>("cx_standings_state", filters, "category") }
        val standings = async { cxRows<CxStanding>("cx_tournament_standings", filters) }
        val catalog = async { cxTeamsCatalog() }
        val stateRows = states.await()
        val races = cxRacesByIds(stateRows.flatMap { it.roundIds })
        CxTournamentGeneral(tournament.await(), stateRows, standings.await(), catalog.await(), races)
    }

    override suspend fun cxDetail(id: String): CxDetail? = coroutineScope {
        val race = client.from("cx_races").select(columns = Columns.raw("*,cx_tournaments(*),cx_race_categories(*)")) {
            filter { eq("id", id); eq("editorialStatus", "published") }
        }.decodeList<CxRace>().firstOrNull() ?: return@coroutineScope null
        val filters = mapOf("raceId" to id)
        val startlist = async { cxRows<CxStartlistRider>("cx_startlist_riders", filters) }
        val results = async { cxRows<CxResult>("cx_results", filters) }
        val broadcasts = async { cxRows<CxBroadcast>("cx_broadcasts", filters) }
        val videos = async { cxRows<CxVideo>("cx_videos", filters) }
        val assets = async { cxRows<CxAsset>("assets", mapOf("cxRaceId" to id)) }
        val standings = async {
            race.tournamentId?.let { id ->
                val filters = mapOf("tournamentId" to id, "seasonKey" to race.seasonKey)
                val states = cxRows<CxStandingState>("cx_standings_state", filters, "category")
                states to cxRows<CxStanding>("cx_tournament_standings", filters)
            } ?: (emptyList<CxStandingState>() to emptyList<CxStanding>())
        }
        // Catálogo completo: resultados y generales casan `teamName` por nombre
        // y alias, igual que la web; los dorsales usan `teamId`.
        val catalog = async { cxTeamsCatalog() }
        val riders = startlist.await()
        val teams = catalog.await()
        val (states, rows) = standings.await()
        CxDetail(race, riders, results.await(), broadcasts.await(), videos.await(), teams, rows, states, assets.await())
    }

    private val client = createSupabaseClient(
        supabaseUrl = BuildConfig.SUPABASE_URL,
        supabaseKey = BuildConfig.SUPABASE_ANON_KEY,
    ) {
        httpConfig {
            defaultRequest {
                headers.remove(HttpHeaders.UserAgent)
                headers.append(
                    HttpHeaders.UserAgent,
                    "CalendarioCiclismo-Android/${BuildConfig.VERSION_NAME} " +
                        "(${BuildConfig.VERSION_CODE})",
                )
            }
        }
        install(Postgrest)
    }

    // ─────────── Races ───────────

    /** Carreras de un año. Paginada: un año puede superar el tope de filas por respuesta. */
    suspend fun racesByYear(year: Int): List<Race> =
        selectAllPages("races", RACE_COLUMNS) {
            filter { eq("year", year) }
            order("id", Order.ASCENDING)
        }

    suspend fun raceById(id: String): Race =
        client.from("races").select(columns = RACE_COLUMNS) {
            filter { eq("id", id) }
            limit(1)
        }.decodeSingle()

    suspend fun raceBySlug(slug: String): Race =
        client.from("races").select(columns = RACE_COLUMNS) {
            filter { eq("slug", slug) }
            limit(1)
        }.decodeSingle()

    suspend fun racesByIds(ids: List<String>): List<Race> =
        inChunks(ids, ID_CHUNK) { chunk ->
            client.from("races").select(columns = RACE_COLUMNS) {
                filter { isIn("id", chunk) }
            }.decodeList<Race>()
        }

    /** Selección editorial de hasta dos carreras por fecha. */
    suspend fun featuredRaces(dateKeys: List<String>): List<FeaturedRaceSelection> {
        val keys = dateKeys.filter { it.isNotEmpty() }.distinct().sorted()
        if (keys.isEmpty()) return emptyList()
        return client.postgrest.rpc(
            "featured_races_for_dates",
            buildJsonObject { put("date_keys", JsonArray(keys.map(::JsonPrimitive))) },
        ).decodeList()
    }

    /** Carreras cuyo intervalo se solapa con el rango solicitado. */
    suspend fun racesOverlapping(startKey: String, endKey: String): List<Race> =
        selectAllPages("races", RACE_COLUMNS) {
            filter {
                lte("startDate", endKey)
                gte("endDate", startKey)
            }
            order("id", Order.ASCENDING)
        }

    /** Jornadas y carreras necesarias para un mes, incluidas las carreras
     * referenciadas por una jornada aunque sus fechas estén desalineadas. */
    suspend fun calendarMonthData(startKey: String, endKey: String): Pair<List<RaceDay>, List<Race>> = coroutineScope {
        val daysDeferred = async { raceDaysInRange(startKey, endKey) }
        val racesDeferred = async { racesOverlapping(startKey, endKey) }
        val days = daysDeferred.await()
        val overlappingRaces = racesDeferred.await()
        val recovered = racesByIds(RaceLogic.missingRaceIds(days, overlappingRaces))
        days to (overlappingRaces + recovered).distinctBy { it.id }
    }

    /** Carreras de Campeonatos Nacionales (uciCategory='CN') de un año dentro de
     *  un rango de fechas de salida. Espejo de la query en `js/campeonatos.js`. */
    suspend fun championshipRaces(year: Int, from: String, to: String): List<Race> =
        client.from("races").select(columns = RACE_COLUMNS) {
            filter {
                eq("uciCategory", "CN")
                eq("year", year)
                gte("startDate", from)
                lte("startDate", to)
            }
        }.decodeList()

    // ─────────── Race Days ───────────

    suspend fun raceDaysByDate(dateKey: String): List<RaceDay> =
        client.from("race_days").select(columns = Columns.raw(RACE_DAY_SLIM_COLUMNS)) {
            filter {
                eq("dateKey", dateKey)
                eq("editorialStatus", "published")
            }
        }.decodeList()

    suspend fun raceDaysByIds(ids: List<String>): List<RaceDay> {
        if (ids.isEmpty()) return emptyList()
        return client.from("race_days").select {
            filter { isIn("id", ids) }
        }.decodeList()
    }

    /** Datos de elevación para un conjunto de jornadas (carga diferida). */
    suspend fun raceDaysElevation(ids: List<String>): List<RaceDayElevationData> {
        if (ids.isEmpty()) return emptyList()
        return client.from("race_days").select(
            columns = Columns.list("id", "elevationProfile", "profileSummits", "profileWaypoints", "profileNotViewable")
        ) {
            filter { isIn("id", ids) }
        }.decodeList()
    }

    /** Jornadas publicadas de una carrera con todas sus columnas (perfil incluido). */
    suspend fun raceDaysByRace(raceId: String): List<RaceDay> =
        raceDaysByRace(raceId, Columns.ALL)

    /** Jornadas publicadas de una carrera sin el perfil de elevación. */
    suspend fun raceDaysByRaceSlim(raceId: String): List<RaceDay> =
        raceDaysByRace(raceId, Columns.raw(RACE_DAY_SLIM_COLUMNS))

    private suspend fun raceDaysByRace(raceId: String, columns: Columns): List<RaceDay> =
        client.from("race_days").select(columns = columns) {
            filter {
                eq("raceId", raceId)
                eq("editorialStatus", "published")
            }
        }.decodeList()

    /** Identificadores de las jornadas publicadas de una carrera. */
    suspend fun raceDayIdsByRace(raceId: String): List<String> =
        client.from("race_days").select(columns = Columns.list("id")) {
            filter {
                eq("raceId", raceId)
                eq("editorialStatus", "published")
            }
            order("dateKey", Order.ASCENDING)
        }.decodeList<IdRow>().map { it.id }

    /**
     * Jornadas publicadas de un conjunto de carreras (batch) sin perfil de
     * elevación. Modo Campeonatos.
     */
    suspend fun raceDaysByRaceIdsSlim(ids: List<String>): List<RaceDay> =
        raceDaysByRaceIds(ids, Columns.raw(RACE_DAY_SLIM_COLUMNS))

    /**
     * Programa mínimo de un conjunto de carreras: identifica la última jornada
     * competitiva de cada una (feed de Resultados).
     */
    suspend fun raceDaysProgramByRaceIds(ids: List<String>): List<RaceDay> =
        raceDaysByRaceIds(ids, Columns.raw(RACE_DAY_PROGRAM_COLUMNS))

    private suspend fun raceDaysByRaceIds(ids: List<String>, columns: Columns): List<RaceDay> =
        inChunks(ids, ID_CHUNK) { chunk ->
            selectAllPages<RaceDay>("race_days", columns) {
                filter {
                    isIn("raceId", chunk)
                    eq("editorialStatus", "published")
                }
                order("id", Order.ASCENDING)
            }
        }

    /** Jornadas reducidas a su identidad y fecha (cintillo de Hoy). */
    suspend fun raceDaySummariesByIds(ids: List<String>): List<RaceDay> =
        inChunks(ids, ID_CHUNK) { chunk ->
            client.from("race_days").select(columns = Columns.raw(RACE_DAY_PROGRAM_COLUMNS)) {
                filter { isIn("id", chunk) }
            }.decodeList<RaceDay>()
        }

    /**
     * Jornadas publicadas en un rango de fechas (sin perfil de elevación).
     * Pagina manualmente en páginas de 1.000: PostgREST aplica un tope
     * server-side de filas por respuesta que un `limit()` más alto NO evita.
     * Sin esto, cualquier consumidor que solicite más jornadas que ese tope
     * las recibiría truncadas en silencio y la parte recortada no tendría por
     * qué coincidir con el final cronológico del rango.
     * Se pagina por `id` (clave única) para que el orden entre páginas sea
     * estable — paginar por `dateKey` (no único) puede saltar o duplicar
     * filas en el borde de cada página.
     */
    suspend fun raceDaysInRange(startKey: String, endKey: String): List<RaceDay> {
        val all = mutableListOf<RaceDay>()
        var offset = 0L
        val chunk = 1000L
        while (true) {
            val page: List<RaceDay> = client.from("race_days").select(columns = Columns.raw(RACE_DAY_SLIM_COLUMNS)) {
                filter {
                    eq("editorialStatus", "published")
                    gte("dateKey", startKey)
                    lte("dateKey", endKey)
                }
                order("id", Order.ASCENDING)
                range(offset, offset + chunk - 1)
            }.decodeList()
            all.addAll(page)
            if (page.size < chunk) break
            offset += chunk
        }
        return all
    }

    suspend fun raceDayBySlug(slug: String): RaceDay =
        client.from("race_days").select {
            filter { eq("slug", slug) }
            limit(1)
        }.decodeSingle()

    /** Siguiente fecha con jornadas publicadas después de [dateKey]. */
    suspend fun nextDateWithRaces(dateKey: String): String? {
        val rows: List<MinimalDateRow> = client.from("race_days").select(
            columns = Columns.list("dateKey")
        ) {
            filter {
                eq("editorialStatus", "published")
                gt("dateKey", dateKey)
            }
            order("dateKey", Order.ASCENDING)
            limit(1)
        }.decodeList()
        return rows.firstOrNull()?.dateKey
    }

    // ─────────── Broadcasts ───────────

    suspend fun broadcastsByRaceDay(id: String): List<Broadcast> =
        client.from("broadcasts").select {
            filter { eq("raceDayId", id) }
            order("sortOrder", Order.ASCENDING)
        }.decodeList()

    suspend fun broadcastsByRaceDays(ids: List<String>): List<Broadcast> {
        if (ids.isEmpty()) return emptyList()
        return client.from("broadcasts").select {
            filter { isIn("raceDayId", ids) }
            order("sortOrder", Order.ASCENDING)
        }.decodeList()
    }

    // ─────────── Assets ───────────

    suspend fun assetsByRaceDay(id: String): List<Asset> =
        client.from("assets").select {
            filter { eq("raceDayId", id) }
        }.decodeList()

    suspend fun assetsByRaceDays(ids: List<String>): List<Asset> {
        if (ids.isEmpty()) return emptyList()
        return client.from("assets").select(
            columns = Columns.list("id", "raceDayId", "type", "url")
        ) {
            filter { isIn("raceDayId", ids) }
        }.decodeList()
    }

    // ─────────── Startlists ───────────

    suspend fun startlistTeams(raceId: String): List<StartlistTeam> =
        client.from("startlist_teams").select {
            filter { eq("raceId", raceId) }
            order("sortOrder", Order.ASCENDING)
        }.decodeList()

    // Lee la vista resuelta: nombre/country canónicos desde riders_men/women
    // cuando hay globalRiderId; fallback al snapshot del propio startlist_riders.
    suspend fun startlistRiders(raceId: String): List<StartlistRider> =
        client.from("startlist_riders_resolved").select {
            filter { eq("raceId", raceId) }
            order("dorsal", Order.ASCENDING)
        }.decodeList()

    /**
     * Catálogo completo de equipos, paginado (supera el tope de filas por
     * respuesta). Solo para casar nombres sin identificadores conocidos; con
     * ids, [teamsByIds].
     */
    suspend fun teamsCatalog(): List<Team> =
        selectAllPages("teams", TEAM_COLUMNS) {
            order("id", Order.ASCENDING)
        }

    suspend fun teamsByIds(ids: List<String>): List<Team> =
        inChunks(ids, ID_CHUNK) { chunk ->
            client.from("teams").select(columns = TEAM_COLUMNS) {
                filter { isIn("id", chunk) }
            }.decodeList<Team>()
        }

    suspend fun teamSeasonsByIds(year: Int, ids: List<String>): List<TeamSeason> =
        inChunks(ids, ID_CHUNK) { chunk ->
            client.from("team_seasons").select {
                filter {
                    eq("year", year)
                    isIn("teamId", chunk)
                }
            }.decodeList<TeamSeason>()
        }

    // Render temporal: versiones de equipo de un año concreto (team_seasons).
    // Se filtra por año; los teamIds se cruzan en memoria con globalTeams.
    // Paginada: un año puede superar el tope de filas por respuesta.
    suspend fun teamSeasons(year: Int): List<TeamSeason> =
        selectAllPages("team_seasons") {
            filter { eq("year", year) }
            order("id", Order.ASCENDING)
        }

    /** Instantánea semanal de DataRide compartida por web, iOS y Android. */
    suspend fun uciTeamRankings(): List<UciTeamRankingRow> =
        client.from("uci_team_rankings").select(
            columns = Columns.raw(
                "gender,rank,previousRank,uciTeamId,teamId,teamCategory,sourceName," +
                    "displayName,teamCode,countryCode,points,rankingDate,sourceUrl"
            )
        ) {
            order("gender", Order.ASCENDING)
            order("rank", Order.ASCENDING)
        }.decodeList()

    /**
     * Fichas (riders_men + riders_women) por id — para el fallback por
     * globalRiderId de los resultados (CN sin startlist). Dos queries, una por
     * tabla (el id es único cross-tabla; no sabemos el género de antemano).
     * Espejo de la doble `riders_men/women.in('id', need)` de `enrichRiders` en
     * `js/resultados.js`.
     */
    suspend fun ridersByIds(ids: List<String>): List<RiderProfile> {
        if (ids.isEmpty()) return emptyList()
        val cols = Columns.list("id", "firstName", "lastName", "nationality", "currentTeamId", "contractUntil")
        return coroutineScope {
            listOf("riders_men", "riders_women").map { table ->
                async {
                    inChunks(ids, ID_CHUNK) { chunk ->
                        client.from(table).select(cols) {
                            filter { isIn("id", chunk) }
                        }.decodeList<RiderProfile>()
                    }
                }
            }.awaitAll().flatten()
        }
    }

    // ─────────── Fichajes (mercado, mig. 122) ───────────

    /**
     * Movimientos del mercado de una temporada, cronológico inverso. Paginada
     * con `id` como desempate para que las páginas sean estables.
     */
    suspend fun riderTransfers(season: Int): List<RiderTransfer> =
        selectAllPages("rider_transfers") {
            filter { eq("season", season) }
            order("announcedAt", Order.DESCENDING)
            order("createdAt", Order.DESCENDING)
            order("id", Order.ASCENDING)
        }

    @Serializable
    private data class AffiliationRow(
        val riderId: String,
        val riderGender: String? = null,
        val dateTo: String? = null,
    )

    /**
     * Plantilla 2027 MATERIALIZADA de un equipo (rider_team_affiliations
     * year=season) para la sección "continúan" del detalle de Fichajes. El panel
     * la puebla al marcar "continúa"/"duda"/incorporación; un equipo sin
     * afiliaciones sale vacío. El `contractUntil` efectivo viene de la afiliación.
     */
    suspend fun ridersByAffiliation(teamId: String, season: Int, gender: String?): List<RiderProfile> {
        val affs: List<AffiliationRow> = client.from("rider_team_affiliations")
            .select(Columns.list("riderId", "riderGender", "dateTo")) {
                filter { eq("year", season); eq("teamId", teamId); eq("affiliationType", "regular") }
            }.decodeList()
        if (affs.isEmpty()) return emptyList()

        // El contrato = año de dateTo (31-dic del año de fin), no riders_*.contractUntil.
        fun affYear(d: String?): Int? = d?.take(4)?.toIntOrNull()
        val cols = Columns.list("id", "firstName", "lastName", "nationality", "currentTeamId", "contractUntil")
        val contractByRider = affs.associate { it.riderId to affYear(it.dateTo) }
        val byTable = mapOf(
            "riders_men" to affs.filter { (it.riderGender ?: gender) == "male" }.map { it.riderId },
            "riders_women" to affs.filter { (it.riderGender ?: gender) == "female" }.map { it.riderId },
        )
        val out = ArrayList<RiderProfile>()
        for ((table, ids) in byTable) {
            if (ids.isEmpty()) continue
            val rows: List<RiderProfile> = client.from(table).select(cols) {
                filter { isIn("id", ids) }
            }.decodeList()
            // El contrato lo manda la afiliación (no riders_*.contractUntil).
            out += rows.map { it.copy(contractUntil = contractByRider[it.id]) }
        }
        return out
    }

    // ─────────── Start Order ───────────

    /**
     * Jornada del orden de salida en una sola lectura: la misma fila se
     * decodifica como DTO del orden de salida y como [RaceDay] canónico para la
     * cabecera. El [RaceDay] es null si su decodificación falla.
     */
    suspend fun startOrderRaceDayWithFull(raceDayId: String): Pair<StartOrderRaceDay, RaceDay?>? {
        val raw = client.from("race_days").select {
            filter { eq("id", raceDayId) }
            limit(1)
        }.data
        val row = rowJson.decodeFromString<List<kotlinx.serialization.json.JsonElement>>(raw).firstOrNull()
            ?: return null
        val startOrder = rowJson.decodeFromJsonElement(StartOrderRaceDay.serializer(), row)
        val full = runCatching { rowJson.decodeFromJsonElement(RaceDay.serializer(), row) }.getOrNull()
        return startOrder to full
    }

    suspend fun startOrderEntries(raceDayId: String): List<StartOrderEntry> =
        client.from("start_order_entries_resolved").select {
            filter { eq("raceDayId", raceDayId) }
            order("sortOrder", Order.ASCENDING)
        }.decodeList()

    // ─────────── Resultados UCI in-house ───────────

    // Clasificaciones keepForWeb de una carrera (clasif. de etapa + GC del día +
    // generales acumuladas). 1 fila por (etapa × clasificación).
    suspend fun raceUciStages(raceId: String): List<RaceUciStage> =
        client.from("race_uci_stages").select {
            filter {
                eq("raceId", raceId)
                eq("keepForWeb", true)
            }
            order("stageNumber", Order.ASCENDING, nullsFirst = true)
        }.decodeList()

    suspend fun raceClassifications(raceId: String): List<RaceClassificationConfig> =
        client.from("race_classifications").select(
            columns = Columns.raw("raceId,classKind,position,labelEs,labelEn,colorHex")
        ) {
            filter { eq("raceId", raceId) }
            order("position", Order.ASCENDING)
        }.decodeList()

    suspend fun raceClassificationsByRaceIds(raceIds: List<String>): List<RaceClassificationConfig> =
        inChunks(raceIds, 20) { chunk ->
            client.from("race_classifications").select(
                columns = Columns.raw("raceId,classKind,position,labelEs,labelEn,colorHex")
            ) {
                filter { isIn("raceId", chunk) }
                order("position", Order.ASCENDING)
            }.decodeList<RaceClassificationConfig>()
        }

    /**
     * Clasificaciones in-house publicables (keepForWeb y con filas) de un lote
     * de carreras, reducidas a lo que necesitan los accesos a resultados de
     * Hoy, Carrera, Jornada, Campeonatos e inscritos. Una consulta por lote.
     */
    suspend fun inhouseStagesByRaceIds(raceIds: List<String>): List<RaceUciStage> =
        inChunks(raceIds, 50) { chunk ->
            selectAllPages<RaceUciStage>(
                "race_uci_stages",
                Columns.raw("id,raceId,raceDayId,classKind,stageNumber,rowCount,keepForWeb"),
            ) {
                filter {
                    isIn("raceId", chunk)
                    eq("keepForWeb", true)
                    gt("rowCount", 0)
                }
                order("id", Order.ASCENDING)
            }
        }

    // Filas de una clasificación concreta (siempre por stageRef → índice).
    suspend fun raceUciResults(stageRef: String): List<RaceUciResultRow> =
        client.from("race_uci_results").select {
            filter { eq("stageRef", stageRef) }
            order("sortOrder", Order.ASCENDING)
        }.decodeList()

    // Filas con abandono (irm) de un conjunto de etapas — para tachar inscritos.
    // CLAVE: el filtro `globalRiderId IS NOT NULL` + `irm IS NOT NULL` va EN EL
    // SERVIDOR (no en memoria): traer todas las filas de todas las etapas y filtrar
    // en Kotlin chocaba con el tope de filas por respuesta de PostgREST → los abandonos
    // de las primeras etapas se truncaban (p.ej. Cat Ferguson, DNF etapa 1 del
    // Giro Women, no se tachaba). Filtrando en servidor solo vuelven los pocos DNF.
    suspend fun raceUciResultsForStages(stageRefs: List<String>): List<RaceUciResultRow> {
        if (stageRefs.isEmpty()) return emptyList()
        return client.from("race_uci_results").select {
            filter {
                isIn("stageRef", stageRefs)
                filterNot("globalRiderId", FilterOperator.IS, null)
                filterNot("irm", FilterOperator.IS, null)
            }
        }.decodeList()
    }

    // Vista resuelta con globalRiderId (lo necesita la reconstrucción por dorsal
    // de los resultados; el modelo StartlistRider de las startlists no lo lleva).
    // El select sin columnas trae también currentTeamId (equipo ACTUAL del
    // corredor) — gate de los enlaces a ficha, espejo de resultados.js.
    suspend fun startlistRidersResolvedFull(raceId: String): List<StartlistRiderResolved> =
        client.from("startlist_riders_resolved").select {
            filter { eq("raceId", raceId) }
        }.decodeList()

    /**
     * Clasificaciones keepForWeb de un conjunto de carreras, en una pasada.
     * Troceado en lotes y paginado por el tope de filas por respuesta de
     * PostgREST. Lo usan el
     * feed de Resultados y la rejilla de Campeonatos (claves in-house).
     */
    suspend fun raceUciStagesByRaceIds(raceIds: List<String>): List<RaceUciStage> =
        inChunks(raceIds, 15) { chunk ->
            // Quince vueltas por etapas pueden superar el tope de filas por respuesta.
            selectAllPages<RaceUciStage>("race_uci_stages") {
                filter {
                    isIn("raceId", chunk)
                    eq("keepForWeb", true)
                }
                order("id", Order.ASCENDING)
            }
        }

    // ─────────── Feed de resultados (pestaña Resultados, apps 3.1) ───────────

    /**
     * Clasificaciones in-house del rango para el feed: etapas + generales,
     * solo keepForWeb con filas. stageDate NULL (volcados PDF, migración 090)
     * también entra: su fecha se resuelve en cliente (ResultsFeedLogic) y se
     * filtra después.
     *
     * ⚠️ Forma del filtro: la web manda DOS `or=` sueltos (PostgREST los
     * AND-ea), pero supabase-kt 2.6.1 solo conserva UN valor por clave de query
     * (`mapToFirstValue`) → el segundo `or=` pisaría al primero. Equivalente
     * lógico con un único `or`: (stageDate ENTRE from Y to) OR stageDate IS NULL
     * — misma tabla de verdad que (gte OR null) AND (lte OR null).
     */
    suspend fun raceUciStagesFeed(fromKey: String, toKey: String): List<RaceUciStage> =
        client.from("race_uci_stages").select(
            columns = Columns.raw(
                "id,raceId,raceDayId,stageNumber,classKind,stageDate,winnerName,isFinalClassification"
            )
        ) {
            filter {
                eq("keepForWeb", true)
                gt("rowCount", 0)
                isIn("classKind", listOf("stage", "gc"))
                or {
                    and {
                        gte("stageDate", fromKey)
                        lte("stageDate", toKey)
                    }
                    exact("stageDate", null)
                }
            }
        }.decodeList()

    /**
     * Jornadas publicadas del rango para el feed (km/desnivel/
     * tipos/hora de las filas in-house, vía raceDayId). El rango va dentro de
     * un `and` explícito: dos filtros sueltos sobre la MISMA columna colapsan
     * al primero en supabase-kt 2.6.1 (ver nota de raceUciStagesFeed).
     */
    suspend fun raceDaysFeedWindow(fromKey: String, toKey: String): List<RaceDay> =
        // Del perfil solo se muestra el desnivel: PostgREST extrae ese campo del
        // JSONB en lugar de transferir el perfil completo de cada jornada.
        selectAllPages<FeedRaceDayRow>(
            "race_days",
            Columns.raw(
                "id,raceId,dateKey,stageNumber,isRestDay,isCancelledDay," +
                    "estimatedFinishTimeUtc,neutralStartTimeUtc,realStartTimeUtc,startLocation,finishLocation," +
                    "startLocationEn,finishLocationEn,distanceKm,elevationGain:elevationProfile->elevationGain," +
                    "primaryType,secondaryType,countryCode"
            ),
        ) {
            filter {
                eq("editorialStatus", "published")
                and {
                    gte("dateKey", fromKey)
                    lte("dateKey", toKey)
                }
            }
            order("id", Order.ASCENDING)
        }.map { it.toRaceDay() }

    /** Filas rank=1 de un conjunto de clasificaciones (ganador de cada entrada). */
    suspend fun raceUciRank1(stageRefs: List<String>): List<UciRank1Row> {
        if (stageRefs.isEmpty()) return emptyList()
        return client.from("race_uci_results").select(
            columns = Columns.raw("stageRef,raceId,bib,globalRiderId,teamId,riderDisplay,irm")
        ) {
            filter {
                eq("rank", 1)
                isIn("stageRef", stageRefs)
            }
        }.decodeList()
    }

    /**
     * Nombre canónico "FirstName LastName" por ficha. Dos queries (riders_men y
     * riders_women) — el feed no sabe el género del ganador, igual que la web.
     */
    suspend fun riderNamesByIds(ids: List<String>): Map<String, String> {
        if (ids.isEmpty()) return emptyMap()
        val tables = coroutineScope {
            listOf("riders_men", "riders_women").map { table ->
                async {
                    inChunks(ids, ID_CHUNK) { chunk ->
                        client.from(table).select(
                            columns = Columns.list("id", "firstName", "lastName")
                        ) {
                            filter { isIn("id", chunk) }
                        }.decodeList<RiderNameRow>()
                    }
                }
            }.awaitAll()
        }
        // Mismo orden de precedencia que la versión secuencial: mujeres pisa a
        // hombres si un id apareciera en ambas tablas.
        val out = HashMap<String, String>()
        for (rows in tables) {
            for (r in rows) {
                val name = "${r.firstName.orEmpty()} ${r.lastName.orEmpty()}".trim()
                if (name.isNotEmpty()) out[r.id] = name
            }
        }
        return out
    }

    /** Inscritos de las carreras destacadas, para el fallback por dorsal del feed. */
    suspend fun feedStartlistIdentities(raceIds: List<String>): List<FeedStartlistIdentityRow> {
        if (raceIds.isEmpty()) return emptyList()
        return client.from("startlist_riders_resolved").select(
            columns = Columns.raw("raceId,dorsal,globalRiderId,firstName,lastName")
        ) {
            filter { isIn("raceId", raceIds) }
        }.decodeList()
    }

    /** Nombres canónicos de equipos para líderes de clasificaciones por equipos. */
    suspend fun teamNamesByIds(teamIds: List<String>): Map<String, String> {
        if (teamIds.isEmpty()) return emptyMap()
        val rows = inChunks(teamIds, ID_CHUNK) { chunk ->
            client.from("teams").select(
                columns = Columns.list("id", "name")
            ) {
                filter { isIn("id", chunk) }
            }.decodeList<TeamIdentityRow>()
        }
        return rows.associate { it.id to it.name }
    }

    /**
     * Filas de inscritos (carrera, corredor, PK de startlist_teams) de un lote
     * de carreras y corredores. CRE: el ganador es el EQUIPO; corredor rank 1 →
     * fila de startlist → equipo. `teamId` aquí es el PK de startlist_teams, NO
     * la ref canónica a teams. El cruce exacto carrera × corredor se hace en el
     * llamador.
     */
    suspend fun startlistRiderTeamRows(raceIds: List<String>, riderIds: List<String>): List<StartlistRiderTeamRow> {
        val races = raceIds.filter { it.isNotEmpty() }.distinct()
        if (races.isEmpty() || riderIds.isEmpty()) return emptyList()
        return inChunks(riderIds, ID_CHUNK) { chunk ->
            client.from("startlist_riders_resolved").select(
                columns = Columns.list("raceId", "globalRiderId", "teamId")
            ) {
                filter {
                    isIn("raceId", races)
                    isIn("globalRiderId", chunk)
                }
            }.decodeList<StartlistRiderTeamRow>()
        }
    }

    /** Filas de startlist_teams por PK (nombre snapshot + ref canónica). */
    suspend fun startlistTeamsByPks(pks: List<String>): List<StartlistTeam> =
        inChunks(pks, ID_CHUNK) { chunk ->
            client.from("startlist_teams").select {
                filter { isIn("id", chunk) }
            }.decodeList<StartlistTeam>()
        }

    // ─────────── Today Highlights (cintillo manual) ───────────

    /**
     * Trae los destacados activos ahora. `visibleFrom` / `visibleUntil` son
     * TIMESTAMPTZ (precisión al segundo). Filtrado en cliente para evitar
     * problemas de escaping ISO/null en filtros .or() de PostgREST.
     */
    suspend fun todayHighlights(scope: String = "road"): List<TodayHighlight> {
        val resolvedScope = if (scope == "cx") "cx" else "road"
        val all: List<TodayHighlight> = client.from("today_highlights").select {
            filter { eq("scope", resolvedScope) }
            order("position", Order.ASCENDING)
        }.decodeList()
        val now = java.time.Instant.now()
        return all.filter { h ->
            val from = parseInstant(h.visibleFrom)
            val until = parseInstant(h.visibleUntil)
            val afterFrom = from?.let { !it.isAfter(now) } ?: true
            val beforeUntil = until?.let { !it.isBefore(now) } ?: true
            afterFrom && beforeUntil
        }
    }

    private fun parseInstant(s: String?): java.time.Instant? {
        if (s.isNullOrEmpty()) return null
        return runCatching { java.time.OffsetDateTime.parse(s).toInstant() }.getOrNull()
            ?: runCatching { java.time.Instant.parse(s) }.getOrNull()
    }

    // ─────────── Challenge Groups ───────────

    suspend fun challengeGroups(year: Int): List<ChallengeGroup> =
        client.from("challenge_groups").select {
            filter { eq("year", year) }
        }.decodeList()

    // ─────────── Push Notifications ───────────

    /**
     * Inserta o actualiza un token FCM para notificaciones push junto con
     * sus categorías activas, carreras seguidas, filtros de grupo y
     * `countryGroup` derivado de la TZ del device. Atómico vía RPC con
     * SECURITY DEFINER en el server.
     *
     * `categories` debería incluir siempre `"general"` para preservar el
     * baseline gratuito (no degradar lo que recibía la app 1.4.4).
     *
     * `countryGroup` (opcional) afina el envío de `tv_start` al horario del
     * primer canal visible para el grupo fino del usuario.
     *
     * `language` ('es' | 'en') determina el idioma de las notificaciones
     * Premium auto-generadas (race_start / tv_start / results). Valores
     * inválidos caen a 'es' (baseline).
     */
    suspend fun upsertPushToken(
        token: String,
        isActive: Boolean,
        region: String,
        countryGroup: String?,
        language: String,
        categories: List<String>,
        followedRaces: List<String> = emptyList(),
        raceFilters: List<String> = emptyList(),
        followedStages: List<String> = emptyList(),
        followedCxRaces: List<String>? = null,
    ) {
        val normalizedLanguage = if (language == "en") "en" else "es"
        val params = buildJsonObject {
            put("p_token", JsonPrimitive(token))
            put("p_platform", JsonPrimitive("android"))
            put("p_is_active", JsonPrimitive(isActive))
            put("p_region", JsonPrimitive(region))
            put("p_country_group", if (countryGroup != null) JsonPrimitive(countryGroup) else JsonNull)
            put("p_language", JsonPrimitive(normalizedLanguage))
            put("p_categories", JsonArray(categories.map { JsonPrimitive(it) }))
            put("p_followed_races", JsonArray(followedRaces.map { JsonPrimitive(it) }))
            put("p_race_filters", JsonArray(raceFilters.map { JsonPrimitive(it) }))
            put("p_followed_stages", JsonArray(followedStages.map { JsonPrimitive(it) }))
            put("p_followed_cx_races", followedCxRaces?.let { JsonArray(it.map { id -> JsonPrimitive(id) }) } ?: JsonNull)
        }
        client.postgrest.rpc("set_push_subscription_v4", params)
    }

    /**
     * Elimina permanentemente el registro de push (derecho de supresión).
     * Vía RPC SECURITY DEFINER: anon no tiene acceso directo a push_subscriptions
     * (migración 125). Ver también set_push_subscription_v3 para el registro.
     */
    suspend fun deletePushToken(token: String) {
        client.postgrest.rpc(
            "delete_push_subscription",
            buildJsonObject { put("p_token", JsonPrimitive(token)) },
        )
    }

    // ─────────── Helpers compuestos ───────────

    /** Carga datos completos de un día: jornadas + carreras + emisiones + assets + elevación. */
    suspend fun loadDayComplete(dateKey: String): DayData = coroutineScope {
        // La selección destacada solo depende de la fecha: viaja con la primera tanda.
        val featuredDeferred = async { featuredRaces(listOf(dateKey)) }
        var raceDays = raceDaysByDate(dateKey).toMutableList()

        val raceIds = raceDays.mapNotNull { it.raceId }.distinct()
        val rdIds = raceDays.map { it.id }

        val racesDeferred = async { racesByIds(raceIds) }
        val broadcastsDeferred = async { broadcastsByRaceDays(rdIds) }
        val assetsDeferred = async { assetsByRaceDays(rdIds) }
        val elevDeferred = async { raceDaysElevation(rdIds) }

        val fetchedRaces = racesDeferred.await()
        val fetchedBroadcasts = broadcastsDeferred.await()
        val fetchedAssets = assetsDeferred.await()
        val fetchedElev = elevDeferred.await()
        val featured = featuredDeferred.await()

        val raceMap = fetchedRaces.associateBy { it.id }
        val broadcastsByRd = fetchedBroadcasts.groupBy { it.raceDayId }
        val assetsByRd = fetchedAssets.groupBy { it.raceDayId }
        val elevMap = fetchedElev.associateBy { it.id }

        // Aplicar datos de elevación sobre el resultado slim
        raceDays = raceDays.map { rd ->
            elevMap[rd.id]?.let { rd.applyingElevation(it) } ?: rd
        }.toMutableList()

        RaceLogic.annotateDoubleSectors(raceDays)

        val enriched = raceDays.map { rd ->
            EnrichedRaceDay(
                raceDay = rd,
                race = rd.raceId?.let { raceMap[it] },
                broadcasts = broadcastsByRd[rd.id].orEmpty(),
                assets = assetsByRd[rd.id].orEmpty(),
            )
        }

        DayData(
            raceDays = enriched,
            raceMap = raceMap,
            featuredRaceIds = featured.filter { it.dateKey == dateKey }.map { it.raceId }.toSet(),
        )
    }

    /**
     * Carga datos completos de una carrera: info + etapas + emisiones + assets.
     *
     * Con [profileDayIds] null todas las jornadas llegan con perfil de
     * elevación (Carrera pinta un miniperfil por etapa). Con un conjunto, solo
     * esas jornadas traen perfil; el resto llega sin él y [RaceComplete.profileDayIds]
     * lo indica para que la caché conserve el perfil ya guardado.
     */
    suspend fun loadRaceComplete(raceId: String, profileDayIds: Set<String>? = null): RaceComplete =
        coroutineScope {
            val raceDeferred = async { raceById(raceId) }
            val elevationDeferred = profileDayIds?.let { ids -> async { raceDaysElevation(ids.toList()) } }
            val fetchedDays = if (profileDayIds == null) raceDaysByRace(raceId) else raceDaysByRaceSlim(raceId)
            val elevationById = elevationDeferred?.await().orEmpty().associateBy { it.id }
            val days = fetchedDays.map { rd -> elevationById[rd.id]?.let { rd.applyingElevation(it) } ?: rd }
                .toMutableList()

            days.sortWith(RaceLogic.raceProgramOrder)

            RaceLogic.annotateDoubleSectors(days)

            val dayIds = days.map { it.id }
            val broadcastsDeferred = async { broadcastsByRaceDays(dayIds) }
            val assetsDeferred = async { assetsByRaceDays(dayIds) }

            val race = raceDeferred.await()
            val broadcastsByRd = broadcastsDeferred.await().groupBy { it.raceDayId }
            val assetsByRd = assetsDeferred.await().groupBy { it.raceDayId }

            val enriched = days.map { rd ->
                EnrichedRaceDay(
                    raceDay = rd,
                    race = race,
                    broadcasts = broadcastsByRd[rd.id].orEmpty(),
                    assets = assetsByRd[rd.id].orEmpty(),
                )
            }

            RaceComplete(
                race = race,
                days = enriched,
                // Solo cuentan como completas las jornadas cuyo perfil se pidió;
                // una fila sin perfil en BD (o con perfil no visible) también lo es.
                profileDayIds = profileDayIds?.intersect(days.map { it.id }.toSet()),
            )
        }

    // ─────────── Helpers DTO ───────────

    @Serializable
    private data class MinimalDateRow(val dateKey: String)

    @Serializable
    private data class RiderNameRow(
        val id: String,
        val firstName: String? = null,
        val lastName: String? = null,
    )

    @Serializable
    private data class IdRow(val id: String)

    @Serializable
    private data class TeamIdentityRow(val id: String, val name: String)

    /** Jornada del feed con el desnivel extraído del JSONB del perfil. */
    @Serializable
    private data class FeedRaceDayRow(
        val id: String,
        val raceId: String? = null,
        val dateKey: String,
        val stageNumber: Int? = null,
        val isRestDay: Boolean = false,
        val isCancelledDay: Boolean = false,
        val estimatedFinishTimeUtc: String? = null,
        val neutralStartTimeUtc: String? = null,
        val realStartTimeUtc: String? = null,
        val startLocation: String? = null,
        val finishLocation: String? = null,
        val startLocationEn: String? = null,
        val finishLocationEn: String? = null,
        val distanceKm: Double? = null,
        val elevationGain: Double? = null,
        val primaryType: String? = null,
        val secondaryType: String? = null,
        val countryCode: String? = null,
    ) {
        fun toRaceDay() = RaceDay(
            id = id,
            raceId = raceId,
            dateKey = dateKey,
            stageNumber = stageNumber,
            isRestDay = isRestDay,
            isCancelledDay = isCancelledDay,
            estimatedFinishTimeUtc = estimatedFinishTimeUtc,
            neutralStartTimeUtc = neutralStartTimeUtc,
            realStartTimeUtc = realStartTimeUtc,
            startLocation = startLocation,
            finishLocation = finishLocation,
            startLocationEn = startLocationEn,
            finishLocationEn = finishLocationEn,
            distanceKm = distanceKm,
            // Perfil reducido al desnivel: sin puntos no cuenta como perfil visible.
            elevationProfile = elevationGain?.let {
                ElevationProfile(distance = distanceKm ?: 0.0, elevationGain = kotlin.math.round(it).toInt())
            },
            primaryType = primaryType,
            secondaryType = secondaryType,
            countryCode = countryCode,
        )
    }

    companion object {
        /** Filas por página; por debajo del tope por respuesta de PostgREST. */
        private const val PAGE_SIZE = 1000L

        /** Identificadores por filtro `in.(…)`: acota la longitud de la URL. */
        private const val ID_CHUNK = 150

        /** Peticiones simultáneas máximas al trocear una consulta por lotes. */
        private const val MAX_PARALLEL_REQUESTS = 4

        private const val CX_TEAMS_TTL_SECONDS = 3600L

        private val rowJson = Json { ignoreUnknownKeys = true }

        /**
         * Columnas de `races` que decodifica [Race]. Mantener sincronizada con
         * el modelo: un campo nuevo de [Race] debe añadirse aquí.
         */
        private val RACE_COLUMNS = Columns.raw(
            "id,name,nameEn,uciCategory,gender,raceFormat,countryCode,colorHex,logoUrl," +
                "websiteUrl,hideFlag,isGrandTour,isNoClickable,isCancelled,startDate,endDate,year," +
                "slug,originalName,startlistImportedAt,startlistProvisional,createdAt"
        )

        /** Columnas de `teams` que decodifica [Team]. */
        private val TEAM_COLUMNS = Columns.raw(
            "id,name,badgeTorsoCenter,badgeTorsoSides,badgeShorts,badgeInnerCircle," +
                "headerBg,headerText,nameAliases,category"
        )

        /** Columnas de race_days sin los campos de perfil de elevación (JSONB pesados).
         *  Para queries masivas (Mes, Temporada, Búsqueda) donde esos datos no son necesarios.
         *  Junto con [raceDaysElevation] cubre todos los campos de [RaceDay]. */
        private const val RACE_DAY_SLIM_COLUMNS =
            "id,raceId,dateKey,date,slug,isRestDay,isCancelledDay,stageNumber," +
            "startLocation,finishLocation,distanceKm,primaryType,secondaryType," +
            "neutralStartTimeUtc,realStartTimeUtc,estimatedFinishTimeUtc,tvStatus,description,bonuses,notes," +
            "startLocationEn,finishLocationEn,translations,editorialStatus,hasAssets,updatedAt,countryCode,routeGpxUrl"
                .plus(",raceStatus,competitiveDistanceKm,timingPolicy,raceTimeSeconds,averageSpeedKmh,timeLimitSeconds,timeLimitBasis,metricsUpdatedAt")

        /** Identidad, fecha y estado de una jornada: programa de carrera y cintillo. */
        private const val RACE_DAY_PROGRAM_COLUMNS =
            "id,raceId,dateKey,date,slug,stageNumber,isRestDay,isCancelledDay,neutralStartTimeUtc,editorialStatus"
    }
}

/** Instantánea de una carrera descargada por [SupabaseService.loadRaceComplete]. */
data class RaceComplete(
    val race: Race,
    val days: List<EnrichedRaceDay>,
    /** Jornadas que llegan con perfil; null si todas lo traen. */
    val profileDayIds: Set<String>?,
)

/** Fila mínima de inscritos para resolver el equipo ganador de una CRE. */
@Serializable
data class StartlistRiderTeamRow(
    val raceId: String,
    val globalRiderId: String? = null,
    val teamId: String? = null,
)
