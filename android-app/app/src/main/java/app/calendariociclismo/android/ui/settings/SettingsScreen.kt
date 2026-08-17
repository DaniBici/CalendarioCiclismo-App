package app.calendariociclismo.android.ui.settings

import app.calendariociclismo.android.ui.navigation.Routes
import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Brightness6
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.DirectionsBike
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.navigation.NavController
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.calendar.CalendarSubscription
import app.calendariociclismo.android.calendar.CalendarSubscription.description
import app.calendariociclismo.android.calendar.CalendarSubscription.label
import app.calendariociclismo.android.BuildConfig
import app.calendariociclismo.android.data.premium.PremiumService
import app.calendariociclismo.android.ui.premium.PaywallSheet
import app.calendariociclismo.android.data.prefs.LocalePreference
import app.calendariociclismo.android.data.prefs.NotificationCategoryPreference
import app.calendariociclismo.android.data.prefs.RaceFollowMode
import app.calendariociclismo.android.data.prefs.RaceGroupFilter
import app.calendariociclismo.android.data.prefs.RegionPreference
import app.calendariociclismo.android.data.prefs.ThemePreference
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RegionDetector
import app.calendariociclismo.android.util.rememberHaptics
import kotlinx.coroutines.launch

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(navController: NavController) {
    val app = rememberApp()
    val context = LocalContext.current
    val haptic = rememberHaptics()
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    val offline by app.preferences.offlineEnabled.collectAsState(initial = false)
    val push by app.preferences.pushEnabled.collectAsState(initial = false)
    val analyticsEnabled by app.preferences.analyticsEnabled.collectAsState(initial = false)
    val themePref by app.preferences.themePreference.collectAsState(initial = ThemePreference.SYSTEM)
    val locale by app.preferences.appLocale.collectAsState(initial = LocalePreference.SPANISH)
    val region by app.preferences.regionPreference.collectAsState(initial = RegionPreference.SPAIN)
    val preferredCountryGroup by app.preferences.preferredCountryGroup.collectAsState(initial = null)
    val notificationCategories by app.preferences.notificationCategories
        .collectAsState(initial = NotificationCategoryPreference.DEFAULT_ENABLED)
    val raceFollowMode by app.preferences.raceFollowMode.collectAsState(initial = RaceFollowMode.FOLLOW_ALL)
    val followedRaceIds by app.preferences.followedRaceIds.collectAsState(initial = emptySet())
    val activeRaceFilters by app.preferences.activeRaceFilters.collectAsState(initial = emptySet())
    val followedStageIds by app.preferences.followedStageIds.collectAsState(initial = emptySet())
    val isPremium by app.premium.isSubscribed.collectAsState()
    val legacyPremiumActive by app.premium.isLegacyPremiumActive.collectAsState()
    val isFounder by app.premium.isFounder.collectAsState()
    val supporterIcon by app.premium.supporterIcon.collectAsState()
    val syncState by app.offlineManager.state.collectAsState()
    var hapticsEnabled by remember { mutableStateOf(Haptics.isEnabled(context)) }

    val notifPermLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            haptic(Haptics.Event.Success)
            scope.launch { app.pushManager.subscribe() }
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.tab_settings)) }) }
    ) { pad ->
        LazyColumn(
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(pad),
        ) {
            // ── Apoyo voluntario — primera opción del panel ──
            item {
                Section(title = stringResource(R.string.settings_adfree_header)) {
                    AdFreeSection(
                        isFriend = isPremium,
                        legacyPremiumActive = legacyPremiumActive,
                        isFounder = isFounder,
                        supporterIcon = supporterIcon,
                        onSubscribe = {
                            haptic(Haptics.Event.Selection)
                            app.premium.presentPaywall(PremiumService.PaywallSource.GENERAL)
                        },
                        onManage = { app.premium.cancelSubscription() },
                        onRedeem = {
                            haptic(Haptics.Event.Selection)
                            app.premium.redeemCode()
                        },
                        onIcon = { app.premium.setSupporterIcon(it) },
                        onExplain = {
                            haptic(Haptics.Event.Navigation)
                            val url = if (LocaleHolder.shouldShowEnglishContent) {
                                "https://www.calendariociclismo.app/en/support/"
                            } else {
                                "https://www.calendariociclismo.app/apoyar/"
                            }
                            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
                        },
                    )
                }
            }

            // ── iCal ──
            item {
                Section(title = stringResource(R.string.settings_section_calendar)) {
                    Text(
                        text = stringResource(R.string.settings_calendar_description),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    CalendarSubscription.Feed.entries.forEach { feed ->
                        FeedRow(
                            label = feed.label(context),
                            description = feed.description(context),
                            onClick = {
                                haptic(Haptics.Event.PrimaryAction)
                                CalendarSubscription.subscribe(context, feed)
                            },
                        )
                    }
                }
            }

            // ── Offline ──
            item {
                Section(title = stringResource(R.string.settings_section_offline)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(R.string.settings_offline_title),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                            Text(
                                text = stringResource(R.string.settings_offline_body),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (offline) {
                            OutlinedButton(
                                onClick = {
                                    haptic(Haptics.Event.Warning)
                                    scope.launch { app.offlineManager.disable() }
                                },
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.error,
                                ),
                                border = androidx.compose.foundation.BorderStroke(
                                    1.dp, MaterialTheme.colorScheme.error,
                                ),
                            ) { Text(stringResource(R.string.action_deactivate)) }
                        } else {
                            Button(
                                onClick = {
                                    haptic(Haptics.Event.Success)
                                    scope.launch { app.offlineManager.enable() }
                                },
                            ) { Text(stringResource(R.string.action_activate)) }
                        }
                    }
                    if (syncState.isSyncing) {
                        val syncingCd = stringResource(R.string.settings_offline_syncing_cd)
                        LinearProgressIndicator(
                            progress = { syncState.progress },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(start = 16.dp, end = 16.dp, top = 8.dp)
                                .semantics { contentDescription = syncingCd },
                        )
                        syncState.statusText?.let {
                            Text(
                                text = it,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                            )
                        }
                    } else if (offline) {
                        syncState.lastSyncLabel()?.let {
                            Text(
                                text = stringResource(R.string.settings_offline_last_sync, it),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 16.dp),
                            )
                        }
                        TextButton(
                            onClick = {
                                haptic(Haptics.Event.Success)
                                app.offlineManager.runSyncNow(force = true)
                            },
                            modifier = Modifier.padding(horizontal = 6.dp),
                        ) {
                            Text(stringResource(R.string.settings_offline_update_now))
                        }
                    }
                }
            }

            // ── Notifications ──
            item {
                Section(title = stringResource(R.string.settings_section_notifications)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(R.string.settings_notifications_title),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                            Text(
                                text = stringResource(R.string.settings_notifications_body),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (push) {
                            OutlinedButton(
                                onClick = {
                                    haptic(Haptics.Event.Toggle)
                                    scope.launch { app.pushManager.unsubscribe() }
                                },
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.error,
                                ),
                                border = androidx.compose.foundation.BorderStroke(
                                    1.dp, MaterialTheme.colorScheme.error,
                                ),
                            ) { Text(stringResource(R.string.action_deactivate)) }
                        } else {
                            Button(
                                onClick = {
                                    haptic(Haptics.Event.Success)
                                    if (Build.VERSION.SDK_INT >= 33) {
                                        notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                    } else {
                                        scope.launch { app.pushManager.subscribe() }
                                    }
                                },
                            ) { Text(stringResource(R.string.action_activate)) }
                        }
                    }

                    // Subsección de tipos de notificación: solo visible cuando
                    // push está activo. GENERAL siempre on, resto Premium.
                    if (push) {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = stringResource(R.string.settings_notification_categories_title),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(6.dp))
                        NotificationCategorySelector(
                            enabled = notificationCategories,
                            onToggle = { category, value ->
                                // Categorías enriquecidas liberadas al plan gratuito: sin paywall.
                                if (category == NotificationCategoryPreference.GENERAL) return@NotificationCategorySelector
                                haptic(Haptics.Event.Toggle)
                                val updated = if (value) {
                                    notificationCategories + category
                                } else {
                                    notificationCategories - category
                                }
                                scope.launch {
                                    app.preferences.setNotificationCategories(updated)
                                    app.pushManager.syncCategories()
                                }
                            },
                        )

                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = stringResource(R.string.settings_race_follow_title),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(6.dp))
                        RaceFollowSection(
                            followMode = raceFollowMode,
                            followedRaceIds = followedRaceIds,
                            activeFilters = activeRaceFilters,
                            onModeChange = { mode ->
                                haptic(Haptics.Event.Selection)
                                scope.launch {
                                    app.preferences.setRaceFollowMode(mode)
                                    if (mode == RaceFollowMode.FOLLOW_ALL) {
                                        app.preferences.setFollowedRaceIds(emptySet())
                                        app.preferences.setActiveRaceFilters(emptySet())
                                    }
                                    app.pushManager.syncCategories()
                                }
                            },
                            onFilterToggle = { filter, value ->
                                haptic(Haptics.Event.Toggle)
                                val updated = if (value) activeRaceFilters + filter else activeRaceFilters - filter
                                scope.launch {
                                    app.preferences.setActiveRaceFilters(updated)
                                    app.pushManager.syncCategories()
                                }
                            },
                            onNavigateFollowedRaces = { navController.navigate(Routes.followedRaces) },
                            followedStageIds = followedStageIds,
                            onNavigateFollowedStages = { navController.navigate(Routes.FOLLOWED_STAGES) },
                        )
                    }
                }
            }

            // ── Experiencia ──
            item {
                Section(title = stringResource(R.string.settings_section_experience)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .semantics(mergeDescendants = true) { },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(R.string.settings_haptics_title),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                            Text(
                                text = stringResource(R.string.settings_haptics_body),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = hapticsEnabled,
                            onCheckedChange = { enabled ->
                                Haptics.setEnabled(context, enabled)
                                hapticsEnabled = enabled
                                if (enabled) haptic(Haptics.Event.Toggle)
                            },
                        )
                    }
                }
            }

            // ── Idioma (es / en, ambos gratuitos) ──
            item {
                Section(title = stringResource(R.string.settings_section_language)) {
                    Text(
                        text = stringResource(R.string.settings_language_description),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(10.dp))
                    LocalePreferenceSelector(
                        selected = locale,
                        onSelect = { newValue ->
                            if (newValue == locale) return@LocalePreferenceSelector
                            haptic(Haptics.Event.Selection)
                            scope.launch {
                                // 1. Actualizar LocaleHolder antes de todo — es
                                //    la fuente que leen Race.localizedName y stageLabel.
                                LocaleHolder.current = java.util.Locale(newValue.tag)
                                // 2. Persistir en DataStore. Suspend — esperamos a que
                                //    termine antes de recrear la activity, eliminando
                                //    la race condition con onCreate.snapshotAppLocale().
                                app.preferences.setAppLocale(newValue)
                                // 3. Sincronizar token push con nuevo idioma.
                                app.pushManager.syncCategories()
                                // 4. Aplicar locale al sistema en el hilo principal.
                                //    La activity se recrea justo aquí; DataStore ya
                                //    tiene el valor nuevo así que onCreate lo leerá bien.
                                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                                        context.getSystemService(android.app.LocaleManager::class.java)
                                            ?.applicationLocales = android.os.LocaleList.forLanguageTags(newValue.tag)
                                    } else {
                                        androidx.appcompat.app.AppCompatDelegate
                                            .setApplicationLocales(
                                                androidx.core.os.LocaleListCompat
                                                    .forLanguageTags(newValue.tag),
                                            )
                                    }
                                }
                            }
                        },
                    )
                }
            }

            // ── Región (filtro de broadcasts; SPAIN gratis, resto Premium) ──
            item {
                Section(title = stringResource(R.string.settings_section_region)) {
                    Text(
                        text = stringResource(R.string.settings_region_description),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(10.dp))
                    RegionPreferenceSelector(
                        selected = region,
                        preferredCountryGroup = preferredCountryGroup,
                        onSelect = { newValue ->
                            // Todas las regiones liberadas al plan gratuito: sin paywall.
                            if (newValue == region) return@RegionPreferenceSelector
                            haptic(Haptics.Event.Selection)
                            scope.launch { app.preferences.setRegionPreference(newValue) }
                        },
                        onSelectCountry = { newGroup ->
                            haptic(Haptics.Event.Selection)
                            scope.launch {
                                app.preferences.setPreferredCountryGroup(newGroup)
                                // Re-sincroniza el push token con el nuevo grupo fino.
                                app.pushManager.syncCategories()
                            }
                        },
                    )
                }
            }

            // ── Apariencia (tema claro / oscuro / automático) ──
            item {
                Section(title = stringResource(R.string.settings_section_appearance)) {
                    Text(
                        text = stringResource(R.string.settings_appearance_description),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(10.dp))
                    ThemePreferenceSelector(
                        selected = themePref,
                        onSelect = { newValue ->
                            if (newValue != themePref) {
                                haptic(Haptics.Event.Selection)
                                scope.launch { app.preferences.setThemePreference(newValue) }
                            }
                        },
                    )
                }
            }

            // ── Privacy ──
            item {
                Section(title = stringResource(R.string.settings_section_privacy)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .semantics(mergeDescendants = true) { },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(R.string.settings_privacy_analytics_title),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                            Text(
                                text = stringResource(R.string.settings_privacy_analytics_body),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = analyticsEnabled,
                            onCheckedChange = { enabled ->
                                haptic(Haptics.Event.Toggle)
                                scope.launch { app.analytics.setEnabled(enabled) }
                            },
                            // Colores de marca explícitos: el Switch de M3 sin
                            // `colors` tira de roles (p. ej. primaryContainer) que
                            // el tema no sobreescribe → el thumb salía rosado. Se
                            // fija el azul de marca para checked/unchecked.
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
                                checkedTrackColor = MaterialTheme.colorScheme.primary,
                                checkedBorderColor = MaterialTheme.colorScheme.primary,
                                uncheckedThumbColor = MaterialTheme.colorScheme.outline,
                                uncheckedTrackColor = MaterialTheme.colorScheme.surfaceVariant,
                                uncheckedBorderColor = MaterialTheme.colorScheme.outline,
                            ),
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = stringResource(R.string.settings_privacy_delete_body),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = {
                            haptic(Haptics.Event.Warning)
                            scope.launch {
                                app.pushManager.deleteAllData()
                                app.repository.clearAll()
                            }
                        },
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error,
                        ),
                        border = androidx.compose.foundation.BorderStroke(
                            1.dp, MaterialTheme.colorScheme.error,
                        ),
                    ) {
                        Text(stringResource(R.string.settings_privacy_delete_button))
                    }
                }
            }

        }

    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    // Misma tarjeta neutra (gris frío) que el detalle. Antes Surface con
    // tonalElevation, que aplicaba el tinte de elevación de M3 (rosado).
    CCCard(cornerRadius = 14) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(6.dp))
            content()
        }
    }
}

