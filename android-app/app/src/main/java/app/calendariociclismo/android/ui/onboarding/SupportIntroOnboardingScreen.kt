package app.calendariociclismo.android.ui.onboarding

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.launch

/**
 * Presentación del apoyo voluntario (4.3.1) para instalaciones nuevas y para
 * actualizaciones anteriores, a las que anuncia además el icono Fundador. El
 * valor analítico `premium_showcase` se conserva para no romper la serie.
 */
@Composable
fun SupportIntroOnboardingScreen(
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
                modifier = Modifier.weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    painterResource(R.drawable.ic_launcher_friend_foreground),
                    null,
                    Modifier.size(72.dp),
                    tint = androidx.compose.ui.graphics.Color.Unspecified,
                )
                Spacer(Modifier.height(20.dp))
                Text(
                    stringResource(R.string.onboarding_support_title),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    stringResource(
                        if (isNewInstallation) R.string.onboarding_support_body_new_installation
                        else R.string.onboarding_support_body
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(32.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    ),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        FeatureRow(Icons.Filled.Code, stringResource(R.string.onboarding_support_benefit_open))
                        FeatureRow(
                            Icons.Filled.AutoAwesome,
                            if (legacyActive) {
                                LocaleHolder.t(
                                    "Tu Premium sigue activo hasta su vencimiento; mientras tanto puedes hacer aportaciones puntuales",
                                    "Your Premium remains active until it expires; meanwhile you can make one-time contributions",
                                )
                            } else {
                                stringResource(
                                    if (isNewInstallation) R.string.onboarding_support_benefit_experience
                                    else R.string.onboarding_support_benefit_founder
                                )
                            },
                        )
                    }
                }
                if (!isNewInstallation) {
                    TextButton(onClick = ::openExplanation) {
                        Text(stringResource(R.string.onboarding_support_explain))
                    }
                }
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Button(
                    onClick = {
                        when {
                            friendActive || (!isNewInstallation && !purchaseStateReady) -> finish("continue")
                            legacyActive -> finish("open_contributions") {
                                app.premium.presentSupport()
                            }
                            else -> finish("open_support") {
                                app.premium.presentSupport()
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp),
                    shape = RoundedCornerShape(14.dp),
                    contentPadding = PaddingValues(vertical = 14.dp),
                ) {
                    Text(
                        when {
                            friendActive || (!isNewInstallation && !purchaseStateReady) -> stringResource(R.string.onboarding_support_cta_free)
                            legacyActive -> LocaleHolder.t("Ver aportaciones puntuales", "View one-time contributions")
                            else -> stringResource(R.string.onboarding_support_cta_try)
                        },
                        style = MaterialTheme.typography.titleSmall,
                    )
                }
                Spacer(Modifier.height(12.dp))
                TextButton(
                    onClick = {
                        when {
                            friendActive -> finish("manage_subscription") { app.premium.cancelSubscription() }
                            !isNewInstallation && !purchaseStateReady -> openExplanation()
                            else -> finish(if (founder) "continue_founder" else "continue_free")
                        }
                    },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
                ) {
                    Text(
                        when {
                            friendActive -> stringResource(R.string.onboarding_support_manage)
                            !isNewInstallation && !purchaseStateReady -> stringResource(R.string.onboarding_support_explain)
                            else -> stringResource(R.string.onboarding_support_cta_free)
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(32.dp))
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
