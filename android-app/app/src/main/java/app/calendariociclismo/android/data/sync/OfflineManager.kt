package app.calendariociclismo.android.data.sync

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.updateAll
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import app.calendariociclismo.android.data.model.Asset
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.prefs.AppPreferences
import app.calendariociclismo.android.data.repository.CalendarRepository
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.widget.today.TodayCyclingWidget
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.LocalDate
import java.time.YearMonth
import java.util.concurrent.TimeUnit

/**
 * Coordinador del modo offline.
 *
 * Port de `OfflineManager.swift`. Ajustes:
 *   - Persistencia de estado vía [AppPreferences] (DataStore).
 *   - Caché local vía [CalendarRepository] (Room).
 *   - Sync en background vía [OfflineSyncWorker] (WorkManager).
 *   - Estado observable como `StateFlow<SyncState>`.
 *
 * La estrategia replica la iOS:
 *   1. Próximos 14 días (vista Hoy)
 *   2. Mes actual completo (vista Mes)
 *   3. Mes siguiente completo (vista Mes)
 *   4. Temporada del año en curso (vista Temporada)
 *   5. Purga de filas con cachedAt muy antiguo
 *
 * Total de pasos: 14 + 2 + 1 = 17.
 */
class OfflineManager(
    private val appContext: Context,
    private val prefs: AppPreferences,
    private val repo: CalendarRepository,
    private val assetCache: FileAssetCache = FileAssetCache(appContext),
    private val imageCache: ImageAssetCache = ImageAssetCache(appContext),
) {
    private val TAG = "OfflineManager"
    private val syncMutex = Mutex()

    private val _state = MutableStateFlow(SyncState())
    val state: StateFlow<SyncState> = _state.asStateFlow()

    // ─── API pública ───

    suspend fun enable() {
        prefs.setOfflineEnabled(true)
        schedulePeriodic()
        runSyncNow(force = true)
    }

    suspend fun disable() {
        prefs.setOfflineEnabled(false)
        cancelPeriodic()
        repo.clearAll()
        runCatching { assetCache.clear() }
            .onFailure { Log.w(TAG, "Error limpiando caché de assets: ${it.message}") }
        runCatching { imageCache.clear() }
            .onFailure { Log.w(TAG, "Error limpiando caché de imágenes: ${it.message}") }
        _state.value = SyncState()
        prefs.recordSync(0L, "cleared")
    }

    /** Acceso a la caché de ficheros R2 (usado desde la UI de detalle de etapa). */
    fun assetCache(): FileAssetCache = assetCache

    /**
     * `true` si la fecha (formato `YYYY-MM-DD`) cae dentro de la ventana que
     * el sync mantiene al día: mes en curso o mes siguiente. Los 14 días de
     * la vista "Hoy" siempre caen dentro, así que no hace falta comprobarlos
     * aparte. El sync de temporada solo descarga `races`, no `race_days`, por
     * lo que NO lo consideramos "rango" para pull-to-refresh de jornadas.
     */
    fun isInOfflineRange(dateKey: String): Boolean {
        val parts = dateKey.split("-")
        if (parts.size < 2) return false
        val year = parts[0].toIntOrNull() ?: return false
        val month = parts[1].toIntOrNull() ?: return false
        val today = LocalDate.now()
        val current = YearMonth.of(today.year, today.monthValue)
        val next = current.plusMonths(1)
        val ym = runCatching { YearMonth.of(year, month) }.getOrNull() ?: return false
        return ym == current || ym == next
    }

    /**
     * Lanza un sync one-shot. [force] solo se usa para acciones explícitas del
     * usuario; los arranques y reintentos automáticos respetan el cooldown.
     */
    fun runSyncNow(force: Boolean = false) {
        val req = OneTimeWorkRequestBuilder<OfflineSyncWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf(KEY_FORCE_SYNC to force))
            .build()
        WorkManager.getInstance(appContext).enqueueUniqueWork(
            WORK_ONESHOT,
            // Los disparos automáticos no reinician un trabajo activo. Una
            // acción explícita sí sustituye una cola/backoff pendiente para
            // que «Actualizar ahora» nunca quede absorbido por KEEP.
            oneShotPolicy(force),
            req,
        )
    }

    /** Registra el worker periódico de 24 h con red no medida. */
    fun schedulePeriodic() {
        val req = PeriodicWorkRequestBuilder<OfflineSyncWorker>(24, TimeUnit.HOURS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.UNMETERED)
                    .setRequiresBatteryNotLow(true)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.HOURS)
            .build()
        WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
            WORK_PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            req,
        )
    }

    fun cancelPeriodic() {
        WorkManager.getInstance(appContext).cancelUniqueWork(WORK_PERIODIC)
    }

    /**
     * Ejecución real de la sincronización. Llamada desde [OfflineSyncWorker].
     *
     * Protegida por mutex para evitar ejecuciones concurrentes si el usuario
     * dispara un one-shot mientras el periódico está corriendo.
     */
    suspend fun performSync(force: Boolean = false): Result<Unit> = syncMutex.withLock {
        if (!prefs.snapshotOfflineEnabled()) {
            Log.i(TAG, "Offline deshabilitado, saltando sync")
            return@withLock Result.success(Unit)
        }

        val attemptEpoch = System.currentTimeMillis() / 1000
        val lastAttemptEpoch = prefs.snapshotLastOfflineSyncAttemptEpoch()
        if (!force && OfflineSyncThrottle.shouldSkip(attemptEpoch, lastAttemptEpoch)) {
            Log.i(
                TAG,
                "Sync automática omitida por cooldown " +
                    "(último intento hace ${attemptEpoch - lastAttemptEpoch}s)",
            )
            return@withLock Result.success(Unit)
        }
        // Persistir antes de la primera petición: también protege si Android
        // mata el proceso durante la descarga.
        prefs.setLastOfflineSyncAttemptEpoch(attemptEpoch)

        _state.value = _state.value.copy(isSyncing = true, progress = 0f, lastError = null)
        // 14 días + 2 meses + 1 temporada + 1 descarga R2 + 1 descarga imágenes +
        // 1 purga = 19
        val totalSteps = 19f
        var completed = 0f

        try {
            val todayKey = DateFormatting.todayKey()
            val today = LocalDate.now()
            val currentYear = today.year
            val currentMonth = YearMonth.from(today)
            val nextMonth = currentMonth.plusMonths(1)

            // IDs de jornadas cacheadas esta pasada (para recoger sus assets R2
            // de Room al final y purgar los ficheros huérfanos).
            val syncedRaceDayIds = mutableSetOf<String>()

            // 1. Próximos 14 días
            setStatus("Descargando agenda diaria…")
            for (offset in 0 until 14) {
                val dateKey = DateFormatting.dayOffset(todayKey, offset) ?: continue
                runCatching { repo.refreshDay(dateKey) }
                    .onFailure { Log.w(TAG, "Error día $dateKey: ${it.message}") }
                // Recoger los IDs de jornadas ahora cacheadas — incluso si la
                // llamada a refreshDay falló, puede haber datos previos válidos.
                runCatching {
                    val ids = repo.cachedRaceDaysByDate(dateKey).map { it.id }
                    syncedRaceDayIds.addAll(ids)
                }
                completed++
                publishProgress(completed / totalSteps)
            }

            // 2. Mes actual
            setStatus("Descargando mes actual…")
            downloadMonth(currentMonth)
            completed++
            publishProgress(completed / totalSteps)

            // 3. Mes siguiente
            setStatus("Descargando mes siguiente…")
            downloadMonth(nextMonth)
            completed++
            publishProgress(completed / totalSteps)

            // 4. Temporada
            setStatus("Descargando temporada…")
            runCatching { repo.refreshRacesYear(currentYear) }
                .onFailure { Log.w(TAG, "Error temporada $currentYear: ${it.message}") }
            completed++
            publishProgress(completed / totalSteps)

            // 5. Descargar ficheros R2 (PDFs, mapas, perfiles) de las jornadas
            //    cacheadas arriba — misma idea que iOS. URLs externas se
            //    descartan automáticamente (filtrado por isDownloadableR2).
            setStatus("Descargando documentación… (puede tardar 1-2 min)")
            val retainedAssetIds = mutableSetOf<String>()
            val assetsToDownload = mutableListOf<Asset>()
            val seen = HashSet<String>()
            runCatching {
                val assets = repo.cachedAssetsForRaceDays(syncedRaceDayIds.toList())
                for (asset in assets) {
                    if (!asset.isDownloadableR2) continue
                    retainedAssetIds.add(asset.id)
                    if (seen.add(asset.id)) assetsToDownload.add(asset)
                }
            }.onFailure { Log.w(TAG, "Error listando assets: ${it.message}") }
            if (assetsToDownload.isNotEmpty()) {
                runCatching { assetCache.downloadAll(assetsToDownload) }
                    .onFailure { Log.w(TAG, "Error descarga R2: ${it.message}") }
            }
            completed++
            publishProgress(completed / totalSteps)

            // 6. Descargar logos de carrera (R2) para los que aún no están en el
            //    bundle empaquetado (carreras nuevas añadidas tras el último build).
            //    Las banderas van en assets/flags/ (bundled) — no se descargan.
            setStatus("Descargando logos…")
            val retainedLogos = hashSetOf<String>()
            runCatching {
                val racesForYear = repo.cachedRacesForYear(currentYear)
                for (r in racesForYear) collectArtwork(r, retainedLogos)
                // Carreras referenciadas por jornadas cacheadas — incluye
                // cualquier carrera que no esté en `currentYear` (ej: Grandes
                // Vueltas que cruzan 2 años) y también placeholders.
                val raceIds = repo.cachedRaceIdsForRaceDays(syncedRaceDayIds.toList())
                for (id in raceIds) repo.cachedRace(id)?.let { collectArtwork(it, retainedLogos) }
            }.onFailure { Log.w(TAG, "Error recogiendo logos: ${it.message}") }
            if (retainedLogos.isNotEmpty()) {
                runCatching { imageCache.downloadLogos(retainedLogos) }
                    .onFailure { Log.w(TAG, "Error descarga logos: ${it.message}") }
            }
            completed++
            publishProgress(completed / totalSteps)

            // 7. Purga de filas viejas (>21 días → limpio) + ficheros R2 huérfanos
            //    + imágenes UI de carreras fuera de la ventana.
            setStatus("Limpiando datos antiguos…")
            val cutoff = (System.currentTimeMillis() / 1000) - 21L * 86400
            repo.purgeStale(cutoff)
            runCatching { assetCache.purge(retainedAssetIds) }
                .onFailure { Log.w(TAG, "Error purgando assets: ${it.message}") }
            runCatching { imageCache.purge(retainedLogos) }
                .onFailure { Log.w(TAG, "Error purgando imágenes: ${it.message}") }

            val now = System.currentTimeMillis() / 1000
            prefs.recordSync(now, "ok")
            // Marca el esquema de caché al día — los próximos arranques ya no
            // disparan la migración. Ver [CACHE_SCHEMA_VERSION] para historial.
            prefs.setOfflineCacheSchemaVersion(CACHE_SCHEMA_VERSION)
            // Redibujar el widget con los datos recién sincronizados
            runCatching { TodayCyclingWidget().updateAll(appContext) }
                .onFailure { Log.w(TAG, "Error actualizando widget tras sync: ${it.message}") }
            _state.value = SyncState(
                isSyncing = false,
                progress = 1f,
                statusText = null,
                lastSyncEpochSeconds = now,
                lastError = null,
            )
            return@withLock Result.success(Unit)
        } catch (t: Throwable) {
            Log.e(TAG, "Sync fallida", t)
            _state.value = _state.value.copy(
                isSyncing = false,
                statusText = null,
                lastError = t.message ?: "Error desconocido",
            )
            prefs.recordSync(System.currentTimeMillis() / 1000, "error")
            return@withLock Result.failure(t)
        }
    }

    private suspend fun downloadMonth(month: YearMonth) {
        val startKey = "%04d-%02d-01".format(month.year, month.monthValue)
        val endKey = "%04d-%02d-%02d".format(month.year, month.monthValue, month.lengthOfMonth())
        runCatching {
            repo.refreshRange(startKey, endKey)
            repo.refreshRacesYear(month.year)
        }.onFailure { Log.w(TAG, "Error mes ${month.year}-${month.monthValue}: ${it.message}") }
    }

    /** Extrae la URL del logo de una carrera hacia el set acumulador. */
    private fun collectArtwork(race: Race, logos: MutableSet<String>) {
        race.logoUrl?.takeIf { it.isNotEmpty() }?.let(logos::add)
    }

    private fun publishProgress(value: Float) {
        _state.value = _state.value.copy(progress = value.coerceIn(0f, 1f))
    }

    private fun setStatus(text: String) {
        _state.value = _state.value.copy(statusText = text)
    }

    companion object {
        const val WORK_PERIODIC = "offline_sync_periodic"
        const val WORK_ONESHOT = "offline_sync_oneshot"
        const val KEY_FORCE_SYNC = "force_sync"

        internal fun oneShotPolicy(force: Boolean): ExistingWorkPolicy =
            if (force) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP

        /**
         * Versión del esquema de caché offline. Se incrementa cuando añadimos
         * tipos de artefactos nuevos para que los usuarios que ya tenían el
         * modo offline activo disparen un sync completo en la primera apertura
         * tras actualizar la app — si no, tendrían datos incompletos hasta el
         * siguiente sync periódico (hasta 24 h).
         *
         * Historial:
         *   - 0 → inicial (solo JSON de días / meses / temporada).
         *   - 1 → añade descarga de docs R2 (PDFs, mapas, perfiles…).
         *   - 2 → añade descarga de banderas + logos de carrera.
         *   - 3 → logos bundled en assets; flags siempre bundled → se elimina
         *         la descarga de banderas del sync. Solo se descargan logos de
         *         carreras nuevas no incluidas en el bundle empaquetado.
         */
        const val CACHE_SCHEMA_VERSION = 3
    }
}
