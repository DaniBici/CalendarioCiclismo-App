package app.calendariociclismo.android.data.repository

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.updateAll
import app.calendariociclismo.android.data.local.AppDatabase
import app.calendariociclismo.android.data.local.entity.AssetEntity
import app.calendariociclismo.android.data.local.entity.BroadcastEntity
import app.calendariociclismo.android.data.local.entity.RaceDayEntity
import app.calendariociclismo.android.data.local.entity.RaceEntity
import app.calendariociclismo.android.data.model.Asset
import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.ChampionshipCountry
import app.calendariociclismo.android.data.model.DayData
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceUciResultRow
import app.calendariociclismo.android.data.model.RaceUciStage
import app.calendariociclismo.android.data.model.ResolvedRider
import app.calendariociclismo.android.data.model.RiderOut
import app.calendariociclismo.android.data.model.RiderProfile
import app.calendariociclismo.android.data.model.StartOrderData
import app.calendariociclismo.android.data.model.StartlistData
import app.calendariociclismo.android.data.model.Team
import app.calendariociclismo.android.data.model.UciResultsData
import app.calendariociclismo.android.data.model.applySeason
import app.calendariociclismo.android.data.remote.SupabaseService
import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.ResultsFeedLogic
import app.calendariociclismo.android.util.StartlistLogic
import app.calendariociclismo.android.util.TransfersLogic
import app.calendariociclismo.android.util.UciResultsLogic
import app.calendariociclismo.android.widget.today.TodayCyclingWidget
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Repositorio único para datos del calendario.
 *
 * Estrategia:
 * - **Lectura**: Flow reactivo desde Room para que la UI sea offline-first.
 * - **Escritura**: funciones `refresh…` que llaman a Supabase y persisten en Room.
 * - **Combinadores**: `dayData(dateKey)` ensambla EnrichedRaceDay a partir
 *   de las tablas locales.
 *
 * No usa Hilt; los objetos los inyecta a mano el `CalendarioCiclismoApp`.
 */
