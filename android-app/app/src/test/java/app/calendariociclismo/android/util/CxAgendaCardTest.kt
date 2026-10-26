package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.local.dao.CX_FEATURED_CACHE_KEY
import app.calendariociclismo.android.data.local.dao.CxCacheDao
import app.calendariociclismo.android.data.local.entity.CxDetailCacheEntity
import app.calendariociclismo.android.data.local.entity.CxMonthCacheEntity
import app.calendariociclismo.android.data.model.CxBroadcast
import app.calendariociclismo.android.data.model.CxCategory
import app.calendariociclismo.android.data.model.CxDetail
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxVideo
import app.calendariociclismo.android.data.repository.CxRemote
import app.calendariociclismo.android.data.repository.CyclocrossRepository
import app.calendariociclismo.android.ui.cyclocross.CyclocrossAgendaState
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.util.Locale
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Tarjeta de la agenda CX (badges de TV y dorsales) y orden de las destacadas. */
class CxAgendaCardTest {
    @Before fun spanish() { LocaleHolder.current = Locale("es", "ES") }

    private val day = "2026-11-22"
    // Sin duración verificada: conclusión a la salida + 60 + 30 min.
    private val race = CxRace("cx", "Prueba", slug = "prueba", seasonKey = "2026-27", dateKey = day, raceClass = "C1",
        categories = listOf(
            CxCategory("WE", "2026-11-22T13:00:00Z", day),
            CxCategory("ME", "2026-11-22T14:30:00Z", day),
        ))

    private fun tv(id: String, start: String?, category: String? = null, order: Int = 0, url: String = "https://tv.example/$id") =
        CxBroadcast(id, "cx", category = category, channel = id, startTimeUtc = start, url = url, sortOrder = order)

    private fun clip(id: String, category: String? = null, order: Int = 0, url: String = "https://www.youtube.com/watch?v=${id.padEnd(11, 'x')}") =
        CxVideo(id, "cx", category = category, title = id, url = url, sortOrder = order)

    @Test fun `el badge de resumen solo aplica a videos del dia`() {
        fun summary(videos: List<CxVideo>, date: String = day, cancelled: Boolean = false) =
            CxPresentation.agendaVideo(race.copy(videos = videos, isCancelled = cancelled), date)?.id
        assertEquals("a", summary(listOf(clip("b", order = 1), clip("a", category = "WE"))))
        assertNull(summary(listOf(clip("mj", category = "MJ"))))
        assertNull(summary(listOf(clip("x", url = "https://example.org/video"))))
        assertNull(summary(emptyList()))
        assertNull(summary(listOf(clip("a")), date = "2026-11-23"))
        assertNull(summary(listOf(clip("a")), cancelled = true))
    }

    private fun at(time: String) = Instant.parse("2026-11-22T${time}:00Z")

    @Test fun `badge de TV con la hora de la primera emision hasta que empieza`() {
        val rows = listOf(tv("b2", "2026-11-22T14:25:00Z", "ME", 1), tv("b1", "2026-11-22T12:55:00Z"))
        val before = CxPresentation.agendaBroadcast(race, day, rows, at("12:00"))!!
        assertEquals("b1", before.broadcast.id)
        assertEquals("2026-11-22T12:55:00Z", before.firstStartUtc)
        assertFalse(before.live)
        val started = CxPresentation.agendaBroadcast(race, day, rows, at("13:10"))!!
        assertTrue(started.live)
        assertEquals("b1", started.broadcast.id)
    }

    @Test fun `el enlace pasa a la ultima emision iniciada y el badge sigue en directo`() {
        val rows = listOf(tv("b0", "2026-11-22T12:50:00Z", "WE"), tv("b1", "2026-11-22T12:55:00Z", order = 1), tv("b2", "2026-11-22T14:25:00Z", "ME", 2))
        val second = CxPresentation.agendaBroadcast(race, day, rows, at("14:26"))!!
        assertEquals("b2", second.broadcast.id)
        assertEquals("2026-11-22T12:50:00Z", second.firstStartUtc)
        assertTrue(second.live)
        // WE ya concluida: su emisión deja de enlazarse, pero fija la primera hora.
        val later = CxPresentation.agendaBroadcast(race, day, rows.filter { it.id != "b2" }, at("15:00"))!!
        assertEquals("b1", later.broadcast.id)
        assertEquals("2026-11-22T12:50:00Z", later.firstStartUtc)
        assertTrue(later.live)
    }

