# Infraestructura Premium (Fase 6)

> **⚠️ MODELO ACTUAL (2.3.0, FASE A de anuncios): Premium = "sin anuncios" y nada más.**
> Todas las features que aquí se describen como "Premium" (mini-perfil, badge inscritos, notificaciones enriquecidas, regiones, inglés) **se liberaron al plan gratuito** (commit `ea0674292da`). Lo que queda de Premium es exclusivamente quitar los anuncios.
>
> - **`isSubscribed`** (estado real StoreKit/Billing) → alimenta SOLO el AdGate `shouldShowAds = !isSubscribed` y la UI de gestión de la suscripción. Tras la liberación había quedado hardcodeado a `true`; en 2.3.0 se reactivó a su valor real.
> - **`featuresUnlocked`** (constante `true` en ambos `PremiumService`) → es lo que leen los gates de features liberadas. **NUNCA** colgar un gate de feature de `isSubscribed` (reintroduciría el cobro). Ver política de pricing en CLAUDE.md.
> - **Paywall / onboarding showcase / sección de Ajustes**: reescritos a copy "sin anuncios" (un único mensaje; `PaywallSource` se conserva pero todas las llamadas usan `.general`). El SDK de anuncios (AdMob) es FASE B (Android) / C (iOS), aún no integrado.
> - La sección de abajo describe la infraestructura StoreKit/Billing original (intacta) y el paywall (solo cambió el copy).

## Product IDs

**iOS — App Store Connect:**
| Plan | Product ID |
|---|---|
| Mensual | `app.calendariociclismo.premium.mensual` |
| Anual | `app.calendariociclismo.premium.anual` |

**Android — Google Play Console:** subscription product `premium` con base plans `monthly` y `yearly`.

## Servicio central

| Plataforma | Archivo | Patrón |
|---|---|---|
| iOS | `Services/PremiumService.swift` (`@MainActor @Observable`) | StoreKit 2: `Product.purchase()`, `AppStore.sync()`, `Transaction.currentEntitlements`, `Transaction.updates`. `isSubscribed` persiste en `UserDefaults["premium_subscribed"]`. |
| Android | `data/premium/PremiumService.kt` + `data/premium/BillingManager.kt` | Google Play Billing 8.x. `BillingManager` gestiona conexión con backoff exponencial, `queryProductDetails`/`queryPurchasesAsync`, `launchBillingFlow`. `isSubscribed` es `StateFlow<Boolean>` desde DataStore. |

## API contractual (idéntica en ambas plataformas)

- `enum PaywallSource`: `region`, `notifications`, `raceCards`, `raceNotifications`, `general`. (`languageEnglish` eliminado en 2.1: el inglés es gratuito).
- `enum PremiumPlan`: `monthly`, `yearly`. Android lleva además `basePlanId`.
- `presentPaywall(source)` / `dismissPaywall()`.
- `subscribe(plan)` — Debug: activa flag directamente. Release: `Product.purchase()` / `BillingClient.launchBillingFlow`.
- `restorePurchases()` → Bool.
- `cancelSubscription()` → abre `apple.com/account/subscriptions` (iOS) o `play.google.com/store/account/subscriptions?sku=premium&package=app.calendariociclismo.android` (Android).
- `isPurchasing: Bool/StateFlow<Bool>`, `purchaseError: String?/StateFlow<String?>`.

## Paywall UI

| Plataforma | Archivo | Presentación |
|---|---|---|
| iOS | `Views/Premium/PaywallView.swift` | `.sheet(item:)` desde `CalendarioCiclismoApp.swift`. Auto-dismiss en `onChange(isSubscribed)`. |
| Android | `ui/premium/PaywallScreen.kt` (`PaywallSheet`) | `ModalBottomSheet` desde `AppNavHost.kt`. Auto-dismiss en `LaunchedEffect(isSubscribed)`. Actividad actual via `LocalContext.current.findActivity()`. |

Precios fallback hardcoded si el storefront no responde: `2,99 €` / `17,99 €`. El equivalente mensual del plan anual se calcula desde `priceAmountMicros` + `priceCurrencyCode`.

## Gating cableado (4 puntos)

1. **Racecards** — mini-perfil de elevación + badge inscritos: `premium.isSubscribed`.
2. **Onboarding región** — "Usar mi región" presenta paywall; tras compra aplica TZ + avanza.
3. **Settings → Región** — filas Premium: sin Premium presentan paywall.
4. **Settings → Notificaciones** — categorías Premium: sin Premium presentan paywall.

(En 2.1 se eliminaron los dos puntos del idioma inglés — onboarding y Settings — al pasar el inglés a ser gratuito. La pantalla de onboarding de idioma se reemplazó por `LanguageAnnouncementOnboardingView` / `LanguageAnnouncementOnboardingScreen`, que anuncia el cambio y permite elegir sin pasar por paywall.)

## Preset al activarse Premium (primera vez)

Si el modo de seguimiento de carreras sigue en `followAll` al transicionar free → Premium, se cambia automáticamente a `followRaces` ("Selectas"). Evita notificaciones de TODAS las carreras nada más suscribirse.

