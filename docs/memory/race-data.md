# Race data — logos, assets, botón web, país, inscritos, orden de salida

## Logos de carrera — 3 capas de almacenamiento

`RaceLogo` (iOS: `Views/Components/RaceLogo.swift` · Android: `ui/components/RaceLogo.kt`) resuelve en este orden:

1. **Bundle empaquetado** — `ios-app/CalendarioCiclismo/BundledLogos/` y `android-app/app/src/main/assets/bundled_logos/`. Embebido en el binario. Permite render sin red en el primer arranque.
2. **Caché offline en disco** — `OfflineCache/Images/logo_<sha1Prefix(url)>.<ext>`. Solo se rellena si el modo offline está activo (sync diario: `OfflineManager` iOS / `OfflineSyncWorker` Android).
3. **URL remota** (Cloudflare R2) — fallback con `CachedAsyncImage` (iOS) / Coil (Android).

**Hash compartido:** `sha1(url)[:20]` idéntico en `CacheManager.logoFilename` (iOS), `ImageAssetCache` (Android) y `scripts/fetch-logos.mjs`/`bundle-logos.yml`. Si cambia en uno, hay que tocar los tres.

### ⚠️ De dónde salen los logos del bundle (cambió el 2026-07-18)

Los logos de carrera son **obras de terceros** (organizadores, federaciones) → con el repo público bajo AGPL **NO se redistribuyen**: `ios-app/CalendarioCiclismo/BundledLogos/` y `android-app/app/src/main/assets/bundled_logos/` están en **`.gitignore`** (solo se versiona un `.gitkeep`). Se **reconstruyen** desde `races.logoUrl` en Supabase (la fuente de verdad; antes se descargaban de R2 y se **commiteaban** al repo — eso ya NO se hace):

- **Local (día a día):** `node scripts/fetch-logos.mjs` **antes** de compilar iOS/Android. Sin binarios de sistema, no optimiza. `--force` re-descarga, `--prune` borra los que ya no están en BD.
- **iOS release (Xcode Cloud):** `ios-app/ci_scripts/ci_pre_xcodebuild.sh` descarga los logos con `python3` justo antes del build (no bloqueante: si falla, el bundle queda con lo que hubiera y las apps caen a la capa 3 = red).
- **Bundle optimizado (opcional):** `bundle-logos.yml` (cron **DESACTIVADO**; solo `workflow_dispatch`) además redimensiona a 192 px y comprime con `pngquant`+`oxipng`, y publica el resultado como **artefacto** (ya **NO** commitea al repo). Requiere binarios de sistema.

**iOS — `BundledLogos` es una REFERENCIA DE CARPETA, no una lista de archivos.** En `ios-app/project.yml` va como `type: folder` (excluido del escaneo recursivo de `CalendarioCiclismo`) → el `.pbxproj` tiene **una** entrada de carpeta, no ~500 `PBXFileReference`. Así el build empaqueta lo que haya en disco (o nada). **Motivo:** cuando los logos se enumeraban archivo a archivo, cada vez que un `logoUrl` cambiaba (nuevo hash) o se purgaba, el `.pbxproj` quedaba apuntando a ficheros inexistentes y el build fallaba con `The file logo_….webp couldn't be opened because there is no such file` (roto al mover los logos a `.gitignore`, 2026-07-18). **NO volver a enumerar los logos en el proyecto**: si `setup.sh`/xcodegen empieza a listarlos otra vez, revisar que la exclusión `- BundledLogos` + el source `type: folder` siguen en `project.yml`. Android no sufre esto: los `assets/` se empaquetan como carpeta por naturaleza.

**Esquema offline v2:** `OfflineManager.cacheSchemaVersion = 2` añadió descarga de logos. Bump al añadir nuevos tipos de artwork descargado.

## Assets documentales de jornadas

**DB:** `assets` (`id`, `raceDayId`, `type`, `sourceType='external'`, `url`). Flag denormalizado: `race_days.hasAssets` (no lo activa `live_text`).

**Storage:** Cloudflare R2 vía `supabase/functions/r2-upload/index.ts`. URL: `https://assets.calendariociclismo.app/{ts}-{slug}.{ext}`.

### Tipos, orden y labels

