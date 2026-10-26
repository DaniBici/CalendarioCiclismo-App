package app.calendariociclismo.android.ui.cyclocross

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.data.model.CxRoundEntry
import app.calendariociclismo.android.data.model.CxRoundRow
import app.calendariociclismo.android.data.repository.CxCached
import app.calendariociclismo.android.data.repository.CyclocrossRepository
import app.calendariociclismo.android.util.CxAgendaFilter
import app.calendariociclismo.android.util.CxAgendaSort
import app.calendariociclismo.android.util.CxCategoryCardState
import app.calendariociclismo.android.util.CxPresentation
import app.calendariociclismo.android.util.CyclocrossLogic
import app.calendariociclismo.android.util.RegionDetector
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Estado de la pestaña Ciclocross y de la página de torneo. Ambas cargan los
 * siete meses de la temporada mediante la caché por mes de
 * [CyclocrossRepository]. La agenda general es una vista de un día, con la
 * navegación de Hoy en carretera; la página de torneo lista todas sus pruebas.
 */
private const val RECENT_DAYS = 14

class CyclocrossAgendaState(
    private val repo: CyclocrossRepository,
    private val clock: () -> LocalDate = { LocalDate.now() },
    val tournamentId: String? = null,
    /** La pestaña Ciclocross de Resultados necesita la temporada completa por
     *  meses; Hoy carga un índice ligero y el día mostrado. */
    private val seasonWide: Boolean = false,
) {
    private val today: LocalDate get() = clock()
    val cache = mutableStateMapOf<YearMonth, CxCached<List<CxRace>>>()
    /** Hoy (sin torneo ni temporada completa): como Hoy de carretera, índice
     *  ligero de la temporada y detalle de los días consultados. */
    private val dayMode: Boolean get() = tournamentId == null && !seasonWide
    private var index by mutableStateOf<CxCached<List<CxRace>>?>(null)
    private val dayDetails = mutableStateMapOf<String, CxCached<List<CxRace>>>()
    /** Último día descargado de la red; evita repetir su carga al mostrarlo. */
    private var freshDay: String? = null
    /** Orden de lanzamiento de las recargas de Hoy: solo la última aplica. */
    private var refreshSequence = 0
    var season by mutableStateOf(CyclocrossLogic.season(today))
        private set
    var busy by mutableStateOf(false)
        private set
    // Distingue el pull-to-refresh (indicador de la lista) de la carga de
    // apertura (barra de progreso superior), igual que Hoy en carretera.
    var isRefreshing by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    /** Página de torneo: fecha a la que se desplaza la lista al abrir. */
    var jumpDate by mutableStateOf<String?>(null)
        private set
    // Numeración n/total por torneo de la temporada (insignia de ronda).
    var rounds by mutableStateOf<Map<String, CxRound>>(emptyMap())
        private set
    /** Pruebas destacadas (`cx_race_featured`): encabezan su día en la
     *  agenda y en la pestaña Ciclocross de Resultados. La apertura parte de
     *  la última lectura y cada descarga de la temporada las renueva; sin
     *  ninguna lectura rige el orden canónico. */
    var featured by mutableStateOf<Set<String>>(emptySet())
        private set
    /** La numeración de rondas es completa: calculada con la temporada entera
     *  en caché o descargada. La pestaña Ciclocross de Resultados espera a
     *  este indicador para pintar la manga n/total con las filas. */
    var roundsReady by mutableStateOf(false)
        private set
    /** Hay carreras que mostrar: caché local o descarga terminada. */
    var loaded by mutableStateOf(false)
        private set

    /** Hoy puede pintarse: con datos o, sin ninguno, con el error de la carga.
     *  Barra de fechas, orden y lista aparecen a la vez. */
    val agendaReady: Boolean get() = loaded || (!busy && error != null)

    // Agenda general.
    var dateKey by mutableStateOf(todayKey())
        private set
    var filter by mutableStateOf(CxAgendaFilter.ALL)
        private set
    /** Orden del día mostrado (Categoría, Hora TV, Hora de meta), en memoria
     *  como en Hoy de carretera. */
    var sort by mutableStateOf(CxAgendaSort.CATEGORY)
    /** El usuario cambió de día desde la apertura: la descarga posterior no
     *  recalcula el día de apertura. */
    var navigated = false
        private set
    // Último día mostrado como «hoy»: distingue el cruce de medianoche (avanzar)
    // de una navegación manual (respetarla), como `TodayViewModel`.
    private var lastTodayKey = todayKey()
    private var revision = 0

    /** Día «hoy» de la agenda: fecha local acotada a su temporada CX. */
    fun todayKey(): String = CyclocrossLogic.agendaDay(today).toString()

    val firstDay: String get() = CyclocrossLogic.seasonFirstDay(season).toString()
    val lastDay: String get() = CyclocrossLogic.seasonLastDay(season).toString()

    /** Carreras de la agenda general con el filtro activo. */
    val races: List<CxRace>
        get() = seasonRaces.filter { CxPresentation.matchesAgendaFilter(it, filter) }

    /** Carreras de la temporada sin duplicados. En Hoy, el índice con el
     *  detalle de los días consultados sobre las mismas pruebas. */
    private val seasonRaces: List<CxRace>
        get() {
            if (!dayMode) return CyclocrossLogic.months(season).flatMap { cache[it]?.data.orEmpty() }.distinctBy { it.id }
            val byId = LinkedHashMap<String, CxRace>()
            index?.data.orEmpty().forEach { byId[it.id] = it }
            dayDetails.keys.sorted().forEach { key -> dayDetails[key]?.data.orEmpty().forEach { byId[it.id] = it } }
            return byId.values.toList()
        }

    /** Días de la temporada con carreras del filtro activo. */
    val raceDays: List<String> get() = CyclocrossLogic.raceDays(races)

    /** Carreras del día mostrado, en el orden elegido. */
    val dayRaces: List<CxRace>
        get() = CxPresentation.agendaRaces(races, dateKey, featured, sort) { RegionDetector.allowedBroadcastGroups() }

    /** Siguiente día con carreras del filtro activo. */
    val nextRaceDay: String? get() = CyclocrossLogic.nextRaceDay(raceDays, dateKey)

    val canGoPrevious: Boolean get() = dateKey > firstDay
    val canGoNext: Boolean get() = dateKey < lastDay

    /** Carga una sola vez por temporada el mapa raceId → CxRound. Fallo silencioso. */
    suspend fun loadRounds() {
        rounds = repo.rounds(season)
    }

    /**
     * Abre la temporada. En la agenda general, [restoredDay] recupera el día
     * elegido a mano antes de recrear la pantalla; sin él, abre en hoy o en el
     * siguiente día con carreras de [initialFilter].
     */
    suspend fun open(selectedSeason: String, restoredDay: String? = null, initialFilter: CxAgendaFilter = filter) {
        if (selectedSeason == season && loaded) return
        val generation = ++revision
        season = selectedSeason
        cache.clear()
        error = null
        busy = true
        loaded = false
        roundsReady = false
        jumpDate = null
        index = null
        dayDetails.clear()
        freshDay = null
        if (dayMode) {
            openToday(generation, restoredDay, initialFilter)
            return
        }
        val allowed = CyclocrossLogic.months(season)
        loadCached(generation)
        if (generation != revision) return
        // Destacadas de la última lectura: la lista de la caché sale ya en su
        // orden y la red no la recoloca.
        featured = repo.cachedFeaturedRaceIds()
        if (generation != revision) return
        // Con la temporada completa en caché la numeración sale ya completa.
        if (cache.size == allowed.size) {
            rounds = localRounds()
            roundsReady = true
        }
        // Página de torneo: todas sus pruebas de la temporada en una sola lista.
        if (tournamentId != null) {
            try {
                val failure = loadSeason(generation)
                if (generation != revision) return
                if (cache.isEmpty() && failure != null) error = failure.message
                val current = YearMonth.from(today).takeIf { it in allowed } ?: allowed.first()
                val next = repo.nextDate(selectedSeason, current.atDay(1).toString(), tournamentId)
                if (generation != revision) return
                jumpDate = next ?: today.toString()
                loaded = true
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                if (generation == revision) error = failure.message
            } finally { if (generation == revision) busy = false }
            return
        }
        filter = initialFilter
        navigated = false
        lastTodayKey = todayKey()
        val restored = restoredDay?.takeIf { it in firstDay..lastDay }
        if (cache.isNotEmpty()) {
            showOpening(restored)
            loaded = true
        }
        try {
            val failure = loadSeason(generation)
            if (generation != revision) return
            if (cache.isEmpty() && failure != null) error = failure.message
            if (!navigated) showOpening(restored) else autoNavigate()
            loaded = cache.isNotEmpty()
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            if (generation == revision) error = failure.message
        } finally { if (generation == revision) busy = false }
    }

    /**
     * Apertura de Hoy. Primero la copia local (índice y día de apertura); la
     * red trae a la vez el índice, el día, las destacadas y las rondas y, si la
     * apertura recae en otro día, ese día. La primera pintura ([loaded]) lleva
     * siempre el día de apertura con su detalle.
     */
    private suspend fun openToday(generation: Int, restoredDay: String?, initialFilter: CxAgendaFilter) {
        val selectedSeason = season
        filter = initialFilter
        navigated = false
        lastTodayKey = todayKey()
        val restored = restoredDay?.takeIf { it in firstDay..lastDay }
        try {
            // Destacadas de la última lectura: el día pintado desde la caché
            // sale ya en su orden y la red no lo recoloca.
            featured = repo.cachedFeaturedRaceIds()
            if (generation != revision) return
            repo.cachedIndex(selectedSeason)?.let {
                if (generation != revision) return
                index = it
            }
            if (generation != revision) return
            if (index != null) {
                showOpening(restored)
                rounds = localRounds()
                roundsReady = true
            }
            repo.cachedDay(selectedSeason, dateKey)?.let {
                if (generation != revision) return
                dayDetails[dateKey] = it
            }
            // La caché se pinta solo completa: índice y detalle del día de
            // apertura. Con el índice solo, las tarjetas saldrían sin
            // documentos, emisiones ni dorsales y cambiarían al llegar el detalle.
            if (index != null && dayDetails[dateKey] != null) loaded = true
            val requested = dateKey
            val outcome = downloadToday(requested, includeIndex = true, forceRounds = false)
            if (generation != revision) return
            applyToday(outcome, requested)
            if (index == null && dayDetails.isEmpty() && outcome.failure != null) error = outcome.failure.message
            if (!navigated) showOpening(restored) else autoNavigate()
            // Sin pintura previa, el día de apertura que fija el índice de red
            // (hoy sin carreras) se pinta ya con su detalle.
            val painted = loaded
            if (!painted && dateKey != requested) {
                loadDay(dateKey, generation)
                if (generation != revision) return
            }
            loaded = index != null || dayDetails[requested] != null
            if (painted && dateKey != requested) loadDay(dateKey, generation)
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            if (generation == revision) error = failure.message
        } finally { if (generation == revision) busy = false }
    }

    private class TodayDownload(
        val index: CxCached<List<CxRace>>?,
        val day: CxCached<List<CxRace>>?,
        val failure: Exception?,
        val featured: Set<String>,
        val rounds: Map<String, CxRound>,
    )

    /** Descarga a la vez el día, el índice de la temporada (si [includeIndex]),
     *  las destacadas y las rondas. Un fallo del día o del índice conserva lo
     *  que ya hubiera; la cancelación se propaga. */
    private suspend fun downloadToday(day: String, includeIndex: Boolean, forceRounds: Boolean): TodayDownload = coroutineScope {
        val selectedSeason = season
        val featuredDeferred = async { repo.featuredRaceIds() }
        val roundsDeferred = async { repo.rounds(selectedSeason, force = forceRounds) }
        suspend fun <T> capture(work: suspend () -> T): Result<T> = try { Result.success(work()) } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Result.failure(failure)
        }
        val dayDeferred = async { capture { repo.day(selectedSeason, day) } }
        val indexDeferred = if (includeIndex) async { capture { repo.seasonIndex(selectedSeason) } } else null
        val dayResult = dayDeferred.await()
        val indexResult = indexDeferred?.await()
        TodayDownload(
            index = indexResult?.getOrNull(),
            day = dayResult.getOrNull(),
            failure = (dayResult.exceptionOrNull() ?: indexResult?.exceptionOrNull()) as? Exception,
            featured = featuredDeferred.await(),
            rounds = roundsDeferred.await(),
        )
    }

    /** Aplica la descarga de Hoy de una vez: índice, día, destacadas y rondas. */
    private fun applyToday(download: TodayDownload, day: String) {
        download.index?.let { fresh ->
            index = fresh
            // Más reciente que el detalle de los demás días: se vuelven a pedir
            // al visitarlos.
            dayDetails.keys.filter { it != day }.forEach { dayDetails.remove(it) }
        }
        download.day?.let {
            dayDetails[day] = it
            if (!it.offline) freshDay = day
        }
        featured = download.featured
        rounds = download.rounds.ifEmpty { localRounds() }
        roundsReady = true
    }

    /** Detalle de un día: primero la copia local y después la red, sin
     *  indicadores. Un fallo conserva lo mostrado. */
    private suspend fun loadDay(target: String, generation: Int) {
        if (dayDetails[target] == null) {
            repo.cachedDay(season, target)?.let { if (generation == revision) dayDetails[target] = it }
        }
        try {
            val fresh = repo.day(season, target)
            if (generation != revision) return
            dayDetails[target] = fresh
            if (!fresh.offline) freshDay = target
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
        }
    }

    /** Carga el día mostrado tras navegar (flechas, gesto, filtro, medianoche);
     *  la pantalla lo invoca al cambiar [dateKey]. */
    suspend fun showDay() {
        if (!dayMode || !loaded || freshDay == dateKey) return
        loadDay(dateKey, revision)
    }

    /** Día de apertura: el restaurado o hoy y, si hoy no tiene carreras del
     *  filtro activo, el siguiente día que las tenga (skipEmptyDay de Hoy). */
    private fun showOpening(restored: String?) {
        dateKey = restored ?: CyclocrossLogic.openingDay(raceDays, todayKey())
    }

    /** Caché local de los siete meses: la lista aparece sin esperar a la red. */
    private suspend fun loadCached(generation: Int) {
        val selectedSeason = season
        for (month in CyclocrossLogic.months(selectedSeason)) {
            val cached = try { repo.cachedMonth(selectedSeason, month) } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                null
            }
            if (generation != revision) return
            cached?.let { cache[month] = it }
        }
    }

    /** Numeración n/total calculada con los meses en caché; completa solo con
     *  la temporada entera. */
    private fun localRounds(): Map<String, CxRound> {
        val rows = seasonRaces.map { race ->
            CxRoundRow(
                id = race.id, tournamentId = race.tournamentId, dateKey = race.dateKey, seasonKey = race.seasonKey,
                categories = race.categories.map { CxRoundEntry(it.dateKey, it.startTimeUtc) },
                isCancelled = race.isCancelled,
            )
        }
        return CyclocrossLogic.tournamentRounds(rows, season)
    }

    /** Descarga en paralelo los meses, las destacadas y la numeración de
     *  rondas, y las aplica juntas: carreras, orden de destacadas y manga
     *  n/total aparecen a la vez. Devuelve el primer fallo de los meses. */
    private suspend fun loadSeason(
        generation: Int,
        recentOnly: Boolean = false,
        forceRounds: Boolean = false,
        sequence: Int = refreshSequence,
    ): Exception? = coroutineScope {
        val selectedSeason = season
        val featuredDeferred = async { repo.featuredRaceIds() }
        val roundsDeferred = async { repo.rounds(selectedSeason, force = forceRounds) }
        val all = CyclocrossLogic.months(selectedSeason)
        val recentFrom = today.minusDays(RECENT_DAYS - 1L)
        val recent = all.filter { it.atEndOfMonth() >= recentFrom && it.atDay(1) <= today }
        val outcomes = (if (recentOnly && recent.isNotEmpty()) recent else all).map { month ->
            async {
                try {
                    month to Result.success(repo.month(selectedSeason, month))
                } catch (failure: Exception) {
                    if (failure is CancellationException) throw failure
                    month to Result.failure(failure)
                }
            }
        }.awaitAll()
        val ids = featuredDeferred.await()
        val freshRounds = roundsDeferred.await()
        var firstFailure: Exception? = null
        // Una recarga posterior (el tirón tras un latido) ya sustituye a esta.
        if (generation == revision && sequence == refreshSequence) {
            for ((month, outcome) in outcomes) {
                outcome.onSuccess { cache[month] = it }
                outcome.onFailure { if (firstFailure == null) firstFailure = it as? Exception }
            }
            featured = ids
            rounds = freshRounds.ifEmpty { localRounds() }
            roundsReady = true
        } else {
            firstFailure = outcomes.firstNotNullOfOrNull { it.second.exceptionOrNull() as? Exception }
        }
        firstFailure
    }

    suspend fun retry() = refresh()

    /** Pull-to-refresh: vuelve a descargar la temporada y las rondas y
     *  conserva el día mostrado. */
    suspend fun refresh() {
        // El tirón del usuario en Hoy y en Resultados no se descarta porque
        // haya una carga en curso (apertura o latido): se lanza igualmente y
        // prevalece su resultado. La página de torneo no se solapa.
        if (busy && tournamentId != null) return
        val sequence = ++refreshSequence
        val generation = revision
        busy = true
        isRefreshing = true
        error = null
        try {
            if (dayMode) {
                refreshToday(generation, sequence)
                return
            }
            val failure = loadSeason(generation, forceRounds = true, sequence = sequence)
            if (generation != revision) return
            if (cache.isEmpty() && failure != null) error = failure.message
            if (tournamentId == null) {
                if (!loaded && !navigated) showOpening(null) else autoNavigate()
            }
            loaded = cache.isNotEmpty()
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            if (generation == revision) error = failure.message
        } finally {
            isRefreshing = false
            if (generation == revision) busy = false
        }
    }

    private suspend fun refreshToday(generation: Int, sequence: Int) {
        val requested = dateKey
        val outcome = downloadToday(requested, includeIndex = true, forceRounds = true)
        // Una recarga posterior ya la sustituye.
        if (generation != revision || sequence != refreshSequence) return
        applyToday(outcome, requested)
        if (index == null && dayDetails.isEmpty() && outcome.failure != null) error = outcome.failure.message
        if (!loaded && !navigated) showOpening(null) else autoNavigate()
        loaded = index != null || dayDetails[requested] != null
        if (dateKey != requested) loadDay(dateKey, generation)
    }

    /** Hoy mostrado con alguna manga sin resultados ni cancelación: el latido
     *  de la pantalla vuelve a descargar la temporada. */
    fun hasPendingToday(at: Instant = Instant.now()): Boolean =
        tournamentId == null && loaded && dateKey == todayKey() &&
            dayRaces.any { race ->
                CyclocrossLogic.categoriesOn(race, dateKey).any {
                    CxPresentation.categoryCardState(race, it, at) !in setOf(CxCategoryCardState.RESULTS, CxCategoryCardState.CANCELLED)
                }
            }

    private var silentRefreshing = false

    /** Refresco periódico del día en curso: descarga la temporada sin
     *  indicadores ni mensajes de error y conserva el día mostrado. */
    suspend fun refreshSilently(at: Instant = Instant.now()) {
        if (hasPendingToday(at)) refreshQuietly()
    }

    /** Recarga la temporada sin indicadores ni mensajes de error y conserva lo
     *  cargado. La usa la pestaña Ciclocross de Resultados al volver a ella, a
     *  primer plano y en su latido de 60 s; con [recentOnly] solo descarga los
     *  meses de los últimos [RECENT_DAYS] días (ventana inicial del feed). */
    suspend fun refreshQuietly(recentOnly: Boolean = false) {
        if (busy || silentRefreshing || !loaded) return
        val generation = revision
        silentRefreshing = true
        try {
            if (dayMode) {
                // Latido: solo el día mostrado; el índice se renueva con el
                // tirón de recarga y al volver a la pantalla.
                val requested = dateKey
                val outcome = downloadToday(requested, includeIndex = false, forceRounds = false)
                if (generation == revision) applyToday(outcome, requested)
            } else {
                loadSeason(generation, recentOnly)
            }
        }
        finally { silentRefreshing = false }
    }

    fun consumeJump() { jumpDate = null }

    // MARK: - Navegación de la agenda general

    /** Muestra [target], acotado a la temporada. */
    fun navigateTo(target: String) {
        dateKey = target.coerceIn(firstDay, lastDay)
        navigated = true
        autoNavigate()
    }

    fun navigateToNextDay() {
        CyclocrossLogic.stepDay(raceDays, dateKey, forward = true, season = season)?.let(::navigateTo)
    }

    fun navigateToPreviousDay() {
        CyclocrossLogic.stepDay(raceDays, dateKey, forward = false, season = season)?.let(::navigateTo)
    }

    fun navigateToNextRaceDay() {
        nextRaceDay?.let(::navigateTo)
    }

    /** «Hoy»: el día actual; si ya pertenece a otra temporada, la abre. */
    suspend fun navigateToToday() {
        val nowKey = todayKey()
        lastTodayKey = nowKey
        val nowSeason = CyclocrossLogic.season(LocalDate.parse(nowKey))
        if (nowSeason != season) open(nowSeason, initialFilter = filter) else navigateTo(nowKey)
    }

    /** Cambio de filtro sobre los datos en memoria: conserva el día y solo
     *  con Todas avanza al siguiente día con carreras. */
    fun selectFilter(value: CxAgendaFilter) {
        if (value == filter) return
        filter = value
        if (loaded) autoNavigate()
    }

    /**
     * Auto-avance de medianoche: si el día mostrado seguía siendo el «hoy»
     * anterior y la fecha local cambió, pasa al nuevo día. Una navegación
     * manual a otro día se respeta.
     */
    suspend fun advanceIfNewLocalDay() {
        if (tournamentId != null || !loaded) return
        val nowKey = todayKey()
        if (dateKey == nowKey) { lastTodayKey = nowKey; return }
        if (dateKey != lastTodayKey) return
        lastTodayKey = nowKey
        val nowSeason = CyclocrossLogic.season(LocalDate.parse(nowKey))
        if (nowSeason != season) open(nowSeason, initialFilter = filter)
        else { dateKey = nowKey; autoNavigate() }
    }

    /** Día sin carreras visibles con el filtro Todas: avanza al siguiente día
     *  con carreras, como la auto-navegación de Hoy. */
    private fun autoNavigate() {
        if (filter != CxAgendaFilter.ALL) return
        val visible = races
        if (CyclocrossLogic.racesOn(visible, dateKey).isNotEmpty()) return
        CyclocrossLogic.nextRaceDay(CyclocrossLogic.raceDays(visible), dateKey)?.let { dateKey = it }
    }
}
