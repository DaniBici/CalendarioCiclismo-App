package app.calendariociclismo.android.notifications

import android.net.Uri

/**
 * Tipos de deep link que puede recibir la app. Port directo del
 * `enum DeepLink` de `NotificationManager.swift`.
 *
 * Se parsea desde el campo `deepLink` del payload FCM o desde el
 * path/query de un Android App Link.
 */
sealed class DeepLink {
    data class Tab(val name: String) : DeepLink()
    data class Race(val id: String) : DeepLink()
    data class Stage(val id: String) : DeepLink()
    data class Startlist(val id: String) : DeepLink()
    data class StartOrder(val id: String) : DeepLink()
    data class Profile(val id: String) : DeepLink()
    data class Team(val id: String) : DeepLink()
    data class CxRace(val id: String, val anchor: String? = null) : DeepLink()
    data class CxRaceSlug(val slug: String, val anchor: String? = null) : DeepLink()

    /** Resultados nativos de una jornada (copa del widget): etapa null = final
     *  o última clasificación; sufijo A/B de doble sector. */
    data class Results(val raceId: String, val stage: Int?, val suffix: String? = null) : DeepLink()

    // Página de serie web: `/ciclocross/torneos/<slug>/` y `/en/cyclocross/series/<slug>`.
    // El handler resuelve el slug → torneo contra Supabase antes de navegar.
    data class CxTournamentSlug(val slug: String) : DeepLink()

    // Variantes por SLUG: las produce SOLO el App Link HTTPS de la web
    // (`/competicion/<slug>/`, `/jornada/<slug>/`), donde el último segmento
    // es un slug, no un id de Room. El handler resuelve el slug → id real
    // contra Supabase antes de navegar (espejo de `load(slug:)` en iOS).
    // Las push y el widget siguen usando Race/Stage con id directo.
    data class RaceSlug(val slug: String) : DeepLink()
    data class StageSlug(val slug: String) : DeepLink()

