package app.calendariociclismo.android.notifications

import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [35])
class CxAppLinkTest {
    @Test fun `spanish and english app links preserve category and derived standings`() {
        assertEquals(DeepLink.CxRaceSlug("cross-2026-27", "ME"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/ciclocross/cross-2026-27/#ME")))
        assertEquals(DeepLink.CxRaceSlug("cross-2026-27", "general-WU"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/en/cyclocross/cross-2026-27/#general-WU")))
        assertEquals(DeepLink.Tab("cyclocross"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/en/cyclocross/")))
        assertEquals(DeepLink.CxRace("cx_123", "WE"), DeepLink.fromUri(Uri.parse("calendariociclismo://cxRace/cx_123#WE")))
    }

    @Test fun `web sections open the same section of the race`() {
        assertEquals(DeepLink.CxRaceSlug("cross-2026", "videos"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/ciclocross/cross-2026/?view=videos")))
        assertEquals(DeepLink.CxRaceSlug("cross-2026", "programme"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/en/cyclocross/cross-2026/?view=tv")))
        assertEquals(DeepLink.CxRaceSlug("cross-2026", "general-WU"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/ciclocross/cross-2026/?view=general#WU")))
        assertEquals(DeepLink.CxRaceSlug("cross-2026", "inscritos-WE"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/ciclocross/cross-2026/inscritos/#WE")))
        assertEquals(DeepLink.CxRaceSlug("cross-2026", "MJ"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/en/cyclocross/cross-2026/results/#MJ")))
        assertEquals(DeepLink.CxRace("cx_123", "videos"), DeepLink.fromUri(Uri.parse("calendariociclismo://cxRace/cx_123#videos")))
    }

    @Test fun `tournament pages resolve series slugs for both languages`() {
        assertEquals(DeepLink.CxTournamentSlug("copa-espana"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/ciclocross/torneos/copa-espana")))
        assertEquals(DeepLink.CxTournamentSlug("copa-espana"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/ciclocross/torneos/copa-espana/")))
        assertEquals(DeepLink.CxTournamentSlug("world-cup"), DeepLink.fromUri(Uri.parse("https://calendariociclismo.app/en/cyclocross/series/world-cup/")))
    }

    @Test fun `cx app links reject other hosts protocols routes and malformed anchors`() {
        for (url in listOf(
            "https://example.org/ciclocross/cross/", "http://calendariociclismo.app/ciclocross/cross/",
            "https://calendariociclismo.app/ciclocross/cross/extra/", "https://calendariociclismo.app/ciclocross/cross%2Fother/",
            "https://calendariociclismo.app/en/ciclocross/cross/", "https://calendariociclismo.app/ciclocross/cross/#MA",
            "calendariociclismo://cxRace/cx_123/extra", "https://calendariociclismo.app:8080/ciclocross/cross/",
            "https://calendariociclismo.app/ciclocross/series/cross/", "https://calendariociclismo.app/en/cyclocross/torneos/cross/",
            "https://calendariociclismo.app/ciclocross/torneos/cross/extra/", "https://calendariociclismo.app/en/cyclocross/cross/inscritos/"
        )) assertNull(url, DeepLink.fromUri(Uri.parse(url)))
    }
}
