package app.calendariociclismo.android.data.prefs

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.calendariociclismo.android.util.Constants
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * Wrapper tipado sobre DataStore Preferences.
 *
 * Almacena los toggles de la app:
 * - offline mode
 * - push notifications
 * - categoría seleccionada en "Hoy"
 * - onboarding completado
 * - última sincronización exitosa
 */
private val Context.dataStore by preferencesDataStore(name = "cc_prefs")

class AppPreferences(private val context: Context) {

    private object Keys {
        val OFFLINE_ENABLED = booleanPreferencesKey("offline_enabled")
        val PUSH_ENABLED = booleanPreferencesKey("push_enabled")
        val PUSH_TOKEN = stringPreferencesKey("push_token")
        val CATEGORY = stringPreferencesKey("category_filter")
        val DEFAULT_FILTER = stringPreferencesKey("default_filter")
        val ONBOARDING_DONE = booleanPreferencesKey("onboarding_done")
        val NOTIF_ONBOARDING_DONE = booleanPreferencesKey("notif_onboarding_done")
        val OFFLINE_ONBOARDING_DONE = booleanPreferencesKey("offline_onboarding_done")
        val LANGUAGE_ANNOUNCEMENT_DONE = booleanPreferencesKey("language_announcement_done")
        val LAST_SYNC_EPOCH = longPreferencesKey("last_sync_epoch")
        val LAST_SYNC_RESULT = stringPreferencesKey("last_sync_result")
        val LAST_OFFLINE_SYNC_ATTEMPT_EPOCH = longPreferencesKey("last_offline_sync_attempt_epoch")
        val OFFLINE_CACHE_SCHEMA_VERSION = intPreferencesKey("offline_cache_schema_version")
        val ANALYTICS_ENABLED = booleanPreferencesKey("analytics_enabled")
        val ANALYTICS_ONBOARDING_DONE = booleanPreferencesKey("analytics_onboarding_done")
        val THEME_PREFERENCE = stringPreferencesKey("theme_preference")
        val LAST_WIDGET_REFRESH_AT = longPreferencesKey("last_widget_refresh_at")
        val APP_LOCALE = stringPreferencesKey("app_locale")
        val REGION_PREFERENCE = stringPreferencesKey("region_preference")
        val PREFERRED_COUNTRY_GROUP = stringPreferencesKey("preferred_country_group")
        val NOTIFICATION_CATEGORIES = stringPreferencesKey("notification_categories")
        val PREMIUM_SUBSCRIBED = booleanPreferencesKey("premium_subscribed")
        val FRIEND_SUBSCRIBED = booleanPreferencesKey("friend_subscribed")
        val FOUNDER_RECOGNIZED = booleanPreferencesKey("founder_recognized")
        val SUPPORTER_ICON = stringPreferencesKey("supporter_icon")
        val PREVIOUS_SUPPORTER_ICON = stringPreferencesKey("supporter_icon_previous")
        val CONTRIBUTION_COUNT = intPreferencesKey("supporter_contribution_count")
        val ADS_INTRO_V4_DONE = booleanPreferencesKey("ads_intro_v4_done")
        val CONTRIBUTION_INTRO_V4_2_3_1_DONE = booleanPreferencesKey("contribution_intro_v4_2_3_1_done")
        val SUPPORT_INTRO_V4_3_DONE = booleanPreferencesKey("support_intro_v4_3_done")
        val SUPPORT_INTRO_V4_3_NEW_INSTALLATION = booleanPreferencesKey("support_intro_v4_3_new_installation")
        val CONTRIBUTION_FIRST_VIEW_AT = longPreferencesKey("contribution_prompt_v4_2_4_first_view_at")
        val CONTRIBUTION_VIEW_COUNT = intPreferencesKey("contribution_prompt_v4_2_4_view_count")
        val CONTRIBUTION_PROMPT_COUNT = intPreferencesKey("contribution_prompt_v4_2_4_prompt_count")
        val CONTRIBUTION_LAST_PROMPT_AT = longPreferencesKey("contribution_prompt_v4_2_4_last_prompt_at")
        val CONTRIBUTION_LAST_PROMPT_VIEWS = intPreferencesKey("contribution_prompt_v4_2_4_last_prompt_views")
        val RACE_FOLLOW_MODE = stringPreferencesKey("race_follow_mode")
        val FOLLOWED_RACE_IDS = stringPreferencesKey("followed_race_ids")
        val RACE_GROUP_FILTERS = stringPreferencesKey("race_group_filters")
        val FOLLOWED_STAGE_IDS = stringPreferencesKey("followed_stage_ids")
        val CALENDAR_SUBVIEW = stringPreferencesKey("calendar_subview")
    }

