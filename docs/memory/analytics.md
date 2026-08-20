# Analytics — Google Analytics (web) + Firebase Analytics (apps)

Documentación técnica de Google Analytics.

## Web — Google Analytics 4

- **ID de medición:** `G-80SPH05B5W` (en `js/config.js`).
- **Archivo:** `js/analytics.js`. Carga `gtag.js` dinámicamente.
- **Banner de cookies:** `js/cookie-consent.js`. Estado en `localStorage` clave `cc-cookie-consent` con valores `accepted` / `rejected`.
- **Lógica de consentimiento** (lee `window.__cookieConsent`):
  - `'accepted'` → carga GA inmediatamente.
  - `'rejected'` → no carga.
  - `'pending'` → expone `window.__loadAnalytics()` para que el banner la invoque.
- **Auto-aceptación:** banner cierra y acepta tras 10 s (botón "Elegiré más tarde" cancela).
- **Page view manual:** `gtag` se inicializa con `send_page_view: false`; cada SPA dispara `page_view` manualmente al navegar.
- **Exclusión admin:** detecta token de Supabase Auth en `localStorage` y no carga GA en `panel/`.

## iOS — Firebase Analytics

- **Config:** `GoogleService-Info.plist` (en CI viene de secret `GOOGLE_SERVICE_INFO_PLIST_B64`). Plantilla con `IS_ANALYTICS_ENABLED=false`.
- **Archivo:** `Services/AnalyticsService.swift`.
- **Toggle:** Settings → Privacidad → "Estadísticas de uso". Persistido en `UserDefaults` clave `analytics_enabled`. **Default ON (opt-out):** si la clave no existe, `stored ?? true` activa analytics automáticamente.
- **API:** `Analytics.setAnalyticsCollectionEnabled(bool)` para activar/desactivar. Helpers `logScreenView(screenName:parameters:)` y `logEvent(name:params:)`.
- **Onboarding:** sin pantalla de consentimiento dedicada. El onboarding de analytics se eliminó en 1.4.5 al pasar al modelo opt-out; analytics arranca activado y se desactiva desde Ajustes → Privacidad.
- **Pantallas trackeadas con parámetros (idénticas a Android):**
  - `today` — `category_filter`.
  - `month` — `year`, `category_filter`.
  - `season` — `year`, `category_filter`, `country_code`.
  - `search` — `search_query`.
  - `race_detail` — `race_id`, `race_name`.
  - `stage_detail` — `race_day_id`, `stage_name`, `race_name`.
  - `elevation_profile` — `race_day_id`.
  - `startlist` — `race_id`, `race_name`.
  - `settings` — sin parámetros.
- **Sin IDFA:** no se solicita el identifier publicitario.

## Android — Firebase Analytics

- **Config:** `google-services.json` (proyecto `calendario-ciclismo-69371`). En CI viene de secret `GOOGLE_SERVICES_JSON_BASE64`.
- **Manifest:** `firebase_analytics_collection_enabled=false` por defecto — es el estado **antes** de aplicar el consentimiento; en el primer arranque `applyStoredConsent()` lo activa (default ON).
- **Archivo:** `data/analytics/AnalyticsService.kt`.
- **Toggle:** DataStore Preferences clave `analytics_enabled`. **Default ON (opt-out)** (`?: true` en `AppPreferences`); se aplica en `CalendarioCiclismoApp.onCreate()` vía `applyStoredConsent()` (blocking) antes del primer `screen_view`.
- **API:** `FirebaseAnalytics.setAnalyticsCollectionEnabled(bool)`. Mismos helpers que iOS (`logScreenView`, `logEvent`).
- **Onboarding:** sin pantalla de consentimiento dedicada (modelo opt-out, igual que iOS).
- **Pantallas trackeadas con parámetros (idénticas a iOS):**
  - `today` — `category_filter`.
  - `month` — `year`, `category_filter`.
  - `season` — `year`, `category_filter`, `country_code`.
  - `search` — `search_query`.
  - `race_detail` — `race_id`, `race_name`.
  - `stage_detail` — `race_day_id`, `stage_name`, `race_name`.
  - `elevation_profile` — `race_day_id`.
  - `startlist` — `race_id`, `race_name`.
