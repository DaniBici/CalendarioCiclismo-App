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

    private val namesEn = mapOf(
        "ain" to "Individual Neutral Athletes",
        "gb" to "Great Britain",
    )

    private val ageCategory = Regex("""\bU(\d{2})\b""", RegexOption.IGNORE_CASE)

    /** Nombre de la selección de un país (código ISO-2 o de selección); null si no se reconoce.
     *  Espejo de `nationalSelectionName` en `js/services/national-team-name.js`. */
    fun selectionName(code: String?, isEnglish: Boolean): String? {
        val key = code.orEmpty().lowercase()
        (if (isEnglish) namesEn else namesEs)[key]?.let { return it }
        if (key.length != 2 || !key.all { it in 'a'..'z' }) return null
        val display = Locale("", key.uppercase()).getDisplayCountry(if (isEnglish) Locale.ENGLISH else Locale.forLanguageTag("es"))
        return display.takeIf { it.isNotEmpty() && !it.equals(key, ignoreCase = true) }
    }

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
        val country = selectionName(countryCode?.takeIf { it.isNotEmpty() } ?: selectionCode, false) ?: return name
        val age = ageCategory.find(name) ?: return country
        return "$country sub${age.groupValues[1]}"
    }
}
