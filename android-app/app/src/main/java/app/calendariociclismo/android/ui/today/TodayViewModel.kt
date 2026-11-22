package app.calendariociclismo.android.ui.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.calendariociclismo.android.data.model.DayData
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.prefs.AppPreferences
import app.calendariociclismo.android.data.repository.CalendarRepository
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.RoadRaceFilter
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.TodayRefreshPolicy
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Orden de la agenda de Hoy. Espejo de `sortAgenda`
 * (`js/services/today-agenda-order.js`): las destacadas encabezan solo en el
 * orden por categoría y nunca adelantan a las carreras de la cola.
 */
internal fun sortTodayAgenda(
    items: List<EnrichedRaceDay>,
    sortMode: TodayViewModel.SortMode,
    featuredRaceIds: Set<String>,
): List<EnrichedRaceDay> {
    val comparator = when (sortMode) {
        TodayViewModel.SortMode.CATEGORY -> RaceLogic.byCategory
        TodayViewModel.SortMode.TV_TIME -> RaceLogic.byTvTime
        TodayViewModel.SortMode.FINISH_TIME -> RaceLogic.byFinishTime
    }
    fun featured(item: EnrichedRaceDay): Boolean =
        sortMode == TodayViewModel.SortMode.CATEGORY &&
            !RaceLogic.isAgendaTail(item) &&
            item.race?.id in featuredRaceIds
    return items.sortedWith(Comparator { a, b ->
        val af = featured(a); val bf = featured(b)
        if (af != bf) if (af) -1 else 1 else comparator.compare(a, b)
    })
}

internal fun cachedTodayDayHasElevation(data: DayData): Boolean =
    data.raceDays.all { day ->
        day.raceDay.isRestDay || day.raceDay.isCancelledDay ||
            day.raceDay.profileNotViewable || day.raceDay.elevationProfile != null
    }

/**
 * ViewModel de la pestaña "Hoy".
 *
 * Estrategia: leer la DayData desde caché local al instante, y en paralelo
 * pedir refresh a Supabase. Si el refresh trae datos nuevos, el Flow de
 * Room se reemite automáticamente.
 */
