package app.calendariociclismo.android.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import app.calendariociclismo.android.data.model.RaceDayVideo

/** Vídeo de jornada en caché (tabla `race_day_videos` de Supabase). */
@Entity(
    tableName = "race_day_videos",
    indices = [Index("raceDayId")],
)
data class RaceDayVideoEntity(
    @PrimaryKey val id: String,
    val raceDayId: String,
    val kind: String,
    val title: String,
    val titleEn: String?,
    val channel: String?,
    val url: String,
    val embeddable: Boolean?,
    val country: String?,
    val sortOrder: Int,
    val cachedAt: Long,
) {
    fun toModel(): RaceDayVideo = RaceDayVideo(
        id = id,
        raceDayId = raceDayId,
        kind = kind,
        title = title,
        titleEn = titleEn,
        channel = channel,
        url = url,
        embeddable = embeddable,
        country = country,
        sortOrder = sortOrder,
    )

    companion object {
        fun from(v: RaceDayVideo, cachedAt: Long): RaceDayVideoEntity = RaceDayVideoEntity(
            id = v.id,
            raceDayId = v.raceDayId,
            kind = v.kind,
            title = v.title,
            titleEn = v.titleEn,
            channel = v.channel,
            url = v.url,
            embeddable = v.embeddable,
            country = v.country,
            sortOrder = v.sortOrder,
            cachedAt = cachedAt,
        )
    }
}
