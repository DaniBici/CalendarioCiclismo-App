package app.calendariociclismo.android.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.ProfileSummit
import app.calendariociclismo.android.data.model.ProfileWaypoint
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceDayTranslations
import kotlinx.serialization.json.Json

@Entity(
    tableName = "race_days",
    indices = [
        Index("dateKey"),
        Index("raceId"),
    ],
)
data class RaceDayEntity(
    @PrimaryKey val id: String,
    val raceId: String?,
    val dateKey: String,
    val date: String?,
    val slug: String?,
    val isRestDay: Boolean,
    val isCancelledDay: Boolean,
    val stageNumber: Int?,
    val startLocation: String?,
    val finishLocation: String?,
    val startLocationEn: String?,
    val finishLocationEn: String?,
    val distanceKm: Double?,
    val primaryType: String?,
    val secondaryType: String?,
    val neutralStartTimeUtc: String?,
    val estimatedFinishTimeUtc: String?,
    val tvStatus: String?,
    val description: String?,
    val bonuses: String?,
    val notes: String?,
    val translationsJson: String? = null,
    val editorialStatus: String,
    val hasAssets: Boolean,
    val updatedAt: String?,
    val countryCode: String?,
    val elevationProfileJson: String? = null,
    val profileSummitsJson: String? = null,
    val profileWaypointsJson: String? = null,
    val profileNotViewable: Boolean = false,
    val routeGpxUrl: String? = null,
    val cachedAt: Long,
) {
    fun toModel(): RaceDay = RaceDay(
        id = id,
        raceId = raceId,
        dateKey = dateKey,
        date = date,
        slug = slug,
        isRestDay = isRestDay,
        isCancelledDay = isCancelledDay,
        stageNumber = stageNumber,
        startLocation = startLocation,
        finishLocation = finishLocation,
        startLocationEn = startLocationEn,
        finishLocationEn = finishLocationEn,
        distanceKm = distanceKm,
        primaryType = primaryType,
        secondaryType = secondaryType,
        neutralStartTimeUtc = neutralStartTimeUtc,
        estimatedFinishTimeUtc = estimatedFinishTimeUtc,
        tvStatus = tvStatus,
        description = description,
        bonuses = bonuses,
        notes = notes,
        translations = translationsJson?.let {
            runCatching { entityJson.decodeFromString<RaceDayTranslations>(it) }.getOrNull()
        },
        editorialStatus = editorialStatus,
        hasAssets = hasAssets,
        updatedAt = updatedAt,
        countryCode = countryCode,
        elevationProfile = elevationProfileJson?.let {
            runCatching { entityJson.decodeFromString<ElevationProfile>(it) }.getOrNull()
        },
        profileSummits = profileSummitsJson?.let {
            runCatching { entityJson.decodeFromString<List<ProfileSummit>>(it) }.getOrNull()
        },
        profileWaypoints = profileWaypointsJson?.let {
            runCatching { entityJson.decodeFromString<List<ProfileWaypoint>>(it) }.getOrNull()
        },
        profileNotViewable = profileNotViewable,
        routeGpxUrl = routeGpxUrl,
    )

    companion object {
        private val entityJson = Json { ignoreUnknownKeys = true }

        fun from(rd: RaceDay, cachedAt: Long): RaceDayEntity = RaceDayEntity(
            id = rd.id,
            raceId = rd.raceId,
            dateKey = rd.dateKey,
            date = rd.date,
            slug = rd.slug,
            isRestDay = rd.isRestDay,
            isCancelledDay = rd.isCancelledDay,
            stageNumber = rd.stageNumber,
            startLocation = rd.startLocation,
            finishLocation = rd.finishLocation,
            startLocationEn = rd.startLocationEn,
            finishLocationEn = rd.finishLocationEn,
            distanceKm = rd.distanceKm,
            primaryType = rd.primaryType,
            secondaryType = rd.secondaryType,
            neutralStartTimeUtc = rd.neutralStartTimeUtc,
            estimatedFinishTimeUtc = rd.estimatedFinishTimeUtc,
            tvStatus = rd.tvStatus,
            description = rd.description,
            bonuses = rd.bonuses,
            notes = rd.notes,
            translationsJson = rd.translations?.let {
                entityJson.encodeToString(RaceDayTranslations.serializer(), it)
            },
            editorialStatus = rd.editorialStatus,
            hasAssets = rd.hasAssets,
            updatedAt = rd.updatedAt,
            countryCode = rd.countryCode,
            elevationProfileJson = rd.elevationProfile?.let { entityJson.encodeToString(ElevationProfile.serializer(), it) },
            profileSummitsJson = rd.profileSummits?.let { entityJson.encodeToString(kotlinx.serialization.builtins.ListSerializer(ProfileSummit.serializer()), it) },
            profileWaypointsJson = rd.profileWaypoints?.let { entityJson.encodeToString(kotlinx.serialization.builtins.ListSerializer(ProfileWaypoint.serializer()), it) },
            profileNotViewable = rd.profileNotViewable,
            routeGpxUrl = rd.routeGpxUrl,
            cachedAt = cachedAt,
        )
    }
}
