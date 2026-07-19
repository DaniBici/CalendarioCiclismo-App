package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.RiderProfile
import app.calendariociclismo.android.data.model.RiderTransfer
import app.calendariociclismo.android.data.model.TeamSeason

/**
 * Lógica pura de la pantalla de Fichajes (apps 4.0) — espejo 1:1 de
 * `js/fichajes.js` (web). Testeada en [TransfersLogicTest].
 *
 * Reglas de producto (decisión Dani):
 *  - El feed lista SOLO confirmaciones (fichajes + renovaciones + retiradas);
 *    los rumores y las dudas no aparecen en él. Tampoco los movimientos con la
 *    fecha oculta (dateVisible=false, mig. 123): la carga inicial del mercado
 *    mete de golpe anuncios de hace semanas que llenarían el feed de días
 *    viejos, pero SÍ deben contar en el detalle de equipo.
 *  - En el detalle de equipo, una salida registrada (confirmada O rumoreada)
 *    saca al corredor de "continúan" y lo pinta en "se marchan" (con badge
 *    Rumor si procede); en el destino aparece en "llegan · Rumor".
 *  - Cuarta situación: una renovación EN DUDA (status='doubt', solo válido en
 *    type='renewal') = no se sabe si sigue. Saca al corredor de "continúan" y
 *    lo lleva a su sección "En duda" (2ª, antes de se marchan/llegan). Una duda
 *    sobre ir a OTRO equipo no es esto: eso es un fichaje con status='rumor'.
 *  - El contrato de una renovación registrada gana al `contractUntil` de la
 *    ficha; una renovación rumoreada marca la fila de "continúan" como Rumor.
 *    Una DUDA no toca el contrato (no es un hecho: no puede pisar el de la ficha).
 */
object TransfersLogic {

    /** Temporada del mercado activo. Al abrir el mercado 2028, subir aquí (y en la web). */
    const val MARKET_SEASON = 2027

    /** Las 4 divisiones del mercado, en el orden de los botones. */
    val DIVISIONS = listOf("WT", "WWT", "PT", "PRW")

    /** Género de la tabla riders_* por división (para cargar la plantilla). */
    fun divisionGender(category: String?): String? = when (category) {
        "WT", "PT", "CT", "NTM", "CLUBM" -> "male"
        "WWT", "PRW", "CTW", "NTW", "CLUBW" -> "female"
        else -> null
    }

    /** Payload de la carga inicial (lo monta CalendarRepository). */
    data class MarketData(
        val transfers: List<RiderTransfer>,
        val seasons: List<TeamSeason>,
        val ridersById: Map<String, RiderProfile>,
        /** teamId → nombre en la temporada del mercado (destino de un fichaje). */
        val teamNameById: Map<String, String>,
        /** teamId → nombre en la temporada en curso (origen: el equipo que el
         *  corredor deja, que se llama como se llama ESTA temporada). */
        val teamNamePrev: Map<String, String> = emptyMap(),
        /** teamId → fila team_seasons de la temporada EN CURSO (2026). Sus
         *  colores son los "antiguos" que se muestran mientras la chapa del
         *  mercado está oculta. Un equipo NUEVO (nacido en la temporada del
         *  mercado) no tiene entrada aquí → chapa vacía (mig. 129). */
        val prevSeasonsByTeamId: Map<String, TeamSeason> = emptyMap(),
    )

    /** Lado del movimiento del que se pide el nombre de un equipo. */
    enum class TeamSide { FROM, TO }

    /**
     * Chapa EFECTIVA de un equipo del mercado (decisión Dani 2026-07-18):
     *  - Colores del mercado PUBLICADOS (badgeVisible) → la fila del mercado (2027).
     *  - Sin publicar pero el equipo YA existía la temporada anterior → su fila
     *    ANTERIOR (2026): los colores que la gente ya conoce, hasta que se
     *    anuncie el kit.
     *  - Sin publicar y SIN identidad anterior (equipo nacido este año) → null
     *    (chapa vacía).
     */
    fun badgeSeason(season: TeamSeason, prev: Map<String, TeamSeason>): TeamSeason? =
        if (season.badgeVisible) season else prev[season.teamId]

    /**
     * Feed público: solo confirmados CON fecha visible, cronológico inverso.
     * `dateVisible=false` es un flag de publicación en el feed, no una fecha
     * ausente: el movimiento sigue contando en el detalle de equipo.
     */
    fun confirmedFeed(transfers: List<RiderTransfer>): List<RiderTransfer> =
        transfers.filter { it.status == "confirmed" && it.dateVisible }
            .sortedWith(
                compareByDescending<RiderTransfer> { it.announcedAt ?: "" }
                    .thenByDescending { it.createdAt ?: "" }
            )

