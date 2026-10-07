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

    /** Estilo de la etiqueta del puesto: null = número sin etiqueta. «Sin
     *  Grandes Vueltas» prevalece sobre el nivel de invitación (como la web). */
    val rankStyle: UciRankingKeyStyle?
        get() = if (grandTourExcluded) {
            UciRankingKeyStyle.EXCLUDED
        } else {
            when (invitationTier) {
                UciTeamRankingTier.WORLD_TOUR -> UciRankingKeyStyle.WORLD_TOUR
                UciTeamRankingTier.ALL_WORLD_TOUR,
                UciTeamRankingTier.WOMENS_WORLD_TOUR -> UciRankingKeyStyle.ORANGE
                UciTeamRankingTier.PRO_SERIES -> UciRankingKeyStyle.GREEN
                UciTeamRankingTier.STANDARD -> null
            }
        }

    /** Aviso de la fila (espejo de `uciRankingRuleText`), sin la nota de
     *  proyección. */
    fun explanation(isEnglish: Boolean): String {
        val season = row.invitationSeason
        val messages = mutableListOf<String>()
        when (invitationTier) {
            UciTeamRankingTier.WORLD_TOUR, UciTeamRankingTier.STANDARD -> Unit
            UciTeamRankingTier.ALL_WORLD_TOUR -> messages += if (isEnglish) {
                "Mandatory invitation to every $season UCI WorldTour race, including the Grand Tours, and every $season UCI ProSeries race."
            } else {
                "Invitación obligatoria a todas las pruebas UCI WorldTour de $season, incluidas las Grandes Vueltas, y a todas las pruebas UCI ProSeries de $season."
            }
            UciTeamRankingTier.PRO_SERIES -> messages += if (isEnglish) {
                "Mandatory invitation to every $season UCI ProSeries race."
            } else {
                "Invitación obligatoria a todas las pruebas UCI ProSeries de $season."
            }
            UciTeamRankingTier.WOMENS_WORLD_TOUR -> messages += if (isEnglish) {
                "Mandatory invitation to every $season UCI Women's WorldTour race."
            } else {
                "Invitación obligatoria a todas las pruebas UCI Women's WorldTour de $season."
            }
        }
        if (grandTourExcluded) {
            messages += if (isEnglish) {
                "Outside the overall top 30, this UCI ProTeam is not currently eligible for a $season Grand Tour wildcard."
            } else {
                "Fuera del top-30 absoluto, este UCI ProTeam no puede recibir actualmente una invitación para una Gran Vuelta de $season."
            }
        }
        return messages.joinToString(" ")
    }
}

/** Color de la etiqueta del puesto y de la explicación: azul licencia
 *  WorldTour, naranja invitación a todo el WorldTour o Women's WorldTour,
 *  verde ProSeries, rojo sin Grandes Vueltas. */
enum class UciRankingKeyStyle { WORLD_TOUR, ORANGE, GREEN, EXCLUDED }

/** Entrada del panel «Invitaciones <año>» (espejo de `keyItems` en
 *  `js/resultados-feed.js`). */
data class UciRankingKeyItem(
    val style: UciRankingKeyStyle,
    val label: String,
    val text: String,
)

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

    /** Año de las invitaciones: el del ránking + 1. */
    fun invitationYear(rows: List<UciTeamRankingPresentation>): Int =
        rows.firstOrNull()?.row?.invitationSeason
            ?: (java.time.LocalDate.now().year + 1)

    /** Explicación de cada etiqueta de puesto: solo los niveles presentes en
     *  el ránking seleccionado. */
    fun keyItems(rows: List<UciTeamRankingPresentation>, isEnglish: Boolean): List<UciRankingKeyItem> {
        val year = invitationYear(rows)
        val tiers = rows.map { it.invitationTier }.toSet()
        val items = mutableListOf<UciRankingKeyItem>()
        if (UciTeamRankingTier.WORLD_TOUR in tiers) {
            items += UciRankingKeyItem(
                UciRankingKeyStyle.WORLD_TOUR,
                if (isEnglish) "WorldTour licence" else "Licencia WorldTour",
                if (isEnglish) "Entitled and required to ride every UCI WorldTour race."
                else "Derecho y obligación de correr todas las pruebas UCI WorldTour.",
            )
        }
        if (UciTeamRankingTier.ALL_WORLD_TOUR in tiers) {
            items += UciRankingKeyItem(
                UciRankingKeyStyle.ORANGE,
                if (isEnglish) "All WorldTour" else "Todo el WorldTour",
                if (isEnglish) "Invitation to every $year UCI WorldTour race, Grand Tours included, and every UCI ProSeries race."
                else "Invitación a todas las pruebas UCI WorldTour de $year, Grandes Vueltas incluidas, y a todas las UCI ProSeries.",
            )
        }
        if (UciTeamRankingTier.WOMENS_WORLD_TOUR in tiers) {
            items += UciRankingKeyItem(
                UciRankingKeyStyle.ORANGE,
                "Women's WorldTour",
                if (isEnglish) "Invitation to every $year UCI Women's WorldTour race."
                else "Invitación a todas las pruebas UCI Women's WorldTour de $year.",
            )
        }
        if (UciTeamRankingTier.PRO_SERIES in tiers) {
            items += UciRankingKeyItem(
                UciRankingKeyStyle.GREEN,
                "ProSeries",
                if (isEnglish) "Invitation to every $year UCI ProSeries race."
                else "Invitación a todas las pruebas UCI ProSeries de $year.",
            )
        }
        if (rows.any { it.grandTourExcluded }) {
            items += UciRankingKeyItem(
                UciRankingKeyStyle.EXCLUDED,
                if (isEnglish) "No Grand Tours" else "Sin Grandes Vueltas",
                if (isEnglish) "Outside the overall top 30: not eligible for a $year Grand Tour wildcard."
                else "Fuera del top-30 absoluto: sin opción a invitación para una Gran Vuelta de $year.",
            )
        }
        return items
    }

    /** Puntos enteros con separador de millares siempre, también con cuatro
     *  cifras («1.234»): es-ES no agrupa por defecto por debajo de 10.000. */
    fun formatPoints(points: Double, isEnglish: Boolean): String {
        val rounded = Math.round(points)
        val grouped = kotlin.math.abs(rounded).toString()
            .reversed()
            .chunked(3)
            .joinToString(if (isEnglish) "," else ".")
            .reversed()
        return if (rounded < 0) "-$grouped" else grouped
    }
}
