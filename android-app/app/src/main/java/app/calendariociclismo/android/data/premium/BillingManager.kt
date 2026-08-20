package app.calendariociclismo.android.data.premium

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.acknowledgePurchase
import com.android.billingclient.api.consumePurchase
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
 * Google Play Billing para el modelo 4.3:
 * - `amigo`: suscripción voluntaria mensual/anual.
 * - `aportacion_*`: aportaciones puntuales consumibles.
 * - `premium`: producto retirado; solo se consulta para convertir una compra
 *   todavía activa en el reconocimiento permanente de Fundador.
 */
class BillingManager(
    context: Context,
    private val scope: CoroutineScope,
    private val onFriendStateChanged: (Boolean) -> Unit,
    private val onLegacyPremiumStateChanged: (Boolean) -> Unit,
    private val onFounderDetected: () -> Unit,
    private val onContributionSuccess: (String) -> Unit,
    private val onPurchaseSuccess: (plan: String?, productId: String) -> Unit = { _, _ -> },
    private val onPurchaseError: (plan: String?, message: String) -> Unit = { _, _ -> },
) : PurchasesUpdatedListener, BillingClientStateListener {

    enum class PurchaseOutcome { SUCCESS, ERROR }

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

    data class Contribution(
        val productId: String,
        val formattedPrice: String,
        val priceAmountMicros: Long,
        val priceCurrencyCode: String,
    )

    private val appContext = context.applicationContext
    private val billingClient = BillingClient.newBuilder(appContext)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
        )
        .build()

    private var friendDetails: ProductDetails? = null
    private val contributionDetails = mutableMapOf<String, ProductDetails>()

    private val _plans = MutableStateFlow<List<Plan>>(emptyList())
    val plans: StateFlow<List<Plan>> = _plans.asStateFlow()

    private val _contributions = MutableStateFlow<List<Contribution>>(emptyList())
    val contributions: StateFlow<List<Contribution>> = _contributions.asStateFlow()

    private val _isPurchasing = MutableStateFlow(false)
    val isPurchasing: StateFlow<Boolean> = _isPurchasing.asStateFlow()

    private val _purchaseError = MutableStateFlow<String?>(null)
    val purchaseError: StateFlow<String?> = _purchaseError.asStateFlow()

    private val _purchaseStateReady = MutableStateFlow(false)
    val purchaseStateReady: StateFlow<Boolean> = _purchaseStateReady.asStateFlow()

    private var reconnectAttempts = 0
    private var pendingPlanId: String? = null
    private var pendingProductId: String? = null

    fun start() {
        if (billingClient.isReady) {
            scope.launch { refreshAfterConnected() }
        } else {
            billingClient.startConnection(this)
        }
    }

    override fun onBillingSetupFinished(result: BillingResult) {
        if (result.responseCode == BillingClient.BillingResponseCode.OK) {
            reconnectAttempts = 0
            scope.launch { refreshAfterConnected() }
        } else {
            Log.w(TAG, "Billing setup falló: ${result.responseCode} ${result.debugMessage}")
            _purchaseStateReady.value = true
            scheduleReconnect()
        }
    }

    override fun onBillingServiceDisconnected() {
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return
        val delayMs = min(60_000L, 1000L * 2.0.pow(reconnectAttempts.toDouble()).toLong())
        reconnectAttempts++
        scope.launch {
            delay(delayMs)
            if (!billingClient.isReady) billingClient.startConnection(this@BillingManager)
        }
    }

    private suspend fun refreshAfterConnected() {
        querySubscriptionProduct()
        queryContributionProducts()
        queryPurchases()
    }

    private suspend fun querySubscriptionProduct() {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(FRIEND_PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build(),
                ),
            )
            .build()
        val result = withContext(Dispatchers.IO) { billingClient.queryProductDetails(params) }
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) return
        val details = result.productDetailsList?.firstOrNull() ?: return
        friendDetails = details
        _plans.value = extractPlans(details)
    }

    private suspend fun queryContributionProducts() {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(CONTRIBUTION_PRODUCT_IDS.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            })
            .build()
        val result = withContext(Dispatchers.IO) { billingClient.queryProductDetails(params) }
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) return
        contributionDetails.clear()
        result.productDetailsList.orEmpty().forEach { contributionDetails[it.productId] = it }
        _contributions.value = contributionDetails.values.mapNotNull { details ->
            details.oneTimePurchaseOfferDetails?.let { offer ->
                Contribution(details.productId, offer.formattedPrice, offer.priceAmountMicros, offer.priceCurrencyCode)
            }
        }.sortedBy { it.priceAmountMicros }
    }

    private fun extractPlans(details: ProductDetails): List<Plan> {
        return details.subscriptionOfferDetails.orEmpty()
            .groupBy { it.basePlanId }
            .mapNotNull { (basePlanId, offers) ->
                val chosen = offers.firstOrNull { offer ->
                    offer.pricingPhases.pricingPhaseList.any { it.priceAmountMicros == 0L }
                } ?: offers.firstOrNull() ?: return@mapNotNull null
                val phases = chosen.pricingPhases.pricingPhaseList
                val trial = phases.firstOrNull { it.priceAmountMicros == 0L }
                val paid = phases.firstOrNull { it.priceAmountMicros > 0L } ?: return@mapNotNull null
                Plan(
                    basePlanId,
                    chosen.offerToken,
                    paid.formattedPrice,
                    paid.priceAmountMicros,
                    paid.priceCurrencyCode,
                    paid.billingPeriod,
                    trial != null,
                    trial?.billingPeriod,
                )
            }
    }

    fun launchSubscription(activity: Activity, basePlanId: String): PurchaseOutcome {
        val details = friendDetails ?: return unavailable("La membresía no está disponible ahora mismo.")
        val plan = _plans.value.firstOrNull { it.basePlanId == basePlanId }
            ?: return unavailable("Este plan no está disponible ahora mismo.")
        pendingPlanId = basePlanId
        pendingProductId = FRIEND_PRODUCT_ID
        return launch(
            activity,
            BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .setOfferToken(plan.offerToken)
                .build(),
        )
    }

    fun launchContribution(activity: Activity, productId: String): PurchaseOutcome {
        val details = contributionDetails[productId]
            ?: return unavailable("Esta aportación no está disponible ahora mismo.")
        pendingPlanId = null
        pendingProductId = productId
        return launch(
            activity,
            BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .build(),
        )
    }

    private fun launch(
        activity: Activity,
        detailsParams: BillingFlowParams.ProductDetailsParams,
    ): PurchaseOutcome {
        if (!billingClient.isReady) {
            start()
            return unavailable("Conectando con Google Play. Vuelve a intentarlo en unos segundos.")
        }
        _isPurchasing.value = true
        _purchaseError.value = null
        val result = billingClient.launchBillingFlow(
            activity,
            BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(detailsParams))
                .build(),
        )
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            _isPurchasing.value = false
            return unavailable(friendlyError(result))
        }
        return PurchaseOutcome.SUCCESS
    }

    private fun unavailable(message: String): PurchaseOutcome {
        _purchaseError.value = message
        return PurchaseOutcome.ERROR
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        _isPurchasing.value = false
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach(::processPurchase)
            BillingClient.BillingResponseCode.USER_CANCELED -> Unit
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> scope.launch { queryPurchases() }
            else -> {
                val message = friendlyError(result)
                _purchaseError.value = message
                onPurchaseError(pendingPlanId, message)
            }
        }
    }

    private fun processPurchase(purchase: Purchase) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        when {
            purchase.products.contains(FRIEND_PRODUCT_ID) -> {
                onFriendStateChanged(true)
                onPurchaseSuccess(pendingPlanId, FRIEND_PRODUCT_ID)
                if (!purchase.isAcknowledged) scope.launch { acknowledge(purchase.purchaseToken) }
            }
            purchase.products.contains(LEGACY_PREMIUM_PRODUCT_ID) -> {
                onLegacyPremiumStateChanged(true)
                onFounderDetected()
                if (!purchase.isAcknowledged) scope.launch { acknowledge(purchase.purchaseToken) }
            }
            purchase.products.any { it in CONTRIBUTION_PRODUCT_IDS } -> {
                val id = purchase.products.first { it in CONTRIBUTION_PRODUCT_IDS }
                onContributionSuccess(id)
                onPurchaseSuccess(null, id)
                scope.launch { consume(purchase.purchaseToken) }
            }
        }
    }

    suspend fun queryPurchases(): Boolean {
        if (!billingClient.isReady) {
            _purchaseStateReady.value = true
            return false
        }
        val subscriptions = withContext(Dispatchers.IO) {
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build(),
            )
        }
        if (subscriptions.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            _purchaseStateReady.value = true
            return false
        }

        var friendActive = false
        var legacyActive = false
        subscriptions.purchasesList.forEach { purchase ->
            if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return@forEach
            if (purchase.products.contains(FRIEND_PRODUCT_ID)) {
                friendActive = true
                if (!purchase.isAcknowledged) acknowledge(purchase.purchaseToken)
            }
            if (purchase.products.contains(LEGACY_PREMIUM_PRODUCT_ID)) {
                legacyActive = true
                onFounderDetected()
                if (!purchase.isAcknowledged) acknowledge(purchase.purchaseToken)
            }
        }
        onFriendStateChanged(friendActive)
        onLegacyPremiumStateChanged(legacyActive)

        val oneTime = withContext(Dispatchers.IO) {
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build(),
            )
        }
        oneTime.purchasesList
            .filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
            .filter { purchase -> purchase.products.any { it in CONTRIBUTION_PRODUCT_IDS } }
            .forEach { purchase ->
                val id = purchase.products.first { it in CONTRIBUTION_PRODUCT_IDS }
                onContributionSuccess(id)
                consume(purchase.purchaseToken)
            }
        _purchaseStateReady.value = true
        return friendActive || legacyActive
    }

    private suspend fun acknowledge(token: String) {
        withContext(Dispatchers.IO) {
            billingClient.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build(),
            )
        }
    }

    private suspend fun consume(token: String) {
        withContext(Dispatchers.IO) {
            billingClient.consumePurchase(
                ConsumeParams.newBuilder().setPurchaseToken(token).build(),
            )
        }
    }

    fun clearPurchaseError() {
        _purchaseError.value = null
    }

    private fun friendlyError(result: BillingResult): String = when (result.responseCode) {
        BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
        BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE,
        BillingClient.BillingResponseCode.NETWORK_ERROR -> "Sin conexión con Google Play. Inténtalo más tarde."
        BillingClient.BillingResponseCode.BILLING_UNAVAILABLE -> "Google Play Billing no está disponible."
        BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> "Este producto no está disponible ahora mismo."
        else -> "No se pudo completar la compra (${result.responseCode})."
    }

    companion object {
        private const val TAG = "BillingManager"
        const val FRIEND_PRODUCT_ID = "amigo"
        const val LEGACY_PREMIUM_PRODUCT_ID = "premium"
        const val BASE_PLAN_MONTHLY = "monthly"
        const val BASE_PLAN_YEARLY = "yearly"
        const val CONTRIBUTION_SMALL = "aportacion_299"
        const val CONTRIBUTION_MEDIUM = "aportacion_599"
        const val CONTRIBUTION_LARGE = "aportacion_1199"
        val CONTRIBUTION_PRODUCT_IDS = listOf(CONTRIBUTION_SMALL, CONTRIBUTION_MEDIUM, CONTRIBUTION_LARGE)
        private const val MAX_RECONNECT_ATTEMPTS = 6
    }
}
