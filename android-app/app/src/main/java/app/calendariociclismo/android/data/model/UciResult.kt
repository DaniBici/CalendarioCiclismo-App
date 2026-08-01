package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

/**
 * Resultados in-house UCI (tablas `race_uci_stages` / `race_uci_results`,
 * migraciones 081/082). Port del comportamiento de la web (`js/resultados.js`).
 *
 * La fila de resultado guarda solo el dorsal + el dato; el CORREDOR se
 * reconstruye por dorsal contra la startlist curada (`startlist_riders_resolved`),
 * igual que en la web. `riderDisplay` es el fallback cuando el dorsal no casa.
 *
 * Solo se muestran las clasificaciones `keepForWeb=true` (clasificación de etapa
 * + GC del día + generales acumuladas de puntos/montaña/jóvenes/equipos).
 */

/** Cabecera de una (etapa × clasificación) — fila de `race_uci_stages`. */
@Serializable
data class RaceUciStage(
    val id: String,
    val raceId: String,
    val raceDayId: String? = null,
    val classKind: String,            // stage | gc | points | kom | youth | teams
    val eventName: String? = null,
    val isTeamEvent: Boolean = false,
    val stageNumber: Int? = null,     // 0 = prólogo, null = clasificación final
    val isFinalClassification: Boolean = false,
    val keepForWeb: Boolean = false,
    val rowCount: Int = 0,
    val raceType: String? = null,     // RaceTypeCode de DataRide ("ITT" = crono individual)
    // Campos del feed de Resultados (apps 3.1). Opcionales con default para no
    // romper los selects existentes que no los piden.
    val stageDate: String? = null,    // YYYY-MM-DD; NULL en volcados PDF (mig. 090)
    val winnerName: String? = null,   // ganador crudo de la fuente (cabecera)
    // ── Campos SINTÉTICOS (etapa cancelada) — no existen en BD ─────────────
    // Los pone UciResultsLogic.applyCancelledStages; @Transient los excluye de
    // la (de)serialización para que no se pidan ni se manden a PostgREST.
    /** Marcador de la pestaña "Etapa" de una jornada cancelada: sin filas, el
     *  render lo pinta como aviso de cancelación. */
    @Transient val isCancelledStage: Boolean = false,
    /** General ARRASTRADA: nº de la etapa de la que vienen estas filas (la
     *  cancelada no movió la clasificación). El render lo avisa. */
    @Transient val carriedFromStage: Int? = null,
    /** Sufijo de sector (A/B) de la etapa arrastrada, para el aviso ("tras la 3A"). */
    @Transient val carriedFromSuffix: String? = null,
)

/**
 * Fila rank=1 mínima de `race_uci_results` — para resolver el ganador de cada
 * entrada del feed de Resultados (espejo del bloque de ganadores de
 * `js/resultados-feed.js`). Solo las 3 columnas que necesita la resolución.
 */
@Serializable
data class UciRank1Row(
    val stageRef: String,
    val globalRiderId: String? = null,
    val irm: String? = null,
)

/** Fila de clasificación — fila de `race_uci_results` (filtrada por `stageRef`). */
@Serializable
data class RaceUciResultRow(
    val stageRef: String,
    val raceId: String,
    val rank: Int? = null,            // null si DNF/DNS/OTL/DSQ
    val rankText: String? = null,
    val bib: String? = null,          // dorsal (TEXT en la BD; parsear a Int)
    val riderDisplay: String? = null,
    val globalRiderId: String? = null,
    /** Override MANUAL de equipo (mig. 112), fijado desde el panel. Cuando no es
     *  null, gana a la resolución por dorsal/globalRiderId en el render. */
    val teamId: String? = null,
    val resultValue: String? = null,
    val timeText: String? = null,
    val gapText: String? = null,
    val points: Int? = null,
    /** Puntos UCI derivados de carrera + clasificación + puesto. Double permite
     *  las centésimas del reparto de una CRE o de un ex-aequo. */
    val uciPoints: Double? = null,
    val irm: String? = null,          // DNF | DNS | OTL | DSQ
    val sortOrder: Int = 0,
) {
    /** Dorsal numérico (la UCI puede traer bibs de equipo no numéricos en CRE). */
    val dorsalInt: Int? get() = bib?.toIntOrNull()
}

