# Buscador de las apps — ARCHIVADO (2026-07-16, apps 4.0)

La pestaña **Buscar** se retiró de las apps en la 4.0 para dejar su sitio a
**Fichajes** (decisión Dani). El buscador **web** (`buscar.html` + `js/buscar.js`)
NO se tocó y sigue vivo. Este directorio conserva el código nativo por si el
buscador vuelve a las apps en el futuro.

## Qué hay aquí

- `android/SearchScreen.kt` — pantalla completa (modelos `SearchResult`/`RaceHit`,
  scoring `normalize`/`scoreText`/`findMatchLocation`/`hitSortKey`, filas y estado
  vacío). Vivía en `ui/search/SearchScreen.kt`. Sin ViewModel separado ni tests.
- `ios/SearchView.swift` — vista (vivía en `Views/Search/`).
- `ios/SearchViewModel.swift` — VM + modelos `SearchResult`/`SearchHit`
  (vivía en `ViewModels/`).

## Qué se retiró además de estos archivos (restaurar a mano si vuelve)

### Android
- `Routes.kt`: `const val SEARCH = "search"` + entrada en `MAIN_TABS`.
- `AppNavHost.kt`: import de `SearchScreen`, `composable(Routes.SEARCH)`,
  `TabItem(Routes.SEARCH, R.string.tab_search, Icons.Filled.Search)` y la rama
  de analytics.
- `MainActivity.kt`: mapeo App Link `"buscar.html" -> DeepLink.Tab("search")` y
  la rama `"search" -> Routes.SEARCH` de `handleDeepLink`.
- `DeepLink.kt`: `"search"` en `TAB_NAMES`.
- `strings.xml` + `values-en/strings.xml`: `tab_search`.
- `SupabaseService.raceDaysForSearch(year)` y
  `CalendarRepository.searchRaceDays(year)` (delegaban en `raceDaysInRange`,
  que se conserva — lo usan Mes/Temporada).

### iOS
- `ContentView.swift`: bloque `Tab("Buscar"/"Search", systemImage:
  "magnifyingglass", value: 3)` con `SearchView()`.
- `NotificationManager.swift`: `"search": 3` en `tabMap` (y reindexar el resto).
- `AccessibilityHelpers.swift`: `tabSearch`, `searchField`, `searchResults`.
- `Tests/AccessibilityTests.swift`: esas IDs en `testAccessibilityIDsAreUnique`.
- `SupabaseService.raceDaysForSearch(year:)` (delegaba en `raceDays(from:to:)`,
  que se conserva).
- ⚠️ Añadir los `.swift` de vuelta exige `./setup.sh` (xcodegen) y restaurar
  después el scheme manual `CalendarioAnalytics.xcscheme` desde `origin/main`.

## Contexto de época (por si cambió al restaurar)

- El buscador solo listaba CARRERAS (los corredores se retiraron con las fichas
  públicas el 2026-06-29).
- La paginación de `raceDaysInRange`/`raceDays(from:to:)` en chunks de 1.000
  (fix del tope PostgREST, builds 332/1134) ya estaba integrada.
