package app.calendariociclismo.android.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import app.calendariociclismo.android.data.model.Broadcast

@Entity(
    tableName = "broadcasts",
    indices = [Index("raceDayId")],
)
data class BroadcastEntity(
    @PrimaryKey val id: String,
    val raceDayId: String,
    val channel: String?,
    val startTimeUtc: String?,
    val url: String?,
    val note: String?,
    val sortOrder: Int,
    val showInRevive: Boolean,
    val country: String?,
    val cachedAt: Long,
) {
    fun toModel(): Broadcast = Broadcast(
        id = id,
        raceDayId = raceDayId,
        channel = channel,
        startTimeUtc = startTimeUtc,
        url = url,
        note = note,
        sortOrder = sortOrder,
        showInRevive = showInRevive,
        country = country,
    )

    companion object {
        fun from(b: Broadcast, cachedAt: Long): BroadcastEntity = BroadcastEntity(
            id = b.id,
            raceDayId = b.raceDayId,
            channel = b.channel,
            startTimeUtc = b.startTimeUtc,
            url = b.url,
            note = b.note,
            sortOrder = b.sortOrder,
            showInRevive = b.showInRevive,
            country = b.country,
            cachedAt = cachedAt,
        )
    }
}
