# Localización, región y tema

## Localización ES / EN

Idioma controlado por preferencia local. **Ambos idiomas son gratuitos desde 2.1** (en 2.0 el inglés era gate Premium).

### Persistencia

| Plataforma | Servicio | Key | Storage |
|---|---|---|---|
| iOS | `Services/LocaleService.swift` (`@Observable`, default `.spanish`) | `app_locale` | `UserDefaults` + `AppleLanguages` |
| Android | `data/prefs/LocalePreference.kt` (`SPANISH("es")`, `ENGLISH("en")`) | `app_locale` | DataStore (`AppPreferences.appLocale` / `snapshotAppLocale()`) |

### Aplicación al runtime

- **iOS:** `CalendarioCiclismoApp.swift` inyecta `.environment(\.locale, localeService.current.locale)` en `ContentView` y los 4 onboardings.
- **Android:** `MainActivity.onCreate()` lee `snapshotAppLocale()` con `runBlocking` ANTES de `setContent`. Aplica `AppCompatDelegate.setApplicationLocales` + actualiza `LocaleHolder.current`. El cambio desde Settings reinicia la activity.

### Strings — fuentes de verdad

- **iOS:** `ios-app/CalendarioCiclismo/Resources/Localizable.xcstrings` (JSON Xcode 15). `SwiftUI.Text("foo")` resuelve `LocalizedStringKey` automáticamente — no hay que migrar Swift code.
- **Android:** `res/values/strings.xml` (canónico) + `values-en/strings.xml` (espejo EN). Necesita migración explícita: `Text("Hola")` → `Text(stringResource(R.string.foo))`.

### `DateFormatting` — locale-aware

Ambas plataformas leen el locale activo en cada llamada. iOS usa `nonIsolatedUILocale` (lectura directa de `UserDefaults["app_locale"]`). Android lee `LocaleHolder.current`.

- ES: `"EEEE, d 'de' MMMM 'de' yyyy"` → "Miércoles, 8 de abril de 2026"
- EN: `"EEEE, d MMMM yyyy"` → "Wednesday, 8 April 2026"
- `formatTimeMadrid` y `formatTimeLocal` mantienen `es_ES` fijo — `"HH:mm"` 24h es idéntico en cualquier idioma.

**Política de zona horaria (2026-05-17):** la app muestra siempre la hora en la zona del dispositivo (`formatTimeLocal`). `formatTimeMadrid` queda como utilidad (la siguen los tests).

**Widget iOS:** usa `formatTimeLocal` con `Locale("es_ES")` fijo. No leer `LocaleService.shared` allí.

### Onboarding paso 1 — selección de idioma (one-shot)

- `Views/Onboarding/LanguageAnnouncementOnboardingView.swift` (iOS) / `ui/onboarding/LanguageAnnouncementOnboardingScreen.kt` (Android).
- Pantalla de elección de idioma (español/inglés sin coste; el inglés dejó de ser Premium en 2.1).
- **Layout (rediseño 2026-06-04):** bloque compacto centrado verticalmente — icono globo + título "Elige tu idioma" + los dos botones justo debajo, agrupados en el centro (NO anclados al fondo como las otras 3 pantallas de onboarding). **Sin párrafo de cuerpo**: se eliminó el texto "El inglés ahora forma parte de la app gratuita…" (anuncio ya caducado) y su string `onboarding_language_body`. Es una excepción consciente al patrón común icono→título→cuerpo→botones-abajo porque esta pantalla es una bifurcación A/B, no "acción + omitir".
- Botón principal "Continuar en español" → `setLocale(.spanish)` + avanza.
- Botón secundario "Switch to English" → `setLocale(.english)` (recrea la activity en Android) + avanza.
- **Persistencia:**
  - iOS: `LocaleService.hasShownLanguageAnnouncement` (`UserDefaults["language_announcement_done"]`).
  - Android: `AppPreferences.languageAnnouncementDone` (DataStore `language_announcement_done`).
- **Migración usuarios 2.0 con inglés Premium activado:** si `app_locale == "en"` al arrancar 2.1, el flag se marca `true` automáticamente — no ven la pantalla.
- **Orden Android:** el flag se persiste ANTES de aplicar el locale al sistema, porque cambiar a inglés recrea la activity; al rearrancar, `nextOnboardingStep` salta a `Notifications`.

### Reglas al modificar strings

- **No traducir** contenido de Supabase (nombres de carrera, descripciones, canales TV).
- **Android:** editar AMBOS `values/strings.xml` y `values-en/strings.xml` simultáneamente.
- **iOS:** editar `Localizable.xcstrings`. Si solo se añade en `es`, el lookup EN cae al `sourceLanguage` (español).
- **Naming:** `screen.section.element` (p.ej. `today.filter.all`, `settings.theme.title`).