@Composable
private fun FeedRow(label: String, description: String, onClick: () -> Unit) {
    val subscribeCd = stringResource(R.string.settings_calendar_subscribe_cd, label)
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.bodyLarge)
                Text(
                    description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(
                onClick = onClick,
                modifier = Modifier.semantics { contentDescription = subscribeCd },
            ) { Text(stringResource(R.string.action_subscribe)) }
        }
        HorizontalDivider()
    }
}

/**
 * Selector de idioma estilo lista. Ambas opciones (es/en) son gratuitas.
 */
@Composable
private fun LocalePreferenceSelector(
    selected: LocalePreference,
    onSelect: (LocalePreference) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            LocaleOptionRow(
                option = LocalePreference.SPANISH,
                flag = "🇪🇸",
                selected = selected == LocalePreference.SPANISH,
                onClick = { onSelect(LocalePreference.SPANISH) },
            )
            LocaleOptionRow(
                option = LocalePreference.ENGLISH,
                flag = "🇬🇧",
                selected = selected == LocalePreference.ENGLISH,
                onClick = { onSelect(LocalePreference.ENGLISH) },
            )
        }
    }
}

@Composable
private fun LocaleOptionRow(
    option: LocalePreference,
    flag: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 6.dp, horizontal = 4.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.primary.copy(alpha = if (selected) 0.18f else 0.12f),
            modifier = Modifier.size(28.dp),
        ) {
            androidx.compose.foundation.layout.Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Text(flag, style = MaterialTheme.typography.bodyLarge)
            }
        }
        Text(
            text = option.label,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontWeight = if (selected) androidx.compose.ui.text.font.FontWeight.SemiBold
                             else androidx.compose.ui.text.font.FontWeight.Normal,
            ),
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.height(18.dp),
            )
        }
    }
}

