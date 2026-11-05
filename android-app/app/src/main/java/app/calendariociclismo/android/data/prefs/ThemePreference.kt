package app.calendariociclismo.android.data.prefs

import android.app.UiModeManager
import android.content.Context
import android.os.Build
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

/**
 * Registra la preferencia como modo noche de la app (API 31+). El sistema la
 * persiste y la aplica a la configuración del proceso desde el arranque: el
 * splash del sistema, los recursos de `values-night` e `isSystemInDarkTheme()`
 * siguen así Claro/Oscuro de Ajustes. `SYSTEM` (`MODE_NIGHT_AUTO`) devuelve el
 * ajuste del dispositivo. Por debajo de API 31 no hay equivalente y el tema se
 * resuelve solo en Compose.
 */
fun ThemePreference.applyAsApplicationNightMode(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val mode = when (this) {
        ThemePreference.SYSTEM -> UiModeManager.MODE_NIGHT_AUTO
        ThemePreference.LIGHT -> UiModeManager.MODE_NIGHT_NO
        ThemePreference.DARK -> UiModeManager.MODE_NIGHT_YES
    }
    context.getSystemService(UiModeManager::class.java)?.setApplicationNightMode(mode)
}
