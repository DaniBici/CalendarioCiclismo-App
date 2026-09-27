package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

@Serializable
data class Team(
    val id: String,
    val name: String,
    val badgeTorsoCenter: String,
    val badgeTorsoSides: String,
    val badgeShorts: String,
    val badgeInnerCircle: String? = null,
    val headerBg: String,
    val headerText: String,
    /** Alias de matching (uno por línea) — para casar nombres crudos de fuentes
     *  externas (UCI/Tissot) por nombre, como `findMatchingTeam` en la web. */
    val nameAliases: String? = null,
    /** Categoría UCI (WT/WWT/PT/PRW/CT/CTW/NTM/NTW/CLUBM/CLUBW).
     *  Opcional con default para no romper selects existentes. */
    val category: String? = null,
) {
    /** La chapa solo se muestra con colores de equipación curados. */
    val hasVisibleBadge: Boolean
        get() {
            val center = normalizeBadgeColor(badgeTorsoCenter) ?: return false
            val sides = normalizeBadgeColor(badgeTorsoSides) ?: return false
            val shorts = normalizeBadgeColor(badgeShorts) ?: return false
            val innerRaw = badgeInnerCircle?.trim().orEmpty()
            if (innerRaw.isNotEmpty()) return normalizeBadgeColor(innerRaw) != null

            return center != "#ffffff"
                || sides !in DEFAULT_BADGE_DARKS
                || shorts !in DEFAULT_BADGE_DARKS
        }

    private companion object {
        val DEFAULT_BADGE_DARKS = setOf("#000000", "#111111")

        fun normalizeBadgeColor(value: String?): String? {
            val color = value?.trim()?.lowercase() ?: return null
            if (Regex("^#[0-9a-f]{6}$").matches(color)) return color
            if (Regex("^#[0-9a-f]{3}$").matches(color)) {
                return "#" + color.drop(1).map { "$it$it" }.joinToString("")
            }
            return null
        }
    }
}
