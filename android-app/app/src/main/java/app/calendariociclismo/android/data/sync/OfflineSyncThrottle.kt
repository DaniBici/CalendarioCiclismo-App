package app.calendariociclismo.android.data.sync

/**
 * Límite persistente para ejecuciones automáticas del sync offline.
 *
 * WorkManager ya aplica backoff, pero este guard también cubre sustituciones,
 * reinicios del proceso y llamadas repetidas desde distintos puntos de entrada.
 */
internal object OfflineSyncThrottle {
    const val COOLDOWN_SECONDS = 30L * 60L

    fun shouldSkip(nowEpochSeconds: Long, lastAttemptEpochSeconds: Long): Boolean {
        if (lastAttemptEpochSeconds <= 0L) return false
        return nowEpochSeconds - lastAttemptEpochSeconds < COOLDOWN_SECONDS
    }
}
