package app.calendariociclismo.android.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import app.calendariociclismo.android.data.local.entity.RaceEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface RacesDao {

    @Query("SELECT * FROM races ORDER BY startDate ASC")
    fun observeAll(): Flow<List<RaceEntity>>

    @Query("SELECT * FROM races ORDER BY startDate ASC")
    suspend fun getAll(): List<RaceEntity>

    @Query("SELECT * FROM races WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): RaceEntity?

    @Query("SELECT * FROM races WHERE year = :year ORDER BY startDate ASC")
    suspend fun getByYear(year: Int): List<RaceEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(races: List<RaceEntity>)

    @Query("DELETE FROM races WHERE cachedAt < :olderThan")
    suspend fun deleteOlderThan(olderThan: Long): Int

    @Query("DELETE FROM races")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM races")
    suspend fun count(): Int
}