    private val data: Flow<Preferences> = context.dataStore.data

    // ─── Offline ───
    val offlineEnabled: Flow<Boolean> = data.map { it[Keys.OFFLINE_ENABLED] ?: false }
    suspend fun setOfflineEnabled(value: Boolean) {
        context.dataStore.edit { it[Keys.OFFLINE_ENABLED] = value }
    }

    // ─── Push ───
    val pushEnabled: Flow<Boolean> = data.map { it[Keys.PUSH_ENABLED] ?: false }
    suspend fun setPushEnabled(value: Boolean) {
        context.dataStore.edit { it[Keys.PUSH_ENABLED] = value }
    }

    val pushToken: Flow<String?> = data.map { it[Keys.PUSH_TOKEN] }
    suspend fun setPushToken(token: String?) {
        context.dataStore.edit {
            if (token == null) it.remove(Keys.PUSH_TOKEN) else it[Keys.PUSH_TOKEN] = token
        }
    }

    // ─── Category filter (legacy — usado solo por snapshotCategoryFilter) ───
    val categoryFilter: Flow<Constants.CategoryFilter> = data.map { prefs ->
        val stored = prefs[Keys.CATEGORY] ?: Constants.CategoryFilter.ALL.name
        runCatching { Constants.CategoryFilter.valueOf(stored) }.getOrDefault(Constants.CategoryFilter.ALL)
    }
    suspend fun setCategoryFilter(value: Constants.CategoryFilter) {
        context.dataStore.edit { it[Keys.CATEGORY] = value.name }
    }

    // ─── Filtro por defecto global (compartido entre Hoy, Mes y Temporada) ───
    val defaultFilter: Flow<Constants.CategoryFilter> = data.map { prefs ->
        val stored = prefs[Keys.DEFAULT_FILTER] ?: Constants.CategoryFilter.ALL.name
        runCatching { Constants.CategoryFilter.valueOf(stored) }.getOrDefault(Constants.CategoryFilter.ALL)
    }
    suspend fun setDefaultFilter(value: Constants.CategoryFilter) {
        context.dataStore.edit { it[Keys.DEFAULT_FILTER] = value.name }
    }
    suspend fun clearDefaultFilter() {
        context.dataStore.edit { it.remove(Keys.DEFAULT_FILTER) }
    }

    // ─── Onboarding ───
    val onboardingDone: Flow<Boolean> = data.map { it[Keys.ONBOARDING_DONE] ?: false }
    suspend fun setOnboardingDone(value: Boolean) {
        context.dataStore.edit { it[Keys.ONBOARDING_DONE] = value }
    }

    // ─── Onboarding (per step) ───
    val notifOnboardingDone: Flow<Boolean> = data.map { it[Keys.NOTIF_ONBOARDING_DONE] ?: false }
    suspend fun setNotifOnboardingDone(value: Boolean) {
        context.dataStore.edit { it[Keys.NOTIF_ONBOARDING_DONE] = value }
    }

    val offlineOnboardingDone: Flow<Boolean> = data.map { it[Keys.OFFLINE_ONBOARDING_DONE] ?: false }
    suspend fun setOfflineOnboardingDone(value: Boolean) {
        context.dataStore.edit { it[Keys.OFFLINE_ONBOARDING_DONE] = value }
    }

    // Pantalla one-shot que anuncia "inglés ya es gratis" (2.1). `true` tras
    // que el usuario elija en `LanguageAnnouncementOnboardingScreen`.
    val languageAnnouncementDone: Flow<Boolean> = data.map { it[Keys.LANGUAGE_ANNOUNCEMENT_DONE] ?: false }
    suspend fun setLanguageAnnouncementDone(value: Boolean) {
        context.dataStore.edit { it[Keys.LANGUAGE_ANNOUNCEMENT_DONE] = value }
    }
    suspend fun snapshotLanguageAnnouncementDone(): Boolean = languageAnnouncementDone.first()

