package app.calendariociclismo.android.ui.onboarding

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import android.os.Bundle
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.launch

/**
 * Pantalla de onboarding mostrada la primera vez que el usuario abre la app,
 * ofreciendo suscribirse a las notificaciones push.
 * Port de NotificationOnboardingView.swift.
 */
@Composable
fun NotificationOnboardingScreen(onDismiss: () -> Unit) {
    val app = rememberApp()
    val scope = rememberCoroutineScope()
    val haptic = rememberHaptics()

    LaunchedEffect(Unit) {
        app.analytics.logEvent("onboarding_view", Bundle().apply {
            putString("onboarding_step", "notifications")
        })
    }

    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        scope.launch {
            if (granted) app.pushManager.subscribe()
            app.preferences.setNotifOnboardingDone(true)
            app.analytics.logEvent("onboarding_action", Bundle().apply {
                putString("onboarding_step", "notifications")
                putString("action", "accepted")
            })
            onDismiss()
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))

            // Icono principal
            Icon(
                imageVector = Icons.Filled.Notifications,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(24.dp))

            // Título
            Text(
                text = stringResource(R.string.onboarding_notif_title),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(12.dp))

            // Descripción
            Text(
                text = stringResource(R.string.onboarding_notif_body),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 32.dp),
            )
            Spacer(Modifier.height(32.dp))

            // Bullets informativos
            Column(
                modifier = Modifier.padding(horizontal = 48.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                OnboardingBullet(Icons.Filled.Event, stringResource(R.string.onboarding_notif_bullet_events))
                OnboardingBullet(Icons.Filled.Sync, stringResource(R.string.onboarding_notif_bullet_updates))
                OnboardingBullet(Icons.Filled.VerifiedUser, stringResource(R.string.onboarding_notif_bullet_no_spam))
            }

            Spacer(Modifier.weight(1f))

            // Botón principal
            Button(
                onClick = {
                    haptic(Haptics.Event.Success)
                    if (Build.VERSION.SDK_INT >= 33) {
                        permLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        scope.launch {
                            app.pushManager.subscribe()
                            app.preferences.setNotifOnboardingDone(true)
                            onDismiss()
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 32.dp),
                shape = RoundedCornerShape(14.dp),
                contentPadding = PaddingValues(vertical = 14.dp),
            ) {
                Text(
                    stringResource(R.string.onboarding_notif_cta),
                    style = MaterialTheme.typography.titleSmall,
                )
            }
            Spacer(Modifier.height(12.dp))

            // Botón secundario
            TextButton(
                onClick = {
                    scope.launch {
                        app.preferences.setNotifOnboardingDone(true)
                        app.analytics.logEvent("onboarding_action", Bundle().apply {
                            putString("onboarding_step", "notifications")
                            putString("action", "skipped")
                        })
                        onDismiss()
                    }
                },
            ) {
                Text(
                    stringResource(R.string.onboarding_notif_skip),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(48.dp))
        }
    }
}

/** Bullet informativo reutilizable en las pantallas de onboarding. */
@Composable
internal fun OnboardingBullet(icon: ImageVector, text: String) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
