package app.calendariociclismo.android.widget.today

import android.content.Context
import android.util.Log
import app.calendariociclismo.android.CalendarioCiclismoApp
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.util.Constants
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.widget.today.model.TodayWidgetItem
import app.calendariociclismo.android.widget.today.model.TodayWidgetPayload
import app.calendariociclismo.android.widget.today.model.WidgetState
import kotlinx.coroutines.flow.first

class TodayWidgetRepository(private val context: Context) {

    private val app: CalendarioCiclismoApp?
        get() = context.applicationContext as? CalendarioCiclismoApp

    suspend fun buildPayload(): TodayWidgetPayload {
        val today = DateFormatting.todayKey()
        return try {
            buildPayloadInternal(today)
        } catch (e: Exception) {
            Log.w(TAG, "Error construyendo payload del widget: ${e.message}")
            TodayWidgetPayload(today, WidgetState.Empty(null))
        }
    }

    private suspend fun buildPayloadInternal(today: String): TodayWidgetPayload {
        val app = app ?: return TodayWidgetPayload(today, WidgetState.Empty(null))
        val repo = app.repository

        val data = repo.cachedDayData(today)

        if (data == null) {
            val offlineEnabled = app.preferences.snapshotOfflineEnabled()
            val lastSyncEpoch = app.preferences.lastSyncEpoch.first()
            val state = if (offlineEnabled && lastSyncEpoch == null) {
                WidgetState.Syncing
            } else {
                WidgetState.Empty(repo.nextRaceDateAfter(today))
            }
            return TodayWidgetPayload(today, state)
        }

        val allDays = data.raceDays

        // Días activos: publicados, sin descanso, sin anulación, sin placeholder
        val activeDays = allDays.filter { erd ->
            !erd.raceDay.isRestDay &&
                !erd.raceDay.isCancelledDay &&
                erd.raceDay.isPublished &&
                !erd.isPlaceholder
        }

        if (activeDays.isEmpty()) {
            // Comprobar estados especiales antes de devolver empty
            val firstReal = allDays.firstOrNull { !it.isPlaceholder }
            if (firstReal != null) {
                val race = firstReal.race
                val country = effectiveCountryCode(
                    firstReal.raceDay.countryCode,
                    race?.countryCode,
                    race?.hideFlag ?: false,
                )
                if (firstReal.raceDay.isRestDay) {
                    return TodayWidgetPayload(
                        today,
                        WidgetState.RestDay(race?.name ?: "", country),
                    )
                }
                if (firstReal.raceDay.isCancelledDay) {
                    return TodayWidgetPayload(
                        today,
                        WidgetState.Cancelled(race?.name ?: "", country),
                    )
                }
            }
            return TodayWidgetPayload(today, WidgetState.Empty(repo.nextRaceDateAfter(today)))
        }

        // Aplicar filtro por defecto configurado por el usuario
        val defaultFilter = app.preferences.defaultFilter.first()
        val filteredDays = RaceLogic.filterByCategory(activeDays, defaultFilter)

        if (filteredDays.isEmpty()) {
            return TodayWidgetPayload(today, WidgetState.Empty(repo.nextRaceDateAfter(today)))
        }

        // Ordenar por neutralStartTimeUtc ascendente, null al final
        val sorted = filteredDays.sortedWith { a, b ->
            val ta = a.raceDay.neutralStartTimeUtc?.let { DateFormatting.timestampToSeconds(it) }
            val tb = b.raceDay.neutralStartTimeUtc?.let { DateFormatting.timestampToSeconds(it) }
            when {
                ta == null && tb == null -> 0
                ta == null -> 1
                tb == null -> -1
                else -> ta.compareTo(tb)
            }
        }

        // Construir items (max 3 para vista multi; overflow cuenta lo que sobra)
        val items = sorted.take(3).map { erd ->
            val rd = erd.raceDay
            val race = erd.race
            val country = effectiveCountryCode(rd.countryCode, race?.countryCode, race?.hideFlag ?: false)
            val sortedBroadcasts = erd.broadcasts.sortedBy { it.sortOrder }
            val channels = sortedBroadcasts
                .take(2)
                .mapNotNull { it.channel?.takeIf { c -> c.isNotEmpty() } }
            val broadcastStartTimeUtc = sortedBroadcasts.firstOrNull()?.startTimeUtc
            val hasLiveText = erd.assets.any { it.type == "live_text" }
            val typeLabel = if (rd.primaryType != null && rd.primaryType != "itt") {
                RaceLogic.resolveTypeLabel(context, rd.primaryType, rd.secondaryType, race?.countryCode).takeIf { it.isNotEmpty() }
            } else null

            TodayWidgetItem(
                raceDayId = rd.id,
                raceId = race?.id ?: rd.raceId ?: rd.id,
                raceName = race?.name ?: "",
                countryCode = country,
                uciCategory = race?.uciCategory,
                gender = race?.gender,
                stageLabel = buildStageLabel(rd),
                startLocation = rd.localizedStartLocation,
                finishLocation = rd.localizedFinishLocation,
                startTimeUtc = rd.neutralStartTimeUtc,
                estimatedFinishTimeUtc = rd.estimatedFinishTimeUtc,
                primaryType = rd.primaryType,
                distanceKm = rd.distanceKm,
                typeLabel = typeLabel,
                channels = channels,
                broadcastStartTimeUtc = broadcastStartTimeUtc,
                tvStatus = rd.tvStatus,
                hasLiveText = hasLiveText,
            )
        }

        var displayItems = items.take(3)
        val overflow = (sorted.size - 3).coerceAtLeast(0)

        // Solo mostrar en solitario si tiene TV confirmada (con o sin hora)
        if (displayItems.size == 1 && displayItems[0].channels.isEmpty() && displayItems[0].tvStatus != "confirmed") {
            val nextDateKey = repo.nextRaceDateAfter(today)
            return TodayWidgetPayload(today, WidgetState.Empty(nextDateKey))
        }

        // Obtener info de la próxima carrera con TV confirmada (para el estado "todas terminadas")
        val nextDateKey = repo.nextRaceDateAfter(today)
        val nextRaceName: String? = nextDateKey?.let { ndk ->
            val candidates = repo.cachedDayData(ndk)?.raceDays
                ?.filter { erd -> !erd.raceDay.isRestDay && !erd.raceDay.isCancelledDay && erd.raceDay.isPublished && !erd.isPlaceholder }
                .orEmpty()
            val withTv = candidates.filter { erd ->
                erd.broadcasts.any { it.channel?.isNotEmpty() == true } ||
                    erd.raceDay.tvStatus == "confirmed"
            }
            (withTv.firstOrNull() ?: candidates.firstOrNull())?.race?.name
        }

        return TodayWidgetPayload(today, WidgetState.HasRaces(displayItems, overflow, nextDateKey, nextRaceName))
    }

    private fun buildStageLabel(rd: RaceDay): String {
        val n = rd.stageNumber
        return when {
            n == null -> "Clásica"
            rd.primaryType == "ttt" -> if (n == 0) "CRE" else "CRE etapa $n"
            rd.primaryType == "itt" -> if (n == 0) "CRI" else "CRI etapa $n"
            n == 0 -> "Prólogo"
            else -> "Etapa $n${rd.stageSuffix.orEmpty()}"
        }
    }

    // Si hideFlag == true y rd no tiene override propio → no mostrar bandera
    private fun effectiveCountryCode(
        rdCountry: String?,
        raceCountry: String?,
        hideFlag: Boolean,
    ): String? {
        if (hideFlag && rdCountry == null) return null
        return rdCountry ?: raceCountry
    }

    companion object {
        private const val TAG = "TodayWidgetRepository"
    }
}
