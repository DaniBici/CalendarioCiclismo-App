package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/** Una fila del ránking publicado `uci_team_rankings`: última instantánea
 *  oficial de la UCI más las clasificaciones oficiales y las penalizaciones
 *  posteriores. Las columnas de temporada y desglose llegan desde la 5.2.6. */
@Serializable
data class UciTeamRankingRow(
    val gender: String,
    val rank: Int,
    val previousRank: Int? = null,
    val uciTeamId: Long,
    val teamId: String? = null,
    val teamCategory: String? = null,
    val sourceName: String,
    val displayName: String,
    val teamCode: String? = null,
    val countryCode: String? = null,
    val points: Double,
    val rankingDate: String,
    val sourceUrl: String,
    val seasonYear: Int? = null,
    val officialPoints: Double? = null,
    val provisionalPoints: Double? = null,
    val penaltyPoints: Double? = null,
    val officialRankingDate: String? = null,
    /** Última reescritura del ránking (varias al día). */
    val syncedAt: String? = null,
) {
    /** La temporada del ránking (19-10-2026 a 17-10-2027 para 2027) define
     *  las invitaciones del año siguiente. */
    val invitationSeason: Int
        get() = (seasonYear ?: rankingDate.take(4).toIntOrNull() ?: java.time.LocalDate.now().year) + 1

    val isAdjusted: Boolean
        get() = (provisionalPoints ?: 0.0) != 0.0 || (penaltyPoints ?: 0.0) != 0.0
}