| Tipo | Etiqueta | iOS SF Symbol | Android Material | En competición |
|---|---|---|---|---|
| `startOrder` | Orden Salida | `timer` | `Icons.Filled.Timer` | No |
| `roadbook` | Rutómetro | `doc.text` | `Icons.Filled.Description` | Sí |
| `profile` | Perfil | `chart.line.uptrend.xyaxis` | `Icons.Filled.ShowChart` | Sí |
| `ports` | Puertos | `mountain.2` | `Icons.Filled.Terrain` | No |
| `map` | Mapa | `map` | `Icons.Filled.Map` | Sí |
| `live_text` | Live texto | `text.bubble` | `Icons.Outlined.ChatBubbleOutline` | No |

Orden en jornada: Inscritos → `startOrder` → `roadbook` → `profile` → `ports` → `map` → `live_text`.

`profile` + `ports` coexistiendo en web (`js/jornada.js`, `js/race-data-modal.js`) → dos botones separados "Perfil" y "Puertos" (o "Sterrato"/"Ribinou" si `primaryType === 'sterrato'`).

Añadir tipo nuevo → tocar constantes en las 3 plataformas + `assetDocTypes` en `panel.js`.

## Botón Web oficial en jornadas

`races.websiteUrl` (TEXT, migración `010_races_website_url.sql`) — primer botón de "Documentación", antes de Inscritos. Enlace externo siempre. Replicado en panel (`er-website`), web (`js/jornada.js`, `js/race-data-modal.js`), iOS (`Race.swift` + `StageDetailView.swift`, icono `globe`), Android (`Race.kt` + `RaceEntity.kt` + `StageScreen.kt`, icono `Icons.Outlined.Language`).

- El campo vive en `races`, no en `race_days`.
- La condición de visibilidad de "Documentación" debe incluir `race?.websiteUrl != nil/null`.
- Room version bump (2→3) al añadir la columna.

## Override de país por jornada (`race_days.countryCode`)

Sobrescribe **solo la bandera visual**. Nunca afecta filtros de país. Migración `011_race_days_country_code.sql`. Room bump 3→4.

- **Override vence a `hideFlag`:** si `race.hideFlag = true` pero `rd.countryCode` tiene valor, esa jornada sí muestra bandera. Regla: `race.hideFlag && !rd.countryCode` (web) / `race.hideFlag != true || rd.countryCode != nil` (iOS/Android).
- **Helper web:** `effectiveCountryCode(rd, race)` en `js/shared.js` → `rd.countryCode || race.countryCode`.
- **Dónde aplica:** Hoy (cards), Mes (modo agenda), Jornada (cabecera), modal `race-data-modal.js`.
- **Dónde NO aplica:** vista de competición, Temporada, Buscar, PlaceholderModal.
- **iOS/Android:** patrón `rd.countryCode ?? race?.countryCode`.
- `race-data-modal.js` pinta la cabecera dos veces para evitar parpadeo — no simplificar.
- **Dropdown de país en el panel: `position: fixed` anclado al `body`.** `.editor-section` tiene `overflow: hidden`, lo que clipa dropdowns en `absolute`.

## Botones de resultados (FirstCycling / ProCyclingStats)

Solo web. Se integran en la sección TV. Título adaptativo: solo TV → "Televisión"; solo resultados → "Revive la carrera"; ambos → "Televisión · Revive la carrera".

**Visibilidad:** no en rest days ni cancelados; la carrera debe tener `fcId` o `pcsSlug`; si hay `estimatedFinishTimeUtc`, se muestran a partir de T-30 min (hora del cliente vs UTC).

**URLs — FirstCycling:** clásica → `race.php?r={fcId}&y={year}`; etapa → añade `&e={NN}` (2 dígitos con padding).

**URLs — PCS:** clásica → `/race/{pcsSlug}/{year}/result/result/result`; etapa → `/race/{pcsSlug}/{year}/stage-{n}/result` (sin padding); prólogo (`stageNumber === 0`) → `/race/{pcsSlug}/{year}/prologue/result`.

| Archivo | Cambio |
|---|---|
| `js/jornada.js` | `shouldShowResults`, `buildFcUrl`, `buildPcsUrl`, integración en sección TV/enlaces |
| `css/app.css` | `.result-section-btns` + regla compartida `.tv-link-btn, .result-btn` |
| `js/panel.js` | Campos fcId/pcsSlug en `openEditRaceModal`/`saveEditRace`; sección "Resultados" en `renderEditor()` |
| `panel/app.html` | Campos `er-fcId`, `er-pcsSlug` con botones "Buscar ↗" |
| `ios-app/.../Views/Today/ResultsSheet.swift` | `ResultsLinkButton` con bg `Color.accentColor` + fg `.white` |

