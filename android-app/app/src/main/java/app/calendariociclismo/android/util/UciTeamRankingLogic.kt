package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.UciTeamRankingRow

enum class UciTeamRankingTier {
    WORLD_TOUR,
    ALL_WORLD_TOUR,
    PRO_SERIES,
    WOMENS_WORLD_TOUR,
    STANDARD,
}

data class UciTeamRankingPresentation(
    val row: UciTeamRankingRow,
    val invitationTier: UciTeamRankingTier,
    val eligibleOrdinal: Int?,
    val grandTourExcluded: Boolean,
) {
    val id: String get() = "${row.gender}-${row.rank}"

    fun explanation(isEnglish: Boolean): String {
        val projection = if (isEnglish) {
            "Projection based on the current position."
        } else {
            "Proyección según la posición actual."
        }
        val messages = mutableListOf<String>()
        when (invitationTier) {
            UciTeamRankingTier.WORLD_TOUR -> Unit
            UciTeamRankingTier.ALL_WORLD_TOUR -> messages += if (isEnglish) {
                "Mandatory invitation to every ${row.invitationSeason} UCI WorldTour race, including the Grand Tours, and every ${row.invitationSeason} UCI ProSeries race. $projection"
            } else {
                "Invitación obligatoria a todas las pruebas UCI WorldTour de ${row.invitationSeason}, incluidas las Grandes Vueltas, y a todas las pruebas UCI ProSeries de ${row.invitationSeason}. $projection"
            }
            UciTeamRankingTier.PRO_SERIES -> messages += if (isEnglish) {
                "Mandatory invitation to every ${row.invitationSeason} UCI ProSeries race. $projection"
            } else {
                "Invitación obligatoria a todas las pruebas UCI ProSeries de ${row.invitationSeason}. $projection"
            }
            UciTeamRankingTier.WOMENS_WORLD_TOUR -> messages += if (isEnglish) {
                "Mandatory invitation to every ${row.invitationSeason} UCI Women's WorldTour race. $projection"
            } else {
                "Invitación obligatoria a todas las pruebas UCI Women's WorldTour de ${row.invitationSeason}. $projection"
            }
            UciTeamRankingTier.STANDARD -> Unit
        }
        if (grandTourExcluded) {
            messages += if (isEnglish) {
                "Outside the overall top 30, this UCI ProTeam is not currently eligible for a ${row.invitationSeason} Grand Tour wildcard. $projection"
            } else {
                "Fuera del top-30 absoluto, este UCI ProTeam no puede recibir actualmente una invitación para una Gran Vuelta de ${row.invitationSeason}. $projection"
            }
        }
        return messages.joinToString(" ")
    }
}

object UciTeamRankingLogic {
    fun decorate(rows: List<UciTeamRankingRow>, gender: String): List<UciTeamRankingPresentation> {
        val selected = rows.filter { it.gender == gender }.sortedBy { it.rank }
        val eligibleCategory = if (gender == "female") "PRW" else "PT"
        var eligibleOrdinal = 0

        return selected.map { row ->
            if (row.teamCategory == eligibleCategory) eligibleOrdinal += 1
            val ordinal = eligibleOrdinal.takeIf { row.teamCategory == eligibleCategory }
            val isWorldTour = if (gender == "female") {
                row.teamCategory == "WWT"
            } else {
                row.teamCategory == "WT"
            }
            val tier = when {
                isWorldTour -> UciTeamRankingTier.WORLD_TOUR
                gender == "female" && ordinal != null && ordinal <= 2 ->
                    UciTeamRankingTier.WOMENS_WORLD_TOUR
                gender == "male" && ordinal != null && ordinal <= 3 ->
                    UciTeamRankingTier.ALL_WORLD_TOUR
                gender == "male" && ordinal != null && ordinal <= 5 ->
                    UciTeamRankingTier.PRO_SERIES
                else -> UciTeamRankingTier.STANDARD
            }
            UciTeamRankingPresentation(
                row = row,
                invitationTier = tier,
                eligibleOrdinal = ordinal,
                grandTourExcluded =
                    gender == "male" && row.teamCategory == "PT" && row.rank > 30,
            )
        }
    }
}