/**
 * Selector de región estilo lista. Cualquier opción es clicable: si el
 * usuario no es Premium y elige una región Premium, [onSelect] dispara
 * el paywall en lugar de cambiar la preferencia.
 */
@Composable
private fun RegionPreferenceSelector(
    selected: RegionPreference,
    preferredCountryGroup: String?,
    onSelect: (RegionPreference) -> Unit,
    onSelectCountry: (String?) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (option in RegionPreference.entries) {
                // Todas las regiones liberadas al plan gratuito: nunca bloqueadas.
                RegionOptionRow(
                    option = option,
                    flag = regionFlagEmoji(option),
                    selected = selected == option,
                    locked = false,
                    hint = null,
                    onClick = { onSelect(option) },
                )
                // Sub-selector inline para el bucket activo (salvo SPAIN con un
                // único grupo y ALL que usa siempre TZ).
                if (selected == option && option.availableCountryGroups.size > 1) {
                    CountryGroupSubSelector(
                        bucket = option,
                        selected = preferredCountryGroup,
                        onSelect = onSelectCountry,
                    )
                }
            }
        }
    }
}

@Composable
private fun CountryGroupSubSelector(
    bucket: RegionPreference,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    val groups = bucket.availableCountryGroups
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.06f),
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 36.dp, top = 2.dp, bottom = 4.dp),
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = stringResource(R.string.settings_region_country_label),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 6.dp, top = 2.dp, bottom = 2.dp),
            )
            CountryGroupRow(
                emoji = "📍",
                label = stringResource(R.string.settings_region_country_auto),
                selected = selected == null,
                onClick = { onSelect(null) },
            )
            for (group in groups) {
                val labelRes = RegionDetector.countryGroupLabelRes(group)
                CountryGroupRow(
                    emoji = RegionDetector.countryGroupEmoji(group),
                    label = if (labelRes != null) stringResource(labelRes) else group,
                    selected = selected == group,
                    onClick = { onSelect(group) },
                )
            }
        }
    }
}

