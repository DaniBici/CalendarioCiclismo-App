package app.calendariociclismo.android.util

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Utilidades de formato de fecha/hora — port literal de
 * `ios-app/.../Services/DateFormatting.swift` y `js/services/dates.js`.
 *
 * Locale: las funciones que emiten etiquetas de calendario (días/meses)
 * leen `LocaleHolder.current` en cada llamada para que la app cambie de
 * idioma sin reiniciar todo el proceso. La hora `HH:mm` (24h numérico)
 * mantiene `LOCALE_ES` como optimización — el formato es idéntico en
 * cualquier idioma.
 *
 * Usamos `java.time` (desugarado por AGP) en vez de SimpleDateFormat siempre
 * que sea razonable para evitar los bugs de thread-safety de los formatters clásicos.
 */
object DateFormatting {

    private val LOCALE_ES = Locale("es", "ES")
    private val LOCALE_EN = Locale("en", "US")
    private val MADRID_ZONE: ZoneId = ZoneId.of("Europe/Madrid")

    private val DATE_KEY_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US)

    /** Locale activo de la UI. `MainActivity` lo actualiza en `onCreate()`. */
    private val isSpanish: Boolean
        get() = LocaleHolder.current.language == "es"

    private val uiLocale: Locale
        get() = LocaleHolder.current

    /** Locale del CONTENIDO (nombres de carrera, fechas de cabecera de etapa…),
     *  no del chrome de la UI. Sigue `shouldShowEnglishContent`: si los contenidos
     *  se muestran en inglés (app en EN o dispositivo no-español), la fecha también.
     *  Mismo criterio que el formateo del kilometraje (RaceDay.distanceFormatted). */
    private val contentLocale: Locale
        get() = if (LocaleHolder.shouldShowEnglishContent) LOCALE_EN else LOCALE_ES

    // ── DateKey helpers ─────────────────────────────────────────

    /** Convierte `Date` a `YYYY-MM-DD` (en zona horaria del dispositivo). */
    fun toDateKey(date: Date): String {
        val local = date.toInstant().atZone(ZoneId.systemDefault()).toLocalDate()
        return local.format(DATE_KEY_FORMATTER)
    }

    /** Hoy como dateKey. */
    fun todayKey(): String = LocalDate.now().format(DATE_KEY_FORMATTER)

    /** Parsea `YYYY-MM-DD` a `java.util.Date`. */
    fun parseDateKey(dateKey: String): Date? = try {
        val ld = LocalDate.parse(dateKey, DATE_KEY_FORMATTER)
        Date.from(ld.atStartOfDay(ZoneId.systemDefault()).toInstant())
    } catch (_: DateTimeParseException) {
        null
    }

    /** Parsea `YYYY-MM-DD` a `LocalDate`. */
    fun parseLocalDate(dateKey: String): LocalDate? = try {
        LocalDate.parse(dateKey, DATE_KEY_FORMATTER)
    } catch (_: DateTimeParseException) {
        null
    }

    // ── Etiquetas de fecha ──────────────────────────────────────

    /** "Mié 8 abr" / "Wed 8 Apr". */
    fun formatDateShort(dateKey: String): String {
        val date = parseDateKey(dateKey) ?: return dateKey
        val locale = uiLocale
        val f = SimpleDateFormat("EEE d MMM", locale)
        return f.format(date).replaceFirstChar { it.uppercase(locale) }
    }

    /** "Miércoles, 8 de abril de 2026" / "Wednesday, 8 April 2026" (locale de UI). */
    fun formatDateLong(dateKey: String): String =
        formatDateLongIn(dateKey, uiLocale)

    /** Como [formatDateLong] pero en el idioma del CONTENIDO (no el chrome de la
     *  UI): la cabecera de etapa (nombre de carrera, ruta, km…) se muestra en EN
     *  cuando el contenido va en inglés, y la fecha debe acompañarla. */
    fun formatDateLongContent(dateKey: String): String =
        formatDateLongIn(dateKey, contentLocale)

    /** Fecha canónica del ránking UCI, completa y con el mismo patrón por idioma. */
    fun formatUciRankingUpdated(dateKey: String, isEnglish: Boolean): String {
        val locale = if (isEnglish) LOCALE_EN else LOCALE_ES
        val prefix = if (isEnglish) "Updated" else "Actualizado"
        val date = parseDateKey(dateKey) ?: return "$prefix: $dateKey"
        val pattern = if (isEnglish) "EEEE, d MMMM yyyy" else "EEEE, d 'de' MMMM 'de' yyyy"
        val f = SimpleDateFormat(pattern, locale)
        return "$prefix: ${f.format(date)}"
    }

    /** Día de la semana + día + mes, SIN año, en el idioma del CONTENIDO
     *  ("Martes 24 de junio" / "Tuesday 24 June"). Para el feed del mercado de
     *  fichajes; paridad con web (`dayHeading`) e iOS. */
    fun formatDateWeekdayNoYear(dateKey: String): String {
        val date = parseDateKey(dateKey) ?: return dateKey
        val isEs = contentLocale.language == "es"
        val pattern = if (isEs) "EEEE d 'de' MMMM" else "EEEE d MMMM"
        val f = SimpleDateFormat(pattern, contentLocale)
        return f.format(date).replaceFirstChar { it.uppercase(contentLocale) }
    }

    /** "7 jun" / "7 Jun" — día y mes cortos en el idioma del CONTENIDO, sin
     *  punto de abreviatura (espejo de `shortDate` en js/corredor.js: fechas de
     *  las líneas de etapa y cabeceras de bloque de la ficha de corredor). */
    fun formatDayMonthContent(dateKey: String): String {
        val date = parseDateKey(dateKey) ?: return ""
        val f = SimpleDateFormat("d MMM", contentLocale)
        return f.format(date).replace(".", "")
    }

    private fun formatDateLongIn(dateKey: String, locale: Locale): String {
        val date = parseDateKey(dateKey) ?: return dateKey
        val pattern = if (locale.language == "es") "EEEE, d 'de' MMMM 'de' yyyy" else "EEEE, d MMMM yyyy"
        val f = SimpleDateFormat(pattern, locale)
        return f.format(date).replaceFirstChar { it.uppercase(locale) }
    }

    /** "Abril de 2026" / "April 2026". */
    fun formatMonthYear(year: Int, month: Int): String {
        // month viene 0-based en el iOS original, aquí asumimos 1-based (enero = 1).
        val cal = Calendar.getInstance().apply {
            clear()
            set(Calendar.YEAR, year)
            set(Calendar.MONTH, month - 1)
            set(Calendar.DAY_OF_MONTH, 1)
        }
        val locale = uiLocale
        val pattern = if (isSpanish) "MMMM 'de' yyyy" else "MMMM yyyy"
        val f = SimpleDateFormat(pattern, locale)
        return f.format(cal.time).replaceFirstChar { it.uppercase(locale) }
    }

    /** Nombre corto del mes 1-based: "Ene"/"Jan", "Feb", …. */
    fun shortMonthName(month: Int): String {
        val locale = uiLocale
        val symbols = SimpleDateFormat("MMM", locale)
        val cal = Calendar.getInstance().apply {
            clear()
            set(Calendar.MONTH, month - 1)
            set(Calendar.DAY_OF_MONTH, 1)
        }
        return symbols.format(cal.time).replaceFirstChar { it.uppercase(locale) }
    }

    /** Rango compacto de fechas: "6–27 jul" o "30 ago – 21 sep". */
    fun formatDateRange(start: String?, end: String?): String {
        if (start == null) return ""
        val startDate = parseLocalDate(start) ?: return ""
        val endDate = end?.let { parseLocalDate(it) } ?: startDate

        val locale = uiLocale
        val monthFmt = SimpleDateFormat("MMM", locale)
        val sCal = Calendar.getInstance().apply { time = Date.from(startDate.atStartOfDay(ZoneId.systemDefault()).toInstant()) }
        val eCal = Calendar.getInstance().apply { time = Date.from(endDate.atStartOfDay(ZoneId.systemDefault()).toInstant()) }

        val sDay = sCal.get(Calendar.DAY_OF_MONTH)
        val sMonth = sCal.get(Calendar.MONTH)
        val sYear = sCal.get(Calendar.YEAR)
        val eDay = eCal.get(Calendar.DAY_OF_MONTH)
        val eMonth = eCal.get(Calendar.MONTH)
        val eYear = eCal.get(Calendar.YEAR)

        val sMonthStr = monthFmt.format(sCal.time)
        val eMonthStr = monthFmt.format(eCal.time)

        if (start == (end ?: start)) return "$sDay $sMonthStr"
        if (sMonth == eMonth && sYear == eYear) return "$sDay–$eDay $eMonthStr"
        if (sYear == eYear) return "$sDay $sMonthStr – $eDay $eMonthStr"
        return "$sDay $sMonthStr $sYear – $eDay $eMonthStr $eYear"
    }

    // ── Hora ────────────────────────────────────────────────────

    /** Parsea un string ISO 8601 (con o sin fracciones de segundo). */
    fun parseIso(isoString: String): Instant? = try {
        Instant.parse(isoString)
    } catch (_: DateTimeParseException) {
        try {
            // Fallback para formatos sin zona explícita (Supabase a veces los devuelve así).
            val ldt = LocalDateTime.parse(isoString, DateTimeFormatter.ISO_LOCAL_DATE_TIME)
            ldt.toInstant(ZoneOffset.UTC)
        } catch (_: DateTimeParseException) {
            null
        }
    }

    /** Timestamp ISO → hora Madrid "HH:mm". 24h numérico — locale fijo OK. */
    fun formatTimeMadrid(isoString: String): String? {
        val instant = parseIso(isoString) ?: return null
        val fmt = DateTimeFormatter.ofPattern("HH:mm", LOCALE_ES).withZone(MADRID_ZONE)
        return fmt.format(instant)
    }

    /** Timestamp ISO → hora local del dispositivo "HH:mm". Usar siempre en el widget. */
    fun formatTimeLocal(isoString: String, zone: ZoneId = ZoneId.systemDefault()): String? {
        val instant = parseIso(isoString) ?: return null
        val fmt = DateTimeFormatter.ofPattern("HH:mm", LOCALE_ES).withZone(zone)
        return fmt.format(instant)
    }

    /** ISO → segundos epoch (Double) para comparaciones de orden. */
    fun timestampToSeconds(isoString: String): Double? =
        parseIso(isoString)?.toEpochMilli()?.toDouble()?.div(1000.0)

    // ── Navegación de fechas ────────────────────────────────────

    fun previousDay(dateKey: String): String? =
        parseLocalDate(dateKey)?.minusDays(1)?.format(DATE_KEY_FORMATTER)

    fun nextDay(dateKey: String): String? =
        parseLocalDate(dateKey)?.plusDays(1)?.format(DATE_KEY_FORMATTER)

    fun dayOffset(from: String, byDays: Int): String? =
        parseLocalDate(from)?.plusDays(byDays.toLong())?.format(DATE_KEY_FORMATTER)

    /** Rango de dateKeys `[dateKey-offset … dateKey+offset]`. */
    fun dateRangeAround(dateKey: String, offset: Int): List<String> {
        val center = parseLocalDate(dateKey) ?: return listOf(dateKey)
        return (-offset..offset).map { center.plusDays(it.toLong()).format(DATE_KEY_FORMATTER) }
    }

    /** Día actual como epoch seconds (UTC). */
    fun nowEpochSeconds(): Long = System.currentTimeMillis() / 1000L

    @Suppress("unused")
    private fun TimeZone.debug(): String = displayName
}

