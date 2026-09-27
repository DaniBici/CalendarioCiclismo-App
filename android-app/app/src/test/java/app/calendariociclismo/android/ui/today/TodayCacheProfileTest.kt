package app.calendariociclismo.android.ui.today

import app.calendariociclismo.android.data.local.entity.RaceDayEntity
import app.calendariociclismo.android.data.model.DayData
import app.calendariociclismo.android.data.model.ElevationPoint
import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.RaceDay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TodayCacheProfileTest {
    private val profile = ElevationProfile(
        distance = 100.0,
        points = listOf(ElevationPoint(0.0, 10), ElevationPoint(100.0, 100)),
    )

    @Test
    fun slimRefreshRetainsDownloadedElevationAndRealStart() {
        val complete = RaceDay(
            id = "day-1", dateKey = "2026-09-24", startLocation = "Anterior",
            realStartTimeUtc = "2026-09-24T09:00:00Z", elevationProfile = profile,
        )
        val previous = RaceDayEntity.from(complete, 1L)
        val slim = complete.copy(
            startLocation = "Actualizada", realStartTimeUtc = null, elevationProfile = null,
        )

        val merged = RaceDayEntity.fromSlim(slim, 2L, previous).toModel()

        assertEquals("Actualizada", merged.startLocation)
        assertEquals(complete.realStartTimeUtc, merged.realStartTimeUtc)
        assertEquals(profile, merged.elevationProfile)
    }

    @Test
    fun partialDayWaitsForProfilesBeforeDisplay() {
        fun data(vararg days: RaceDay) = DayData(days.map { EnrichedRaceDay(it) }, emptyMap())
        val withProfile = RaceDay("day-1", dateKey = "2026-09-24", elevationProfile = profile)
        val withoutProfile = RaceDay("day-2", dateKey = "2026-09-24")

        assertFalse(cachedTodayDayHasElevation(data(withProfile, withoutProfile)))
        assertTrue(cachedTodayDayHasElevation(data(withProfile)))
        assertTrue(cachedTodayDayHasElevation(data(withProfile, withoutProfile.copy(isRestDay = true))))
    }
}
