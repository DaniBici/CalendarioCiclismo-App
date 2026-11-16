package app.calendariociclismo.android.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import app.calendariociclismo.android.data.local.entity.RaceDayVideoEntity

@Dao
interface RaceDayVideosDao {

    @Query("SELECT * FROM race_day_videos WHERE raceDayId = :raceDayId ORDER BY sortOrder ASC")
    suspend fun getByRaceDay(raceDayId: String): List<RaceDayVideoEntity>

    @Query("SELECT * FROM race_day_videos WHERE raceDayId IN (:ids) ORDER BY sortOrder ASC")
    suspend fun getByRaceDayIds(ids: List<String>): List<RaceDayVideoEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<RaceDayVideoEntity>)

    @Query("DELETE FROM race_day_videos WHERE raceDayId IN (:ids)")
    suspend fun deleteByRaceDayIds(ids: List<String>)

    @Query("DELETE FROM race_day_videos WHERE cachedAt < :olderThan")
    suspend fun deleteStale(olderThan: Long): Int

    @Query("DELETE FROM race_day_videos")
    suspend fun clear()
}
