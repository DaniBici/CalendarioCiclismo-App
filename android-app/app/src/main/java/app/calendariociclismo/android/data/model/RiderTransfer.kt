package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/**
 * Movimiento del mercado de fichajes (tabla `rider_transfers`, mig. 122).
 *
 * Convención por [type] (espejo del CHECK de la migración):
 *  - `transfer`   → fromTeam* = equipo que deja, toTeam* = equipo al que va.
 *  - `renewal`    → toTeamId  = equipo con el que renueva (fromTeam* NULL).
 *  - `retirement` → fromTeam* = equipo que deja (toTeam* NULL).
 *
 * `fromTeamName`/`toTeamName` son texto libre para equipos fuera del catálogo
 * (júniors, amateurs, destinos sin catalogar). [status] `rumor` y `doubt` NO
 * aparecen en el feed de confirmaciones; en el detalle de equipo salen con
 * badge Rumor / en la sección "En duda".
 */
@Serializable
data class RiderTransfer(
    val id: String,
    val season: Int,
    val riderId: String,
    val riderGender: String,          // "male" | "female" → tabla riders_*
    val fromTeamId: String? = null,
    val fromTeamName: String? = null,
    val toTeamId: String? = null,
    val toTeamName: String? = null,
    val type: String,                 // "transfer" | "renewal" | "retirement"
    // "confirmed" | "rumor" | "doubt" (mig. 123). `doubt` = renovación incierta
    // (no se sabe si sigue); un CHECK en BD lo restringe a type='renewal'.
    val status: String,
    val contractUntil: Int? = null,   // año de fin del contrato anunciado
    val announcedAt: String? = null,  // YYYY-MM-DD (ordena el feed)
    // false → fuera del feed de últimos, pero cuenta en el detalle de equipo
    // (mig. 123; default true = como estaba antes de existir la columna).
    val dateVisible: Boolean = true,
    // Fichaje efectivo durante la temporada en curso (mig. 136).
    val midSeason: Boolean = false,
    val createdAt: String? = null,
)
