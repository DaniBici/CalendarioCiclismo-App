package app.calendariociclismo.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinkTest {
    @Test fun `market tab and team detail parse from push payload`() {
        assertEquals(DeepLink.Tab("transfers"), DeepLink.parse("transfers"))
        assertEquals(DeepLink.Team("team_123"), DeepLink.parse("team/team_123"))
    }

    @Test fun `team detail rejects an invalid id`() {
        assertNull(DeepLink.parse("team/team/123"))
    }
}
