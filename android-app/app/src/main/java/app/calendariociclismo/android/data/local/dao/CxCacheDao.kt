package app.calendariociclismo.android.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import app.calendariociclismo.android.data.local.entity.CxDetailCacheEntity
import app.calendariociclismo.android.data.local.entity.CxMonthCacheEntity

@Dao
interface CxCacheDao {
    @Query("SELECT * FROM cx_month_cache ORDER BY monthKey")
    suspend fun allMonths(): List<CxMonthCacheEntity>

    @Query("SELECT * FROM cx_detail_cache")
    suspend fun allDetails(): List<CxDetailCacheEntity>

    @Query("SELECT * FROM cx_month_cache WHERE `key` = :key LIMIT 1")
    suspend fun month(key: String): CxMonthCacheEntity?

    @Query("SELECT * FROM cx_month_cache WHERE seasonKey = :seasonKey ORDER BY monthKey")
    suspend fun months(seasonKey: String): List<CxMonthCacheEntity>

    @Query("SELECT * FROM cx_detail_cache WHERE id = :id LIMIT 1")
    suspend fun detail(id: String): CxDetailCacheEntity?

    @Query("SELECT * FROM cx_detail_cache WHERE slug = :slug OR slugEn = :slug LIMIT 1")
    suspend fun detailBySlug(slug: String): CxDetailCacheEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveMonth(month: CxMonthCacheEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveDetail(detail: CxDetailCacheEntity)

    @Query("DELETE FROM cx_month_cache")
    suspend fun clearMonths()

    @Query("DELETE FROM cx_detail_cache")
    suspend fun clearDetails()
}
