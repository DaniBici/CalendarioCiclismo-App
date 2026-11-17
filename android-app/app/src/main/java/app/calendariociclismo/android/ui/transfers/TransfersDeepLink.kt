package app.calendariociclismo.android.ui.transfers

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Equipo del mercado pedido por un enlace profundo (`DeepLink.Team`), a la
 * espera de que Fichajes lo abra. `MainActivity` lleva la navegación a la
 * pestaña Fichajes y deja aquí el id; `TransfersScreen` lo consume cuando
 * conoce su disposición: en lista con detalle (tablets) selecciona el equipo en
 * el detalle y, en una columna (teléfonos), empuja la ruta del equipo. Espejo de
 * `transfersTeamId` en `ContentView` (iOS).
 */
object TransfersDeepLink {
    private val pending = MutableStateFlow<String?>(null)
    val pendingTeamId: StateFlow<String?> = pending.asStateFlow()

    fun open(teamId: String) {
        pending.value = teamId
    }

    /** Retira el equipo pendiente solo si sigue siendo [teamId]. */
    fun consume(teamId: String) {
        pending.compareAndSet(teamId, null)
    }
}
