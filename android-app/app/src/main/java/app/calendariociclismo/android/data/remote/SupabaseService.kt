package app.calendariociclismo.android.data.remote

import app.calendariociclismo.android.BuildConfig
import app.calendariociclismo.android.data.model.Asset
import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.ChallengeGroup
import app.calendariociclismo.android.data.model.DayData
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceDayElevationData
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
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.postgrest.rpc
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Servicio centralizado para acceso a datos de Supabase.
 *
 * Port del `SupabaseService.swift` iOS. Expone las mismas queries contra
 * las mismas tablas (`races`, `race_days`, `broadcasts`, `assets`,
 * `startlist_teams`, `startlist_riders`, `challenge_groups`,
 * `push_subscriptions`).
 */
@OptIn(SupabaseInternal::class)
class SupabaseService {

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

    suspend fun racesByYear(year: Int): List<Race> =
        client.from("races").select {
            filter { eq("year", year) }
        }.decodeList()

    suspend fun raceById(id: String): Race =
        client.from("races").select {
            filter { eq("id", id) }
            limit(1)
        }.decodeSingle()

    suspend fun raceBySlug(slug: String): Race =
        client.from("races").select {
            filter { eq("slug", slug) }
            limit(1)
        }.decodeSingle()

    suspend fun racesByIds(ids: List<String>): List<Race> {
        if (ids.isEmpty()) return emptyList()
        return client.from("races").select {
            filter { isIn("id", ids) }
        }.decodeList()
    }

