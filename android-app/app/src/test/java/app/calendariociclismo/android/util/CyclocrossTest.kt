package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.local.dao.CxCacheDao
import app.calendariociclismo.android.data.local.entity.CxDetailCacheEntity
import app.calendariociclismo.android.data.local.entity.CxMonthCacheEntity
import app.calendariociclismo.android.data.model.*
import app.calendariociclismo.android.data.repository.CxRemote
import app.calendariociclismo.android.data.repository.CyclocrossRepository
import java.time.Instant
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

    @Test fun `cabecera de torneo usa sus rondas y no el maximo de la temporada`() {
        val target = race.copy(id = "target", tournamentId = "hg")
        val other = race.copy(id = "other", tournamentId = "world")
        val rounds = mapOf("target" to CxRound(2, 7), "other" to CxRound(3, 15))
        assertEquals(7, CxPresentation.tournamentRoundTotal("hg", listOf(target, other), rounds))
        assertEquals(15, CxPresentation.tournamentRoundTotal("world", listOf(target, other), rounds))
        assertEquals(0, CxPresentation.tournamentRoundTotal("missing", listOf(target, other), rounds))
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

    @Test fun `prueba sin horarios usa badges y con algun horario conserva cuadros`() {
        val at = Instant.parse("2027-01-29T10:00:00Z")
        val sinHorarios = CxRace("cx-2", "Sin horarios", slug = "sin-horarios", slugEn = "no-schedule", seasonKey = "2026-27", dateKey = "2027-01-30", raceClass = "C2",
            categories = listOf(CxCategory("ME", dateKey = "2027-01-30"), CxCategory("WE", dateKey = "2027-01-30")))
        assertTrue(CxPresentation.usesCategoryBadges(sinHorarios, CyclocrossLogic.categoriesOn(sinHorarios, "2027-01-30"), at))
        val conHorario = sinHorarios.copy(categories = listOf(CxCategory("ME", "2027-01-30T14:00:00Z", "2027-01-30"), CxCategory("WE", dateKey = "2027-01-30")))
        assertFalse(CxPresentation.usesCategoryBadges(conHorario, CyclocrossLogic.categoriesOn(conHorario, "2027-01-30"), at))
        val conResultados = sinHorarios.copy(categories = listOf(CxCategory("ME", dateKey = "2027-01-30", resultsStatus = "official")))
        assertFalse(CxPresentation.usesCategoryBadges(conResultados, CyclocrossLogic.categoriesOn(conResultados, "2027-01-30"), at))
        assertFalse(CxPresentation.usesCategoryBadges(sinHorarios, emptyList(), at))
    }

    @Test fun `la clasificacion publicada abre la prueba sin documento ni horarios`() {
        val sinCarga = CxRace("cx-3", "Sin carga", slug = "sin-carga", slugEn = "no-load", seasonKey = "2026-27", dateKey = "2027-01-30", raceClass = "C2",
            categories = listOf(CxCategory("ME", dateKey = "2027-01-30")))
        assertFalse(CyclocrossLogic.hasClassifications(sinCarga))
        assertFalse(CyclocrossLogic.raceOpen(sinCarga))
        for (status in listOf("official", "provisional")) {
            val publicada = sinCarga.copy(categories = listOf(CxCategory("ME", dateKey = "2027-01-30", resultsStatus = status)))
            assertTrue(CyclocrossLogic.hasClassifications(publicada))
            assertTrue(CyclocrossLogic.raceOpen(publicada))
        }
        assertFalse(CyclocrossLogic.hasClassifications(sinCarga.copy(categories = listOf(CxCategory("ME", dateKey = "2027-01-30", resultsStatus = "pending")))))
    }

    @Test fun `fechas reales no generan relevos ni WU a partir de la general`() {
        assertEquals(listOf("2027-01-30", "2027-01-31"), CyclocrossLogic.dates(race))
        assertTrue(CyclocrossLogic.categoriesOn(race, "2027-01-29").isEmpty())
        assertEquals(listOf("WE"), CyclocrossLogic.categoriesOn(race, "2027-01-30").map { it.category })
        assertEquals("2027-28", CyclocrossLogic.season(LocalDate.parse("2027-07-31")))
        assertEquals("2027-28", CyclocrossLogic.season(LocalDate.parse("2027-08-01")))
    }

    @Test fun `agenda ordena por horario de la categoria programada de mayor rango`() {
        val date = "2027-01-30"
        fun category(code: String, start: String?, cancelled: Boolean = false) =
            CxCategory(code, start, dateKey = date, isCancelled = cancelled)
        fun event(id: String, name: String, raceClass: String = "C2", categories: List<CxCategory>) =
            race.copy(id = id, name = name, slug = id, raceClass = raceClass, dateKey = date, endDateKey = null, categories = categories)

        val rows = listOf(
            event("elite-late", "Élite tardía", categories = listOf(category("WE", "2027-01-30T10:00:00Z"), category("ME", "2027-01-30T15:00:00Z"))),
            event("elite-early", "Élite temprana", categories = listOf(category("WE", "2027-01-30T13:00:00Z"), category("ME", "2027-01-30T14:00:00Z"))),
            event("u23", "U23", categories = listOf(category("MU", "2027-01-30T13:00:00Z"))),
            event("u23-women", "U23 femenina", categories = listOf(category("WJ", "2027-01-30T08:00:00Z"), category("MJ", "2027-01-30T09:00:00Z"), category("WU", "2027-01-30T13:30:00Z"))),
            event("no-elite", "Sin élite", categories = listOf(category("ME", null), category("MU", "2027-01-30T12:00:00Z"), category("WE", "2027-01-30T16:00:00Z"))),
            event("cancelled-elite", "Élite cancelada", categories = listOf(category("ME", "2027-01-30T11:00:00Z", cancelled = true), category("WE", "2027-01-30T17:00:00Z"))),
            event("junior-men", "Junior masculino", categories = listOf(category("WJ", "2027-01-30T08:00:00Z"), category("MJ", "2027-01-30T18:00:00Z"))),
            event("junior-women", "Junior femenino", categories = listOf(category("WJ", "2027-01-30T19:00:00Z"))),
            event("untimed", "Sin horario", categories = listOf(category("ME", null))),
            event("c1", "C1 temprana", raceClass = "C1", categories = listOf(category("ME", "2027-01-30T08:00:00Z"))),
            event("world", "Mundial tarde", raceClass = "CM", categories = listOf(category("ME", "2027-01-30T18:00:00Z"))),
            event("unknown-class", "Clase desconocida", raceClass = "X", categories = listOf(category("ME", "2027-01-30T07:00:00Z"))),
        )

        assertEquals(
            listOf("world", "c1", "u23", "u23-women", "elite-early", "elite-late", "no-elite", "cancelled-elite", "junior-men", "junior-women", "untimed", "unknown-class"),
            CyclocrossLogic.racesOn(rows, date).map { it.id },
        )
    }

    @Test fun `paleta usa torneo y no deduce pertenencia por nombre de carrera`() {
        for ((name, expected) in listOf("Copa del Mundo UCI" to "#8B173D", "Telenet Superprestige" to "#FFC600", "X2O Badkamers Trofee" to "#00A8C7", "Copa de España" to "#D71920", "Exact Cross" to "#E6342A", "HG Cross" to "#E6342A", "Coupe de France" to "#0055A4", "Swiss Cyclocross Cup" to "#D52B1E", "Toi Toi Cup" to "#E87524", "HSF System Cup" to "#E87524", "National Trophy" to "#6B3FA0", "Trek USCX Series" to "#233C78", "Giro delle Regioni Ciclocross" to "#E94B8A", "Taça de Portugal" to "#008657")) {
            val tournament = CxTournament("t", name, slug = "torneo")
            assertEquals(expected, CxPresentation.color(race.copy(tournament = tournament, colorHex = "#123456")))
            assertEquals("#112233", CxPresentation.color(race.copy(tournament = tournament.copy(colorHex = "#112233"), colorHex = "#123456")))
            assertEquals("#123456", CxPresentation.color(race.copy(name = name, colorHex = "#123456")))
        }
        assertNull(CxPresentation.color(race.copy(colorHex = "invalid")))
    }

    @Test fun `secciones requieren filas publicadas y normalizan enlaces indisponibles`() {
        val publishedRace = race.copy(categories = race.categories.map { it.copy(resultsStatus = "official") })
        val empty = CxDetail(publishedRace, emptyList(), emptyList(), emptyList(), emptyList())
        assertEquals(listOf(CxDetailSection.PROGRAMME), CxPresentation.detailSections(empty))
        assertFalse(CxPresentation.showsSectionSelector(empty))
        assertEquals(CxDetailSection.PROGRAMME to "ME", CxPresentation.normalizeSelection(empty, CxDetailSection.RESULTS, "WE"))
        assertEquals(CxDetailSection.PROGRAMME to "ME", CxPresentation.normalizeSelection(empty, CxDetailSection.GENERAL, "WU"))
        val result = CxResult(1, race.id, "ME", rank = 1, riderDisplay = "Rider", timeText = "1:00:00", points = 40.0)
        val standing = CxStanding("s", "t", "2026-27", "WU", 1, "Rider", points = 50.0)
        val published = empty.copy(results = listOf(result), standings = listOf(standing))
        assertEquals(listOf(CxDetailSection.PROGRAMME, CxDetailSection.RESULTS, CxDetailSection.GENERAL), CxPresentation.detailSections(published))
        assertTrue(CxPresentation.showsSectionSelector(published))
        assertEquals(listOf("ME"), CxPresentation.resultCategories(published))
        assertEquals(listOf("WU"), CxPresentation.generalCategories(published))
        assertFalse("WU" in CxPresentation.actualCategories(published))
        assertEquals(CxDetailSection.RESULTS to "ME", CxPresentation.normalizeSelection(published, CxDetailSection.RESULTS, "WE"))
        assertEquals(CxDetailSection.GENERAL to "WU", CxPresentation.normalizeSelection(published, CxDetailSection.GENERAL, "ME"))
        val noSchedule = published.copy(race = published.race.copy(categories = published.race.categories.map { it.copy(startTimeUtc = null) }))
        assertEquals(listOf(CxDetailSection.RESULTS, CxDetailSection.GENERAL), CxPresentation.detailSections(noSchedule))
        assertFalse(CxPresentation.showsSectionSelector(noSchedule))
        assertTrue(CxPresentation.resultCategories(published.copy(race = race)).isEmpty())
        val vm = CxPresentation.resultRow(result, java.util.Locale.UK)
        assertEquals(40.0, vm.uciPoints!!, 0.0)
        assertEquals("Rider", vm.riderName)
        assertNull(vm.team)
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

    @Test fun `Programa combina medios sin repetir emisiones globales ni perder el filtro regional`() {
        val pending = CxDetail(race, broadcasts = listOf(
            CxBroadcast("es", race.id, country = "ES", url = "https://example.org/es", showInRevive = true),
            CxBroadcast("be", race.id, country = "BE", url = "https://example.org/be", showInRevive = true)))
        val mine = CxPresentation.programmeMedia(pending, setOf("ALL", "ES"))
        assertEquals(listOf("es"), mine.tv.map { it.id })
        assertTrue(mine.hasHiddenTV)
        assertEquals(listOf("es", "be"), CxPresentation.programmeMedia(pending, setOf("ALL", "ES"), true).tv.map { it.id })
        val published = pending.copy(race = race.copy(categories = race.categories.map { it.copy(resultsStatus = "official") }),
            results = race.categories.mapIndexed { index, category -> CxResult(index.toLong(), race.id, category.category, rank = 1, riderDisplay = "Rider") })
        val replay = CxPresentation.programmeMedia(published, setOf("ALL", "ES"))
        assertFalse(replay.showsLiveTV)
        assertTrue(replay.tv.isEmpty())
        assertEquals(listOf("https://example.org/es"), replay.revive.map { it.url })
    }

    @Test fun `limites de salida y final no publican resultados`() {
        val category = race.categories.first()
        assertEquals(CxTemporalState.SCHEDULED, CyclocrossLogic.timing(race, category, Instant.parse("2027-01-31T13:59:59Z")).temporalState)
        assertEquals(CxTemporalState.LIVE, CyclocrossLogic.timing(race, category, Instant.parse("2027-01-31T14:00:00Z")).temporalState)
        val final = CyclocrossLogic.timing(race, category, Instant.parse("2027-01-31T15:00:00Z"))
        assertEquals(CxTemporalState.ESTIMATED_FINISHED, final.temporalState)
        assertEquals("pending", final.resultsStatus)
        assertEquals(CxTemporalState.CANCELLED, CyclocrossLogic.timing(race.copy(isCancelled = true), category).temporalState)
        assertEquals(CxTemporalState.UNKNOWN, CyclocrossLogic.timing(race, category.copy(durationRuleVersion = null)).temporalState)
        assertEquals(CxTemporalState.UNKNOWN, CyclocrossLogic.timing(race, category.copy(durationFormat = null)).temporalState)
        assertEquals(CxTemporalState.UNKNOWN, CyclocrossLogic.timing(race, category.copy(startTimeUtc = null)).temporalState)
    }

    @Test fun `TV cambia a Revive por resultados propios y conserva filtro regional sin duplicar enlaces`() {
        val category = race.categories.first()
        val broadcasts = listOf(
            CxBroadcast("live", race.id, channel = "Canal ES", country = "ES", url = "https://example.org/replay"),
            CxBroadcast("curated", race.id, channel = "Canal ES", country = "ES", url = "https://example.org/replay", showInRevive = true, sortOrder = 3),
            CxBroadcast("be", race.id, channel = "Canal BE", country = "BE", url = "https://example.org/be", showInRevive = true),
            CxBroadcast("global", race.id, channel = "Sporza", url = "https://example.org/global", isSporza = true),
            CxBroadcast("we", race.id, category = "WE", url = "https://example.org/we", showInRevive = true),
            CxBroadcast("invalid", race.id, channel = "Sin enlace", url = "javascript:alert(1)", showInRevive = true),
        )
        val videos = listOf(CxVideo("clip", race.id, title = "Vídeo curado", url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ", sortOrder = -1),
            CxVideo("duplicate", race.id, title = "Repetido", url = "https://example.org/replay", sortOrder = 4),
            CxVideo("we", race.id, category = "WE", title = "WE", url = "https://example.org/we"))
        val detail = CxDetail(race, broadcasts = broadcasts, videos = videos)
        assertEquals(listOf("clip"), CxPresentation.videos(detail).map { it.id })
        assertTrue(CxDetailSection.VIDEOS in CxPresentation.detailSections(detail))
        val groups = setOf("ALL", "ES", "EUROPA")
        val pending = CxPresentation.categoryMedia(detail, category, groups)
        assertTrue(pending.showsLiveTV)
        assertTrue(pending.hasHiddenTV)
        assertEquals(listOf("live", "global", "invalid"), pending.tv.map { it.id })
        assertTrue(pending.revive.isEmpty())
        assertNull(CxPresentation.link(broadcasts.last().url))
        assertTrue(CxPresentation.categoryMedia(detail, category, groups, showAll = true).tv.any { it.id == "be" })
        val result = CxResult(1, race.id, "ME", rank = 1, riderDisplay = "Corredor local")
        for (status in listOf("official", "provisional")) {
            val published = CxPresentation.categoryMedia(detail.copy(results = listOf(result)), category.copy(resultsStatus = status), groups, showAll = true)
            assertFalse(published.showsLiveTV)
            assertTrue(published.tv.isEmpty())
            assertEquals(listOf("https://example.org/global", "https://example.org/replay"), published.revive.map { it.url })
        }
        assertTrue(CxPresentation.categoryMedia(detail.copy(results = listOf(result.copy(category = "WE"))), category, groups).showsLiveTV)
        assertTrue(CxPresentation.categoryMedia(detail, category.copy(resultsStatus = "official"), groups).showsLiveTV)
        for (cancelled in listOf(detail.copy(race = race.copy(isCancelled = true)) to category, detail to category.copy(isCancelled = true))) {
            val media = CxPresentation.categoryMedia(cancelled.first, cancelled.second, groups, showAll = true)
            assertFalse(media.showsLiveTV)
            assertTrue(media.tv.isEmpty())
            assertEquals(listOf("https://example.org/replay"), media.revive.map { it.url })
        }
    }

    @Test fun `cards usan metadatos regionales sin cargar clasificaciones y omiten TV vacia`() {
        val category = race.categories.first()
        val groups = setOf("ALL", "ES")
        assertFalse(CxPresentation.categoryMedia(CxDetail(race), category, groups).showsLiveTV)
        val tv = listOf(CxBroadcast("es", race.id, category = "ME", country = "ES", url = "https://example.org/es", showInRevive = true),
            CxBroadcast("be", race.id, category = "ME", country = "BE", url = "https://example.org/be", showInRevive = true))
        val agendaRace = race.copy(broadcasts = tv)
        val pending = CxPresentation.categoryMedia(agendaRace, category, groups)
        assertTrue(pending.showsLiveTV)
        assertEquals(listOf("es"), pending.tv.map { it.id })
        assertFalse(CxPresentation.categoryMedia(agendaRace, race.categories.last(), groups).showsLiveTV)
        val published = CxPresentation.categoryMedia(agendaRace, category.copy(resultsStatus = "provisional"), groups)
        assertFalse(published.showsLiveTV)
        assertEquals(listOf("https://example.org/es"), published.revive.map { it.url })
        val oldCache = json.decodeFromString<CxRace>("""{"id":"cx-old","name":"Anterior","slug":"anterior","class":"C2","seasonKey":"2026-27","dateKey":"2027-01-31"}""")
        assertTrue(oldCache.broadcasts.isEmpty())
        assertTrue(oldCache.videos.isEmpty())
    }

    @Test fun `minutos transcurridos conservan DST y formato agrupado verificado`() {
        val c = CxCategory("WE", "2026-10-25T02:30:00+02:00", durationFormat = "WE_WJ", durationRuleVersion = "2026-07-01", durationMinutes = 45)
        assertEquals(Instant.parse("2026-10-25T01:15:00Z"), CyclocrossLogic.timing(race, c).estimatedEnd)
        assertEquals(CxTemporalState.UNKNOWN, CyclocrossLogic.timing(race, c.copy(durationFormat = null)).temporalState)
    }
    @Test fun `cada categoria conserva horario hasta meta y solo publica copa con resultados`() {
        val c = race.categories.first()
        assertEquals(CxCategoryCardState.TIME, CxPresentation.categoryCardState(race, c, Instant.parse("2027-01-31T14:59:59Z")))
        assertEquals(CxCategoryCardState.AWAITING, CxPresentation.categoryCardState(race, c, Instant.parse("2027-01-31T15:00:00Z")))
        assertEquals(CxCategoryCardState.TIME, CxPresentation.categoryCardState(race, c.copy(startTimeUtc = "2027-01-31T16:00:00Z"), Instant.parse("2027-01-31T15:00:00Z")))
        for (status in listOf("official", "provisional")) assertEquals(CxCategoryCardState.RESULTS, CxPresentation.categoryCardState(race, c.copy(resultsStatus = status), Instant.parse("2027-01-31T15:00:00Z")))
        assertEquals(CxCategoryCardState.TIME, CxPresentation.categoryCardState(race, c.copy(durationRuleVersion = null), Instant.parse("2027-01-31T15:00:00Z")))
        assertEquals(CxCategoryCardState.CANCELLED, CxPresentation.categoryCardState(race.copy(isCancelled = true), c.copy(resultsStatus = "official"), Instant.parse("2027-01-31T15:00:00Z")))
    }
    @Test fun `solo espera resultados en Mundiales Continentales y Copa del Mundo Superprestige y X2O`() {
        val c = race.categories.first()
        val at = Instant.parse("2027-01-31T15:00:00Z")
        for (cls in listOf("CM", "CC", "CDM")) assertEquals(CxCategoryCardState.AWAITING, CxPresentation.categoryCardState(race.copy(raceClass = cls), c, at))
        for (slug in listOf("superprestige", "x2o", "copadelmundo")) {
            val tournament = CxTournament(id = "t", name = "Torneo", slug = slug)
            assertEquals(CxCategoryCardState.AWAITING, CxPresentation.categoryCardState(race.copy(raceClass = "C1", tournament = tournament), c, at))
        }
        val copa = CxTournament(id = "t", name = "Copa de España", slug = "copa")
        for (cls in listOf("C1", "C2", "CN", "NAC")) assertEquals(CxCategoryCardState.TIME, CxPresentation.categoryCardState(race.copy(raceClass = cls, tournament = copa), c, at))
        assertEquals(CxCategoryCardState.TIME, CxPresentation.categoryCardState(race.copy(raceClass = "C1", tournament = null), c, at))
    }
    @Test fun `filtro Big Pro y España de la agenda CX`() {
        for (cls in listOf("CM", "CDM", "CC")) assertTrue(CxPresentation.matchesAgendaFilter(race.copy(raceClass = cls), CxAgendaFilter.BIG))
        for (name in listOf("Telenet Superprestige", "X2O Badkamers Trofee", "Copa del Mundo UCI", "Exact Cross", "HG Cross")) {
            val tournament = CxTournament(id = "t", name = name, slug = name)
            assertTrue(CxPresentation.matchesAgendaFilter(race.copy(raceClass = "C1", tournament = tournament), CxAgendaFilter.BIG))
        }
        val copa = CxTournament(id = "t", name = "Copa de España", slug = "copa")
        assertFalse(CxPresentation.matchesAgendaFilter(race.copy(raceClass = "C1", tournament = copa), CxAgendaFilter.BIG))
        assertFalse(CxPresentation.matchesAgendaFilter(race.copy(raceClass = "C2"), CxAgendaFilter.BIG))
        for (cls in listOf("CM", "CDM", "CC", "C1", "C2")) assertTrue(CxPresentation.matchesAgendaFilter(race.copy(raceClass = cls), CxAgendaFilter.PRO))
        for (cls in listOf("CN", "NAC")) assertFalse(CxPresentation.matchesAgendaFilter(race.copy(raceClass = cls), CxAgendaFilter.PRO))
        assertTrue(CxPresentation.matchesAgendaFilter(race.copy(countryCode = "es"), CxAgendaFilter.SPAIN))
        assertTrue(CxPresentation.matchesAgendaFilter(race.copy(countryCode = "ES-MD"), CxAgendaFilter.SPAIN))
        assertFalse(CxPresentation.matchesAgendaFilter(race.copy(countryCode = "fr"), CxAgendaFilter.SPAIN))
        assertTrue(CxPresentation.matchesAgendaFilter(race.copy(raceClass = "NAC", countryCode = "fr"), CxAgendaFilter.ALL))
    }

    @Test fun `resultados admiten dorsal textual bigint y bono desconocido frente a cero`() {
        val row = json.decodeFromString<CxResult>("""{"id":9007199254740993,"raceId":"cx-1","category":"ME","bib":"A12","riderDisplay":"Corredor local","timeSeconds":90061,"bonusSeconds":null,"irm":"DF"}""")
        assertEquals(9007199254740993L, row.id)
        assertEquals("A12", row.bib)
        assertNull(row.bonusSeconds)
        assertEquals(0, row.copy(bonusSeconds = 0).bonusSeconds)
        assertEquals("25:01:01", CyclocrossLogic.duration(row.timeSeconds))
        assertEquals("—", CyclocrossLogic.duration(null))
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

    @Test fun `CX nunca consulta marzo a julio y la ventana mensual termina en febrero`() = runBlocking {
        val remote = FakeRemote(race)
        val repo = CyclocrossRepository(MemoryDao(), remote)
        assertEquals(7, CyclocrossLogic.months("2026-27").size)
        for (month in 3..7) {
            assertNull(repo.cachedMonth("2026-27", YearMonth.of(2027, month)))
            try { repo.month("2026-27", YearMonth.of(2027, month)); fail("No debe consultar fuera de la ventana") } catch (_: IllegalArgumentException) { }
        }
        assertTrue(remote.monthCalls.isEmpty())
        assertEquals(listOf(YearMonth.of(2027, 2)), CyclocrossLogic.offlineMonths(LocalDate.parse("2027-02-28")))
        assertEquals(listOf(YearMonth.of(2027, 8), YearMonth.of(2027, 9)), CyclocrossLogic.offlineMonths(LocalDate.parse("2027-05-12")))
        val state = app.calendariociclismo.android.ui.cyclocross.CyclocrossAgendaState(repo, LocalDate.parse("2026-09-12"))
        state.open("2026-27")
        assertEquals(listOf(YearMonth.of(2026, 9), YearMonth.of(2027, 1)), remote.monthCalls)
        assertEquals(listOf(YearMonth.of(2027, 1)), state.visibleMonths)
        state.selectMonth(YearMonth.of(2027, 2))
        assertEquals(listOf(YearMonth.of(2027, 2)), state.visibleMonths)
        val count = remote.monthCalls.size
        state.selectMonth(YearMonth.of(2027, 3))
        assertEquals(count, remote.monthCalls.size)
    }

    @Test fun `selector mensual carga solo destino conserva fallo y reutiliza meses consultados`() = runBlocking {
        val remote = FakeRemote(race)
        val state = app.calendariociclismo.android.ui.cyclocross.CyclocrossAgendaState(CyclocrossRepository(MemoryDao(), remote), LocalDate.parse("2026-09-12"))
        state.open("2026-27")
        state.selectMonth(YearMonth.of(2026, 8))
        state.selectMonth(YearMonth.of(2027, 2))
        assertEquals(listOf(YearMonth.of(2026, 9), YearMonth.of(2027, 1), YearMonth.of(2026, 8), YearMonth.of(2027, 2)), remote.monthCalls)
        assertEquals(listOf(YearMonth.of(2027, 2)), state.visibleMonths)
        assertEquals("2027-02-01", state.jumpDate)
        state.selectMonth(YearMonth.of(2026, 9))
        assertEquals(4, remote.monthCalls.size)
        assertEquals(listOf(YearMonth.of(2026, 9)), state.visibleMonths)
        state.selectMonth(YearMonth.of(2027, 3))
        assertEquals(4, remote.monthCalls.size)
        remote.failure = IllegalStateException("Fallo de destino")
        state.selectMonth(YearMonth.of(2026, 10))
        assertEquals(listOf(YearMonth.of(2026, 9)), state.visibleMonths)
        assertEquals(YearMonth.of(2026, 9), state.activeMonth)
        assertNotNull(state.error)
        remote.failure = null
        state.retry()
        assertEquals(listOf(YearMonth.of(2026, 10), YearMonth.of(2026, 10)), remote.monthCalls.takeLast(2))
        assertEquals(YearMonth.of(2026, 10), state.activeMonth)
        assertNull(state.error)
    }

    @Test fun `recarga conserva un unico mes sin salto y restauracion no busca proxima carrera`() = runBlocking {
        val remote = FakeRemote(race)
        val repo = CyclocrossRepository(MemoryDao(), remote)
        val state = app.calendariociclismo.android.ui.cyclocross.CyclocrossAgendaState(repo, LocalDate.parse("2026-09-12"))
        state.open("2026-27", YearMonth.of(2026, 10))
        assertEquals(listOf(YearMonth.of(2026, 10)), remote.monthCalls)
        assertEquals(listOf(YearMonth.of(2026, 10)), state.visibleMonths)
        assertNull(state.jumpDate)
        state.selectMonth(YearMonth.of(2026, 11))
        state.consumeJump()
        assertEquals(listOf(YearMonth.of(2026, 11)), state.visibleMonths)
        state.refresh()
        assertEquals(listOf(YearMonth.of(2026, 10), YearMonth.of(2026, 11), YearMonth.of(2026, 11)), remote.monthCalls)
        assertEquals(YearMonth.of(2026, 11), state.activeMonth)
        assertNull(state.jumpDate)
        state.open("2026-27")
        state.selectMonth(YearMonth.of(2026, 11))
        assertEquals(3, remote.monthCalls.size)
        assertNull(state.jumpDate)
    }

    @Test fun `agenda de torneo filtra la cache compartida y recupera la proxima fecha offline`() = runBlocking {
        val own = race.copy(id = "own", tournamentId = "t")
        val remote = FakeRemote(race).also { it.rows = listOf(race, own) }
        val dao = MemoryDao()
        val repo = CyclocrossRepository(dao, remote)
        val state = app.calendariociclismo.android.ui.cyclocross.CyclocrossAgendaState(repo, LocalDate.parse("2027-01-29"), tournamentId = "t")
        state.open("2026-27")
        assertEquals(2, dao.months["2026-27:2027-01"]?.let { json.decodeFromString<List<CxRace>>(it.payload).size })
        remote.failure = IllegalStateException("sin conexión")
        assertEquals("2027-01-30", repo.nextDate("2026-27", "2027-01-29", "t"))
        assertNull(repo.nextDate("2026-27", "2027-01-29", "absent"))
        val jump = state.jumpDate
        assertEquals("2027-01-30", jump)
        state.refresh()
        assertEquals(jump, state.jumpDate)
        assertEquals(CyclocrossLogic.months("2026-27"), state.visibleMonths)
        assertNull(state.activeMonth)
    }

    private class FakeRemote(private val race: CxRace) : CxRemote {
        var rows = listOf(race)
        var failure: Exception? = null
        val monthCalls = mutableListOf<YearMonth>()
        var seasonRounds: Map<String, CxRound> = emptyMap()
        var roundsFailure: Exception? = null
        var roundsCalls = 0
        override suspend fun cxMonth(season: String, month: YearMonth): List<CxRace> { monthCalls.add(month); failure?.let { throw it }; return rows }
        override suspend fun cxNextDate(season: String, date: String): String? { failure?.let { throw it }; return "2027-01-30" }
        override suspend fun cxDetail(id: String): CxDetail? { failure?.let { throw it }; return CxDetail(race) }
        override suspend fun cxRaceForSlug(slug: String): CxRace? { failure?.let { throw it }; return race }
        override suspend fun cxSeasonRounds(season: String): Map<String, CxRound> { roundsCalls++; roundsFailure?.let { throw it }; return seasonRounds }
    }

    @Test fun `numeracion de rondas por torneo sigue el orden del contrato de generales`() {
        val rows = listOf(
            CxRoundRow("oct-late", "t1", "2026-10-03", "2026-27", categories = listOf(CxRoundEntry("2026-10-04", "2026-10-04T15:00:00Z"))),
            CxRoundRow("sin-torneo", null, "2026-10-03", "2026-27"),
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
        assertNull(rounds["fuera"]); assertNull(rounds["sin-torneo"]); assertNull(rounds["otra-temporada"])
        assertEquals(CxRound(1, 2), rounds["a"]); assertEquals(CxRound(2, 2), rounds["b"])
        assertEquals(CxRound(1, 1), rounds["solitaria"])
    }

    @Test fun `rondas fallan en silencio y se cachean por temporada`() = runBlocking {
        val remote = FakeRemote(race)
        val repo = CyclocrossRepository(MemoryDao(), remote)
        remote.roundsFailure = IllegalStateException("sin conexión")
        assertTrue(repo.rounds("2026-27").isEmpty())
        assertEquals(1, remote.roundsCalls)
        remote.roundsFailure = null
        remote.seasonRounds = mapOf(race.id to CxRound(3, 8))
        assertEquals(CxRound(3, 8), repo.rounds("2026-27")[race.id])
        assertEquals(2, remote.roundsCalls)
        assertSame(remote.seasonRounds, repo.rounds("2026-27"))
        assertEquals(2, remote.roundsCalls)
    }

    @Test fun `ficha CX fuera de temporada no se muestra desde red ni cache antigua`() = runBlocking {
        val inactive = race.copy(dateKey = "2027-03-01", endDateKey = "2027-03-02")
        val dao = MemoryDao()
        val remote = FakeRemote(inactive)
        val repo = CyclocrossRepository(dao, remote)
        assertNull(repo.detail(inactive.id))
        assertTrue(dao.details.isEmpty())
        dao.saveDetail(CxDetailCacheEntity(inactive.id, inactive.slug, inactive.slugEn, json.encodeToString(CxDetail(inactive)), 1))
        val failure = IllegalStateException("sin conexión")
        remote.failure = failure
        assertNull(repo.cachedDetail(inactive.id))
        try { repo.detail(inactive.id); fail("Debe conservar el error de red sin recuperar la ficha excluida") }
        catch (error: IllegalStateException) { assertSame(failure, error) }
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

    @Test
    fun `las carreras nacionales solo se ocultan en ingles`() {
        val national = race.copy(raceClass = "NAC")
        val previous = LocaleHolder.current
        try {
            LocaleHolder.current = java.util.Locale("en")
            assertTrue(CxPresentation.isHidden(national))
            assertFalse(CxPresentation.isHidden(race))
            LocaleHolder.current = java.util.Locale("es", "ES")
            assertFalse(CxPresentation.isHidden(national))
        } finally {
            LocaleHolder.current = previous
        }
    }
}
