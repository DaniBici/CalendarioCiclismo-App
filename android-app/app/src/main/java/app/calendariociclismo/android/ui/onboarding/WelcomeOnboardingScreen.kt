package app.calendariociclismo.android.ui.onboarding

import android.Manifest
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.prefs.LocalePreference
import app.calendariociclismo.android.ui.components.AnimatedRouteProfile
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.components.CCHeaderMark
import app.calendariociclismo.android.ui.components.ccSegmentedColors
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

/** Paso de la bienvenida que espera respuesta. */
private enum class WelcomeStep { Language, Notifications, Support }

/**
 * Bienvenida única de la app: idioma, notificaciones y apoyo al proyecto en
 * una sola pantalla. Los pasos aparecen de uno en uno, cada uno al responder
 * el anterior, y el botón de entrada solo se muestra con el tercero. Paridad:
 * `WelcomeOnboardingView.swift`.
 *
 * Cada paso conserva su marca de persistencia (`languageAnnouncementDone`,
 * `notifOnboardingDone` y `supportIntroV43Done`): quien dejó la bienvenida a
 * medias la retoma en su paso, y la recreación de la actividad al cambiar de
 * idioma la devuelve al paso siguiente.
 *
 * Los valores analíticos de `onboarding_step` son los anteriores a la pantalla
 * única, para no partir las series.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WelcomeOnboardingScreen(
    /** `false` mientras el arranque cubre la pantalla: los pasos esperan. */
    active: Boolean,
    onFinish: () -> Unit,
) {
    val app = rememberApp()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptic = rememberHaptics()

    val languageDone: Boolean? by app.preferences.languageAnnouncementDone.collectAsState(initial = null)
    val notifDone: Boolean? by app.preferences.notifOnboardingDone.collectAsState(initial = null)
    val locale by app.preferences.appLocale.collectAsState(initial = LocalePreference.SPANISH)
    val push by app.preferences.pushEnabled.collectAsState(initial = false)
    val friendActive by app.premium.isSubscribed.collectAsState()
    val legacyActive by app.premium.isLegacyPremiumActive.collectAsState()
    val founder by app.premium.isFounder.collectAsState()
    val purchaseStateReady by app.premium.purchaseStateReady.collectAsState()

    val step = when {
        languageDone == null || notifDone == null -> null
        languageDone == false -> WelcomeStep.Language
        notifDone == false -> WelcomeStep.Notifications
        else -> WelcomeStep.Support
    }

    // Tras recrearse la actividad por el cambio de idioma, los pasos ya
    // mostrados no repiten la entrada.
    var shown by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(active) { if (active) shown = true }

    fun log(event: String, stepName: String, action: String? = null) {
        app.analytics.logEvent(event, Bundle().apply {
            putString("onboarding_step", stepName)
            if (action != null) putString("action", action)
        })
    }

    LaunchedEffect(step, shown) {
        if (!shown) return@LaunchedEffect
        when (step) {
            WelcomeStep.Language -> log("onboarding_view", "language_announcement")
            WelcomeStep.Notifications -> log("onboarding_view", "notifications")
            WelcomeStep.Support -> log("onboarding_view", "premium_showcase")
            null -> Unit
        }
    }

    // Hasta que se elige idioma, la bienvenida habla el del dispositivo.
    val deviceEnglish = LocaleHolder.system.language != "es"
    val textContext = remember(step, context) {
        if (step == WelcomeStep.Language) {
            val config = Configuration(context.resources.configuration)
            config.setLocale(Locale(if (deviceEnglish) "en" else "es"))
            context.createConfigurationContext(config)
        } else {
            context
        }
    }
    fun text(@StringRes id: Int): String = textContext.getString(id)

    suspend fun applyLocale(choice: LocalePreference) {
        // LocaleHolder antes que el sistema: lo leen DateFormatting y los
        // modelos en la actividad recreada.
        LocaleHolder.current = Locale(choice.tag)
        app.preferences.setAppLocale(choice)
        app.pushManager.syncCategories()
        withContext(Dispatchers.Main) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.getSystemService(android.app.LocaleManager::class.java)
                    ?.applicationLocales = android.os.LocaleList.forLanguageTags(choice.tag)
            } else {
                androidx.appcompat.app.AppCompatDelegate.setApplicationLocales(
                    androidx.core.os.LocaleListCompat.forLanguageTags(choice.tag),
                )
            }
        }
    }

    fun chooseLanguage(choice: LocalePreference) {
        haptic(Haptics.Event.Selection)
        scope.launch {
            // La marca se guarda antes de aplicar el idioma: cambiarlo recrea
            // la actividad, que debe abrir ya en el paso siguiente.
            app.preferences.setLanguageAnnouncementDone(true)
            log("onboarding_action", "language_announcement", choice.tag)
            // En un dispositivo que no está en español la app arranca con los
            // recursos del sistema aunque la preferencia por defecto sea
            // español: el idioma se aplica también si es el que ya constaba.
            val shownLanguage = context.resources.configuration.locales.get(0)?.language
            if (app.preferences.snapshotAppLocale() != choice || shownLanguage != choice.tag) {
                applyLocale(choice)
            }
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        scope.launch {
            if (granted) {
                haptic(Haptics.Event.Success)
                app.pushManager.subscribe()
            }
            if (!app.preferences.notifOnboardingDone.first()) {
                app.preferences.setNotifOnboardingDone(true)
                log("onboarding_action", "notifications", "accepted")
            }
        }
    }

    fun enableNotifications() {
        if (Build.VERSION.SDK_INT >= 33) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            scope.launch {
                haptic(Haptics.Event.Success)
                app.pushManager.subscribe()
                if (!app.preferences.notifOnboardingDone.first()) {
                    app.preferences.setNotifOnboardingDone(true)
                    log("onboarding_action", "notifications", "accepted")
                }
            }
        }
    }

    fun skipNotifications() {
        scope.launch {
            app.preferences.setNotifOnboardingDone(true)
            log("onboarding_action", "notifications", "skipped")
        }
    }

    fun finish() {
        haptic(Haptics.Event.PrimaryAction)
        scope.launch {
            app.preferences.setSupportIntroV43Done(true)
            log(
                "onboarding_action",
                "premium_showcase",
                when {
                    friendActive -> "continue"
                    founder -> "continue_founder"
                    else -> "continue_free"
                },
            )
            onFinish()
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            val viewportHeight = maxHeight
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = viewportHeight),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Spacer(Modifier.height(34.dp))
                    CCHeaderMark(width = 74.dp)
                    Spacer(Modifier.height(14.dp))
                    Text(
                        text = text(R.string.splash_app_name),
                        style = CCText.S28,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .padding(horizontal = 24.dp)
                            .semantics { heading() },
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = text(R.string.splash_tagline),
                        style = CCText.S16,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 24.dp),
                    )
                    Spacer(Modifier.height(6.dp))
                    AnimatedRouteProfile(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(if (viewportHeight < 700.dp) 104.dp else 146.dp),
                        // Azul de marca en claro, lima en oscuro (acento del tema).
                        lineColor = MaterialTheme.colorScheme.primary,
                        bottomAlpha = 0f,
                    )

                    Column(
                        modifier = Modifier
                            .widthIn(max = 520.dp)
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp)
                            .padding(top = 14.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        StepReveal(visible = shown && step != null) {
                            val pending = step == WelcomeStep.Language
                            StepCard(
                                icon = Icons.Outlined.Language,
                                // Sin idioma elegido, el rótulo va en los dos.
                                title = text(
                                    if (pending) R.string.onboarding_language_title
                                    else R.string.settings_section_language,
                                ),
                                body = null,
                                control = if (pending) null else {
                                    {
                                        val options = listOf(LocalePreference.SPANISH, LocalePreference.ENGLISH)
                                        SingleChoiceSegmentedButtonRow {
                                            options.forEachIndexed { index, option ->
                                                SegmentedButton(
                                                    colors = ccSegmentedColors(),
                                                    selected = option == locale,
                                                    onClick = {
                                                        if (option != locale) {
                                                            haptic(Haptics.Event.Selection)
                                                            scope.launch { applyLocale(option) }
                                                        }
                                                    },
                                                    shape = SegmentedButtonDefaults.itemShape(
                                                        index = index,
                                                        count = options.size,
                                                        baseShape = RoundedCornerShape(CCRadius.Control),
                                                    ),
                                                    icon = {},
                                                ) {
                                                    Text(option.label, style = CCText.S13)
                                                }
                                            }
                                        }
                                    }
                                },
                            ) {
                                if (pending) {
                                    // Los dos idiomas con el mismo peso: ninguno se destaca.
                                    ChoiceRow(
                                        first = LocalePreference.SPANISH.label,
                                        firstProminent = true,
                                        onFirst = { chooseLanguage(LocalePreference.SPANISH) },
                                        second = LocalePreference.ENGLISH.label,
                                        secondProminent = true,
                                        onSecond = { chooseLanguage(LocalePreference.ENGLISH) },
                                    )
                                }
                            }
                        }

                        StepReveal(visible = shown && step != null && step >= WelcomeStep.Notifications) {
                            val pending = step == WelcomeStep.Notifications
                            StepCard(
                                icon = Icons.Outlined.Notifications,
                                title = text(R.string.onboarding_notif_title),
                                body = text(R.string.onboarding_notif_body),
                                control = if (pending) null else {
                                    {
                                        Switch(
                                            checked = push,
                                            onCheckedChange = { enabled ->
                                                if (enabled) {
                                                    enableNotifications()
                                                } else {
                                                    haptic(Haptics.Event.Toggle)
                                                    scope.launch { app.pushManager.unsubscribe() }
                                                }
                                            },
                                        )
                                    }
                                },
                            ) {
                                if (pending) {
                                    ChoiceRow(
                                        first = text(R.string.onboarding_notif_cta),
                                        firstProminent = true,
                                        onFirst = ::enableNotifications,
                                        second = text(R.string.onboarding_notif_skip),
                                        secondProminent = false,
                                        onSecond = ::skipNotifications,
                                    )
                                }
                            }
                        }

                        StepReveal(visible = shown && step == WelcomeStep.Support) {
                            StepCard(
                                icon = Icons.Outlined.FavoriteBorder,
                                iconTint = MaterialTheme.colorScheme.primary,
                                title = text(
                                    if (friendActive) R.string.onboarding_support_title_friend
                                    else R.string.onboarding_support_title,
                                ),
                                body = text(
                                    if (friendActive) R.string.onboarding_support_body_friend
                                    else R.string.onboarding_support_body,
                                ),
                                control = null,
                            ) {
                                // Amigo solo se ofrece tras la primera comprobación
                                // de compras, y nunca a quien ya lo tiene activo.
                                if (!friendActive && purchaseStateReady) {
                                    ChoiceButton(
                                        label = text(
                                            if (legacyActive) R.string.onboarding_support_cta_contributions
                                            else R.string.onboarding_support_cta_try,
                                        ),
                                        prominent = false,
                                        filledInDark = true,
                                        onClick = {
                                            log(
                                                "onboarding_action",
                                                "premium_showcase",
                                                if (legacyActive) "open_contributions" else "open_support",
                                            )
                                            app.premium.presentSupport()
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                            }
                        }
                    }
                }

                StepReveal(visible = shown && step == WelcomeStep.Support) {
                    Column(
                        modifier = Modifier
                            .widthIn(max = 520.dp)
                            .fillMaxWidth()
                            .padding(horizontal = 32.dp)
                            .padding(top = 24.dp, bottom = 32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Button(
                            onClick = ::finish,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(CCRadius.Control),
                            contentPadding = PaddingValues(vertical = 14.dp),
                        ) {
                            Text(
                                text(R.string.onboarding_open),
                                style = CCText.S16,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        Spacer(Modifier.height(14.dp))
                        Text(
                            text = text(R.string.onboarding_settings_note),
                            style = CCText.S12,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }
        }
    }
}

/** Entrada de cada paso: fundido con un desplazamiento corto hacia arriba. */
@Composable
private fun StepReveal(visible: Boolean, content: @Composable () -> Unit) {
    val offset = with(LocalDensity.current) { 12.dp.roundToPx() }
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(450)) + slideInVertically(tween(450)) { offset },
        exit = ExitTransition.None,
    ) {
        content()
    }
}

/**
 * Tarjeta de un paso: icono, título y texto, con el control del paso ya
 * respondido a la derecha y, debajo, las opciones del paso pendiente.
 */
@Composable
private fun StepCard(
    icon: ImageVector,
    title: String,
    body: String?,
    control: (@Composable () -> Unit)?,
    iconTint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    actions: @Composable () -> Unit,
) {
    CCCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .animateContentSize()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.heightIn(min = 36.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = if (control == null && body != null) Alignment.Top else Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = iconTint,
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(title, style = CCText.S14, fontWeight = FontWeight.SemiBold)
                    if (body != null) {
                        Text(
                            body,
                            style = CCText.S12,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                control?.invoke()
            }
            actions()
        }
    }
}

/** Dos opciones de igual ancho; la destacada lleva el acento. */
@Composable
private fun ChoiceRow(
    first: String,
    firstProminent: Boolean,
    onFirst: () -> Unit,
    second: String,
    secondProminent: Boolean,
    onSecond: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ChoiceButton(first, firstProminent, onFirst, Modifier.weight(1f))
        ChoiceButton(second, secondProminent, onSecond, Modifier.weight(1f))
    }
}

/**
 * Opción de un paso con `Button` de Material 3 y el radio de control: la
 * destacada, con el acento; la otra, con el acento al 15 %.
 */
@Composable
private fun ChoiceButton(
    label: String,
    prominent: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    /** El botón de apoyo lleva en oscuro el relleno del botón de entrada. */
    filledInDark: Boolean = false,
) {
    val scheme = MaterialTheme.colorScheme
    // En oscuro el acento atenuado pierde contraste en el botón de apoyo;
    // «Ahora no» queda siempre un nivel por debajo de «Activar».
    val dark = filledInDark && scheme.background.luminance() < 0.5f
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(CCRadius.Control),
        colors = if (prominent || dark) {
            ButtonDefaults.buttonColors()
        } else {
            ButtonDefaults.buttonColors(
                containerColor = scheme.primary.copy(alpha = 0.15f),
                contentColor = scheme.primary,
            )
        },
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(label, style = CCText.S14, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    }
}