    /** Carreras de Campeonatos Nacionales (uciCategory='CN') de un año dentro de
     *  un rango de fechas de salida. Espejo de la query en `js/campeonatos.js`. */
    suspend fun championshipRaces(year: Int, from: String, to: String): List<Race> =
        client.from("races").select {
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

    suspend fun raceDaysByRace(raceId: String): List<RaceDay> =
        client.from("race_days").select {
            filter {
                eq("raceId", raceId)
                eq("editorialStatus", "published")
            }
        }.decodeList()

    /** Jornadas publicadas de un conjunto de carreras (batch). Modo Campeonatos. */
    suspend fun raceDaysByRaceIds(ids: List<String>): List<RaceDay> {
        if (ids.isEmpty()) return emptyList()
        return client.from("race_days").select {
            filter {
                isIn("raceId", ids)
                eq("editorialStatus", "published")
            }
        }.decodeList()
    }

    /**
     * Jornadas publicadas en un rango de fechas (sin perfil de elevación).
     * Pagina manualmente en chunks de 1.000: PostgREST aplica un tope
     * server-side de 1.000 filas por request que un `limit()` más alto NO
     * evita (mismo tope que ya documenta `panel.js` para riders_men/women).
     * Sin esto, un rango que cubra más de 1.000 jornadas (p. ej. un año
     * natural completo, como hace `MonthScreen` vía `refreshRange`) se
     * trunca en silencio y el orden de retorno no sigue la fecha, así que
     * la parte recortada no son necesariamente "los últimos días del año":
     * pueden faltar carreras enteras de mitad de temporada (bug real: Tour
     * de Francia 2026 desaparecía casi entero de la vista de Mes).
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

    suspend fun teams(): List<Team> =
        client.from("teams").select().decodeList()

    // Render temporal: versiones de equipo de un año concreto (team_seasons).
    // Se filtra por año; los teamIds se cruzan en memoria con globalTeams.
    suspend fun teamSeasons(year: Int): List<TeamSeason> =
        client.from("team_seasons").select {
            filter { eq("year", year) }
        }.decodeList()

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
        val out = ArrayList<RiderProfile>()
        for (table in listOf("riders_men", "riders_women")) {
            val rows: List<RiderProfile> = client.from(table).select(cols) {
                filter { isIn("id", ids) }
            }.decodeList()
            out += rows
        }
        return out
    }

    // ─────────── Fichajes (mercado, mig. 122) ───────────

    /** Movimientos del mercado de una temporada, cronológico inverso. */
    suspend fun riderTransfers(season: Int): List<RiderTransfer> =
        client.from("rider_transfers").select {
            filter { eq("season", season) }
            order("announcedAt", Order.DESCENDING)
            order("createdAt", Order.DESCENDING)
        }.decodeList()

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
                filter { eq("year", season); eq("teamId", teamId) }
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

    suspend fun startOrderRaceDay(raceDayId: String): StartOrderRaceDay? =
        client.from("race_days").select(
            Columns.list(
                "id", "raceId", "date", "dateKey", "slug", "slugEn", "stageNumber", "primaryType",
                "startLocation", "finishLocation", "startLocationEn", "finishLocationEn",
                "distanceKm", "timezone", "startOrderTtDorsals", "startOrderGcDorsals"
            )
        ) {
            filter { eq("id", raceDayId) }
            limit(1)
        }.decodeList<StartOrderRaceDay>().firstOrNull()

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

    // Filas de una clasificación concreta (siempre por stageRef → índice).
    suspend fun raceUciResults(stageRef: String): List<RaceUciResultRow> =
        client.from("race_uci_results").select {
            filter { eq("stageRef", stageRef) }
            order("sortOrder", Order.ASCENDING)
        }.decodeList()

    // Filas con abandono (irm) de un conjunto de etapas — para tachar inscritos.
    // CLAVE: el filtro `globalRiderId IS NOT NULL` + `irm IS NOT NULL` va EN EL
    // SERVIDOR (no en memoria): traer todas las filas de todas las etapas y filtrar
    // en Kotlin chocaba con el límite de ~1000 filas de PostgREST → los abandonos
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
     * Troceado en lotes — el límite de PostgREST son ~1000 filas. Lo usan el
     * feed de Resultados y la rejilla de Campeonatos (claves in-house).
     */
    suspend fun raceUciStagesByRaceIds(raceIds: List<String>): List<RaceUciStage> {
        if (raceIds.isEmpty()) return emptyList()
        val out = ArrayList<RaceUciStage>()
        for (chunk in raceIds.chunked(15)) {
            out += client.from("race_uci_stages").select {
                filter {
                    isIn("raceId", chunk)
                    eq("keepForWeb", true)
                }
            }.decodeList<RaceUciStage>()
        }
        return out
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
     * Jornadas publicadas del rango para el feed (fallback FC/PCS + km/desnivel/
     * tipos/hora de las filas in-house, vía raceDayId). El rango va dentro de
     * un `and` explícito: dos filtros sueltos sobre la MISMA columna colapsan
     * al primero en supabase-kt 2.6.1 (ver nota de raceUciStagesFeed).
     */
    suspend fun raceDaysFeedWindow(fromKey: String, toKey: String): List<RaceDay> =
        client.from("race_days").select(
            columns = Columns.raw(
                "id,raceId,dateKey,stageNumber,isRestDay,isCancelledDay," +
                    "estimatedFinishTimeUtc,neutralStartTimeUtc,startLocation,finishLocation," +
                    "startLocationEn,finishLocationEn,distanceKm,elevationProfile," +
                    "primaryType,secondaryType,countryCode"
            )
        ) {
            filter {
                eq("editorialStatus", "published")
                and {
                    gte("dateKey", fromKey)
                    lte("dateKey", toKey)
                }
            }
        }.decodeList()

    /** Filas rank=1 de un conjunto de clasificaciones (ganador de cada entrada). */
    suspend fun raceUciRank1(stageRefs: List<String>): List<UciRank1Row> {
        if (stageRefs.isEmpty()) return emptyList()
        return client.from("race_uci_results").select(
            columns = Columns.raw("stageRef,globalRiderId,irm")
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
        val out = HashMap<String, String>()
        for (table in listOf("riders_men", "riders_women")) {
            val rows: List<RiderNameRow> = client.from(table).select(
                columns = Columns.list("id", "firstName", "lastName")
            ) {
                filter { isIn("id", ids) }
            }.decodeList()
            for (r in rows) {
                val name = "${r.firstName.orEmpty()} ${r.lastName.orEmpty()}".trim()
                if (name.isNotEmpty()) out[r.id] = name
            }
        }
        return out
    }

    /**
     * PKs de startlist_teams de los corredores dados en una carrera (CRE: el
     * ganador es el EQUIPO; el corredor rank 1 → fila de startlist → equipo).
     * `teamId` aquí es el PK de startlist_teams, NO la ref canónica a teams.
     */
    suspend fun startlistRiderTeamPks(raceId: String, riderIds: List<String>): List<String> {
        if (riderIds.isEmpty()) return emptyList()
        val rows: List<TeamPkRow> = client.from("startlist_riders_resolved").select(
            columns = Columns.list("teamId")
        ) {
            filter {
                eq("raceId", raceId)
                isIn("globalRiderId", riderIds)
            }
            limit(3)
        }.decodeList()
        return rows.mapNotNull { it.teamId }
    }

    /** Fila de startlist_teams por su PK (nombre snapshot + ref canónica). */
    suspend fun startlistTeamByPk(pk: String): StartlistTeam? =
        client.from("startlist_teams").select {
            filter { eq("id", pk) }
            limit(1)
        }.decodeList<StartlistTeam>().firstOrNull()

    /** Nombre canónico de un equipo del catálogo. */
    suspend fun teamNameById(teamId: String): String? =
        client.from("teams").select(columns = Columns.list("name")) {
            filter { eq("id", teamId) }
            limit(1)
        }.decodeList<TeamNameRow>().firstOrNull()?.name

    // ─────────── Today Highlights (cintillo manual) ───────────

    /**
     * Trae los destacados activos ahora. `visibleFrom` / `visibleUntil` son
     * TIMESTAMPTZ (precisión al segundo). Filtrado en cliente para evitar
     * problemas de escaping ISO/null en filtros .or() de PostgREST.
     */
    suspend fun todayHighlights(): List<TodayHighlight> {
        val all: List<TodayHighlight> = client.from("today_highlights").select {
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

    suspend fun challengeGroups(): List<ChallengeGroup> =
        client.from("challenge_groups").select().decodeList()

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
        }
        client.postgrest.rpc("set_push_subscription_v3", params)
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

        DayData(raceDays = enriched, raceMap = raceMap)
    }

    /** Carga datos completos de una carrera: info + etapas + emisiones + assets. */
    suspend fun loadRaceComplete(raceId: String): Pair<Race, List<EnrichedRaceDay>> =
        coroutineScope {
            val race = raceById(raceId)
            val days = raceDaysByRace(raceId).toMutableList()

            days.sortWith(Comparator { a, b ->
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
            })

            RaceLogic.annotateDoubleSectors(days)

            val dayIds = days.map { it.id }
            val broadcastsDeferred = async { broadcastsByRaceDays(dayIds) }
            val assetsDeferred = async { assetsByRaceDays(dayIds) }

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

            race to enriched
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
    private data class TeamPkRow(val teamId: String? = null)

    @Serializable
    private data class TeamNameRow(val name: String)

    companion object {
        /** Columnas de race_days sin los campos de perfil de elevación (JSONB pesados).
         *  Para queries masivas (Mes, Temporada, Búsqueda) donde esos datos no son necesarios. */
        private const val RACE_DAY_SLIM_COLUMNS =
            "id,raceId,dateKey,date,slug,isRestDay,isCancelledDay,stageNumber," +
            "startLocation,finishLocation,distanceKm,primaryType,secondaryType," +
            "neutralStartTimeUtc,estimatedFinishTimeUtc,tvStatus,description,bonuses,notes," +
            "startLocationEn,finishLocationEn,translations,editorialStatus,hasAssets,updatedAt,countryCode,routeGpxUrl"
    }
}
