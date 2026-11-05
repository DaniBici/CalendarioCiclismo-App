package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.local.dao.CxCacheDao
import app.calendariociclismo.android.data.local.entity.CxDetailCacheEntity
import app.calendariociclismo.android.data.local.entity.CxMonthCacheEntity
import app.calendariociclismo.android.data.model.*
import app.calendariociclismo.android.data.repository.CxRemote
import app.calendariociclismo.android.data.repository.CyclocrossRepository
import java.time.LocalDate
import java.time.YearMonth
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class CyclocrossTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val race = CxRace("cx-1", "Prueba local", slug = "prueba", slugEn = "test", seasonKey = "2026-27", dateKey = "2027-01-29", endDateKey = "2027-01-31", raceClass = "CM",
        categories = listOf(CxCategory("ME", "2027-01-31T14:00:00Z", "2027-01-31", durationFormat = "individual", durationRuleVersion = "2026-07-01", durationMinutes = 60), CxCategory("WE", dateKey = "2027-01-30")))

    @Test fun `los tiempos MM SS 00 de DataRide se muestran desde timeSeconds como en la web`() {
        val winner = CxResult(1, "rochester", "ME", rank = 1, riderDisplay = "Winner", timeText = "57:41:00", timeSeconds = 3461)
        val rows = listOf(winner, winner.copy(id = 2, rank = 2, timeText = "57:53:00", gapText = "+12", timeSeconds = 3473),
            winner.copy(id = 3, rank = 3, timeText = "58:15:00", gapText = "+34", timeSeconds = 3495))
        val vm = CxPresentation.resultRows(rows, java.util.Locale("es"))
        assertEquals("57:41", vm[0].valueText)
        assertEquals("+12\"", vm[1].valueText)
        assertEquals("+34\"", vm[2].valueText)
    }

    @Test fun `los tiempos CX e IRM usan carretera y LAP conserva el puesto`() {
        val winner = CxResult(1, "canmore", "MJ", rank = 1, riderDisplay = "Winner", timeText = "42:09.2")
        val rows = listOf(winner, winner.copy(id = 2, rank = 2, timeText = "42:09.3"),
            winner.copy(id = 3, rank = 3, timeText = "42:39.7"), winner.copy(id = 4, rank = 4, timeText = "42:39.9"),
            winner.copy(id = 5, rank = 5, irm = "LAP", gapText = "-2 LAPS"),
            winner.copy(id = 6, rank = 6, irm = "DNF", timeText = "7:16.9"))
        val vm = CxPresentation.resultRows(rows, java.util.Locale("es"))
        assertEquals("42:09", vm[0].valueText)
        assertEquals(UciResultsLogic.ValueKind.SAME_TIME, vm[1].valueKind)
        assertEquals("+30\"", vm[2].rowGap)
        assertEquals(vm[2].rowGap, vm[3].rowGap)
        assertEquals("-2 vueltas", vm[4].valueText)
        assertEquals(5, vm[4].rank)
        assertNull(vm[5].rank)
        assertEquals("ABN", vm[5].rankBadge)
        assertEquals("", vm[5].valueText)
        assertEquals("-2 laps", CxPresentation.resultRow(rows[4], java.util.Locale.UK).valueText)
        assertEquals(2, CxPresentation.lapsLost(rows[4].copy(gapText = null, timeText = "'- 2'")))
        assertNull(CxPresentation.lapsLost(winner.copy(timeText = "2")))
        assertEquals("53:30", CxPresentation.resultRow(winner.copy(timeText = null, timeSeconds = 3210), java.util.Locale.UK).valueText)
    }

    @Test fun `general previa se sustituye solo por publicacion que incluye la ronda actual`() {
        val scheme = json.parseToJsonElement("""{"categories":{"ME":{"mode":"time"},"WU":{"mode":"points","extras":{"derived":{"fromCategory":"ME"}}}}}""") as kotlinx.serialization.json.JsonObject
        val configured = race.copy(tournament = CxTournament("t", "X2O", slug = "x2o", pointsScheme = scheme), categories = race.categories.map { it.copy(resultsStatus = "official") })
        val rows = listOf(CxStanding("s", "t", "2026-27", "ME", 1, "Rider", timeSeconds = 90061), CxStanding("u", "t", "2026-27", "WU", 1, "Rider", points = 50.0))
        val prior = listOf(CxStandingState("ME", "ready", listOf("prior")), CxStandingState("WU", "ready", listOf("prior")))
        val before = CxDetail(configured, standings = rows, standingsState = prior)
        assertEquals(listOf("ME", "WU"), CxPresentation.generalCategories(before))
        val after = before.copy(results = listOf(CxResult(1, race.id, "ME", rank = 1, riderDisplay = "Rider")))
        assertTrue(CxPresentation.generalCategories(after).isEmpty())
        val updated = after.copy(standingsState = listOf(CxStandingState("ME", "ready", listOf(race.id)), CxStandingState("WU", "manual", listOf(race.id))))
        assertEquals(listOf("ME", "WU"), CxPresentation.generalCategories(updated))
        assertTrue(CxPresentation.generalCategories(after.copy(standingsState = listOf(CxStandingState("ME", "needs_review", listOf(race.id))))).isEmpty())
        assertEquals(listOf("ME", "WU"), CxPresentation.generalCategories(before.copy(standingsState = emptyList())))
        assertTrue(CxPresentation.generalCategories(after.copy(standingsState = emptyList())).isEmpty())
        assertFalse("WU" in CxPresentation.actualCategories(before))
    }

    @Test fun `resultados admiten dorsal textual bigint y bono desconocido frente a cero`() {
        val row = json.decodeFromString<CxResult>("""{"id":9007199254740993,"raceId":"cx-1","category":"ME","bib":"A12","riderDisplay":"Corredor local","timeSeconds":90061,"bonusSeconds":null,"irm":"DF"}""")
        assertEquals(9007199254740993L, row.id)
        assertEquals("A12", row.bib)
        assertNull(row.bonusSeconds)
        assertEquals(0, row.copy(bonusSeconds = 0).bonusSeconds)
        assertEquals("25:01:01", CyclocrossLogic.duration(row.timeSeconds))
        assertEquals("-", CyclocrossLogic.duration(null))
        assertEquals(row, json.decodeFromString<CxResult>(json.encodeToString(row)))
    }

    @Test fun `offline guarda solo mes solicitado reemplaza retiradas y conserva ficha y slug EN`() = runBlocking {
        val dao = MemoryDao()
        val remote = FakeRemote(race)
        val repo = CyclocrossRepository(dao, remote)
        val month = YearMonth.of(2027, 1)
        assertFalse(repo.month("2026-27", month).offline)
        repo.detail(race.id)
        remote.failure = IllegalStateException("sin conexión")
        assertTrue(repo.month("2026-27", month).offline)
        assertTrue(repo.detail(race.id)!!.offline)
        assertEquals(race, repo.cachedDetail(race.id)!!.data.race)
        assertEquals(race.id, repo.raceIdForSlug("test"))
        assertEquals("2027-01-30", repo.nextDate("2026-27", "2027-01-29"))
        assertEquals(listOf(month, month), remote.monthCalls)
        remote.failure = null
        remote.rows = emptyList()
        assertTrue(repo.month("2026-27", month).data.isEmpty())
        remote.failure = CancellationException("cancelado")
        try { repo.month("2026-27", month); fail("No debe ocultar cancelación con datos cacheados") } catch (_: CancellationException) { }
    }

    @Test fun `agenda de torneo filtra la cache compartida y recupera la proxima fecha offline`() = runBlocking {
        val own = race.copy(id = "own", tournamentId = "t")
        val remote = FakeRemote(race).also { it.rows = listOf(race, own) }
        val dao = MemoryDao()
        val repo = CyclocrossRepository(dao, remote)
        val state = app.calendariociclismo.android.ui.cyclocross.CyclocrossAgendaState(repo, { LocalDate.parse("2027-01-29") }, tournamentId = "t")
        state.open("2026-27")
        assertEquals(2, dao.months["2026-27:2027-01"]?.let { json.decodeFromString<List<CxRace>>(it.payload).size })
        remote.failure = IllegalStateException("sin conexión")
        assertEquals("2027-01-30", repo.nextDate("2026-27", "2027-01-29", "t"))
        assertNull(repo.nextDate("2026-27", "2027-01-29", "absent"))
        val jump = state.jumpDate
        assertEquals("2027-01-30", jump)
        state.refresh()
        assertEquals(jump, state.jumpDate)
        assertEquals(CyclocrossLogic.months("2026-27").toSet(), state.cache.keys)
    }

    private class FakeRemote(private val race: CxRace) : CxRemote {
        var rows = listOf(race)
        var failure: Exception? = null
        val monthCalls = mutableListOf<YearMonth>()
        override suspend fun cxMonth(season: String, month: YearMonth): List<CxRace> { monthCalls.add(month); failure?.let { throw it }; return rows }
        override suspend fun cxSeasonIndex(season: String): List<CxRace> { failure?.let { throw it }; return rows }
        override suspend fun cxDay(season: String, dateKey: String): List<CxRace> {
            failure?.let { throw it }
            return rows.filter { dateKey in CyclocrossLogic.dates(it) }
        }
        override suspend fun cxNextDate(season: String, date: String): String? { failure?.let { throw it }; return "2027-01-30" }
        override suspend fun cxDetail(id: String): CxDetail? { failure?.let { throw it }; return CxDetail(race) }
        override suspend fun cxRaceForSlug(slug: String): CxRace? { failure?.let { throw it }; return race }
        override suspend fun cxSeasonRounds(season: String): Map<String, CxRound> = emptyMap()
    }

    @Test fun `numeracion de rondas por torneo sigue el orden del contrato de generales`() {
        val rows = listOf(
            CxRoundRow("oct-late", "t1", "2026-10-03", "2026-27", categories = listOf(CxRoundEntry("2026-10-04", "2026-10-04T15:00:00Z"))),
            CxRoundRow("sin-torneo", null, "2026-10-03", "2026-27"),
            CxRoundRow("cancelada", "t1", "2026-10-02", "2026-27", isCancelled = true),
            CxRoundRow("sin-hora", "t1", "2026-10-03", "2026-27", categories = listOf(CxRoundEntry("2026-10-04"))),
            CxRoundRow("oct-early", "t1", "2026-10-03", "2026-27", categories = listOf(CxRoundEntry("2026-10-04", "2026-10-04T13:00:00Z"), CxRoundEntry("2026-10-04", "2026-10-04T11:00:00Z"))),
            CxRoundRow("fuera", "t1", "2027-03-01", "2026-27"),
            CxRoundRow("nov", "t1", "2026-11-01", "2026-27"),
            CxRoundRow("otra-temporada", "t1", "2025-10-01", "2025-26"),
            CxRoundRow("b", "t2", "2026-10-04", "2026-27"),
            CxRoundRow("a", "t2", "2026-10-04", "2026-27"),
            CxRoundRow("solitaria", "t3", "2026-12-05", "2026-27", categories = listOf(CxRoundEntry("2027-03-01", "2027-03-01T11:00:00Z"))),
        )
        val rounds = CyclocrossLogic.tournamentRounds(rows, "2026-27")
        assertEquals(CxRound(1, 4), rounds["oct-early"])
        assertEquals(CxRound(2, 4), rounds["oct-late"])
        assertEquals(CxRound(3, 4), rounds["sin-hora"])
        assertEquals(CxRound(4, 4), rounds["nov"])
        assertNull(rounds["cancelada"]); assertNull(rounds["fuera"]); assertNull(rounds["sin-torneo"]); assertNull(rounds["otra-temporada"])
        assertEquals(CxRound(1, 2), rounds["a"]); assertEquals(CxRound(2, 2), rounds["b"])
        assertEquals(CxRound(1, 1), rounds["solitaria"])
    }

    private class MemoryDao : CxCacheDao {
        val months = mutableMapOf<String, CxMonthCacheEntity>()
        val details = mutableMapOf<String, CxDetailCacheEntity>()
        override suspend fun allMonths() = months.values.toList()
        override suspend fun allDetails() = details.values.toList()
        override suspend fun month(key: String) = months[key]
        override suspend fun months(seasonKey: String) = months.values.filter { it.seasonKey == seasonKey }
        override suspend fun detail(id: String) = details[id]
        override suspend fun detailBySlug(slug: String) = details.values.firstOrNull { it.slug == slug || it.slugEn == slug }
        override suspend fun saveMonth(month: CxMonthCacheEntity) { months[month.key] = month }
        override suspend fun saveDetail(detail: CxDetailCacheEntity) { details[detail.id] = detail }
        override suspend fun clearMonths() { months.clear() }
        override suspend fun clearDetails() { details.clear() }
    }
}
