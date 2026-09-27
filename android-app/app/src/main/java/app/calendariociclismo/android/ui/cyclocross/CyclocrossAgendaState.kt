package app.calendariociclismo.android.ui.cyclocross

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.data.repository.CxCached
import app.calendariociclismo.android.data.repository.CyclocrossRepository
import app.calendariociclismo.android.util.CyclocrossLogic
import java.time.LocalDate
import java.time.YearMonth
import kotlinx.coroutines.CancellationException

class CyclocrossAgendaState(private val repo: CyclocrossRepository, private val todayOverride: LocalDate? = null, val tournamentId: String? = null) {
    private val today: LocalDate get() = todayOverride ?: LocalDate.now()
    val cache = mutableStateMapOf<YearMonth, CxCached<List<CxRace>>>()
    var visibleMonths by mutableStateOf<List<YearMonth>>(emptyList())
        private set
    var activeMonth by mutableStateOf<YearMonth?>(null)
        private set
    var season by mutableStateOf(CyclocrossLogic.season(today))
        private set
    var busy by mutableStateOf(false)
        private set
    // Distingue el pull-to-refresh (indicador de la lista) de las cargas de
    // mes/apertura (barra de progreso superior), igual que Hoy en carretera.
    var isRefreshing by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var jumpDate by mutableStateOf<String?>(null)
        private set
    // Numeración n/total por torneo de la temporada (insignia de ronda).
    var rounds by mutableStateOf<Map<String, CxRound>>(emptyMap())
        private set
    private var revision = 0
    private var pendingMonth: YearMonth? = null

    /** Carga una sola vez por temporada el mapa raceId → CxRound. Fallo silencioso. */
    suspend fun loadRounds() {
        rounds = repo.rounds(season)
    }

    suspend fun open(selectedSeason: String, restoredMonth: YearMonth? = null) {
        if (selectedSeason == season && activeMonth?.let { cache[it] } != null) return
        val today = today
        val generation = ++revision
        season = selectedSeason
        cache.clear()
        error = null
        busy = true
        jumpDate = null
        pendingMonth = null
        val allowed = CyclocrossLogic.months(season)
        // Página de torneo: todas sus pruebas de la temporada en una sola lista,
        // sin selector de meses. La agenda general conserva el controlador mensual.
        if (tournamentId != null) {
            visibleMonths = allowed
            activeMonth = null
            try {
                var firstFailure: Exception? = null
                for (month in allowed) {
                    try { load(month, generation) }
                    catch (failure: Exception) {
                        if (failure is CancellationException) throw failure
                        if (firstFailure == null) firstFailure = failure
                    }
                    if (generation != revision) return
                }
                if (cache.isEmpty() && firstFailure != null) error = firstFailure.message
                val current = YearMonth.from(today).takeIf { it in allowed } ?: allowed.first()
                val next = repo.nextDate(selectedSeason, current.atDay(1).toString(), tournamentId)
                if (generation != revision) return
                jumpDate = next ?: today.toString()
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                if (generation == revision) error = failure.message
            } finally { if (generation == revision) busy = false }
            return
        }
        val restored = restoredMonth?.takeIf { it in allowed }
        val opening = restored ?: YearMonth.from(today).takeIf { it in allowed } ?: allowed.first()
        visibleMonths = listOf(opening)
        activeMonth = opening
        try {
            load(opening, generation)
            if (restored != null) return
            val date = if (YearMonth.from(today) == opening) today.toString() else opening.atDay(1).toString()
            val next = repo.nextDate(selectedSeason, date, tournamentId)
            if (generation != revision) return
            val target = next?.let { YearMonth.parse(it.take(7)) }
            if (target != null && target in allowed && target != opening) {
                load(target, generation)
                if (generation != revision) return
                visibleMonths = listOf(target)
                activeMonth = target
            }
            jumpDate = next ?: date
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            if (generation == revision) error = failure.message
        } finally { if (generation == revision) busy = false }
    }

    suspend fun selectMonth(target: YearMonth) {
        if (busy || target == activeMonth || target !in CyclocrossLogic.months(season)) return
        val generation = revision
        busy = true
        error = null
        pendingMonth = target
        try {
            if (cache[target] == null) load(target, generation)
            if (generation != revision) return
            visibleMonths = listOf(target)
            activeMonth = target
            pendingMonth = null
            jumpDate = target.atDay(1).toString()
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            if (generation == revision) error = failure.message
        } finally { if (generation == revision) busy = false }
    }
    suspend fun retry() {
        val target = pendingMonth
        if (target != null) selectMonth(target) else refresh()
    }

    private suspend fun load(month: YearMonth, generation: Int) {
        val selectedSeason = season
        repo.cachedMonth(selectedSeason, month)?.let { if (generation == revision) cache[month] = it }
        if (generation != revision) return
        val data = repo.month(selectedSeason, month)
        if (generation == revision) cache[month] = data
    }

    suspend fun refresh() {
        if (busy) return
        val generation = revision
        busy = true
        isRefreshing = true
        error = null
        try { for (month in visibleMonths) load(month, generation) }
        catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            if (generation == revision) error = failure.message
        } finally {
            isRefreshing = false
            if (generation == revision) busy = false
        }
    }

    fun consumeJump() { jumpDate = null }
}
