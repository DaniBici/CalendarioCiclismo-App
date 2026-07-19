package app.calendariociclismo.android.util

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.onStart

/**
 * Helper para comprobar conectividad a internet (cualquier transporte: WiFi,
 * celular, ethernet).
 *
 * Expone dos APIs:
 *   - [isOnline]: chequeo síncrono puntual, usado al tocar un enlace externo
 *     o un asset R2 no cacheado para decidir entre abrir Custom Tabs (hay red)
 *     o mostrar un modal "sin conexión" (no hay).
 *   - [online]: `Flow<Boolean>` reactivo que emite el estado actual y se
 *     actualiza cuando cambia la red disponible. La vista Hoy lo usa para
 *     recargar automáticamente cuando el usuario recupera la conexión.
 */
object NetworkMonitor {

    /**
     * `true` si el dispositivo tiene una red con capacidad de internet.
     * El chequeo es síncrono y puntual — no observa cambios.
     */
    fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val network: Network = cm.activeNetwork ?: return false
        val caps: NetworkCapabilities = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /**
     * Flow reactivo del estado de conectividad. Emite el valor actual al
     * suscribirse y uno nuevo cada vez que cambia. Se apoya en
     * `ConnectivityManager.registerNetworkCallback` — el callback se libera al
     * cancelar la colección del flow.
     */
    fun online(context: Context): Flow<Boolean> {
        val appContext = context.applicationContext
        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        if (cm == null) {
            return callbackFlow<Boolean> {
                trySend(false)
                awaitClose { }
            }
        }

        return callbackFlow {
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { trySend(true) }
                override fun onLost(network: Network) { trySend(isOnline(appContext)) }
                override fun onUnavailable() { trySend(false) }
                override fun onCapabilitiesChanged(
                    network: Network,
                    networkCapabilities: NetworkCapabilities,
                ) {
                    trySend(networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
                }
            }
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            cm.registerNetworkCallback(request, callback)

            awaitClose {
                runCatching { cm.unregisterNetworkCallback(callback) }
            }
        }
            .onStart { emit(isOnline(appContext)) }
            .distinctUntilChanged()
    }
}
