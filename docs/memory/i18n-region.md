# Localización, región y tema

## Localización ES / EN

Idioma controlado por preferencia local. **Ambos idiomas son gratuitos desde 2.1** (en 2.0 el inglés era gate Premium).

### Persistencia

| Plataforma | Servicio | Key | Storage |
|---|---|---|---|
| iOS | `Services/LocaleService.swift` (`@Observable`, default `.spanish`) | `app_locale` | `UserDefaults` + `AppleLanguages` |
| Android | `data/prefs/LocalePreference.kt` (`SPANISH("es")`, `ENGLISH("en")`) | `app_locale` | DataStore (`AppPreferences.appLocale` / `snapshotAppLocale()`) |

### Aplicación al runtime

- **iOS:** `CalendarioCiclismoApp.swift` inyecta `.environment(\.locale, localeService.current.locale)` en `ContentView` y en la bienvenida.
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

### Bienvenida, paso 1: idioma

- Primer paso de la bienvenida única (`WelcomeOnboardingView` en iOS, `WelcomeOnboardingScreen` en Android; resto de pasos en `docs/memory/apps.md`, «Bienvenida»).
- Tarjeta «Idioma / Language», sin subtítulo, con los botones «Español» y «English», los dos con el mismo peso visual (decisión de Dani, 2026-11-17: ningún idioma se destaca). Hasta elegir, el lema de la cabecera usa el idioma del dispositivo.
- Al elegir, la tarjeta se pliega a una fila «Idioma» o «Language» con el selector segmentado, que se puede seguir cambiando.
- **Persistencia:**
  - iOS: `LocaleService.hasShownLanguageAnnouncement` (`UserDefaults["language_announcement_done"]`).
  - Android: `AppPreferences.languageAnnouncementDone` (DataStore `language_announcement_done`).
- **Migración de quien usaba la 2.0 en inglés:** si `app_locale == "en"` al arrancar, la marca pasa a `true` y el paso aparece ya respondido.
- **Android, dispositivo en otro idioma:** en una instalación limpia la app arranca con los recursos del sistema aunque `appLocale` valga español por defecto (observado en el emulador con Android en inglés, 2026-11-17: la llamada a `AppCompatDelegate.setApplicationLocales` de `onCreate` no cambia los recursos; sí lo hace `LocaleManager` al elegir idioma). Por eso `chooseLanguage` aplica el idioma también cuando coincide con la preferencia guardada, si no es el que se está mostrando.
- **Orden en Android:** la marca se guarda antes de aplicar el idioma al sistema, porque cambiar a inglés recrea la actividad; al recrearse, la bienvenida abre en el paso de notificaciones y el arranque de Compose no se repite (`showSplash` con `rememberSaveable`).

### Reglas al modificar strings

- **No traducir** contenido de Supabase (nombres de carrera, descripciones, canales TV).
- **Android:** editar AMBOS `values/strings.xml` y `values-en/strings.xml` simultáneamente.
- **iOS:** editar `Localizable.xcstrings`. Si solo se añade en `es`, el lookup EN cae al `sourceLanguage` (español).
- **Naming:** `screen.section.element` (p.ej. `today.filter.all`, `settings.theme.title`).

---

## Dominios web

El sitio inglés se sirve en `calendariociclismo.app/en/`. No hay dominio EN
dedicado: `CONFIG.enDomain` está vacío en el build (`build-site.yml`). Detalle
del código implicado: `docs/memory/seo-og-pages.md` → «El sitio inglés vive en
`/en/`».

### `cyclocal.app` — puente de redirección (verificado el 2026-09-28)

`cyclocal.app` no sirve contenido. Toda petición la atiende el Worker
`cyclocal-proxy` (`workers/cyclocal/src/index.js`) mediante la ruta
`cyclocal.app/*`, creada a mano en el dashboard (Workers Routes de la zona); no
figura en `wrangler.toml` porque el token de CI no tiene permiso de zona.
Ninguna Redirect Rule, Page Rule ni Bulk Redirect intercepta las rutas probadas
(se ejecutarían antes del Worker): las respuestas reproducen la lógica
específica del Worker, incluida la caída a `/en/` de rutas desconocidas
(`/es/` → `/en/`) y la vuelta a raíz de `/js/…` (301 sin cuerpo,
`server: cloudflare`).

| Petición a `cyclocal.app` | 301 a `calendariociclismo.app` |
| --- | --- |
| `/`, `/index.html` | `/en/` |
| `/season/`, `/month/`, `/about/`, `/privacy/`, `/subscription/`, `/beta/` | misma carpeta bajo `/en/` |
| `/search/` | `/en/` (buscador web retirado el 2026-09-28) |
| `/race/`, `/stage/`, `/startlist/`, `/profile/`, `/start-order/` + slug | mismo prefijo bajo `/en/` |
| `/js/`, `/css/`, `/i18n/`, `/favicon*`, `/apple-touch-icon*`, `/sitemap*`, `/atom.xml`, `/robots.txt`, `/llms.txt` | misma ruta en la raíz |
| `/en/…` | misma ruta |
| cualquier otra | `/en/` |