    // ─── Sync meta ───
    val lastSyncEpoch: Flow<Long?> = data.map { it[Keys.LAST_SYNC_EPOCH] }
    val lastSyncResult: Flow<String?> = data.map { it[Keys.LAST_SYNC_RESULT] }

    suspend fun recordSync(epochSeconds: Long, result: String) {
        context.dataStore.edit {
            it[Keys.LAST_SYNC_EPOCH] = epochSeconds
            it[Keys.LAST_SYNC_RESULT] = result
        }
    }

    // Se registra antes de tocar la red para que el cooldown sobreviva a
    // reinicios del proceso y a reintentos de WorkManager.
    val lastOfflineSyncAttemptEpoch: Flow<Long> = data.map {
        it[Keys.LAST_OFFLINE_SYNC_ATTEMPT_EPOCH] ?: 0L
    }
    suspend fun setLastOfflineSyncAttemptEpoch(value: Long) {
        context.dataStore.edit { it[Keys.LAST_OFFLINE_SYNC_ATTEMPT_EPOCH] = value }
    }

    // ─── Esquema de caché offline ───
    // Se incrementa cuando añadimos nuevos tipos de artefactos (docs R2,
    // banderas, logos…) — al detectarse un valor stored < actual, se fuerza
    // un sync de migración para que los usuarios ya existentes reciban los
    // nuevos artefactos sin esperar al sync periódico.
    val offlineCacheSchemaVersion: Flow<Int> = data.map {
        it[Keys.OFFLINE_CACHE_SCHEMA_VERSION] ?: 0
    }
    suspend fun setOfflineCacheSchemaVersion(value: Int) {
        context.dataStore.edit { it[Keys.OFFLINE_CACHE_SCHEMA_VERSION] = value }
    }

    // ─── Analytics ───
    // Default `true`: opt-out. La recolección está activa por defecto y el usuario
    // puede desactivarla en Ajustes → Privacidad. Antes era opt-in con un onboarding
    // dedicado, pero el flujo causaba que la mayoría de instalaciones quedasen sin
    // contar (ni siquiera disparaban `first_open` en GA4) porque Firebase arrancaba
    // con la recolección apagada por manifest.
    val analyticsEnabled: Flow<Boolean> = data.map { it[Keys.ANALYTICS_ENABLED] ?: true }
    suspend fun setAnalyticsEnabled(value: Boolean) {
        context.dataStore.edit { it[Keys.ANALYTICS_ENABLED] = value }
    }

    val analyticsOnboardingDone: Flow<Boolean> = data.map { it[Keys.ANALYTICS_ONBOARDING_DONE] ?: false }
    suspend fun setAnalyticsOnboardingDone(value: Boolean) {
        context.dataStore.edit { it[Keys.ANALYTICS_ONBOARDING_DONE] = value }
    }

    // ─── Tema (claro / oscuro / automático) ───
    val themePreference: Flow<ThemePreference> = data.map { prefs ->
        ThemePreference.fromStorage(prefs[Keys.THEME_PREFERENCE])
    }
    suspend fun setThemePreference(value: ThemePreference) {
        context.dataStore.edit { it[Keys.THEME_PREFERENCE] = value.name }
    }

    // ─── Idioma (es / en) ───
    val appLocale: Flow<LocalePreference> = data.map { prefs ->
        LocalePreference.fromStorage(prefs[Keys.APP_LOCALE])
    }
    suspend fun setAppLocale(value: LocalePreference) {
        context.dataStore.edit { it[Keys.APP_LOCALE] = value.tag }
    }
    suspend fun snapshotAppLocale(): LocalePreference = appLocale.first()

    // ─── Región (Spain / Europe / Americas / Asia / Africa / All) ───
    // Default SPAIN preserva el baseline gratuito (ALL + ES + EUROPA).
    val regionPreference: Flow<RegionPreference> = data.map { prefs ->
        RegionPreference.fromStorage(prefs[Keys.REGION_PREFERENCE])
    }
    suspend fun setRegionPreference(value: RegionPreference) {
        context.dataStore.edit {
            it[Keys.REGION_PREFERENCE] = value.name
            // Sanea: si el grupo fino guardado no pertenece al nuevo bucket,
            // se limpia automáticamente (vuelve a "Automático por TZ").
            val current = it[Keys.PREFERRED_COUNTRY_GROUP]
            if (current != null && current !in value.availableCountryGroups) {
                it.remove(Keys.PREFERRED_COUNTRY_GROUP)
            }
        }
    }
    suspend fun snapshotRegionPreference(): RegionPreference = regionPreference.first()

