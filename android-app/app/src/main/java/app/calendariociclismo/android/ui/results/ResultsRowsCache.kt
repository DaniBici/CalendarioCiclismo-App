package app.calendariociclismo.android.ui.results

import app.calendariociclismo.android.data.model.RaceUciResultRow
import app.calendariociclismo.android.data.model.ResolvedRider
import app.calendariociclismo.android.data.model.Team
import app.calendariociclismo.android.data.repository.CalendarRepository
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async

/** Filas de una clasificación ya resueltas (corredores fuera de la startlist y equipos con override). */
internal data class ResultsRowsBundle(
    val rows: List<RaceUciResultRow>,
    val byRider: Map<String, ResolvedRider>,
    val byTeamOverride: Map<String, Team>,
)

/**
 * Caché compartida entre la tabla visible y la precarga de las clasificaciones
 * contiguas, como los días vecinos de Hoy: al deslizar, la clasificación nueva
 * entra ya pintada. Una sola petición en curso por clasificación.
 */
internal object ResultsRowsCache {
    private data class Entry(val bundle: ResultsRowsBundle, val token: Int, val savedAt: Long)

    private const val FRESHNESS_MS = 120_000L
    private val entries = ConcurrentHashMap<String, Entry>()
    private val inFlight = ConcurrentHashMap<String, Deferred<ResultsRowsBundle?>>()
    private val scope = CoroutineScope(SupervisorJob())

    fun cached(stageRef: String): ResultsRowsBundle? = entries[stageRef]?.bundle

    suspend fun bundle(
        repository: CalendarRepository,
        stageRef: String,
        token: Int,
        byDorsal: Map<Int, ResolvedRider>,
        raceYear: Int?,
    ): ResultsRowsBundle? {
        entries[stageRef]?.takeIf { it.token == token && System.currentTimeMillis() - it.savedAt < FRESHNESS_MS }
            ?.let { return it.bundle }
        val request = inFlight.getOrPut(stageRef) {
            scope.async { fetch(repository, stageRef, byDorsal, raceYear) }
        }
        val bundle = try { request.await() } finally { inFlight.remove(stageRef, request) }
        if (bundle != null) entries[stageRef] = Entry(bundle, token, System.currentTimeMillis())
        return bundle
    }

    private suspend fun fetch(
        repository: CalendarRepository,
        stageRef: String,
        byDorsal: Map<Int, ResolvedRider>,
        raceYear: Int?,
    ): ResultsRowsBundle? {
        val loaded = runCatching { repository.loadResultRows(stageRef) }.getOrNull() ?: return null
        // Enriquecer por globalRiderId las filas que NO resuelven por dorsal
        // (no-op si todas casan → byRider queda vacío). Espejo de la llamada a
        // `enrichRiders` en `renderClassification` (web).
        val unmatchedIds = loaded
            .filter { it.dorsalInt?.let { d -> byDorsal[d] } == null }
            .mapNotNull { it.globalRiderId }
        val byRider = if (unmatchedIds.isEmpty()) emptyMap()
            else repository.enrichRidersByGlobalId(
                unmatchedIds,
                includeCurrentTeam = raceYear == java.time.Year.now(java.time.ZoneId.of("Europe/Madrid")).value,
            )
        // Override de equipo: resolver los teamId de override a su equipo canónico.
        val overrideIds = loaded.mapNotNull { it.teamId }
        val byTeamOverride = if (overrideIds.isEmpty()) emptyMap()
            else repository.enrichTeamsByIds(overrideIds, raceYear)
        return ResultsRowsBundle(loaded, byRider, byTeamOverride)
    }
}
