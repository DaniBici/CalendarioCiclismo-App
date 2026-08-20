package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceUciStage
import app.calendariociclismo.android.data.model.UciRank1Row
import app.calendariociclismo.android.util.ResultsFeedLogic.Kind
import org.junit.Assert.*
import org.junit.Test

/**
 * Port de los casos clave de `js/resultados-feed.js` (fetchEntries +
 * cmpEntries), incluidos los bugs reales cazados en la web: el orden del día
 * con hora POR CARRERA-DÍA (sin ella el comparador no es transitivo y las
 * vueltas que acaban el mismo día se entrelazan) y las fechas NULL de los
 * volcados PDF (migración 090).
 */
class ResultsFeedLogicTest {

    private fun race(
        id: String,
        format: String = "stage_race",
        uci: String? = "2.1",
        gender: String? = "male",
        name: String = id,
        gt: Boolean = false,
        fcId: Int? = null,
        start: String? = null,
        end: String? = null,
    ) = Race(
        id = id, name = name, uciCategory = uci, gender = gender,
        raceFormat = format, isGrandTour = gt, fcId = fcId,
        startDate = start, endDate = end,
    )

    private fun stage(
        id: String,
        raceId: String,
        kind: String = "stage",
        sn: Int? = 1,
        date: String? = "2026-05-31",
        final: Boolean = false,
        winner: String? = null,
        rdId: String? = null,
    ) = RaceUciStage(
        id = id, raceId = raceId, raceDayId = rdId, classKind = kind,
        stageNumber = sn, isFinalClassification = final,
        keepForWeb = true, rowCount = 100, stageDate = date, winnerName = winner,
    )

    private fun rd(
        id: String,
        raceId: String,
        dateKey: String,
        sn: Int? = 1,
        start: String? = null,
        countryCode: String? = null,
    ) = RaceDay(
        id = id, raceId = raceId, dateKey = dateKey, stageNumber = sn,
        neutralStartTimeUtc = start, countryCode = countryCode,
    )

    // ── Override de país por jornada sin raceDayId en la clasificación ──

    @Test
    fun `la etapa sin raceDayId resuelve su jornada por stageNumber (override de pais)`() {
        // Giro della Valle d'Aosta: carrera italiana, et1 disputada en Francia.
        // El volcado in-house NO trajo raceDayId → la jornada (con countryCode='FR')
        // se resuelve por stageNumber; sin ello la bandera caería al país de la carrera.
        val r = race("aosta", format = "stage_race")
        val stages = listOf(
            stage("s1", "aosta", sn = 1, date = "2026-07-16", rdId = null),
            stage("s2", "aosta", sn = 2, date = "2026-07-17", rdId = null),
        )
        val days = listOf(
            rd("d1", "aosta", "2026-07-16", sn = 1, countryCode = "FR"),
            rd("d2", "aosta", "2026-07-17", sn = 2, countryCode = "IT"),
        )
        val entries = ResultsFeedLogic.buildEntries(
            stages, days, listOf(r), "2026-07-05", "2026-07-18",
        )
        val e1 = entries.first { it.stageNumber == 1 }
        val e2 = entries.first { it.stageNumber == 2 }
        assertEquals("d1", e1.rd?.id)
        assertEquals("FR", e1.rd?.countryCode)
        assertEquals("IT", e2.rd?.countryCode)
    }

    @Test
    fun `raceDayId presente gana al fallback por stageNumber`() {
        val r = race("x", format = "stage_race")
        val stages = listOf(stage("s1", "x", sn = 1, date = "2026-07-16", rdId = "real"))
        val days = listOf(
            rd("real", "x", "2026-07-16", sn = 1, countryCode = "FR"),
            rd("decoy", "x", "2026-07-16", sn = 1, countryCode = "IT"),
        )
        val entries = ResultsFeedLogic.buildEntries(stages, days, listOf(r), "2026-07-05", "2026-07-18")
        assertEquals("real", entries.first().rd?.id)
    }

    // ── Pruebas de un día ────────────────────────────────────────────

