package app.calendariociclismo.android.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import app.calendariociclismo.android.data.local.entity.BroadcastEntity

@Dao
interface BroadcastsDao {

    @Query("SELECT * FROM broadcasts WHERE raceDayId = :raceDayId ORDER BY startTimeUtc ASC")
    suspend fun getByRaceDay(raceDayId: String): List<BroadcastEntity>

    @Query("SELECT * FROM broadcasts WHERE raceDayId IN (:ids) ORDER BY startTimeUtc ASC")
    suspend fun getByRaceDayIds(ids: List<String>): List<BroadcastEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<BroadcastEntity>)

    @Query("DELETE FROM broadcasts WHERE raceDayId = :raceDayId")
    suspend fun deleteByRaceDay(raceDayId: String)

    @Query("DELETE FROM broadcasts WHERE raceDayId IN (:ids)")
    suspend fun deleteByRaceDayIds(ids: List<String>)

    @Query("DELETE FROM broadcasts WHERE cachedAt < :olderThan")
    suspend fun deleteStale(olderThan: Long): Int

    @Query("DELETE FROM broadcasts")
    suspend fun clear()
}
