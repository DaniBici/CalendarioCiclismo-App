package app.calendariociclismo.android.data.repository

import app.calendariociclismo.android.data.local.dao.CxCacheDao
import app.calendariociclismo.android.data.local.entity.CxDetailCacheEntity
import app.calendariociclismo.android.data.local.entity.CxMonthCacheEntity
import app.calendariociclismo.android.data.model.CxDetail
import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.CxRound
import app.calendariociclismo.android.data.model.CxTournament
import app.calendariociclismo.android.data.model.CxTournamentGeneral
import app.calendariociclismo.android.util.CxPresentation
import app.calendariociclismo.android.util.CyclocrossLogic
import java.time.YearMonth
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface CxRemote {
    suspend fun cxMonth(season: String, month: YearMonth): List<CxRace>
    suspend fun cxNextDate(season: String, date: String): String?
    suspend fun cxTournamentNextDate(season: String, date: String, tournamentId: String): String? = throw java.io.IOException("Offline")
    suspend fun cxDetail(id: String): CxDetail?
    suspend fun cxRaceForSlug(slug: String): CxRace?
    suspend fun cxTournamentForSlug(slug: String): CxTournament? = throw java.io.IOException("Offline")
    suspend fun cxSeasonRounds(season: String): Map<String, CxRound> = throw java.io.IOException("Offline")
    /** Variantes que ignoran las clases ocultas en el idioma activo (`CxPresentation.hiddenClasses`). */
    suspend fun cxNextDate(season: String, date: String, excluding: List<String>): String? = cxNextDate(season, date)
    suspend fun cxTournamentNextDate(season: String, date: String, tournamentId: String, excluding: List<String>): String? =
        cxTournamentNextDate(season, date, tournamentId)
    /** `true` si el torneo tiene alguna carrera publicada fuera de [excluding]. */
    suspend fun cxTournamentHasRaces(tournamentId: String, excluding: List<String>): Boolean = true
    suspend fun cxRacesByIds(ids: List<String>): List<CxRace> = throw java.io.IOException("Offline")
    suspend fun cxTournamentGeneral(tournamentId: String, seasonKey: String): CxTournamentGeneral = throw java.io.IOException("Offline")
}

data class CxCached<T>(val data: T, val offline: Boolean = false, val cachedAt: Long)

