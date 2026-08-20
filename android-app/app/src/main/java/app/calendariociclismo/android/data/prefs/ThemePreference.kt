package app.calendariociclismo.android.data.prefs

import androidx.annotation.StringRes
import app.calendariociclismo.android.R

/**
 * Preferencia de tema seleccionada por el usuario en Ajustes → Apariencia.
 *
 * Equivalente a `ThemeService.ThemePreference` en iOS. `SYSTEM` respeta el
 * ajuste del sistema (`isSystemInDarkTheme()`); `LIGHT` y `DARK` fuerzan el
 * modo correspondiente sin importar el del sistema.
 *
 * El valor se persiste en DataStore como string (el `name` del enum) — ver
 * [AppPreferences.themePreference].
 */
enum class ThemePreference(@StringRes val labelRes: Int) {
    SYSTEM(R.string.theme_auto),
    LIGHT(R.string.theme_light),
    DARK(R.string.theme_dark);

    companion object {
        /** Parser tolerante: cualquier valor desconocido vuelve a `SYSTEM`. */
        fun fromStorage(raw: String?): ThemePreference =
            runCatching { raw?.let { valueOf(it) } }.getOrNull() ?: SYSTEM
    }
}
