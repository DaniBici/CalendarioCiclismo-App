package app.calendariociclismo.android.data.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.calendariociclismo.android.CalendarioCiclismoApp

/**
 * Ejecuta [OfflineManager.performSync] bajo WorkManager.
 *
 * Configurado como periódico cada 24 h con `NetworkType.UNMETERED` +
 * `requiresBatteryNotLow`. También se usa en modo one-shot cuando el usuario
 * pulsa "Actualizar ahora" en ajustes.
 */
class OfflineSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? CalendarioCiclismoApp
            ?: return Result.failure()
        // Un reintento de WorkManager nunca conserva el bypass manual: si la
        // primera pasada falló, el cooldown persistente corta el bucle.
        val force = inputData.getBoolean(OfflineManager.KEY_FORCE_SYNC, false) &&
            runAttemptCount == 0
        val result = app.offlineManager.performSync(force = force)
        return if (result.isSuccess) Result.success() else Result.retry()
    }
}
