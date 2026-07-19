package app.calendariociclismo.android.data.premium

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.acknowledgePurchase
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.min
import kotlin.math.pow

/**
 * Envoltorio fino sobre [BillingClient] de Google Play Billing Library 7.x.
 *
 * Responsabilidades:
 *  - Mantener una conexión persistente con el servicio de billing y reconectar
 *    con backoff exponencial cuando se cae.
 *  - Consultar el detalle del producto Premium (`premium`) y sus dos base
 *    plans (`monthly`, `yearly`) — el SKU es uno solo en Play Console.
 *  - Disparar el flujo de compra desde el Activity actual.
 *  - Comprobar al arranque y bajo demanda si el usuario tiene una suscripción
 *    activa, y propagarlo vía [onSubscriptionStateChanged].
 *  - Ack-eatear (`acknowledgePurchase`) toda compra nueva — obligatorio en 72 h
 *    o Google Play reembolsa automáticamente.
 *
 * El [BillingClient] se crea con application context y vive en el `appScope`
 * del proceso. `launchBillingFlow` sí requiere un [Activity], que recibe como
 * parámetro de [launchPurchase].
 */
class BillingManager(
    context: Context,
    private val scope: CoroutineScope,
    private val onSubscriptionStateChanged: (active: Boolean) -> Unit,
    private val onPurchaseSuccess: (plan: String?, productId: String) -> Unit = { _, _ -> },
    private val onPurchaseError: (plan: String?, message: String) -> Unit = { _, _ -> },
) : PurchasesUpdatedListener, BillingClientStateListener {

    enum class PurchaseOutcome { SUCCESS, USER_CANCELED, PENDING, ERROR }

    data class Plan(
        val basePlanId: String,
        val offerToken: String,
        val formattedPrice: String,
        val priceAmountMicros: Long,
        val priceCurrencyCode: String,
        val billingPeriod: String,
        val hasFreeTrial: Boolean,
        val freeTrialPeriod: String?,
    )

    private val appContext: Context = context.applicationContext

    private val billingClient: BillingClient = BillingClient.newBuilder(appContext)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .build(),
        )
        .build()

    private val _productDetails = MutableStateFlow<ProductDetails?>(null)

    private val _plans = MutableStateFlow<List<Plan>>(emptyList())
    val plans: StateFlow<List<Plan>> = _plans.asStateFlow()

    private val _isPurchasing = MutableStateFlow(false)
    val isPurchasing: StateFlow<Boolean> = _isPurchasing.asStateFlow()

    private val _purchaseError = MutableStateFlow<String?>(null)
    val purchaseError: StateFlow<String?> = _purchaseError.asStateFlow()

    private var reconnectAttempts = 0

    /**
     * Base plan ID del último flujo de compra lanzado. Sirve para etiquetar los
     * eventos de analytics `purchase_success`/`purchase_error` con el plan
     * (`monthly`/`yearly`), porque el objeto [Purchase] solo expone el product ID
     * (`premium`), no el base plan.
     */
    private var pendingBasePlanId: String? = null

    /**
     * Inicia la conexión con Google Play. Idempotente — si ya está conectado
     * vuelve a disparar la query de productos y de compras activas. Se llama
     * desde [PremiumService.bootstrap] al crearse el Application.
     */
    fun start() {
        if (billingClient.isReady) {
            scope.launch { refreshAfterConnected() }
            return
        }
        billingClient.startConnection(this)
    }

    override fun onBillingSetupFinished(result: BillingResult) {
        if (result.responseCode == BillingClient.BillingResponseCode.OK) {
            reconnectAttempts = 0
            scope.launch { refreshAfterConnected() }
        } else {
            Log.w(TAG, "Billing setup falló: ${result.responseCode} ${result.debugMessage}")
            scheduleReconnect()
        }
    }

    override fun onBillingServiceDisconnected() {
        Log.w(TAG, "Billing desconectado")
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Log.w(TAG, "Máximo de reintentos de billing alcanzado ($MAX_RECONNECT_ATTEMPTS).")
            return
        }
        val delayMs = min(60_000L, (1000L * 2.0.pow(reconnectAttempts.toDouble()).toLong()))
        reconnectAttempts++
        scope.launch {
            delay(delayMs)
            if (!billingClient.isReady) billingClient.startConnection(this@BillingManager)
        }
    }

    private suspend fun refreshAfterConnected() {
        queryProducts()
        queryActiveSubscription()
    }

    private suspend fun queryProducts() {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build(),
                ),
            )
            .build()
        val result = withContext(Dispatchers.IO) { billingClient.queryProductDetails(params) }
        val billingResult = result.billingResult
        if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "queryProductDetails falló: ${billingResult.responseCode} ${billingResult.debugMessage}")
            return
        }
        val details = result.productDetailsList?.firstOrNull { it.productId == PRODUCT_ID } ?: run {
            Log.w(TAG, "Subscription product '$PRODUCT_ID' no encontrado en Play Console.")
            return
        }
        _productDetails.value = details
        _plans.value = extractPlans(details)
    }

    private fun extractPlans(details: ProductDetails): List<Plan> {
        val offers = details.subscriptionOfferDetails ?: return emptyList()
        // Preferir la oferta con trial para cada basePlanId (si existe).
        val byBasePlan = offers.groupBy { it.basePlanId }
        return byBasePlan.mapNotNull { (basePlanId, list) ->
            val withTrial = list.firstOrNull { offer ->
                offer.pricingPhases.pricingPhaseList.any { it.priceAmountMicros == 0L }
            }
            val chosen = withTrial ?: list.firstOrNull() ?: return@mapNotNull null
            val phases = chosen.pricingPhases.pricingPhaseList
            val trialPhase = phases.firstOrNull { it.priceAmountMicros == 0L }
            val pricingPhase = phases.firstOrNull { it.priceAmountMicros > 0L } ?: phases.last()
            Plan(
                basePlanId = basePlanId,
                offerToken = chosen.offerToken,
                formattedPrice = pricingPhase.formattedPrice,
                priceAmountMicros = pricingPhase.priceAmountMicros,
                priceCurrencyCode = pricingPhase.priceCurrencyCode,
                billingPeriod = pricingPhase.billingPeriod,
                hasFreeTrial = trialPhase != null,
                freeTrialPeriod = trialPhase?.billingPeriod,
            )
        }
    }

    /** Devuelve el `Plan` para un base plan ID o null si no se ha cargado todavía. */
    fun planFor(basePlanId: String): Plan? = _plans.value.firstOrNull { it.basePlanId == basePlanId }

    /**
     * Lanza el sheet nativo de Google Play para suscribirse al [basePlanId].
     * Requiere que `queryProducts` haya completado antes — si no, devuelve
     * `ERROR` con mensaje al usuario y dispara una nueva query.
     */
    fun launchPurchase(activity: Activity, basePlanId: String): PurchaseOutcome {
        if (!billingClient.isReady) {
            _purchaseError.value = "Conectando con Google Play, vuelve a intentarlo en unos segundos."
            start()
            return PurchaseOutcome.ERROR
        }
        val details = _productDetails.value ?: run {
            _purchaseError.value = "Producto no disponible. Inténtalo más tarde."
            scope.launch { queryProducts() }
            return PurchaseOutcome.ERROR
        }
        val plan = planFor(basePlanId) ?: run {
            _purchaseError.value = "Plan no disponible."
            return PurchaseOutcome.ERROR
        }
        pendingBasePlanId = basePlanId
        val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(details)
                        .setOfferToken(plan.offerToken)
                        .build(),
                ),
            )
            .build()
        _isPurchasing.value = true
        _purchaseError.value = null
        val result = billingClient.launchBillingFlow(activity, flowParams)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            _isPurchasing.value = false
            _purchaseError.value = friendlyError(result)
            return PurchaseOutcome.ERROR
        }
        return PurchaseOutcome.SUCCESS
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        _isPurchasing.value = false
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                purchases?.forEach { processPurchase(it) }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                // No mostramos error — el usuario cerró el sheet.
            }
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                // El usuario ya tiene una suscripción activa; refrescamos el estado.
                scope.launch { queryActiveSubscription() }
            }
            else -> {
                val message = friendlyError(result)
                _purchaseError.value = message
                onPurchaseError(pendingBasePlanId, message)
            }
        }
    }

    private fun processPurchase(purchase: Purchase) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        if (purchase.products.none { it == PRODUCT_ID }) return
        onSubscriptionStateChanged(true)
        onPurchaseSuccess(pendingBasePlanId, PRODUCT_ID)
        if (!purchase.isAcknowledged) {
            scope.launch { acknowledge(purchase.purchaseToken) }
        }
    }

    private suspend fun acknowledge(purchaseToken: String) {
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchaseToken)
            .build()
        val result = withContext(Dispatchers.IO) { billingClient.acknowledgePurchase(params) }
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "acknowledgePurchase falló: ${result.responseCode} ${result.debugMessage}")
        }
    }

    /**
     * Consulta a Google Play si hay suscripciones activas para [PRODUCT_ID]
     * y propaga el resultado vía [onSubscriptionStateChanged]. Se llama:
     *  - Al conectar (sincroniza el flag local con la realidad de Play).
     *  - Desde `PremiumService.restorePurchases` (acción manual del usuario).
     *
     * Devuelve `true` si encontró al menos una compra `PURCHASED` activa.
     */
    suspend fun queryActiveSubscription(): Boolean {
        if (!billingClient.isReady) {
            // Si todavía no estamos listos, deja que onBillingSetupFinished lo dispare cuando lo esté.
            return false
        }
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()
        val result = withContext(Dispatchers.IO) { billingClient.queryPurchasesAsync(params) }
        val billingResult = result.billingResult
        if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "queryPurchasesAsync falló: ${billingResult.responseCode} ${billingResult.debugMessage}")
            return false
        }
        val active = result.purchasesList.firstOrNull { purchase ->
            purchase.products.any { it == PRODUCT_ID } &&
                purchase.purchaseState == Purchase.PurchaseState.PURCHASED
        }
        if (active != null) {
            onSubscriptionStateChanged(true)
            if (!active.isAcknowledged) acknowledge(active.purchaseToken)
            return true
        }
        // Sin compras activas — desactivamos el flag (cubre el caso de
        // suscripción cancelada o expirada que persistió en DataStore).
        onSubscriptionStateChanged(false)
        return false
    }

    /** Limpia el último error mostrado en la paywall (al cerrar el alert). */
    fun clearPurchaseError() {
        _purchaseError.value = null
    }

    private fun friendlyError(result: BillingResult): String = when (result.responseCode) {
        BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
        BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE,
        BillingClient.BillingResponseCode.NETWORK_ERROR ->
            "Sin conexión con Google Play. Inténtalo más tarde."
        BillingClient.BillingResponseCode.BILLING_UNAVAILABLE ->
            "Google Play Billing no está disponible en este dispositivo."
        BillingClient.BillingResponseCode.ITEM_UNAVAILABLE ->
            "Este plan no está disponible ahora mismo."
        BillingClient.BillingResponseCode.DEVELOPER_ERROR ->
            "Error de configuración. Vuelve a abrir la app y prueba de nuevo."
        else -> "No se pudo completar la compra (${result.responseCode})."
    }

    companion object {
        private const val TAG = "BillingManager"
        const val PRODUCT_ID = "premium"
        const val BASE_PLAN_MONTHLY = "monthly"
        const val BASE_PLAN_YEARLY = "yearly"
        private const val MAX_RECONNECT_ATTEMPTS = 6
    }
}
