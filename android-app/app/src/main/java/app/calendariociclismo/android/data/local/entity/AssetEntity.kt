package app.calendariociclismo.android.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import app.calendariociclismo.android.data.model.Asset

@Entity(
    tableName = "assets",
    indices = [Index("raceDayId")],
)
data class AssetEntity(
    @PrimaryKey val id: String,
    val raceDayId: String,
    val type: String?,
    val sourceType: String?,
    val url: String?,
    val cachedAt: Long,
) {
    fun toModel(): Asset = Asset(
        id = id,
        raceDayId = raceDayId,
        type = type,
        sourceType = sourceType,
        url = url,
    )

    companion object {
        fun from(a: Asset, cachedAt: Long): AssetEntity = AssetEntity(
            id = a.id,
            raceDayId = a.raceDayId,
            type = a.type,
            sourceType = a.sourceType,
            url = a.url,
            cachedAt = cachedAt,
        )
    }
}
