package app.calendariociclismo.android.ui.cyclocross

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.data.repository.CxCached
import app.calendariociclismo.android.data.repository.CyclocrossRepository
import app.calendariociclismo.android.util.CxAgendaFilter
import app.calendariociclismo.android.util.CxCategoryCardState
import app.calendariociclismo.android.util.CxPresentation
import app.calendariociclismo.android.util.CyclocrossLogic
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/**
 * Estado de la pestaña Ciclocross y de la página de torneo. Ambas cargan los
 * siete meses de la temporada mediante la caché por mes de
 * [CyclocrossRepository]. La agenda general es una vista de un día, con la
 * navegación de Hoy en carretera; la página de torneo lista todas sus pruebas.
 */
class CyclocrossAgendaState(private val repo: CyclocrossRepository, private val clock: () -> LocalDate = { LocalDate.now() }, val tournamentId: String? = null) {
    private val today: LocalDate get() = clock()
    val cache = mutableStateMapOf<YearMonth, CxCached<List<CxRace>>>()
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
    /** Hay carreras que mostrar: caché local o descarga terminada. */
    var loaded by mutableStateOf(false)
        private set

    // Agenda general.
    var dateKey by mutableStateOf(todayKey())
        private set
    var filter by mutableStateOf(CxAgendaFilter.ALL)
        private set
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
        get() = CyclocrossLogic.months(season).flatMap { cache[it]?.data.orEmpty() }
            .distinctBy { it.id }
            .filter { CxPresentation.matchesAgendaFilter(it, filter) }

    /** Días de la temporada con carreras del filtro activo. */
    val raceDays: List<String> get() = CyclocrossLogic.raceDays(races)

    /** Carreras del día mostrado, en el orden de la agenda. */
    val dayRaces: List<CxRace> get() = CyclocrossLogic.racesOn(races, dateKey)

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
        jumpDate = null
        val allowed = CyclocrossLogic.months(season)
        loadCached(generation)
        if (generation != revision) return
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

    /** Descarga en paralelo los siete meses; devuelve el primer fallo. */
    private suspend fun loadSeason(generation: Int): Exception? = coroutineScope {
        val selectedSeason = season
        CyclocrossLogic.months(selectedSeason).map { month ->
            async {
                try {
                    val data = repo.month(selectedSeason, month)
                    if (generation == revision) cache[month] = data
                    null
                } catch (failure: Exception) {
                    if (failure is CancellationException) throw failure
                    failure
                }
            }
        }.awaitAll().firstOrNull { it != null }
    }

    suspend fun retry() = refresh()

    /** Pull-to-refresh: vuelve a descargar la temporada y las rondas y
     *  conserva el día mostrado. */
    suspend fun refresh() {
        if (busy) return
        val generation = revision
        busy = true
        isRefreshing = true
        error = null
        try {
            val failure = loadSeason(generation)
            val fresh = repo.rounds(season, force = true)
            if (generation != revision) return
            rounds = fresh
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
        if (busy || silentRefreshing || !hasPendingToday(at)) return
        val generation = revision
        silentRefreshing = true
        try { loadSeason(generation) }
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