La query string se conserva. HTTP redirige igual que HTTPS. `www.cyclocal.app`
no tiene registro DNS y no responde.

- Deploy: `.github/workflows/deploy-cyclocal-worker.yml` en cada push a `main`
  que toque `workers/cyclocal/`. También publica
  `cyclocal-proxy.<subdominio>.workers.dev`.
- Sustitución posible por reglas de Cloudflare: una Single Redirect con
  comodín (`https://cyclocal.app/*` → `https://calendariociclismo.app/en/${1}`)
  cubre `/`, las carpetas y los slugs, pero no la vuelta a raíz de los assets,
  el paso directo de `/en/…`, `/search/` ni la caída a `/en/` de rutas
  desconocidas; replicarlo exige varias reglas ordenadas. El Worker se mantiene
  mientras el dominio siga registrado.
- Retirada del dominio: borrar la ruta y el Worker `cyclocal-proxy` en
  Cloudflare, y después `workers/cyclocal/`, su workflow y la entrada de
  `knip.json`.

---

## Región (detección automática)

La región no se elige a mano: se detecta a partir de la zona horaria del
dispositivo, igual que la web (`_detectUserGroup` y `filterBroadcastsByRegion`
en `js/shared.js`). No hay selector en Ajustes ni preferencia persistida
(se retiraron `region_preference` y `preferred_country_group`).

### Detección por TZ

| Plataforma | API | Archivo |
|---|---|---|
| iOS | `RegionService.suggestedRegion`, `detectedCountryGroup`, `allowedBroadcastGroups`, `isEuropean` | `Services/RegionService.swift` |
| Android | `RegionDetector` equivalentes | `util/RegionDetector.kt` |

Reglas TZ → bucket (`suggestedRegion`): Madrid/Canarias/Ceuta → `SPAIN`. Resto
Europa → `EUROPE`. America/* + Pacific/Honolulu → `AMERICAS`. Asia/* + Pacific/*
+ Australia/* + Indian/Christmas+Cocos → `ASIA`. Africa/* (no Ceuta) → `AFRICA`.
Fallback → `SPAIN`. Nunca devuelve `ALL`. Añadir una TZ nueva → tocar **ambas**
implementaciones.

Reglas TZ → grupo fino `broadcasts.country` (`detectedCountryGroup`): mapa de
Europa fina (ES, PT, FR, BE, NL, IT, DE_AT_CH, UK_IE, SCANDI, EE) y prefijos
para `NORTEAM`, `LATAM`, `MENA`, `AFRICA`, `ASIAPAC`. Paridad con
`_COUNTRY_TZ_MAP` y `_extracontinentalGroup` de `js/shared.js`.

### Visibilidad de canales de TV

`allowedBroadcastGroups(TZ)` replica la web de forma exacta: siempre `ALL`; el
grupo fino detectado; y `EUROPA` solo si el usuario es europeo y no está en
`UK_IE`. Consumidores: iOS `TVBadge`, `StageDetailViewModel`,
`ChampionshipsView`, `CxRaceDetailView`; Android `TVBadge`,
`ChampionshipsScreen`, `StageScreen`, `CxRaceScreen`.

### Bucket para push

`push_subscriptions.region` conserva los seis buckets y su CHECK en la base de
datos. La app envía `suggestedRegion(TZ).name` como `region` y
`detectedCountryGroup(TZ)` como `countryGroup`. No hay override manual.

### Reglas al modificar

- Añadir grupo fino nuevo → mapa TZ en iOS y Android, `_COUNTRY_TZ_MAP`/
  `_extracontinentalGroup` en web, `VALID_COUNTRY_GROUPS` en `send-push`, y
  CHECK constraints de migraciones.
- Ninguna región depende de una compra.

---

## Preferencia de tema

| Plataforma | Modelo | Persistencia | Root | UI |
|---|---|---|---|---|
| iOS | `ThemePreference` en `Services/ThemeService.swift` (`@MainActor @Observable`) | `UserDefaults` `theme_preference` | `CalendarioCiclismoApp.swift` → `.preferredColorScheme(...)` | `SettingsView.swift` → `appearanceSection` |
| Android | `data/prefs/ThemePreference.kt` (enum `SYSTEM`/`LIGHT`/`DARK`) | DataStore `theme_preference` | `MainActivity.kt` → `runBlocking { preferences.snapshotThemePreference() }` ANTES de `setContent` | `SettingsScreen.kt` → `SingleChoiceSegmentedButtonRow` |
| Web y panel | Tema del dispositivo (`prefers-color-scheme`), sin elección | Ninguna; `js/theme.js` borra las claves retiradas `cc-theme` y `cc-theme-auto` | Script inline del `<head>` y `js/theme.js` → `html.light` / `html.dark`; `js/theme.js` sigue los cambios del sistema con la página abierta | Sin selector |

- Etiquetas: "Automático" / "Claro" / "Oscuro".
- **Anti-flicker Android:** `runBlocking` antes de `setContent` evita flash del tema opuesto.

