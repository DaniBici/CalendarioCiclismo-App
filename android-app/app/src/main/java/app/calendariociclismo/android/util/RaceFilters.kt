package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.CxRace
import app.calendariociclismo.android.data.model.EnrichedRaceDay
import app.calendariociclismo.android.data.model.Race
import java.text.Normalizer
import java.util.Locale

/*
 * Filtros de carreras de Hoy, Mes y Temporada (carretera) y de la agenda de
 * Ciclocross, con el menú de Fichajes: opciones marcables por grupos, dentro de
 * un grupo es O y entre grupos, Y. Un grupo con todo marcado no filtra y nunca
 * queda vacío. La selección se recuerda por disciplina (AppPreferences) y la
 * comparten Hoy, Mes y Temporada. Espejo de `js/race-filters.js` y
 * `js/category-filter.js` (web) y de `RaceFilters.swift` (iOS).
 *
 * Se guarda con el formato del parámetro del widget (`widget_day`):
 * `level:wt,pro;gender:female`, solo con los grupos que filtran.
 */

/** Carretera: nivel (WorldTour, Profesional, .2) y género. */
data class RoadRaceFilter(
    val levels: Set<String> = ALL_LEVELS.toSet(),
    val genders: Set<String> = ALL_GENDERS.toSet(),
) {
    val isActive: Boolean get() = levels.size < ALL_LEVELS.size || genders.size < ALL_GENDERS.size

    /** Solo Femenino: los nombres prescinden del sufijo femenino y del ♀. */
    val femaleOnly: Boolean get() = genders == setOf("female")

    fun toggleLevel(value: String) = copy(levels = toggled(levels, value, ALL_LEVELS))
    fun toggleGender(value: String) = copy(genders = toggled(genders, value, ALL_GENDERS))

    fun matches(race: Race): Boolean = matches(race.uciCategory, race.name, race.gender)

    fun matches(category: String?, name: String, gender: String?): Boolean {
        if (levels.size < ALL_LEVELS.size && level(category) !in levels) return false
        if (genders.size < ALL_GENDERS.size && genders.none { it in genders(category, name, gender) }) return false
        return true
    }

    /** Jornadas que pasan el filtro; las que no tienen carrera se conservan. */
    fun apply(items: List<EnrichedRaceDay>): List<EnrichedRaceDay> =
        if (!isActive) items else items.filter { item -> item.race?.let(::matches) ?: true }

    /** `p_filter` de la RPC `widget_day` y valor guardado: «all» o los grupos que filtran. */
    val encoded: String get() {
        if (!isActive) return "all"
        val parts = mutableListOf<String>()
        if (levels.size < ALL_LEVELS.size) parts += "level:" + ALL_LEVELS.filter { it in levels }.joinToString(",")
        if (genders.size < ALL_GENDERS.size) parts += "gender:" + ALL_GENDERS.filter { it in genders }.joinToString(",")
        return parts.joinToString(";")
    }

    companion object {
        val ALL_LEVELS = listOf("wt", "pro", "dev")
        val ALL_GENDERS = listOf("male", "female")

        private val WORLD_TOUR = setOf("1.UWT", "2.UWT", "1.WWT", "2.WWT", "WC")
        private val PROFESSIONAL = setOf("1.Pro", "2.Pro", "1.1", "2.1", "CC", "CN")
        /**
         * .2 y las clases sueltas de una lista cerrada: una categoría nueva no
         * entra sola; sin nivel, solo se ve con el grupo entero marcado.
         */
        private val DEVELOPMENT = setOf("1.2", "2.2", "1.2U", "2.2U", "1.Ncup", "2.Ncup", "1.NE", "2.NE")

        fun level(race: Race): String? = level(race.uciCategory)

        fun level(category: String?): String? = when (category ?: "") {
            in WORLD_TOUR -> "wt"
            in PROFESSIONAL -> "pro"
            in DEVELOPMENT -> "dev"
            else -> null
        }

        /**
         * Una carrera sin género (mixta o con pruebas de ambos sexos) y los
         * relevos mixtos cuentan en Masculino y en Femenino.
         */
        fun genders(race: Race): Set<String> = genders(race.uciCategory, race.name, race.gender)

        fun genders(category: String?, name: String, gender: String?): Set<String> {
            val cat = category ?: ""
            val mixedRelay = (cat == "WC" || cat == "CC") &&
                (name.contains("relevo mixto", ignoreCase = true) || name.contains("mixed relay", ignoreCase = true))
            return if (!mixedRelay && (gender == "male" || gender == "female")) setOf(gender) else ALL_GENDERS.toSet()
        }

        fun decode(raw: String?): RoadRaceFilter? {
            if (raw.isNullOrBlank() || raw == "all") return null
            val groups = parseGroups(raw)
            return RoadRaceFilter(
                levels = groups["level"]?.filter { it in ALL_LEVELS }?.toSet()?.ifEmpty { null } ?: ALL_LEVELS.toSet(),
                genders = groups["gender"]?.filter { it in ALL_GENDERS }?.toSet()?.ifEmpty { null } ?: ALL_GENDERS.toSet(),
            )
        }

        /** Conversión de la chincheta de la 5.2.3 (`default_filter`, nombre del enum). */
        fun fromLegacy(raw: String?): RoadRaceFilter? = when (raw) {
            "UWT" -> RoadRaceFilter(levels = setOf("wt"), genders = setOf("male"))
            "WWT" -> RoadRaceFilter(levels = setOf("wt"), genders = setOf("female"))
            "PRO" -> RoadRaceFilter(levels = setOf("wt", "pro"))
            "MALE" -> RoadRaceFilter(levels = setOf("wt", "pro"), genders = setOf("male"))
            "FEMALE" -> RoadRaceFilter(genders = setOf("female"))
            else -> null
        }
    }
}