    // ─── País preferido (sub-selector dentro del bucket) ───
    // `null` = detección automática por TZ.
    val preferredCountryGroup: Flow<String?> = data.map { it[Keys.PREFERRED_COUNTRY_GROUP] }
    suspend fun setPreferredCountryGroup(value: String?) {
        context.dataStore.edit {
            if (value == null) it.remove(Keys.PREFERRED_COUNTRY_GROUP)
            else it[Keys.PREFERRED_COUNTRY_GROUP] = value
        }
    }
    suspend fun snapshotPreferredCountryGroup(): String? = preferredCountryGroup.first()

    // ─── Categorías de notificación push (Fase 3) ───
    // Default {GENERAL} preserva el baseline gratuito. Las demás son Premium.
    val notificationCategories: Flow<Set<NotificationCategoryPreference>> = data.map { prefs ->
        NotificationCategoryPreference.fromStorage(prefs[Keys.NOTIFICATION_CATEGORIES])
    }
    suspend fun setNotificationCategories(value: Set<NotificationCategoryPreference>) {
        context.dataStore.edit {
            it[Keys.NOTIFICATION_CATEGORIES] =
                NotificationCategoryPreference.toStorage(value)
        }
    }
    suspend fun snapshotNotificationCategories(): Set<NotificationCategoryPreference> =
        notificationCategories.first()

    // ─── Suscripción Premium (Fase 5: stub local · Fase 6: RevenueCat) ───
    val premiumSubscribed: Flow<Boolean> = data.map { it[Keys.PREMIUM_SUBSCRIBED] ?: false }
    suspend fun setPremiumSubscribed(value: Boolean) {
        context.dataStore.edit { it[Keys.PREMIUM_SUBSCRIBED] = value }
    }
    suspend fun snapshotPremiumSubscribed(): Boolean = premiumSubscribed.first()

    // ─── Amigo de Calendario Ciclismo (4.3) ───
    val friendSubscribed: Flow<Boolean> = data.map { it[Keys.FRIEND_SUBSCRIBED] ?: false }
    suspend fun setFriendSubscribed(value: Boolean) {
        context.dataStore.edit { it[Keys.FRIEND_SUBSCRIBED] = value }
    }
    suspend fun snapshotFriendSubscribed(): Boolean = friendSubscribed.first()

    val founderRecognized: Flow<Boolean> = data.map { it[Keys.FOUNDER_RECOGNIZED] ?: false }
    suspend fun setFounderRecognized(value: Boolean = true) {
        context.dataStore.edit { it[Keys.FOUNDER_RECOGNIZED] = value }
    }
    suspend fun snapshotFounderRecognized(): Boolean = founderRecognized.first()

    val supporterIcon: Flow<String> = data.map { it[Keys.SUPPORTER_ICON] ?: "default" }
    suspend fun setSupporterIcon(value: String) {
        context.dataStore.edit { it[Keys.SUPPORTER_ICON] = value }
    }
    suspend fun snapshotSupporterIcon(): String = supporterIcon.first()

    suspend fun setPreviousSupporterIcon(value: String) {
        context.dataStore.edit { it[Keys.PREVIOUS_SUPPORTER_ICON] = value }
    }
    suspend fun snapshotPreviousSupporterIcon(): String =
        data.map { it[Keys.PREVIOUS_SUPPORTER_ICON] ?: "default" }.first()

    val contributionCount: Flow<Int> = data.map { it[Keys.CONTRIBUTION_COUNT] ?: 0 }
    suspend fun recordContribution() {
        context.dataStore.edit { prefs ->
            prefs[Keys.CONTRIBUTION_COUNT] = (prefs[Keys.CONTRIBUTION_COUNT] ?: 0) + 1
        }
    }

