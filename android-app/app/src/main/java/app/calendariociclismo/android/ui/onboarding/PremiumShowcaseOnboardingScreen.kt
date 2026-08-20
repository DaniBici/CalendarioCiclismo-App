package app.calendariociclismo.android.ui.onboarding

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Code
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.premium.PremiumService
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.launch

/** Anuncio único de 4.3 para instalaciones nuevas y actualizaciones desde 4.2.6. */
@Composable
fun PremiumShowcaseOnboardingScreen(
    isNewInstallation: Boolean,
    onDismiss: () -> Unit,
) {
    val app = rememberApp()
    val scope = rememberCoroutineScope()
    val haptic = rememberHaptics()
    val friendActive by app.premium.isSubscribed.collectAsState()
    val legacyActive by app.premium.isLegacyPremiumActive.collectAsState()
    val founder by app.premium.isFounder.collectAsState()
    val purchaseStateReady by app.premium.purchaseStateReady.collectAsState()

    LaunchedEffect(Unit) {
        app.analytics.logEvent("onboarding_view", Bundle().apply {
            putString("onboarding_step", "premium_showcase")
        })
    }

    fun finish(action: String, next: (() -> Unit)? = null) {
        haptic(Haptics.Event.PrimaryAction)
        scope.launch {
            markDone(app)
            app.analytics.logEvent("onboarding_action", Bundle().apply {
                putString("onboarding_step", "premium_showcase")
                putString("action", action)
            })
            next?.invoke()
            onDismiss()
        }
    }

    fun openExplanation() {
        val path = if (LocaleHolder.shouldShowEnglishContent) "/en/support/" else "/apoyar/"
        app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.calendariociclismo.app$path")).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.weight(1f).padding(horizontal = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    painterResource(R.drawable.ic_launcher_friend_foreground),
                    null,
                    Modifier.size(84.dp),
                    tint = androidx.compose.ui.graphics.Color.Unspecified,
                )
                Spacer(Modifier.height(18.dp))
                Text(
                    stringResource(R.string.onboarding_premium_title),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    stringResource(
                        if (isNewInstallation) R.string.onboarding_premium_body_new_installation
                        else R.string.onboarding_premium_body
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(24.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    ),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        FeatureRow(Icons.Filled.Code, stringResource(R.string.onboarding_premium_benefit_open))
                        FeatureRow(
                            Icons.Filled.AutoAwesome,
                            stringResource(
                                if (isNewInstallation) R.string.onboarding_premium_benefit_experience
                                else R.string.onboarding_premium_benefit_founder
                            ),
                        )
                    }
                }
                if (!isNewInstallation) {
                    TextButton(onClick = ::openExplanation) {
                        Text(stringResource(R.string.onboarding_premium_explain))
                    }
                }
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                HorizontalDivider()
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = {
                        when {
                            legacyActive || friendActive || !purchaseStateReady -> finish("continue")
                            else -> finish("open_support") {
                                app.premium.presentPaywall(PremiumService.PaywallSource.GENERAL)
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp),
                    shape = RoundedCornerShape(14.dp),
                    contentPadding = PaddingValues(vertical = 14.dp),
                ) {
                    Text(
                        if (legacyActive || friendActive || !purchaseStateReady) {
                            stringResource(R.string.onboarding_premium_cta_free)
                        } else {
                            stringResource(R.string.onboarding_premium_cta_try)
                        },
                        style = MaterialTheme.typography.titleSmall,
                    )
                }
                val showSecondaryButton = !isNewInstallation || friendActive || (purchaseStateReady && !legacyActive)
                if (showSecondaryButton) {
                    TextButton(onClick = {
                        when {
                            friendActive -> finish("manage_subscription") { app.premium.cancelSubscription() }
                            !isNewInstallation && (legacyActive || !purchaseStateReady) -> openExplanation()
                            else -> finish(if (founder) "continue_founder" else "continue_free")
                        }
                    }) {
                        Text(
                            when {
                                friendActive -> stringResource(R.string.onboarding_premium_manage)
                                !isNewInstallation && (legacyActive || !purchaseStateReady) -> stringResource(R.string.onboarding_premium_explain)
                                else -> stringResource(R.string.onboarding_premium_cta_free)
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Spacer(Modifier.height(36.dp))
            }
        }
    }
}

@Composable
private fun FeatureRow(icon: ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

private suspend fun markDone(app: app.calendariociclismo.android.CalendarioCiclismoApp) {
    app.preferences.setSupportIntroV43Done(true)
}
