package app.calendariociclismo.android.util

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.ElevationPoint
import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.ui.today.TodayViewModel
import app.calendariociclismo.android.ui.today.shouldDisplayTodayRaceAsFeatured
import app.calendariociclismo.android.ui.today.sortTodayAgenda
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35]) // Robolectric 4.14.1 soporta hasta API 35; la app compila contra 36.
class RaceLogicTest {

    @Test
    fun todayFeaturedCardsAreLimitedToCategorySortAndReturnWhenRestored() {
        assertTrue(shouldDisplayTodayRaceAsFeatured(true, TodayViewModel.SortMode.CATEGORY))
        assertFalse(shouldDisplayTodayRaceAsFeatured(true, TodayViewModel.SortMode.TV_TIME))
        assertFalse(shouldDisplayTodayRaceAsFeatured(true, TodayViewModel.SortMode.FINISH_TIME))
        assertFalse(shouldDisplayTodayRaceAsFeatured(false, TodayViewModel.SortMode.CATEGORY))
    }

    @Test
    fun calendarYear_excludesHistoryAndUnknownYear_usingUTC() {
        val before = Instant.parse("2026-12-31T23:59:59Z")
        val after = Instant.parse("2027-01-01T00:00:00Z")
        assertEquals(2026, RaceLogic.calendarYear(before))
        assertEquals(2027, RaceLogic.calendarYear(after))
        assertFalse(RaceLogic.hasCalendarForYear(null, before))
        assertFalse(RaceLogic.hasCalendarForYear(2025, before))
        assertTrue(RaceLogic.hasCalendarForYear(2026, before))
        assertFalse(RaceLogic.hasCalendarForYear(2026, after))
        assertTrue(RaceLogic.hasCalendarForYear(2027, after))
    }

    @Test
    fun `missingRaceIds devuelve solo padres no resueltos y sin duplicados`() {
        val days = listOf(
            raceDay(id = "d1", raceId = "tour"),
            raceDay(id = "d2", raceId = "renewi"),
            raceDay(id = "d3", raceId = "renewi"),
        )
        assertEquals(listOf("renewi"), RaceLogic.missingRaceIds(days, listOf(race(id = "tour"))))
    }

    @Test
    fun prefersNativeApp_matchesSupportedHostsAndSubdomains() {
        assertTrue(RaceLogic.prefersNativeApp("https://www.youtube.com/watch?v=abc"))
        assertTrue(RaceLogic.prefersNativeApp("https://play.hbomax.com/sport/abc"))
        assertTrue(RaceLogic.prefersNativeApp("https://x.com/uci"))
    }

