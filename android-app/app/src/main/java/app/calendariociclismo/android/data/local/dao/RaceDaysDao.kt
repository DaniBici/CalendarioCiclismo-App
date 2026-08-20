package app.calendariociclismo.android.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import app.calendariociclismo.android.data.local.entity.RaceDayEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface RaceDaysDao {

    @Query("SELECT * FROM race_days WHERE dateKey = :dateKey")
    suspend fun getByDate(dateKey: String): List<RaceDayEntity>

    @Query("SELECT * FROM race_days WHERE dateKey BETWEEN :from AND :to ORDER BY dateKey ASC")
    fun observeByDateRange(from: String, to: String): Flow<List<RaceDayEntity>>

    @Query("SELECT * FROM race_days WHERE dateKey BETWEEN :from AND :to ORDER BY dateKey ASC")
    suspend fun getByDateRange(from: String, to: String): List<RaceDayEntity>

    @Query("SELECT * FROM race_days WHERE raceId = :raceId ORDER BY dateKey ASC")
    suspend fun getByRace(raceId: String): List<RaceDayEntity>

    @Query("SELECT * FROM race_days WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): RaceDayEntity?

    @Query("SELECT * FROM race_days WHERE id IN (:ids)")
    suspend fun getByIds(ids: List<String>): List<RaceDayEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(days: List<RaceDayEntity>)

    /**
     * Borra las jornadas de [dateKey] cuyo `id` no esté en [keepIds] (las que el
     * backend ya no devuelve para esa fecha → se borraron en origen). Con
     * [keepIds] vacío borra todas las de esa fecha (Room emite `NOT IN ()`, que
     * en SQLite es siempre verdadero). Ver `refreshDay`.
     */
    @Query("DELETE FROM race_days WHERE dateKey = :dateKey AND id NOT IN (:keepIds)")
    suspend fun deleteByDateNotIn(dateKey: String, keepIds: List<String>): Int

    /**
     * Como [deleteByDateNotIn] pero para un rango de fechas. Ver `refreshRange`.
     */
    @Query("DELETE FROM race_days WHERE dateKey BETWEEN :from AND :to AND id NOT IN (:keepIds)")
    suspend fun deleteByDateRangeNotIn(from: String, to: String, keepIds: List<String>): Int

    /** Borra las jornadas de una carrera que ya no devuelve el backend. */
    @Query("DELETE FROM race_days WHERE raceId = :raceId AND id NOT IN (:keepIds)")
    suspend fun deleteByRaceNotIn(raceId: String, keepIds: List<String>): Int

    @Query("DELETE FROM race_days WHERE dateKey < :olderThan")
    suspend fun deleteOlderThanDateKey(olderThan: String): Int

    @Query("DELETE FROM race_days WHERE cachedAt < :olderThan")
    suspend fun deleteStale(olderThan: Long): Int

    @Query("DELETE FROM race_days")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM race_days")
    suspend fun count(): Int

    @Query("SELECT MIN(dateKey) FROM race_days WHERE dateKey > :afterDateKey AND isRestDay = 0 AND isCancelledDay = 0")
    suspend fun nextRaceDateAfter(afterDateKey: String): String?
}
