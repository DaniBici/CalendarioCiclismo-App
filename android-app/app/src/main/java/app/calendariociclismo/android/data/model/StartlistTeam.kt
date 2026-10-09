package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

@Serializable
data class StartlistTeam(
    val id: String,
    val raceId: String,
    val teamName: String,
    val sortOrder: Int = 0,
    val teamId: String? = null,
    val isConfirmed: Boolean = false,
) {
    /** Un equipo filial se distingue por su propia ficha en `teams` (nombre y
     *  chapa propios), no por un sufijo. Ver migración 063. */
    val displayName: String
        get() = teamName

    /** Estado sin equipo sembrado por la ingesta cuando la fuente no aporta
     *  una identidad de club o selección. La fila y sus corredores se
     *  conservan, pero no se presenta como una formación. */
    val isNoTeamPlaceholder: Boolean
        get() {
            if (teamId != null) return false
            val normalized = teamName
                .replace('-', ' ')
                .trim()
                .split(Regex("\\s+"))
                .joinToString(" ")
                .lowercase()
            return normalized in NO_TEAM_PLACEHOLDER_NAMES
        }

    /** Compatibilidad para consumidores antiguos; usar isNoTeamPlaceholder. */
    val isIndividualPlaceholder: Boolean
        get() = isNoTeamPlaceholder && teamName
            .replace('-', ' ')
            .trim()
            .split(Regex("\\s+"))
            .joinToString(" ")
            .lowercase() == "individual"
}

private val NO_TEAM_PLACEHOLDER_NAMES = setOf(
    "individual",
    "private member",
    "sin equipo",
    "un",
    "un attached leinster",
)

@Serializable
data class StartlistRider(
    val id: String,
    val teamId: String,
    val raceId: String,
    val dorsal: Int? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val countryCode: String? = null,
    // Expuesto por la vista startlist_riders_resolved; lo usa el tachado de
    // abandonos para cruzar con race_uci_results (puede ser null si no casó).
    val globalRiderId: String? = null,
) {
    val fullName: String
        get() = listOfNotNull(firstName, lastName).joinToString(" ").ifEmpty { "-" }
}

/** Estado "fuera de carrera" de un corredor (abandono/no-salida/fuera de control/
 *  descalificación), tomado de su etapa más reciente con `irm`. */
data class RiderOut(
    val irm: String,            // DNF | DNS | OTL | DSQ
    val stageNumber: Int?,      // etapa donde quedó fuera (null en one-day)
)

data class StartlistData(
    val race: Race,
    val teams: List<StartlistTeam>,
    val riders: List<StartlistRider>,
    val globalTeams: List<Team>,
    /** Corredores fuera de carrera, por globalRiderId. Vacío si no hay
     *  resultados in-house. */
    val ridersOut: Map<String, RiderOut> = emptyMap(),
)
