package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/** Una fila de la instantánea sobrescribible `uci_team_rankings`. */
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
) {
    val invitationSeason: Int
        get() = (rankingDate.take(4).toIntOrNull() ?: java.time.LocalDate.now().year) + 1
}
