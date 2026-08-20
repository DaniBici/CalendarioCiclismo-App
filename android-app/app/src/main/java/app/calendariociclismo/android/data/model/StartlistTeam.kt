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

    /** Equipo ficticio "Individual": lo siembra resolve_uci_startlist (mig. 084)
     *  para los corredores cuya fila de resultados UCI no trae equipo. teamId
     *  NULL + nombre 'Individual'. Se OCULTA cosméticamente (espejo de la web):
     *  corredores visibles, pero sin cabecera en startlist y sin equipo/chapa/
     *  filtro en resultados. */
    val isIndividualPlaceholder: Boolean
        get() = teamId == null && teamName.trim().equals("individual", ignoreCase = true)
}

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
        get() = listOfNotNull(firstName, lastName).joinToString(" ").ifEmpty { "—" }
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
