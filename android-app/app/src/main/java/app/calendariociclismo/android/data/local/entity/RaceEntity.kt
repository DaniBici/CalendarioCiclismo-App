package app.calendariociclismo.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import app.calendariociclismo.android.data.model.Race

/**
 * Representación local de [Race] en Room.
 *
 * Notas:
 * - `cachedAt` es el epoch seconds del momento en que se guardó la fila.
 *   Lo usa [app.calendariociclismo.android.data.sync.OfflineManager] para decidir
 *   qué datos refrescar y qué datos purgar.
 */
@Entity(tableName = "races")
data class RaceEntity(
    @PrimaryKey val id: String,
    val name: String,
    val nameEn: String? = null,
    val abbrev: String?,
    val uciCategory: String?,
    val gender: String?,
    val raceFormat: String?,
    val countryCode: String?,
    val colorHex: String?,
    val logoUrl: String?,
    val websiteUrl: String?,
    val fcId: Int?,
    val pcsSlug: String?,
    val hideFlag: Boolean,
    val isGrandTour: Boolean,
    val isNoClickable: Boolean,
    val isCancelled: Boolean,
    val startDate: String?,
    val endDate: String?,
    val year: Int?,
    val slug: String?,
    val originalName: String?,
    val startlistImportedAt: String?,
    val startlistProvisional: Boolean = false,
    val createdAt: String?,
    val cachedAt: Long,
) {
    fun toModel(): Race = Race(
        id = id,
        name = name,
        nameEn = nameEn,
        abbrev = abbrev,
        uciCategory = uciCategory,
        gender = gender,
        raceFormat = raceFormat,
        countryCode = countryCode,
        colorHex = colorHex,
        logoUrl = logoUrl,
        websiteUrl = websiteUrl,
        fcId = fcId,
        pcsSlug = pcsSlug,
        hideFlag = hideFlag,
        isGrandTour = isGrandTour,
        isNoClickable = isNoClickable,
        isCancelled = isCancelled,
        startDate = startDate,
        endDate = endDate,
        year = year,
        slug = slug,
        originalName = originalName,
        startlistImportedAt = startlistImportedAt,
        startlistProvisional = startlistProvisional,
        createdAt = createdAt,
    )

    companion object {
        fun from(race: Race, cachedAt: Long): RaceEntity = RaceEntity(
            id = race.id,
            name = race.name,
            nameEn = race.nameEn,
            abbrev = race.abbrev,
            uciCategory = race.uciCategory,
            gender = race.gender,
            raceFormat = race.raceFormat,
            countryCode = race.countryCode,
            colorHex = race.colorHex,
            logoUrl = race.logoUrl,
            websiteUrl = race.websiteUrl,
            fcId = race.fcId,
            pcsSlug = race.pcsSlug,
            hideFlag = race.hideFlag,
            isGrandTour = race.isGrandTour,
            isNoClickable = race.isNoClickable,
            isCancelled = race.isCancelled,
            startDate = race.startDate,
            endDate = race.endDate,
            year = race.year,
            slug = race.slug,
            originalName = race.originalName,
            startlistImportedAt = race.startlistImportedAt,
            startlistProvisional = race.startlistProvisional,
            createdAt = race.createdAt,
            cachedAt = cachedAt,
        )
    }
}
