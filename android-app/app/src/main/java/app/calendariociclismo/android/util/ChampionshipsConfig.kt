package app.calendariociclismo.android.util

import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay

/**
 * Modo Campeonatos — configuración (Campeonatos Nacionales 2026).
 * Port nativo de `js/campeonatos-config.js`: único punto con los literales
 * anuales (fechas, orden de países, slots y clasificación de slot). El año
 * siguiente = editar este archivo. Las etiquetas de slot viven en strings.xml
 * (resueltas con `stringResource` en la pantalla).
 */
object ChampionshipsConfig {
    const val YEAR = 2026

    /** Semana grande de Campeonatos (22-28 jun). Gobierna el cintillo, el selector
     *  de días, el filtro "Hoy" forzado y el takeover de la vista Hoy. NO ampliar:
     *  define la "semana de campeonatos" visible. */
    const val RANGE_START = "2026-06-22"
    const val RANGE_END = "2026-06-28"
    val DATES: Set<String> = setOf(
        "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25",
        "2026-06-26", "2026-06-27", "2026-06-28",
    )

    /** Ventana de CARGA de la pantalla de Campeonatos: qué carreras CN entran en
     *  la rejilla. Más ancha que la semana grande para recoger campeonatos fuera
     *  de ella (Ecuador, EEUU, los sub23 reunidos en Luxemburgo). Solo la usa la
     *  query de datos; todo lo demás usa [RANGE_START]/[RANGE_END]. Espejo de `js/campeonatos-config.js`. */
    const val QUERY_START = "2026-06-01"
    const val QUERY_END = "2026-07-15"

    /** Filtro "Hoy" de la rejilla: solo del 24 al 28 de junio (ambos inclusive).
     *  Los dos primeros días apenas hay pruebas → es superfluo; a mitad de semana
     *  se solapan y filtrar por la jornada del día facilita la tarea del usuario.
     *  El fin del rango coincide con [RANGE_END]. Espejo de `js/campeonatos-config.js`. */
    const val TODAY_FILTER_START = "2026-06-24"

    /** `true` si hoy (fecha real del dispositivo) cae en el rango del filtro "Hoy". */
    fun isTodayFilterActive(today: String = DateFormatting.todayKey()): Boolean =
        today >= TODAY_FILTER_START && today <= RANGE_END

    /** `true` si hoy (fecha real del dispositivo) cae en la semana de Campeonatos
     *  (22-28 jun, ventana completa). Durante esta ventana la vista "Hoy" impone el
     *  filtro Masculino por defecto y solo ofrece cuatro filtros (Todas/Pro/Masc/Fem),
     *  sin posibilidad de fijar otro predeterminado. Espejo de `js/campeonatos-config.js`. */
    fun isChampWeekFilterLock(today: String = DateFormatting.todayKey()): Boolean =
        today >= RANGE_START && today <= RANGE_END

    /** Filtros visibles en la vista "Hoy" durante la semana de Campeonatos (sin WT/WWT). */
    val CHAMP_WEEK_HOY_FILTERS: List<Constants.CategoryFilter> = listOf(
        Constants.CategoryFilter.ALL,
        Constants.CategoryFilter.PRO,
        Constants.CategoryFilter.MALE,
        Constants.CategoryFilter.FEMALE,
    )

    /** Filtro forzado por defecto en la vista "Hoy" durante la semana de Campeonatos. */
    val CHAMP_WEEK_HOY_DEFAULT: Constants.CategoryFilter = Constants.CategoryFilter.MALE

    /** Filtros visibles en la rejilla: `TODAY` solo se ofrece en su rango. */
    fun visibleFilters(): List<Filter> =
        if (isTodayFilterActive()) Filter.values().toList()
        else Filter.values().filter { it != Filter.TODAY }

    /** Filtro predeterminado: `TODAY` cuando está activo (primero), si no `ALL`. */
    fun defaultFilter(): Filter = if (isTodayFilterActive()) Filter.TODAY else Filter.ALL

