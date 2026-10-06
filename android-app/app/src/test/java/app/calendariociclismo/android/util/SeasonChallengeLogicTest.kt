package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.ChallengeGroup
import app.calendariociclismo.android.data.model.Race
import org.junit.Assert.assertEquals
import org.junit.Test

/** Espejo de `SeasonChallengeLogicTests.swift` (iOS). */
class SeasonChallengeLogicTest {

    @Test
    fun entries_groupMembersAtFirstRaceAndKeepSingleMemberLoose() {
        val races = listOf(
            race("a", "2027-01-22"), race("m1", "2027-01-23"), race("b", "2027-01-24"),
            race("m2", "2027-01-24"), race("w1", "2027-01-25"),
        )
        val groups = listOf(
            ChallengeGroup(id = "men", name = "Challenge Mallorca", raceIds = listOf("m1", "m2", "m3")),
            ChallengeGroup(id = "women", name = "Challenge Mallorca femenina", raceIds = listOf("w1", "w2")),
        )
        val ids = SeasonChallengeLogic.entries(races, groups).map { entry ->
            when (entry) {
                is SeasonEntry.Single -> entry.race.id
                is SeasonEntry.Challenge -> "${entry.group.id}:${entry.races.joinToString(",") { it.id }}"
            }
        }
        assertEquals(listOf("a", "men:m1,m2", "b", "w1"), ids)
    }

    @Test
    fun groupingStartDates_moveMembersToFirstRaceMonth() {
        val races = listOf(race("m1", "2027-01-31"), race("m2", "2027-02-01"), race("x", "2027-02-01"))
        val groups = listOf(ChallengeGroup(id = "g", name = "Challenge", raceIds = listOf("m1", "m2")))
        assertEquals(
            mapOf("m1" to "2027-01-31", "m2" to "2027-01-31"),
            SeasonChallengeLogic.groupingStartDates(races, groups),
        )
    }

    private fun race(id: String, startDate: String) =
        Race(id = id, name = id, uciCategory = "1.1", raceFormat = "one_day", startDate = startDate, year = 2027)
}
