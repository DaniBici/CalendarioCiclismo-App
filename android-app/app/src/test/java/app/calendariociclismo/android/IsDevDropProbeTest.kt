package app.calendariociclismo.android

import app.calendariociclismo.android.data.model.StartlistTeam
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Sonda puntual: comprueba que el modelo de Android sobrevive a la desaparición
 * de la columna "isDev" (migración 128, DROP COLUMN).
 *
 * Es el contraste del mismo caso en iOS, donde el DTO <4.0 declaraba
 * `let isDev: Bool` NO opcional y el decode falla con keyNotFound al faltar la
 * clave — de ahí que la 128 tenga que ir DESPUÉS de publicar la 4.0.
 */
class IsDevDropProbeTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodifica cuando la columna isDev YA NO viene (post-DROP)`() {
        val payload = """
            {"id":"t1","raceId":"r1","teamName":"UAE Development Team",
             "sortOrder":1,"teamId":"team_devo_uae_fem","isConfirmed":true}
        """.trimIndent()

        val team = json.decodeFromString<StartlistTeam>(payload)

        assertEquals("UAE Development Team", team.teamName)
        // Sin sufijo "(Devo)": el filial se distingue por su ficha propia.
        assertEquals("UAE Development Team", team.displayName)
    }

    @Test
    fun `decodifica cuando la columna isDev TODAVIA viene (pre-DROP)`() {
        val payload = """
            {"id":"t1","raceId":"r1","teamName":"UAE Development Team",
             "sortOrder":1,"teamId":"team_devo_uae_fem","isDev":false,"isConfirmed":true}
        """.trimIndent()

        val team = json.decodeFromString<StartlistTeam>(payload)

        assertEquals("UAE Development Team", team.displayName)
    }
}
