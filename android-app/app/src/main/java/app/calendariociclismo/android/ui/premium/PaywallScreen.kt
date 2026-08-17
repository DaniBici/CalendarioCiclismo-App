package app.calendariociclismo.android.ui.premium

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MilitaryTech
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.premium.BillingManager
import app.calendariociclismo.android.data.premium.PremiumService
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.LocaleHolder
import kotlinx.coroutines.launch

/** Pantalla voluntaria de sostenimiento. Ninguna función depende de la compra. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaywallSheet(
    source: PremiumService.PaywallSource,
    onDismiss: () -> Unit,
) {
    val app = rememberApp()
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var selectedPlan by remember { mutableStateOf(PremiumService.PremiumPlan.YEARLY) }
    var alert by remember { mutableStateOf<String?>(null) }

    val plans by app.premium.plans.collectAsState()
    val contributions by app.premium.contributions.collectAsState()
    val isFriend by app.premium.isSubscribed.collectAsState()
    val legacyActive by app.premium.isLegacyPremiumActive.collectAsState()
    val isPurchasing by app.premium.isPurchasing.collectAsState()
    val purchaseError by app.premium.purchaseError.collectAsState()
    val contributionCount by app.premium.contributionCount.collectAsState()
    val contributionCountAtOpen = remember { contributionCount }

    LaunchedEffect(isFriend) {
        if (isFriend) onDismiss()
    }
    LaunchedEffect(purchaseError) {
        purchaseError?.let {
            alert = it
            app.premium.clearPurchaseError()
        }
    }
    LaunchedEffect(contributionCount) {
        if (contributionCount > contributionCountAtOpen) {
            alert = t(
                "Gracias por ayudar a sostener Calendario Ciclismo.",
                "Thank you for helping sustain Calendario Ciclismo.",
            )
        }
    }

    val monthly = plans.firstOrNull { it.basePlanId == BillingManager.BASE_PLAN_MONTHLY }
    val yearly = plans.firstOrNull { it.basePlanId == BillingManager.BASE_PLAN_YEARLY }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        contentWindowInsets = { WindowInsets(0) },
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 12.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Spacer(Modifier.size(40.dp))
                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        painterResource(R.drawable.ic_launcher_friend_foreground),
                        contentDescription = null,
                        tint = Color.Unspecified,
                        modifier = Modifier.size(84.dp),
                    )
                    Text(
                        t("Hazte Amigo de Calendario Ciclismo", "Become a Friend of Calendario Ciclismo"),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        t(
                            "Ayuda voluntariamente a cubrir servidores, herramientas y mantenimiento.",
                            "Voluntarily help cover servers, tools and maintenance.",
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Filled.Close, contentDescription = t("Cerrar", "Close"))
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Guarantee(t("Icono exclusivo mientras seas Amigo", "Exclusive icon while you are a Friend"))
                    Guarantee(t("La app completa es gratuita para todos", "The complete app is free for everyone"))
                }
            }

            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        context.startActivity(
                            Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("https://www.calendariociclismo.app/abierto.html"),
                            ),
                        )
                    },
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f),
                ),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(t("Código y cuentas públicas", "Public code and accounts"), fontWeight = FontWeight.Bold)
                        Text(
                            t("Consulta cómo se hace y se sostiene el proyecto.", "See how the project is built and sustained."),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Icon(
                        imageVector = Icons.Filled.ChevronRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }

            if (legacyActive) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(
                            Icons.Filled.MilitaryTech,
                            contentDescription = null,
                            tint = Color(0xFFB7791F),
                            modifier = Modifier.size(36.dp),
                        )
                        Text(t("Eres Fundador", "You are a Founder"), fontWeight = FontWeight.Bold)
                        Text(
                            t(
                                "Tu Premium anterior no se convertirá ni volverá a cobrarse. Cuando termine podrás hacerte Amigo si quieres seguir contribuyendo.",
                                "Your previous Premium plan will not be converted or charged again. When it ends, you can become a Friend if you wish to continue supporting the project.",
                            ),
                            textAlign = TextAlign.Center,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            } else {
                PlanRow(
                    selected = selectedPlan == PremiumService.PremiumPlan.YEARLY,
                    price = yearly?.formattedPrice ?: "17,99 €",
                    period = t("al año", "per year"),
                    badge = t("MEJOR OPCIÓN", "BEST VALUE"),
                    onClick = { selectedPlan = PremiumService.PremiumPlan.YEARLY },
                )
                PlanRow(
                    selected = selectedPlan == PremiumService.PremiumPlan.MONTHLY,
                    price = monthly?.formattedPrice ?: "2,99 €",
                    period = t("al mes", "per month"),
                    badge = null,
                    onClick = { selectedPlan = PremiumService.PremiumPlan.MONTHLY },
                )
                Button(
                    onClick = {
                        activity?.let { app.premium.subscribe(it, selectedPlan) }
                    },
                    enabled = !isPurchasing,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) {
                    if (isPurchasing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(t("Hacerme amigo", "Become a Friend"), fontWeight = FontWeight.Bold)
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(t("Aportación puntual", "One-time contribution"), fontWeight = FontWeight.Bold)
                Text(
                    t("Sin suscripción y sin ventajas funcionales.", "No subscription and no functional advantages."),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BillingManager.CONTRIBUTION_PRODUCT_IDS.forEachIndexed { index, id ->
                        val fallback = listOf("2,99 €", "5,99 €", "11,99 €")[index]
                        val price = contributions.firstOrNull { it.productId == id }?.formattedPrice ?: fallback
                        OutlinedButton(
                            onClick = { activity?.let { app.premium.contribute(it, id) } },
                            enabled = !isPurchasing,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(price)
                        }
                    }
                }
            }

            TextButton(
                onClick = {
                    scope.launch {
                        if (!app.premium.restorePurchases()) {
                            alert = t(
                                "No encontramos compras anteriores en esta cuenta de Google.",
                                "We couldn't find previous purchases on this Google account.",
                            )
                        }
                    }
                },
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) {
                Text(t("Restaurar compras", "Restore purchases"))
            }

            Text(
                t(
                    "La membresía se renueva automáticamente al precio indicado hasta que la canceles en Google Play. Todas las funciones permanecen gratuitas.",
                    "The membership renews automatically at the displayed price until you cancel it in Google Play. All features remain free.",
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }

    alert?.let { message ->
        AlertDialog(
            onDismissRequest = { alert = null },
            title = { Text(t("Amigo de Calendario Ciclismo", "Friend of Calendario Ciclismo")) },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = { alert = null }) { Text(t("Aceptar", "OK")) }
            },
        )
    }
}

@Composable
private fun Guarantee(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun PlanRow(
    selected: Boolean,
    price: String,
    period: String,
    badge: String?,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioButton(selected = selected, onClick = onClick)
            Text(price, fontWeight = FontWeight.Bold)
            Text(" $period", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.weight(1f))
            badge?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

private fun t(es: String, en: String): String = LocaleHolder.t(es, en)

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
