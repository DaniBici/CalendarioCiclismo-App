# Descarga offline de assets R2 (iOS + Android)

Documentación técnica de la descarga offline de assets R2.

## Modo offline UX

| Plataforma | Persistencia | Default |
|---|---|---|
| iOS | `UserDefaults` clave `offline_mode_enabled` (`OfflineManager.swift`) | `false` |
| Android | DataStore clave `OFFLINE_ENABLED` (`AppPreferences.kt`) | `false` |

Onboarding completado en `offline_onboarding_completed` (iOS) / `offline_onboarding_done` (Android).

Settings → Privacidad muestra toggle + estado de sync + botón manual "Actualizar ahora":
- iOS: `SettingsView.swift` ~líneas 210-306.
- Android: `SettingsScreen.kt` ~líneas 135-191.

## Algoritmo de sync — qué se descarga

**14 días de Hoy + mes actual + mes siguiente + temporada completa + assets R2 + logos de carrera.**

Total: **19 pasos** (14 días + 2 meses + 1 temporada + 1 assets R2 + 1 logos + 1 purga).

### Cuándo se ejecuta

- **Al abrir la app:** hook `syncIfNeeded()` en `CalendarioCiclismoApp.swift` / `CalendarioCiclismoApp.kt`. Si la última sincronización fue < 12 h, no relanza.
- **Periódico cada 24 h:**
  - iOS: `BGAppRefreshTask` nativo.
  - Android: `WorkManager` periódico, `OfflineSyncWorker` (CoroutineWorker).
- **Constraints Android:** `NetworkType.UNMETERED` (Wi-Fi/ethernet) + `requiresBatteryNotLow = true`.
- **Identificadores WorkManager:** `WORK_PERIODIC = "offline_sync_periodic"`, `WORK_ONESHOT = "offline_sync_oneshot"` (`OfflineManager.kt` ~líneas 309-310).

## Almacenamiento

### iOS — `CacheManager.swift`

- JSON: `ApplicationSupport/OfflineCache/*.json` con timestamp.
- Assets R2: `OfflineCache/Assets/<id>.<ext>` + sidecar `<id>.url` (URL remota, para detectar cambios).
- Logos: `OfflineCache/Images/logo_<sha1Prefix>.<ext>` (hash determinístico, purga si la URL cambia).

### Android

- JSON: Room database con columna `cachedAt` por tabla.
- Assets R2: `filesDir/OfflineAssets/<id>.<ext>` + sidecar (`FileAssetCache.kt`).
- Logos: `filesDir/OfflineImages/logo_<sha1Prefix>.<ext>` (`ImageAssetCache.kt`).

## Renderizado local de assets R2

- Filtro previo: `asset.isDownloadableR2` (solo CDN propio, ignora URLs externas).
- iOS: `CacheManager.localAssetURL()` devuelve `file://` local si existe y la URL coincide. `localLogoFileURL()` prioriza bundle empaquetado → caché offline.
- Android: `ImageAssetCache.bundledLogoAssetUri()` devuelve `file:///android_asset/...` para logos empaquetados.

### Botón "Perfil" con perfil SVG web

Cuando una jornada tiene `hasElevationProfile = true` (perfil SVG web disponible), el chip "Perfil" lleva por defecto a `https://calendariociclismo.app/perfil/{slug}/`. Sin red y con modo sin conexión activo, si existe un asset estático de tipo `profile` descargado en local, se abre ese fichero en lugar de mostrar el modal "Enlace externo".

- iOS: `tapWebProfile(url:)` en `StageDetailView.swift` — usa `CacheManager.localAssetURL` y abre con QuickLook. Con red, comportamiento original (Safari).
- Android: `onWebProfileTap(...)` en `StageScreen.kt` — usa `assetCache().localFile()` y `openLocalFile`. Con red, abre Custom Tabs.

## Estado UI durante sync

- **iOS:** `@Published syncProgress: Double`, `syncStatusText: String?`, `isSyncing: Bool` (`OfflineManager.swift` ~líneas 56-62).
- **Android:** `StateFlow<SyncState>` con `progress: Float`, `statusText`, `isSyncing` (`OfflineManager.kt` ~línea 57).

Banner "Sin conexión" (`OfflineBanner.swift` línea 3 / equivalente Android).

## Auto-recarga al recuperar conectividad

- **iOS:** `.onChange(of: network.isOnline)` → `loadDay(refresh: true)` si `isFromCache || isUncachedOffline || error != nil`.
- **Android:** `LaunchedEffect` colecta `NetworkMonitor.online(context)`; flag `wasOffline`; `vm.refresh()` si `error != null || data == null` (TodayScreen).