    @Test fun `sin categorias en directo no hay badge de TV`() {
        val rows = listOf(tv("b1", "2026-11-22T12:55:00Z"))
        assertNull(CxPresentation.agendaBroadcast(race, day, rows, at("16:01")))
        val finished = race.copy(categories = listOf(race.categories[0].copy(resultsStatus = "official"), race.categories[1].copy(isCancelled = true)))
        assertNull(CxPresentation.agendaBroadcast(finished, day, rows, at("13:30")))
        assertNull(CxPresentation.agendaBroadcast(race.copy(isCancelled = true), day, rows, at("12:00")))
        assertNull(CxPresentation.agendaBroadcast(race, day, emptyList(), at("12:00")))
        // Emisión solo de una categoría ya concluida.
        assertNull(CxPresentation.agendaBroadcast(race, day, listOf(tv("we", "2026-11-22T12:50:00Z", "WE")), at("14:31")))
    }

    @Test fun `sin horas el badge enlaza la primera por orden y no entra en directo`() {
        val rows = listOf(tv("b", null, order = 2), tv("a", null, order = 1), tv("roto", null, order = 0, url = "javascript:alert(1)"))
        val badge = CxPresentation.agendaBroadcast(race, day, rows, at("13:30"))!!
        assertEquals("a", badge.broadcast.id)
        assertNull(badge.firstStartUtc)
        assertFalse(badge.live)
    }

    @Test fun `badge de dorsales en la primera categoria con lista pendiente`() {
        val withLists = race.copy(categories = listOf(
            race.categories[0].copy(startlistImportedAt = "2026-11-20T10:00:00Z", resultsStatus = "official"),
            race.categories[1].copy(startlistImportedAt = "2026-11-20T10:00:00Z"),
        ))
        assertEquals("ME", CxPresentation.agendaStartlistCategory(withLists, day, at("12:00"))?.category)
        assertNull(CxPresentation.agendaStartlistCategory(race, day, at("12:00")))
        assertNull(CxPresentation.agendaStartlistCategory(withLists.copy(isCancelled = true), day, at("12:00")))
    }

    @Test fun `la destacada encabeza su dia y el resto conserva el orden canonico`() {
        val cdm = race.copy(id = "cdm", name = "Copa", raceClass = "CDM")
        val c1 = race.copy(id = "c1", name = "Uno")
        val c2a = race.copy(id = "c2a", name = "A", raceClass = "C2")
        val c2b = race.copy(id = "c2b", name = "B", raceClass = "C2")
        val races = listOf(c2b, c1, cdm, c2a)
        assertEquals(listOf("cdm", "c1", "c2a", "c2b"), CyclocrossLogic.racesOn(races, day).map { it.id })
        assertEquals(listOf("c2b", "cdm", "c1", "c2a"), CyclocrossLogic.racesOn(races, day, setOf("c2b")).map { it.id })
        assertEquals(listOf("c2a", "c2b", "cdm", "c1"), CyclocrossLogic.racesOn(races, day, setOf("c2b", "c2a")).map { it.id })
    }

    @Test fun `el dia se ordena por categoria, hora de TV u hora de meta como Hoy de carretera`() {
        fun at(time: String) = "${day}T$time:00Z"
        val races = listOf(
            race.copy(id = "c2", name = "B", raceClass = "C2", categories = listOf(CxCategory("ME", at("09:00"), day)), broadcasts = listOf(tv("c2", null))),
            race.copy(id = "c2x", name = "A", raceClass = "C2", isCancelled = true, categories = listOf(CxCategory("ME", at("08:00"), day)), broadcasts = listOf(tv("c2x", at("07:00")))),
            race.copy(id = "cdm", name = "Copa", raceClass = "CDM", categories = listOf(CxCategory("ME", at("14:30"), day))),
            race.copy(id = "c1", name = "C", raceClass = "C1", categories = listOf(CxCategory("WE", at("10:00"), day), CxCategory("ME", at("12:00"), day)),
                broadcasts = listOf(tv("c1", at("11:50")))),
        )
        fun ids(sort: CxAgendaSort) = CxPresentation.agendaRaces(races, day, setOf("cdm"), sort) { setOf("ALL") }.map { it.id }
        assertEquals(listOf("cdm", "c1", "c2x", "c2"), ids(CxAgendaSort.CATEGORY))
        // TV con hora, TV sin hora y sin TV (la cancelada); a igualdad, el canónico sin destacadas.
        assertEquals(listOf("c1", "c2", "cdm", "c2x"), ids(CxAgendaSort.TV_TIME))
        // Fin de la última manga (60 min sin duración verificada); la cancelada, al final.
        assertEquals(listOf("c2", "c1", "cdm", "c2x"), ids(CxAgendaSort.FINISH_TIME))
    }

