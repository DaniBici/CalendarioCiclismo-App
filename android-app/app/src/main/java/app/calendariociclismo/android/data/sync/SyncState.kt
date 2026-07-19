package app.calendariociclismo.android.data.sync

/**
 * Estado observable de la sincronización offline.
 * Expuesto como `StateFlow<SyncState>` desde `OfflineManager`.
 */
data class SyncState(
    val isSyncing: Boolean = false,
    val progress: Float = 0f, // 0f..1f
    val statusText: String? = null,
    val lastSyncEpochSeconds: Long? = null,
    val lastError: String? = null,
) {
    /** Texto legible para la UI: "Hace 3 h", etc. */
    fun lastSyncLabel(nowEpochSeconds: Long = System.currentTimeMillis() / 1000): String? {
        val last = lastSyncEpochSeconds ?: return null
        val seconds = nowEpochSeconds - last
        if (seconds < 60) return "Hace un momento"
        val minutes = seconds / 60
        if (minutes < 60) return "Hace $minutes min"
        val hours = minutes / 60
        if (hours < 24) return "Hace $hours h"
        val days = hours / 24
        return "Hace $days d"
    }
}
