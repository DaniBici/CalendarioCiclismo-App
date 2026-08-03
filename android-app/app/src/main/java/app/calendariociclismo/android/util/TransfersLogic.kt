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
    val DIVISIONS = listOf("WT", "PT", "WWT", "PRW")

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

    /** Marcador de "baja sin destino conocido" en el texto libre de destino. */
    const val UNKNOWN_DEST = "?"

    /**
     * Un FICHAJE REAL: corredor que cambia de equipo (`transfer` con destino
     * conocido). Las renovaciones, retiradas y fines de contrato sin destino
     * (`transfer` con `toTeamName='?'`) NO son fichajes → fuera del feed.
     */
    fun isRealSigning(x: RiderTransfer): Boolean =
        x.type == "transfer" && (x.toTeamId != null || (x.toTeamName != null && x.toTeamName != UNKNOWN_DEST))

    /**
     * Feed público: solo FICHAJES confirmados CON fecha visible, cronológico
     * inverso. `dateVisible=false` es un flag de publicación, no una fecha
     * ausente: el movimiento sigue contando en el detalle de equipo.
     */
    fun confirmedFeed(transfers: List<RiderTransfer>): List<RiderTransfer> =
        transfers.filter { it.status == "confirmed" && it.dateVisible && isRealSigning(it) }
            .sortedWith(
                compareByDescending<RiderTransfer> { it.announcedAt ?: "" }
                    // En una misma fecha, primero el mercado de la próxima temporada
                    // y después los fichajes efectivos de mitad de temporada.
                    .thenBy { if (it.midSeason) 1 else 0 }
                    .thenByDescending { it.createdAt ?: "" }
            )

    /** Feed público de renovaciones confirmadas con fecha visible. */
    fun renewalFeed(transfers: List<RiderTransfer>): List<RiderTransfer> =
        transfers.filter { it.status == "confirmed" && it.dateVisible && it.type == "renewal" }
            .sortedWith(
                compareByDescending<RiderTransfer> { it.announcedAt ?: "" }
                    .thenByDescending { it.createdAt ?: "" }
            )

    /**
     * Corte del feed "Últimas confirmaciones": hasta [FEED_MAX_DAYS] fechas
     * distintas O [FEED_MAX_ITEMS] fichajes, lo que se alcance antes (el feed
     * viene en orden cronológico inverso). No hay "cargar más".
     */
    const val FEED_MAX_DAYS = 5
    const val FEED_MAX_ITEMS = 8
    fun limitedFeed(feed: List<RiderTransfer>): List<RiderTransfer> {
        val out = ArrayList<RiderTransfer>()
        var lastDay: String? = null
        var daysShown = 0
        for (x in feed) {
            val day = x.announcedAt ?: ""
            val newDay = day != lastDay
            if (newDay && daysShown >= FEED_MAX_DAYS) break
            if (out.size >= FEED_MAX_ITEMS) break
            if (newDay) { lastDay = day; daysShown++ }
            out.add(x)
        }
        return out
    }

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
        val contractEnds: List<RiderTransfer>,
        val arrivals: List<RiderTransfer>,
        val departures: List<RiderTransfer>,
    )

    /**
     * Un "fin de contrato sin destino": acaba contrato sin equipo conocido
     * (`transfer` con `toTeamName='?'` y sin `toTeamId`) → sección "Terminan
     * contrato", no "Se marchan".
     */
    fun isContractEnd(x: RiderTransfer): Boolean =
        x.type == "transfer" && x.toTeamId == null && x.toTeamName == UNKNOWN_DEST

    /**
     * Deriva las secciones del detalle de equipo. [roster] = plantilla 2027
     * MATERIALIZADA (rider_team_affiliations year=market), con el contractUntil
     * de la afiliación. Los cambios de equipo ya no tienen afiliación aquí (no
     * entran en el roster); las dudas SÍ (siguen afiliadas) y se separan a su
     * bucket. Orden de secciones: continúan → en duda → se marchan → llegan.
     */
    fun teamDetail(
        transfers: List<RiderTransfer>,
        roster: List<RiderProfile>,
        teamId: String,
        ridersById: Map<String, RiderProfile> = emptyMap(),
        categoryByTeamId: Map<String, String> = emptyMap(),
        teamNameById: Map<String, String> = emptyMap(),
    ): TeamDetail {
        // Los fichajes efectivos durante la temporada se muestran en el feed,
        // pero no forman parte del mercado de la plantilla siguiente.
        val marketTransfers = transfers.filter { !it.midSeason }
        // Fin de contrato / llegadas → alfabético por apellido.
        fun riderKey(x: RiderTransfer): String {
            val r = ridersById[x.riderId]
            return "${r?.lastName.orEmpty()} ${r?.firstName.orEmpty()}".lowercase()
        }
        // Llegan (fichajes): primero los CONFIRMADOS, luego los rumores; dentro
        // de cada grupo, alfabético por apellido.
        val arrivals = marketTransfers.filter { it.type == "transfer" && it.toTeamId == teamId }
            .sortedWith(compareBy({ if (it.status == "rumor") 1 else 0 }, { riderKey(it) }))
        val allDepartures = marketTransfers.filter {
            (it.type == "transfer" || it.type == "retirement") && it.fromTeamId == teamId
        }
        // Fin de contrato sin destino → su propia sección (alfabético por
        // apellido); el resto (fichaje con destino o retirada) se marcha.
        val contractEnds = allDepartures.filter { isContractEnd(it) }
            .sortedBy { riderKey(it) }
        // Se marchan: por categoría del destino (WT→WWT→PT→PRW→resto), luego
        // alfabético por nombre del equipo; los retiros al final.
        val catRank = mapOf("WT" to 0, "WWT" to 1, "PT" to 2, "PRW" to 3)
        fun depName(x: RiderTransfer): String =
            (x.toTeamId?.let { teamNameById[it] } ?: x.toTeamName.orEmpty()).lowercase()
        fun depRetire(x: RiderTransfer): Int = if (x.type == "retirement") 1 else 0
        fun depCat(x: RiderTransfer): Int =
            if (x.type == "retirement") 99
            else x.toTeamId?.let { categoryByTeamId[it] }?.let { catRank[it] } ?: 90
        val departures = allDepartures.filter { !isContractEnd(it) }
            .sortedWith(compareBy({ depRetire(it) }, { depCat(it) }, { depName(it) }))
        // Renovación más reciente por corredor (transfers llega en orden desc).
        // Las EN DUDA van a su propio bucket: no anotan contrato ni "continúan".
        val renewalsByRider = HashMap<String, RiderTransfer>()
        val doubtsByRider = HashMap<String, RiderTransfer>()
        marketTransfers.filter { it.type == "renewal" && it.toTeamId == teamId }
            .forEach {
                val bucket = if (it.status == "doubt") doubtsByRider else renewalsByRider
                bucket.putIfAbsent(it.riderId, it)
            }

        // "Continúan" = solo quien YA estaba en el equipo en la temporada en
        // curso (currentTeamId = equipo). Un fichaje de fuera también tiene
        // afiliación al año del mercado, pero su currentTeamId es otro equipo →
        // va a "Llegan", no aquí.
        // "gone" = toda salida (fichaje, retirada Y fin de contrato): nadie continúa.
        val gone = allDepartures.map { it.riderId }.toSet()
        val staying = roster.filter { it.currentTeamId == teamId && it.id !in gone && it.id !in doubtsByRider }
            .map { r ->
                val renewal = renewalsByRider[r.id]
                StayingRow(
                    rider = r,
                    contractUntil = renewal?.contractUntil ?: r.contractUntil,
                    isRumor = renewal?.status == "rumor",
                )
            }
            // Por año de contrato DESC (2030 → … → sin año al final), alfabético
            // como desempate.
            .sortedWith(
                compareByDescending<StayingRow> { it.contractUntil ?: 0 }
                    .thenBy { "${it.rider.lastName.orEmpty()} ${it.rider.firstName.orEmpty()}".lowercase() }
            )

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

        return TeamDetail(staying = staying, doubtful = doubtful, contractEnds = contractEnds, arrivals = arrivals, departures = departures)
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
