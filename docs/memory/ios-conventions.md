# iOS — Convenciones de estilo y configuración

## Convenciones de estilo en dark mode

- **Botones/chips interactivos:** fondo `Color.accentColor`, texto `.white`, peso `.semibold`. NO usar `Color.accentColor.opacity(0.1)` — casi invisible en dark mode. Referencia: filtros de categoría en `SeasonView.swift` (~líneas 94-124).
- **Textos secundarios en cards oscuras:** usar `.secondary`, no `.tertiary` (`.tertiary` es demasiado tenue). `.tertiary` solo para elementos decorativos.
- **Iconos de acción en cards oscuras:** usar `.white`, no `Color.accentColor`.
- Archivos: `StageDetailView.swift` (incluye `BroadcastRowView`, `FlowLayout`), `SeasonView.swift` (referencia de filtros).

## `SWIFT_ACTIVE_COMPILATION_CONDITIONS`

Flag histórico `PREMIUM_TEST_BUILD`, reutilizado para simular Amigo activo:
- Config Release del target principal (`project.pbxproj`, config `3E254B27AFC6A314812BB591`). Debug NO lo lleva.
- Lecturas vía `#if PREMIUM_TEST_BUILD` en `Services/PremiumService.swift` fuerzan `isSubscribed = true` y evitan que la sincronización lo desactive.
- **Para reactivar:** añadir `PREMIUM_TEST_BUILD` a `SWIFT_ACTIVE_COMPILATION_CONDITIONS` del Release + bumpar `CURRENT_PROJECT_VERSION`.
- **Para desactivar:** borrar `SWIFT_ACTIVE_COMPILATION_CONDITIONS = PREMIUM_TEST_BUILD;` del Release + bumpar.

## Xcode Cloud

- **Workflow `Default` → Start Condition:** push a `main` con filtro de ruta `/ios-app/`. Cambios fuera de `ios-app/` no disparan build.
- **Secrets:** `Supabase.xcconfig` y `GoogleService-Info.plist` están en `.gitignore`. Se regeneran en cada build desde variables de entorno del workflow:
  - `SUPABASE_URL` (sin `//` escapado — el script se encarga)
  - `SUPABASE_ANON_KEY` (Secret)
  - `GOOGLE_SERVICE_INFO_PLIST_B64` (Secret) — plist Firebase entero en base64. Generar con `base64 -i ios-app/CalendarioCiclismo/GoogleService-Info.plist`.
- **Script pre-build:** `ios-app/ci_scripts/ci_pre_xcodebuild.sh`. Xcode Cloud lo ejecuta automáticamente.
- El formato xcconfig trata `//` como comentario; el script escapa con `$()` para que `https://…` sobreviva.
- **Archivos `.swift` nuevos:** Xcode Cloud compila del `.pbxproj` commiteado (no regenera con XcodeGen). Al añadir un `.swift` nuevo hay que registrarlo en el `.pbxproj` — corriendo `./setup.sh` (XcodeGen) y commiteando el resultado, o añadiendo a mano sus 4 entradas (PBXBuildFile + PBXFileReference + grupo + fase Sources) para los targets correspondientes.
- **Contador efectivo (2026-07-24):** Xcode Cloud ha emitido la build **1208** para el último push. Antes de la próxima entrega iOS, tomar 1208 como referencia y asignar un `CURRENT_PROJECT_VERSION` superior (1209 o más), aunque el número del proyecto sea inferior.

### Script post-build — reporte de errores en GitHub

`ios-app/ci_scripts/ci_post_xcodebuild.sh` — se ejecuta tras cada build, incluso si falla. Extrae errores del `.xcresult` y los publica como comentario en GitHub (en el PR si hay `CI_PULL_REQUEST_NUMBER`, o en el commit).

**Prerequisito:** añadir en App Store Connect → Xcode Cloud → workflow Default → Environment Variables el secret `GITHUB_TOKEN` (PAT con `repo:write`).

**Cuando hay un fallo:** buscar el comentario `❌ Xcode Cloud — Build fallido` en el commit de `main`. Contiene ruta del archivo + mensaje de error exacto — usar directamente sin reproducir el build.

**Variables Xcode Cloud usadas:** `CI_XCODEBUILD_EXIT_CODE`, `CI_COMMIT`, `CI_BRANCH`, `CI_BUILD_NUMBER`, `CI_PULL_REQUEST_NUMBER`, `CI_DERIVED_DATA_PATH`.

## Bump de versión iOS (solo si el usuario lo pide)

Archivo: `ios-app/CalendarioCiclismo.xcodeproj/project.pbxproj`. Actualizar los 6 sitios a la vez (Debug + Release × 3 targets). `Info.plist` usa `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` — no convertir a literales.

`MARKETING_VERSION` solo acepta dígitos y puntos (`MAJOR.MINOR.PATCH`). Sufijos como `-dev` provocan rechazo de App Store Connect. Debe coincidir siempre con Android `versionName`.

## Fix bug layout tras canjeo de código promocional

`AppStore.presentOfferCodeRedeemSheet(in: scene)` se monta UIKit fuera del árbol SwiftUI; al cerrarse deja la safe-area corrupta. Workaround en `PremiumService.swift`: flag `isRedeemingCode` evita que la paywall se auto-cierre durante el canjeo; tras el `await` un `invalidateRootLayout()` fuerza `setNeedsLayout`/`layoutIfNeeded` en todas las windows.