/**
 * Singleton mutable que mantiene el `Locale` activo de la UI.
 *
 * Se actualiza desde `MainActivity.onCreate()` antes de `setContent` (lectura
 * síncrona de DataStore) y desde `SettingsScreen` cuando el usuario cambia
 * de idioma. `DateFormatting` lo lee en cada llamada.
 *
 * @Volatile asegura que la escritura desde un thread sea visible inmediatamente
 * desde otros sin necesidad de sincronización adicional — el caso de uso es
 * "escritura ocasional desde main, lectura concurrente desde múltiples threads".
 */
object LocaleHolder {
    /**
     * Locale de la app observable por Compose. Usar `currentState` en
     * composables para que se recompongan automáticamente al cambiar idioma.
     * `current` es el alias @Volatile para código fuera de Compose (modelos,
     * workers, formatters) — ambos se actualizan siempre a la vez.
     */
    private val _currentState = mutableStateOf(Locale("es", "ES"))

    /** Para lectura en composables: provoca recomposición al cambiar idioma. */
    var currentState: Locale by _currentState

    /** Para lectura fuera de Compose (modelos, DateFormatting, workers). */
    @Volatile var current: Locale = Locale("es", "ES")
        set(value) {
            field = value
            _currentState.value = value
        }

    /** Locale del sistema/dispositivo, independiente de la preferencia de la app.
     *  Actualizado en MainActivity antes de cualquier override de app locale. */
    @Volatile var system: Locale = Locale("es", "ES")

    /** `true` si los contenidos (nombres de carrera, etiquetas de tipo de etapa)
     *  deben mostrarse en inglés. Dos condiciones lo activan:
     *  - La app está en inglés (Premium), O
     *  - El idioma principal del dispositivo no es español. */
    val shouldShowEnglishContent: Boolean
        get() = current.language == "en" || system.language != "es"

    /** Helper para alternar texto ES/EN según `shouldShowEnglishContent`. */
    fun t(es: String, en: String): String = if (shouldShowEnglishContent) en else es
}
