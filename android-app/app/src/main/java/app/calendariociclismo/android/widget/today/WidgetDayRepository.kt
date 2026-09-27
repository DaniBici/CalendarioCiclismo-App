package app.calendariociclismo.android.widget.today

import android.content.Context
import android.util.Log
import app.calendariociclismo.android.CalendarioCiclismoApp
import app.calendariociclismo.android.util.RegionDetector
import app.calendariociclismo.android.widget.today.model.WidgetDayResponse
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.time.Duration
import java.time.Instant
import java.time.LocalDate

/**
 * Datos del widget desde la RPC `widget_day`, con la última respuesta válida
 * en disco para mostrarla sin conexión. Un fichero por configuración.
 */
class WidgetDayRepository(private val context: Context) {

    data class Result(val response: WidgetDayResponse, val fromCache: Boolean, val fetchedAt: Instant)

    private val app: CalendarioCiclismoApp?
        get() = context.applicationContext as? CalendarioCiclismoApp

    /**
     * Devuelve la copia local si es reciente (`maxAge`); en otro caso consulta
     * la RPC y, si falla, sirve la copia local aunque sea antigua.
     */
    suspend fun load(config: WidgetConfig, maxAge: Duration = Duration.ofMinutes(15)): Result? {
        val cached = readCache(config)
        if (cached != null && Duration.between(cached.fetchedAt, Instant.now()) < maxAge &&
            cached.response.day(LocalDate.now().toString()) != null
        ) return cached
        val fetched = runCatching { fetch(config) }
            .onFailure { Log.w(TAG, "widget_day falló: ${it.message}") }
            .getOrNull()
        return fetched ?: cached?.copy(fromCache = true)
    }

    private suspend fun fetch(config: WidgetConfig): Result {
        val app = app ?: error("Aplicación no disponible")
        val prefs = app.preferences
        val params = buildJsonObject {
            put("p_date", LocalDate.now().toString())
            put("p_days", DAYS)
            put("p_locale", prefs.snapshotAppLocale().tag)
            put("p_broadcast_groups", JsonArray(RegionDetector.allowedBroadcastGroups().sorted().map(::JsonPrimitive)))
            put("p_disciplines", JsonArray(config.discipline.rpcValue.map(::JsonPrimitive)))
            when (config.scope) {
                WidgetScope.APP_FILTER -> {
                    put("p_filter", prefs.defaultFilter.first().id)
                    put("p_cx_filter", prefs.snapshotCxDefaultFilter() ?: "all")
                }
                WidgetScope.ALL -> {
                    put("p_filter", "all")
                    put("p_cx_filter", "all")
                }
                WidgetScope.FOLLOWED -> {
                    put("p_race_ids", JsonArray(prefs.snapshotFollowedRaceIds().sorted().map(::JsonPrimitive)))
                    put("p_race_day_ids", JsonArray(prefs.snapshotFollowedStageIds().sorted().map(::JsonPrimitive)))
                    put("p_cx_race_ids", JsonArray(prefs.snapshotFollowedCxRaceIds().sorted().map(::JsonPrimitive)))
                }
            }
        }
        val raw = app.supabaseService.widgetDay(params)
        val response = json.decodeFromString<WidgetDayResponse>(raw)
        val now = Instant.now()
        runCatching {
            val file = cacheFile(config)
            file.parentFile?.mkdirs()
            file.writeText(raw)
            file.setLastModified(now.toEpochMilli())
        }
        return Result(response, fromCache = false, fetchedAt = now)
    }

    private fun readCache(config: WidgetConfig): Result? {
        val file = cacheFile(config)
        if (!file.exists()) return null
        return runCatching {
            Result(json.decodeFromString<WidgetDayResponse>(file.readText()), true, Instant.ofEpochMilli(file.lastModified()))
        }.getOrNull()
    }

    private fun cacheFile(config: WidgetConfig) = File(File(context.cacheDir, CACHE_DIR), "widget_day_${config.cacheKey}.json")

    /** Invalida las copias locales (cambio de idioma, filtro o seguimientos). */
    fun invalidate() {
        File(context.cacheDir, CACHE_DIR).listFiles()?.forEach { it.delete() }
    }

    companion object {
        private const val TAG = "WidgetDayRepository"
        private const val CACHE_DIR = "widget"

        /** Hoy y mañana: el cambio de jornada a medianoche no depende de la red. */
        const val DAYS = 2
        private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    }
}