    companion object {
        /** Pestañas válidas (igual que iOS). "search" se conserva por
         *  compatibilidad con pushes antiguos (el handler lo manda a Hoy);
         *  "transfers" abre el mercado de fichajes (4.0). */
        val TAB_NAMES = setOf("today", "results", "month", "season", "calendar", "transfers", "cyclocross", "search", "subscribe", "notifications")

        /**
         * Regex para IDs de carrera/etapa. Solo se aceptan caracteres alfanuméricos,
         * guiones y guiones bajos para prevenir inyección de rutas.
         */
        private val VALID_ID_REGEX = Regex("^[a-zA-Z0-9_-]+$")
        private val VALID_CX_ANCHOR = Regex("^(ME|WE|MU|WU|MJ|WJ|general|programme|videos|(?:general|inscritos)-(?:ME|WE|MU|WU|MJ|WJ))$")
        private val CX_CATEGORY = Regex("^(ME|WE|MU|WU|MJ|WJ)$")

        private val RESULTS_STAGE_REGEX = Regex("^(\\d{1,3})([A-Z]?)$")

        private fun cxAnchorIsValid(anchor: String?): Boolean = anchor == null || VALID_CX_ANCHOR.matches(anchor)

        /**
         * Anchor de la ficha CX para una sección de la web: `?view=programme|tv|
         * videos|general` y las rutas `inscritos/` y `resultados/` (`startlist/`
         * y `results/` en EN), con la categoría del fragmento.
         */
        private fun cxWebAnchor(section: String?, fragment: String?): String? {
            val category = fragment?.takeIf { CX_CATEGORY.matches(it) }
            return when (section) {
                "programme", "tv" -> "programme"
                "videos" -> "videos"
                "general" -> category?.let { "general-$it" } ?: "general"
                "startlist" -> "inscritos-${category ?: "ME"}"
                else -> fragment
            }
        }

        fun parse(value: String?): DeepLink? {
            if (value.isNullOrEmpty()) return null
            if (value.startsWith("cxRace/")) {
                val parts = value.removePrefix("cxRace/").split('#', limit = 2)
                val id = parts[0]
                val anchor = parts.getOrNull(1)
                if (!VALID_ID_REGEX.matches(id) || !cxAnchorIsValid(anchor)) return null
                return CxRace(id, anchor)
            }
            // "results/{raceId}/{etapa|final}{sufijo}" → resultados nativos.
            if (value.startsWith("results/")) {
                val parts = value.removePrefix("results/").split('/')
                if (parts.size != 2 || !VALID_ID_REGEX.matches(parts[0])) return null
                if (parts[1] == "final") return Results(parts[0], null)
                val match = RESULTS_STAGE_REGEX.matchEntire(parts[1]) ?: return null
                return Results(parts[0], match.groupValues[1].toInt(), match.groupValues[2].ifEmpty { null })
            }
            if (value.startsWith("race/")) {
                val id = value.removePrefix("race/")
                if (id.isEmpty() || !VALID_ID_REGEX.matches(id)) return null
                return Race(id)
            }
            if (value.startsWith("stage/")) {
                val id = value.removePrefix("stage/")
                if (id.isEmpty() || !VALID_ID_REGEX.matches(id)) return null
                return Stage(id)
            }
            if (value.startsWith("startlist/")) {
                val id = value.removePrefix("startlist/")
                if (id.isEmpty() || !VALID_ID_REGEX.matches(id)) return null
                return Startlist(id)
            }
            if (value.startsWith("startOrder/")) {
                val id = value.removePrefix("startOrder/")
                if (id.isEmpty() || !VALID_ID_REGEX.matches(id)) return null
                return StartOrder(id)
            }
            // "perfil/" apunta al perfil de elevación de una JORNADA (por
            // raceDayId), no a una ficha de corredor (esa solo existe en web).
            if (value.startsWith("perfil/")) {
                val id = value.removePrefix("perfil/")
                if (id.isEmpty() || !VALID_ID_REGEX.matches(id)) return null
                return Profile(id)
            }
            if (value.startsWith("team/")) {
                val id = value.removePrefix("team/")
                if (id.isEmpty() || !VALID_ID_REGEX.matches(id)) return null
                return Team(id)
            }
            if (value in TAB_NAMES) return Tab(value)
            return null
        }

        /**
         * Parsea una URI con scheme `calendariociclismo://` (usado por el widget
         * "Hoy en el ciclismo"). Formas aceptadas:
         *   - `calendariociclismo://race/{id}`       → `Race(id)`
         *   - `calendariociclismo://stage/{id}`      → `Stage(id)`
         *   - `calendariociclismo://startlist/{id}`  → `Startlist(id)`
         *   - `calendariociclismo://startOrder/{id}` → `StartOrder(id)`
         *   - `calendariociclismo://perfil/{id}`     → `Profile(id)`
         *   - `calendariociclismo://team/{id}`       → `Team(id)`
         *   - `calendariociclismo://results/{raceId}/{etapa}` → `Results(...)`
         *   - `calendariociclismo://tab/{name}`      → `Tab(name)`
         *   - `calendariociclismo://{tabName}`       → `Tab(tabName)` (forma corta)
         *
         * Reconstruye la forma que entiende `parse(String?)` para mantener una
         * única fuente de verdad y misma validación de IDs.
         */
        fun fromUri(uri: Uri?): DeepLink? {
            if (uri == null) return null
            if (uri.scheme == "https") {
                if (uri.host != "calendariociclismo.app" || uri.userInfo != null || uri.port !in listOf(-1, 443)) return null
                val segments = uri.pathSegments
                val english = segments.firstOrNull() == "en"
                val path = if (english) segments.drop(1) else segments
                val expected = if (english) "cyclocross" else "ciclocross"
                if (path.firstOrNull() != expected || path.size !in 1..3) return null
                if (path.size == 1) return Tab("cyclocross")
                if (path.size == 3 && path[1] == if (english) "series" else "torneos") {
                    // Página de serie: torneos/ en ES, series/ en EN.
                    val tournamentSlug = path[2]
                    if (!Regex("^[a-z0-9-]+$").matches(tournamentSlug)) return null
                    return CxTournamentSlug(tournamentSlug)
                }
                val section = when {
                    path.size == 2 -> uri.getQueryParameter("view")
                    path[2] == if (english) "startlist" else "inscritos" -> "startlist"
                    path[2] == if (english) "results" else "resultados" -> "results"
                    else -> return null
                }
                val slug = path[1]
                val anchor = cxWebAnchor(section, uri.fragment)
                if (!Regex("^[a-z0-9-]+$").matches(slug) || !cxAnchorIsValid(anchor)) return null
                return CxRaceSlug(slug, anchor)
            }
            if (uri.scheme != "calendariociclismo") return null
            val host = uri.host ?: return null
            if (host.isEmpty()) return null
            val firstSegment = uri.pathSegments.firstOrNull().orEmpty()

            if (host == "cxRace") {
                if (uri.pathSegments.size != 1 || !cxAnchorIsValid(uri.fragment)) return null
                return parse("cxRace/$firstSegment" + (uri.fragment?.let { "#$it" } ?: ""))
            }

            if (host == "results") {
                if (uri.pathSegments.size != 2) return null
                return parse("results/" + uri.pathSegments.joinToString("/"))
            }

            return when (host) {
                "race", "stage", "startlist", "startOrder", "perfil", "team" -> {
                    if (firstSegment.isEmpty()) null
                    else parse("$host/$firstSegment")
                }
                "tab" -> {
                    if (firstSegment.isEmpty()) null
                    else parse(firstSegment)
                }
                // Forma corta: calendariociclismo://today → "today"
                else -> parse(host)
            }
        }
    }
}
