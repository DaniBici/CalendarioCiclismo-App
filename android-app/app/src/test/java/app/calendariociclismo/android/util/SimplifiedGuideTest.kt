package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.ProfileSummit
import app.calendariociclismo.android.data.model.ProfileWaypoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Horas de paso estimadas y anclas manuales de la guía simplificada de la jornada. */
class SimplifiedGuideTest {

    private val start = "2026-04-26T08:00:00.000Z"  // 10:00 CEST
    private val finish = "2026-04-26T14:20:00.000Z" // 16:20 CEST (380 min después)

    @Test
    fun interpolatesWaypointWithoutTime() {
        val rows = SimplifiedGuide.build(
            100.0, start, finish, emptyList(),
            listOf(ProfileWaypoint(km = 50.0, type = "intermediate_sprint")), null,
        )
        val sprint = rows.first { it.type == "intermediate_sprint" }
        assertTrue(sprint.isEstimated)
        assertEquals("2026-04-26T11:10:00.000Z", sprint.timeUtc)
    }

    @Test
    fun manualSummitAnchorAndEstimatedFoot() {
        val summitTime = "2026-04-26T12:00:00.000Z"
        val rows = SimplifiedGuide.build(
            100.0, start, finish,
            listOf(ProfileSummit(name = "Puerto", km = 60.0, category = "1", startKm = 50.0, timeUtc = summitTime)),
            emptyList(), null,
        )
        val s = rows.first { it.type == "summit" }
        assertEquals(summitTime, s.timeUtc)
        assertFalse(s.isEstimated)
        val foot = rows.first { it.type == "climb_foot" }
        assertEquals(50.0, foot.km, 0.0)
        assertTrue(foot.isEstimated)
        assertEquals("2026-04-26T11:20:00.000Z", foot.timeUtc)
    }

    @Test
    fun footTimeUtcUsedAsRealAnchor() {
        val footTime = "2026-04-26T11:40:00.000Z"
        val summitTime = "2026-04-26T12:00:00.000Z"
        val rows = SimplifiedGuide.build(
            100.0, start, finish,
            listOf(ProfileSummit(name = "Puerto", km = 60.0, category = "1", startKm = 50.0,
                timeUtc = summitTime, footTimeUtc = footTime)),
            emptyList(), null,
        )
        val foot = rows.first { it.type == "climb_foot" }
        // Usa la hora real del rutómetro, NO la interpolación (que daría 11:20Z)
        assertEquals(footTime, foot.timeUtc)
        assertFalse(foot.isEstimated)
        assertTrue(SimplifiedGuide.hasGuide(rows))
    }

    @Test
    fun mergesSummitAndBonusOnlyAtExactDecimalKilometer() {
        val manualTime = "2026-04-26T12:00:00.000Z"
        val rows = SimplifiedGuide.build(
            100.0, null, null,
            listOf(ProfileSummit(name = "Puerto", km = 60.5, category = "1")),
            listOf(
                ProfileWaypoint(name = "Bonificación", km = 60.5, type = "bonus_sprint", timeUtc = manualTime),
                ProfileWaypoint(name = "Sprint", km = 60.6, type = "intermediate_sprint"),
            ),
            null,
        )
        val merged = rows.first { it.type == "summit" }
        assertEquals(1, rows.count { it.km == 60.5 })
        assertEquals("bonus_sprint", merged.secondaryType)
        assertEquals("Bonificación", merged.secondaryLabel)
        assertEquals(manualTime, merged.timeUtc)
        assertTrue(rows.any { it.km == 60.6 && it.type == "intermediate_sprint" })
    }

    @Test
    fun mergesFinishWithSummitOrWaypointAtExactFinalKilometer() {
        val summitFinish = SimplifiedGuide.build(
            100.0, null, finish,
            listOf(ProfileSummit(name = "Alto de meta", km = 100.0, category = "1")),
            emptyList(), null,
        )
        assertEquals(1, summitFinish.size)
        assertEquals("summit", summitFinish[0].type)
        assertEquals("finish", summitFinish[0].secondaryType)
        assertEquals(0.0, summitFinish[0].kmToGo!!, 0.0)
        assertEquals(finish, summitFinish[0].timeUtc)
        assertTrue(summitFinish[0].isEstimated)

        val waypointFinish = SimplifiedGuide.build(
            100.0, null, finish, emptyList(),
            listOf(ProfileWaypoint(name = "Sprint de meta", km = 100.0, type = "bonus_sprint")),
            null,
        )
        assertEquals(1, waypointFinish.size)
        assertEquals("bonus_sprint", waypointFinish[0].type)
        assertEquals("finish", waypointFinish[0].secondaryType)
        assertEquals(0.0, waypointFinish[0].kmToGo!!, 0.0)
        assertEquals(finish, waypointFinish[0].timeUtc)
        assertTrue(waypointFinish[0].isEstimated)

        val withoutFinishTime = SimplifiedGuide.build(
            100.0, null, null,
            listOf(ProfileSummit(name = "Alto de meta", km = 100.0, category = "1")),
            emptyList(), null,
        )
        assertEquals(1, withoutFinishTime.size)
        assertEquals("summit", withoutFinishTime[0].type)
        assertEquals("finish", withoutFinishTime[0].secondaryType)
        assertNull(withoutFinishTime[0].timeUtc)
        assertTrue(withoutFinishTime[0].isEstimated)
    }

    @Test
    fun timeTrialNoInterpolation() {
        val splitTime = "2026-04-26T10:30:00.000Z"
        val rows = SimplifiedGuide.build(
            40.0, start, finish, emptyList(),
            listOf(
                ProfileWaypoint(km = 20.0, type = "intermediate_split", timeUtc = splitTime),
                ProfileWaypoint(km = 10.0, type = "intermediate_sprint"),
                ProfileWaypoint(km = 30.0, type = "intermediate_split"),
            ),
            "itt",
        )
        assertNull(rows.firstOrNull { it.type == "intermediate_sprint" })
        assertEquals(splitTime, rows.first { it.km == 20.0 }.timeUtc)
        assertNull(rows.first { it.km == 30.0 }.timeUtc)
    }
}