- **iOS:** `PremiumService.setSubscribed(true)` llama `RaceFollowService.shared.setMode(.followRaces)` si el modo actual es `.followAll`.
- **Android:** `CalendarioCiclismoApp.bootstrap()` observa `premium.isSubscribed` con `drop(1).distinctUntilChanged()`.

## Debug toggle

- iOS: `_debugSetSubscribed(_:)` / `_debugToggle()` (`#if DEBUG`). Toggle en `premiumDebugCard`.
- Android: `debugSetSubscribed(value)` (`BuildConfig.DEBUG`). Toggle en `PremiumDebugCard`.

## Ciclo de vida Android — Google Play Billing

- `onBillingSetupFinished(OK)` → `queryProducts()` + `queryActiveSubscription()`.
- `onBillingServiceDisconnected` → reconexión con backoff exponencial (1s → 2s → 4s → 8s → 16s → 32s, máx. 6 intentos).
- `onPurchasesUpdated(OK)` → por cada `PURCHASED` con productId `premium`: `isSubscribed=true` + `acknowledgePurchase` (obligatorio en 72 h o Google reembolsa).
- `ITEM_ALREADY_OWNED` → `queryActiveSubscription` para refrescar flag.

## Racecards Premium en "Hoy" (Fase 4)

Mini-perfil de elevación + badge de acceso directo a inscritos en cada racecard de "Hoy".

### Componentes

| Plataforma | Archivo | Función |
|---|---|---|
| iOS | `Views/Components/MiniElevationProfile.swift` | Canvas; tinte `race.colorHex` o accent global; params `startTime`/`endTime`/`isTimeTrial` |
| Android | `ui/components/MiniElevationProfile.kt` | Canvas + Path, mismo cálculo yMin/yMax; params `startTimeMs`/`endTimeMs`/`isTimeTrial` |

### Presentación (paridad web — 2026-06)

- **Franja a sangre (edge-to-edge):** el mini-perfil ya no es un sparkline inline en la columna; es una **franja al fondo de la tarjeta**, de lado a lado, recortada a las esquinas por `CCCard`. Altura por tipo de etapa (`miniProfileBandHeight`: 34-54). Por eso la **vista de competición pasó de filas de lista a tarjetas `CCCard`** (una por etapa).
- **Relleno temporal:** con `neutralStartTimeUtc`+`estimatedFinishTimeUtc` y no CRI/CRE, la silueta se pinta **gris** y se **tiñe de izquierda a derecha** según el % de tiempo transcurrido (0 antes de salida → 1 tras llegada). Auto-refresco cada 60 s (iOS `TimelineView(.periodic)`, Android `LaunchedEffect`+`delay`). **CRI/CRE → siempre 0% (gris/vacías)** como la web (cada corredor/equipo progresa en un momento distinto). Sin horas y no CRI/CRE → tinte completo clásico. Espejo de `buildElevationSparkline(progressFraction)` + `_updateProgressCards` (`js/elevation-profile.js`, `js/app.js`, `js/competicion.js`).

### Integración

- **Mini-perfil:** si `rd.elevationProfile?.points.size >= 2` y la card no está en `isFinishedMode`/`isRestDay`/`isCancelledDay`.
- **Badge "Inscritos":** dentro del FlowLayout/FlowRow después del TVBadge cuando `race.startlistImportedAt != null`.
- iOS: `RaceCardView` recibe `onShowStartlist: (() -> Void)?`. `TodayView` lo presenta con `.sheet(item:)`.
- Android: `RaceCard` recibe `onShowStartlist: (() -> Void)?` que navega a `Routes.startlist(race.id)`.

### Reglas

- **No tocar el detalle de jornada.** Mini-perfil y `StartlistView` siguen gratis al entrar al detalle. Solo el acceso directo desde la racecard de "Hoy" es Premium.
- También en **vista de competición (lista de etapas):** `StageRowView.swift` (iOS) y `StageRow()` en `RaceScreen.kt` (Android).
- No añadir a Mes/Temporada sin discusión.

## Reglas al modificar

- **NO** `isSubscribed = true` desde código de release. Solo vía `subscribe()` o debug toggle.
- **Añadir `PaywallSource` nuevo** → 4 sitios: enum iOS, enum Android, copy en `headerTitle`/`headerSubtitle` de ambas paywalls, doc de esta sección.
- **Renombrar subscription product en Play Console** → `BillingManager.PRODUCT_ID` + test + esta sección. Rompe a suscriptores existentes — no hacer tras lanzamiento.
- **Añadir feature Premium nueva** → gate `&& premium.isSubscribed` (iOS) / `&& isPremium` (Android).

## Tests

- iOS `PremiumServiceTests.swift` (12 casos): contract de `PaywallSource`/`PremiumPlan`, persistencia del flag, subscribe en Debug, `restorePurchases` stub.
- Android `PremiumServiceTest.kt` (7 casos): contract de enums (incluyendo `name.lowercase()` para analytics), `basePlanId`, `BillingManager.PRODUCT_ID = "premium"`.
