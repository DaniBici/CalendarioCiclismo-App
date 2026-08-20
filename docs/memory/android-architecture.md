# Android — Arquitectura y notas de implementación

## Stack

- Gradle 8.x (Kotlin DSL) + AGP 8.10+ | minSdk 26 / targetSdk 36
- Kotlin 2.2 + Coroutines + Flow | Compose BOM 2024.09 + Material 3 + `navigation-compose`
- Supabase: `supabase-kt` (postgrest + auth) + `ktor-client-okhttp`
- Room (KSP) | DataStore Preferences | WorkManager (sync 24 h, `UNMETERED`) | FCM | Coil 3
- DI manual (sin Hilt)

## Estructura de paquetes

```
android-app/app/src/main/java/app/calendariociclismo/android/
├── CalendarioCiclismoApp.kt      Application — init Supabase, Room, DataStore, WorkManager
├── MainActivity.kt                Entry point Compose + NavHost
├── data/
│   ├── model/                     Race, RaceDay, Broadcast, Asset, EnrichedRaceDay, …
│   ├── local/ (Room)              AppDatabase + entities + DAOs
│   ├── remote/SupabaseService.kt
│   ├── repository/CalendarRepository.kt
│   ├── prefs/AppPreferences.kt   DataStore typed wrapper
│   └── sync/
│       ├── OfflineManager.kt     StateFlow<SyncState>
│       └── OfflineSyncWorker.kt  CoroutineWorker (WorkManager)
├── notifications/
│   ├── CCFirebaseMessagingService.kt
│   ├── DeepLink.kt               Sealed class (Tab, Race, Stage)
│   └── NotificationChannels.kt
├── calendar/CalendarSubscription.kt  Intent → Google Calendar "Add by URL"
├── ui/splash/SplashOverlay.kt
└── util/  DateFormatting.kt | RaceLogic.kt | Haptics.kt
```

## Notas clave

**Offline:** mismo algoritmo que iOS — 14 días + mes actual + mes siguiente + temporada + assets R2. Ver `docs/memory/offline-sync.md`.

**Deep links:** esquema `race/{id}`, `stage/{id}`, `tab/{…}`. App Links en `AndroidManifest.xml` con `autoVerify="true"`.

**iCal en Android:** Google Calendar "Add by URL": `https://calendar.google.com/calendar/u/0/r?cid={url-encoded}`. El intent `ACTION_INSERT` sobre `CalendarContract.Events` se usa para añadir una jornada individual al calendario primario (ver `docs/memory/feeds-ical-detail.md`).

**Splash:** `installSplashScreen()` ANTES de `super.onCreate()`. `setOnExitAnimationListener { it.remove() }` evita parpadeo con overlay Compose.

**`POST_NOTIFICATIONS`** permission solo en `SDK_INT >= 33`.

**Build CI/cloud:** no hay Android SDK en cloud — verificar código manualmente, no buildear en CI cloud.

**Room:** bump de `version` necesario al añadir columnas. Con `fallbackToDestructiveMigration` no hace falta SQL de migración explícita.

**Status bar:** SIEMPRE declarar `<item name="android:windowLightStatusBar">true</item>` en `values/themes.xml` y `false` en `values-night/themes.xml`. El flag aplicado solo desde código se ignora en API 35 sobre Pixel 9a. Detalles en `docs/memory/android-status-bar.md`.

**Locale:** `MainActivity.onCreate()` lee `snapshotAppLocale()` con `runBlocking` ANTES de `setContent`. Aplica `AppCompatDelegate.setApplicationLocales` + actualiza `LocaleHolder.current`. El cambio desde Settings reinicia la activity automáticamente.

**`PREMIUM_TEST_BUILD`:** `buildConfigField("boolean", "PREMIUM_TEST_BUILD", "false")` en bloque `release`. Debug lo expone como `false`.

## Build de release (AAB) — solo local

**Nunca en CI cloud.** Comando: `cd android-app && ./gradlew :app:bundleRelease`. Requiere:
- `android-app/app/google-services.json` (gitignored, copiar desde Drive)
- `android-app/secrets.properties` (gitignored) con `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`

**Secretos en Google Drive (sincronizado en disco):** keystore, `google-services.json`, `GoogleService-Info.plist` y service accounts viven en `~/Library/CloudStorage/GoogleDrive-<cuenta-google>/Mi unidad/Claves y ENVs/`. Carpeta única (no hay copia en `~/Documents`) — está montada por Google Drive for Desktop, así que Gradle lee el `.jks` directamente desde esa ruta. `RELEASE_STORE_FILE` en `secrets.properties` apunta ahí. Backup en la nube automático.

Salida: `android-app/app/build/outputs/bundle/release/app-release.aab`.

**Toolchain API 36/Billing 8:** Billing 8.2.1 requiere Kotlin 2.2.10. Para
minificarlo correctamente, AGP debe ser 8.10.1 o posterior (R8 de AGP 8.9 no
entiende la metadata de Kotlin 2.2); Gradle 8.11.1 acompaña a AGP 8.10.1. Room
2.7.2 es necesario con ese KSP 2, ya que 2.6.1 falla durante el procesado de
símbolos. Ver el diagnóstico y la prueba con Bundletool en
`docs/runbooks/android-release.md`.