- **Sin GAID:** no se solicita el ID de publicidad.

> **Importante — paridad para reportes del panel admin:** los nombres de parámetros y de pantalla deben coincidir EXACTAMENTE entre iOS y Android, porque los reportes `top_races` y `top_stages` agrupan por `customEvent:race_id` + `customEvent:race_name` (carreras) y `customEvent:stage_name` + `customEvent:race_name` + `customEvent:race_day_id` (etapas) en GA4. Si Android envía `stage_id` en lugar de `race_day_id`, o no envía `race_name`, los datos no se mezclan en el mismo reporte. Estos parámetros también tienen que estar registrados como **Dimensiones personalizadas** (ámbito Evento) en GA4 Admin → Custom Definitions de la propiedad de apps; sin registrarlas, la Data API responde `400 INVALID_ARGUMENT`.

> **Implementación Android:** `race_detail` y `stage_detail` se loggean desde `RaceScreen.kt` y `StageScreen.kt` (no desde `AppNavHost`), porque `AppNavHost` solo tiene los IDs de la ruta y necesitamos los nombres del ViewModel. El `LaunchedEffect(state)` dispara cuando el state pasa a `Ready`. Mismo patrón que iOS con `.onAppear` tras cargar.

## Eventos personalizados (`logEvent`)

Emitidos en **ambas plataformas** con los mismos nombres y parámetros:

| Evento | Parámetros | Notas |
|---|---|---|
| `onboarding_view` | `onboarding_step` | Pantallas de onboarding (notifications, offline, language_announcement, premium_showcase). |
| `onboarding_action` | `onboarding_step`, `action` | En el anuncio 4.3: `open_support` o `continue_free`. |
| `support_view` | `source` | Origen del acceso a la pantalla de sostenimiento. |
| `support_subscribe_tap` | `plan`, `source` | `plan`: `monthly`/`yearly`. |
| `support_contribution_tap` | `product_id` | Aportación puntual seleccionada. |
| `support_restore_tap` | — | Solicitud de restauración. |
| `support_purchase_success` | `plan`, `product_id` | Compra de Amigo o aportación confirmada. |
| `support_purchase_error` | `plan`, `error` | Error de compra. |

> **Android — compra:** `support_purchase_success`/`support_purchase_error` se emiten desde `BillingManager` vía callbacks que `PremiumService` conecta con `analytics.logEvent`. El `plan` se rastrea desde el `basePlanId` lanzado en `launchSubscription`; `support_restore_tap` se emite al solicitar una restauración.

> **Alcance:** estos eventos de compra alimentan el embudo de GA4/Firebase Console, **no** los reportes del panel admin (`ga-analytics`), que solo usan `screen_view` (top_screens/top_races/top_stages) + métricas estándar + `push_subscriptions`.

> **`top_stages` y las pruebas de un día (2026-06-28):** el reporte "Etapas más vistas" filtra las pantallas sin carrera (Hoy/Buscar/Ajustes/feed) por `customEvent:race_day_id` (`(not set)`/`''`), **no** por `stage_name`. Motivo: las pruebas de un día (clásicas, Campeonatos Nacionales) tienen `stageNumber` NULL → `stageLabel`=`""` → `stage_name` vacío, pero `race_day_id` poblado; filtrar por `stage_name` las descartaba injustamente. El panel (`renderTopStages`) muestra "Prueba única" en la columna Etapa cuando `stage_name` está vacío.

## Privacidad — resumen

- **iOS y Android: Default ON (opt-out).** La web sí es opt-in (el banner requiere aceptación explícita).
- **Sin identificadores publicitarios:** ni IDFA (iOS), ni GAID (Android), ni cookies de seguimiento entre sitios (web).
- **Consentimiento granular:** push, offline y analytics se piden por separado en Settings → Privacidad.

## Panel admin

No hay sección de Analytics en `panel/`. La página `panel/health.html` cubre el estado editorial (jornadas en borrador + última actualización en Supabase), pero no consume la API de Google Analytics. Para insights se entra directamente al dashboard de GA4 / Firebase Console.
