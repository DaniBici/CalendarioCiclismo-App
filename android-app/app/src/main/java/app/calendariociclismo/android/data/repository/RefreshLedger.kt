package app.calendariociclismo.android.data.repository

/**
 * Registro en memoria de las últimas descargas completas por clave (día, mes,
 * año de carreras, carrera). Permite omitir una consulta repetida dentro de
 * su TTL sin afectar al refresco manual, que siempre fuerza la red.
 *
 * Vive lo que dura el proceso: tras un arranque en frío la primera consulta de
 * cada clave vuelve a ir a la red.
 */
class RefreshLedger(private val clock: () -> Long) {
    private val fetchedAt = HashMap<String, Long>()

    /** `true` si [key] se descargó hace menos de [ttlSeconds] segundos. */
    @Synchronized
    fun isFresh(key: String, ttlSeconds: Long): Boolean {
        val at = fetchedAt[key] ?: return false
        val age = clock() - at
        return age in 0 until ttlSeconds
    }

    @Synchronized
    fun mark(key: String) {
        fetchedAt[key] = clock()
    }

    @Synchronized
    fun clear() {
        fetchedAt.clear()
    }

    companion object {
        fun dayKey(dateKey: String) = "day:$dateKey"
        fun monthKey(from: String, to: String) = "month:$from:$to"
        fun racesYearKey(year: Int) = "races:$year"
        fun raceKey(raceId: String) = "race:$raceId"
    }
}