    /** Orden de filas (ISO-3166-1 alpha-2, mayúscula). UCI Nation Ranking con los
     *  seis primeros forzados (ES, FR, IT, BE, NL, PT). Países presentes en datos
     *  pero ausentes de esta lista se añaden al final, ordenados por código. */
    val COUNTRY_ORDER: List<String> = listOf(
        "ES", "FR", "IT", "BE", "NL", "PT",
        "DK", "SI", "GB", "AU", "US", "NO", "CH", "DE", "CO", "MX",
        "AT", "NZ", "ER", "IE", "CZ", "EC", "PL", "KZ", "UY", "CA",
        "LV", "SK", "EE", "VE", "ZA", "SE", "CR", "LU", "GR", "IL",
        "DZ", "PA", "MN", "RS", "CN", "MU", "UZ", "JP", "UA", "GT",
        "BR", "AE", "AR", "BZ", "TH", "RO", "RW", "HU", "BM", "ID",
        "MT", "HN", "JM", "ET", "TR", "CL", "DO", "HK", "LT", "CY",
        "KR", "BO", "BG", "MA", "FI", "VN", "MC", "XK", "TT", "PR",
        "PE", "PH", "TW", "BJ", "SV", "MY", "ZW", "JO", "IR", "NA",
        "EG", "BA", "SG", "CM", "MK", "UG", "CU", "ME", "HR", "IN",
        "MD", "AG", "AL", "CV", "IS", "TN", "LA", "AO", "VG", "MO",
        "GD", "KY", "GU", "SZ", "VC", "DM", "BF", "KG", "AZ", "PY",
        "KE", "CI", "SX", "CW", "GY", "TZ", "BH", "SY", "CD", "IQ", "SA",
    )

    /** 8 eventos en orden fijo de columna. `labelRes` se resuelve con stringResource. */
    enum class Slot(val key: String, val labelRes: Int) {
        LINEA_MASC("linea_masc", R.string.champ_slot_linea_masc),
        CRI_MASC("cri_masc", R.string.champ_slot_cri_masc),
        LINEA_FEM("linea_fem", R.string.champ_slot_linea_fem),
        CRI_FEM("cri_fem", R.string.champ_slot_cri_fem),
        LINEA_SUB23_M("linea_sub23_m", R.string.champ_slot_linea_sub23_m),
        CRI_SUB23_M("cri_sub23_m", R.string.champ_slot_cri_sub23_m),
        LINEA_SUB23_F("linea_sub23_f", R.string.champ_slot_linea_sub23_f),
        CRI_SUB23_F("cri_sub23_f", R.string.champ_slot_cri_sub23_f);

        val isFemale: Boolean
            get() = this == LINEA_FEM || this == CRI_FEM || this == LINEA_SUB23_F || this == CRI_SUB23_F

        /** Etiqueta compacta para las celdas de la rejilla (género + disciplina). */
        fun shortLabel(): String = when (this) {
            LINEA_MASC    -> LocaleHolder.t("M · Línea", "M · RR")
            CRI_MASC      -> LocaleHolder.t("M · CRI", "M · ITT")
            LINEA_FEM     -> LocaleHolder.t("F · Línea", "F · RR")
            CRI_FEM       -> LocaleHolder.t("F · CRI", "F · ITT")
            LINEA_SUB23_M -> LocaleHolder.t("M23 · Línea", "M23 · RR")
            CRI_SUB23_M   -> LocaleHolder.t("M23 · CRI", "M23 · ITT")
            LINEA_SUB23_F -> LocaleHolder.t("F23 · Línea", "F23 · RR")
            CRI_SUB23_F   -> LocaleHolder.t("F23 · CRI", "F23 · ITT")
        }
    }

    /** Filtros (Hoy/Todas/Pro/Masc/Fem) → qué slots se muestran. `TODAY` no
     *  restringe por slot (filtra por fecha en `ChampionshipCountry.visibleSlots`). */
    enum class Filter(val id: String, val labelRes: Int, val slots: List<Slot>) {
        TODAY("today", R.string.filter_today, Slot.values().toList()),
        ALL("all", R.string.filter_all, Slot.values().toList()),
        PRO("pro", R.string.filter_pro, listOf(Slot.LINEA_MASC, Slot.CRI_MASC, Slot.LINEA_FEM, Slot.CRI_FEM)),
        MALE("male", R.string.filter_male, listOf(Slot.LINEA_MASC, Slot.CRI_MASC)),
        FEMALE("female", R.string.filter_female, listOf(Slot.LINEA_FEM, Slot.CRI_FEM)),
    }

    private val SUB23_REGEX = Regex("""\bsub-?23\b|\bu-?23\b""", RegexOption.IGNORE_CASE)
    private val CRI_REGEX = Regex("""\bcri\b|contrarreloj""", RegexOption.IGNORE_CASE)
    private val LINEA_REGEX = Regex("""\bl[ií]nea\b""", RegexOption.IGNORE_CASE)
    private val FEMENIN_REGEX = Regex("""\bfemenin""", RegexOption.IGNORE_CASE)
    private val MASCULIN_REGEX = Regex("""\bmasculin""", RegexOption.IGNORE_CASE)

