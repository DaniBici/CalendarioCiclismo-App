package app.calendariociclismo.android.ui.onboarding

import android.os.Bundle
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.DirectionsBike
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.premium.PremiumService
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.launch

/**
 * Onboarding "sin anuncios" — pantalla única, último paso del flujo, que ofrece
 * la suscripción cuyo ÚNICO valor es quitar los anuncios (todas las antiguas
 * features Premium se liberaron al plan gratuito, commit `ea0674292da`).
 *
 * Flujo resultante: Language → Notifications → Offline → esta pantalla → Done.
 */
@Composable
fun PremiumShowcaseOnboardingScreen(onDismiss: () -> Unit) {
    val app = rememberApp()
    val scope = rememberCoroutineScope()
    val haptic = rememberHaptics()

    val isSubscribed by app.premium.isSubscribed.collectAsState()

    LaunchedEffect(Unit) {
        app.analytics.logEvent("onboarding_view", Bundle().apply {
            putString("onboarding_step", "premium_showcase")
        })
    }

    LaunchedEffect(isSubscribed) {
        if (isSubscribed) {
            markDone(app)
            onDismiss()
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {

            // Contenido desplazable
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(56.dp))

                HeaderSection()

                Spacer(Modifier.height(24.dp))

                BenefitsCard()

                Spacer(Modifier.height(24.dp))
            }

            // Botones fijos en la parte inferior
            Column {
                HorizontalDivider()
                Spacer(Modifier.height(12.dp))

                Button(
                    onClick = {
                        haptic(Haptics.Event.PrimaryAction)
                        scope.launch {
                            markDone(app)
                            app.analytics.logEvent("onboarding_action", Bundle().apply {
                                putString("onboarding_step", "premium_showcase")
                                putString("action", "try_premium")
                            })
                            app.premium.presentPaywall(PremiumService.PaywallSource.GENERAL)
                            onDismiss()
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 32.dp),
                    shape = RoundedCornerShape(14.dp),
                    contentPadding = PaddingValues(vertical = 14.dp),
                ) {
                    Text(
                        stringResource(R.string.onboarding_premium_cta_try),
                        style = MaterialTheme.typography.titleSmall,
                    )
                }
                Spacer(Modifier.height(8.dp))

                TextButton(
                    onClick = {
                        scope.launch {
                            markDone(app)
                            app.analytics.logEvent("onboarding_action", Bundle().apply {
                                putString("onboarding_step", "premium_showcase")
                                putString("action", "continue_free")
                            })
                            onDismiss()
                        }
                    },
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                ) {
                    Text(
                        stringResource(R.string.onboarding_premium_cta_free),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Text(
                    text = stringResource(R.string.onboarding_premium_cancel_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 32.dp),
                )
                Spacer(Modifier.height(48.dp))
            }
        }
    }
}

// MARK: - Header

@Composable
private fun HeaderSection() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Filled.CalendarMonth,
                contentDescription = null,
                modifier = Modifier.size(44.dp),
                tint = Color(0xFFF6A623),
            )
            Icon(
                imageVector = Icons.Filled.DirectionsBike,
                contentDescription = null,
                modifier = Modifier.size(44.dp),
                tint = Color(0xFFF6A623),
            )
        }
        Text(
            text = stringResource(R.string.onboarding_premium_title),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(R.string.onboarding_premium_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

// MARK: - Benefits

@Composable
private fun BenefitsCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        ),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            FeatureRow(
                icon = Icons.Outlined.Block,
                text = stringResource(R.string.onboarding_premium_benefit_no_ads),
            )
            FeatureRow(
                icon = Icons.Filled.Bolt,
                text = stringResource(R.string.onboarding_premium_benefit_clean),
            )
            FeatureRow(
                icon = Icons.Filled.Favorite,
                text = stringResource(R.string.onboarding_premium_benefit_support),
            )
        }
    }
}

@Composable
private fun FeatureRow(icon: ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.width(12.dp))
        Text(text = text, style = MaterialTheme.typography.bodyMedium)
    }
}

// MARK: - Helpers

private suspend fun markDone(app: app.calendariociclismo.android.CalendarioCiclismoApp) {
    // Marca el gate vivo de esta pantalla. Los flags legacy `adsIntroDone` (2.3)
    // y `premiumShowcaseDone` (2.0) se retiraron el 2026-07-19 (ya saturados a
    // `true` en el parque, no los lee nadie).
    app.preferences.setAdsIntroV4Done(true)
}