    @Test
    fun `un dia prefiere la gc final sobre la fila stage, en ambos ordenes`() {
        val r = race("amstel", format = "one_day", uci = "1.UWT", start = "2026-04-19")
        // stage primero, final después → la final mejora la entrada en sitio.
        var entries = ResultsFeedLogic.buildEntries(
            listOf(
                stage("st1", "amstel", kind = "stage", sn = null, date = "2026-04-19", winner = "A"),
                stage("gc1", "amstel", kind = "gc", sn = null, final = true, date = "2026-04-19", winner = "B"),
            ),
            emptyList(), listOf(r), "2026-04-01", "2026-04-30",
        )
        assertEquals(1, entries.size)
        assertEquals("B", entries[0].winner)
        assertEquals("gc1", entries[0].stageRefId)
        assertNull(entries[0].stageNumber)

        // final primero, stage después → la stage NO duplica ni pisa.
        entries = ResultsFeedLogic.buildEntries(
            listOf(
                stage("gc1", "amstel", kind = "gc", sn = null, final = true, date = "2026-04-19", winner = "B"),
                stage("st1", "amstel", kind = "stage", sn = null, date = "2026-04-19", winner = "A"),
            ),
            emptyList(), listOf(r), "2026-04-01", "2026-04-30",
        )
        assertEquals(1, entries.size)
        assertEquals("B", entries[0].winner)
    }

    @Test
    fun `una gc NO final de un dia se ignora`() {
        val r = race("brussels", format = "one_day", start = "2026-06-07")
        val entries = ResultsFeedLogic.buildEntries(
            listOf(stage("gcp", "brussels", kind = "gc", sn = 1, final = false, date = "2026-06-07")),
            emptyList(), listOf(r), "2026-06-01", "2026-06-30",
        )
        assertTrue(entries.isEmpty())
    }

    // ── Generales finales de vueltas ─────────────────────────────────

    @Test
    fun `la general final va POR DELANTE de la etapa de su carrera`() {
        val r = race("giro", gt = true, uci = "2.UWT")
        val entries = ResultsFeedLogic.buildEntries(
            listOf(
                stage("e21", "giro", kind = "stage", sn = 21, date = "2026-05-31", winner = "Etapa"),
                stage("gcf", "giro", kind = "gc", sn = null, final = true, date = "2026-05-31", winner = "Vingegaard"),
            ),
            emptyList(), listOf(r), "2026-05-01", "2026-05-31",
        )
        assertEquals(2, entries.size)
        assertTrue(entries[0].isGcFinal)
        assertEquals(21, entries[1].stageNumber)
    }

    @Test
    fun `adyacencia con varias vueltas acabando el mismo dia (hora por carrera-dia)`() {
        // Caso real (31 de mayo): varias vueltas con general final + etapa. Si el
        // desempate usara el rd de CADA entrada (las generales no tienen rd →
        // 999999), el comparador no sería transitivo y los bloques se entrelazan.
        val japon = race("japon", uci = "2.2", name = "Tour de Japón")
        val lituania = race("lituania", uci = "2.2", name = "Tour de Lituania")
        val rdJapon = rd("rdJ", "japon", "2026-05-31", sn = 8, start = "2026-05-31T02:00:00Z")
        val rdLituania = rd("rdL", "lituania", "2026-05-31", sn = 4, start = "2026-05-31T10:00:00Z")
        val entries = ResultsFeedLogic.buildEntries(
            listOf(
                stage("eL", "lituania", sn = 4, date = "2026-05-31", rdId = "rdL"),
                stage("gJ", "japon", kind = "gc", sn = null, final = true, date = "2026-05-31"),
                stage("eJ", "japon", sn = 8, date = "2026-05-31", rdId = "rdJ"),
                stage("gL", "lituania", kind = "gc", sn = null, final = true, date = "2026-05-31"),
            ),
            listOf(rdJapon, rdLituania), listOf(japon, lituania), "2026-05-01", "2026-05-31",
        )
        val orden = entries.map { "${it.race.id}#${if (it.isGcFinal) "gc" else it.stageNumber}" }
        // Japón sale antes (hora 02:00 < 10:00) y cada general pegada DELANTE de su etapa.
        assertEquals(listOf("japon#gc", "japon#8", "lituania#gc", "lituania#4"), orden)
    }

    // ── Fechas (volcados PDF con stageDate NULL) ─────────────────────

    @Test
    fun `stageDate null resuelve por la jornada y por las fechas de carrera`() {
        val fb = race("fb", format = "one_day", start = "2026-06-10")
        val vuelta = race("vuelta", start = "2026-06-01", end = "2026-06-08")
        val rdFb = rd("rdFb", "fb", "2026-06-10", sn = null)
        val entries = ResultsFeedLogic.buildEntries(
            listOf(
                // un día PDF: sin stageDate, CON raceDayId → fecha de la jornada.
                stage("gFb", "fb", kind = "gc", sn = null, final = true, date = null, rdId = "rdFb"),
                // general final de vuelta sin stageDate ni jornada → endDate.
                stage("gV", "vuelta", kind = "gc", sn = null, final = true, date = null),
            ),
            listOf(rdFb), listOf(fb, vuelta), "2026-06-01", "2026-06-30",
        )
        assertEquals(2, entries.size)
        assertEquals("2026-06-10", entries.first { it.race.id == "fb" }.date)
        assertEquals("2026-06-08", entries.first { it.race.id == "vuelta" }.date)
    }