class CalendarRepository(
    private val db: AppDatabase,
    private val api: SupabaseService,
    private val appContext: Context,
    private val clock: () -> Long = { System.currentTimeMillis() / 1000 },
) {
    private val racesDao = db.racesDao()
    private val raceDaysDao = db.raceDaysDao()
    private val broadcastsDao = db.broadcastsDao()
    private val assetsDao = db.assetsDao()

    // ─────────── Observables (Room → UI) ───────────

    fun observeAllRaces(): Flow<List<Race>> =
        racesDao.observeAll().map { rows -> rows.map { it.toModel() } }

    fun observeRaceDaysByRange(from: String, to: String): Flow<List<RaceDay>> =
        raceDaysDao.observeByDateRange(from, to).map { rows ->
            val days = rows.map { it.toModel() }.toMutableList()
            RaceLogic.annotateDoubleSectors(days)
            days
        }

    // ─────────── Lectura directa (no Flow) ───────────

    suspend fun cachedRace(id: String): Race? = racesDao.getById(id)?.toModel()

    suspend fun cachedRacesForYear(year: Int): List<Race> =
        racesDao.getAll().filter { it.year == year }.map { it.toModel() }

    /**
     * Devuelve el ID de la única jornada de una carrera de un día.
     * Busca primero en caché local; si no hay nada, hace una llamada a la API.
     */
    suspend fun oneDayRaceStageId(raceId: String): String? {
        val cached = raceDaysDao.getByRace(raceId).firstOrNull()
        if (cached != null) return cached.id
        return api.raceDaysByRace(raceId).firstOrNull()?.id
    }

    suspend fun cachedRaceDaysByDate(dateKey: String): List<RaceDay> =
        raceDaysDao.getByDate(dateKey).map { it.toModel() }

    /** Devuelve los assets cacheados para la lista de jornadas dada. */
    suspend fun cachedAssetsForRaceDays(raceDayIds: List<String>): List<Asset> {
        if (raceDayIds.isEmpty()) return emptyList()
        return assetsDao.getByRaceDayIds(raceDayIds).map { it.toModel() }
    }

    /**
     * Devuelve los IDs únicos de carreras referenciadas por las jornadas dadas.
     * Usado durante el sync offline para recolectar bandera + logo de cada una.
     */
    suspend fun cachedRaceIdsForRaceDays(raceDayIds: List<String>): Set<String> {
        if (raceDayIds.isEmpty()) return emptySet()
        return raceDaysDao.getByIds(raceDayIds)
            .mapNotNull { it.raceId }
            .toSet()
    }

    suspend fun nextRaceDateAfter(dateKey: String): String? =
        raceDaysDao.nextRaceDateAfter(dateKey)

    /**
     * Ensambla `DayData` (jornadas + emisiones + assets + mapa de carreras)
     * a partir de lo que haya en caché local. Devuelve null si no hay nada.
     */
    suspend fun cachedDayData(dateKey: String): DayData? {
        val days = raceDaysDao.getByDate(dateKey).map { it.toModel() }.toMutableList()
        if (days.isEmpty()) return null

        val raceIds = days.mapNotNull { it.raceId }.distinct()
        val races = racesDao.getAll().filter { it.id in raceIds }.map { it.toModel() }
        val raceMap = races.associateBy { it.id }

        val dayIds = days.map { it.id }
        val broadcasts = broadcastsDao.getByRaceDayIds(dayIds).map { it.toModel() }
        val assets = assetsDao.getByRaceDayIds(dayIds).map { it.toModel() }

        val broadcastsByRd = broadcasts.groupBy { it.raceDayId }
        val assetsByRd = assets.groupBy { it.raceDayId }

        RaceLogic.annotateDoubleSectors(days)

        val enriched = days.map { rd ->
            EnrichedRaceDay(
                raceDay = rd,
                race = rd.raceId?.let { raceMap[it] },
                broadcasts = broadcastsByRd[rd.id].orEmpty(),
                assets = assetsByRd[rd.id].orEmpty(),
            )
        }
        return DayData(raceDays = enriched, raceMap = raceMap)
    }

    // ─────────── Refresh (remoto → Room) ───────────

    /** Descarga y cachea todas las carreras de un año. */
    suspend fun refreshRacesYear(year: Int) {
        val now = clock()
        val fetched = api.racesByYear(year)
        racesDao.upsertAll(fetched.map { RaceEntity.from(it, now) })
    }

    /** Descarga y cachea jornadas de una fecha + sus broadcasts + assets. */
    suspend fun refreshDay(dateKey: String) {
        val now = clock()
        val data = api.loadDayComplete(dateKey)
        raceDaysDao.upsertAll(data.raceDays.map { RaceDayEntity.from(it.raceDay, now) })
        racesDao.upsertAll(data.raceMap.values.map { RaceEntity.from(it, now) })

        val dayIds = data.raceDays.map { it.raceDay.id }
        // Propagar los borrados del backend: quitar de Room las jornadas de esta
        // fecha que ya no vienen (si no, quedarían huérfanas hasta la purga a
        // 21 días o hasta que el usuario borrase los datos a mano).
        raceDaysDao.deleteByDateNotIn(dateKey, dayIds)
        // Borrar datos previos para evitar duplicados si los IDs cambiaron en el backend
        broadcastsDao.deleteByRaceDayIds(dayIds)
        assetsDao.deleteByRaceDayIds(dayIds)

        val allBroadcasts = data.raceDays.flatMap { it.broadcasts }
        val allAssets = data.raceDays.flatMap { it.assets }
            .distinctBy { Pair(it.raceDayId, it.type) }
        broadcastsDao.upsertAll(allBroadcasts.map { BroadcastEntity.from(it, now) })
        assetsDao.upsertAll(allAssets.map { AssetEntity.from(it, now) })

        // Redibujar el widget si la fecha recargada es hoy
        if (dateKey == DateFormatting.todayKey()) {
            runCatching { TodayCyclingWidget().updateAll(appContext) }
                .onFailure { Log.w(TAG, "Error actualizando widget tras refreshDay: ${it.message}") }
        }
    }

    /** Descarga y cachea todas las jornadas de un rango. */
    suspend fun refreshRange(from: String, to: String) {
        val now = clock()
        val days = api.raceDaysInRange(from, to)
        raceDaysDao.upsertAll(days.map { RaceDayEntity.from(it, now) })
        // Propagar los borrados del backend en el rango (ver refreshDay).
        raceDaysDao.deleteByDateRangeNotIn(from, to, days.map { it.id })
    }

    /**
     * Descarga y sustituye la instantánea completa de una carrera. Es el camino
     * de pull-to-refresh en Jornada: vuelve a leer todos los campos de etapas,
     * carrera, emisiones y assets, y propaga inclusiones y eliminaciones.
     */
    suspend fun refreshRaceComplete(raceId: String): Pair<Race, List<EnrichedRaceDay>> {
        val now = clock()
        // Capturamos el conjunto previo antes de consultar para borrar también
        // los hijos de una jornada eliminada en el backend.
        val previousDayIds = raceDaysDao.getByRace(raceId).map { it.id }
        val (race, days) = api.loadRaceComplete(raceId)
        val dayIds = days.map { it.raceDay.id }

        racesDao.upsertAll(listOf(RaceEntity.from(race, now)))
        raceDaysDao.upsertAll(days.map { RaceDayEntity.from(it.raceDay, now) })
        raceDaysDao.deleteByRaceNotIn(raceId, dayIds)

        // Reemplazar las colecciones hijas, no solo actualizarlas: una emisión
        // o un asset eliminado también desaparece de Room y de la UI.
        val affectedDayIds = (previousDayIds + dayIds).distinct()
        broadcastsDao.deleteByRaceDayIds(affectedDayIds)
        assetsDao.deleteByRaceDayIds(affectedDayIds)

        val allBroadcasts = days.flatMap { it.broadcasts }
        val allAssets = days.flatMap { it.assets }
            .distinctBy { Pair(it.raceDayId, it.type) }
        broadcastsDao.upsertAll(allBroadcasts.map { BroadcastEntity.from(it, now) })
        assetsDao.upsertAll(allAssets.map { AssetEntity.from(it, now) })
        return race to days
    }

    // ─────────── Acceso directo al backend ───────────

    /**
     * Resuelve el slug de una carrera (`/competicion/<slug>/` del App Link web)
     * al `id` real. Devuelve null si no existe — el deep-link cae a un fallback
     * en vez de crashear. Espejo de `race(bySlug:)` en iOS.
     */
    suspend fun raceIdForSlug(slug: String): String? =
        try {
            api.raceBySlug(slug).id
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }

    /**
     * Resuelve el slug de una jornada (`/jornada/<slug>/` del App Link web) al
     * `id` real. Devuelve null si no existe. Espejo de `raceDay(bySlug:)` en iOS.
     */
    suspend fun raceDayIdForSlug(slug: String): String? =
        try {
            api.raceDayBySlug(slug).id
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }

    // ─────────── Fichajes (mercado, mig. 122) ───────────

    /**
     * Carga inicial de la pestaña Fichajes: movimientos + temporadas del
     * mercado + fichas hidratadas + nombres de equipos referenciados fuera de
     * team_seasons[market] (orígenes continentales, destinos sin catalogar).
     */
    suspend fun loadTransfersMarket(season: Int): TransfersLogic.MarketData = coroutineScope {
        val transfersDeferred = async { api.riderTransfers(season) }
        val seasonsDeferred = async { api.teamSeasons(season) }
        val prevSeasonsDeferred = async { runCatching { api.teamSeasons(season - 1) }.getOrNull().orEmpty() }
        val transfers = transfersDeferred.await()
        val seasons = seasonsDeferred.await()
        val prevSeasons = prevSeasonsDeferred.await()

        val riderIds = transfers.map { it.riderId }.distinct()
        val ridersById = api.ridersByIds(riderIds).associateBy { it.id }

        val names = HashMap<String, String>()
        seasons.forEach { s -> s.name?.let { names[s.teamId] = it } }
        val namesPrev = HashMap<String, String>()
        prevSeasons.forEach { s -> s.name?.let { namesPrev[s.teamId] = it } }
        // Fila de la temporada previa por equipo → colores "antiguos" para la
        // chapa mientras el kit del mercado no se publica (mig. 129).
        val prevByTeamId = prevSeasons.associateBy { it.teamId }

        // Último recurso: equipos sin fila en NINGUNA de las dos temporadas.
        val missing = transfers
            .flatMap { listOfNotNull(it.fromTeamId, it.toTeamId) }
            .distinct()
            .filterNot { names.containsKey(it) || namesPrev.containsKey(it) }
        if (missing.isNotEmpty()) {
            val missingSet = missing.toSet()
            runCatching { api.teams() }.getOrNull().orEmpty()
                .filter { it.id in missingSet }
                .forEach {
                    names.putIfAbsent(it.id, it.name)
                    namesPrev.putIfAbsent(it.id, it.name)
                }
        }
        TransfersLogic.MarketData(transfers, seasons, ridersById, names, namesPrev, prevByTeamId)
    }

    /** Plantilla 2027 materializada de un equipo (detalle de Fichajes). */
    suspend fun transfersRoster(teamId: String, gender: String?): List<RiderProfile> =
        api.ridersByAffiliation(teamId, TransfersLogic.MARKET_SEASON, gender)

    /**
     * Carga la rejilla del Modo Campeonatos: carreras CN del rango → primera
     * jornada publicada de cada una + emisiones + assets → agrupadas por país y
     * bucketizadas en slots. Va directo a la API (sin Room, como [searchRaceDays]).
     * Espejo de `init()` en `js/campeonatos.js`.
     */
    suspend fun loadChampionships(): List<ChampionshipCountry> {
        val races = api.championshipRaces(
            ChampionshipsConfig.YEAR,
            ChampionshipsConfig.QUERY_START,
            ChampionshipsConfig.QUERY_END,
        )
        if (races.isEmpty()) return emptyList()

        val raceById = races.associateBy { it.id }
        val days = api.raceDaysByRaceIds(races.map { it.id })
        if (days.isEmpty()) return emptyList()

        val dayIds = days.map { it.id }
        val broadcastsByRd = api.broadcastsByRaceDays(dayIds).groupBy { it.raceDayId }
        val assetsByRd = api.assetsByRaceDays(dayIds).groupBy { it.raceDayId }

        // Primera jornada publicada por carrera (menor dateKey).
        val firstDayByRace = mutableMapOf<String, RaceDay>()
        for (rd in days) {
            val raceId = rd.raceId ?: continue
            val cur = firstDayByRace[raceId]
            if (cur == null || rd.dateKey < cur.dateKey) firstDayByRace[raceId] = rd
        }

        // Agrupar por país y bucketizar en slots.
        val byCountry = mutableMapOf<String, MutableMap<ChampionshipsConfig.Slot, EnrichedRaceDay>>()
        for (race in races) {
            val rd = firstDayByRace[race.id] ?: continue
            val cc = race.countryCode?.uppercase().orEmpty()
            if (cc.isEmpty()) continue
            val slot = ChampionshipsConfig.slot(race, rd)
            // Broadcasts en crudo: TVBadge los filtra por región del usuario.
            val enriched = EnrichedRaceDay(
                raceDay = rd,
                race = raceById[race.id],
                broadcasts = broadcastsByRd[rd.id].orEmpty(),
                assets = assetsByRd[rd.id].orEmpty(),
            )
            byCountry.getOrPut(cc) { mutableMapOf() }[slot] = enriched
        }

        // Orden: COUNTRY_ORDER presentes primero, luego el resto por código.
        val present = byCountry.keys
        val ordered = ChampionshipsConfig.COUNTRY_ORDER.filter { it in present } +
            present.filterNot { it in ChampionshipsConfig.COUNTRY_ORDER }.sorted()

        return ordered.mapNotNull { cc ->
            val slots = byCountry[cc] ?: return@mapNotNull null
            // Sede de la prueba élite masculina de ruta (linea_masc): META si la
            // tiene (más representativa de la sede), si no la SALIDA.
            val hostCity = slots[ChampionshipsConfig.Slot.LINEA_MASC]?.raceDay?.championshipVenue
            ChampionshipCountry(countryCode = cc, hostCity = hostCity, slots = slots)
        }
    }

    suspend fun nextDateWithRaces(after: String): String? =
        api.nextDateWithRaces(after)

    suspend fun startlistTeams(raceId: String) = api.startlistTeams(raceId)
    suspend fun startlistRiders(raceId: String) = api.startlistRiders(raceId)

    suspend fun loadStartlistData(raceId: String): StartlistData {
        val race = api.raceById(raceId)
        // Orden de equipos por el dorsal del primer corredor (no por el
        // sortOrder de BD, que es el orden de inserción del panel) — espejo
        // de js/inscritos.js e iOS.
        val riders = api.startlistRiders(raceId)
        val teams = StartlistLogic.teamsByFirstDorsal(api.startlistTeams(raceId), riders)
        // Render temporal: globalTeams con los atributos visuales del año de la carrera
        // (team_seasons). Fallback a `teams` por equipo sin season → nunca pierde chapa.
        // 2026 == teams. La UI no cambia: recibe globalTeams ya fusionados.
        val globalTeams = if (race.enrichedStartlist == true) {
            val base = api.teams()
            val year = race.year
            if (year != null) {
                val seasonByTeamId = api.teamSeasons(year).associateBy { it.teamId }
                base.map { it.applySeason(seasonByTeamId[it.id]) }
            } else base
        } else emptyList()

        // Tachado de abandonos: si la carrera tiene resultados in-house, marcar a
        // los corredores fuera de carrera (irm en su etapa MÁS RECIENTE). Port de
        // js/inscritos.js. Cualquier fallo de red → comportamiento clásico.
        val ridersOut = runCatching { loadRiderOuts(raceId) }
            .getOrDefault(emptyMap())

        return StartlistData(
            race, teams, riders, globalTeams, ridersOut,
        )
    }

    /**
     * Mapa globalRiderId → fuera-de-carrera, con la etapa MÁS RECIENTE de cada
     * corredor (mayor stageNumber). Señal = `irm` de ABANDONO REAL (DNF/DNS/OTL/DSQ/
     * ABD vía `isAbandonIrm`) en una clasificación de ETAPA (`classKind='stage'`, NO
     * la "Stage General" que es el GC del día). Un código de ruido como 'LAP' (doblada)
     * NO tacha — la UCI lo cuelga a veces de corredores en carrera, incluida la propia
     * ganadora (ver UciResultsLogic). Port de inscritos.js L228–256.
     */
    private suspend fun loadRiderOuts(raceId: String): Map<String, RiderOut> {
        val stages = api.raceUciStages(raceId)
            .filter { it.classKind == "stage" && it.rowCount > 0 }
        if (stages.isEmpty()) return emptyMap()

        val stageNumById = stages.associate { it.id to it.stageNumber }
        val rows = api.raceUciResultsForStages(stages.map { it.id })
            .filter { !it.globalRiderId.isNullOrEmpty() && UciResultsLogic.isAbandonIrm(it.irm) }

        val out = HashMap<String, RiderOut>()
        for (row in rows) {
            val gid = row.globalRiderId ?: continue
            val sn = stageNumById[row.stageRef]
            val prev = out[gid]
            // Quedarse con la etapa más reciente (mayor stageNumber; null = -1).
            val snVal = sn ?: -1
            val prevVal = prev?.stageNumber ?: -2
            if (prev == null || snVal >= prevVal) {
                out[gid] = RiderOut(irm = row.irm!!, stageNumber = sn)
            }
        }
        return out
    }

    // ─────────── Start Order ───────────

    suspend fun loadStartOrderData(raceDayId: String): StartOrderData? {
        val rd = api.startOrderRaceDay(raceDayId) ?: return null
        val race = rd.raceId?.let { runCatching { api.raceById(it) }.getOrNull() }
        // RaceDay canónico para reusar StageInfoHeaderCard (paridad con perfil).
        val fullRaceDay = runCatching { api.raceDaysByIds(listOf(raceDayId)).firstOrNull() }.getOrNull()
        val entries = api.startOrderEntries(raceDayId)
        return StartOrderData(
            raceDay = rd,
            fullRaceDay = fullRaceDay,
            race = race,
            entries = entries,
        )
    }

    // ─────────── Resultados UCI in-house ───────────

    /**
     * Reconstruye el corredor por dorsal contra la startlist curada (idéntico a
     * `js/resultados.js`): `bib → dorsal → nombre/bandera/equipo`. Devuelve
     * también los equipos CANÓNICOS de la startlist (`raceTeams`), que la
     * pestaña Equipos casa por nombre (sus filas no llevan dorsal).
     *
     * OJO: `startlist_riders.teamId` apunta al **PK** de `startlist_teams`, NO a
     * su columna `teamId` (la ref canónica a `teams`). La chapa del equipo sale
     * de ese teamId canónico.
     */
    private suspend fun buildByDorsal(raceId: String): Pair<Map<Int, ResolvedRider>, List<Team>> {
        val slRiders = api.startlistRidersResolvedFull(raceId)
        val slTeams = api.startlistTeams(raceId)
        val slTeamByPk = slTeams.associateBy { it.id }                 // PK → fila
        val canonIds = slTeams.mapNotNull { it.teamId }.toSet()
        val allTeams = if (canonIds.isNotEmpty()) api.teams() else emptyList()
        val teamById = allTeams.filter { it.id in canonIds }.associateBy { it.id }

        val out = HashMap<Int, ResolvedRider>(slRiders.size)
        for (r in slRiders) {
            val dorsal = r.dorsal ?: continue
            val slTeam = r.teamId?.let { slTeamByPk[it] }
            val canon = slTeam?.teamId?.let { teamById[it] }
            // Ficticio "Individual" → ocultación cosmética: sin nombre de equipo,
            // y en cascada sin chapa ni opción en el filtro por equipo.
            val slName = slTeam?.takeUnless { it.isIndividualPlaceholder }?.teamName.orEmpty()
            out[dorsal] = ResolvedRider(
                name = "${r.firstName.orEmpty()} ${r.lastName.orEmpty()}".trim(),
                countryCode = r.countryCode.orEmpty(),
                // Equipo casado → nombre canónico; sin casar → el crudo de la startlist.
                teamName = canon?.name ?: slName,
                team = canon,
                globalRiderId = r.globalRiderId,
            )
        }
        return out to teamById.values.toList()
    }

    /**
     * Resuelve un conjunto de `globalRiderId` a [ResolvedRider] directamente
     * desde riders_men/women + su equipo ACTUAL (currentTeamId) — el fallback
     * para las filas de resultados que NO casan por dorsal con la startlist
     * (campeonatos nacionales y demás volcados in-house sin inscritos curados).
     * Espejo de `enrichRiders` en `js/resultados.js`: bandera (nationality) y
     * equipo actual (nombre + chapa). Silencioso: si una query falla, esos ids
     * no entran en el mapa (la fila se renderiza sin bandera/chapa, como antes).
     */
    suspend fun enrichRidersByGlobalId(ids: List<String>): Map<String, ResolvedRider> {
        val need = ids.filter { it.isNotEmpty() }.distinct()
        if (need.isEmpty()) return emptyMap()
        val riders = runCatching { api.ridersByIds(need) }.getOrNull().orEmpty()
        if (riders.isEmpty()) return emptyMap()

        // Equipos ACTUALES (currentTeamId → teams): nombre + chapa para el badge.
        // Una query por los equipos referidos.
        val curIds = riders.mapNotNull { it.currentTeamId }.distinct()
        val teamById = if (curIds.isNotEmpty()) {
            runCatching { api.teams() }.getOrNull().orEmpty()
                .filter { it.id in curIds }.associateBy { it.id }
        } else emptyMap()

        return riders.associate { r ->
            val team = r.currentTeamId?.let { teamById[it] }
            r.id to ResolvedRider(
                name = r.fullName,
                countryCode = r.nationality.orEmpty(),
                teamName = team?.name.orEmpty(),
                team = team,
                globalRiderId = r.id,
            )
        }
    }

    /**
     * Override MANUAL de equipo (mig. 112): resuelve los `teamId` de override de
     * las filas de resultados a su equipo canónico (nombre + chapa). Espejo de
     * `enrichOverrideTeams` en `js/resultados.js`. Silencioso: ids sin equipo
     * simplemente no entran en el mapa (la fila cae a la resolución por dorsal).
     */
    suspend fun enrichTeamsByIds(ids: List<String>): Map<String, Team> {
        val need = ids.filter { it.isNotEmpty() }.distinct()
        if (need.isEmpty()) return emptyMap()
        return runCatching { api.teams() }.getOrNull().orEmpty()
            .filter { it.id in need }.associateBy { it.id }
    }

    /** Carga inicial de la pantalla de resultados. null si la carrera no tiene
     *  clasificaciones keepForWeb (→ estado Empty). */
    suspend fun loadResultsData(raceId: String): UciResultsData? {
        val rawStages = api.raceUciStages(raceId)
        // Las jornadas se cargan SIEMPRE: una etapa CANCELADA no tiene
        // clasificaciones propias y su pantalla se sintetiza a partir de ellas
        // (aviso + generales de la etapa anterior). La señal `isCancelledDay`
        // vive en race_days, no en race_uci_stages. Espejo de js/resultados.js.
        val allDays = runCatching { api.raceDaysByRace(raceId) }.getOrNull().orEmpty()
        val stageDays = allDays.map {
            UciResultsLogic.StageDay(
                id = it.id,
                stageNumber = it.stageNumber,
                dateKey = it.dateKey,
                isCancelledDay = it.isCancelledDay,
                isRestDay = it.isRestDay,
                neutralStartTimeUtc = it.neutralStartTimeUtc,
            )
        }
        // Dobles sectores (3A/3B): mapa raceDayId → sufijo + stageNumbers sectorizados.
        val (sectorSuffixByRaceDayId, sectoredStageNumbers) = UciResultsLogic.sectorSuffixMap(stageDays)
        val stages = UciResultsLogic.applyCancelledStages(rawStages, stageDays, raceId = raceId)
        // Sin clasificaciones NI etapa cancelada que sintetizar → estado Empty.
        if (stages.isEmpty()) return null
        val race = api.raceById(raceId)
        val (byDorsal, raceTeams) = buildByDorsal(raceId)

        // Índices de jornadas (de `allDays`, que YA traen countryCode/ruta/…) para
        // resolver el header sin más red: por raceDayId y —si el volcado no lo
        // trajo (race_uci_stages.raceDayId NULL)— por stageNumber. Sin el segundo,
        // la cabecera cae al país de la CARRERA e ignora el override por jornada.
        val daysById = allDays.associateBy { it.id }
        val daysByStage = allDays.filter { it.stageNumber != null }.associateBy { it.stageNumber!! }
        fun rdForStage(st: RaceUciStage): RaceDay? =
            st.raceDayId?.let { daysById[it] } ?: st.stageNumber?.let { daysByStage[it] }

        // RaceDay por defecto = el de la última etapa con datos (mayor stageNumber).
        val defaultStage = stages.maxByOrNull { it.stageNumber ?: Int.MIN_VALUE }
        var raceDay = defaultStage?.let { rdForStage(it) }
        // Carreras de un día / general final: la "Final Classification" no trae
        // raceDayId ni stageNumber. Si la carrera tiene UNA sola jornada, la
        // usamos para el header (ruta + distancia + tipo), igual que la web.
        if (raceDay == null && allDays.size == 1) raceDay = allDays.first()
        return UciResultsData(
            race = race, stages = stages, byDorsal = byDorsal,
            raceTeams = raceTeams, raceDay = raceDay, raceDays = allDays,
            sectorSuffixByRaceDayId = sectorSuffixByRaceDayId,
            sectoredStageNumbers = sectoredStageNumbers,
        )
    }

    /** Filas de una clasificación concreta (on-demand, al cambiar de pestaña). */
    suspend fun loadResultRows(stageRef: String): List<RaceUciResultRow> =
        api.raceUciResults(stageRef)

    /**
     * ¿Tiene esta jornada resultados in-house? Devuelve un `Pair(true, stageNumber)`
     * con el `stageNumber` al que navegar, o `Pair(false, null)` si no hay.
     * Consulta de red ligera y NO bloqueante (el CTA de la jornada aparece de
     * forma diferida; sin red simplemente no se muestra, como en la web).
     *
     * OJO carreras de un día: su clasificación es la "Final Classification"
     * (`classKind='gc'`) con `stageNumber=null` Y `raceDayId=null` → NO se puede
     * exigir `classKind='stage'` ni `raceDayId!=null`. El gate es "hay una stage
     * keepForWeb con filas que corresponde a esta jornada".
     */
    suspend fun resultsStageNumberForDay(raceId: String, raceDayId: String, stageNumber: Int?): Pair<Boolean, Int?> {
        val stages = (runCatching { api.raceUciStages(raceId) }.getOrNull() ?: emptyList())
            .filter { it.rowCount > 0 }
        // Correspondencia con la jornada: por raceDayId directo, o —si la stage no
        // lo trae (un día / final)— por igualdad de stageNumber (null==null en un día).
        val match = stages.firstOrNull { it.raceDayId == raceDayId }
            ?: stages.firstOrNull { it.raceDayId == null && it.stageNumber == stageNumber }
            ?: return false to null
        return true to match.stageNumber
    }

    /**
     * Resuelve, para un conjunto de jornadas de UNA carrera, cuáles tienen
     * resultados in-house y a qué stageNumber navega su trofeo. Una sola query.
     * `days` = (raceDayId, stageNumber de la jornada). Devuelve raceDayId →
     * stageNumber al que navegar (presencia en el mapa = tiene in-house).
     *
     * Maneja el caso de un día / general: la stage sin raceDayId se asigna a la
     * jornada cuyo `stageNumber` coincide (null==null para carreras de un día).
     * Lo usan Hoy y competición para redirigir el trofeo a la pantalla nativa.
     *
     * Una jornada CANCELADA nunca entra en el mapa: sus clasificaciones son
     * irrelevantes (no se corrió), así que la card no debe ofrecer el trofeo
     * aunque el cron llegara a volcar filas antes de la cancelación. El CTA de
     * su FICHA es otra cosa y se conserva (ver `hasInhouseResults` en
     * StageScreen): allí la página explica la cancelación y arrastra las
     * generales de la etapa anterior.
     */
    suspend fun inhouseStagesForDays(
        raceId: String,
        days: List<Pair<String, Int?>>,
        cancelledDayIds: Set<String> = emptySet(),
    ): Map<String, Int?> {
        if (days.isEmpty()) return emptyMap()
        val stages = (runCatching { api.raceUciStages(raceId) }.getOrNull() ?: emptyList())
            .filter { it.rowCount > 0 }
        if (stages.isEmpty()) return emptyMap()
        val byDayId = stages.filter { it.raceDayId != null }.associate { it.raceDayId!! to it.stageNumber }
        val orphans = stages.filter { it.raceDayId == null }   // un día / final
        val out = HashMap<String, Int?>()
        for ((dayId, stageNumber) in days) {
            if (dayId in cancelledDayIds) continue
            when {
                byDayId.containsKey(dayId) -> out[dayId] = byDayId[dayId]
                else -> orphans.firstOrNull { it.stageNumber == stageNumber }?.let { out[dayId] = it.stageNumber }
            }
        }
        return out
    }

    /**
     * Conjunto de claves `raceId#stageNumber` (o `raceId#final` si stageNumber es
     * null) con clasificaciones in-house (keepForWeb + rowCount>0) para un LOTE de
     * carreras, en UNA query. Espejo de `loadInhouseStageSet(raceIds)` web. Lo usa
     * la rejilla de Campeonatos para llevar el trofeo a la pantalla nativa de
     * resultados cuando los hay. Fail-silent: sin red → conjunto vacío.
     */
    suspend fun inhouseStageKeys(raceIds: List<String>): Set<String> {
        val ids = raceIds.filter { it.isNotEmpty() }.distinct()
        if (ids.isEmpty()) return emptySet()
        val stages = runCatching { api.raceUciStagesByRaceIds(ids) }.getOrNull().orEmpty()
            .filter { it.rowCount > 0 }
        return stages.map { "${it.raceId}#${it.stageNumber?.toString() ?: "final"}" }.toSet()
    }

    /** Clave de una jornada para consultar [inhouseStageKeys] (mismo formato). */
    fun inhouseKey(raceId: String, stageNumber: Int?): String =
        "$raceId#${stageNumber?.toString() ?: "final"}"

    /** RaceDay canónico de una etapa (para refrescar el header al cambiar de
     *  etapa en la pantalla de resultados). */
    suspend fun raceDayById(raceDayId: String): RaceDay? =
        runCatching { api.raceDaysByIds(listOf(raceDayId)).firstOrNull() }.getOrNull()

    // ─────────── Feed de resultados (pestaña Resultados, apps 3.1) ───────────

    /**
     * Carga una ventana del feed "Últimos resultados": clasificaciones in-house
     * + jornadas publicadas + carreras implicadas, y construye las entradas con
     * la lógica pura (`ResultsFeedLogic.buildEntries`). Solo-online, como
     * inscritos/orden de salida/resultados. El ganador con nombre canónico se
     * resuelve aparte (`resolveFeedWinners`).
     */
    suspend fun loadResultsFeedWindow(fromKey: String, toKey: String): List<ResultsFeedLogic.FeedEntry> =
        coroutineScope {
            val stagesDeferred = async { api.raceUciStagesFeed(fromKey, toKey) }
            val daysDeferred = async { api.raceDaysFeedWindow(fromKey, toKey) }
            val stages = stagesDeferred.await()
            val raceDays = daysDeferred.await()
            val raceIds = (stages.map { it.raceId } + raceDays.mapNotNull { it.raceId }).distinct()
            val races = if (raceIds.isEmpty()) emptyList() else api.racesByIds(raceIds)
            ResultsFeedLogic.buildEntries(stages, raceDays, races, fromKey, toKey)
        }

    /** Instantánea actual del ránking UCI de equipos (solo online, sin Room). */
    suspend fun loadUciTeamRankings() = api.uciTeamRankings()

    /**
     * Refina el ganador de cada entrada in-house — espejo del bloque de
     * ganadores de `fetchEntries` en resultados-feed.js:
     *  · filas rank=1 de los stageRef (descartando irm de abandono);
     *  · EXACTAMENTE 1 globalRiderId distinto → nombre canónico "First Last"
     *    desde riders_men/riders_women;
     *  · CRE (jornada 'ttt' o varios rank 1) → el ganador es el EQUIPO, resuelto
     *    vía startlist (corredor rank 1 → startlist_riders_resolved.teamId, que
     *    es el PK de startlist_teams → teams.name canónico; fallback teamName).
     * Si nada resuelve, se conserva el winnerName crudo de la fuente.
     */
    suspend fun resolveFeedWinners(entries: List<ResultsFeedLogic.FeedEntry>): List<ResultsFeedLogic.FeedEntry> {
        val refIds = entries
            .filter { it.kind == ResultsFeedLogic.Kind.INHOUSE }
            .mapNotNull { it.stageRefId }
        if (refIds.isEmpty()) return entries

        val rank1Rows = runCatching { api.raceUciRank1(refIds) }.getOrNull() ?: return entries
        val byRef = ResultsFeedLogic.winnerRiderIdsByStageRef(rank1Rows)

        val singleRiderIds = byRef.values.filter { it.size == 1 }.map { it.first() }.distinct()
        val nameById = if (singleRiderIds.isEmpty()) emptyMap() else {
            runCatching { api.riderNamesByIds(singleRiderIds) }.getOrNull().orEmpty()
        }

        // 1) Nombre canónico cuando hay UN único rank 1 con ficha.
        val resolved = entries.map { e ->
            if (e.kind != ResultsFeedLogic.Kind.INHOUSE || e.stageRefId == null) return@map e
            val ids = byRef[e.stageRefId] ?: return@map e
            if (ids.size == 1) {
                nameById[ids.first()]?.let { return@map e.copy(winner = it) }
            }
            e
        }.toMutableList()

        // 2) CRE: el ganador es el EQUIPO, no un corredor.
        for (i in resolved.indices) {
            val e = resolved[i]
            if (e.kind != ResultsFeedLogic.Kind.INHOUSE || e.stageRefId == null) continue
            val ids = byRef[e.stageRefId].orEmpty()
            if (!ResultsFeedLogic.isCreEntry(e, ids) || ids.isEmpty()) continue
            runCatching {
                val pks = api.startlistRiderTeamPks(e.race.id, ids.take(3)).distinct()
                if (pks.size != 1) return@runCatching
                val slTeam = api.startlistTeamByPk(pks.first()) ?: return@runCatching
                var teamWinner = slTeam.teamName
                slTeam.teamId?.let { canonId ->
                    api.teamNameById(canonId)?.let { teamWinner = it }
                }
                if (teamWinner.isNotEmpty()) resolved[i] = e.copy(winner = teamWinner)
            } // si falla, se queda el ganador que hubiera (como la web)
        }
        return resolved
    }

    // ─────────── Today Highlights ───────────

    suspend fun todayHighlights() = api.todayHighlights()
    suspend fun raceDaysByIds(ids: List<String>) = api.raceDaysByIds(ids)
    suspend fun racesByIds(ids: List<String>): List<Race> {
        if (ids.isEmpty()) return emptyList()
        return ids.mapNotNull { id ->
            runCatching { api.raceById(id) }.getOrNull()
        }
    }

    // ─────────── Purga ───────────

    /** Borra filas cuya `cachedAt` sea anterior a [olderThan] (epoch seconds). */
    suspend fun purgeStale(olderThan: Long) {
        raceDaysDao.deleteStale(olderThan)
        broadcastsDao.deleteStale(olderThan)
        assetsDao.deleteStale(olderThan)
        racesDao.deleteOlderThan(olderThan)
    }

    /** Borra todo (opción "borrar datos" en ajustes). */
    suspend fun clearAll() {
        assetsDao.clear()
        broadcastsDao.clear()
        raceDaysDao.clear()
        racesDao.clear()
    }

    companion object {
        private const val TAG = "CalendarRepository"
    }
}