    // ─── Pantalla "sin anuncios" (gate del paso PremiumShowcase del onboarding) ───
    // Gate DEDICADO cuyo NOMBRE es load-bearing: debe ser una clave que nadie
    // tenga persistida, para que la pantalla se dispare una vez tras actualizar.
    // Historia: el showcase existe desde 2.0 con otro copy, así que los upgraders
    // ya tenían el flag legacy `premium_showcase_done = true` sin haber visto "sin
    // anuncios"; `ads_intro_done` (2.3) y luego `ads_intro_v4_done` (4.0) fueron
    // gates NUEVOS que la re-dispararon una vez cada uno. Los dos primeros ya están
    // saturados a `true` en todo el parque y se borraron (2026-07-19);
    // `ads_intro_v4_done` es el gate vivo. ⚠️ NO renombrar a `ads_intro_done`: los
    // dispositivos 2.3+ lo tienen persistido en `true` y suprimirían la pantalla.
    // Futuras oleadas = un nuevo `ads_intro_vN_done`.
    val adsIntroV4Done: Flow<Boolean> = data.map { it[Keys.ADS_INTRO_V4_DONE] ?: false }
    suspend fun setAdsIntroV4Done(value: Boolean) {
        context.dataStore.edit { it[Keys.ADS_INTRO_V4_DONE] = value }
    }

    val contributionIntroV4231Done: Flow<Boolean> = data.map { it[Keys.CONTRIBUTION_INTRO_V4_2_3_1_DONE] ?: false }
    suspend fun setContributionIntroV4231Done(value: Boolean) {
        context.dataStore.edit { it[Keys.CONTRIBUTION_INTRO_V4_2_3_1_DONE] = value }
    }

    // Anuncio único de 4.3: retirada definitiva de publicidad y nuevo modelo Amigo.
    val supportIntroV43Done: Flow<Boolean> = data.map { it[Keys.SUPPORT_INTRO_V4_3_DONE] ?: false }
    suspend fun setSupportIntroV43Done(value: Boolean) {
        context.dataStore.edit { it[Keys.SUPPORT_INTRO_V4_3_DONE] = value }
    }

    /**
     * Fija la audiencia antes de completar la pantalla de idioma. La clave
     * conserva el resultado si la aplicación se cierra a mitad del onboarding.
     */
    suspend fun initializeSupportIntroV43Audience(): Boolean {
        var isNewInstallation = false
        context.dataStore.edit { prefs ->
            isNewInstallation = prefs[Keys.SUPPORT_INTRO_V4_3_NEW_INSTALLATION]
                ?: (!(prefs[Keys.LANGUAGE_ANNOUNCEMENT_DONE] ?: false)
                    && !(prefs[Keys.NOTIF_ONBOARDING_DONE] ?: false))
            prefs[Keys.SUPPORT_INTRO_V4_3_NEW_INSTALLATION] = isNewInstallation
        }
        return isNewInstallation
    }

    /** Registra una vista local y devuelve si toca mostrar el aviso al volver a Hoy. */
    suspend fun recordContributionContentView(isToday: Boolean, isSubscribed: Boolean): Boolean {
        if (isSubscribed) return false
        var show = false
        val now = System.currentTimeMillis()
        context.dataStore.edit { prefs ->
            val first = prefs[Keys.CONTRIBUTION_FIRST_VIEW_AT] ?: now
            val views = (prefs[Keys.CONTRIBUTION_VIEW_COUNT] ?: 0) + 1
            val prompts = prefs[Keys.CONTRIBUTION_PROMPT_COUNT] ?: 0
            prefs[Keys.CONTRIBUTION_FIRST_VIEW_AT] = first
            prefs[Keys.CONTRIBUTION_VIEW_COUNT] = views
            show = isToday && prompts < 2 && now - first >= 7L * 24 * 60 * 60 * 1000 && when (prompts) {
                0 -> views >= 30
                else -> now - (prefs[Keys.CONTRIBUTION_LAST_PROMPT_AT] ?: now) >= 21L * 24 * 60 * 60 * 1000 &&
                    views - (prefs[Keys.CONTRIBUTION_LAST_PROMPT_VIEWS] ?: views) >= 60
            }
        }
        return show
    }

    suspend fun recordContributionPromptDecision() {
        val now = System.currentTimeMillis()
        context.dataStore.edit { prefs ->
            prefs[Keys.CONTRIBUTION_PROMPT_COUNT] = (prefs[Keys.CONTRIBUTION_PROMPT_COUNT] ?: 0) + 1
            prefs[Keys.CONTRIBUTION_LAST_PROMPT_AT] = now
            prefs[Keys.CONTRIBUTION_LAST_PROMPT_VIEWS] = prefs[Keys.CONTRIBUTION_VIEW_COUNT] ?: 0
        }
    }

