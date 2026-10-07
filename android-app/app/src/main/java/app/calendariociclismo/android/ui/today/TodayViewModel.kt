package app.calendariociclismo.android.ui.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.calendariociclismo.android.data.model.DayData
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.prefs.AppPreferences
import app.calendariociclismo.android.data.repository.CalendarRepository
import app.calendariociclismo.android.util.ChampionshipsConfig
import app.calendariociclismo.android.util.Constants
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.TodaySeason
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
        val dateKey: String = TodaySeason.clamp(DateFormatting.todayKey()),
        val isLoading: Boolean = false,
        val isRefreshing: Boolean = false,
        val refreshToken: Int = 0,
        val error: String? = null,
        val data: DayData? = null,
        val category: Constants.CategoryFilter = Constants.CategoryFilter.ALL,
        val sortMode: SortMode = SortMode.CATEGORY,
        val nextRaceDate: String? = null,
    )

    // Pin del usuario (DataStore), independiente del filtro mostrado. Dentro de la
    // ventana de Campeonatos no se aplica; fuera, gobierna `category`.
    private var pinnedCategory: Constants.CategoryFilter = Constants.CategoryFilter.ALL
    // Filtro elegido manualmente DENTRO de la ventana (o null). Se descarta al
    // salir → "fuera funciona normal" (se restaura el pin del usuario).
    private var champManualCategory: Constants.CategoryFilter? = null

    private val _state = MutableStateFlow(
        // El bloqueo se evalúa contra la JORNADA MOSTRADA (al arrancar = hoy), no
        // contra una fecha fija. Dentro de la ventana → Masculino forzado.
        if (ChampionshipsConfig.isChampWeekFilterLock(DateFormatting.todayKey()))
            State(category = ChampionshipsConfig.CHAMP_WEEK_HOY_DEFAULT)
        else State()
    )
    val state: StateFlow<State> = _state.asStateFlow()
    /** La carga más reciente gana: evita que una respuesta lenta de otro día
     * sobrescriba la jornada que el usuario ya ha seleccionado. */
    private var loadGeneration = 0
    /** Fechas cuya descarga completa (incluida elevación) terminó en esta sesión. */
    private val completeDayDates = mutableSetOf<String>()

    private fun canPresentCachedDay(dateKey: String, data: DayData): Boolean =
        dateKey in completeDayDates || cachedTodayDayHasElevation(data)

    init {
        // Observar el pin del usuario. Se guarda aparte; solo se refleja en
        // `category` cuando la jornada mostrada NO está en la ventana.
        prefs.defaultFilter
            .onEach { cat ->
                pinnedCategory = cat
                if (!ChampionshipsConfig.isChampWeekFilterLock(_state.value.dateKey)) {
                    _state.value = _state.value.copy(category = cat)
                }
            }
            .launchIn(viewModelScope)
        load()
    }

    /** `true` si la jornada mostrada cae en la ventana de Campeonatos (22-28 jun). */
    val isChampWeekLock: Boolean
        get() = ChampionshipsConfig.isChampWeekFilterLock(_state.value.dateKey)

    fun setDate(requestedDate: String) {
        val dateKey = TodaySeason.clamp(requestedDate)
        _state.value = _state.value.copy(
            dateKey = dateKey, data = null, nextRaceDate = null, category = resolvedCategory(dateKey),
        )
        load()
    }

    /** Categoría efectiva al cambiar de fecha: la entrada/salida de la ventana
     *  de Campeonatos fuerza Masculino o restaura el pin del usuario. */
    private fun resolvedCategory(target: String): Constants.CategoryFilter {
        val wasLock = ChampionshipsConfig.isChampWeekFilterLock(_state.value.dateKey)
        val nowLock = ChampionshipsConfig.isChampWeekFilterLock(target)
        if (nowLock && !wasLock) {
            // Entramos en la ventana → forzar Masculino (o el manual previo de esta
            // sesión de ventana, si lo hubiera).
            return champManualCategory ?: ChampionshipsConfig.CHAMP_WEEK_HOY_DEFAULT
        }
        if (!nowLock && wasLock) {
            // Salimos → restaurar el pin del usuario y olvidar el manual de ventana.
            champManualCategory = null
            return pinnedCategory
        }
        return _state.value.category
    }

    /**
     * Cambio de día para la animación de Hoy (mismo patrón que el cambio de mes
     * de Ciclocross): mantiene el contenido saliente, resuelve primero de caché
     * con un tope de espera para que el día entrante aparezca ya con datos y
     * deja el refresh de red en background. Sin caché cae al comportamiento de
     * `setDate` (pantalla de carga durante la entrada).
     */
    suspend fun navigateTo(requestedTarget: String) {
        // Ninguna ruta de navegación supera el último día de temporada.
        val target = TodaySeason.clamp(requestedTarget)
        val category = resolvedCategory(target)
        val prepared = withTimeoutOrNull(NAVIGATION_CACHE_TIMEOUT) {
            runCatching { repo.cachedDayData(target) }.getOrNull()
        }
        // Una fila procedente de Mes/Temporada puede carecer aún de elevación.
        // No enseñar primero la tarjeta corta y añadir el perfil a posteriori.
        val presentable = prepared?.takeIf { canPresentCachedDay(target, it) }
        _state.value = _state.value.copy(
            dateKey = target, data = presentable, nextRaceDate = null, category = category,
            isLoading = presentable == null, error = null,
        )
        load(fallbackData = prepared)
    }

    suspend fun navigateToNextDay() {
        val current = _state.value.dateKey
        val filter = _state.value.category
        val next = nextDayMatchingFilter(current, filter)
            ?: DateFormatting.nextDay(current)?.takeIf { TodaySeason.contains(it) }
        next?.let { navigateTo(it) }
    }

    /** Día al que lleva «Hoy»: la fecha actual o, tras el cierre de temporada,
     *  el último día navegable. */
    fun currentDayKey(): String = TodaySeason.clamp(DateFormatting.todayKey())

    /** False en el último día de temporada: no hay día siguiente navegable. */
    fun canGoToNextDay(dateKey: String): Boolean =
        DateFormatting.nextDay(dateKey)?.let { TodaySeason.contains(it) } ?: false

    suspend fun navigateToPreviousDay() {
        val current = _state.value.dateKey
        val filter = _state.value.category
        val prev = previousDayMatchingFilter(current, filter) ?: DateFormatting.previousDay(current)
        prev?.let { navigateTo(it) }
    }

    suspend fun navigateToNextRaceDay() {
        _state.value.nextRaceDate?.let { navigateTo(it) }
    }

    // Última fecha local que se mostró COMO "hoy". Distingue "el usuario está en
    // hoy y ha cruzado la medianoche local" (→ auto-avanzar) de "navegó a otro día
    // a mano" (→ no tocar). Se sincroniza cuando el día mostrado es hoy.
    private var lastTodayKey: String = TodaySeason.clamp(DateFormatting.todayKey())

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

    fun setCategory(cat: Constants.CategoryFilter) {
        // Solo actualiza el estado de sesión (no persiste). Dentro de la ventana de
        // Campeonatos el cambio es contextual: se recuerda para los días de la
        // ventana pero NO altera el pin del usuario.
        if (ChampionshipsConfig.isChampWeekFilterLock(_state.value.dateKey)) {
            champManualCategory = cat
        }
        val nextDate = nextDayMatchingFilter(_state.value.dateKey, cat)
        _state.value = _state.value.copy(category = cat, nextRaceDate = nextDate)
    }

    fun setSortMode(mode: SortMode) {
        _state.value = _state.value.copy(sortMode = mode)
    }

    fun setDefaultFilter(cat: Constants.CategoryFilter) {
        viewModelScope.launch { prefs.setDefaultFilter(cat) }
        val nextDate = nextDayMatchingFilter(_state.value.dateKey, cat)
        _state.value = _state.value.copy(category = cat, nextRaceDate = nextDate)
    }

    fun clearDefaultFilter() {
        viewModelScope.launch { prefs.clearDefaultFilter() }
        val cat = Constants.CategoryFilter.ALL
        val nextDate = nextDayMatchingFilter(_state.value.dateKey, cat)
        _state.value = _state.value.copy(category = cat, nextRaceDate = nextDate)
    }

    fun refresh() {
        load(force = true)
    }

    fun refreshAutomatically() {
        val current = _state.value
        if (current.dateKey != DateFormatting.todayKey() || current.isLoading) return
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
            // 2. Refresh remoto de jornadas del día
            runCatching { repo.refreshDay(key) }
                .onFailure { t ->
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
            // 3. Refresh de todas las carreras del año (necesario para placeholders)
            val year = key.substring(0, 4).toIntOrNull()
            if (year != null) {
                runCatching { repo.refreshRacesYear(year) }
                // Cachear allRaces para navegación filter-aware
                _allRaces = runCatching { repo.cachedRacesForYear(year) }
                    .getOrDefault(emptyList())
            }
            // 4. Releer caché (ahora completa) y añadir placeholders
            val fresh = runCatching { repo.cachedDayData(key) }.getOrNull()
            val featuredRaceIds = runCatching { repo.featuredRaceIds(listOf(key)) }.getOrDefault(emptySet())
            if (generation != loadGeneration || _state.value.dateKey != key) return@launch
            val withPlaceholders = if (fresh != null && year != null) {
                addPlaceholders(fresh, key, year)
            } else fresh
            val presented = withPlaceholders?.copy(featuredRaceIds = featuredRaceIds)

            // Siguiente día con carreras (respetando filtro activo)
            val filter = _state.value.category
            val nextDate = nextDayMatchingFilter(key, filter)
            _state.value = _state.value.copy(
                isLoading = false,
                isRefreshing = false,
                error = null,
                data = presented,
                refreshToken = _state.value.refreshToken + 1,
                nextRaceDate = nextDate,
            )

            // Auto-navegar si no hay items visibles. Solo con el filtro "Todas"
            // (evita saltos sorpresa cuando el usuario filtra a propósito), CON UNA
            // EXCEPCIÓN: dentro de la ventana de Campeonatos el filtro Masculino
            // está FORZADO (no lo eligió el usuario) y los días 22-23 no tienen
            // carreras → se auto-avanza igual al siguiente día con carreras
            // masculinas (el escaneo respeta el filtro activo, sin bucle).
            val visible = visibleData()
            val champLock = ChampionshipsConfig.isChampWeekFilterLock(key)
            if (!silent && (filter == Constants.CategoryFilter.ALL || champLock) &&
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
        val cat = _state.value.category
        val filtered = sortTodayAgenda(
            RaceLogic.filterByCategory(d.raceDays, cat),
            _state.value.sortMode,
            d.featuredRaceIds,
        )
        return d.copy(raceDays = filtered)
    }

    // ── Navegación filter-aware ────────────────────────────────

    /** Siguiente día con carreras que coincidan con el filtro (escanea hasta 180
     *  días, sin pasar del último día de temporada). */
    private fun nextDayMatchingFilter(
        afterDateKey: String,
        filter: Constants.CategoryFilter,
    ): String? {
        if (_allRaces.isEmpty()) return null
        var candidate = afterDateKey
        repeat(180) {
            val next = DateFormatting.nextDay(candidate)?.takeIf { TodaySeason.contains(it) } ?: return null
            candidate = next
            if (hasMatchingRaces(candidate, filter)) return candidate
        }
        return null
    }

    /** Día anterior con carreras que coincidan con el filtro (escanea hasta 180 días). */
    private fun previousDayMatchingFilter(
        beforeDateKey: String,
        filter: Constants.CategoryFilter,
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
    private fun hasMatchingRaces(dateKey: String, filter: Constants.CategoryFilter): Boolean =
        _allRaces.any { race ->
            !race.isCancelled &&
                RaceLogic.isRaceDay(race, dateKey) &&
                RaceLogic.matchesCategory(race, filter)
        }

    /** Precacheo en background de día−1 y día+1 (respetando el filtro activo,
     *  con los días ±1 como referencia si no hay carreras que cumplan el
     *  filtro): la navegación animada de Hoy resuelve primero de caché. */
    private fun prefetchNearbyDays(anchor: String, filter: Constants.CategoryFilter) {
        val neighbors = listOfNotNull(
            previousDayMatchingFilter(anchor, filter) ?: DateFormatting.previousDay(anchor),
            nextDayMatchingFilter(anchor, filter)
                ?: DateFormatting.nextDay(anchor)?.takeIf { TodaySeason.contains(it) },
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