    @Test
    fun prefersNativeApp_rejectsBrowserOnlyAndLookalikeHosts() {
        assertFalse(RaceLogic.prefersNativeApp("https://www.rtve.es/play/"))
        assertFalse(RaceLogic.prefersNativeApp("https://notyoutube.com/watch"))
    }

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        // Las etiquetas vía LocaleHolder.t() dependen del idioma; fijamos ES para
        // que `resolveTypeLabel` (p. ej. "Monopuerto") sea determinista.
        LocaleHolder.system = Locale("es", "ES")
        LocaleHolder.current = Locale("es", "ES")
    }

    // ── typeLabel ──────────────────────────────────────────────────

    @Test
    fun `typeLabel devuelve etiqueta para tipos conocidos`() {
        assertFalse(RaceLogic.typeLabel(context, "flat").isEmpty())
        assertFalse(RaceLogic.typeLabel(context, "mountain").isEmpty())
        assertFalse(RaceLogic.typeLabel(context, "itt").isEmpty())
    }

    @Test
    fun `typeLabel devuelve el tipo si no esta en el mapa`() {
        assertEquals("unknown_type", RaceLogic.typeLabel(context, "unknown_type"))
    }

    @Test
    fun `typeLabel devuelve cadena vacia para null`() {
        assertEquals("", RaceLogic.typeLabel(context, null))
    }

    // ── resolveTypeLabel ───────────────────────────────────────────

    @Test
    fun `resolveTypeLabel monopuerto para flat con summit_finish`() {
        assertEquals("Monopuerto", RaceLogic.resolveTypeLabel(context, "flat", "summit_finish"))
    }

    @Test
    fun `resolveTypeLabel sterrato en Francia devuelve Ribinou`() {
        assertEquals("Ribinou", RaceLogic.resolveTypeLabel(context, "sterrato", null, countryCode = "FR"))
    }

    @Test
    fun `resolveTypeLabel sterrato fuera de Francia no es Ribinou`() {
        assertNotEquals("Ribinou", RaceLogic.resolveTypeLabel(context, "sterrato", null, countryCode = "IT"))
    }

    @Test
    fun `resolveTypeLabel itt con chrono_climb es cronoescalada`() {
        assertFalse(RaceLogic.resolveTypeLabel(context, "itt", "chrono_climb").isEmpty())
    }

    @Test
    fun `resolveTypeLabel itt con final en alto es cronoescalada`() {
        assertEquals(
            RaceLogic.typeLabel(context, "chrono_climb"),
            RaceLogic.resolveTypeLabel(context, "itt", "summit_finish"),
        )
    }

    // ── cleanFeminineDisplayName ───────────────────────────────────

    @Test
    fun `cleanFeminineDisplayName elimina sufijo women`() {
        val cleaned = RaceLogic.cleanFeminineDisplayName("Tour de Flandes Women")
        assertFalse(cleaned.lowercase().contains("women"))
    }

    @Test
    fun `cleanFeminineDisplayName elimina femenino`() {
        val cleaned = RaceLogic.cleanFeminineDisplayName("Vuelta a Burgos Femenino")
        assertFalse(cleaned.lowercase().contains("femenino"))
    }

    @Test
    fun `cleanFeminineDisplayName no modifica nombre sin sufijo femenino`() {
        val name = "Tour de Francia"
        assertEquals(name, RaceLogic.cleanFeminineDisplayName(name))
    }

    @Test
    fun `cleanFeminineDisplayName no elimina excepcion conocida`() {
        val name = "Women Cycling Pro"
        assertEquals(name, RaceLogic.cleanFeminineDisplayName(name))
    }

    // ── raceTimeCheck dateKey guard ───────────────────────────────

    @Test
    fun `raceTimeCheck ignora estimatedFinishTimeUtc con fecha anterior al dateKey`() {
        // finish date 2026-05-01 < dateKey 2099-12-31 → guarda descarta, usa fallback (futuro → false)
        val rd = raceDay(dateKey = "2099-12-31", estimatedFinishTimeUtc = "2026-05-01T22:49:00Z")
        assertFalse(RaceLogic.raceTimeCheck(rd, 0))
    }

    @Test
    fun `raceTimeCheck usa estimatedFinishTimeUtc con fecha igual al dateKey`() {
        // finish date 2026-01-01 == dateKey → válido, ya pasó → true
        val rd = raceDay(dateKey = "2026-01-01", estimatedFinishTimeUtc = "2026-01-01T18:00:00Z")
        assertTrue(RaceLogic.raceTimeCheck(rd, 0))
    }

    // ── categoryTier ──────────────────────────────────────────────

    @Test
    fun `categoryTier WT para 1UWT`() {
        assertEquals("wt", RaceLogic.categoryTier("1.UWT"))
    }

    @Test
    fun `categoryTier WT para 2UWT`() {
        assertEquals("wt", RaceLogic.categoryTier("2.UWT"))
    }

    @Test
    fun `categoryTier WC para WC`() {
        assertEquals("wc", RaceLogic.categoryTier("WC"))
    }

    @Test
    fun `categoryTier null para null`() {
        assertNull(RaceLogic.categoryTier(null))
    }

    // ── nameImpliesFemale ──────────────────────────────────────────

    @Test
    fun `nameImpliesFemale true para nombre con women`() {
        assertTrue(RaceLogic.nameImpliesFemale("Tour de Flandes Women"))
    }

    @Test
    fun `nameImpliesFemale true para nombre con femenino`() {
        assertTrue(RaceLogic.nameImpliesFemale("Vuelta Burgos Femenino"))
    }

    @Test
    fun `nameImpliesFemale true para nombre con feminina portugues`() {
        // "Feminina"/"Feminino" (portugués/italiano, sin acento, vocal i) deben
        // contar como femenino igual que la web (patrón f[eé]minin[e]?).
        assertTrue(RaceLogic.nameImpliesFemale("Volta a Portugal Feminina"))
        assertTrue(RaceLogic.nameImpliesFemale("Giro Feminino"))
    }

    @Test
    fun `nameImpliesFemale false para nombre neutro`() {
        assertFalse(RaceLogic.nameImpliesFemale("Tour de Francia"))
    }

    @Test
    fun `nameImpliesFemale false para null`() {
        assertFalse(RaceLogic.nameImpliesFemale(null))
    }

    // ── reviveUrl ──────────────────────────────────────────────────

    @Test
    fun `reviveUrl devuelve null si no hay broadcasts`() {
        assertNull(RaceLogic.reviveUrl(emptyList()))
    }

    @Test
    fun `reviveUrl devuelve url de Eurosport`() {
        val broadcasts = listOf(broadcast(channel = "Eurosport 1", url = "https://eurosport.com/live"))
        assertNotNull(RaceLogic.reviveUrl(broadcasts))
    }

    @Test
    fun `reviveUrl devuelve url de YouTube`() {
        val broadcasts = listOf(broadcast(channel = "Canal", url = "https://youtube.com/watch?v=abc"))
        assertNotNull(RaceLogic.reviveUrl(broadcasts))
    }

    @Test
    fun `reviveUrl devuelve url persistente de una red social`() {
        val broadcasts = listOf(broadcast(channel = "Social", url = "https://www.instagram.com/reel/abc"))
        assertNotNull(RaceLogic.reviveUrl(broadcasts))
    }

    @Test
    fun `reviveUrl atiende flag remoto de una fuente futura`() {
        val broadcasts = listOf(broadcast(
            channel = "Pidcock Racing", url = "https://video.example/race", showInRevive = true,
        ))
        assertNotNull(RaceLogic.reviveUrl(broadcasts))
    }

    @Test
    fun `hasReviveBroadcasts exige resultados de la jornada`() {
        val broadcasts = listOf(broadcast(
            channel = "Pidcock Racing", url = "https://video.example/race", showInRevive = true,
        ))
        assertTrue(RaceLogic.hasReviveBroadcasts(broadcasts, hasCurrentResults = true))
        assertFalse(RaceLogic.hasReviveBroadcasts(broadcasts, hasCurrentResults = false))
        assertTrue(RaceLogic.hasReviveBroadcasts(broadcasts, true, isCancelled = true))
        assertFalse(RaceLogic.hasReviveBroadcasts(broadcasts, false, isCancelled = true))
        assertFalse(RaceLogic.hasReviveBroadcasts(emptyList(), hasCurrentResults = true))
    }

    @Test
    fun `shouldShowBroadcastNote oculta cualquier nota al entrar resultados`() {
        assertFalse(RaceLogic.shouldShowBroadcastNote(true, false, false))
        assertFalse(RaceLogic.shouldShowBroadcastNote(true, true, true))
    }

    @Test
    fun `shouldShowBroadcastNote conserva regla revive antes de resultados`() {
        assertTrue(RaceLogic.shouldShowBroadcastNote(false, false, false))
        assertFalse(RaceLogic.shouldShowBroadcastNote(false, true, false))
        assertTrue(RaceLogic.shouldShowBroadcastNote(false, true, true))
    }

    @Test
    fun `reviveBroadcasts en cancelada conserva solo seleccion editorial`() {
        val automatic = broadcast(channel = "Eurosport 1", url = "https://eurosport.example/live")
        val selected = broadcast(
            channel = "Canal", url = "https://video.example/selected", showInRevive = true,
        )
        assertEquals(listOf(selected), RaceLogic.reviveBroadcasts(listOf(automatic, selected), true))
    }

    @Test
    fun `reviveUrl devuelve deep link bajo demanda de ETB ON sin flag`() {
        val broadcasts = listOf(broadcast(channel = "ETB1", url = "https://etbon.eus/m/txirrindularitza-itzulia-5-12345"))
        assertNotNull(RaceLogic.reviveUrl(broadcasts))
    }

    @Test
    fun `reviveUrl rechaza hub lineal de ETB ON sin flag`() {
        val broadcasts = listOf(broadcast(channel = "ETB1", url = "https://etbon.eus/ch/etb-1"))
        assertNull(RaceLogic.reviveUrl(broadcasts))
    }

    @Test
    fun `reviveUrl devuelve url con showInRevive`() {
        val broadcasts = listOf(broadcast(channel = "Otro canal", url = "https://example.com", showInRevive = true))
        assertNotNull(RaceLogic.reviveUrl(broadcasts))
    }

    @Test
    fun `reviveUrl devuelve null si ningun broadcast es revive`() {
        val broadcasts = listOf(broadcast(channel = "Canal local", url = "https://example.com"))
        assertNull(RaceLogic.reviveUrl(broadcasts))
    }

    @Test
    fun `reviveUrl devuelve null si showInRevive pero url es null`() {
        val broadcasts = listOf(broadcast(channel = "Canal", url = null, showInRevive = true))
        assertNull(RaceLogic.reviveUrl(broadcasts))
    }

    @Test
    fun `reviveUrl devuelve null si Eurosport pero url es null`() {
        val broadcasts = listOf(broadcast(channel = "Eurosport 1", url = null))
        assertNull(RaceLogic.reviveUrl(broadcasts))
    }

    // ── broadcastLinkPriority ─────────────────────────────────────

    @Test
    fun `broadcastLinkPriority YouTube es tier 0`() {
        assertEquals(0, RaceLogic.broadcastLinkPriority("https://www.youtube.com/watch?v=abc"))
        assertEquals(0, RaceLogic.broadcastLinkPriority("https://youtu.be/abc"))
    }

    @Test
    fun `broadcastLinkPriority otras redes sociales son tier 1`() {
        assertEquals(1, RaceLogic.broadcastLinkPriority("https://www.facebook.com/uci/videos/123"))
        assertEquals(1, RaceLogic.broadcastLinkPriority("https://www.instagram.com/p/abc"))
        assertEquals(1, RaceLogic.broadcastLinkPriority("https://twitter.com/uci"))
        assertEquals(1, RaceLogic.broadcastLinkPriority("https://x.com/uci"))
        assertEquals(1, RaceLogic.broadcastLinkPriority("https://www.twitch.tv/uci"))
    }

    @Test
    fun `broadcastLinkPriority RTVE es tier 2 (por delante del resto de espanolas)`() {
        assertEquals(2, RaceLogic.broadcastLinkPriority("https://www.rtve.es/play/videos/directo/teledeporte/"))
    }

    @Test
    fun `broadcastLinkPriority otras TV publicas en abierto (RTP1, CCMA, EITB) son tier 3`() {
        assertEquals(3, RaceLogic.broadcastLinkPriority("https://www.rtp.pt/play/direto/rtp1"))
        assertEquals(3, RaceLogic.broadcastLinkPriority("https://www.ccma.cat/3cat/directes/esport3/"))
        assertEquals(3, RaceLogic.broadcastLinkPriority("https://www.3cat.cat/3cat/directes/esport3/"))
        assertEquals(3, RaceLogic.broadcastLinkPriority("https://www.eitb.eus/es/directo/etb-1/"))
        assertEquals(3, RaceLogic.broadcastLinkPriority("https://www.eitb.tv/es/directo/"))
    }

    @Test
    fun `broadcastLinkPriority RTVE gana a CCMA y EITB (caso etapa 4)`() {
        val rtve = RaceLogic.broadcastLinkPriority("https://www.rtve.es/play/videos/directo/teledeporte/")
        assertTrue(rtve < RaceLogic.broadcastLinkPriority("https://www.eitb.eus/es/directo/etb-1/"))
        assertTrue(rtve < RaceLogic.broadcastLinkPriority("https://www.ccma.cat/3cat/directes/esport3/"))
    }

    @Test
    fun `broadcastLinkPriority RTP1 gana a WBD en la Volta a Portugal`() {
        val rtp1 = RaceLogic.broadcastLinkPriority("https://www.rtp.pt/play/direto/rtp1")
        assertTrue(rtp1 < RaceLogic.broadcastLinkPriority("https://play.hbomax.com/sport/abc"))
        assertTrue(rtp1 < RaceLogic.broadcastLinkPriority("https://www.hbomax.com/gb/en/sports/cycling"))
    }

    @Test
    fun `broadcastLinkPriority Eurosport y HBO Max son una cadena mas (tier 4)`() {
        assertEquals(4, RaceLogic.broadcastLinkPriority("https://www.eurosport.es/ciclismo/"))
        assertEquals(4, RaceLogic.broadcastLinkPriority("https://www.hbomax.com/es/es"))
        // play.max.com NO debe confundirse con x.com.
        assertEquals(4, RaceLogic.broadcastLinkPriority("https://play.max.com/show/abc"))
    }

    @Test
    fun `broadcastLinkPriority cadena generica o vacia es tier 4`() {
        assertEquals(4, RaceLogic.broadcastLinkPriority("https://www.france.tv/sport/cyclisme/"))
        assertEquals(4, RaceLogic.broadcastLinkPriority(null))
        assertEquals(4, RaceLogic.broadcastLinkPriority(""))
    }

    // ── Orden de la agenda de Hoy (espejo de today-agenda-order.test.js) ──

    /** Domingo 11-10-2026: la París-Tours no debe quedar detrás de una 2.1 por tener esta miniperfil. */
    private fun parisToursAgenda() = listOf(
        agendaItem("Tour de Kyushu", "2.1", country = "JP", start = "2026-10-11T01:00:00Z", withProfile = true),
        agendaItem("Tour de la Isla de Chongming", "2.WWT", gender = "female", country = "CN"),
        agendaItem("París-Tours", "1.Pro"),
        agendaItem("Hong Kong Cyclothon", "1.1", country = "HK", start = "2026-10-11T01:45:00Z"),
        agendaItem("Vuelta a Venezuela", "2.2", country = "VE"),
        agendaItem("París-Tours sub23", "1.2U"),
        agendaItem("Campeonato del Caribe", "1.2", country = null, placeholder = true),
    )

    @Test
    fun `agenda de Hoy ordena por categoria sin dar prioridad al miniperfil`() {
        val ordenado = sortTodayAgenda(parisToursAgenda(), TodayViewModel.SortMode.CATEGORY, emptySet())
        assertEquals(
            listOf(
                "Tour de la Isla de Chongming", "París-Tours", "Tour de Kyushu", "Hong Kong Cyclothon",
                "Vuelta a Venezuela", "París-Tours sub23", "Campeonato del Caribe",
            ),
            ordenado.map { it.race?.name },
        )
    }

    @Test
    fun `agenda de Hoy antepone las destacadas solo en el orden por categoria`() {
        val items = parisToursAgenda()
        val destacadas = setOf("París-Tours")
        assertEquals("París-Tours", sortTodayAgenda(items, TodayViewModel.SortMode.CATEGORY, destacadas).first().race?.name)
        assertEquals(
            "Tour de la Isla de Chongming",
            sortTodayAgenda(items, TodayViewModel.SortMode.FINISH_TIME, destacadas).first().race?.name,
        )
    }

    @Test
    fun `agenda de Hoy mantiene al final una destacada cancelada`() {
        val items = listOf(agendaItem("Cancelada", "1.UWT", cancelled = true), agendaItem("Normal", "1.2"))
        val ordenado = sortTodayAgenda(items, TodayViewModel.SortMode.CATEGORY, setOf("Cancelada"))
        assertEquals(listOf("Normal", "Cancelada"), ordenado.map { it.race?.name })
    }

    @Test
    fun `agenda de Hoy ordena por hora de TV y desempata por categoria`() {
        val items = listOf(
            agendaItem("Sin TV", "1.UWT"),
            agendaItem("TV tarde", "1.2", broadcasts = listOf(broadcast(startTimeUtc = "2026-10-11T14:00:00Z"))),
            agendaItem("TV pronto", "1.1", broadcasts = listOf(broadcast(startTimeUtc = "2026-10-11T12:00:00Z"))),
        )
        val ordenado = sortTodayAgenda(items, TodayViewModel.SortMode.TV_TIME, emptySet())
        assertEquals(listOf("TV pronto", "TV tarde", "Sin TV"), ordenado.map { it.race?.name })
    }

    @Test
    fun `categoryRank aplica las excepciones de grandes vueltas, Porvenir, Asia y continentales`() {
        assertEquals(0.2, RaceLogic.categoryRank("2.UWT", "Tour de Francia", null), 0.0)
        assertEquals(8.5, RaceLogic.categoryRank("2.2U", "Tour del Porvenir", null), 0.0)
        assertEquals(10.5, RaceLogic.categoryRank("2.1", "Tour of Azerbaijan", "AZ"), 0.0)
        assertEquals(9.0, RaceLogic.categoryRank("1.1", "Japan Cup", "JP"), 0.0)
        assertEquals(14.5, RaceLogic.categoryRank("CC", "Campeonato Panamericano", null), 0.0)
        assertEquals(2.0, RaceLogic.categoryRank("CC", "Campeonato de Europa", null), 0.0)
    }

    // ── Indicador femenino ─────────────────────────────────────────

    @Test
    fun `shouldShowFemaleIndicator se oculta en categorias WWT`() {
        assertFalse(RaceLogic.shouldShowFemaleIndicator(race(name = "Tour de la Isla de Chongming", uciCategory = "2.WWT", gender = "female")))
        assertFalse(RaceLogic.shouldShowFemaleIndicator(race(name = "Strade Bianche", uciCategory = "1.WWT", gender = "female")))
        assertTrue(RaceLogic.shouldShowFemaleIndicator(race(name = "Vuelta a Burgos", uciCategory = "2.Pro", gender = "female")))
        assertFalse(RaceLogic.shouldShowFemaleIndicator(race(name = "Vuelta a Burgos Féminas", uciCategory = "2.Pro", gender = "female")))
    }

    // ── Helpers ────────────────────────────────────────────────────

    // ── isRaceConcluded ─────────────────────────────────────────

    // Sin hora de meta cae al fallback de `dateKey` 18:00 UTC (igual que la web):
    // los Campeonatos Nacionales no tienen hora de meta y deben concluir igual.
    @Test
    fun isRaceConcluded_pastDateNoFinishTime_true() {
        assertTrue(
            RaceLogic.isRaceConcluded(raceDay(dateKey = "2020-01-01", estimatedFinishTimeUtc = null))
        )
    }

    @Test
    fun isRaceConcluded_futureDateNoFinishTime_false() {
        assertFalse(
            RaceLogic.isRaceConcluded(raceDay(dateKey = "2090-01-01", estimatedFinishTimeUtc = null))
        )
    }

    @Test
    fun isRaceConcluded_trueWellInThePast() {
        assertTrue(
            RaceLogic.isRaceConcluded(
                raceDay(dateKey = "2020-01-01", estimatedFinishTimeUtc = "2020-01-01T15:00:00Z")
            )
        )
    }

    @Test
    fun isRaceConcluded_falseFarInTheFuture() {
        assertFalse(
            RaceLogic.isRaceConcluded(
                raceDay(dateKey = "2090-01-01", estimatedFinishTimeUtc = "2090-01-01T15:00:00Z")
            )
        )
    }

    @Test
    fun `estado Hoy prioriza cancelacion descanso y resultados antes de espera`() {
        val finished = raceDay(raceStatus = "finished")
        assertEquals(RaceLogic.TodayRaceState.CANCELLED, RaceLogic.todayRaceState(finished.copy(isCancelledDay = true), true))
        assertEquals(RaceLogic.TodayRaceState.REST, RaceLogic.todayRaceState(finished.copy(isRestDay = true), true))
        assertEquals(RaceLogic.TodayRaceState.RESULTS, RaceLogic.todayRaceState(finished, true))
    }

    @Test
    fun `estado Hoy espera por estado finished o por meta superada`() {
        assertEquals(
            RaceLogic.TodayRaceState.WAITING,
            RaceLogic.todayRaceState(raceDay(raceStatus = "finished"), false),
        )
        assertEquals(
            RaceLogic.TodayRaceState.WAITING,
            RaceLogic.todayRaceState(
                raceDay(estimatedFinishTimeUtc = "2026-01-01T15:00:00Z"),
                false,
                Instant.parse("2026-01-01T15:00:01Z"),
            ),
        )
    }

    private fun race(
        id: String = "r1",
        year: Int? = 2026,
        uciCategory: String? = "1.UWT",
        gender: String? = null,
        name: String = "Test Race",
        countryCode: String? = null,
        raceFormat: String? = null,
        isGrandTour: Boolean = false,
        isCancelled: Boolean = false,
    ) = Race(
        id = id,
        name = name,
        uciCategory = uciCategory,
        gender = gender,
        raceFormat = raceFormat,
        countryCode = countryCode,
        year = year,
        isGrandTour = isGrandTour,
        isCancelled = isCancelled,
    )

    private fun raceDay(
        id: String = "rd1",
        raceId: String? = null,
        dateKey: String = "2026-01-01",
        isRestDay: Boolean = false,
        isCancelledDay: Boolean = false,
        estimatedFinishTimeUtc: String? = null,
        raceStatus: String? = null,
    ) = RaceDay(
        id = id,
        raceId = raceId,
        dateKey = dateKey,
        isRestDay = isRestDay,
        isCancelledDay = isCancelledDay,
        estimatedFinishTimeUtc = estimatedFinishTimeUtc,
        raceStatus = raceStatus,
    )

    /** Jornada de la agenda de Hoy para los tests de orden. El id de la carrera es su nombre. */
    private fun agendaItem(
        name: String,
        uciCategory: String,
        gender: String = "male",
        country: String? = "FR",
        start: String? = null,
        withProfile: Boolean = false,
        placeholder: Boolean = false,
        cancelled: Boolean = false,
        broadcasts: List<Broadcast> = emptyList(),
    ): EnrichedRaceDay {
        val profile = if (withProfile)
            ElevationProfile(
                distance = 100.0,
                points = listOf(ElevationPoint(0.0, 0), ElevationPoint(100.0, 500)),
            ) else null
        return EnrichedRaceDay(
            raceDay = RaceDay(
                id = "rd-$name",
                raceId = name,
                dateKey = "2026-10-11",
                neutralStartTimeUtc = start,
                elevationProfile = profile,
                editorialStatus = if (placeholder) "placeholder" else "published",
            ),
            race = race(id = name, name = name, uciCategory = uciCategory, gender = gender,
                countryCode = country, isCancelled = cancelled),
            broadcasts = broadcasts,
            isPlaceholder = placeholder,
        )
    }

    private fun broadcast(
        channel: String? = null,
        url: String? = null,
        showInRevive: Boolean = false,
        sortOrder: Int = 0,
        startTimeUtc: String? = null,
    ) = Broadcast(
        id = "b1",
        raceDayId = "rd1",
        channel = channel,
        startTimeUtc = startTimeUtc,
        url = url,
        showInRevive = showInRevive,
        sortOrder = sortOrder,
    )

    // ── championshipTvState ─────────────────────────────────────

    @Test
    fun championshipTvState_labelWhenNoStartTimes() {
        assertEquals(
            RaceLogic.ChampionshipTvState.Label,
            RaceLogic.championshipTvState(listOf(broadcast(channel = "Canal", url = "https://x.com"))),
        )
    }

    @Test
    fun championshipTvState_labelWhenEmpty() {
        assertEquals(
            RaceLogic.ChampionshipTvState.Label,
            RaceLogic.championshipTvState(emptyList()),
        )
    }

    @Test
    fun championshipTvState_liveWhenEarliestStartInPast() {
        val bcs = listOf(
            broadcast(channel = "A", startTimeUtc = "2090-01-01T15:00:00Z"),
            broadcast(channel = "B", startTimeUtc = "2020-01-01T15:00:00Z"),
        )
        assertEquals(RaceLogic.ChampionshipTvState.Live, RaceLogic.championshipTvState(bcs))
    }

    @Test
    fun championshipTvState_timeWhenStartInFuture() {
        val bcs = listOf(broadcast(channel = "A", startTimeUtc = "2090-01-01T15:00:00Z"))
        val state = RaceLogic.championshipTvState(bcs)
        assertTrue(state is RaceLogic.ChampionshipTvState.Time)
        assertTrue((state as RaceLogic.ChampionshipTvState.Time).display.isNotEmpty())
    }

    @Test fun `WC y CC respetan el genero del filtro`() {
        val worldMen = race(uciCategory = "WC", name = "Campeonato del Mundo CRI masculino", gender = "male")
        val worldWomen = race(uciCategory = "WC", name = "Campeonato del Mundo CRI femenino", gender = "female")
        val europeMen = race(uciCategory = "CC", name = "Campeonato de Europa línea masculino", gender = "male")
        val europeWomen = race(uciCategory = "CC", name = "Campeonato de Europa línea femenino", gender = "female")
        val mixedRelay = race(uciCategory = "WC", name = "Campeonato del Mundo CRE relevo mixto", gender = null)

        assertTrue(RaceLogic.matchesCategory(worldMen, Constants.CategoryFilter.MALE))
        assertFalse(RaceLogic.matchesCategory(worldMen, Constants.CategoryFilter.FEMALE))
        assertTrue(RaceLogic.matchesCategory(worldWomen, Constants.CategoryFilter.FEMALE))
        assertFalse(RaceLogic.matchesCategory(worldWomen, Constants.CategoryFilter.MALE))
        assertTrue(RaceLogic.matchesCategory(europeMen, Constants.CategoryFilter.MALE))
        assertFalse(RaceLogic.matchesCategory(europeMen, Constants.CategoryFilter.FEMALE))
        assertTrue(RaceLogic.matchesCategory(europeWomen, Constants.CategoryFilter.FEMALE))
        assertFalse(RaceLogic.matchesCategory(europeWomen, Constants.CategoryFilter.MALE))
        assertTrue(RaceLogic.matchesCategory(mixedRelay, Constants.CategoryFilter.MALE))
        assertTrue(RaceLogic.matchesCategory(mixedRelay, Constants.CategoryFilter.FEMALE))
        assertTrue(RaceLogic.matchesCategory(mixedRelay, Constants.CategoryFilter.PRO))
    }

    // ── matchesCategory con Campeonatos Nacionales (CN) ────────────
    // CN élite (masc/fem) cuentan como Pro; las sub23 quedan fuera de
    // Pro/Masc/Fem. Masc/Fem respetan el género de la prueba.

    private fun cn(name: String, gender: String? = null) =
        race(uciCategory = "CN", name = name, gender = gender, countryCode = "ES")

    @Test fun `CN elite entra en Pro (masc y fem)`() {
        assertTrue(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Masculino", "male"), Constants.CategoryFilter.PRO))
        assertTrue(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Femenino", "female"), Constants.CategoryFilter.PRO))
    }

    @Test fun `CN sub23 NO entra en Pro`() {
        assertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea sub-23 Masculino", "male"), Constants.CategoryFilter.PRO))
        assertFalse(RaceLogic.matchesCategory(cn("Campeonato de España CRI sub-23 Femenino", "female"), Constants.CategoryFilter.PRO))
    }

    @Test fun `CN en Masc solo elite masculino`() {
        assertTrue(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Masculino", "male"), Constants.CategoryFilter.MALE))
        assertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Femenino", "female"), Constants.CategoryFilter.MALE))
        assertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea sub-23 Masculino", "male"), Constants.CategoryFilter.MALE))
    }

    @Test fun `CN en Fem solo elite femenino`() {
        assertTrue(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Femenino", "female"), Constants.CategoryFilter.FEMALE))
        assertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Masculino", "male"), Constants.CategoryFilter.FEMALE))
        assertFalse(RaceLogic.matchesCategory(cn("Campeonato de España CRI sub-23 Femenino", "female"), Constants.CategoryFilter.FEMALE))
    }

    @Test fun `CN no entra en UWT ni WWT`() {
        assertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Masculino", "male"), Constants.CategoryFilter.UWT))
        assertFalse(RaceLogic.matchesCategory(cn("Campeonato de España Línea Élite Femenino", "female"), Constants.CategoryFilter.WWT))
    }
}