class TodayViewModel(
    private val repo: CalendarRepository,
    private val prefs: AppPreferences,
) : ViewModel() {

    private companion object {
        /** Tope de espera de la caché durante la navegación animada (ms). */
        const val NAVIGATION_CACHE_TIMEOUT = 400L
    }

    enum class SortMode(val id: String, val labelRes: Int) {
        CATEGORY("category", app.calendariociclismo.android.R.string.today_sort_category),
        TV_TIME("tvTime", app.calendariociclismo.android.R.string.today_sort_tv_time),
        FINISH_TIME("finishTime", app.calendariociclismo.android.R.string.today_sort_finish_time),
    }

    data class State(
        val dateKey: String = DateFormatting.todayKey(),
        val isLoading: Boolean = false,
        val isRefreshing: Boolean = false,
        val refreshToken: Int = 0,
        val error: String? = null,
        val data: DayData? = null,
        /** Filtros de carretera, recordados y compartidos con Mes y Temporada. */
        val filter: RoadRaceFilter = RoadRaceFilter(),
        val sortMode: SortMode = SortMode.CATEGORY,
        val nextRaceDate: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()
    /** La carga más reciente gana: evita que una respuesta lenta de otro día
     * sobrescriba la jornada que el usuario ya ha seleccionado. */
    private var loadGeneration = 0
    /** Fechas cuya descarga completa (incluida elevación) terminó en esta sesión. */
    private val completeDayDates = mutableSetOf<String>()

    private fun canPresentCachedDay(dateKey: String, data: DayData): Boolean =
        dateKey in completeDayDates || cachedTodayDayHasElevation(data)

    init {
        // Orden recordado.
        viewModelScope.launch {
            val saved = prefs.snapshotTodaySort("road")
            SortMode.entries.firstOrNull { it.name == saved }?.let { _state.value = _state.value.copy(sortMode = it) }
        }
        // Filtros recordados (AppPreferences), también los marcados en Mes y Temporada.
        prefs.roadRaceFilter
            .onEach { filter ->
                if (filter == _state.value.filter) return@onEach
                _state.value = _state.value.copy(filter = filter, nextRaceDate = nextDayMatchingFilter(_state.value.dateKey, filter))
                skipDayEmptiedByFilter()
            }
            .launchIn(viewModelScope)
        load()
    }

    fun setDate(dateKey: String) {
        _state.value = _state.value.copy(
            dateKey = dateKey, data = null, nextRaceDate = null,
        )
        load()
    }

    /**
     * Cambio de día para la animación de Hoy (mismo patrón que el cambio de mes
     * de Ciclocross): mantiene el contenido saliente, resuelve primero de caché
     * con un tope de espera para que el día entrante aparezca ya con datos y
     * deja el refresh de red en background. Sin caché cae al comportamiento de
     * `setDate` (pantalla de carga durante la entrada).
     */
    suspend fun navigateTo(target: String) {
        val prepared = withTimeoutOrNull(NAVIGATION_CACHE_TIMEOUT) {
            runCatching { repo.cachedDayData(target) }.getOrNull()
        }
        // Una fila procedente de Mes/Temporada puede carecer aún de elevación.
        // No enseñar primero la tarjeta corta y añadir el perfil a posteriori.
        val presentable = prepared?.takeIf { canPresentCachedDay(target, it) }
        _state.value = _state.value.copy(
            dateKey = target, data = presentable, nextRaceDate = null,
            isLoading = presentable == null, error = null,
        )
        load(fallbackData = prepared)
    }

    suspend fun navigateToNextDay() {
        val current = _state.value.dateKey
        val filter = _state.value.filter
        val next = nextDayMatchingFilter(current, filter)
            ?: DateFormatting.nextDay(current)
        next?.let { navigateTo(it) }
    }

    /** Día al que lleva «Hoy»: la fecha actual. */
    fun currentDayKey(): String = DateFormatting.todayKey()

    suspend fun navigateToPreviousDay() {
        val current = _state.value.dateKey
        val filter = _state.value.filter
        val prev = previousDayMatchingFilter(current, filter) ?: DateFormatting.previousDay(current)
        prev?.let { navigateTo(it) }
    }

    suspend fun navigateToNextRaceDay() {
        _state.value.nextRaceDate?.let { navigateTo(it) }
    }

    // Última fecha local que se mostró COMO "hoy". Distingue "el usuario está en
    // hoy y ha cruzado la medianoche local" (→ auto-avanzar) de "navegó a otro día
    // a mano" (→ no tocar). Se sincroniza cuando el día mostrado es hoy.
    private var lastTodayKey: String = DateFormatting.todayKey()

    // Auto-avance de medianoche: si el día mostrado seguía siendo el "hoy" anterior
    // y la fecha local ya cambió, salta al nuevo hoy. Si el usuario navegó a otro
    // día, NO se le mueve. Lo invocan los ciclos de refresco / vuelta a primer plano.
    fun advanceIfNewLocalDay() {
        val nowKey = currentDayKey()
        val shown = _state.value.dateKey
        if (shown == nowKey) { lastTodayKey = nowKey; return }   // ya estamos en hoy
        if (shown != lastTodayKey) return                         // navegación manual: respetar
        lastTodayKey = nowKey
        setDate(nowKey)
    }

    /** Cambio de filtros desde el menú: se guardan y se aplican ya. */
    fun setFilter(filter: RoadRaceFilter) {
        _state.value = _state.value.copy(filter = filter, nextRaceDate = nextDayMatchingFilter(_state.value.dateKey, filter))
        viewModelScope.launch { prefs.setRoadRaceFilter(filter) }
        skipDayEmptiedByFilter()
    }

    /** Con el filtro nuevo el día mostrado queda sin carreras: salta al siguiente
     *  día que las tenga. Sin datos aún o con carga en curso lo decide [load]. */
    private fun skipDayEmptiedByFilter() {
        val current = _state.value
        val next = current.nextRaceDate ?: return
        if (current.isLoading || current.data == null) return
        if (visibleData()?.raceDays.isNullOrEmpty()) setDate(next)
    }

    fun setSortMode(mode: SortMode) {
        _state.value = _state.value.copy(sortMode = mode)
        viewModelScope.launch { prefs.setTodaySort("road", mode.name) }
    }

    fun refresh() {
        load(force = true)
    }

    /** Última descarga completa de red de la jornada mostrada (fecha + instante). */
    private var lastNetworkLoad: Pair<String, Instant>? = null

    /**
     * Latido de Hoy (cada minuto y al volver a primer plano). Solo vuelve a la
     * red con jornadas en curso o próximas a empezar o a publicar resultados;
     * sin actividad, cada quince minutos ([TodayRefreshPolicy]).
     */
    fun refreshAutomatically(now: Instant = Instant.now()) {
        val current = _state.value
        if (current.dateKey != DateFormatting.todayKey() || current.isLoading) return
        val last = lastNetworkLoad?.takeIf { it.first == current.dateKey }?.second
        val days = current.data?.raceDays.orEmpty().filterNot { it.isPlaceholder }.map { it.raceDay }
        if (!TodayRefreshPolicy.shouldRefresh(now, last, days)) return
        load(force = true, silent = true)
    }

    private fun load(force: Boolean = false, silent: Boolean = false, fallbackData: DayData? = null) {
        val key = _state.value.dateKey
        val generation = ++loadGeneration
        _state.value = _state.value.copy(
            isLoading = true,
            isRefreshing = force && !silent,
            error = null,
        )
        viewModelScope.launch {
            // 1. Caché local inmediata
            var offlineFallback = fallbackData
            if (!force) {
                runCatching { repo.cachedDayData(key) }
                    .getOrNull()
                    ?.let {
                        offlineFallback = it
                        if (generation == loadGeneration && _state.value.dateKey == key &&
                            canPresentCachedDay(key, it)) {
                            _state.value = _state.value.copy(data = it)
                        }
                    }
            }
            // 2. Refresh remoto del día y, en paralelo, de las carreras del año
            //    (placeholders y navegación por filtro). El año respeta su TTL de
            //    una hora salvo en el refresco manual.
            val year = key.substring(0, 4).toIntOrNull()
            // Instante de INICIO de la descarga: el latido mide desde aquí, no
            // desde el final (la latencia retrasaría el siguiente refresco).
            val networkLoadStartedAt = Instant.now()
            val yearJob = year?.let {
                launch { runCatching { repo.refreshRacesYear(it, force = force && !silent) } }
            }
            val refreshed = runCatching { repo.refreshDay(key) }
                .getOrElse { t ->
                    if (generation != loadGeneration || _state.value.dateKey != key) return@launch
                    // Cadena vacía como sentinel: mantiene la rama de error en la
                    // pantalla activa para que muestre el fallback localizado
                    // (`R.string.startlist_error_unknown`) en lugar del estado vacío.
                    _state.value = _state.value.copy(
                        isLoading = false,
                        isRefreshing = false,
                        error = t.message ?: "",
                        data = _state.value.data ?: offlineFallback,
                    )
                    return@launch
                }
            completeDayDates += key
            lastNetworkLoad = key to networkLoadStartedAt
            // 3. Carreras del año cacheadas para la navegación filter-aware
            if (year != null) {
                yearJob?.join()
                _allRaces = runCatching { repo.cachedRacesForYear(year) }
                    .getOrDefault(emptyList())
            }
            // 4. Releer caché (ahora completa) y añadir placeholders. La
            //    selección destacada llega con la descarga del día.
            val fresh = runCatching { repo.cachedDayData(key) }.getOrNull()
            val featuredRaceIds = refreshed.featuredRaceIds
            if (generation != loadGeneration || _state.value.dateKey != key) return@launch
            val withPlaceholders = if (fresh != null && year != null) {
                addPlaceholders(fresh, key, year)
            } else fresh
            val presented = withPlaceholders?.copy(featuredRaceIds = featuredRaceIds)

            // Siguiente día con carreras (respetando filtro activo)
            val filter = _state.value.filter
            val nextDate = nextDayMatchingFilter(key, filter)
            _state.value = _state.value.copy(
                isLoading = false,
                isRefreshing = false,
                error = null,
                data = presented,
                refreshToken = _state.value.refreshToken + 1,
                nextRaceDate = nextDate,
            )

            // Sin carreras visibles (con o sin filtros), salta siempre al
            // siguiente día que las tenga.
            val visible = visibleData()
            if (!silent &&
                (visible == null || visible.raceDays.isEmpty()) &&
                nextDate != null
            ) {
                setDate(nextDate)
            }

            // Precacheo de días vecinos: la navegación animada de Hoy resuelve
            // primero de caché, así que conviene tenerlos listos.
            prefetchNearbyDays(key, filter)
        }
    }

    /** Carreras del año cacheadas para navegación filter-aware. */
    private var _allRaces: List<Race> = emptyList()

    private suspend fun addPlaceholders(data: DayData, dateKey: String, year: Int): DayData {
        val allRaces = runCatching { repo.cachedRacesForYear(year) }.getOrDefault(emptyList())
        val coveredIds = data.raceDays.mapNotNull { it.raceDay.raceId }.toSet()
        val placeholders = allRaces.filter { race ->
            !race.isCancelled &&
            !coveredIds.contains(race.id) &&
            RaceLogic.isRaceDay(race, dateKey)
        }.map { race ->
            EnrichedRaceDay(
                raceDay = RaceDay(
                    id = "ph-${race.id}-$dateKey",
                    raceId = race.id,
                    dateKey = dateKey,
                    stageNumber = RaceLogic.theoreticalStageNumber(race, dateKey),
                ),
                race = race,
                isPlaceholder = true,
            )
        }
        if (placeholders.isEmpty()) return data
        return data.copy(raceDays = data.raceDays + placeholders)
    }

    /** DayData filtrada por categoría y ordenada como en web e iOS. */
    fun visibleData(): DayData? {
        val d = _state.value.data ?: return null
        val filtered = sortTodayAgenda(
            _state.value.filter.apply(d.raceDays),
            _state.value.sortMode,
            d.featuredRaceIds,
        )
        return d.copy(raceDays = filtered)
    }

    // ── Navegación filter-aware ────────────────────────────────

    /** Siguiente día con carreras que coincidan con el filtro (escanea hasta 180 días). */
    private fun nextDayMatchingFilter(
        afterDateKey: String,
        filter: RoadRaceFilter,
    ): String? {
        if (_allRaces.isEmpty()) return null
        var candidate = afterDateKey
        repeat(180) {
            val next = DateFormatting.nextDay(candidate) ?: return null
            candidate = next
            if (hasMatchingRaces(candidate, filter)) return candidate
        }
        return null
    }

    /** Día anterior con carreras que coincidan con el filtro (escanea hasta 180 días). */
    private fun previousDayMatchingFilter(
        beforeDateKey: String,
        filter: RoadRaceFilter,
    ): String? {
        if (_allRaces.isEmpty()) return null
        var candidate = beforeDateKey
        repeat(180) {
            val prev = DateFormatting.previousDay(candidate) ?: return null
            candidate = prev
            if (hasMatchingRaces(candidate, filter)) return candidate
        }
        return null
    }

    /** True si hay al menos una carrera que coincida con el filtro en el día dado. */
    private fun hasMatchingRaces(dateKey: String, filter: RoadRaceFilter): Boolean =
        _allRaces.any { race ->
            !race.isCancelled &&
                RaceLogic.isRaceDay(race, dateKey) &&
                filter.matches(race)
        }

    /** Precacheo en background de día−1 y día+1 (respetando el filtro activo,
     *  con los días ±1 como referencia si no hay carreras que cumplan el
     *  filtro): la navegación animada de Hoy resuelve primero de caché. */
    private fun prefetchNearbyDays(anchor: String, filter: RoadRaceFilter) {
        val neighbors = listOfNotNull(
            previousDayMatchingFilter(anchor, filter) ?: DateFormatting.previousDay(anchor),
            nextDayMatchingFilter(anchor, filter) ?: DateFormatting.nextDay(anchor),
        ).distinct()
        if (neighbors.isEmpty()) return
        viewModelScope.launch {
            for (neighbor in neighbors) {
                // La caché amplia puede contener jornadas sin elevación.
                if (neighbor in completeDayDates) continue
                runCatching { repo.refreshDay(neighbor) }
                    .onSuccess { completeDayDates += neighbor }
            }
        }
    }
}