class CyclocrossRepository(private val dao: CxCacheDao, private val remote: CxRemote) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun cachedMonth(season: String, month: YearMonth): CxCached<List<CxRace>>? =
        if (month !in CyclocrossLogic.months(season)) null else dao.month("$season:$month")?.let {
            CxCached(json.decodeFromString<List<CxRace>>(it.payload).filter(CxPresentation::listedInAgenda), true, it.cachedAt)
        }

    suspend fun month(season: String, month: YearMonth): CxCached<List<CxRace>> {
        require(month in CyclocrossLogic.months(season))
        return try {
            val races = remote.cxMonth(season, month)
            val now = System.currentTimeMillis()
            // La caché guarda el mes completo; el idioma y las cancelaciones se
            // aplican al leer.
            dao.saveMonth(CxMonthCacheEntity("$season:$month", season, month.toString(), json.encodeToString(races), now))
            CxCached(races.filter(CxPresentation::listedInAgenda), false, now)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            cachedMonth(season, month) ?: throw error
        }
    }

    suspend fun cachedDetail(id: String): CxCached<CxDetail>? = dao.detail(id)?.let { row ->
        val value = json.decodeFromString<CxDetail>(row.payload)
        value.takeIf { CyclocrossLogic.raceInSeason(it.race) }?.let { CxCached(it, true, row.cachedAt) }
    }

    suspend fun detail(id: String): CxCached<CxDetail>? = try {
        remote.cxDetail(id)?.takeIf { CyclocrossLogic.raceInSeason(it.race) }?.let { value ->
            val now = System.currentTimeMillis()
            dao.saveDetail(CxDetailCacheEntity(id, value.race.slug, value.race.slugEn, json.encodeToString(value), now))
            CxCached(value, false, now)
        }
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        cachedDetail(id) ?: throw error
    }

    suspend fun raceIdForSlug(slug: String): String? = try {
        remote.cxRaceForSlug(slug)?.id
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        dao.detailBySlug(slug)?.id ?: dao.monthsFromSlug(slug)
    }

    /** Resolución slug → torneo para los App Links de página de serie. */
    suspend fun tournamentForSlug(slug: String): CxTournament? = try {
        remote.cxTournamentForSlug(slug)
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        null
    }

    /** `false` si, en el idioma activo, todas las carreras del torneo están
     *  ocultas (torneo solo nacional en inglés). Sin conexión se muestra. */
    suspend fun tournamentIsVisible(tournamentId: String): Boolean {
        val hidden = CxPresentation.hiddenClasses
        if (hidden.isEmpty()) return true
        return try {
            remote.cxTournamentHasRaces(tournamentId, hidden)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            true
        }
    }

    // Numeración n/total por temporada, en memoria; sin cachear el fallo para
    // que un reintento vuelva a consultar. Fallo → mapa vacío (insignia ausente),
    // o el mapa ya guardado si [force] pedía renovarlo.
    private val roundsCache = mutableMapOf<String, Map<String, CxRound>>()

    suspend fun rounds(season: String, force: Boolean = false): Map<String, CxRound> {
        if (!force) roundsCache[season]?.let { return it }
        return try {
            remote.cxSeasonRounds(season).also { roundsCache[season] = it }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            roundsCache[season] ?: emptyMap()
        }
    }

    /** Clasificaciones generales de un torneo; el fallo se propaga. */
    suspend fun tournamentGeneral(tournamentId: String, seasonKey: String): CxTournamentGeneral =
        remote.cxTournamentGeneral(tournamentId, seasonKey)

    /** Carreras de las rondas de una general (nombre y enlace de cada columna).
     *  Sin conexión, las que ya estén en la caché de meses. */
    suspend fun roundRaces(ids: List<String>): List<CxRace> {
        if (ids.isEmpty()) return emptyList()
        return try {
            remote.cxRacesByIds(ids)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            val wanted = ids.toSet()
            dao.allMonths().flatMap { json.decodeFromString<List<CxRace>>(it.payload) }.filter { it.id in wanted }.distinctBy { it.id }
        }
    }

    // Buscar en los meses ya guardados no provoca una descarga de temporada.
    private suspend fun CxCacheDao.monthsFromSlug(slug: String): String? =
        allMonths().asSequence().flatMap { json.decodeFromString<List<CxRace>>(it.payload).asSequence() }
            .firstOrNull { it.slug == slug || it.slugEn == slug }?.id

    suspend fun nextDate(season: String, date: String, tournamentId: String? = null): String? = try {
        val hidden = CxPresentation.hiddenClasses
        if (tournamentId == null) remote.cxNextDate(season, date, hidden) else remote.cxTournamentNextDate(season, date, tournamentId, hidden)
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        dao.months(season).flatMap { json.decodeFromString<List<CxRace>>(it.payload) }
            .filter { CxPresentation.listedInAgenda(it) && (tournamentId == null || it.tournamentId == tournamentId) }
            .flatMap { race -> if (race.categories.isEmpty()) listOf(race.dateKey) else
                race.categories.filterNot { it.isCancelled }.map { it.dateKey ?: race.dateKey } }
            .filter { it >= date && it.take(7) in CyclocrossLogic.months(season).map(YearMonth::toString) }.minOrNull()
    }

    suspend fun clear() {
        dao.clearMonths()
        dao.clearDetails()
    }

    suspend fun artworkUrls(): Set<String> {
        val races = dao.allMonths().flatMap { json.decodeFromString<List<CxRace>>(it.payload) } +
            dao.allDetails().map { json.decodeFromString<CxDetail>(it.payload).race }
        return races.flatMap { listOfNotNull(it.logoUrl, it.tournament?.logoUrl) }.filter { it.isNotBlank() }.toSet()
    }

    /** Solo estos dos meses; no consulta ni descarga una temporada CX completa. */
    suspend fun prepareOfflineMonth(month: YearMonth) {
        val season = CyclocrossLogic.season(month.atDay(1))
        for (race in month(season, month).data) detail(race.id)
    }
}