    @Test
    fun `el filtro de ventana se aplica DESPUES de resolver la fecha`() {
        val fb = race("fb", format = "one_day", start = "2026-06-10")
        val rdFb = rd("rdFb", "fb", "2026-06-10", sn = null)
        // Ventana que NO incluye el 10 de junio → fuera aunque stageDate sea null.
        val entries = ResultsFeedLogic.buildEntries(
            listOf(stage("gFb", "fb", kind = "gc", sn = null, final = true, date = null, rdId = "rdFb")),
            listOf(rdFb), listOf(fb), "2026-06-11", "2026-06-20",
        )
        assertTrue(entries.isEmpty())
    }

    // ── Ganadores ────────────────────────────────────────────────────

    @Test
    fun `cleanWinner filtra la pseudo-fila de etapa cancelada`() {
        assertEquals("", ResultsFeedLogic.cleanWinner("Race Cancelled"))
        assertEquals("", ResultsFeedLogic.cleanWinner("Cancelled Race"))
        assertEquals("", ResultsFeedLogic.cleanWinner(null))
        assertEquals("SIMMONS Quinn", ResultsFeedLogic.cleanWinner("SIMMONS Quinn"))
    }

    @Test
    fun `winnerRiderIds descarta abandonos y deduplica`() {
        val map = ResultsFeedLogic.winnerRiderIdsByStageRef(
            listOf(
                UciRank1Row("s1", "rider-a"),
                UciRank1Row("s1", "rider-a"),          // duplicado
                UciRank1Row("s2", "rider-dns", irm = "DNS"),  // rank 1 espurio
                UciRank1Row("s3", "rider-b"),
                UciRank1Row("s3", "rider-c"),          // CRE variante A
            )
        )
        assertEquals(listOf("rider-a"), map["s1"])
        assertNull(map["s2"])
        assertEquals(listOf("rider-b", "rider-c"), map["s3"])
    }

    @Test
    fun `isCreEntry detecta variante A (varios rank 1) y B (jornada ttt)`() {
        val r = race("dauphine")
        val cre = ResultsFeedLogic.FeedEntry(
            kind = Kind.INHOUSE, date = "2026-06-09", race = r, stageNumber = 3,
            rd = rd("rd3", "dauphine", "2026-06-09", sn = 3).copy(primaryType = "ttt"),
            stageRefId = "s3",
        )
        assertTrue(ResultsFeedLogic.isCreEntry(cre, listOf("solo-lider")))      // variante B
        val normal = cre.copy(rd = rd("rd3", "dauphine", "2026-06-09", sn = 3))
        assertTrue(ResultsFeedLogic.isCreEntry(normal, listOf("a", "b")))       // variante A
        assertFalse(ResultsFeedLogic.isCreEntry(normal, listOf("a")))
        val gcFinal = cre.copy(isGcFinal = true, rd = null)
        assertFalse(ResultsFeedLogic.isCreEntry(gcFinal, listOf("a", "b")))
    }

    // ── Fallback FC/PCS ──────────────────────────────────────────────

    @Test
    fun `jornada concluida sin volcado genera entrada EXT y la cubierta no`() {
        // Jornada de 2020 → concluida seguro para la heurística meta+30.
        val conFc = race("beauce", fcId = 99)
        val rdSin = rd("rdB", "beauce", "2026-06-10", sn = 1)
            .copy(estimatedFinishTimeUtc = "2020-01-01T15:00:00Z")
        val entries = ResultsFeedLogic.buildEntries(
            emptyList(), listOf(rdSin), listOf(conFc), "2026-06-01", "2026-06-30",
        )
        assertEquals(1, entries.size)
        assertEquals(Kind.EXT, entries[0].kind)

        // Con volcado in-house de esa clave → NO hay entrada EXT duplicada.
        val cubierta = ResultsFeedLogic.buildEntries(
            listOf(stage("e1", "beauce", sn = 1, date = "2026-06-10", winner = "X")),
            listOf(rdSin), listOf(conFc), "2026-06-01", "2026-06-30",
        )
        assertEquals(1, cubierta.size)
        assertEquals(Kind.INHOUSE, cubierta[0].kind)
    }