@Composable
private fun CountryGroupRow(
    emoji: String,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = !selected) { onClick() }
            .padding(vertical = 4.dp, horizontal = 6.dp),
    ) {
        Text(
            text = emoji,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.size(22.dp).padding(top = 2.dp),
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall.copy(
                fontWeight = if (selected) androidx.compose.ui.text.font.FontWeight.SemiBold
                             else androidx.compose.ui.text.font.FontWeight.Normal,
            ),
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.height(14.dp),
            )
        }
    }
}

@Composable
private fun RegionOptionRow(
    option: RegionPreference,
    flag: String,
    selected: Boolean,
    locked: Boolean,
    hint: String?,
    onClick: () -> Unit,
) {
    val rowAlpha = if (locked) 0.7f else 1f
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 6.dp, horizontal = 4.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.primary.copy(alpha = if (selected) 0.18f else 0.12f),
            modifier = Modifier.size(28.dp),
        ) {
            androidx.compose.foundation.layout.Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Text(flag, style = MaterialTheme.typography.bodyLarge)
            }
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(option.labelRes),
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = if (selected) androidx.compose.ui.text.font.FontWeight.SemiBold
                                 else androidx.compose.ui.text.font.FontWeight.Normal,
                ),
                color = if (locked) MaterialTheme.colorScheme.onSurfaceVariant
                        else MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.alpha(rowAlpha),
            )
            if (hint != null) {
                Text(
                    text = hint,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                )
            }
        }
        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.height(18.dp),
            )
        } else if (locked) {
            Icon(
                imageVector = Icons.Filled.Lock,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.height(16.dp),
            )
        }
    }
}