    /** Agrupa el feed por día de anuncio conservando el orden de entrada. */
    fun groupByDay(feed: List<RiderTransfer>): List<Pair<String, List<RiderTransfer>>> {
        val out = ArrayList<Pair<String, MutableList<RiderTransfer>>>()
        feed.forEach { t ->
            val key = t.announcedAt ?: ""
            val last = out.lastOrNull()
            if (last != null && last.first == key) last.second += t
            else out += key to mutableListOf(t)
        }
        return out.map { it.first to it.second.toList() }
    }

    /** Equipos de una división, alfabético. */
    fun divisionTeams(seasons: List<TeamSeason>, division: String): List<TeamSeason> =
        seasons.filter { it.category == division }
            .sortedBy { (it.name ?: "").lowercase() }

    /** Fila de la sección "continúan". */
    data class StayingRow(
        val rider: RiderProfile,
        val contractUntil: Int?,
        val isRumor: Boolean,
    )

    /**
     * Fila de la sección "en duda". [rider] puede ser null si el corredor ya
     * no está en la plantilla y no se pudo hidratar su ficha → se cae al
     * riderId del movimiento.
     */
    data class DoubtRow(
        val rider: RiderProfile?,
        val riderId: String,
        val contractUntil: Int?,
    )

    data class TeamDetail(
        val staying: List<StayingRow>,
        val doubtful: List<DoubtRow>,
        val arrivals: List<RiderTransfer>,
        val departures: List<RiderTransfer>,
    )

    /**
     * Deriva las secciones del detalle de equipo. [roster] = plantilla actual
     * (riders con currentTeamId = equipo). Las retiradas cuentan como salida
     * (bloque "se marchan", sin destino). Orden de secciones en pantalla:
     * continúan → en duda → se marchan → llegan.
     */
    fun teamDetail(
        transfers: List<RiderTransfer>,
        roster: List<RiderProfile>,
        teamId: String,
    ): TeamDetail {
        val arrivals = transfers.filter { it.type == "transfer" && it.toTeamId == teamId }
        val departures = transfers.filter {
            (it.type == "transfer" || it.type == "retirement") && it.fromTeamId == teamId
        }
        // Renovación más reciente por corredor (transfers llega en orden desc).
        // Las EN DUDA van a su propio bucket: no anotan contrato ni "continúan".
        val renewalsByRider = HashMap<String, RiderTransfer>()
        val doubtsByRider = HashMap<String, RiderTransfer>()
        transfers.filter { it.type == "renewal" && it.toTeamId == teamId }
            .forEach {
                val bucket = if (it.status == "doubt") doubtsByRider else renewalsByRider
                bucket.putIfAbsent(it.riderId, it)
            }

        val gone = departures.map { it.riderId }.toSet()
        val staying = roster.filter { it.id !in gone && it.id !in doubtsByRider }
            .sortedBy { "${it.lastName.orEmpty()} ${it.firstName.orEmpty()}".lowercase() }
            .map { r ->
                val renewal = renewalsByRider[r.id]
                StayingRow(
                    rider = r,
                    contractUntil = renewal?.contractUntil ?: r.contractUntil,
                    isRumor = renewal?.status == "rumor",
                )
            }

        // En duda: la ficha de la plantilla manda; si el corredor ya no está en
        // ella, se pinta con lo que haya (nombre del movimiento en la UI).
        val byId = roster.associateBy { it.id }
        val doubtful = doubtsByRider.values
            .filter { it.riderId !in gone }
            .map { t -> DoubtRow(rider = byId[t.riderId], riderId = t.riderId, contractUntil = byId[t.riderId]?.contractUntil) }
            .sortedBy {
                val r = it.rider
                if (r != null) "${r.lastName.orEmpty()} ${r.firstName.orEmpty()}".lowercase() else it.riderId.lowercase()
            }

        return TeamDetail(staying = staying, doubtful = doubtful, arrivals = arrivals, departures = departures)
    }

    /**
     * Nombre a mostrar de un equipo referenciado (catálogo > texto libre > fallback).
     *
     * [side] elige la temporada: FROM = el equipo que el corredor deja, con el
     * nombre de la temporada en curso; TO = aquel con el que va a correr, con el
     * de la temporada del mercado.
     */
    fun teamLabel(
        teamId: String?,
        freeText: String?,
        names: Map<String, String>,
        unknownLabel: String,
        side: TeamSide = TeamSide.TO,
        namesPrev: Map<String, String> = emptyMap(),
    ): String {
        if (teamId != null) {
            val primary = if (side == TeamSide.FROM) namesPrev else names
            val fallback = if (side == TeamSide.FROM) names else namesPrev
            return primary[teamId] ?: fallback[teamId] ?: teamId
        }
        return if (!freeText.isNullOrBlank()) freeText else unknownLabel
    }
}