/** Ciclocross: Big, UCI y Nacional, combinables. */
data class CxRaceFilter(val levels: Set<String> = setOf("big", "uci", "national")) {
    /** Opciones marcadas entre las visibles en el idioma actual. */
    private val visibleLevels: Set<String> get() = levels intersect allLevels().toSet()

    val isActive: Boolean get() = visibleLevels.isNotEmpty() && visibleLevels.size < allLevels().size

    fun toggleLevel(value: String): CxRaceFilter {
        val base = visibleLevels.ifEmpty { allLevels().toSet() }
        return copy(levels = toggled(base, value, allLevels()))
    }

    fun isChecked(value: String): Boolean = !isActive || value in visibleLevels

    fun matches(race: CxRace): Boolean = !isActive || level(race) in visibleLevels

    /** `p_cx_filter` de la RPC `widget_day` y valor guardado. */
    val encoded: String get() =
        if (!isActive) "all" else "level:" + allLevels().filter { it in visibleLevels }.joinToString(",")

    companion object {
        /**
         * «Nacional» (NAC, calendario español) no existe en inglés: esas pruebas
         * se ocultan en la agenda en inglés ([CxPresentation.hiddenClasses]).
         */
        fun allLevels(): List<String> =
            if (LocaleHolder.current.language == "en") listOf("big", "uci") else listOf("big", "uci", "national")

        private val BIG_TOURNAMENTS = listOf("superprestige", "x2o", "worldcup", "copadelmundo", "exactcross", "hgcross")

        /**
         * Big: Mundial, Copa del Mundo, Continental y los torneos Copa del Mundo,
         * Superprestige, X2O y HG Cross (antes Exact Cross). Nacional: NAC. UCI:
         * el resto, C1 y C2 fuera de esos torneos y Campeonatos nacionales.
         */
        fun level(race: CxRace): String {
            if (race.raceClass == "NAC") return "national"
            if (race.raceClass in listOf("CM", "CDM", "CC")) return "big"
            val tournament = race.tournament ?: return "uci"
            val identity = Normalizer.normalize(tournament.slug + " " + tournament.name, Normalizer.Form.NFD)
                .lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]"), "")
            return if (BIG_TOURNAMENTS.any { it in identity }) "big" else "uci"
        }

        fun decode(raw: String?): CxRaceFilter? {
            if (raw.isNullOrBlank() || raw == "all") return null
            val levels = parseGroups(raw)["level"]?.toSet()?.ifEmpty { null } ?: return null
            return CxRaceFilter(levels)
        }

        /** Conversión de la chincheta de la 5.2.3 (`cx_default_filter`, nombre del enum). */
        fun fromLegacy(raw: String?): CxRaceFilter? = when (raw) {
            "BIG" -> CxRaceFilter(setOf("big"))
            "PRO" -> CxRaceFilter(setOf("big", "uci"))
            "SPAIN" -> CxRaceFilter(setOf("national"))
            else -> null
        }
    }
}

/** Alterna un valor; un grupo vacío vuelve a marcarse entero. */
private fun toggled(set: Set<String>, value: String, all: List<String>): Set<String> =
    (if (value in set) set - value else set + value).ifEmpty { all.toSet() }

/** `level:a,b;gender:c` → { level: [a, b], gender: [c] }. */
private fun parseGroups(raw: String): Map<String, List<String>> =
    raw.split(';').mapNotNull { part ->
        val (key, values) = part.split(':', limit = 2).takeIf { it.size == 2 } ?: return@mapNotNull null
        key.trim() to values.split(',').map(String::trim).filter(String::isNotEmpty)
    }.toMap()