private fun regionFlagEmoji(region: RegionPreference): String = when (region) {
    RegionPreference.SPAIN -> "🇪🇸"
    RegionPreference.EUROPE -> "🇪🇺"
    RegionPreference.AMERICAS -> "🌎"
    RegionPreference.ASIA -> "🌏"
    RegionPreference.AFRICA -> "🌍"
    RegionPreference.ALL -> "🌐"
}

@Composable
private fun NotificationCategorySelector(
    enabled: Set<NotificationCategoryPreference>,
    onToggle: (NotificationCategoryPreference, Boolean) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            val all = NotificationCategoryPreference.entries
            for ((index, option) in all.withIndex()) {
                // Categorías enriquecidas liberadas al plan gratuito: nunca bloqueadas.
                NotificationCategoryRow(
                    option = option,
                    enabled = enabled.contains(option),
                    locked = false,
                    onToggle = { value -> onToggle(option, value) },
                )
                if (index < all.size - 1) {
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 44.dp),
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f),
                    )
                }
            }
        }
    }
}

@Composable
private fun NotificationCategoryRow(
    option: NotificationCategoryPreference,
    enabled: Boolean,
    locked: Boolean,
    onToggle: (Boolean) -> Unit,
) {
    val isLockedOn = option == NotificationCategoryPreference.GENERAL
    val rowAlpha = if (locked) 0.7f else 1f

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = locked) { onToggle(true) }
            .padding(vertical = 8.dp, horizontal = 4.dp),
    ) {
        Column(modifier = Modifier.weight(1f).alpha(rowAlpha)) {
            Text(
                text = stringResource(option.labelRes),
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = if (enabled) androidx.compose.ui.text.font.FontWeight.SemiBold
                                 else androidx.compose.ui.text.font.FontWeight.Normal,
                ),
                color = if (locked) MaterialTheme.colorScheme.onSurfaceVariant
                        else MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = if (locked)
                    stringResource(R.string.settings_notification_category_premium_hint)
                else
                    stringResource(option.descriptionRes),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
            )
        }
        Switch(
            checked = enabled,
            onCheckedChange = { value ->
                if (isLockedOn || locked) return@Switch
                onToggle(value)
            },
            enabled = !isLockedOn && !locked,
        )
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun ThemePreferenceSelector(
    selected: ThemePreference,
    onSelect: (ThemePreference) -> Unit,
) {
    val options = ThemePreference.entries
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        options.forEachIndexed { index, option ->
            val icon = when (option) {
                ThemePreference.SYSTEM -> Icons.Filled.Brightness6
                ThemePreference.LIGHT  -> Icons.Filled.LightMode
                ThemePreference.DARK   -> Icons.Filled.DarkMode
            }
            val optionLabel = stringResource(option.labelRes)
            val themeCd = stringResource(R.string.settings_theme_cd, optionLabel)
            SegmentedButton(
                selected = option == selected,
                onClick = { onSelect(option) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = options.size),
                icon = {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                    )
                },
                modifier = Modifier.semantics {
                    contentDescription = themeCd
                },
            ) {
                Text(optionLabel)
            }
        }
    }
}

