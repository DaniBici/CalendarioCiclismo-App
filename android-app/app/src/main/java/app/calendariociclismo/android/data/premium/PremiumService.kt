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
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Servicio de sostenimiento de 4.3.
 *
 * El nombre de clase se conserva para evitar una migración transversal de los
 * call sites, pero Premium ya no es un producto a la venta. El servicio separa:
 * - Premium anterior: reconocimiento Fundador y bloqueo temporal de nueva alta.
 * - Amigo: membresía voluntaria activa.
 * - Aportaciones: compras puntuales consumibles.
 */
class PremiumService(
    private val context: Context,
    private val preferences: AppPreferences,
    private val analytics: AnalyticsService,
    private val scope: CoroutineScope,
) {
    enum class PaywallSource {
        REGION, NOTIFICATIONS, RACE_CARDS, RACE_NOTIFICATIONS, GENERAL,
    }

    enum class PremiumPlan(val basePlanId: String) {
        MONTHLY(BillingManager.BASE_PLAN_MONTHLY),
        YEARLY(BillingManager.BASE_PLAN_YEARLY),
    }

    enum class SupporterIcon(val storageValue: String) {
        DEFAULT("default"),
        FOUNDER("founder"),
        FRIEND("friend");

        companion object {
            fun fromStorage(value: String): SupporterIcon =
                entries.firstOrNull { it.storageValue == value } ?: DEFAULT
        }
    }

    private val billing = BillingManager(
        context = context,
        scope = scope,
        onFriendStateChanged = { active ->
            if (BuildConfig.PREMIUM_TEST_BUILD && !active) return@BillingManager
            scope.launch {
                preferences.setFriendSubscribed(active)
                if (!active && preferences.snapshotSupporterIcon() == "friend") {
                    val previous = SupporterIcon.fromStorage(preferences.snapshotPreviousSupporterIcon())
                    val fallback = if (
                        previous == SupporterIcon.FOUNDER && preferences.snapshotFounderRecognized()
                    ) SupporterIcon.FOUNDER else SupporterIcon.DEFAULT
                    setSupporterIcon(fallback)
                }
            }
        },
        onLegacyPremiumStateChanged = { active ->
            scope.launch {
                preferences.setPremiumSubscribed(active)
                if (active) preferences.setFounderRecognized()
            }
        },
        onFounderDetected = {
            scope.launch { preferences.setFounderRecognized() }
        },
        onContributionSuccess = {
            scope.launch { preferences.recordContribution() }
        },
        onPurchaseSuccess = { plan, productId ->
            analytics.logEvent("support_purchase_success", Bundle().apply {
                plan?.let { putString("plan", it) }
                putString("product_id", productId)
            })
        },
        onPurchaseError = { plan, message ->
            analytics.logEvent("support_purchase_error", Bundle().apply {
                plan?.let { putString("plan", it) }
                putString("error", message)
            })
        },
    )

    val isSubscribed: StateFlow<Boolean> = preferences.friendSubscribed
        .stateIn(scope, SharingStarted.Eagerly, false)
    val isLegacyPremiumActive: StateFlow<Boolean> = preferences.premiumSubscribed
        .stateIn(scope, SharingStarted.Eagerly, false)
    val isFounder: StateFlow<Boolean> = preferences.founderRecognized
        .stateIn(scope, SharingStarted.Eagerly, false)
    val supporterIcon: StateFlow<String> = preferences.supporterIcon
        .stateIn(scope, SharingStarted.Eagerly, "default")
    val contributionCount: StateFlow<Int> = preferences.contributionCount
        .stateIn(scope, SharingStarted.Eagerly, 0)

    val featuresUnlocked = true

    private val _pendingPaywallSource = kotlinx.coroutines.flow.MutableStateFlow<PaywallSource?>(null)
    val pendingPaywallSource: StateFlow<PaywallSource?> = _pendingPaywallSource

    val plans = billing.plans
    val contributions = billing.contributions
    val isPurchasing = billing.isPurchasing
    val purchaseError = billing.purchaseError
    val purchaseStateReady = billing.purchaseStateReady

    init {
        scope.launch {
            // La actualización conserva Fundador antes de que la consulta de Play
            // pueda bajar el antiguo flag Premium a false.
            if (preferences.snapshotPremiumSubscribed()) preferences.setFounderRecognized()
            billing.start()
        }
        if (BuildConfig.PREMIUM_TEST_BUILD) {
            scope.launch { preferences.setFriendSubscribed(true) }
        }
    }

    fun presentPaywall(source: PaywallSource) {
        _pendingPaywallSource.value = source
        analytics.logEvent("support_view", Bundle().apply {
            putString("source", source.name.lowercase())
        })
    }

    fun dismissPaywall() {
        _pendingPaywallSource.value = null
        billing.clearPurchaseError()
    }

    fun subscribe(activity: Activity, plan: PremiumPlan) {
        if (isLegacyPremiumActive.value) return
        analytics.logEvent("support_subscribe_tap", Bundle().apply {
            putString("plan", plan.name.lowercase())
            putString("source", _pendingPaywallSource.value?.name?.lowercase() ?: "unknown")
        })
        if (BuildConfig.DEBUG || BuildConfig.PREMIUM_TEST_BUILD) {
            scope.launch { preferences.setFriendSubscribed(true) }
        } else {
            billing.launchSubscription(activity, plan.basePlanId)
        }
    }

    fun contribute(activity: Activity, productId: String) {
        analytics.logEvent("support_contribution_tap", Bundle().apply {
            putString("product_id", productId)
        })
        if (BuildConfig.DEBUG) {
            scope.launch { preferences.recordContribution() }
        } else {
            billing.launchContribution(activity, productId)
        }
    }

    suspend fun restorePurchases(): Boolean {
        analytics.logEvent("support_restore_tap", null)
        if (BuildConfig.PREMIUM_TEST_BUILD) return true
        if (BuildConfig.DEBUG) {
            return preferences.snapshotFriendSubscribed() || preferences.snapshotFounderRecognized()
        }
        billing.queryPurchases()
        return preferences.snapshotFriendSubscribed() ||
            preferences.snapshotPremiumSubscribed() ||
            preferences.snapshotFounderRecognized()
    }

    fun cancelSubscription() {
        if (BuildConfig.PREMIUM_TEST_BUILD) return
        if (BuildConfig.DEBUG) {
            scope.launch { preferences.setFriendSubscribed(false) }
            return
        }
        val uri = Uri.parse(
            "https://play.google.com/store/account/subscriptions" +
                "?sku=${BillingManager.FRIEND_PRODUCT_ID}&package=${context.packageName}",
        )
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    fun redeemCode() {
        if (BuildConfig.PREMIUM_TEST_BUILD) return
        if (BuildConfig.DEBUG) {
            scope.launch { preferences.setFriendSubscribed(true) }
            return
        }
        val uri = Uri.parse("https://play.google.com/redeem?code=")
        val storeIntent = Intent(Intent.ACTION_VIEW, uri)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .setPackage("com.android.vending")
        runCatching { context.startActivity(storeIntent) }.onFailure {
            runCatching {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
    }

    fun setSupporterIcon(icon: SupporterIcon) {
        val allowed = when (icon) {
            SupporterIcon.DEFAULT -> true
            SupporterIcon.FOUNDER -> isFounder.value
            SupporterIcon.FRIEND -> isSubscribed.value
        }
        if (!allowed) return
        scope.launch {
            val current = SupporterIcon.fromStorage(preferences.snapshotSupporterIcon())
            if (icon == SupporterIcon.FRIEND && current != SupporterIcon.FRIEND) {
                preferences.setPreviousSupporterIcon(current.storageValue)
            }
            SupporterIconManager.apply(context, icon)
            preferences.setSupporterIcon(icon.storageValue)
        }
    }

    fun clearPurchaseError() {
        billing.clearPurchaseError()
    }

    fun debugSetSubscribed(value: Boolean) {
        if (!BuildConfig.DEBUG) return
        scope.launch { preferences.setFriendSubscribed(value) }
    }

    fun debugSetFounder(value: Boolean) {
        if (!BuildConfig.DEBUG) return
        scope.launch { preferences.setFounderRecognized(value) }
    }
}
