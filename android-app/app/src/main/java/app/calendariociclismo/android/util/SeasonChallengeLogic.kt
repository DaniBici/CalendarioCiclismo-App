package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.ChallengeGroup
import app.calendariociclismo.android.data.model.Race

/** Entrada de la lista de Temporada: una carrera o un challenge con sus pruebas visibles (al menos dos). */
sealed interface SeasonEntry {
    val key: String
    val startDate: String?

    data class Single(val race: Race) : SeasonEntry {
        override val key get() = race.id
        override val startDate get() = race.startDate
    }

    data class Challenge(val group: ChallengeGroup, val races: List<Race>) : SeasonEntry {
        override val key get() = "challenge-${group.id}"
        override val startDate get() = races.firstOrNull()?.startDate
    }
}

/** Agrupación de las pruebas de un challenge en Temporada. Espejo de iOS `SeasonChallengeLogic`. */
object SeasonChallengeLogic {
    /** Prueba dentro del nombre de un campeonato: «Campeonato de Asia CRI femenino», «Asian Championships - Women's Elite ITT». */
    private val CHAMPIONSHIP_EVENT = Regex("""\s+(?:-\s|(?:CRI|CRE|línea|[Mm]en's|[Ww]omen's)\b).*$""")

    private val GROUPED_CATEGORIES = setOf("CC", "CN", "WC")
    private val GROUPED_NAME = Regex("""\b(?:panamericanos?|juegos)\b""", RegexOption.IGNORE_CASE)

    /** Pruebas que se agrupan: campeonatos continentales, mundiales y nacionales, y las que llevan «Panamericano» o «Juegos» en el nombre. */
    private fun isGroupedEvent(race: Race): Boolean =
        race.uciCategory in GROUPED_CATEGORIES || GROUPED_NAME.containsMatchIn(race.name)

    /**
     * Campeonatos y Juegos, sin las CN de la pantalla de Campeonatos, con la
     * forma de un challenge: [entries] los muestra en una fila desplegable
     * si tienen al menos dos pruebas visibles. Un país con pruebas a ambos lados de
     * la ventana de la pantalla forma un grupo por cada lado. Espejo de
     * `_buildChampionshipGroups` en `js/temporada.js`.
     */
    fun championshipGroups(races: List<Race>): List<ChallengeGroup> =
        races.filter { isGroupedEvent(it) && !ChampionshipsConfig.isOnChampionshipsScreen(it) }.groupBy { race ->
            val afterScreen = ChampionshipsConfig.isChampionship(race) &&
                race.startDate.orEmpty().drop(5) > ChampionshipsConfig.QUERY_END.drop(5)
            "${race.year}-${race.uciCategory}-${race.name.replace(CHAMPIONSHIP_EVENT, "")}${if (afterScreen) "-2" else ""}"
        }.map { (key, members) ->
            val first = members.first()
            ChallengeGroup(
                id = key,
                name = first.localizedName.replace(CHAMPIONSHIP_EVENT, ""),
                gender = first.gender.takeIf { members.all { it.gender == first.gender } },
                year = first.year,
                uciCategory = first.uciCategory,
                countryCode = first.countryCode,
                colorHex = first.colorHex,
                logoUrl = first.logoUrl,
                raceIds = members.map { it.id },
            )
        }

    /**
     * Nombre de una prueba bajo la fila de su grupo: en un campeonato, solo la
     * prueba («CRI femenina», «Línea sub23 masculina», «Women's Elite ITT»). El
     * nombre completo se recorta y todas las filas se verían iguales. El género
     * concuerda con la modalidad.
     */
    fun nameInGroup(race: Race): String {
        val name = race.localizedName
        if (!isGroupedEvent(race)) return name
        val event = name.drop(name.replace(CHAMPIONSHIP_EVENT, "").length).trimStart(' ', '-')
            .replace("femenino", "femenina")
            .replace("masculino", "masculina")
        return event.replaceFirstChar { it.uppercase() }
    }

    /** Pruebas visibles de cada challenge (id → carreras en el orden recibido). Con una sola no se agrupa. */
    fun members(races: List<Race>, groups: List<ChallengeGroup>): Map<String, List<Race>> {
        val groupIdByRace = groups.flatMap { g -> g.raceIds.orEmpty().map { it to g.id } }.toMap()
        return races.filter { it.id in groupIdByRace }
            .groupBy { groupIdByRace.getValue(it.id) }
            .filterValues { it.size > 1 }
    }

    /** Sustituye las pruebas de cada challenge (carreras ordenadas por fecha) por una entrada en la posición de la primera. */
    fun entries(races: List<Race>, groups: List<ChallengeGroup>): List<SeasonEntry> {
        val membersByGroup = members(races, groups)
        if (membersByGroup.isEmpty()) return races.map { SeasonEntry.Single(it) }
        val groupsById = groups.associateBy { it.id }
        val groupIdByRace = membersByGroup.flatMap { (id, list) -> list.map { it.id to id } }.toMap()
        val emitted = mutableSetOf<String>()
        return races.mapNotNull { race ->
            val groupId = groupIdByRace[race.id]
            val group = groupId?.let { groupsById[it] }
            when {
                group == null -> SeasonEntry.Single(race)
                emitted.add(group.id) -> SeasonEntry.Challenge(group, membersByGroup.getValue(group.id))
                else -> null
            }
        }
    }

    /** Fecha que ordena cada carrera por meses: la de la primera prueba de su challenge, para no repartirlo entre dos meses. */
    fun groupingStartDates(races: List<Race>, groups: List<ChallengeGroup>): Map<String, String> =
        members(races, groups).values.flatMap { list ->
            val first = list.mapNotNull { it.startDate }.minOrNull() ?: return@flatMap emptyList()
            list.map { it.id to first }
        }.toMap()
}
