package app.calendariociclismo.android.ui.premium

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.DirectionsBike
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.premium.BillingManager
import app.calendariociclismo.android.data.premium.PremiumService
import app.calendariociclismo.android.ui.rememberApp
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * Pantalla de paywall (Fase 6 — conectada a Google Play Billing).
 *
 * Equivalente Android de `PaywallView.swift`. Lee:
 *  - `app.premium.plans` para precios reales (con fallback hardcoded si la
 *    query a Play todavía no ha resuelto).
 *  - `app.premium.isPurchasing` para mostrar el spinner durante la compra.
 *  - `app.premium.purchaseError` para presentar errores en un AlertDialog.
 *
 * Se presenta como `ModalBottomSheet` desde el AppNavHost cuando
 * `PremiumService.pendingPaywallSource` deja de ser null.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaywallSheet(
    source: PremiumService.PaywallSource,
    onDismiss: () -> Unit,
) {
    val app = rememberApp()
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    val coroutineScope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scrollState = rememberScrollState()
    var selectedPlan by remember { mutableStateOf(PremiumService.PremiumPlan.YEARLY) }
    var alert by remember { mutableStateOf<String?>(null) }
    // Se resuelve aquí: dentro del lambda de restore no hay contexto @Composable.
    val restoreNoneMsg = stringResource(R.string.paywall_restore_none)

    val plans by app.premium.plans.collectAsState()
    val isPurchasing by app.premium.isPurchasing.collectAsState()
    val isSubscribed by app.premium.isSubscribed.collectAsState()
    val purchaseError by app.premium.purchaseError.collectAsState()

    val monthlyPlan = plans.firstOrNull { it.basePlanId == BillingManager.BASE_PLAN_MONTHLY }
    val yearlyPlan = plans.firstOrNull { it.basePlanId == BillingManager.BASE_PLAN_YEARLY }

    // Auto-cerrar la paywall al confirmarse la compra (vía callback de Billing).
    LaunchedEffect(isSubscribed) {
        if (isSubscribed) onDismiss()
    }

    // Mostrar errores como AlertDialog.
    LaunchedEffect(purchaseError) {
        purchaseError?.let {
            alert = it
            app.premium.clearPurchaseError()
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        contentWindowInsets = { WindowInsets(0) },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(scrollState)
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            // Header
            Row(verticalAlignment = Alignment.Top) {
                Spacer(modifier = Modifier.width(40.dp))
                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = Icons.Filled.CalendarMonth,
                            contentDescription = null,
                            modifier = Modifier.size(40.dp),
                            tint = Color(0xFFF6A623),
                        )
                        Icon(
                            imageVector = Icons.Filled.DirectionsBike,
                            contentDescription = null,
                            modifier = Modifier.size(40.dp),
                            tint = Color(0xFFF6A623),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = headerTitle(source),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = headerSubtitle(source),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.action_close))
                }
            }

            // Features
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    FeatureRow(Icons.Outlined.Block, stringResource(R.string.paywall_benefit_no_ads))
                    FeatureRow(Icons.Filled.Bolt, stringResource(R.string.paywall_benefit_clean))
                    FeatureRow(Icons.Filled.Favorite, stringResource(R.string.paywall_benefit_support))
                }
            }

            // Plan selector
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                PlanCard(
                    plan = PremiumService.PremiumPlan.YEARLY,
                    selected = selectedPlan == PremiumService.PremiumPlan.YEARLY,
                    price = yearlyPlan?.formattedPrice ?: FALLBACK_YEARLY_PRICE,
                    period = stringResource(R.string.paywall_period_yearly),
                    subtitle = formatYearlySubtitle(monthlyPlan, yearlyPlan),
                    badge = stringResource(R.string.paywall_badge_best_value),
                    onClick = { selectedPlan = PremiumService.PremiumPlan.YEARLY },
                )
                PlanCard(
                    plan = PremiumService.PremiumPlan.MONTHLY,
                    selected = selectedPlan == PremiumService.PremiumPlan.MONTHLY,
                    price = monthlyPlan?.formattedPrice ?: FALLBACK_MONTHLY_PRICE,
                    period = stringResource(R.string.paywall_period_monthly),
                    subtitle = stringResource(R.string.paywall_cancel_anytime),
                    badge = null,
                    onClick = { selectedPlan = PremiumService.PremiumPlan.MONTHLY },
                )
            }

            // CTA
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val ctaText = if (selectedPlan == PremiumService.PremiumPlan.YEARLY && (yearlyPlan?.hasFreeTrial ?: true)) {
                    stringResource(R.string.paywall_cta_try)
                } else if (selectedPlan == PremiumService.PremiumPlan.MONTHLY && (monthlyPlan?.hasFreeTrial ?: true)) {
                    stringResource(R.string.paywall_cta_try)
                } else {
                    stringResource(R.string.action_subscribe)
                }
                Button(
                    onClick = {
                        val current = activity ?: return@Button
                        app.premium.subscribe(current, selectedPlan)
                    },
                    enabled = !isPurchasing,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    if (isPurchasing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(ctaText, fontWeight = FontWeight.SemiBold)
                    }
                }
                Spacer(Modifier.height(6.dp))
                val afterPrice = when (selectedPlan) {
                    PremiumService.PremiumPlan.YEARLY ->
                        stringResource(
                            R.string.paywall_price_per_year,
                            yearlyPlan?.formattedPrice ?: FALLBACK_YEARLY_PRICE,
                        )
                    PremiumService.PremiumPlan.MONTHLY ->
                        stringResource(
                            R.string.paywall_price_per_month,
                            monthlyPlan?.formattedPrice ?: FALLBACK_MONTHLY_PRICE,
                        )
                }
                Text(
                    text = stringResource(R.string.paywall_after_price, afterPrice),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Restore + Canjear código
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = {
                        coroutineScope.launch {
                            val restored = app.premium.restorePurchases()
                            alert = if (restored)
                                "Suscripción restaurada correctamente."
                            else
                                restoreNoneMsg
                        }
                    },
                ) {
                    Text(stringResource(R.string.paywall_restore))
                }
                TextButton(
                    onClick = { app.premium.redeemCode() },
                ) {
                    Text(stringResource(R.string.settings_adfree_redeem))
                }
            }

            // Nota "no busca beneficio": el proyecto no es un negocio y la
            // suscripción solo cubre costes (ver política de pricing en CLAUDE.md).
            Text(
                text = stringResource(R.string.paywall_nonprofit_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 8.dp),
            )

            // Footer legal
            Text(
                text = stringResource(R.string.paywall_legal_renewal),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 8.dp),
            )
        }
    }

    if (alert != null) {
        AlertDialog(
            onDismissRequest = { alert = null },
            title = { Text("Premium") },
            text = { Text(alert!!) },
            confirmButton = {
                TextButton(onClick = { alert = null }) { Text(stringResource(R.string.paywall_alert_ok)) }
            },
        )
    }
}