    @Test fun `la pestana de resultados pone las destacadas primero dentro de cada dia`() {
        fun done(id: String, raceClass: String, date: String) = race.copy(id = id, name = id, raceClass = raceClass, dateKey = date,
            categories = listOf(CxCategory("ME", dateKey = date, resultsStatus = "official", winnerName = "Ganador")))
        val races = listOf(done("cdm", "CDM", day), done("c2", "C2", day), done("ayer", "C2", "2026-11-21"))
        val days = CxResultsFeedLogic.days(races, "2026-27", setOf("c2", "ayer"))
        assertEquals(listOf(day, "2026-11-21"), days.map { it.date })
        assertEquals(listOf("c2", "cdm"), days[0].entries.map { it.race.id })
    }

    @Test fun `la agenda ordena con las destacadas y un fallo de su lectura deja el orden canonico`() = runBlocking {
        val cdm = race.copy(id = "cdm", raceClass = "CDM")
        val c2 = race.copy(id = "c2", raceClass = "C2")
        val remote = Remote(listOf(cdm, c2))
        val state = CyclocrossAgendaState(CyclocrossRepository(MemoryDao(), remote), { LocalDate.parse(day) })
        state.open("2026-27")
        assertEquals(listOf("c2", "cdm"), state.dayRaces.map { it.id })
        remote.featured = null
        state.refresh()
        // Fallo posterior: se conserva el último conjunto leído.
        assertEquals(listOf("c2", "cdm"), state.dayRaces.map { it.id })
        val fresh = CyclocrossAgendaState(CyclocrossRepository(MemoryDao(), remote), { LocalDate.parse(day) })
        fresh.open("2026-27")
        assertTrue(fresh.loaded)
        assertEquals(listOf("cdm", "c2"), fresh.dayRaces.map { it.id })
    }

    @Test fun `al reabrir la agenda la cache se pinta ya con las destacadas`() = runBlocking {
        val cdm = race.copy(id = "cdm", raceClass = "CDM")
        val c2 = race.copy(id = "c2", raceClass = "C2")
        val remote = Remote(listOf(cdm, c2))
        val dao = MemoryDao()
        val repo = CyclocrossRepository(dao, remote)
        CyclocrossAgendaState(repo, { LocalDate.parse(day) }).open("2026-27")
        // Vuelta desde Ruta (mismo repositorio) y nueva sesión (misma caché
        // local): con la red retenida, el día pintado desde la caché ya lleva
        // la destacada delante.
        for (source in listOf(repo, CyclocrossRepository(dao, remote))) {
            val gate = CompletableDeferred<Unit>()
            val entered = CompletableDeferred<Unit>()
            remote.gate = gate
            remote.entered = entered
            val reopened = CyclocrossAgendaState(source, { LocalDate.parse(day) })
            val opening = launch { reopened.open("2026-27") }
            withTimeout(2_000) { entered.await() }
            assertTrue(reopened.loaded)
            assertEquals(listOf("c2", "cdm"), reopened.dayRaces.map { it.id })
            gate.complete(Unit)
            opening.join()
            assertEquals(listOf("c2", "cdm"), reopened.dayRaces.map { it.id })
        }
    }

    private class Remote(private val rows: List<CxRace>) : CxRemote {
        var featured: Set<String>? = setOf("c2")
        /** Retiene las consultas de meses hasta completarse; [entered] avisa
         *  de la primera. */
        var gate: CompletableDeferred<Unit>? = null
        var entered: CompletableDeferred<Unit>? = null
        override suspend fun cxMonth(season: String, month: YearMonth): List<CxRace> {
            gate?.let { entered?.complete(Unit); it.await() }
            return if (month == YearMonth.of(2026, 11)) rows else emptyList()
        }
        override suspend fun cxNextDate(season: String, date: String): String? = null
        override suspend fun cxDetail(id: String): CxDetail? = null
        override suspend fun cxRaceForSlug(slug: String): CxRace? = null
        override suspend fun cxFeaturedRaceIds(): Set<String> = featured ?: throw java.io.IOException("Offline")
    }

    private class MemoryDao : CxCacheDao {
        val months = mutableMapOf<String, CxMonthCacheEntity>()
        override suspend fun allMonths() = months.values.filter { it.key != CX_FEATURED_CACHE_KEY }
        override suspend fun allDetails() = emptyList<CxDetailCacheEntity>()
        override suspend fun month(key: String) = months[key]
        override suspend fun months(seasonKey: String) = months.values.filter { it.seasonKey == seasonKey }
        override suspend fun detail(id: String): CxDetailCacheEntity? = null
        override suspend fun detailBySlug(slug: String): CxDetailCacheEntity? = null
        override suspend fun saveMonth(month: CxMonthCacheEntity) { months[month.key] = month }
        override suspend fun saveDetail(detail: CxDetailCacheEntity) = Unit
        override suspend fun clearMonths() { months.clear() }
        override suspend fun clearDetails() = Unit
    }
}