/**
 * Vista `startlist_riders_resolved`: nombre/país canónicos desde
 * riders_men/women vía `globalRiderId`, con el snapshot de fallback. `teamId`
 * es el **PK** de `startlist_teams` (no la ref canónica a `teams`).
 *
 * Es un DTO propio (no `StartlistRider`) porque aquí necesitamos `globalRiderId`
 * para reconstruir el corredor por dorsal en los resultados.
 */
@Serializable
data class StartlistRiderResolved(
    val dorsal: Int? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val countryCode: String? = null,
    val teamId: String? = null,       // PK de startlist_teams
    val globalRiderId: String? = null,
    /** Equipo ACTUAL del corredor (riders_*.currentTeamId, expuesto por la
     *  vista) — gate real del enlace a su ficha pública. Puede diferir del
     *  equipo de ESTA startlist (devo invitados, fichajes). */
    val currentTeamId: String? = null,
)

/** Corredor reconstruido por dorsal (nombre + bandera + equipo + chapa). */
data class ResolvedRider(
    val name: String,
    val countryCode: String,
    val teamName: String,
    val team: Team?,                  // equipo canónico (para la chapa); null si no casó
    /** Ficha global (riders_men/women) — identifica al corredor en el cruce por
     *  dorsal/globalRiderId. Null si la startlist no casó. */
    val globalRiderId: String? = null,
)

/**
 * Payload de la carga inicial de la pantalla de resultados. Las filas de cada
 * clasificación se cargan luego, on-demand, por `stageRef` (`loadResultRows`).
 */
data class UciResultsData(
    val race: Race,
    val stages: List<RaceUciStage>,
    val byDorsal: Map<Int, ResolvedRider>,
    /** Equipos canónicos de la startlist — para casar por NOMBRE las filas de la
     *  pestaña Equipos (riderDisplay crudo de la fuente, sin dorsal). */
    val raceTeams: List<Team> = emptyList(),
    /** RaceDay de la etapa activa por defecto (para el header tipo perfil). */
    val raceDay: RaceDay?,
    /** TODAS las jornadas publicadas de la carrera (con countryCode/ruta/…). El
     *  header resuelve la jornada de la etapa activa de aquí — por raceDayId y, si
     *  el volcado no lo trajo, por stageNumber — sin más red y aplicando el
     *  override de país por jornada. */
    val raceDays: List<RaceDay> = emptyList(),
    /** Dobles sectores: raceDayId → sufijo ('A'/'B') y stageNumber sectorizados.
     *  La pantalla agrupa las clasificaciones con esto para separar 3A de 3B. */
    val sectorSuffixByRaceDayId: Map<String, String> = emptyMap(),
    val sectoredStageNumbers: Set<Int> = emptySet(),
)

/**
 * Ficha mínima de `riders_men`/`riders_women` — solo las columnas que necesita
 * el fallback por globalRiderId de los resultados (CN sin startlist): nombre,
 * bandera y equipo actual. El `id` es el mismo valor que viaja como
 * `globalRiderId` en startlists y resultados.
 */
@Serializable
data class RiderProfile(
    val id: String,
    val firstName: String? = null,
    val lastName: String? = null,
    val nationality: String? = null,   // ISO-2 minúscula
    val currentTeamId: String? = null,
    /** Año de fin de contrato (mig. 122; lo muestra "continúan" en Fichajes). */
    val contractUntil: Int? = null,
) {
    val fullName: String
        get() = "${firstName.orEmpty()} ${lastName.orEmpty()}".trim()
}
