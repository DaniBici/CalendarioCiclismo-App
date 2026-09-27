package app.calendariociclismo.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Un documento por mes permite reemplazar también las pruebas retiradas del calendario. */
@Entity(tableName = "cx_month_cache")
data class CxMonthCacheEntity(
    @PrimaryKey val key: String,
    val seasonKey: String,
    val monthKey: String,
    val payload: String,
    val cachedAt: Long,
)

@Entity(tableName = "cx_detail_cache")
data class CxDetailCacheEntity(
    @PrimaryKey val id: String,
    val slug: String,
    val slugEn: String?,
    val payload: String,
    val cachedAt: Long,
)