---

## Preferencia regional

Sustituye la whitelist hardcodeada `ALL + ES + EUROPA` por una preferencia elegible por el usuario. Todas las regiones son gratuitas desde 4.3.

### Persistencia

| Plataforma | Servicio | Key | Storage |
|---|---|---|---|
| iOS | `Services/RegionService.swift` (`@Observable`, default `.spain`) | `region_preference` | `UserDefaults` |
| Android | `data/prefs/RegionPreference.kt` (6 valores) | `region_preference` | DataStore |

### Mapeo región → grupos `broadcasts.country`

| Región | Grupos visibles | Tier |
|---|---|---|
| `SPAIN` | `ALL`, `EUROPA`, `ES` | Gratis |
| `EUROPE` | `ALL`, `EUROPA`, `ES`, `PT`, `FR`, `BE`, `NL`, `IT`, `DE_AT_CH`, `UK_IE`, `SCANDI`, `EE` | Gratis |
| `AMERICAS` | `ALL`, `NORTEAM`, `LATAM` | Gratis |
| `ASIA` | `ALL`, `ASIAPAC`, `MENA` | Gratis |
| `AFRICA` | `ALL`, `AFRICA`, `MENA` | Gratis |
| `ALL` | Todos los grupos | Gratis |

### Detección por TZ (sugerida en onboarding)

- **iOS:** `RegionService.suggestedRegion(timeZoneId:)`. Nunca devuelve `.all`.
- **Android:** `util/RegionDetector.kt` con la misma lógica.
- Reglas TZ → bucket: Madrid/Canarias/Ceuta → SPAIN. Resto Europa → EUROPE. America/* + Pacific/Honolulu → AMERICAS. Asia/* + Pacific/* + Australia/* + Indian/Christmas+Cocos → ASIA. Africa/* (no Ceuta) → AFRICA.
- Añadir TZ nueva → tocar **ambas** implementaciones.

### Sub-selector de país preferido (override manual del grupo fino)

Dentro de cada bucket, el usuario puede elegir un **país preferido** (grupo fino) que afina la hora del aviso de TV sin cambiar qué broadcasters son visibles.

- iOS: `RegionService.shared.preferredCountryGroup`, `setPreferredCountryGroup(_:)`, `effectiveCountryGroup()`.
- Android: `AppPreferences.preferredCountryGroup` (Flow), `setPreferredCountryGroup(value)`, `snapshotPreferredCountryGroup()`.
- `null` = automático por TZ (default).
- **Auto-saneado:** al cambiar de bucket, si el grupo guardado no pertenece al nuevo, se limpia.
- `availableCountryGroups` define qué grupos finos son elegibles por bucket. SPAIN expone solo `ES`. ALL no expone sub-selector.

### Onboarding paso 2 (región)

Entre idioma y notificaciones. CTA "Usar mi región" solo aparece si la TZ sugiere algo distinto de `.spain`. **Migración pre-2.0:** `region_onboarding_done` se marca como `true` automáticamente si `notif_onboarding_done == true`.

### Reglas al modificar

- Añadir grupo fino nuevo → `allowedBroadcastGroups` iOS + Android, `countryGroupLabel`/`countryGroupEmoji` iOS + Android, strings EN/ES en Android, `Localizable.xcstrings` iOS, `availableCountryGroups`, CHECK constraints en migraciones, `VALID_COUNTRY_GROUPS` en `send-push/index.ts`, `detectedCountryGroup` en `RegionService.swift` y `RegionDetector.kt`.
- Ninguna región depende de una compra.

---

## Preferencia de tema

| Plataforma | Modelo | Persistencia | Root | UI |
|---|---|---|---|---|
| iOS | `ThemePreference` en `Services/ThemeService.swift` (`@MainActor @Observable`) | `UserDefaults` `theme_preference` | `CalendarioCiclismoApp.swift` → `.preferredColorScheme(...)` | `SettingsView.swift` → `appearanceSection` |
| Android | `data/prefs/ThemePreference.kt` (enum `SYSTEM`/`LIGHT`/`DARK`) | DataStore `theme_preference` | `MainActivity.kt` → `runBlocking { preferences.snapshotThemePreference() }` ANTES de `setContent` | `SettingsScreen.kt` → `SingleChoiceSegmentedButtonRow` |

- Etiquetas: "Automático" / "Claro" / "Oscuro".
- **Anti-flicker Android:** `runBlocking` antes de `setContent` evita flash del tema opuesto.
