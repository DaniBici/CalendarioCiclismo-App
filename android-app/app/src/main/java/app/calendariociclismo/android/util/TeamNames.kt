package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.Team
import java.util.Locale

/**
 * Selecciones nacionales: el catálogo guarda el nombre UCI en inglés
 * («France»). En castellano se muestra el país en castellano a partir del
 * código de la ficha («Francia»); en inglés, el nombre sin cambio. Solo afecta
 * a fichas `selection`/`national`. Espejo de `localizedTeamName` en
 * `js/services/national-team-name.js` y de `Team.localizedName` en iOS.
 */
object TeamNames {
    /** Denominaciones fijas: las que difieren del nombre del sistema y las que
     *  cambiaron entre versiones de CLDR. Clave: countryCode o selectionCode. */
    private val namesEs = mapOf(
        "ain" to "Deportistas Individuales Neutrales",
        "ci" to "Costa de Marfil",
        "cz" to "República Checa",
        "gb" to "Gran Bretaña",
        "hk" to "Hong Kong",
        "mk" to "Macedonia del Norte",
        "mo" to "Macao",
    )

    private val ageCategory = Regex("""\bU(\d{2})\b""", RegexOption.IGNORE_CASE)

    /** `name` es el texto que se mostraría sin traducir; de él se conserva la
     *  categoría de edad («Canada U23» → «Canadá sub23»). */
    fun localizedName(name: String, team: Team?, isEnglish: Boolean): String {
        if (team == null) return name
        return localizedName(
            name, team.teamKind, team.selectionScope, team.countryCode, team.selectionCode, isEnglish,
        )
    }

    fun localizedName(
        name: String,
        teamKind: String?,
        selectionScope: String?,
        countryCode: String?,
        selectionCode: String?,
        isEnglish: Boolean,
    ): String {
        if (isEnglish || teamKind != "selection" || selectionScope != "national") return name
        val code = (countryCode?.takeIf { it.isNotEmpty() } ?: selectionCode.orEmpty()).lowercase()
        val country = namesEs[code]
            ?: code.takeIf { it.length == 2 && it.all { c -> c in 'a'..'z' } }
                ?.let { Locale("", it.uppercase()).getDisplayCountry(Locale.forLanguageTag("es")) }
                ?.takeIf { it.isNotEmpty() && !it.equals(code, ignoreCase = true) }
            ?: return name
        val age = ageCategory.find(name) ?: return country
        return "$country sub${age.groupValues[1]}"
    }
}