@Composable
private fun FeatureRow(icon: ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(24.dp),
        )
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun PlanCard(
    plan: PremiumService.PremiumPlan,
    selected: Boolean,
    price: String,
    period: String,
    subtitle: String,
    badge: String?,
    onClick: () -> Unit,
) {
    val borderColor = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth(),
        border = androidx.compose.foundation.BorderStroke(2.dp, borderColor),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(20.dp)
                    .clip(CircleShape)
                    .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
                    .clickable(onClick = onClick),
            ) {
                if (selected) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .align(Alignment.Center)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.onPrimary),
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(price, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(8.dp))
                    Text(period, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (badge != null) {
                        Spacer(Modifier.width(8.dp))
                        Surface(
                            color = MaterialTheme.colorScheme.primary,
                            shape = RoundedCornerShape(3),
                        ) {
                            Text(
                                badge,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onPrimary,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// Todas las features que antes eran Premium se liberaron al plan gratuito. El
// único valor de la suscripción ahora es quitar los anuncios, así que el copy es
// único (ya no depende de `source`). El parámetro se mantiene por compatibilidad
// con las llamadas existentes.
@Composable
private fun headerTitle(@Suppress("UNUSED_PARAMETER") source: PremiumService.PaywallSource): String =
    stringResource(R.string.paywall_title)

@Composable
private fun headerSubtitle(@Suppress("UNUSED_PARAMETER") source: PremiumService.PaywallSource): String =
    stringResource(R.string.paywall_subtitle)

private const val FALLBACK_MONTHLY_PRICE = "2,99 €"
private const val FALLBACK_YEARLY_PRICE = "17,99 €"
private const val FALLBACK_MONTHLY_EQ_PRICE = "1,50 €"
@Composable
private fun formatYearlySubtitle(
    monthly: BillingManager.Plan?,
    yearly: BillingManager.Plan?,
): String {
    val fallback = stringResource(
        R.string.paywall_monthly_equiv_savings,
        FALLBACK_MONTHLY_EQ_PRICE,
        50,
    )
    if (yearly == null) return fallback
    val monthlyEquivalent = yearly.priceAmountMicros / 12.0
    val monthlyEquivalentFormatted = formatPrice(monthlyEquivalent, yearly.priceCurrencyCode)
        ?: return fallback
    val savingsPct = if (monthly != null && monthly.priceAmountMicros > 0L) {
        val monthlyYearly = monthly.priceAmountMicros.toDouble() * 12.0
        ((1.0 - (yearly.priceAmountMicros.toDouble() / monthlyYearly)) * 100.0).toInt()
    } else {
        null
    }
    return if (savingsPct != null && savingsPct > 0) {
        stringResource(R.string.paywall_monthly_equiv_savings, monthlyEquivalentFormatted, savingsPct)
    } else {
        stringResource(R.string.paywall_monthly_equiv, monthlyEquivalentFormatted)
    }
}

private fun formatPrice(amountMicros: Double, currencyCode: String): String? = runCatching {
    val nf = NumberFormat.getCurrencyInstance(Locale.getDefault())
    nf.currency = Currency.getInstance(currencyCode)
    nf.format(amountMicros / 1_000_000.0)
}.getOrNull()

private fun android.content.Context.findActivity(): Activity? {
    var ctx: android.content.Context? = this
    while (ctx is android.content.ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}
