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
