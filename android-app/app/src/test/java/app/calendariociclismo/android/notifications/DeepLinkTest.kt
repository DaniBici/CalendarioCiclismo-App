package app.calendariociclismo.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinkTest {
    @Test fun `market tab and team detail parse from push payload`() {
        assertEquals(DeepLink.Tab("transfers"), DeepLink.parse("transfers"))
        assertEquals(DeepLink.Team("team_123"), DeepLink.parse("team/team_123"))
    }

    @Test fun `widget results link parses stage, final and double sector`() {
        assertEquals(DeepLink.Results("race_1", 5), DeepLink.parse("results/race_1/5"))
        assertEquals(DeepLink.Results("race_1", null), DeepLink.parse("results/race_1/final"))
        assertEquals(DeepLink.Results("race_1", 3, "B"), DeepLink.parse("results/race_1/3B"))
        assertNull(DeepLink.parse("results/race_1/x"))
        assertNull(DeepLink.parse("results/race_1"))
    }

    @Test fun `team detail rejects an invalid id`() {
        assertNull(DeepLink.parse("team/team/123"))
    }
    @Test fun `cx destinations use independent ids and validated anchors`() {
        assertEquals(DeepLink.CxRace("cx_123", "WU"), DeepLink.parse("cxRace/cx_123#WU"))
        assertEquals(DeepLink.CxRace("cx_123", "general-WU"), DeepLink.parse("cxRace/cx_123#general-WU"))
        assertEquals(DeepLink.CxRace("cx_123", "inscritos-WE"), DeepLink.parse("cxRace/cx_123#inscritos-WE"))
        assertNull(DeepLink.parse("cxRace/cx/123"))
        assertNull(DeepLink.parse("cxRace/cx_123#WU?route=race"))
        assertNull(DeepLink.parse("cxRace/cx_123#MA"))
        for (name in listOf("results", "calendar", "cyclocross")) assertEquals(DeepLink.Tab(name), DeepLink.parse(name))
    }
}
