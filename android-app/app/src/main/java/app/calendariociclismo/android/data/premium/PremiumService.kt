package app.calendariociclismo.android.data.premium

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import app.calendariociclismo.android.BuildConfig
import app.calendariociclismo.android.data.analytics.AnalyticsService
import app.calendariociclismo.android.data.prefs.AppPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Servicio centralizado del estado Premium de la app (equivalente Android de
 * `PremiumService.swift`).
 *
 * **Fase 6:** conectado a Google Play Billing Library 7.x mediante
 * [BillingManager]. El flag [isSubscribed] se persiste localmente en DataStore
 * pero su valor lo dicta el resultado de `queryPurchasesAsync` contra Google
 * Play — si Play dice que no hay suscripción activa, el flag se desactiva
 * automáticamente al arrancar (cubre cancelaciones / expiraciones).
 *
 * En builds Debug el toggle [debugSetSubscribed] permite activar/desactivar
 * el flag sin pasar por Billing (probar features Premium sin tester
 * accounts).
 */
class PremiumService(
    private val context: Context,
    private val preferences: AppPreferences,
    private val analytics: AnalyticsService,
    private val scope: CoroutineScope,
) {

    /** Origen del CTA que dispara el paywall. Determina el copy en `PaywallScreen`. */
    enum class PaywallSource {
        REGION,
        NOTIFICATIONS,
        RACE_CARDS,
        RACE_NOTIFICATIONS,
        GENERAL,
    }

    /**
     * Plan de suscripción. El [basePlanId] coincide con el configurado en
     * Google Play Console dentro del subscription product `premium`.
     */
    enum class PremiumPlan(val basePlanId: String) {
        MONTHLY(BillingManager.BASE_PLAN_MONTHLY),
        YEARLY(BillingManager.BASE_PLAN_YEARLY),
    }

    private val billing = BillingManager(
        context = context,
        scope = scope,
        onSubscriptionStateChanged = { active ->
            // Con PREMIUM_TEST_BUILD activo NO permitimos que Billing baje el flag
            // a false: las builds de Internal Testing tienen Premium forzado.
            if (BuildConfig.PREMIUM_TEST_BUILD && !active) return@BillingManager
            scope.launch { preferences.setPremiumSubscribed(active) }
        },
        // Paridad con iOS (`PremiumService.swift`): eventos de embudo de compra
        // para GA4/Firebase Console. Solo se disparan en el flujo real de Billing
        // (Release), nunca en Debug/PREMIUM_TEST_BUILD (que cortocircuitan antes
        // de `billing.launchPurchase`).
        onPurchaseSuccess = { plan, productId ->
            analytics.logEvent("purchase_success", Bundle().apply {
                plan?.let { putString("plan", it) }
                putString("product_id", productId)
            })
        },
        onPurchaseError = { plan, message ->
            analytics.logEvent("purchase_error", Bundle().apply {
                plan?.let { putString("plan", it) }
                putString("error", message)
            })
        },
    )

    /**
     * StateFlow del estado real de suscripción. Su valor lo dicta Google Play
     * Billing vía [BillingManager] (persistido en DataStore). A partir del
     * modelo con anuncios, suscrito significa **sin anuncios** — NO desbloquea
     * features (todas se liberaron al plan gratuito, commit `ea0674292da`).
     */
    val isSubscribed: StateFlow<Boolean> = preferences.premiumSubscribed
        .stateIn(scope, SharingStarted.Eagerly, initialValue = false)

    /**
     * Las features que en su día fueron Premium son gratis para siempre
     * (política de pricing del CLAUDE.md). Los gates de feature leen ESTA
     * constante, NUNCA [isSubscribed]. Mantenerlas desacopladas permite que
     * [isSubscribed] recupere su único significado: la suscripción quita ads.
     */
    val featuresUnlocked: Boolean = true

    /**
     * "AdGate": único significado de la suscripción a partir del modelo con
     * anuncios. Suscrito → sin anuncios. La capa de ads consulta esto antes de
     * inicializar el SDK / mostrar unidades.
     */
    val shouldShowAds: StateFlow<Boolean> = isSubscribed
        .map { !it }
        .stateIn(scope, SharingStarted.Eagerly, initialValue = true)

    private val _pendingPaywallSource = MutableStateFlow<PaywallSource?>(null)

    /** Origen del paywall que está siendo solicitado. NULL = paywall cerrado. */
    val pendingPaywallSource: StateFlow<PaywallSource?> = _pendingPaywallSource.asStateFlow()

    /** Plans cargados desde Google Play (precios reales, base plans). Vacío hasta que `queryProducts` resuelva. */
    val plans: StateFlow<List<BillingManager.Plan>> = billing.plans

    /** `true` mientras hay una compra en curso (sheet de Play abierto o ACK en marcha). */
    val isPurchasing: StateFlow<Boolean> = billing.isPurchasing

    /** Último error de compra para mostrar en alerta. NULL = sin error. */
    val purchaseError: StateFlow<String?> = billing.purchaseError

    init {
        // PREMIUM_TEST_BUILD — fuerza el flag a true antes de arrancar Billing
        // para que la primera lectura del StateFlow (y cualquier UI que se
        // monte mientras `queryActiveSubscription` está en vuelo) ya vea
        // Premium activo.
        if (BuildConfig.PREMIUM_TEST_BUILD) {
            scope.launch { preferences.setPremiumSubscribed(true) }
        }
        // Sincroniza el flag con Google Play al arrancar.
        billing.start()
    }

    // MARK: - Paywall presentation

    /** Solicita presentar la paywall con el [source] indicado. */
    fun presentPaywall(source: PaywallSource) {
        _pendingPaywallSource.value = source
        analytics.logEvent("paywall_view", Bundle().apply {
            putString("source", source.name.lowercase())
        })
    }

    /** Cierra la paywall actual. Llamado desde `PaywallScreen` al hacer back/X o tras suscribirse. */
    fun dismissPaywall() {
        _pendingPaywallSource.value = null
    }

    // MARK: - Compra

    /**
     * Inicia el flujo de compra del plan indicado.
     *
     * En **Debug** activa [isSubscribed] localmente sin pasar por Billing — útil
     * para probar features Premium sin tester accounts.
     * En **Release** lanza el sheet nativo de Google Play. El resultado llega
     * por callback en [BillingManager.onPurchasesUpdated] y actualiza
     * [isSubscribed] al confirmarse.
     */
    fun subscribe(activity: Activity, plan: PremiumPlan) {
        analytics.logEvent("paywall_subscribe_tap", Bundle().apply {
            putString("plan", plan.name.lowercase())
            putString("source", _pendingPaywallSource.value?.name?.lowercase() ?: "unknown")
        })
        // Con PREMIUM_TEST_BUILD activo no abrimos el sheet de Google Play
        // (la cuenta del tester no debería ver un cargo). El flag ya está a
        // true desde el init y la paywall se cierra sola por `onChange`.
        if (BuildConfig.DEBUG || BuildConfig.PREMIUM_TEST_BUILD) {
            scope.launch { preferences.setPremiumSubscribed(true) }
            return
        }
        billing.launchPurchase(activity, plan.basePlanId)
    }

    /**
     * Restaura compras previas de la cuenta Google actual.
     *
     * Consulta `queryPurchasesAsync` y actualiza [isSubscribed] si encuentra
     * una suscripción activa. Devuelve `true` si la restauración tuvo éxito.
     */
    suspend fun restorePurchases(): Boolean {
        analytics.logEvent("paywall_restore_tap", null)
        // Con PREMIUM_TEST_BUILD el flag está clavado a true; nunca consultamos
        // a Billing (la cuenta de Google no tiene una sub real asociada).
        if (BuildConfig.PREMIUM_TEST_BUILD) return true
        if (BuildConfig.DEBUG) return preferences.snapshotPremiumSubscribed()
        val restored = billing.queryActiveSubscription()
        if (restored) analytics.logEvent("restore_success", null)
        return restored
    }

    /**
     * Cancela la suscripción actual.
     *
     * **Debug:** desactiva [isSubscribed] directamente.
     * **Release:** abre la pantalla nativa del Play Store de gestión de
     * suscripciones (deeplink directo al producto). La cancelación real la
     * gestiona Google.
     */
    fun cancelSubscription() {
        // Con PREMIUM_TEST_BUILD activo el flag está clavado a true: no
        // exponemos ni el deeplink al Play Store (no hay sub real que cancelar)
        // ni el toggle de Debug deja apagar el flag.
        if (BuildConfig.PREMIUM_TEST_BUILD) return
        if (BuildConfig.DEBUG) {
            scope.launch { preferences.setPremiumSubscribed(false) }
            return
        }
        val packageName = context.packageName
        val uri = Uri.parse(
            "https://play.google.com/store/account/subscriptions" +
                "?sku=${BillingManager.PRODUCT_ID}&package=$packageName",
        )
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(intent) }
    }

    /** Limpia el último error de compra (al cerrar el alert desde la paywall). */
    fun clearPurchaseError() {
        billing.clearPurchaseError()
    }

    /**
     * Abre Play Store en la pantalla de canjeo de códigos promocionales.
     *
     * Google no expone una API directa para introducir el código desde dentro
     * de la app, así que enviamos al usuario a la URL oficial de redención
     * (`https://play.google.com/redeem?code=`). Play Store la intercepta y
     * muestra el formulario nativo. Cuando vuelve a la app, el cambio de
     * suscripción se refleja en [isSubscribed] vía `queryActiveSubscription`
     * (la siguiente vez que se conecte al servicio o se llame a
     * `restorePurchases`).
     *
     * En builds Debug simulamos el canjeo activando el flag directamente.
     */
    fun redeemCode() {
        analytics.logEvent("paywall_redeem_code_tap", Bundle().apply {
            putString("source", _pendingPaywallSource.value?.name?.lowercase() ?: "settings")
        })
        if (BuildConfig.PREMIUM_TEST_BUILD) return
        if (BuildConfig.DEBUG) {
            scope.launch { preferences.setPremiumSubscribed(true) }
            return
        }
        val uri = Uri.parse("https://play.google.com/redeem?code=")
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            setPackage("com.android.vending")
        }
        runCatching { context.startActivity(intent) }.onFailure {
            // Fallback: si Play Store no está instalado, abrir el navegador.
            val fallback = Intent(Intent.ACTION_VIEW, uri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            runCatching { context.startActivity(fallback) }
        }
    }

    // MARK: - Debug helpers

    /**
     * Toggle manual del flag Premium. Solo se compila en builds Debug
     * (BuildConfig.DEBUG = true). En Release el toggle no se renderiza
     * en UI y este método no hace nada.
     */
    fun debugSetSubscribed(value: Boolean) {
        if (!BuildConfig.DEBUG) return
        // Con PREMIUM_TEST_BUILD activo el flag siempre va a quedarse en true
        // aunque alguien pulse el toggle "off". Si en el futuro convivieran
        // ambos en una build (poco probable porque el flag va solo en Release),
        // el toggle no sirve para nada.
        if (BuildConfig.PREMIUM_TEST_BUILD && !value) return
        scope.launch { preferences.setPremiumSubscribed(value) }
    }
}