## Inscritos (startlists)

### `races.startlistImportedAt`

Marca `TIMESTAMPTZ` (nullable). Los 2 puntos de escritura (`saveStartlistEdits`, `deleteStartlist` en `js/panel.js`) deben mantener la columna en sync. Al guardar → `new Date().toISOString()`. Al borrar → `null`.

**Importación con IA deshabilitada (2026-05-05):** solo edición manual. El Edge Function `parse-startlist` permanece en el repo pero no se invoca desde el panel.

**Consumo:** botón "Inscritos" se deriva de `race.startlistImportedAt != null`. Ubicaciones: `js/jornada.js` (`hasStartlist`), `StageDetailViewModel.swift`, `StageScreen.kt`.

### Nacionalidad por corredor (`startlist_riders.countryCode`)

`TEXT` nullable, ISO 3166-1 alpha-2 en minúsculas (acepta sub-tag `es-ct`). Migración `034_startlist_riders_country_code.sql`. **Solo se renderiza en la página pública `/inscritos/{slug}/`** — no en iOS, Android ni en el PDF.

- **Editor:** input `.sl-country` por fila; `.sl-flag-preview` muestra mini-bandera en vivo.
- `saveStartlistEdits` valida con regex `/^[a-z]{2}(-[a-z0-9]{2,4})?$/` y guarda `null` si no es válido.
- **Render web:** `js/inscritos.js` añade `<span class="startlist-rider__flag">` con `countryFlag()`.

## Orden de Salida

Página `/orden-salida/{rdSlug}/` para CRI/CRE.

**DB:** tabla `start_order_entries` (`id`, `raceDayId`, `sortOrder`, `dorsal`, `startTime`, `riderId` nullable FK startlist_riders, `riderName`, `teamName`, `countryCode`) + columnas `race_days.startOrderImportedAt TIMESTAMPTZ`, `race_days.startOrderTtDorsals INT[]`, `race_days.startOrderGcDorsals INT[]`, `race_days.timezone TEXT` (IANA, p.ej. `Asia/Tokyo`). Migración `055_start_order.sql` + `add_timezone_to_race_days`.

**Web:** `orden-salida.html` + `js/orden-salida.js`. Pre-renderizado por `og-pages.yml`. Incluido en `sitemap.yml`. Si `rd.timezone` está informado y difiere de la zona del visitante, las horas se renderizan en la zona del usuario con tooltip mostrando la hora local de la carrera, y se anota un prefijo `±Nd` cuando la conversión cruza la medianoche.

**Helpers `shared.js`:** `startOrderUrl(rd)` → URL relativa; `startOrderFullUrl(rd)` → URL canónica completa.

**Panel:** sección "Orden de Salida" en la pestaña Documentación del editor de jornadas (solo CRI/CRE). Campos: textarea `HH:MM:SS dorsal`, dorsales TT/GC para filtros, y `Zona horaria de la jornada` (IANA, validada con `Intl.DateTimeFormat`). Al guardar el orden: (1) elimina entradas antiguas, (2) inserta nuevas cruzando por dorsal con `startlist_riders`, (3) actualiza `startOrderImportedAt` + grupos TT/GC + `timezone`, (4) crea/reemplaza el asset `startOrder` (URL por slug ES o, en su defecto, fallback a `/orden-salida.html?id=…`), (5) sincroniza input de URL en Documentación. El botón "Guardar zona y grupos" persiste timezone + dorsales sin tocar las entradas.

**Consumo desde apps (sin cambios en código nativo):** iOS `RaceCardView.swift` y Android `TodayScreen.kt` leen `assets.first(where: { $0.type == "startOrder" })?.url`, solo muestran badge si `rd.primaryType == "itt" || "ttt"`. Abren en Safari sheet / CustomTabsIntent.

**Reglas:**
- Solo aplica a jornadas `primaryType == "itt"` o `"ttt"` en apps. La web no tiene esta restricción.
- El cruce por dorsal requiere startlist importada; si no hay match, la entrada se guarda con `riderName/teamName/countryCode = null`.
- Al eliminar: borra `start_order_entries`, limpia `startOrderImportedAt` + grupos TT/GC (la `timezone` se preserva), elimina el asset `startOrder`.
