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
)
