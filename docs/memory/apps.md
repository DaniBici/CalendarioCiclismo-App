# Apps nativas (iOS y Android)

Referencia técnica de las apps nativas: arquitectura Android, barra de estado Android, convenciones y configuración iOS, hápticos, descarga offline, pagers paginados y widget. Las reglas de producto (gratuidad, Fundadores, Amigo) están en `AGENTS.md` y [premium.md](premium.md).

Procedimientos que se ejecutan por separado: [release Android](../runbooks/android-release.md) y [release iOS](../runbooks/ios-release.md). Las funciones compartidas con la web siguen en sus notas: [navegación Hoy/Mes/Temporada](today-navigation.md), [cintillo](today-highlights.md), [indicador Live](live-badge.md), [notificaciones](push-notifications.md), [localización y región](i18n-region.md), [analítica](analytics.md) y [feeds iCal](feeds-ical-detail.md). Historia: [registros históricos de las apps](../informes/apps-registros-historicos.md).

Secciones: [Android: arquitectura](#android-arquitectura-y-notas-de-implementación) · [Android: barra de estado](#android-barra-de-estado) · [iOS](#ios-convenciones-de-estilo-y-configuración) · [Hápticos](#hápticos-mapeo-ios--android) · [Descarga offline](#descarga-offline-de-assets-r2-ios--android) · [Pagers paginados](#pagers-paginados--diferir-logos-y-banderas-ios--android) · [Widget](#widget-carreras-de-hoy--arquitectura-técnica)

## Android: arquitectura y notas de implementación

### Stack

- Gradle 8.x (Kotlin DSL) + AGP 8.10+ | minSdk 26 / targetSdk 36
- Kotlin 2.2 + Coroutines + Flow | Compose BOM 2024.09 + Material 3 + `navigation-compose`
- Supabase: `supabase-kt` (postgrest + auth) + `ktor-client-okhttp`
- Room (KSP) | DataStore Preferences | WorkManager (sync 24 h, `UNMETERED`) | FCM | Coil 3
- DI manual (sin Hilt)

### Estructura de paquetes

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

### Notas clave

**Offline:** mismo algoritmo que iOS — 14 días + mes actual + mes siguiente + temporada + assets R2. Ver [Descarga offline](#descarga-offline-de-assets-r2-ios--android).

**Deep links:** esquema `race/{id}`, `stage/{id}`, `tab/{…}`. App Links en `AndroidManifest.xml` con `autoVerify="true"`.

**iCal en Android:** Google Calendar "Add by URL": `https://calendar.google.com/calendar/u/0/r?cid={url-encoded}`. El intent `ACTION_INSERT` sobre `CalendarContract.Events` se usa para añadir una jornada individual al calendario primario (ver `docs/memory/feeds-ical-detail.md`).

**Splash:** `installSplashScreen()` ANTES de `super.onCreate()`. `setOnExitAnimationListener { it.remove() }` evita parpadeo con overlay Compose.

**`POST_NOTIFICATIONS`** permission solo en `SDK_INT >= 33`.

**Build CI/cloud:** no hay Android SDK en cloud — verificar código manualmente, no buildear en CI cloud.

**Room:** incrementar `@Database.version` al cambiar el esquema y exportar un JSON nuevo; conservar los esquemas de versiones publicadas. `versionCode` no sustituye este incremento. `fallbackToDestructiveMigration` solo recrea la caché cuando cambia la versión y falta una migración; no resuelve un hash incompatible dentro de la misma versión. La migración 15→16 conserva los datos y añade `realStartTimeUtc` solo si falta, porque la build 510 creó dos variantes del esquema 15. `AppDatabaseMigrationTest` cubre ambas variantes y la instalación nueva usando la misma configuración de apertura que producción.

**Status bar:** SIEMPRE declarar `<item name="android:windowLightStatusBar">true</item>` en `values/themes.xml` y `false` en `values-night/themes.xml`. El flag aplicado solo desde código se ignora en API 35 sobre Pixel 9a. Detalles en [Android: barra de estado](#android-barra-de-estado).

**Locale:** `MainActivity.onCreate()` lee `snapshotAppLocale()` con `runBlocking` ANTES de `setContent`. Aplica `AppCompatDelegate.setApplicationLocales` + actualiza `LocaleHolder.current`. El cambio desde Settings reinicia la activity automáticamente.

**`PREMIUM_TEST_BUILD`:** `buildConfigField("boolean", "PREMIUM_TEST_BUILD", "false")` en bloque `release`. Debug lo expone como `false`.

### Build de release (AAB) — solo local

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

## Android: barra de estado

Documentación técnica de la barra de estado Android.

### Implementación vigente desde Android 513

- `MainActivity` llama a `WindowCompat.enableEdgeToEdge(window)` (AndroidX Core
  1.17.0). El fondo se dibuja mediante una `Surface` del color `background` que
  ocupa toda la ventana; no se colorean las barras con `Window`.
- El contenido de navegación y onboarding comparte un `safeDrawingPadding()`:
  aplica y consume los insets de barras, cámara y teclado una sola vez. El
  `Scaffold` principal solo añade el espacio de las pestañas y la barra inferior
  ya no añade otro `navigationBarsPadding()`.
- Los diálogos se gestionan en su propia ventana. `SupportSheet` usa
  `WindowInsets.safeDrawing`, sin desactivar esos márgenes, y aplica el contraste
  mediante `SystemBarsAppearance` sobre su `DialogWindowProvider`. Esto evita que
  el tema del sistema imponga iconos negros sobre una hoja oscura.
- El contenido del onboarding de sostenimiento admite desplazamiento cuando no
  cabe en horizontal; los botones de continuar permanecen fuera del desplazamiento.
- Se conservan `windowLightStatusBar` y `windowLightNavigationBar` en los temas
  XML claro/oscuro. El arranque aplica la apariencia sobre `decorView`; el cambio
  dinámico de tema la reaplica con `WindowInsetsControllerCompat` y, desde API 30,
  el controlador nativo. Las reaplicaciones pendientes se cancelan al cambiar el
  efecto Compose.
- No restaurar `Window.statusBarColor`, `Window.navigationBarColor` ni manipular
  `systemUiVisibility` desde el tema. Android 15+ impone transparencia con nuestro
  target SDK y esas llamadas no sustituyen el fondo ni la gestión de insets.

Referencias: [WindowCompat](https://developer.android.com/reference/androidx/core/view/WindowCompat),
[insets en Compose](https://developer.android.com/develop/ui/compose/system/insets).

### Reglas para evitar volver a perder días

Diagnóstico del contraste de la barra de estado (versionCode 117 y anteriores), causa, solución con `windowLightStatusBar` y validaciones de la build 513: [registros históricos de las apps](../informes/apps-registros-historicos.md).

1. **Nunca confíes solo en código para `isAppearanceLightStatusBars`.** Siempre declarar también `windowLightStatusBar` en `values/themes.xml` (true) y `values-night/themes.xml` (false).

2. **Verificación obligatoria al tocar la status bar:**
   ```bash
   ~/Library/Android/sdk/platform-tools/adb -s <serial> shell dumpsys window | grep -A 1 mLastStatusBarAppearanceRegions
   ```
   Si `AppearanceRegion{ bounds=...}` aparece sin `appearance=N` → el flag NO se aplica. Si dice `appearance=8` → iconos oscuros activos. `appearance=24` → iconos oscuros + nav bar oscura.

3. **Logs de Compose mienten en este caso.** Que `Log.d` confirme `lightIcons=true` no garantiza que `WindowInsetsController` haya escrito el flag al sistema. Validar siempre con `dumpsys`.

4. **El emulador puede ocultar el problema.** El emulador con notch/cámara renderizada puede no mostrar status bar visible y disimular el bug. Verificar SIEMPRE en dispositivo físico.

5. **`enableEdgeToEdge()` no exime de declarar `windowLightStatusBar`.** A pesar de que la documentación de Google sugiere que es suficiente, en la práctica no lo es para Pixel 9a / API 35.

### Cómo instalar localmente para probar (sin Play Store)

Teléfono con Depuración USB activada (Ajustes → Información → tocar 7× "Número de compilación" → Sistema → Opciones para desarrolladores → Depuración USB).

```bash
cd android-app
~/Library/Android/sdk/platform-tools/adb devices
# Si la app de Play Store está instalada, desinstalarla primero (firmas distintas):
~/Library/Android/sdk/platform-tools/adb -s <serial> uninstall app.calendariociclismo.android

# Build sin lint (lint pre-existente bloquea con OfflineAssets/):
./gradlew :app:assembleRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease

# Instala
~/Library/Android/sdk/platform-tools/adb -s <serial> install -r app/build/outputs/apk/release/app-release.apk
```

## iOS: convenciones de estilo y configuración

### Escala visual común (iOS y Android)

Espejo de `css/app.css` desde el rediseño de octubre de 2026 (rama
`apps-rediseno`). Reglas de presentación de ambas apps:

- Radios: 4 para controles y etiquetas, 8 para superficies; círculos solo en
  elementos circulares. iOS `AppTheme.Radius.control`/`.surface`; Android
  `CCRadius.Control`/`.Surface`.
- Tipografía de siete tamaños (12, 13, 14, 16, 20, 28, 36). iOS
  `.ccFont(.s12…)` con Dynamic Type; Android `CCText.S12…` y la `Typography`
  de Material 3 remapeada a la escala. Sin mayúsculas forzadas ni tracking.
  Jerarquía: título de pantalla 20 negrita, panel 16 seminegrita, rótulo de
  fecha o grupo 13 seminegrita gris, filas 14.
- Color solo con significado: tipo de etapa y estados (en directo verde,
  cancelada y «No TV España» rojo, sin confirmar naranja). Categoría, género y
  etiquetas de enlace en neutro: `AppTheme.neutralFill` / `neutralFill`
  (texto al 8 %), `neutralBadgeColor()` y `neutralLinkBadgeColor()`. El
  acento queda para selección y navegación; pulsación neutra.
- Superficies: `CCCard` / `ccCardSurface` sin tinte de carrera ni filete. El
  color de carrera solo marca el avance en directo (Hoy) y el perfil recorrido.
- Logotipos de carrera (`RaceLogo`): solo la imagen ajustada con recorte de
  radio 4; sin caja, fondo, margen ni borde.
- Controles nativos de SwiftUI y Material 3 (`Picker` segmentado,
  `SingleChoiceSegmentedButtonRow` con radio 4, `FilterChip`, `Divider`,
  `ListItem`, `ContentUnavailableView`, `popover`/`TooltipBox`); dibujo propio
  solo para perfiles y franjas de maillot.
- Textos secundarios en tarjetas oscuras: `.secondary`, no `.tertiary` (solo
  decorativo).

### `SWIFT_ACTIVE_COMPILATION_CONDITIONS`

Flag histórico `PREMIUM_TEST_BUILD`, reutilizado para simular Amigo activo:
- Config Release del target principal (`project.pbxproj`, config `3E254B27AFC6A314812BB591`). Debug NO lo lleva.
- Lecturas vía `#if PREMIUM_TEST_BUILD` en `Services/PremiumService.swift` fuerzan `isSubscribed = true` y evitan que la sincronización lo desactive.
- **Para reactivar:** añadir `PREMIUM_TEST_BUILD` a `SWIFT_ACTIVE_COMPILATION_CONDITIONS` del Release + bumpar `CURRENT_PROJECT_VERSION`.
- **Para desactivar:** borrar `SWIFT_ACTIVE_COMPILATION_CONDITIONS = PREMIUM_TEST_BUILD;` del Release + bumpar.

### Xcode Cloud

- **Workflow `Default` → Start Condition:** push a `main` con filtro de ruta `/ios-app/`. Cambios fuera de `ios-app/` no disparan build.
- **Secrets:** `Supabase.xcconfig` y `GoogleService-Info.plist` están en `.gitignore`. Se regeneran en cada build desde variables de entorno del workflow:
  - `SUPABASE_URL` (sin `//` escapado — el script se encarga)
  - `SUPABASE_ANON_KEY` (Secret)
  - `GOOGLE_SERVICE_INFO_PLIST_B64` (Secret) — plist Firebase entero en base64. Generar con `base64 -i ios-app/CalendarioCiclismo/GoogleService-Info.plist`.
- **Script pre-build:** `ios-app/ci_scripts/ci_pre_xcodebuild.sh`. Xcode Cloud lo ejecuta automáticamente.
- El formato xcconfig trata `//` como comentario; el script escapa con `$()` para que `https://…` sobreviva.
- **Archivos `.swift` nuevos:** Xcode Cloud compila del `.pbxproj` commiteado (no regenera con XcodeGen). Al añadir un `.swift` nuevo hay que registrarlo en el `.pbxproj` — corriendo `./setup.sh` (XcodeGen) y commiteando el resultado, o añadiendo a mano sus 4 entradas (PBXBuildFile + PBXFileReference + grupo + fase Sources) para los targets correspondientes.
- **Scheme manual:** `setup.sh`/XcodeGen no declara en `project.yml` el scheme manual `CalendarioAnalytics.xcscheme`; cada regeneración lo borra. Restaurarlo desde `origin/main` tras cada `setup.sh` y vigilar en futuras regeneraciones.
- **Versión de release:** `ios-app/project.yml` es la fuente de verdad que el pre-build de Xcode Cloud aplica sobre el `.pbxproj`. Un bump debe actualizar `MARKETING_VERSION` y `CURRENT_PROJECT_VERSION` tanto en `project.yml` (base + target principal) como en el proyecto generado; cambiar solo el `.pbxproj` se revierte en Cloud.
- **Contador de Xcode Cloud:** comprobarlo antes de cada incremento de `CURRENT_PROJECT_VERSION`; el último valor registrado está en los [registros históricos de las apps](../informes/apps-registros-historicos.md).
- **SDK para el iPhone Duo:** las builds de iOS que se distribuyen deben compilarse en local con Xcode 27.1 RC o con el Xcode oficial que incluya el SDK de iOS 27.1. Con un SDK anterior (27.0) el iPhone Duo no usa la pantalla interior completa y la app no puede entrar en ese dispositivo. Si Xcode Cloud no ofrece el SDK 27.1, archivar y subir en local (como las 1455 a 1463) en lugar de depender de la compilación de Cloud.

#### Script post-build — reporte de errores en GitHub

`ios-app/ci_scripts/ci_post_xcodebuild.sh` — se ejecuta tras cada build, incluso si falla. Extrae errores del `.xcresult` y los publica como comentario en GitHub (en el PR si hay `CI_PULL_REQUEST_NUMBER`, o en el commit).

**Prerequisito:** añadir en App Store Connect → Xcode Cloud → workflow Default → Environment Variables el secret `GITHUB_TOKEN` (PAT con `repo:write`).

**Cuando hay un fallo:** buscar el comentario `❌ Xcode Cloud — Build fallido` en el commit de `main`. Contiene ruta del archivo + mensaje de error exacto — usar directamente sin reproducir el build.

**Variables Xcode Cloud usadas:** `CI_XCODEBUILD_EXIT_CODE`, `CI_COMMIT`, `CI_BRANCH`, `CI_BUILD_NUMBER`, `CI_PULL_REQUEST_NUMBER`, `CI_DERIVED_DATA_PATH`.

### Peso del bundle

- Un SVG de asset catalog sin `width`/`height` toma el `viewBox` como tamaño en pt, y `actool` genera PNG de respaldo @1x/@2x/@3x a ese tamaño aunque se preserve el vector. Las banderas (`viewBox` 640×480) llegaron a ocupar ~34 MB por copia (app y widget). Llevan `width="32" height="24"` (paso E de `scripts/flags/normalize-ios-flags.py`); por encima de ese tamaño se dibuja el vector.
- `GoogleSans-Medium.ttf` (iOS y Android) solo pinta la cabecera de Hoy y está reducida a latín, puntuación y símbolos monetarios (97 KB frente a 1,9 MB). Para ampliar cobertura, volver a subconjuntar desde el TTF original con `pyftsubset --layout-features='*'`.
- Medición: `xcodebuild -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build` y `xcrun assetutil --info Assets.car`. El binario de esa build conserva símbolos (~16 MB) que el archivado elimina.

### Bump de versión iOS (solo si el usuario lo pide)

Archivo: `ios-app/CalendarioCiclismo.xcodeproj/project.pbxproj`. Actualizar los 6 sitios a la vez (Debug + Release × 3 targets). `Info.plist` usa `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` — no convertir a literales.

`MARKETING_VERSION` solo acepta dígitos y puntos (`MAJOR.MINOR.PATCH`). Sufijos como `-dev` provocan rechazo de App Store Connect. Debe coincidir siempre con Android `versionName`.

### Fix bug layout tras canjeo de código promocional

`AppStore.presentOfferCodeRedeemSheet(in: scene)` se monta UIKit fuera del árbol SwiftUI; al cerrarse deja la safe-area corrupta. Workaround en `PremiumService.swift`: flag `isRedeemingCode` evita que la paywall se auto-cierre durante el canjeo; tras el `await` un `invalidateRootLayout()` fuerza `setNeedsLayout`/`layoutIfNeeded` en todas las windows.

## Hápticos: mapeo iOS / Android

Documentación técnica de hápticos.

Archivos: `Services/Haptics.swift` (iOS) · `util/Haptics.kt` (Android).

### Tabla de eventos

| Evento | iOS | Android |
|---|---|---|
| `navigation` / `Navigation` | `.light` impact | `CLOCK_TICK` |
| `boundary` / `Boundary` | `.light` impact | `CLOCK_TICK` |
| `selection` / `Selection` | `UISelectionFeedbackGenerator` | `CONTEXT_CLICK` |
| `toggle` / `Toggle` | `.soft` impact | `SEGMENT_FREQUENT_TICK` (API 34+) / `CLOCK_TICK` |
| `primaryAction` / `PrimaryAction` | `.medium` impact | `VIRTUAL_KEY` |
| `success` / `Success` | `.success` notification | `CONFIRM` (API 30+) / `VIRTUAL_KEY` |
| `warning` / `Warning` | `.warning` notification | `LONG_PRESS` |
| `error` / `Error` | `.error` notification | `REJECT` (API 30+) / `LONG_PRESS` |

### Patrón Compose

```kotlin
val haptic = rememberHaptics()
Button(onClick = { haptic(Haptics.Event.Navigation) }) { … }
```

### Dónde se aplican (paridad iOS ↔ Android)

- Tab bar: `Navigation`
- Hoy: `navigation` fecha/cards, `selection` chips
- Mes: `navigation` mes/chips/filas
- Temporada: ídem + chips de mes/año/país
- Buscar: `navigation` en tap
- Ajustes: offline `success`/`warning`, push `success`/`toggle`, iCal `primaryAction`, borrar `warning`, toggle hápticos `toggle`

Al añadir pantallas nuevas, buscar el equivalente en `Haptics.swift` para mantener paridad.

## Descarga offline de assets R2 (iOS + Android)

Documentación técnica de la descarga offline de assets R2.

### Modo offline UX

| Plataforma | Persistencia | Default |
|---|---|---|
| iOS | `UserDefaults` clave `offline_mode_enabled` (`OfflineManager.swift`) | `false` |
| Android | DataStore clave `OFFLINE_ENABLED` (`AppPreferences.kt`) | `false` |

Onboarding completado en `offline_onboarding_completed` (iOS) / `offline_onboarding_done` (Android).

Settings → Privacidad muestra toggle + estado de sync + botón manual "Actualizar ahora":
- iOS: `SettingsView.swift` ~líneas 210-306.
- Android: `SettingsScreen.kt` ~líneas 135-191.

### Algoritmo de sync — qué se descarga

**14 días de Hoy + mes actual + mes siguiente + temporada completa + assets R2 + logos de carrera.**

Total: **19 pasos** (14 días + 2 meses + 1 temporada + 1 assets R2 + 1 logos + 1 purga).

#### Cuándo se ejecuta

- **Al abrir la app:** hook `syncIfNeeded()` en `CalendarioCiclismoApp.swift` / `CalendarioCiclismoApp.kt`. Si la última sincronización fue < 12 h, no relanza.
- **Periódico cada 24 h:**
  - iOS: `BGAppRefreshTask` nativo.
  - Android: `WorkManager` periódico, `OfflineSyncWorker` (CoroutineWorker).
- **Constraints Android:** `NetworkType.UNMETERED` (Wi-Fi/ethernet) + `requiresBatteryNotLow = true`.
- **Identificadores WorkManager:** `WORK_PERIODIC = "offline_sync_periodic"`, `WORK_ONESHOT = "offline_sync_oneshot"` (`OfflineManager.kt` ~líneas 309-310).

### Almacenamiento

#### iOS — `CacheManager.swift`

- JSON: `ApplicationSupport/OfflineCache/*.json` con timestamp.
- Assets R2: `OfflineCache/Assets/<id>.<ext>` + sidecar `<id>.url` (URL remota, para detectar cambios).
- Logos: `OfflineCache/Images/logo_<sha1Prefix>.<ext>` (hash determinístico, purga si la URL cambia).

#### Android

- JSON: Room database con columna `cachedAt` por tabla.
- Assets R2: `filesDir/OfflineAssets/<id>.<ext>` + sidecar (`FileAssetCache.kt`).
- Logos: `filesDir/OfflineImages/logo_<sha1Prefix>.<ext>` (`ImageAssetCache.kt`).

### Renderizado local de assets R2

- Filtro previo: `asset.isDownloadableR2` (solo CDN propio, ignora URLs externas).
- iOS: `CacheManager.localAssetURL()` devuelve `file://` local si existe y la URL coincide. `localLogoFileURL()` prioriza bundle empaquetado → caché offline.
- Android: `ImageAssetCache.bundledLogoAssetUri()` devuelve `file:///android_asset/...` para logos empaquetados.

#### Botón "Perfil" con perfil SVG web

Cuando una jornada tiene `hasElevationProfile = true` (perfil SVG web disponible), el chip "Perfil" lleva por defecto a `https://calendariociclismo.app/perfil/{slug}/`. Sin red y con modo sin conexión activo, si existe un asset estático de tipo `profile` descargado en local, se abre ese fichero en lugar de mostrar el modal "Enlace externo".

- iOS: `tapWebProfile(url:)` en `StageDetailView.swift` — usa `CacheManager.localAssetURL` y abre con QuickLook. Con red, comportamiento original (Safari).
- Android: `onWebProfileTap(...)` en `StageScreen.kt` — usa `assetCache().localFile()` y `openLocalFile`. Con red, abre Custom Tabs.

### Estado UI durante sync

- **iOS:** `@Published syncProgress: Double`, `syncStatusText: String?`, `isSyncing: Bool` (`OfflineManager.swift` ~líneas 56-62).
- **Android:** `StateFlow<SyncState>` con `progress: Float`, `statusText`, `isSyncing` (`OfflineManager.kt` ~línea 57).

Banner "Sin conexión" (`OfflineBanner.swift` línea 3 / equivalente Android).

### Auto-recarga al recuperar conectividad

- **iOS:** `.onChange(of: network.isOnline)` → `loadDay(refresh: true)` si `isFromCache || isUncachedOffline || error != nil`.
- **Android:** `LaunchedEffect` colecta `NetworkMonitor.online(context)`; flag `wasOffline`; `vm.refresh()` si `error != null || data == null` (TodayScreen).

## Pagers paginados — diferir logos y banderas (iOS + Android)

Documentación técnica de los pagers paginados.

Tamaños del artwork: 28×28 logo, 20×15 bandera.

### Swipe horizontal (settle)

`settledMonthIndex`/`settledPage` lagea **280 ms** (casa con snap 250-350 ms del paginador). Solo la página settled renderiza `RaceLogo` + `CountryFlag`; adyacentes muestran hueco.

### Scroll vertical

- **iOS:** `@State isVerticallyScrolling` con `.onScrollPhaseChange`. `loadArtwork = isActive && !isVerticallyScrolling`. **Guard `isActive`** para que páginas adyacentes no escriban el estado.
- **Android:** `effectiveLoadArtwork = loadArtwork && !listState.isScrollInProgress`.

### Latch por fila (imprescindible)

Impide que iconos ya renderizados desaparezcan cuando `loadArtwork` vuelve a `false`:

- **iOS:** `@State var hasLoadedArtwork = false` + `.task(id: loadArtwork) { if loadArtwork { hasLoadedArtwork = true } }`.
- **Android:** `var hasLoadedArtwork by remember { mutableStateOf(loadArtwork) }; if (loadArtwork && !hasLoadedArtwork) hasLoadedArtwork = true`.
- Latch se resetea al salir del viewport.

### Auto-scroll al día en curso (Month)

El scroll programático día1→hoy compite con la carga de logos → stutter. Gatear artwork durante TODO el movimiento programático.

- **iOS:** `@State isAutoScrollingToToday` (default = `day > 1` al instanciar la vista). `shouldLoadArtwork = isActive && !isVerticallyScrolling && !isAutoScrollingToToday`.
  - Helper `performScrollToToday`: enciende flag, `proxy.scrollTo` tras 150 ms, apaga tras 600 ms (100 ms con reduce-motion).
  - Llamado desde `.onAppear` y `.onChange(scrollToTodayTrigger)`. Botón "Hoy" enciende flag ANTES de cambiar `settledMonthIndex`.
  - Liberar gate desde `.onChange(of: viewModel.allRaceDays.isEmpty)` y `.onChange(of: viewModel.year)`.
  - Acciones programáticas iOS: asignar `currentMonthIndex` + `settledMonthIndex` + cancelar `settleTask`.
- **Android:** `var autoScrollPending = remember { mutableStateOf(isCurrentMonth && todayDay > 1) }`. `effectiveLoadArtwork = loadArtwork && !listState.isScrollInProgress && !autoScrollPending`. `LaunchedEffect` apaga tras `animateScrollToItem`; limpiar manualmente si no hay scroll.
- **Gate DEBE arrancar en `true`** — si filas 1–N se componen con `loadArtwork = true`, latchan y el gate no sirve.
- En iOS Month: solo modo agenda (único modo existente) usa logos/banderas.

### Archivos

- iOS: `SeasonView.swift`, `MonthView.swift` (latch en `MonthScheduleRaceRow`).
- Android: `SeasonScreen.kt`, `MonthScreen.kt` (latch en `MonthScheduleRaceRow`).

## Widget «Carreras de hoy» — arquitectura técnica

Widget de iOS (WidgetKit) y Android (Glance) desde las apps 5.0.9. Muestra la
carretera y el ciclocross del día con TV, texto en directo y, al terminar, los
mismos accesos que Hoy. **Sin spoilers:** nunca muestra ganadores ni líderes.
El `kind` iOS (`TodayCyclingWidget`) y el receptor Android se conservan para no
invalidar widgets ya añadidos.

### Fuente única: RPC `widget_day`

Migraciones `20260927100703_widget_day.sql` y
`20260927102519_widget_day_no_spoilers.sql`. `SECURITY INVOKER` sobre tablas de
lectura pública; `GRANT EXECUTE` a `anon`, `authenticated` y `service_role`.

```
widget_day(p_date date, p_days int = 2, p_locale text = 'es',
           p_broadcast_groups text[] = {ALL,ES,EUROPA}, p_filter text = 'all',
           p_disciplines text[] = {road,cx}, p_race_ids text[] = null,
           p_race_day_ids text[] = null, p_cx_race_ids text[] = null,
           p_cx_filter text = 'all') → jsonb
```

- **Días:** `p_date` y los siguientes (`p_days`, máx. 3). Las apps piden hoy y
  mañana: el cambio de jornada a medianoche no depende de la red.
- **Selección y orden:** jornadas publicadas; carreras canceladas fuera. Orden
  espejo del orden de Hoy (Grandes Vueltas, `categoryRank` de
  `js/services/race-order.js`, género, salida; sin miniperfil). Ciclocross después, por clase
  (CM, CDM, CC, C1, C2, CN, NAC) y hora. Descanso y anuladas al final.
- **Filtros:** `p_filter` replica `matchesCategory` (`public.widget_road_matches`).
  `p_cx_filter` replica el filtro de la agenda CX (`all|big|pro|spain`). En
  inglés se excluye `NAC`. Si llega cualquier lista de seguidas, el alcance es
  «Seguidas» y los filtros no se aplican.
- **TV:** emisiones filtradas por `p_broadcast_groups` (grupos de
  `RegionService.allowedBroadcastGroups`). `tv.status`: `time` (hora de la
  primera emisión accesible), `confirmed`, `pending`, `none`, `unavailable_es`
  (solo si `ES` está en los grupos). Emisiones solo de otras regiones → sin
  estado.
- **Resultados:** `hasResults` con la misma regla que Hoy (`race_uci_stages`
  con `keepForWeb` y filas). `resultsLink` =
  `calendariociclismo://results/{raceId}/{etapa|final}{sufijo}`; `reviveUrl` =
  primera emisión recuperable (regla `isReviveBroadcast`). En CX, una categoría
  tiene resultados con estado oficial o provisional y filas en `cx_results`;
  `resultsLink` apunta a la ficha con el ancla de la primera categoría con
  resultados y `reviveUrl` a la primera emisión de la región que cumple
  `isReviveBroadcast` o Sporza (solo `showInRevive` si la categoría está
  cancelada) en una categoría terminada y no sigue en directo en otra. La TV CX
  cuenta solo las categorías en directo (sin resultados ni cancelación y antes
  de la llegada estimada, o salida + 60 min, más 30 min), incluye emisiones sin
  canal y ordena los canales por `sortOrder`.
- **Texto en directo:** `liveTextUrl` (asset `live_text`).
- **Próxima cita:** `days[].next`, primera jornada posterior al día (horizonte
  de 150 días), con TV.
- Textos (etapa, tipo, nombres EN, etiquetas de categoría CX) ya resueltos
  según `p_locale`.

### Presentación (ambas plataformas)

| Estado | Condición | Columna derecha |
|---|---|---|
| Programada / en curso | sin resultados | Distintivo espejo de `TVBadge`: «Live texto» solo con texto en directo (sustituye a la TV si no la hay o acompaña a la TV mientras la carrera ha salido y la emisión no); si no, TV: hora, «Íntegra» (emisión desde la salida), «Live» (emisión empezada), «TV», «Sin confirmar», «Sin TV», «No TV España» (solo ES) |
| Esperando resultados | meta estimada pasada o `raceStatus = finished` | bandera de meta + hora |
| Terminada | `hasResults` (CX: todas las mangas) | copa → resultados nativos y TV → Revive, con la iconografía de Hoy |
| Descanso / anulada | `state` | atenuada |

Tamaños: iOS `systemSmall` (carrera destacada), `systemMedium` (hasta 3 filas o
ficha ampliada con una carrera), `systemLarge` (cabecera + 7 filas + próxima
cita), `accessoryRectangular` y `accessoryInline`. Android: `SizeMode.Exact`;
ancho < 250 dp → destacada; alto ≥ 260 dp → cabecera y próxima cita; filas según
la altura disponible.

### Configuración por instancia

- **Alcance:** `appFilter` (filtro fijado en Hoy y en la agenda CX, por
  defecto), `all`, `followed` (carreras, etapas y pruebas CX seguidas).
- **Disciplina:** `both` (defecto), `road`, `cyclocross`.
- iOS: `AppIntentConfiguration` (`TodayWidgetIntent`). Android:
  `TodayWidgetConfigureActivity` (`widgetFeatures =
  reconfigurable|configuration_optional`); estado Glance por instancia
  (`WidgetConfig.KEY_SCOPE`, `KEY_DISCIPLINE`).

### iOS

- `ios-app/Shared/WidgetShared.swift` (compilado en app y extensión): App Group
  `group.app.calendariociclismo`, clave `widget_settings_v1` con
  `WidgetSettings` (idioma, grupos de TV, filtros fijados, seguidas).
- `Services/WidgetBridge.swift` (app): sincroniza `WidgetSettings` al arrancar,
  al volver a primer plano y ante cualquier `UserDefaults.didChangeNotification`
  (con 600 ms de espera); si cambian, `reloadAllTimelines`. Elimina el payload
  heredado `Caches/widget_today_payload.json`.
- Extensión: `WidgetDataSource` consulta la RPC con `SUPABASE_URL` y
  `SUPABASE_ANON_KEY` del `Info.plist` (xcconfig del proyecto) y guarda la
  respuesta en `Caches/widget_day_{alcance}_{disciplina}.json` para servirla sin
  red.
- Timeline: entradas en cada salida, TV, meta y manga CX de las próximas 26 h y
  a medianoche. Recarga cada 20 min con carreras en curso o esperando
  resultados (o salida en < 90 min), cada 2 h en otro caso, 30 min sin red.
- Banderas: `Shared/Flags.xcassets` (catálogo compartido con la app, incluye
  las comunidades autónomas). Marca: `WidgetMark` (glifo de `HeaderLogo`, plantilla).
- Localización: textos del cuerpo según el idioma de la app
  (`WidgetText.t(es, en)`); nombre, descripción y configuración del widget en
  `CalendarioCiclismoWidget/Localizable.xcstrings` (idioma del sistema).

### Android

| Clase | Rol |
|---|---|
| `TodayCyclingWidget` | Glance. Carga los datos dentro de la composición, dependiente de la configuración y de `KEY_VERSION` (una sesión Glance viva no vuelve a ejecutar `provideGlance`). |
| `WidgetDayRepository` | RPC `widget_day` vía `SupabaseService.widgetDay`; copia en `cacheDir/widget/`, válida 15 min. |
| `WidgetPresentation` | Estados, distintivos y textos (contexto con el idioma de la app). |
| `TodayWidgetRefreshWorker` | Descarga por configuración, incrementa `KEY_VERSION` de cada instancia y programa el siguiente refresco. |
| `TodayWidgetScheduler` | Periódico de 60 min (red) + puntual en el siguiente cambio visible, medianoche o cada 20 min con carreras activas. Dos ranuras alternas para que el worker en curso no se reemplace a sí mismo. |
| `TodayWidgetConfigureActivity` | Configuración por instancia. |

`CalendarioCiclismoApp` reprograma el refresco si hay widgets y, ante cambios de
idioma, filtros fijados o seguidas, invalida la copia local y fuerza un
refresco. Iconos: Material Icons en `res/drawable/ic_widget_*` (misma
iconografía que la app). Vista previa del selector: `layout/widget_today_preview.xml`
(solo vistas admitidas por `RemoteViews`: nada de `<View>`).

### Deep links

- Jornada: `calendariociclismo://stage/{raceDayId}`
- Ficha CX: `calendariociclismo://cxRace/{id}[#categoría]`
- Resultados nativos: `calendariociclismo://results/{raceId}/{etapa|final}{A|B}`
  (`DeepLink.results` en iOS, `DeepLink.Results` en Android).
- Pestañas: `calendariociclismo://tab/today`, `tab/cyclocross`.
- Texto en directo y Revive: URL externa.

### Fase 3 (2027)

Live Activities y Live Updates: ver [el plan](../plans/widgets-fase-3-2027.md).
