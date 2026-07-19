package app.calendariociclismo.android.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import app.calendariociclismo.android.data.local.entity.AssetEntity

@Dao
interface AssetsDao {

    @Query("SELECT * FROM assets WHERE raceDayId = :raceDayId")
    suspend fun getByRaceDay(raceDayId: String): List<AssetEntity>

    @Query("SELECT * FROM assets WHERE raceDayId IN (:ids)")
    suspend fun getByRaceDayIds(ids: List<String>): List<AssetEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<AssetEntity>)

    @Query("DELETE FROM assets WHERE raceDayId = :raceDayId")
    suspend fun deleteByRaceDay(raceDayId: String)

    @Query("DELETE FROM assets WHERE raceDayId IN (:ids)")
    suspend fun deleteByRaceDayIds(ids: List<String>)

    @Query("DELETE FROM assets WHERE cachedAt < :olderThan")
    suspend fun deleteStale(olderThan: Long): Int

    @Query("DELETE FROM assets")
    suspend fun clear()
}
