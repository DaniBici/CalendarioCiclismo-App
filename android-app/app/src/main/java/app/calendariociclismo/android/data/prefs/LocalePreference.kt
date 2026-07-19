package app.calendariociclismo.android.data.prefs

/**
 * Preferencia de idioma seleccionada por el usuario en Ajustes.
 *
 * Equivalente a `LocaleService.AppLocale` en iOS. La app nació en español
 * y el inglés se introduce en 2.0 como feature Premium.
 *
 * El valor se persiste en DataStore como string (el `tag` BCP-47, es decir
 * `"es"` o `"en"`). Aplicación al runtime: `MainActivity.onCreate()` llama
 * a `AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))`
 * antes de `setContent`. Eso hace que `getResources()` resuelva strings
 * desde `values/` o `values-en/` según corresponda.
 *
 * Cambio en runtime: `setApplicationLocales` reinicia la activity actual.
 * Por eso al cambiar de idioma desde Ajustes el comportamiento esperado
 * es que la pantalla parpadee y vuelva a montarse en el nuevo idioma.
 */
enum class LocalePreference(val tag: String) {
    SPANISH("es"),
    ENGLISH("en");

    /** Etiqueta visible en la UI (no se traduce — siempre en su idioma nativo). */
    val label: String
        get() = when (this) {
            SPANISH -> "Español"
            ENGLISH -> "English"
        }

    companion object {
        /** Parser tolerante: cualquier valor desconocido vuelve a `SPANISH`. */
        fun fromStorage(raw: String?): LocalePreference =
            entries.firstOrNull { it.tag == raw } ?: SPANISH
    }
}
