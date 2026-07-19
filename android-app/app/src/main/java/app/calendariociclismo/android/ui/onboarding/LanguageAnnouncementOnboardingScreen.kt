package app.calendariociclismo.android.ui.onboarding

import android.os.Build
import android.os.Bundle
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
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.prefs.LocalePreference
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Pantalla one-shot de selección de idioma mostrada al primer arranque (tanto
 * instalaciones nuevas como actualizaciones desde 2.0.x). El usuario elige
 * idioma sin coste (el inglés dejó de ser Premium en 2.1).
 *
 * Port de `LanguageAnnouncementOnboardingView.swift`.
 *
 * Persistencia: el flag `LANGUAGE_ANNOUNCEMENT_DONE` se marca como true antes
 * de aplicar el cambio de locale al sistema porque cambiar a inglés recrea la
 * activity; al rearrancar, `MainActivity` lee el flag persistido y salta al
 * siguiente paso del flujo (notificaciones) sin volver a mostrar esta pantalla.
 *
 * Usuarios que ya tenían inglés activado en 2.0 (Premium) saltan esta
 * pantalla automáticamente: la migración en `MainActivity.onCreate` marca el
 * flag como `true` si `appLocale == ENGLISH`.
 */
@Composable
fun LanguageAnnouncementOnboardingScreen(onDismiss: () -> Unit) {
    val app = rememberApp()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptic = rememberHaptics()

    LaunchedEffect(Unit) {
        app.analytics.logEvent("onboarding_view", Bundle().apply {
            putString("onboarding_step", "language_announcement")
        })
    }

    fun choose(locale: LocalePreference) {
        haptic(Haptics.Event.Selection)
        scope.launch {
            // Persistimos el flag ANTES de aplicar el locale al sistema:
            // al cambiar a inglés la activity se recrea y, al volver a arrancar,
            // MainActivity debe ver el flag en true para no mostrar esta pantalla
            // de nuevo.
            app.preferences.setLanguageAnnouncementDone(true)
            app.analytics.logEvent("onboarding_action", Bundle().apply {
                putString("onboarding_step", "language_announcement")
                putString("action", locale.tag)
            })

            val current = app.preferences.snapshotAppLocale()
            if (current == locale) {
                // Misma elección que tenía: solo avanzar al siguiente paso.
                onDismiss()
                return@launch
            }

            // 1. Actualizar LocaleHolder antes de todo — lo leen DateFormatting,
            //    Race.localizedName y stageLabel.
            LocaleHolder.current = java.util.Locale(locale.tag)
            // 2. Persistir en DataStore — esperamos antes de aplicar al sistema.
            app.preferences.setAppLocale(locale)
            // 3. Re-sincronizar token push con el nuevo idioma.
            app.pushManager.syncCategories()
            // 4. Aplicar locale al sistema en el hilo principal (recrea la activity).
            withContext(Dispatchers.Main) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    context.getSystemService(android.app.LocaleManager::class.java)
                        ?.applicationLocales = android.os.LocaleList.forLanguageTags(locale.tag)
                } else {
                    androidx.appcompat.app.AppCompatDelegate
                        .setApplicationLocales(
                            androidx.core.os.LocaleListCompat
                                .forLanguageTags(locale.tag),
                        )
                }
            }
            // No llamamos onDismiss: la activity ya se está recreando y el
            // siguiente arranque saltará esta pantalla (flag = true).
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

            Icon(
                imageVector = Icons.Filled.Language,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(24.dp))

            Text(
                text = stringResource(R.string.onboarding_language_title),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(32.dp))

            // Botón primario: Español (acción predeterminada, mayoría de usuarios).
            Button(
                onClick = { choose(LocalePreference.SPANISH) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 32.dp),
                shape = RoundedCornerShape(14.dp),
                contentPadding = PaddingValues(vertical = 14.dp),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("🇪🇸")
                    Text(
                        stringResource(R.string.onboarding_language_cta_spanish),
                        style = MaterialTheme.typography.titleSmall,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))

            // Botón secundario: English.
            OutlinedButton(
                onClick = { choose(LocalePreference.ENGLISH) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 32.dp),
                shape = RoundedCornerShape(14.dp),
                contentPadding = PaddingValues(vertical = 14.dp),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("🇬🇧")
                    Text(
                        stringResource(R.string.onboarding_language_cta_english),
                        style = MaterialTheme.typography.titleSmall,
                    )
                }
            }

            Spacer(Modifier.weight(1f))
        }
    }
}