// MARK: - Premium

@Composable
private fun PremiumCTACard(onTap: () -> Unit) {
    Surface(
        onClick = onTap,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Filled.CalendarMonth,
                    contentDescription = null,
                    tint = androidx.compose.ui.graphics.Color(0xFFF6A623),
                    modifier = Modifier.size(18.dp),
                )
                Icon(
                    imageVector = Icons.Filled.DirectionsBike,
                    contentDescription = null,
                    tint = androidx.compose.ui.graphics.Color(0xFFF6A623),
                    modifier = Modifier.size(18.dp),
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.settings_premium_cta_title),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                )
                Text(
                    text = stringResource(R.string.settings_premium_cta_body),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PremiumActiveCard(onManage: () -> Unit, onRedeemCode: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.CalendarMonth,
                        contentDescription = null,
                        tint = androidx.compose.ui.graphics.Color(0xFFF6A623),
                        modifier = Modifier.size(18.dp),
                    )
                    Icon(
                        imageVector = Icons.Filled.DirectionsBike,
                        contentDescription = null,
                        tint = androidx.compose.ui.graphics.Color(0xFFF6A623),
                        modifier = Modifier.size(18.dp),
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = stringResource(R.string.settings_premium_active_title),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                    )
                    Text(
                        text = stringResource(R.string.settings_premium_active_body),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
            TextButton(
                onClick = onManage,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.settings_premium_manage))
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
            TextButton(
                onClick = onRedeemCode,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.settings_premium_redeem_code))
            }
        }
    }
}

/**
 * Solo se compila en builds Debug. Permite forzar el flag Premium para
 * validar la UI sin SDK ni compras reales.
 */