    // ─── Widget ───
    val lastWidgetRefreshAt: Flow<Long> = data.map { it[Keys.LAST_WIDGET_REFRESH_AT] ?: 0L }
    suspend fun setLastWidgetRefreshAt(value: Long) {
        context.dataStore.edit { it[Keys.LAST_WIDGET_REFRESH_AT] = value }
    }
    suspend fun snapshotLastWidgetRefreshAt(): Long = lastWidgetRefreshAt.first()

    // ─── Modo de seguimiento de carreras (Fase race-notifications) ───
    val raceFollowMode: Flow<RaceFollowMode> = data.map { prefs ->
        RaceFollowMode.fromStorage(prefs[Keys.RACE_FOLLOW_MODE])
    }
    suspend fun setRaceFollowMode(value: RaceFollowMode) {
        context.dataStore.edit { it[Keys.RACE_FOLLOW_MODE] = value.storageValue }
    }
    suspend fun snapshotRaceFollowMode(): RaceFollowMode = raceFollowMode.first()

    val followedRaceIds: Flow<Set<String>> = data.map { prefs ->
        val raw = prefs[Keys.FOLLOWED_RACE_IDS] ?: ""
        if (raw.isEmpty()) emptySet() else raw.split(",").toSet()
    }
    suspend fun setFollowedRaceIds(value: Set<String>) {
        context.dataStore.edit { it[Keys.FOLLOWED_RACE_IDS] = value.joinToString(",") }
    }
    suspend fun snapshotFollowedRaceIds(): Set<String> = followedRaceIds.first()

    val activeRaceFilters: Flow<Set<RaceGroupFilter>> = data.map { prefs ->
        RaceGroupFilter.fromStorage(prefs[Keys.RACE_GROUP_FILTERS])
    }
    suspend fun setActiveRaceFilters(value: Set<RaceGroupFilter>) {
        context.dataStore.edit { it[Keys.RACE_GROUP_FILTERS] = RaceGroupFilter.toStorage(value) }
    }
    suspend fun snapshotActiveRaceFilters(): Set<RaceGroupFilter> = activeRaceFilters.first()

    val followedStageIds: Flow<Set<String>> = data.map { prefs ->
        val raw = prefs[Keys.FOLLOWED_STAGE_IDS] ?: ""
        if (raw.isEmpty()) emptySet() else raw.split(",").toSet()
    }
    suspend fun setFollowedStageIds(value: Set<String>) {
        context.dataStore.edit { it[Keys.FOLLOWED_STAGE_IDS] = value.joinToString(",") }
    }
    suspend fun snapshotFollowedStageIds(): Set<String> = followedStageIds.first()

    // ─── Subvista activa de la pestaña Calendario (apps 3.1) ───
    // "month" | "season". Mes y Temporada se fusionaron en una sola pestaña
    // con toggle; aquí se recuerda la última subvista elegida. Valores raros
    // (versiones futuras) caen a "month".
    val calendarSubview: Flow<String> = data.map { prefs ->
        when (val stored = prefs[Keys.CALENDAR_SUBVIEW]) {
            "month", "season" -> stored
            else -> "month"
        }
    }
    suspend fun setCalendarSubview(value: String) {
        context.dataStore.edit { it[Keys.CALENDAR_SUBVIEW] = value }
    }
    suspend fun snapshotCalendarSubview(): String = calendarSubview.first()

    /** Snapshot síncrono de un flow para uso en workers / helpers. */
    suspend fun snapshotOfflineEnabled(): Boolean = offlineEnabled.first()
    suspend fun snapshotPushEnabled(): Boolean = pushEnabled.first()
    suspend fun snapshotCategoryFilter(): Constants.CategoryFilter = categoryFilter.first()
    suspend fun snapshotThemePreference(): ThemePreference = themePreference.first()
    suspend fun snapshotOfflineCacheSchemaVersion(): Int = offlineCacheSchemaVersion.first()
    suspend fun snapshotLastOfflineSyncAttemptEpoch(): Long = lastOfflineSyncAttemptEpoch.first()
}
