package app.calendariociclismo.android.data.ads

import android.app.Activity
import android.content.Context
import android.util.Log
import app.calendariociclismo.android.BuildConfig
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import com.google.android.ump.ConsentDebugSettings
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Gestiona el consentimiento RGPD (UMP — User Messaging Platform) e inicializa
 * el SDK de Google Mobile Ads una sola vez tras recogerlo.
 *
 * Espejo de `AdsConsentManager.swift` (iOS). La diferencia con iOS es que en
 * Android UMP necesita un [Activity] para poder *presentar* el formulario de
 * consentimiento — por eso `gather` se llama desde `MainActivity` (no desde
 * `Application`), siempre gateado por `PremiumService.shouldShowAds`.
 *
 * **Principio rector (CLAUDE.md):** si el usuario está suscrito
 * (`shouldShowAds == false`), este manager NO se invoca: ni UMP ni
 * `MobileAds.initialize`. Todo cuelga de `shouldShowAds`, nunca de
 * `featuresUnlocked`.
 *
 * **Mensaje de consentimiento:** hasta que el usuario cree el mensaje "European
 * regulations" en el panel de AdMob, `loadAndShowConsentFormIfRequired` no
 * mostrará formulario en Europa; el SDK sirve anuncios igualmente
 * (`canRequestAds` será true). El código queda listo para cuando exista.
 */
object AdsConsentManager {

    private const val TAG = "AdsConsent"

    /** El SDK de Mobile Ads se inicializa una única vez por proceso. */
    private val sdkInitialized = AtomicBoolean(false)

    /**
     * IDs de dispositivos de prueba de AdMob. Con un dispositivo registrado, el
     * SDK sirve los anuncios REALES de la unidad de producción pero etiquetados
     * como "Test Ad" — se pueden tocar sin generar tráfico inválido (Google lo
     * recomienda para QA en dispositivo).
     *
     * Fuentes (se combinan):
     * - Hardcode de **debug**: efectivo solo en builds debug. El ID que el SDK
     *   asigna a un dispositivo depende de la firma del build, por eso el de
     *   debug y el de release difieren.
     * - `BuildConfig.ADS_TEST_DEVICE_ID`: leído de `secrets.properties` (local,
     *   gitignored). Pensado para marcar un dispositivo en un **release local de
     *   QA**. En CI/Play el secreto no existe → cadena vacía → no se marca a
     *   nadie en producción.
     *
     * Cómo obtener el ID: instalar el build, abrir una pantalla con banner y
     * buscar en logcat la línea `Use ...setTestDeviceIds(Arrays.asList("XXXX"))`
     * (y la equivalente de UMP `addTestDeviceHashedId`). Los emuladores ya son
     * dispositivos de prueba automáticamente.
     */
    private val testDeviceIds: List<String>
        get() = buildList {
            if (BuildConfig.DEBUG) {
                // Pixel 9a de Dani (QA físico) — ID de la firma debug.
                add("6994E837FEC747A1C81EAE211D50EDB6")
            }
            // ID inyectado por secrets.properties (QA en release local). Vacío en
            // CI/Play.
            BuildConfig.ADS_TEST_DEVICE_ID
                .takeIf { it.isNotBlank() }
                ?.let { add(it) }
        }

    /**
     * Pide la actualización del estado de consentimiento y, si procede, presenta
     * el formulario. Cuando el flujo termina (con o sin formulario), inicializa
     * el SDK de Mobile Ads si `canRequestAds` lo permite.
     *
     * Debe llamarse en cada arranque (UMP lo recomienda), pero solo cuando
     * `shouldShowAds == true`. Es seguro llamarlo varias veces: la
     * inicialización del SDK está protegida por [sdkInitialized].
     *
     * @param onReady se invoca (en el hilo principal) una vez se puede pedir
     *   anuncios y el SDK está inicializado. Útil para refrescar la UI.
     */
    fun gather(activity: Activity, onReady: () -> Unit = {}) {
        val consentInformation = UserMessagingPlatform.getConsentInformation(activity)
        val paramsBuilder = ConsentRequestParameters.Builder()
        // QA: trata los dispositivos de prueba como EEE para poder ver/forzar el
        // formulario de consentimiento. Vacío en CI/Play → sin efecto en
        // producción. Nota: UMP usa el ID *hasheado* del dispositivo (el que
        // aparece en logcat como `addTestDeviceHashedId`), que coincide con el de
        // `setTestDeviceIds` del SDK de Ads.
        val testIds = testDeviceIds
        if (testIds.isNotEmpty()) {
            val debugSettings = ConsentDebugSettings.Builder(activity)
                .setDebugGeography(ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA)
                .apply { testIds.forEach { addTestDeviceHashedId(it) } }
                .build()
            paramsBuilder.setConsentDebugSettings(debugSettings)
        }
        val params = paramsBuilder.build()

        consentInformation.requestConsentInfoUpdate(
            activity,
            params,
            {
                // Éxito: la info de consentimiento está actualizada. Presenta el
                // formulario si es necesario (no-op si no hay mensaje configurado
                // o si el usuario está fuera del EEE).
                UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { formError ->
                    if (formError != null) {
                        Log.w(TAG, "loadAndShowConsentFormIfRequired: ${formError.message}")
                    }
                    maybeInitializeSdk(activity, consentInformation, onReady)
                }
            },
            { requestError ->
                // Fallo al actualizar (sin red, etc.). Intentamos inicializar
                // igualmente: si había un consentimiento previo persistido,
                // canRequestAds puede seguir siendo true.
                Log.w(TAG, "requestConsentInfoUpdate falló: ${requestError.message}")
                maybeInitializeSdk(activity, consentInformation, onReady)
            },
        )
    }

    /**
     * Indica si actualmente puede solicitarse el formulario de opciones de
     * privacidad (para exponer un punto de entrada en Ajustes, si se decide).
     * Hoy no se usa en UI; se deja por paridad con iOS y uso futuro.
     */
    fun isPrivacyOptionsRequired(context: Context): Boolean =
        UserMessagingPlatform.getConsentInformation(context)
            .privacyOptionsRequirementStatus ==
            ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED

    private fun maybeInitializeSdk(
        context: Context,
        consentInformation: ConsentInformation,
        onReady: () -> Unit,
    ) {
        if (!consentInformation.canRequestAds()) {
            Log.i(TAG, "canRequestAds=false — no se inicializa el SDK de Ads")
            return
        }
        if (sdkInitialized.compareAndSet(false, true)) {
            // Marca los dispositivos de QA como test devices para poder
            // interactuar con anuncios reales sin tráfico inválido. La lista está
            // vacía en CI/Play (ver `testDeviceIds`), así que producción no marca
            // a nadie.
            val testIds = testDeviceIds
            if (testIds.isNotEmpty()) {
                MobileAds.setRequestConfiguration(
                    RequestConfiguration.Builder()
                        .setTestDeviceIds(testIds)
                        .build(),
                )
            }
            MobileAds.initialize(context.applicationContext) {
                Log.i(TAG, "MobileAds inicializado")
                onReady()
            }
        } else {
            // Ya inicializado en un arranque anterior dentro de este proceso.
            onReady()
        }
    }
}
