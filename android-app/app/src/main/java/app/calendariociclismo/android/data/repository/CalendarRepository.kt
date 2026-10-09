package app.calendariociclismo.android.data.repository

import android.content.Context
import android.util.Log
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
import app.calendariociclismo.android.data.model.UciRank1Row
import app.calendariociclismo.android.data.model.applySeason
import app.calendariociclismo.android.data.model.asTeam
import app.calendariociclismo.android.data.remote.SupabaseService
import app.calendariociclismo.android.util.CachedRacePolicy
import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.InhouseStageMap
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.ResultsFeedLogic
import app.calendariociclismo.android.util.StartlistLogic
import app.calendariociclismo.android.util.TransfersLogic
import app.calendariociclismo.android.util.UciResultsLogic
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
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
    private val ledger = RefreshLedger(clock)

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
        racesDao.getByYear(year).map { it.toModel() }

    /**
     * Devuelve el ID de la única jornada de una carrera de un día.
     * Busca primero en caché local; si no hay nada, hace una llamada a la API.
     */
    suspend fun oneDayRaceStageId(raceId: String): String? {
        val cached = raceDaysDao.getByRace(raceId).firstOrNull()
        if (cached != null) return cached.id
        return api.raceDayIdsByRace(raceId).firstOrNull()
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

    /**
     * Descarga y cachea todas las carreras de un año. Sin [force] se omite si
     * la última descarga COMPLETA del año en este proceso tiene menos de una
     * hora (misma ventana que iOS). Tras un arranque en frío vuelve a la red:
     * Room no distingue el año completo de los subconjuntos que guardan Mes,
     * Hoy o Carrera.
     */
    suspend fun refreshRacesYear(year: Int, force: Boolean = false) {
        val key = RefreshLedger.racesYearKey(year)
        if (!force && ledger.isFresh(key, RACES_YEAR_TTL_SECONDS)) return
        val now = clock()
        val fetched = api.racesByYear(year)
        racesDao.upsertAll(fetched.map { RaceEntity.from(it, now) })
        ledger.mark(key)
    }

    /**
     * Descarga y cachea únicamente las jornadas y carreras de un mes. Sin
     * [force] se omite si el mes se descargó hace menos de diez minutos.
     */
    suspend fun refreshMonth(from: String, to: String, force: Boolean = false) {
        val key = RefreshLedger.monthKey(from, to)
        if (!force && ledger.isFresh(key, MONTH_TTL_SECONDS)) return
        val now = clock()
        val (days, races) = api.calendarMonthData(from, to)
        val previous = raceDaysDao.getByDateRange(from, to).associateBy { it.id }
        raceDaysDao.upsertAll(days.map { RaceDayEntity.fromSlim(it, now, previous[it.id]) })
        raceDaysDao.deleteByDateRangeNotIn(from, to, days.map { it.id })
        racesDao.upsertAll(races.map { RaceEntity.from(it, now) })
        ledger.mark(key)
    }

    /**
     * Descarga y cachea jornadas de una fecha + sus broadcasts + assets.
     * Devuelve la descarga, que incluye la selección destacada del día.
     */
    suspend fun refreshDay(dateKey: String): DayData {
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
        ledger.mark(RefreshLedger.dayKey(dateKey))
        return data
    }

    /**
     * Como [refreshDay], pero omite la red si el día se descargó completo hace
     * menos de [ttlSeconds] en este proceso. Devuelve `true` si descargó.
     */
    suspend fun refreshDayIfStale(dateKey: String, ttlSeconds: Long): Boolean {
        if (ledger.isFresh(RefreshLedger.dayKey(dateKey), ttlSeconds)) return false
        refreshDay(dateKey)
        return true
    }

    /** Descarga y cachea todas las jornadas de un rango. */
    suspend fun refreshRange(from: String, to: String) {
        val now = clock()
        val days = api.raceDaysInRange(from, to)
        val previous = raceDaysDao.getByDateRange(from, to).associateBy { it.id }
        raceDaysDao.upsertAll(days.map { RaceDayEntity.fromSlim(it, now, previous[it.id]) })
        // Propagar los borrados del backend en el rango (ver refreshDay).
        raceDaysDao.deleteByDateRangeNotIn(from, to, days.map { it.id })
    }

    /**
     * Descarga y sustituye la instantánea completa de una carrera. Es el camino
     * de pull-to-refresh en Jornada: vuelve a leer todos los campos de etapas,
     * carrera, emisiones y assets, y propaga inclusiones y eliminaciones.
     *
     * Con [profileDayIds] solo esas jornadas descargan el perfil de elevación;
     * las demás conservan en Room el perfil guardado de una descarga anterior.
     */
    suspend fun refreshRaceComplete(
        raceId: String,
        profileDayIds: Set<String>? = null,
    ): Pair<Race, List<EnrichedRaceDay>> {
        val now = clock()
        // Capturamos el conjunto previo antes de consultar para borrar también
        // los hijos de una jornada eliminada en el backend.
        val previousDays = raceDaysDao.getByRace(raceId).associateBy { it.id }
        val snapshot = api.loadRaceComplete(raceId, profileDayIds)
        val race = snapshot.race
        val days = snapshot.days
        val dayIds = days.map { it.raceDay.id }

        val entities = days.map { day ->
            RaceDayEntity.fromSnapshot(day.raceDay, now, previousDays[day.raceDay.id], snapshot.profileDayIds)
        }
        racesDao.upsertAll(listOf(RaceEntity.from(race, now)))
        raceDaysDao.upsertAll(entities)
        raceDaysDao.deleteByRaceNotIn(raceId, dayIds)

        // Reemplazar las colecciones hijas, no solo actualizarlas: una emisión
        // o un asset eliminado también desaparece de Room y de la UI.
        val affectedDayIds = (previousDays.keys + dayIds).distinct()
        broadcastsDao.deleteByRaceDayIds(affectedDayIds)
        assetsDao.deleteByRaceDayIds(affectedDayIds)

        val allBroadcasts = days.flatMap { it.broadcasts }
        val allAssets = days.flatMap { it.assets }
            .distinctBy { Pair(it.raceDayId, it.type) }
        broadcastsDao.upsertAll(allBroadcasts.map { BroadcastEntity.from(it, now) })
        assetsDao.upsertAll(allAssets.map { AssetEntity.from(it, now) })
        // Solo una instantánea con todos los perfiles cuenta como completa para
        // la apertura inmediata de Carrera.
        if (snapshot.profileDayIds == null) ledger.mark(RefreshLedger.raceKey(raceId))
        // Las jornadas sin perfil descargado devuelven el que conserva Room.
        return race to days.mapIndexed { index, day ->
            if (snapshot.profileDayIds == null || day.raceDay.id in snapshot.profileDayIds) day
            else day.copy(raceDay = entities[index].toModel().also { it.stageSuffix = day.raceDay.stageSuffix })
        }
    }

    /** `true` si la instantánea completa de la carrera se descargó hace menos de [ttlSeconds]. */
    fun raceSnapshotIsFresh(raceId: String, ttlSeconds: Long = RACE_SNAPSHOT_TTL_SECONDS): Boolean =
        ledger.isFresh(RefreshLedger.raceKey(raceId), ttlSeconds)

    /**
     * Instantánea de una carrera desde Room, en el mismo orden que
     * [refreshRaceComplete]. Devuelve null si la caché no basta para pintar la
     * pantalla de Carrera sin saltos: falta la carrera, alguna fecha de su
     * calendario o el perfil de alguna etapa.
     */
    suspend fun cachedRaceComplete(raceId: String): Pair<Race, List<EnrichedRaceDay>>? {
        val race = racesDao.getById(raceId)?.toModel() ?: return null
        val days = raceDaysDao.getByRace(raceId).map { it.toModel() }
            .filter { it.isPublished }
            .toMutableList()
        val fullSnapshotThisSession = ledger.isFresh(RefreshLedger.raceKey(raceId), RACE_SESSION_TTL_SECONDS)
        if (!fullSnapshotThisSession && !CachedRacePolicy.isPresentable(race, days)) return null
        days.sortWith(RaceLogic.raceProgramOrder)
        RaceLogic.annotateDoubleSectors(days)
        val dayIds = days.map { it.id }
        val broadcastsByRd = broadcastsDao.getByRaceDayIds(dayIds).map { it.toModel() }
            .sortedBy { it.sortOrder }
            .groupBy { it.raceDayId }
        val assetsByRd = assetsDao.getByRaceDayIds(dayIds).map { it.toModel() }.groupBy { it.raceDayId }
        return race to days.map { rd ->
            EnrichedRaceDay(
                raceDay = rd,
                race = race,
                broadcasts = broadcastsByRd[rd.id].orEmpty(),
                assets = assetsByRd[rd.id].orEmpty(),
            )
        }
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
            runCatching { api.teamsByIds(missing) }.getOrNull().orEmpty()
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
        val days = api.raceDaysByRaceIdsSlim(races.map { it.id })
        if (days.isEmpty()) return emptyList()

        val dayIds = days.map { it.id }
        val (broadcastsByRd, assetsByRd) = coroutineScope {
            val broadcasts = async { api.broadcastsByRaceDays(dayIds).groupBy { it.raceDayId } }
            val assets = async { api.assetsByRaceDays(dayIds).groupBy { it.raceDayId } }
            broadcasts.await() to assets.await()
        }

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

    suspend fun loadStartlistData(raceId: String): StartlistData = coroutineScope {
        val raceDeferred = async { api.raceById(raceId) }
        val ridersDeferred = async { api.startlistRiders(raceId) }
        val slTeamsDeferred = async { api.startlistTeams(raceId) }
        // Tachado de abandonos: si la carrera tiene resultados in-house, marcar a
        // los corredores fuera de carrera (irm en su etapa MÁS RECIENTE). Port de
        // js/inscritos.js. Cualquier fallo de red → comportamiento clásico.
        val ridersOutDeferred = async {
            try {
                loadRiderOuts(raceId)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                emptyMap()
            }
        }
        val race = raceDeferred.await()
        // Orden de equipos por el dorsal del primer corredor (no por el
        // sortOrder de BD, que es el orden de inserción del panel) — espejo
        // de js/inscritos.js e iOS.
        val riders = ridersDeferred.await()
        val teams = StartlistLogic.teamsByFirstDorsal(slTeamsDeferred.await(), riders)
        // Render temporal: globalTeams con los atributos visuales del año de la carrera
        // (team_seasons). Fallback a `teams` por equipo sin season → nunca pierde chapa.
        // 2026 == teams. La UI no cambia: recibe globalTeams ya fusionados.
        val teamIds = teams.mapNotNull { it.teamId }.distinct()
        val base = async { api.teamsByIds(teamIds) }
        val year = race.year
        val seasons = async {
            if (year != null) api.teamSeasonsByIds(year, teamIds).associateBy { it.teamId } else emptyMap()
        }
        val baseById = base.await().associateBy { it.id }
        val seasonByTeamId = seasons.await()
        val globalTeams = teamIds.mapNotNull { id ->
            baseById[id]?.applySeason(seasonByTeamId[id]) ?: seasonByTeamId[id]?.asTeam()
        }

        StartlistData(
            race, teams, riders, globalTeams, ridersOutDeferred.await(),
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
        val stages = api.inhouseStagesByRaceIds(listOf(raceId))
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

    suspend fun loadStartOrderData(raceDayId: String): StartOrderData? = coroutineScope {
        val entriesDeferred = async { api.startOrderEntries(raceDayId) }
        // Una sola lectura de la jornada: DTO del orden de salida + RaceDay
        // canónico para reusar StageInfoHeaderCard (paridad con perfil).
        val (rd, fullRaceDay) = api.startOrderRaceDayWithFull(raceDayId) ?: run {
            entriesDeferred.cancel()
            return@coroutineScope null
        }
        val raceId = rd.raceId
        val raceDeferred = async { raceId?.let { runCatching { api.raceById(it) }.getOrNull() } }
        // Los equipos que pueden aparecer son los de la startlist de la carrera.
        // Sin startlist, o con algún equipo de la startlist sin ficha canónica
        // (teamId null), se recurre al catálogo completo para casar por nombre.
        // null = usar el catálogo.
        val canonIdsDeferred = async {
            val slTeams = raceId?.let { id ->
                runCatching { api.startlistTeams(id) }.getOrDefault(emptyList())
            }.orEmpty()
            if (slTeams.isEmpty() || slTeams.any { it.teamId == null }) null
            else slTeams.mapNotNull { it.teamId }.distinct()
        }
        val race = raceDeferred.await()
        val teams = race?.year?.let { year ->
            val canonIds = canonIdsDeferred.await()
            val base = async {
                runCatching { if (canonIds == null) api.teamsCatalog() else api.teamsByIds(canonIds) }
                    .getOrDefault(emptyList())
            }
            val seasons = async {
                runCatching {
                    if (canonIds == null) api.teamSeasons(year) else api.teamSeasonsByIds(year, canonIds)
                }.getOrDefault(emptyList()).associateBy { it.teamId }
            }
            val baseById = base.await().associateBy { it.id }
            val seasonById = seasons.await()
            (baseById.keys + seasonById.keys).mapNotNull { id ->
                baseById[id]?.applySeason(seasonById[id]) ?: seasonById[id]?.asTeam()
            }
        }.orEmpty()
        canonIdsDeferred.cancel()
        StartOrderData(
            raceDay = rd,
            fullRaceDay = fullRaceDay,
            race = race,
            entries = entriesDeferred.await(),
            teams = teams,
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
    private suspend fun buildByDorsal(raceId: String, year: Int?): Pair<Map<Int, ResolvedRider>, List<Team>> {
        val (slRiders, slTeams) = coroutineScope {
            val riders = async { api.startlistRidersResolvedFull(raceId) }
            val teams = async { api.startlistTeams(raceId) }
            riders.await() to teams.await()
        }
        val slTeamByPk = slTeams.associateBy { it.id }                 // PK → fila
        val canonIds = slTeams.mapNotNull { it.teamId }.toSet()
        val (baseTeams, seasons) = coroutineScope {
            val base = async { api.teamsByIds(canonIds.toList()) }
            val seasons = async {
                year?.let { runCatching { api.teamSeasonsByIds(it, canonIds.toList()) }.getOrNull() }.orEmpty()
            }
            base.await() to seasons.await()
        }
        val seasonByTeam = seasons.associateBy { it.teamId }
        val baseById = baseTeams.associateBy { it.id }
        val teamById = canonIds.mapNotNull { id ->
            (baseById[id]?.applySeason(seasonByTeam[id]) ?: seasonByTeam[id]?.asTeam())
                ?.let { id to it }
        }.toMap()

        val out = HashMap<Int, ResolvedRider>(slRiders.size)
        for (r in slRiders) {
            val dorsal = r.dorsal ?: continue
            val slTeam = r.teamId?.let { slTeamByPk[it] }
            val canon = slTeam?.teamId?.let { teamById[it] }
            // Estado sin equipo → ocultación cosmética: sin nombre de equipo,
            // y en cascada sin chapa ni opción en el filtro por equipo.
            val slName = slTeam?.takeUnless { it.isNoTeamPlaceholder }?.teamName.orEmpty()
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
     * desde riders_men/women. La ficha aporta nombre y nacionalidad; el equipo
     * actual solo se incluye cuando el llamador confirma que consulta el año vigente.
     * Silencioso: si una query falla, esos ids
     * no entran en el mapa (la fila se renderiza sin bandera/chapa, como antes).
     */
    suspend fun enrichRidersByGlobalId(ids: List<String>, includeCurrentTeam: Boolean = true): Map<String, ResolvedRider> {
        val need = ids.filter { it.isNotEmpty() }.distinct()
        if (need.isEmpty()) return emptyMap()
        val riders = runCatching { api.ridersByIds(need) }.getOrNull().orEmpty()
        if (riders.isEmpty()) return emptyMap()

        val currentIds = if (includeCurrentTeam) riders.mapNotNull { it.currentTeamId }.distinct() else emptyList()
        val teamById = if (currentIds.isNotEmpty()) {
            runCatching { api.teamsByIds(currentIds) }.getOrNull().orEmpty().associateBy { it.id }
        } else emptyMap()
        return riders.associate { r ->
            val team = if (includeCurrentTeam) r.currentTeamId?.let { teamById[it] } else null
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
    suspend fun enrichTeamsByIds(ids: List<String>, year: Int?): Map<String, Team> {
        val need = ids.filter { it.isNotEmpty() }.distinct()
        if (need.isEmpty()) return emptyMap()
        val baseById = runCatching { api.teamsByIds(need) }.getOrNull().orEmpty().associateBy { it.id }
        val seasonById = year?.let {
            runCatching { api.teamSeasonsByIds(it, need) }.getOrNull().orEmpty().associateBy { season -> season.teamId }
        }.orEmpty()
        return need.mapNotNull { id ->
            (baseById[id]?.applySeason(seasonById[id]) ?: seasonById[id]?.asTeam())?.let { id to it }
        }.toMap()
    }

    /** Carga inicial de la pantalla de resultados. null si la carrera no tiene
     *  clasificaciones keepForWeb (→ estado Empty). */
    suspend fun loadResultsData(raceId: String): UciResultsData? = coroutineScope {
        // Primera tanda en paralelo: clasificaciones, jornadas y carrera.
        val rawStagesDeferred = async { api.raceUciStages(raceId) }
        // Las jornadas se cargan SIEMPRE: una etapa CANCELADA no tiene
        // clasificaciones propias y su pantalla se sintetiza a partir de ellas
        // (aviso + generales de la etapa anterior). La señal `isCancelledDay`
        // vive en race_days, no en race_uci_stages. Espejo de js/resultados.js.
        // Llevan perfil: la cabecera muestra el de la etapa activa.
        val allDaysDeferred = async {
            try {
                api.raceDaysByRace(raceId)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                emptyList()
            }
        }
        // Envuelta: un fallo solo importa si hay clasificaciones que mostrar.
        val raceDeferred = async {
            try {
                Result.success(api.raceById(raceId))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                Result.failure(error)
            }
        }
        val rawStages = rawStagesDeferred.await()
        val allDays = allDaysDeferred.await()
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
        if (stages.isEmpty()) {
            raceDeferred.cancel()
            return@coroutineScope null
        }
        val classificationDeferred = async {
            try {
                api.raceClassifications(raceId)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                emptyList()
            }
        }
        val assetsDeferred = async {
            try {
                api.assetsByRaceDays(allDays.map { it.id })
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                emptyList()
            }
        }
        val race = raceDeferred.await().getOrThrow()
        val (byDorsal, raceTeams) = buildByDorsal(raceId, race.year)
        val classificationConfig = classificationDeferred.await()
        val assets = assetsDeferred.await()

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
        UciResultsData(
            race = race, stages = stages, byDorsal = byDorsal,
            raceTeams = raceTeams, raceDay = raceDay, raceDays = allDays,
            sectorSuffixByRaceDayId = sectorSuffixByRaceDayId,
            sectoredStageNumbers = sectoredStageNumbers,
            classificationConfig = classificationConfig,
            assets = assets,
        )
    }

    /** Filas de una clasificación concreta (on-demand, al cambiar de pestaña). */
    suspend fun loadResultRows(stageRef: String): List<RaceUciResultRow> =
        api.raceUciResults(stageRef)

    /**
     * Clasificaciones in-house publicables (keepForWeb y con filas) de una
     * carrera, reducidas a lo que necesitan los accesos a resultados.
     * Devuelve null si la consulta falla, para distinguir el fallo de una
     * carrera sin clasificaciones.
     */
    suspend fun inhouseStages(raceId: String): List<RaceUciStage>? =
        try {
            api.inhouseStagesByRaceIds(listOf(raceId))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            null
        }

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
        val stages = inhouseStages(raceId).orEmpty().filter { it.rowCount > 0 }
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
        return InhouseStageMap.forDays(inhouseStages(raceId).orEmpty(), days, cancelledDayIds)
    }

    /**
     * Como [inhouseStagesForDays] para varias carreras en UNA consulta (trofeos
     * de Hoy). [daysByRace] = raceId → (raceDayId, stageNumber) de sus jornadas.
     * Fail-silent: sin red → mapa vacío.
     */
    suspend fun inhouseStagesForRaces(
        daysByRace: Map<String, List<Pair<String, Int?>>>,
        cancelledDayIds: Set<String> = emptySet(),
    ): Map<String, Int?> {
        val raceIds = daysByRace.filterValues { it.isNotEmpty() }.keys.toList()
        if (raceIds.isEmpty()) return emptyMap()
        val stagesByRace = try {
            api.inhouseStagesByRaceIds(raceIds)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            return emptyMap()
        }.groupBy { it.raceId }
        val out = HashMap<String, Int?>()
        for ((raceId, days) in daysByRace) {
            out.putAll(InhouseStageMap.forDays(stagesByRace[raceId].orEmpty(), days, cancelledDayIds))
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
        val stages = runCatching { api.inhouseStagesByRaceIds(ids) }.getOrNull().orEmpty()
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
            val raceIds = stages.map { it.raceId }.distinct()
            // Lo que solo depende de las carreras sale ya, en paralelo con las
            // jornadas de la ventana y las fichas de carrera.
            val racesDeferred = async { if (raceIds.isEmpty()) emptyList() else api.racesByIds(raceIds) }
            val allStagesDeferred = async {
                try {
                    api.raceUciStagesByRaceIds(raceIds)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    emptyList()
                }
            }
            val configsDeferred = async {
                try {
                    api.raceClassificationsByRaceIds(raceIds)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    emptyList()
                }
            }
            val programDeferred = async {
                try {
                    api.raceDaysProgramByRaceIds(raceIds)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    daysDeferred.await()
                }
            }
            val raceDays = daysDeferred.await()
            val races = racesDeferred.await()
            val entries = ResultsFeedLogic.buildEntries(stages, raceDays, races, fromKey, toKey)
            val featuredDeferred = async {
                try {
                    api.featuredRaces(entries.map { it.date }.distinct())
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    emptyList()
                }
            }
            val featuredKeys = featuredDeferred.await().map { "${it.dateKey}#${it.raceId}" }.toSet()
            val decorated = ResultsFeedLogic.featuredFirst(
                decorateFeedEntries(
                    entries,
                    featuredKeys,
                    allStagesDeferred.await(),
                    configsDeferred.await(),
                    programDeferred.await(),
                ),
                featuredKeys,
            )
            currentCoroutineContext().ensureActive()
            // Contrato único del repositorio: la UI recibe solo el modelo final,
            // con ganadores y líderes ya normalizados.
            resolveFeedWinners(decorated)
        }

    private fun decorateFeedEntries(
        entries: List<ResultsFeedLogic.FeedEntry>,
        featuredKeys: Set<String>,
        allStages: List<RaceUciStage>,
        configs: List<app.calendariociclismo.android.data.model.RaceClassificationConfig>,
        raceDays: List<RaceDay>,
    ): List<ResultsFeedLogic.FeedEntry> {
        val finalKeys = entries.filter { it.isGcFinal }.map { "${it.date}#${it.race.id}" }.toSet()
        val configByRace = configs.groupBy { it.raceId }
        val lastCompetitiveDayByRace = raceDays
            .filter { !it.isRestDay && !it.isCancelledDay }
            .sortedWith(compareBy<RaceDay>({ it.dateKey }, { it.neutralStartTimeUtc.orEmpty() }, { it.stageNumber ?: 0 }))
            .mapNotNull { day -> day.raceId?.let { it to day.id } }
            .toMap()
        return entries.map { entry ->
            val key = "${entry.date}#${entry.race.id}"
            val isFeatured = key in featuredKeys && (key !in finalKeys || entry.isGcFinal)
            if (!isFeatured || entry.kind != ResultsFeedLogic.Kind.INHOUSE) {
                return@map entry.copy(isFeatured = isFeatured)
            }
            if (entry.race.isOneDay || (!entry.isGcFinal && entry.rd?.id == lastCompetitiveDayByRace[entry.race.id])) {
                return@map entry.copy(isFeatured = true)
            }
            val candidates = allStages.filter { stage ->
                stage.raceId == entry.race.id && stage.rowCount > 0 &&
                    stage.classKind != "stage" && when {
                        entry.isGcFinal -> stage.classKind != "gc" &&
                            (stage.isFinalClassification || stage.stageNumber == null) &&
                            (stage.stageDate == null || stage.stageDate == entry.date)
                        entry.rd?.id != null && stage.raceDayId != null ->
                            entry.rd.id == stage.raceDayId && !stage.isFinalClassification
                        else -> stage.stageNumber == entry.stageNumber && !stage.isFinalClassification
                    }
            }
            val inventory = UciResultsLogic.classificationInventory(configByRace[entry.race.id].orEmpty(), candidates)
            val positions = inventory.associate { it.classKind to it.position }
            val complementary = candidates.map { stage ->
                val config = inventory.firstOrNull { it.classKind == stage.classKind }
                    ?: app.calendariociclismo.android.data.model.RaceClassificationConfig(
                        raceId = stage.raceId,
                        classKind = stage.classKind,
                        position = UciResultsLogic.CLASS_ORDER.indexOf(stage.classKind).takeIf { it >= 0 } ?: 10,
                    )
                ResultsFeedLogic.ComplementaryClassification(
                    stageRef = stage.id,
                    classKind = stage.classKind,
                    labelEs = UciResultsLogic.classificationLabel(config, false),
                    labelEn = UciResultsLogic.classificationLabel(config, true),
                    colorHex = UciResultsLogic.classificationColor(config),
                    winner = ResultsFeedLogic.cleanWinner(stage.winnerName),
                )
            }.sortedBy { positions[it.classKind] ?: 99 }
            entry.copy(isFeatured = true, complementary = complementary)
        }
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
    private suspend fun resolveFeedWinners(entries: List<ResultsFeedLogic.FeedEntry>): List<ResultsFeedLogic.FeedEntry> {
        currentCoroutineContext().ensureActive()
        val refIds = entries
            .filter { it.kind == ResultsFeedLogic.Kind.INHOUSE }
            .flatMap { entry -> listOfNotNull(entry.stageRefId) + entry.complementary.map { it.stageRef } }
            .distinct()
        if (refIds.isEmpty()) return entries

        val allRank1Rows = try {
            api.raceUciRank1(refIds)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            return entries
        }
        val nonWinnerRefs = allRank1Rows.filter { UciResultsLogic.isNonWinnerIrm(it.irm) }.map { it.stageRef }.toSet()
        val rank1Rows = allRank1Rows.filterNot { UciResultsLogic.isNonWinnerIrm(it.irm) }
        // Nombres canónicos primero: el cruce por dorsal de la startlist
        // también debe cubrir filas cuya ficha existe pero no resuelve nombre
        // (oculta por el aislamiento del catálogo histórico o sin nombre
        // público), no solo las que llegan sin globalRiderId.
        // Los nombres canónicos de equipo solo dependen de las filas rank 1:
        // viajan en paralelo con los nombres de corredor.
        val directIds = rank1Rows.mapNotNull { it.globalRiderId }.distinct()
        val (directNames, canonicalTeamNames) = coroutineScope {
            val riders = async<Map<String, String>> {
                if (directIds.isEmpty()) emptyMap()
                else try {
                    api.riderNamesByIds(directIds)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    emptyMap()
                }
            }
            val teams = async<Map<String, String>> {
                try {
                    api.teamNamesByIds(rank1Rows.mapNotNull { it.teamId }.distinct())
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    emptyMap()
                }
            }
            riders.await() to teams.await()
        }
        var nameById: Map<String, String> = directNames
        val unresolvedRaceIds = rank1Rows
            .filter { row ->
                row.bib?.toIntOrNull() != null
                    && row.globalRiderId?.let { gid -> nameById[gid]?.isNotEmpty() == true } != true
            }
            .map { it.raceId }
            .distinct()
        val startlistRows = try {
            api.feedStartlistIdentities(unresolvedRaceIds)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            emptyList()
        }
        val startlistByBib = startlistRows
            .mapNotNull { row -> row.dorsal?.let { "${row.raceId}#$it" to row } }
            .toMap()
        val resolvedRiderId: (UciRank1Row) -> String? = { row ->
            row.globalRiderId ?: row.bib?.toIntOrNull()?.let { startlistByBib["${row.raceId}#$it"]?.globalRiderId }
        }
        val byRef = rank1Rows.groupBy { it.stageRef }.mapValues { (_, rows) ->
            rows.mapNotNull(resolvedRiderId).distinct()
        }

        val riderIds = rank1Rows.mapNotNull(resolvedRiderId).distinct()
        val extraIds = riderIds.filter { nameById[it] == null }
        if (extraIds.isNotEmpty()) {
            nameById = try {
                nameById + api.riderNamesByIds(extraIds)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                nameById
            }
        }
        val resolvedRiderName: (UciRank1Row) -> String? = { row ->
            val fallback = row.bib?.toIntOrNull()?.let { startlistByBib["${row.raceId}#$it"] }
            resolvedRiderId(row)?.let { nameById[it] }
                ?: listOfNotNull(fallback?.firstName, fallback?.lastName).joinToString(" ").ifBlank { null }
                ?: ResultsFeedLogic.cleanWinner(row.riderDisplay).ifBlank { null }
        }
        val rowsByRef = rank1Rows.groupBy { it.stageRef }

        // 1) Nombre canónico cuando hay UN único rank 1 con ficha.
        val resolved = entries.map { e ->
            if (e.kind != ResultsFeedLogic.Kind.INHOUSE || e.stageRefId == null) return@map e
            val names = rowsByRef[e.stageRefId].orEmpty().mapNotNull(resolvedRiderName).distinct()
            var updated = if (e.stageRefId in nonWinnerRefs && names.isEmpty()) {
                e.copy(winner = "")
            } else if (names.size == 1 && e.rd?.primaryType != "ttt") {
                e.copy(winner = names.first())
            } else {
                e
            }
            updated = updated.copy(complementary = updated.complementary.map { item ->
                val rows = rowsByRef[item.stageRef].orEmpty()
                val namesForClass = if (item.classKind == "teams") {
                    rows.mapNotNull { row ->
                        row.teamId?.let { canonicalTeamNames[it] }
                            ?: ResultsFeedLogic.cleanWinner(row.riderDisplay).ifBlank { null }
                    }.distinct()
                } else {
                    rows.mapNotNull(resolvedRiderName).distinct()
                }
                item.copy(winner = namesForClass.sorted().joinToString(" / ").ifBlank { item.winner })
            })
            updated
        }.toMutableList()

        // 2) CRE: el ganador es el EQUIPO, no un corredor. Tres consultas por
        // lotes para todas las entradas: inscritos → startlist_teams → teams.
        val creEntries = resolved.indices.mapNotNull { i ->
            val e = resolved[i]
            if (e.kind != ResultsFeedLogic.Kind.INHOUSE || e.stageRefId == null) return@mapNotNull null
            val ids = byRef[e.stageRefId].orEmpty()
            if (!ResultsFeedLogic.isCreEntry(e, ids) || ids.isEmpty()) return@mapNotNull null
            i to ids.take(3)
        }
        if (creEntries.isNotEmpty()) {
            try {
                val riderRows = api.startlistRiderTeamRows(
                    creEntries.map { (i, _) -> resolved[i].race.id },
                    creEntries.flatMap { it.second },
                )
                val pksByEntry = creEntries.associate { (i, ids) ->
                    val raceId = resolved[i].race.id
                    i to riderRows
                        .filter { it.raceId == raceId && it.globalRiderId in ids }
                        .mapNotNull { it.teamId }
                        .distinct()
                }
                val slTeamByPk = api.startlistTeamsByPks(
                    pksByEntry.values.filter { it.size == 1 }.map { it.first() },
                ).associateBy { it.id }
                val canonNames = try {
                    api.teamNamesByIds(slTeamByPk.values.mapNotNull { it.teamId })
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    emptyMap()
                }
                for ((i, pks) in pksByEntry) {
                    if (pks.size != 1) continue
                    val slTeam = slTeamByPk[pks.first()] ?: continue
                    val teamWinner = slTeam.teamId?.let { canonNames[it] } ?: slTeam.teamName
                    if (teamWinner.isNotEmpty()) {
                        resolved[i] = resolved[i].copy(
                            winner = ResultsFeedLogic.localizedNationName(
                                teamWinner,
                                LocaleHolder.shouldShowEnglishContent,
                            ),
                        )
                    }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Si falla, se queda el ganador que hubiera (como la web).
            }
        }
        currentCoroutineContext().ensureActive()
        return resolved
    }

    // ─────────── Today Highlights ───────────

    suspend fun todayHighlights(scope: String = "road") = api.todayHighlights(scope)
    /** Jornadas del cintillo reducidas a identidad y fecha. */
    suspend fun raceDaysByIds(ids: List<String>) = api.raceDaySummariesByIds(ids)
    suspend fun racesByIds(ids: List<String>): List<Race> = api.racesByIds(ids)

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
        ledger.clear()
        assetsDao.clear()
        broadcastsDao.clear()
        raceDaysDao.clear()
        racesDao.clear()
    }

    companion object {
        private const val TAG = "CalendarRepository"

        /** Vigencia de las carreras del año (Hoy, Temporada, offline); iOS usa la misma. */
        const val RACES_YEAR_TTL_SECONDS = 3600L

        /** Vigencia de un mes ya cargado en Mes. */
        const val MONTH_TTL_SECONDS = 10 * 60L

        /** Instantánea de carrera recién descargada (Temporada → Carrera). */
        const val RACE_SNAPSHOT_TTL_SECONDS = 60L

        /** Una instantánea completa de la sesión permite abrir Carrera desde Room. */
        private const val RACE_SESSION_TTL_SECONDS = 6 * 3600L

        /** Vigencia de un día en la sincronización offline (iOS: 12 h). */
        const val OFFLINE_DAY_TTL_SECONDS = 12 * 3600L
    }
}
