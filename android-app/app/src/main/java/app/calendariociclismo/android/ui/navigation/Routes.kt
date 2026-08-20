package app.calendariociclismo.android.ui.navigation

/**
 * Rutas de Navigation Compose.
 *
 * Se mapean a los deep links (`race/{id}`, `stage/{id}`, pestañas) y también
 * a los Android App Links publicados en el manifest.
 */
object Routes {
    const val TODAY = "today"
    // Feed cronológico de resultados (apps 3.1) — espejo de /resultados/ web.
    const val RESULTS_FEED = "results_feed"
    // Calendario = fusión de las antiguas pestañas Mes y Temporada (la subvista
    // activa se recuerda en AppPreferences.calendarSubview).
    const val CALENDAR = "calendar"
    // Mercado de fichajes 2027 (apps 4.0) — 3ª pestaña; sustituye a Buscar
    // (archivado en archive/buscador-apps-2026/).
    const val TRANSFERS = "transfers"
    // Entrada desde el cintillo de Hoy: no es una pestaña, conserva el retorno.
    const val TRANSFERS_HIGHLIGHT = "transfers_highlight"
    const val SETTINGS = "settings"

    const val RACE = "race/{raceId}"
    // raceId es opcional — se usa como hint para prefetchear si la jornada no está en caché local
    const val STAGE = "stage/{stageId}?raceId={raceId}"
    // La ruta registrada en AppNavHost es "elevation_profile/{rdId}"; mantener
    // sincronizados constante, helper y el `composable` de AppNavHost.
    const val ELEVATION_PROFILE = "elevation_profile/{rdId}"
    // Mapa del recorrido nativo (MapLibre). Espejo de /mapa/ web; prioridad GPX.
    const val ROUTE_MAP = "route_map/{rdId}"
    const val STARTLIST = "startlist/{raceId}"
    const val START_ORDER = "start_order/{raceDayId}"
    // stage es opcional: número de etapa (0=prólogo) o ausente = última/final.
    // class es opcional: clasificación inicial ("gc" para abrir en la General) o
    // ausente = la primera de la etapa (stage). Lo usa "Así está la carrera".
    const val RESULTS = "results/{raceId}?stage={stage}&sfx={sfx}&class={class}"
    const val FOLLOWED_RACES = "followed_races"
    const val FOLLOWED_STAGES = "followed_stages"
    const val CHAMPIONSHIPS = "championships"
    // Detalle de equipo del mercado (continúan / llegan / se marchan).
    const val TRANSFERS_TEAM = "transfers_team/{teamId}"

    fun race(raceId: String) = "race/$raceId"
    fun stage(stageId: String, raceId: String? = null): String =
        if (raceId != null) "stage/$stageId?raceId=$raceId"
        else "stage/$stageId"
    fun elevationProfile(rdId: String) = "elevation_profile/$rdId"
    fun routeMap(rdId: String) = "route_map/$rdId"
    fun startlist(raceId: String) = "startlist/$raceId"
    fun startOrder(raceDayId: String) = "start_order/$raceDayId"
    fun results(raceId: String, stage: Int? = null, classKind: String? = null, suffix: String? = null): String {
        val params = buildList {
            if (stage != null) add("stage=$stage")
            if (!suffix.isNullOrEmpty()) add("sfx=$suffix")   // sector A/B (doble sector)
            if (classKind != null) add("class=$classKind")
        }
        return if (params.isEmpty()) "results/$raceId" else "results/$raceId?${params.joinToString("&")}"
    }
    val followedRaces = FOLLOWED_RACES
    val followedStages = FOLLOWED_STAGES
    fun transfersTeam(teamId: String) = "transfers_team/$teamId"

    /** Pestañas principales mostradas en la bottom bar. */
    val MAIN_TABS = listOf(TODAY, RESULTS_FEED, TRANSFERS, CALENDAR, SETTINGS)
}