@Composable
private fun PremiumDebugCard(
    isSubscribed: Boolean,
    onToggle: (Boolean) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Surface(
                shape = RoundedCornerShape(3),
                color = androidx.compose.ui.graphics.Color(0xFFF59E0B).copy(alpha = 0.15f),
            ) {
                Text(
                    "DEBUG",
                    style = MaterialTheme.typography.labelSmall,
                    color = androidx.compose.ui.graphics.Color(0xFFF59E0B),
                    fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Forzar suscripción Premium",
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                    )
                    Text(
                        text = "Toggle solo visible en builds Debug.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = isSubscribed,
                    onCheckedChange = { onToggle(it) },
                )
            }
        }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun RaceFollowSection(
    followMode: RaceFollowMode,
    followedRaceIds: Set<String>,
    activeFilters: Set<RaceGroupFilter>,
    onModeChange: (RaceFollowMode) -> Unit,
    onFilterToggle: (RaceGroupFilter, Boolean) -> Unit,
    onNavigateFollowedRaces: () -> Unit,
    followedStageIds: Set<String> = emptySet(),
    onNavigateFollowedStages: () -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    androidx.compose.material3.Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // Segmented selector
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                listOf(
                    RaceFollowMode.FOLLOW_ALL to stringResource(R.string.race_follow_mode_all),
                    RaceFollowMode.FOLLOW_RACES to stringResource(R.string.race_follow_mode_races),
                    RaceFollowMode.FOLLOW_FILTERS to stringResource(R.string.race_follow_mode_filters),
                ).forEachIndexed { idx, (mode, label) ->
                    SegmentedButton(
                        selected = followMode == mode,
                        onClick = { onModeChange(mode) },
                        shape = SegmentedButtonDefaults.itemShape(idx, 3),
                        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            when (followMode) {
                RaceFollowMode.FOLLOW_ALL -> Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Notifications,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        text = stringResource(R.string.race_notifications_mode_keep_all),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                RaceFollowMode.FOLLOW_RACES -> Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = onNavigateFollowedRaces),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Favorite,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        text = if (followedRaceIds.isEmpty()) stringResource(R.string.followed_races_empty_title)
                        else stringResource(R.string.followed_races_title) + " (${followedRaceIds.size})",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(
                        imageVector = Icons.Filled.ChevronRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.size(16.dp),
                    )
                }

                RaceFollowMode.FOLLOW_FILTERS -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    RaceGroupFilter.entries.forEach { filter ->
                        val isActive = filter in activeFilters
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onFilterToggle(filter, !isActive) }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                text = stringResource(filter.labelRes),
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.weight(1f),
                            )
                            Switch(
                                checked = isActive,
                                onCheckedChange = { onFilterToggle(filter, it) },
                                modifier = Modifier.size(40.dp, 24.dp),
                            )
                        }
                    }
                }
            }
        }
    }

    // Jornadas seguidas — siempre visible (independiente del modo de carreras)
    androidx.compose.material3.Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onNavigateFollowedStages),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.CalendarMonth,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = if (followedStageIds.isEmpty()) stringResource(R.string.followed_stages_empty_title)
                else stringResource(R.string.followed_stages_title) + " (${followedStageIds.size})",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            Icon(
                imageVector = Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.outline,
                modifier = Modifier.size(16.dp),
            )
        }
    }
    } // end Column wrapper
}

/** Icono identitario de "sin anuncios": calendario + bici (paridad con paywall e iOS). */
@Composable
private fun AdFreeIcon() {
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Icon(
            imageVector = Icons.Filled.CalendarMonth,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = Color(0xFFF6A623),
        )
        Icon(
            imageVector = Icons.Filled.DirectionsBike,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = Color(0xFFF6A623),
        )
    }
}

