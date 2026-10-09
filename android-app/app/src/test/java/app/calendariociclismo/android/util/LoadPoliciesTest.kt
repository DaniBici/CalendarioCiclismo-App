package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.local.entity.RaceDayEntity
import app.calendariociclismo.android.data.model.ElevationPoint
import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceUciStage
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoadPoliciesTest {
    private val profile = ElevationProfile(
        distance = 150.0,
        elevationGain = 2400,
        points = listOf(ElevationPoint(0.0, 100), ElevationPoint(150.0, 1200)),
    )
    private val race = Race(id = "race", name = "Vuelta", startDate = "2026-08-22", endDate = "2026-08-24")

    private fun day(id: String, dateKey: String, withProfile: Boolean = true, rest: Boolean = false) =
        RaceDay(id = id, raceId = "race", dateKey = dateKey, isRestDay = rest,
            elevationProfile = profile.takeIf { withProfile && !rest })

    @Test
    fun cachedRaceNeedsEveryDateAndEveryProfile() {
        val complete = listOf(
            day("d1", "2026-08-22"),
            day("d2", "2026-08-23", rest = true),
            day("d3", "2026-08-24"),
        )
        assertTrue(CachedRacePolicy.isPresentable(race, complete))
        assertFalse(CachedRacePolicy.isPresentable(race, complete.filterNot { it.id == "d2" }))
        assertFalse(CachedRacePolicy.isPresentable(race, complete.map {
            if (it.id == "d3") it.copy(elevationProfile = null) else it
        }))
        assertTrue(CachedRacePolicy.isPresentable(race, complete.map {
            if (it.id == "d3") it.copy(elevationProfile = null, profileNotViewable = true) else it
        }))
        assertFalse(CachedRacePolicy.isPresentable(race, emptyList()))
    }

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

    @Test
    fun todayRefreshesEveryMinuteOnlyAroundARunningStage() {
        val start = Instant.parse("2026-10-07T10:00:00Z")
        val stage = RaceDay(
            id = "d1", dateKey = "2026-10-07",
            neutralStartTimeUtc = "2026-10-07T10:00:00Z",
            estimatedFinishTimeUtc = "2026-10-07T14:00:00Z",
        )
        val running = start.plusSeconds(3600)
        assertFalse(TodayRefreshPolicy.shouldRefresh(running, running.minusSeconds(30), listOf(stage)))
        assertTrue(TodayRefreshPolicy.shouldRefresh(running, running.minusSeconds(60), listOf(stage)))
        // Latido de 60 s medido como 59 por retrasos y truncado: refresca igual.
        assertTrue(TodayRefreshPolicy.shouldRefresh(running, running.minusSeconds(59), listOf(stage)))
        assertFalse(TodayRefreshPolicy.shouldRefresh(running, running.minusSeconds(50), listOf(stage)))

        val awaitingResults = Instant.parse("2026-10-07T16:30:00Z")
        assertTrue(TodayRefreshPolicy.shouldRefresh(awaitingResults, awaitingResults.minusSeconds(60), listOf(stage)))

        val morning = Instant.parse("2026-10-07T07:00:00Z")
        assertFalse(TodayRefreshPolicy.shouldRefresh(morning, morning.minusSeconds(120), listOf(stage)))
        assertTrue(TodayRefreshPolicy.shouldRefresh(morning, morning.minusSeconds(15 * 60), listOf(stage)))

        assertTrue(TodayRefreshPolicy.shouldRefresh(morning, null, listOf(stage)))
        assertTrue(TodayRefreshPolicy.hasActivity(listOf(RaceDay(id = "d2", dateKey = "2026-10-07")), morning))
        assertFalse(TodayRefreshPolicy.hasActivity(listOf(stage.copy(isCancelledDay = true)), running))
    }

    @Test
    fun inhouseMapMatchesByDayAndOneDayFinal() {
        fun stage(raceDayId: String?, stageNumber: Int?, rows: Int = 10) = RaceUciStage(
            id = "s-$raceDayId-$stageNumber", raceId = "race", raceDayId = raceDayId,
            classKind = "gc", stageNumber = stageNumber, rowCount = rows,
        )
        val stages = listOf(stage("d1", 1), stage(null, null), stage("d3", 3, rows = 0))
        val map = InhouseStageMap.forDays(
            stages,
            listOf("d1" to 1, "one-day" to null, "d3" to 3, "d4" to 4),
            cancelledDayIds = setOf("d4"),
        )
        assertEquals(mapOf("d1" to 1, "one-day" to null), map)
    }
}
