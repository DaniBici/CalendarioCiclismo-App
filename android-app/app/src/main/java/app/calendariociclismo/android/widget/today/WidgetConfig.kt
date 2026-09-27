package app.calendariociclismo.android.widget.today

import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey

/** Qué carreras muestra cada widget (configuración por instancia). */
enum class WidgetScope(val id: String) {
    /** El filtro fijado en Hoy y en la agenda CX de la app. */
    APP_FILTER("appFilter"),
    ALL("all"),
    /** Solo las carreras, etapas y pruebas CX seguidas en la app. */
    FOLLOWED("followed");

    companion object {
        fun from(id: String?): WidgetScope = entries.firstOrNull { it.id == id } ?: APP_FILTER
    }
}

enum class WidgetDiscipline(val id: String, val rpcValue: List<String>) {
    BOTH("both", listOf("road", "cx")),
    ROAD("road", listOf("road")),
    CYCLOCROSS("cyclocross", listOf("cx"));

    companion object {
        fun from(id: String?): WidgetDiscipline = entries.firstOrNull { it.id == id } ?: BOTH
    }
}

data class WidgetConfig(val scope: WidgetScope, val discipline: WidgetDiscipline) {
    val cacheKey: String get() = "${scope.id}_${discipline.id}"

    companion object {
        val DEFAULT = WidgetConfig(WidgetScope.APP_FILTER, WidgetDiscipline.BOTH)

        /** Claves del estado Glance de cada instancia. */
        val KEY_SCOPE = stringPreferencesKey("widget_scope")
        val KEY_DISCIPLINE = stringPreferencesKey("widget_discipline")
        /** Marca que fuerza la recarga de datos en una sesión Glance activa. */
        val KEY_VERSION = longPreferencesKey("widget_data_version")

        fun from(prefs: Preferences): WidgetConfig =
            WidgetConfig(WidgetScope.from(prefs[KEY_SCOPE]), WidgetDiscipline.from(prefs[KEY_DISCIPLINE]))
    }
}
