package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.local.entity.RaceDayEntity
import app.calendariociclismo.android.data.model.ElevationPoint
import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.RaceDay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LoadPoliciesTest {
    private val profile = ElevationProfile(
        distance = 150.0,
        elevationGain = 2400,
        points = listOf(ElevationPoint(0.0, 100), ElevationPoint(150.0, 1200)),
    )

    private fun day(id: String, dateKey: String, withProfile: Boolean = true, rest: Boolean = false) =
        RaceDay(id = id, raceId = "race", dateKey = dateKey, isRestDay = rest,
            elevationProfile = profile.takeIf { withProfile && !rest })

    @Test
    fun snapshotWithoutProfileKeepsTheStoredOne() {
        val stored = RaceDayEntity.from(day("d1", "2026-08-22"), 1L)
        val slim = day("d1", "2026-08-22", withProfile = false).copy(startLocation = "Turín")

        val kept = RaceDayEntity.fromSnapshot(slim, 2L, stored, profileDayIds = setOf("d2")).toModel()
        assertEquals("Turín", kept.startLocation)
        assertEquals(profile, kept.elevationProfile)

        val replaced = RaceDayEntity.fromSnapshot(slim, 2L, stored, profileDayIds = setOf("d1")).toModel()
        assertNull(replaced.elevationProfile)

        val full = RaceDayEntity.fromSnapshot(slim, 2L, stored, profileDayIds = null).toModel()
        assertNull(full.elevationProfile)
    }
}