    /** Deduce el slot de una carrera país-evento. Port 1:1 de `championshipSlot` web. */
    fun slot(race: Race, rd: RaceDay): Slot {
        val n = race.name
        val u23 = SUB23_REGEX.containsMatchIn(n)
        val itt = CRI_REGEX.containsMatchIn(n) ||
            ((rd.primaryType == "itt" || rd.primaryType == "ttt") && !LINEA_REGEX.containsMatchIn(n))
        val fem = FEMENIN_REGEX.containsMatchIn(n) ||
            (race.gender == "female" && !MASCULIN_REGEX.containsMatchIn(n))

        return if (u23) {
            if (fem) (if (itt) Slot.CRI_SUB23_F else Slot.LINEA_SUB23_F)
            else (if (itt) Slot.CRI_SUB23_M else Slot.LINEA_SUB23_M)
        } else {
            if (fem) (if (itt) Slot.CRI_FEM else Slot.LINEA_FEM)
            else (if (itt) Slot.CRI_MASC else Slot.LINEA_MASC)
        }
    }

    // ── Clasificación de una CN para los filtros de categoría (Pro/Masc/Fem) ──
    // Misma señal que slot() (nombre con respaldo en gender). Una CN élite cuenta
    // como "pro"; las sub23 quedan fuera de Pro/Masc/Fem (igual que 1.2U/2.2U).
    // Masc/Fem además respetan el género de la prueba.

    /** ¿Es una CN de categoría sub23? (línea o CRI; masc o fem) */
    fun isU23Championship(race: Race?): Boolean =
        isChampionship(race) && SUB23_REGEX.containsMatchIn(race?.name.orEmpty())

    /** Género de una CN: femenino si el nombre lo dice o gender=='female'
     *  (sin que el nombre diga masculino); masculino en otro caso. */
    fun isFemaleChampionship(race: Race?): Boolean {
        val n = race?.name.orEmpty()
        return FEMENIN_REGEX.containsMatchIn(n) ||
            (race?.gender == "female" && !MASCULIN_REGEX.containsMatchIn(n))
    }

    // ── Orden interno de la categoría CN en Hoy/Mes ───────────────────
    // Cuando dos jornadas son Campeonatos Nacionales (uciCategory == "CN") se
    // ordenan entre sí por: (1) país según COUNTRY_ORDER, (2) LÍNEA antes que
    // CRI (toda la línea por delante de toda la CRI), (3) elite masc, elite fem,
    // sub23 masc, sub23 fem. Distinto del orden de columnas de la página (que
    // intercala línea/CRI por categoría). Espejo de `js/campeonatos-config.js`.

    private val COUNTRY_INDEX: Map<String, Int> =
        COUNTRY_ORDER.withIndex().associate { (i, cc) -> cc to i }

    /** Índice de país; los ausentes van al final (mismo criterio que la rejilla). */
    fun countryIndex(countryCode: String?): Int =
        COUNTRY_INDEX[(countryCode ?: "").uppercase()] ?: COUNTRY_ORDER.size

    /** Prioridad de slot dentro de un país: línea primero (todas), luego CRI;
     *  dentro de cada bloque elite masc → elite fem → sub23 masc → sub23 fem. */
    private val CN_SLOT_RANK: Map<Slot, Int> = mapOf(
        Slot.LINEA_MASC to 0, Slot.LINEA_FEM to 1, Slot.LINEA_SUB23_M to 2, Slot.LINEA_SUB23_F to 3,
        Slot.CRI_MASC to 4, Slot.CRI_FEM to 5, Slot.CRI_SUB23_M to 6, Slot.CRI_SUB23_F to 7,
    )

    fun isChampionship(race: Race?): Boolean = race?.uciCategory == "CN"

    /**
     * Comparador parcial para dos CN: país → línea/CRI → categoría. Devuelve un
     * número (≠0 ⇒ orden decidido; 0 ⇒ desempate al comparador genérico) o `null`
     * si alguna no es CN (no aplica este orden).
     */
    fun compare(rA: Race?, rdA: RaceDay, rB: Race?, rdB: RaceDay): Int? {
        if (!isChampionship(rA) || !isChampionship(rB)) return null
        val ci = countryIndex(rA?.countryCode).compareTo(countryIndex(rB?.countryCode))
        if (ci != 0) return ci
        val sA = CN_SLOT_RANK[slot(rA!!, rdA)] ?: 8
        val sB = CN_SLOT_RANK[slot(rB!!, rdB)] ?: 8
        return sA.compareTo(sB)
    }
}