    @Test
    fun `un dia cubierto por la clave final no genera EXT aunque la jornada tenga stageNumber`() {
        val fb = race("fb", format = "one_day", fcId = 7, start = "2026-06-10")
        val rdFb = rd("rdFb", "fb", "2026-06-10", sn = 1)
            .copy(estimatedFinishTimeUtc = "2020-01-01T15:00:00Z")
        val entries = ResultsFeedLogic.buildEntries(
            listOf(stage("gFb", "fb", kind = "gc", sn = null, final = true, date = "2026-06-10")),
            listOf(rdFb), listOf(fb), "2026-06-01", "2026-06-30",
        )
        assertEquals(1, entries.size)
        assertEquals(Kind.INHOUSE, entries[0].kind)
    }

    @Test
    fun `sin fcId ni pcsSlug no hay entrada EXT`() {
        val sinFuentes = race("gyeongnam")
        val rdG = rd("rdG", "gyeongnam", "2026-06-11", sn = 3)
            .copy(estimatedFinishTimeUtc = "2020-01-01T15:00:00Z")
        val entries = ResultsFeedLogic.buildEntries(
            emptyList(), listOf(rdG), listOf(sinFuentes), "2026-06-01", "2026-06-30",
        )
        assertTrue(entries.isEmpty())
    }

    // ── Orden global ─────────────────────────────────────────────────

    @Test
    fun `dos Campeonatos Nacionales se ordenan por pais y luego linea-CRI`() {
        // Espec Dani: país (COUNTRY_ORDER) → línea masc/fem/sub23m/sub23f →
        // CRI masc/fem/sub23m/sub23f. Las CN son carreras de un día; cada una
        // entra como gc final con su jornada (rd) → cmpEntries aplica el orden.
        // Mezcla desordenada de ES (top-6), Francia y Gran Bretaña el mismo día.
        fun cn(id: String, name: String, cc: String, gender: String) =
            race(id, format = "one_day", uci = "CN", gender = gender, name = name)
                .copy(countryCode = cc, startDate = "2026-06-25")
        val races = listOf(
            cn("es-cri-f",   "Campeonato de España CRI femenino",         "ES", "female"),
            cn("fr-linea-m", "Campeonato de Francia línea masculino",     "FR", "male"),
            cn("es-linea-m", "Campeonato de España línea masculino",      "ES", "male"),
            cn("es-cri-m",   "Campeonato de España CRI masculino",        "ES", "male"),
            cn("gb-linea-f", "Campeonato de Gran Bretaña línea femenino",  "GB", "female"),
            cn("es-linea-f", "Campeonato de España línea femenino",       "ES", "female"),
            cn("es-cri-s23m","Campeonato de España CRI sub23 masculino",  "ES", "male"),
            cn("es-linea-s23m","Campeonato de España línea sub23 masculino","ES", "male"),
        )
        val stages = races.map {
            stage("st-${it.id}", it.id, kind = "gc", sn = null, final = true, date = "2026-06-25")
        }
        val rds = races.map { rd("rd-${it.id}", it.id, "2026-06-25", sn = null) }
        val entries = ResultsFeedLogic.buildEntries(
            stages, rds, races, "2026-06-01", "2026-06-30",
        )
        assertEquals(
            listOf(
                // España (top-6): toda la línea antes que toda la CRI; dentro de
                // cada bloque, masc → fem → sub23 masc → sub23 fem.
                "es-linea-m", "es-linea-f", "es-linea-s23m",
                "es-cri-m", "es-cri-f", "es-cri-s23m",
                // Luego Francia, luego Gran Bretaña (orden de COUNTRY_ORDER).
                "fr-linea-m", "gb-linea-f",
            ),
            entries.map { it.race.id },
        )
    }

    @Test
    fun `cronologia inversa entre dias y canonico dentro del dia`() {
        val gt = race("giro", gt = true, uci = "2.UWT", name = "Giro")
        val menor = race("camerun", uci = "2.2", name = "Vuelta a Camerún")
        val entries = ResultsFeedLogic.buildEntries(
            listOf(
                stage("c5", "camerun", sn = 5, date = "2026-06-08"),
                stage("g20", "giro", sn = 20, date = "2026-05-30"),
                stage("c6", "camerun", sn = 6, date = "2026-06-09"),
                stage("g21", "giro", sn = 21, date = "2026-06-09"),
            ),
            emptyList(), listOf(gt, menor), "2026-05-01", "2026-06-30",
        )
        val orden = entries.map { "${it.race.id}#${it.stageNumber}" }
        // 9 jun primero (Giro GT antes que Camerún), después 8 jun, después 30 may.
        assertEquals(listOf("giro#21", "camerun#6", "camerun#5", "giro#20"), orden)
    }
}
