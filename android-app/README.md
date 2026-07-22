# Calendario Ciclismo — App Android

App Android nativa (Kotlin + Jetpack Compose + Material 3) para [calendariociclismo.app](https://calendariociclismo.app). Paralela a la app iOS en `ios-app/`, consumiendo el mismo backend Supabase.

## Requisitos

- Android Studio Ladybug (2024.2.1) o superior
- JDK 17
- Gradle 8.10+ (incluido vía `gradle-wrapper`)
- `minSdk` 26 (Android 8.0), `targetSdk` 36 (Android 16)

## Setup

1. **Abrir el proyecto:** `File → Open → android-app/` (no la raíz del repo).
2. **Descargar `gradle-wrapper.jar`:** este scaffolding no incluye el `.jar` binario del wrapper para mantener el repo limpio. La primera vez ejecuta:
   ```sh
   gradle wrapper --gradle-version 8.10.2
   ```
   (o deja que Android Studio lo genere al abrir el proyecto).
3. **`secrets.properties` (opcional):** crea en `android-app/` si quieres sobreescribir la Supabase URL/anon key por defecto. Las claves por defecto apuntan al backend de producción:
   ```properties
   SUPABASE_URL=https://...
   SUPABASE_ANON_KEY=...
   ```
4. **`google-services.json` (para push notifications):** descárgalo desde Firebase Console y colócalo en `android-app/app/google-services.json`. Sin este archivo, la app compila pero FCM queda deshabilitado.
5. **Run:** Android Studio → ▶ Run 'app', o en línea de comandos:
   ```sh
   ./gradlew :app:assembleDebug
   ./gradlew :app:installDebug
   ```

## Estructura

```
app/src/main/java/app/calendariociclismo/android/
├── CalendarioCiclismoApp.kt    Application — inicializa Supabase, Room, WorkManager
├── MainActivity.kt              Entry point Compose + NavHost
├── data/
│   ├── model/                   Race, RaceDay, Broadcast, Asset, EnrichedRaceDay
│   ├── local/ (Room)            AppDatabase + entities + DAOs
│   ├── remote/SupabaseService   Equivalente a SupabaseService.swift
│   ├── repository/              Single source of truth (remote ↔ local)
│   ├── prefs/                   DataStore typed wrapper
│   └── sync/                    OfflineManager + OfflineSyncWorker (WorkManager)
├── notifications/               FirebaseMessagingService + DeepLink + channels
├── calendar/                    Google Calendar "Add by URL" helper
├── ui/                          Screens (Compose) + tema + componentes
└── util/                        DateFormatting.kt, RaceLogic.kt (port literal de iOS)
```

## Features portadas desde iOS (estado inicial)

- [x] Pantalla Hoy (agenda del día) — leyendo de Supabase + caché Room
- [x] Pantallas Month, Season, Search, Race detail, Stage detail (scaffolding)
- [x] Settings con la lista de 6 feeds iCal
- [x] Modo offline: Room + OfflineManager + OfflineSyncWorker (PeriodicWorkRequest 24h)
- [x] Push notifications via FCM: `CCFirebaseMessagingService` + deep links + BigPictureStyle
- [x] Suscripción iCal via Google Calendar "Add by URL"
- [x] Theme light/dark siguiendo el sistema
- [x] Deep links web (`/competicion/{slug}`, `/jornada/{slug}`, `/inscritos/{slug}`) via App Links
- [ ] Onboarding notificaciones / offline (scaffolded, pendiente de animaciones)
- [ ] Widget de pantalla de inicio
- [ ] Firma release y publicación en Google Play
