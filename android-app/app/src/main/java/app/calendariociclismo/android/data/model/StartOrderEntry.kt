package app.calendariociclismo.android.data.model

import kotlinx.serialization.Serializable

/**
 * Entrada de orden de salida (tabla `start_order_entries`).
 * CRI/CRE: hora de salida individual por corredor.
 */
@Serializable
data class StartOrderEntry(
    val id: String,
    val raceDayId: String,
    val sortOrder: Int = 0,
    val dorsal: Int,
    val startTime: String,
    val riderId: String? = null,
    val riderName: String? = null,
    val teamName: String? = null,
    val countryCode: String? = null,
)

/**
 * Subset de race_days necesario para el header + filtros del orden de salida.
 * (`startOrderTtDorsals` / `startOrderGcDorsals` no están en el modelo `RaceDay`.)
 */
@Serializable
data class StartOrderRaceDay(
    val id: String,
    val raceId: String? = null,
    val date: String? = null,
    val dateKey: String? = null,
    val slug: String? = null,
    val slugEn: String? = null,
    val stageNumber: Int? = null,
    val primaryType: String? = null,
    val startLocation: String? = null,
    val finishLocation: String? = null,
    val startLocationEn: String? = null,
    val finishLocationEn: String? = null,
    val distanceKm: Double? = null,
    val timezone: String? = null,
    val startOrderTtDorsals: List<Int>? = null,
    val startOrderGcDorsals: List<Int>? = null,
) {
    /** Fecha de referencia para convertir la hora local de la carrera. `dateKey`
     * es el campo canónico y NUNCA es null; `date` es legacy y puede faltar
     * (cuando faltaba, la conversión de huso se saltaba y se mostraba la hora cruda). */
    val effectiveDate: String? get() = dateKey ?: date
}

data class StartOrderData(
    /// DTO con campos extra (TT/GC dorsals, timezone) que no están en `RaceDay`.
    val raceDay: StartOrderRaceDay,
    /// `RaceDay` canónico usado por `StageInfoHeaderCard` (paridad con perfil).
    val fullRaceDay: RaceDay?,
    val race: Race?,
    val entries: List<StartOrderEntry>,
)