@Composable
private fun AdFreeSection(
    isFriend: Boolean,
    legacyPremiumActive: Boolean,
    isFounder: Boolean,
    supporterIcon: String,
    onSubscribe: () -> Unit,
    onManage: () -> Unit,
    onRedeem: () -> Unit,
    onIcon: (PremiumService.SupporterIcon) -> Unit,
    onExplain: () -> Unit,
) {
    if (legacyPremiumActive) {
        SupportStatus(
            title = LocaleHolder.t("Fundador", "Founder"),
            body = LocaleHolder.t(
                "Tu Premium anterior no se convertirá en otra suscripción. Conservas para siempre el icono Fundador.",
                "Your previous Premium plan will not become another subscription. You keep the Founder icon permanently.",
            ),
        )
    } else if (isFriend) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AdFreeIcon()
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = LocaleHolder.t("Amigo activo", "Friend active"),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    text = LocaleHolder.t(
                        "Gracias por ayudar a sostener el proyecto.",
                        "Thank you for helping sustain the project.",
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onManage) {
            Text(stringResource(R.string.settings_adfree_manage))
        }
        TextButton(onClick = onRedeem) {
            Text(stringResource(R.string.settings_adfree_redeem))
        }
    } else if (isFounder) {
        SupportStatus(
            title = LocaleHolder.t("Fundador", "Founder"),
            body = LocaleHolder.t(
                "Conservas para siempre el reconocimiento y el icono Fundador.",
                "You permanently keep the Founder recognition and icon.",
            ),
        )
        SupportCTA(onSubscribe)
    } else {
        SupportCTA(onSubscribe)
        Spacer(Modifier.height(4.dp))
        TextButton(onClick = onRedeem) {
            Text(stringResource(R.string.settings_adfree_redeem))
        }
    }

    if (isFounder || isFriend) {
        Spacer(Modifier.height(12.dp))
        Text(
            LocaleHolder.t("Icono de la aplicación", "App icon"),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconChoice(
                LocaleHolder.t("Original", "Original"),
                Color(0xFF1A73E8),
                Color.White,
                null,
                supporterIcon == "default",
                useAppIcon = true,
            ) { onIcon(PremiumService.SupporterIcon.DEFAULT) }
            if (isFounder) {
                IconChoice(
                    LocaleHolder.t("Fundador", "Founder"),
                    Color(0xFF101828),
                    Color(0xFFF6A623),
                    Icons.Filled.AutoAwesome,
                    supporterIcon == "founder",
                ) { onIcon(PremiumService.SupporterIcon.FOUNDER) }
            }
            if (isFriend) {
                IconChoice(
                    LocaleHolder.t("Amigo", "Friend"),
                    Color.White,
                    Color(0xFF1A73E8),
                    Icons.Filled.Favorite,
                    supporterIcon == "friend",
                ) { onIcon(PremiumService.SupporterIcon.FRIEND) }
            }
        }
    }

    Spacer(Modifier.height(8.dp))
    Text(
        text = stringResource(R.string.settings_adfree_nonprofit_note),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    TextButton(onClick = onExplain, modifier = Modifier.fillMaxWidth()) {
        Text(LocaleHolder.t(
            "Por qué ahora es gratis y sin anuncios",
            "Why it is now free and ad-free",
        ))
    }
}

@Composable
private fun SupportStatus(title: String, body: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        AdFreeIcon()
        Column {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text(body, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SupportCTA(onSubscribe: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onSubscribe),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdFreeIcon()
        Column(modifier = Modifier.weight(1f)) {
            Text(LocaleHolder.t("Hazte Amigo de Calendario Ciclismo", "Become a Friend of Calendario Ciclismo"))
            Text(
                LocaleHolder.t(
                    "Una aportación voluntaria para sostener un proyecto abierto y gratuito.",
                    "A voluntary contribution to sustain an open and free project.",
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(Icons.Filled.ChevronRight, contentDescription = null, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun RowScope.IconChoice(
    label: String,
    backgroundColor: Color,
    foregroundColor: Color,
    badge: androidx.compose.ui.graphics.vector.ImageVector?,
    selected: Boolean,
    useAppIcon: Boolean = false,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = Color.Transparent,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.weight(1f),
    ) {
        Column(
            modifier = Modifier.padding(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .background(backgroundColor, RoundedCornerShape(9.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (useAppIcon) {
                    Icon(
                        painter = painterResource(id = R.mipmap.ic_launcher),
                        contentDescription = null,
                        tint = Color.Unspecified,
                        modifier = Modifier.size(42.dp),
                    )
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                        Icon(Icons.Filled.CalendarMonth, contentDescription = null, tint = foregroundColor, modifier = Modifier.size(15.dp))
                        Icon(Icons.Filled.DirectionsBike, contentDescription = null, tint = foregroundColor, modifier = Modifier.size(15.dp))
                    }
                    badge?.let {
                        Icon(
                            imageVector = it,
                            contentDescription = null,
                            tint = foregroundColor,
                            modifier = Modifier.align(Alignment.TopEnd).padding(3.dp).size(10.dp),
                        )
                    }
                }
            }
            Text(label, style = MaterialTheme.typography.labelSmall)
            if (selected) Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(14.dp))
        }
    }
}
