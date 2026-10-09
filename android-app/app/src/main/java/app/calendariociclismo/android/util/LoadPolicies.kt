package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.data.model.RaceUciStage
import java.time.Instant
import java.time.LocalDate

/**
 * Decide si la caché local de una carrera basta para pintar Carrera o Jornada
 * antes de la red sin que el contenido cambie de forma visible al llegar la
 * respuesta (perfiles que aparecen, etapas que se añaden).
 */
object CachedRacePolicy {
    /** Máximo de días de calendario que se comprueban en una carrera. */
    private const val MAX_RACE_SPAN_DAYS = 60L

    /** La jornada ya tiene su perfil descargado o no necesita mostrarlo. */
    fun dayHasProfileData(rd: RaceDay): Boolean =
        rd.isRestDay || rd.isCancelledDay || rd.profileNotViewable || rd.elevationProfile != null

    /**
     * `true` si hay jornadas para todas las fechas de la carrera (los días de
     * descanso tienen fila propia) y todas tienen su perfil descargado.
     */
    fun isPresentable(race: Race, days: List<RaceDay>): Boolean {
        if (days.isEmpty()) return false
        if (!days.all(::dayHasProfileData)) return false
        val start = race.startDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return true
        val end = race.endDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return true
        if (end.isBefore(start) || start.plusDays(MAX_RACE_SPAN_DAYS).isBefore(end)) return true
        val cachedDates = days.mapTo(HashSet()) { it.dateKey }
        var date = start
        while (!date.isAfter(end)) {
            if (date.toString() !in cachedDates) return false
            date = date.plusDays(1)
        }
        return true
    }
}

/**
 * Frecuencia del refresco automático de Hoy. Con una jornada en curso (o a
 * punto de empezar, o pendiente de resultados) recarga cada minuto como antes;
 * sin actividad, cada quince minutos. El cambio de día lo gestiona la
 * navegación de medianoche y el refresco manual siempre va a la red.
 */
object TodayRefreshPolicy {
    const val MIN_INTERVAL_SECONDS = 60L
    const val IDLE_INTERVAL_SECONDS = 15 * 60L
    /** Holgura del latido de 60 s: retrasos del temporizador y truncado a segundos. */
    const val TOLERANCE_SECONDS = 5L
    private const val PRE_START_SECONDS = 60 * 60L
    private const val POST_FINISH_SECONDS = 3 * 60 * 60L
    private const val DEFAULT_DURATION_SECONDS = 6 * 60 * 60L

    fun shouldRefresh(now: Instant, lastNetworkLoad: Instant?, days: List<RaceDay>): Boolean {
        val last = lastNetworkLoad ?: return true
        val elapsed = now.epochSecond - last.epochSecond
        if (elapsed < 0) return true
        if (elapsed + TOLERANCE_SECONDS < MIN_INTERVAL_SECONDS) return false
        if (hasActivity(days, now)) return true
        return elapsed + TOLERANCE_SECONDS >= IDLE_INTERVAL_SECONDS
    }

    /**
     * Alguna jornada está en su ventana activa: desde una hora antes de la
     * salida hasta tres horas después de la meta prevista. Sin horarios se
     * considera activa para no perder actualizaciones.
     */
    fun hasActivity(days: List<RaceDay>, now: Instant): Boolean = days.any { rd ->
        if (rd.isRestDay || rd.isCancelledDay) return@any false
        val start = (rd.realStartTimeUtc?.takeIf { it.isNotEmpty() } ?: rd.neutralStartTimeUtc)
            ?.let { DateFormatting.parseIso(it) }
        val finish = rd.estimatedFinishTimeUtc?.let { DateFormatting.parseIso(it) }
            ?: start?.plusSeconds(DEFAULT_DURATION_SECONDS)
            ?: return@any true
        val from = (start ?: finish.minusSeconds(DEFAULT_DURATION_SECONDS)).minusSeconds(PRE_START_SECONDS)
        val until = finish.plusSeconds(POST_FINISH_SECONDS)
        !now.isBefore(from) && !now.isAfter(until)
    }
}

/**
 * Correspondencia jornada → stageNumber de las clasificaciones in-house
 * publicables. Presencia en el mapa = la jornada tiene resultados.
 */
object InhouseStageMap {
    /**
     * [stages] son las clasificaciones de UNA carrera con filas. La stage sin
     * raceDayId (un día / general final) se asigna a la jornada cuyo
     * `stageNumber` coincide (null == null en carreras de un día). Una jornada
     * cancelada nunca entra en el mapa.
     */
    fun forDays(
        stages: List<RaceUciStage>,
        days: List<Pair<String, Int?>>,
        cancelledDayIds: Set<String> = emptySet(),
    ): Map<String, Int?> {
        val withRows = stages.filter { it.rowCount > 0 }
        if (days.isEmpty() || withRows.isEmpty()) return emptyMap()
        val byDayId = withRows.filter { it.raceDayId != null }.associate { it.raceDayId!! to it.stageNumber }
        val orphans = withRows.filter { it.raceDayId == null }
        val out = HashMap<String, Int?>()
        for ((dayId, stageNumber) in days) {
            if (dayId in cancelledDayIds) continue
            when {
                byDayId.containsKey(dayId) -> out[dayId] = byDayId[dayId]
                else -> orphans.firstOrNull { it.stageNumber == stageNumber }?.let { out[dayId] = it.stageNumber }
            }
        }
        return out
    }
}
