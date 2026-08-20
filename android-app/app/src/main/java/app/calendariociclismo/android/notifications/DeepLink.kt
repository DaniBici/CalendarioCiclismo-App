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
        val TAB_NAMES = setOf("today", "month", "season", "transfers", "search", "subscribe", "notifications")

        /**
         * Regex para IDs de carrera/etapa. Solo se aceptan caracteres alfanuméricos,
         * guiones y guiones bajos para prevenir inyección de rutas.
         */
        private val VALID_ID_REGEX = Regex("^[a-zA-Z0-9_-]+$")

        fun parse(value: String?): DeepLink? {
            if (value.isNullOrEmpty()) return null
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
         *   - `calendariociclismo://tab/{name}`      → `Tab(name)`
         *   - `calendariociclismo://{tabName}`       → `Tab(tabName)` (forma corta)
         *
         * Reconstruye la forma que entiende `parse(String?)` para mantener una
         * única fuente de verdad y misma validación de IDs.
         */
        fun fromUri(uri: Uri?): DeepLink? {
            if (uri == null) return null
            if (uri.scheme != "calendariociclismo") return null
            val host = uri.host ?: return null
            if (host.isEmpty()) return null
            val firstSegment = uri.pathSegments.firstOrNull().orEmpty()

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
