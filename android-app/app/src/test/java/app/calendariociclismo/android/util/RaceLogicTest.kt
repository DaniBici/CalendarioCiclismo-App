package app.calendariociclismo.android.util

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.data.model.ElevationPoint
import app.calendariociclismo.android.data.model.ElevationProfile
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35]) // Robolectric 4.14.1 soporta hasta API 35; la app compila contra 36.
class RaceLogicTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        // Las etiquetas vía LocaleHolder.t() dependen del idioma; fijamos ES para
        // que `resolveTypeLabel` (p. ej. "Monopuerto") sea determinista.
        LocaleHolder.system = Locale("es", "ES")
        LocaleHolder.current = Locale("es", "ES")
    }

    // ── buildFcUrl ─────────────────────────────────────────────────

    @Test
    fun `buildFcUrl devuelve null si la carrera no tiene fcId`() {
        val race = race(fcId = null, year = 2026)
        assertNull(RaceLogic.buildFcUrl(race, stageNumber = null))
    }

    @Test
    fun `buildFcUrl devuelve url base para clasica sin numero de etapa`() {
        val race = race(fcId = 17, year = 2026)
        assertEquals("https://firstcycling.com/race.php?r=17&y=2026",
            RaceLogic.buildFcUrl(race, stageNumber = null))
    }

    @Test
    fun `buildFcUrl anade numero de etapa con padding de dos digitos`() {
        val race = race(fcId = 17, year = 2026)
        assertEquals("https://firstcycling.com/race.php?r=17&y=2026&e=03",
            RaceLogic.buildFcUrl(race, stageNumber = 3))
    }

    @Test
    fun `buildFcUrl anade numero de etapa de dos digitos sin padding extra`() {
        val race = race(fcId = 17, year = 2026)
        assertEquals("https://firstcycling.com/race.php?r=17&y=2026&e=14",
            RaceLogic.buildFcUrl(race, stageNumber = 14))
    }

    // ── buildPcsUrl ────────────────────────────────────────────────

    @Test
    fun `buildPcsUrl devuelve null si la carrera no tiene pcsSlug`() {
        val race = race(pcsSlug = null, year = 2026)
        assertNull(RaceLogic.buildPcsUrl(race, stageNumber = null))
    }

    @Test
    fun `buildPcsUrl devuelve url de resultado general para clasica`() {
        val race = race(pcsSlug = "tour-de-france", year = 2026)
        assertEquals("https://www.procyclingstats.com/race/tour-de-france/2026/result",
            RaceLogic.buildPcsUrl(race, stageNumber = null))
    }

    @Test
    fun `buildPcsUrl devuelve url de prologo`() {
        val race = race(pcsSlug = "tour-de-france", year = 2026)
        assertEquals("https://www.procyclingstats.com/race/tour-de-france/2026/prologue/result",
            RaceLogic.buildPcsUrl(race, stageNumber = 0))
    }

    @Test
    fun `buildPcsUrl devuelve url de etapa sin padding`() {
        val race = race(pcsSlug = "giro-d-italia", year = 2026)
        assertEquals("https://www.procyclingstats.com/race/giro-d-italia/2026/stage-3/result",
            RaceLogic.buildPcsUrl(race, stageNumber = 3))
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

    // ── shouldShowResults ──────────────────────────────────────────

    @Test
    fun `shouldShowResults false para dia de descanso`() {
        val rd = raceDay(isRestDay = true)
        val race = race(fcId = 1)
        assertFalse(RaceLogic.shouldShowResults(rd, race))
    }

    @Test
    fun `shouldShowResults false para etapa cancelada`() {
        val rd = raceDay(isCancelledDay = true)
        val race = race(fcId = 1)
        assertFalse(RaceLogic.shouldShowResults(rd, race))
    }

    @Test
    fun `shouldShowResults false si carrera no tiene fcId ni pcsSlug`() {
        val rd = raceDay()
        val race = race(fcId = null, pcsSlug = null)
        assertFalse(RaceLogic.shouldShowResults(rd, race))
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

    // ── byCategory: prioridad de miniperfil ───────────────────────

    @Test
    fun `byCategory pone la jornada con miniperfil por delante de una de categoria superior sin perfil`() {
        val conPerfil = enriched(race(uciCategory = "2.2", name = "Con perfil"), withProfile = true)
        val sinPerfil = enriched(race(uciCategory = "2.1", name = "Sin perfil"), withProfile = false)
        val ordenado = listOf(sinPerfil, conPerfil).sortedWith(RaceLogic.byCategory)
        assertEquals("Con perfil", ordenado.first().race?.name)
    }

    @Test
    fun `byCategory dentro del grupo con perfil mantiene el orden por categoria`() {
        val pro = enriched(race(uciCategory = "2.Pro", name = "Pro"), withProfile = true)
        val dosDos = enriched(race(uciCategory = "2.2", name = "DosDos"), withProfile = true)
        val ordenado = listOf(dosDos, pro).sortedWith(RaceLogic.byCategory)
        assertEquals(listOf("Pro", "DosDos"), ordenado.map { it.race?.name })
    }

    @Test
    fun `byCategory trata profileNotViewable como sin perfil`() {
        val oculto = enriched(race(uciCategory = "2.1", name = "Oculto"), withProfile = true, notViewable = true)
        val visible = enriched(race(uciCategory = "2.2", name = "Visible"), withProfile = true)
        val ordenado = listOf(oculto, visible).sortedWith(RaceLogic.byCategory)
        assertEquals("Visible", ordenado.first().race?.name)
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

    private fun race(
        fcId: Int? = null,
        pcsSlug: String? = null,
        year: Int? = 2026,
        uciCategory: String? = "1.UWT",
        gender: String? = null,
        name: String = "Test Race",
        countryCode: String? = null,
        raceFormat: String? = null,
        isGrandTour: Boolean = false,
    ) = Race(
        id = "r1",
        name = name,
        uciCategory = uciCategory,
        gender = gender,
        raceFormat = raceFormat,
        countryCode = countryCode,
        fcId = fcId,
        pcsSlug = pcsSlug,
        year = year,
        isGrandTour = isGrandTour,
    )

    private fun raceDay(
        dateKey: String = "2026-01-01",
        isRestDay: Boolean = false,
        isCancelledDay: Boolean = false,
        estimatedFinishTimeUtc: String? = null,
    ) = RaceDay(
        id = "rd1",
        dateKey = dateKey,
        isRestDay = isRestDay,
        isCancelledDay = isCancelledDay,
        estimatedFinishTimeUtc = estimatedFinishTimeUtc,
    )

    /** EnrichedRaceDay con (o sin) miniperfil para los tests de orden. */
    private fun enriched(
        race: Race,
        withProfile: Boolean,
        notViewable: Boolean = false,
    ): EnrichedRaceDay {
        val profile = if (withProfile)
            ElevationProfile(
                distance = 100.0,
                points = listOf(ElevationPoint(0.0, 0), ElevationPoint(100.0, 500)),
            ) else null
        return EnrichedRaceDay(
            raceDay = RaceDay(
                id = "rd-${race.name}",
                dateKey = "2026-01-01",
                elevationProfile = profile,
                profileNotViewable = notViewable,
            ),
            race = race,
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
