package app.calendariociclismo.android.widget.today

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.calendariociclismo.android.R
import app.calendariociclismo.android.widget.today.model.WidgetDayResponse
import app.calendariociclismo.android.widget.today.model.WidgetItem
import app.calendariociclismo.android.widget.today.model.WidgetSession
import app.calendariociclismo.android.widget.today.model.WidgetTv
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Duration
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35]) // Robolectric 4.14.1 soporta hasta API 35; la app compila contra 36.
class WidgetPresentationTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val es = WidgetText(context, "es")
    private val start = Instant.parse("2026-09-27T11:00:00Z")

    private fun road(
        tv: WidgetTv? = null,
        liveTextUrl: String? = null,
        hasResults: Boolean = false,
        resultsLink: String? = null,
        reviveUrl: String? = null,
    ) = WidgetItem(
        kind = "road", id = "rd", link = "calendariociclismo://stage/rd", name = "CRO Race",
        stageLabel = "Etapa 6", typeLabel = "Llana",
        startUtc = "2026-09-27T11:00:00+00:00", finishUtc = "2026-09-27T15:00:00+00:00",
        tv = tv, liveTextUrl = liveTextUrl, hasResults = hasResults,
        resultsLink = resultsLink, reviveUrl = reviveUrl,
    )

    @Test fun `live text only appears when the stage has a live text asset`() {
        val running = start.plus(Duration.ofMinutes(30))
        val noTv = road(tv = WidgetTv(status = "none"))
        assertEquals(es.s(R.string.widget_no_tv), noTv.badge(running, es)?.text)

        val withLiveText = road(tv = WidgetTv(status = "none"), liveTextUrl = "https://live.example")
        val badge = withLiveText.badge(running, es)
        assertEquals(es.s(R.string.widget_live_text), badge?.text)
        assertEquals("https://live.example", badge?.url)
    }

    @Test fun `running race without live text keeps the tv function`() {
        val tvStart = "2026-09-27T12:30:00+00:00"
        val item = road(tv = WidgetTv(status = "time", channel = "Eurosport", startUtc = tvStart))
        val before = item.badge(start.minus(Duration.ofHours(1)), es)
        assertEquals(R.drawable.ic_widget_tv, before?.icon)
        assertFalse(before!!.emphasized)
        val live = item.badge(Instant.parse("2026-09-27T12:40:00Z"), es)
        assertEquals("Live", live?.text)
        assertTrue(live!!.emphasized)
        assertNull(live.url)
    }

    @Test fun `broadcast starting with the race is shown as full race`() {
        val item = road(tv = WidgetTv(status = "time", startUtc = "2026-09-27T10:50:00+00:00"))
        assertEquals(es.s(R.string.widget_full_race), item.badge(start.minus(Duration.ofHours(2)), es)?.text)
    }

    @Test fun `finished race offers results and revive without spoilers`() {
        val item = road(
            hasResults = true,
            resultsLink = "calendariociclismo://results/race/6",
            reviveUrl = "https://youtube.com/watch?v=x",
        )
        val after = start.plus(Duration.ofHours(6))
        assertEquals(WidgetRaceState.RESULTS, item.raceState(after))
        assertNull(item.badge(after, es))
        assertEquals("calendariociclismo://results/race/6" to "https://youtube.com/watch?v=x", item.finishedActions(after))
        assertEquals("Etapa 6 · Llana", item.detailLine(after, es))
    }

    @Test fun `cyclocross shows results shortcut only after every session`() {
        val cx = WidgetItem(
            kind = "cx", id = "cx", link = "calendariociclismo://cxRace/cx", name = "Kleeberg Cross",
            hasResults = true, resultsLink = "calendariociclismo://cxRace/cx#MJ",
            sessions = listOf(
                WidgetSession("MJ", startUtc = "2026-09-27T09:00:00+00:00", finishUtc = "2026-09-27T09:40:00+00:00", hasResults = true),
                WidgetSession("ME", elite = true, startUtc = "2026-09-27T13:15:00+00:00", finishUtc = "2026-09-27T14:15:00+00:00"),
            ),
        )
        val midday = Instant.parse("2026-09-27T12:00:00Z")
        assertEquals(WidgetRaceState.LIVE, cx.raceState(midday))
        assertNull(cx.finishedActions(midday))
    }

    @Test fun `the rpc payload decodes and schedules a refresh at the next transition`() {
        val raw = """{"version":1,"generatedAt":"2026-09-27T10:25:19.123456+00:00","locale":"es","days":[
            {"date":"2099-01-01","items":[{"kind":"road","id":"rd","link":"calendariociclismo://stage/rd","name":"X",
            "state":"race","startUtc":"2099-01-01T11:00:00+00:00","tv":{"status":"time","startUtc":"2099-01-01T12:00:00+00:00"}}]}]}"""
        val response = Json { ignoreUnknownKeys = true }.decodeFromString<WidgetDayResponse>(raw)
        assertEquals(1, response.days.first().items.size)
        assertFalse(response.days.first().items.first().isCx)
        val now = Instant.now()
        val next = TodayWidgetScheduler.nextRefresh(now, response, fromCache = true)
        assertTrue(next <= now.plus(Duration.ofMinutes(30)))
    }
}
