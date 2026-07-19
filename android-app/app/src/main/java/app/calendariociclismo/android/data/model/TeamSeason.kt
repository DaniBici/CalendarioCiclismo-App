package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/**
 * Versión de un equipo en una temporada concreta (tabla `team_seasons`).
 * El render de inscritos prefiere estos atributos visuales sobre los de `teams`
 * cuando existe una fila para el año de la carrera; si no existe, se mantiene
 * `teams` como fallback (ver [Team.applySeason]). En 2026 ambos coinciden.
 */
@Serializable
data class TeamSeason(
    val teamId: String,
    val year: Int,
    val name: String? = null,
    val badgeTorsoCenter: String? = null,
    val badgeTorsoSides: String? = null,
    val badgeShorts: String? = null,
    val badgeInnerCircle: String? = null,
    val headerBg: String? = null,
    val headerText: String? = null,
    /** Categoría UCI del año (un equipo puede ascender CT→PT→WT entre años).
     *  Forma parte del override de temporada igual que en la web (SEASON_VISUAL
     *  de corredor.js/equipo.js incluye `category`). */
    val category: String? = null,
    val gender: String? = null,
    /** Chapa ocultable por temporada (mig. 122): las filas 2027 nacen ocultas
     *  porque los kits no se anuncian hasta dentro de meses; el panel la activa
     *  en equipos estables. Solo la consume la pantalla de Fichajes.
     *
     *  Opt-in: el default es `false` para que un dato ausente cuente como
     *  oculta — enseñar un kit 2027 inventado es peor que no enseñar ninguno.
     *  (La columna en BD es NOT NULL, así que esto solo aplica si el select
     *  no la pide.) */
    val badgeVisible: Boolean = false,
    /** Continuidad del equipo en duda (mig. 123): sigue listado en su división,
     *  con chip y aviso (ej.: sin sponsor todavía). Distinto de la AUSENCIA de
     *  fila, que sigue significando "no continúa". Solo Fichajes lo consume. */
    val continuityDoubt: Boolean = false,
)

/**
 * Devuelve una copia de este equipo con los atributos VISUALES de la temporada
 * sobrescritos cuando la season los aporta (no nulos). Si [season] es null, devuelve
 * el equipo intacto. `teams` es siempre el fallback → nunca se pierde la chapa.
 */
fun Team.applySeason(season: TeamSeason?): Team {
    if (season == null) return this
    return copy(
        name = season.name ?: name,
        badgeTorsoCenter = season.badgeTorsoCenter ?: badgeTorsoCenter,
        badgeTorsoSides = season.badgeTorsoSides ?: badgeTorsoSides,
        badgeShorts = season.badgeShorts ?: badgeShorts,
        badgeInnerCircle = season.badgeInnerCircle ?: badgeInnerCircle,
        headerBg = season.headerBg ?: headerBg,
        headerText = season.headerText ?: headerText,
        category = season.category ?: category,
    )
}
