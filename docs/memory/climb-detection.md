# Detección de puertos y perfil de elevación

## Detector heurístico — `js/climb-detection.js` (dual-pass)

### `detectClimb(points, summitKm)`

Dos pases:

1. **Estricto:** itera hacia atrás desde la cima; solo extiende si la pendiente del primer `LOCAL_WINDOW_KM = 2` km desde el candidato es ≥ `MIN_LOCAL_GRADIENT_PCT = 3 %`. Evita absorber valles suaves previos.
2. **Permisivo** (si el estricto devuelve null): umbral `MIN_LOOSE_GRADIENT_PCT = 1 %`. Captura puertos largos suaves continuos (Göygöl 13.7 km al 2.3 %) sin absorber mesetas llanas.

Filtros comunes: longitud máx 50 km / mín 0.5 km, pendiente media final ≥ `MIN_GRADIENT_PCT = 2 %`.

**Tolerancia en summitKm:** si supera el último punto del GPX hasta 2 km, se trata como si estuviera en el último punto (evita rechazar Angliru por discrepancia de 0.02 km).

### `computeClimbStats(points, startKm, summitKm, summitAltOverride?)`

Para render: deriva longitud y % a partir del `startKm` ya guardado. Si la cima tiene `altitude` manual, se respeta como override para el cálculo del desnivel.

### `effectiveSummitAlt(summit, points)`

Fuente de verdad de la altitud para el render. Con GPX, devuelve siempre la altitud interpolada de la curva (ignora `summit.altitude` manual). Sin GPX cae al valor manual. Aplica en `elevation-profile.js` (anchor del summit + zona sombreada) y en las cajas "Puertos" de `perfil-pub.js` y `perfil.js`.

## Render

### Summits fuera de rango del GPX

`elevation-profile.js` capea summits cuyo km supere `xMax` del GPX en hasta 2 km (`SUMMIT_OVERSHOOT_TOL`). **Misma tolerancia que el detector — paridad obligatoria.**

### Sombreado + tooltip (web)

Para cada summit con `startKm`, dibuja `<path class="ep-climb-zone">` con fill `SUMMIT_COLOR` opacidad 0.22. `hoverData.climbs[]` expone `{startKm, endKm, lengthKm, avgGradient, gain, summitAlt, name, category}`. Cuando el cursor cae dentro del tramo, el tooltip muestra "Nombre · X km · ±Y % · desnivel Z m" (idioma según `lang`).

### iOS (`ElevationProfileView.swift`)

`ProfileSummit.climbStats(points:)` devuelve `(lengthKm, avgGradient)`. El Canvas dibuja el área antes de la curva (`Color.summitRed.opacity(0.22)`). Tap dentro de la zona muestra `climbTooltip`. La fila `SummitRow` muestra `X km · ±Y%`.

### Android (`ElevationProfileScreen.kt`)

`ProfileSummit.climbStats(points)` con misma firma. Canvas pinta `ColorSummit.copy(alpha = 0.22f)`. `detectTapGestures` detecta tap; muestra `Surface` tooltip alineado a `TopStart`. Fila de la sección de puertos muestra `X km · ±Y%`.

## Editor del panel (`js/panel.js`)

Cada fila de `summitRowHTML` incluye:
- input `.ann-start` (km de inicio, opcional).
- botón `.ann-detect-btn` (⌖) — invoca `detectClimb` con el km de la cima.
- span `.ann-stats` que muestra "X km · Y %" calculado en vivo.

Al introducir el km de la cima, si `.ann-start` está vacío se intenta autodetectar silenciosamente. `startKm` se persiste como propiedad opcional dentro de cada item de `profileSummits` (JSONB). iOS (Swift Codable) y Android (kotlinx con `ignoreUnknownKeys = true`) ignoran el campo sin romper.

### Disparo automático tras subir GPX

`_gpxHandleUpload` en `js/panel.js`, después de actualizar `_editorCache.rd.elevationProfile`, recorre las filas de `#summitsList`: si la fila tiene `km` y no tiene `startKm`, lanza `_autoDetectSummitClimb(row, /*silent*/true)`. Toast de aviso si detecta al menos un puerto.

## Backfill masivo

Backfill ejecutado el 2026-05-06: 183 puertos rellenos de 215. 32 sin match (preferible `null` antes que datos malos). Era un one-shot: el tooling (`tools/backfill-climbs/index.mjs` + workflow `.github/workflows/backfill-climbs.yml`, que nunca llegó a ejecutarse en Actions) se retiró el 2026-07-13 tras cumplir su función. Si vuelve a hacer falta un backfill masivo de `startKm`, reconstruirlo importando `js/climb-detection.js` (mismo módulo que el detector) y escribiendo por el pooler IPv4 con `SUPABASE_SERVICE_ROLE_KEY`; idempotente respetando `startKm` ya existente.

## Tests

`js/__tests__/climbDetection.test.js`. Añadir caso al cambiar la heurística. Constantes del detector en `js/climb-detection.js` — el script de backfill importa el mismo módulo.

## Página de perfil — Sprints vs Puntos intermedios en CRI/CRE

En la sección "Puntos clave" (`js/perfil-pub.js` y `js/perfil.js`):

- **Por defecto** → "Sprints (N)": waypoints `intermediate_sprint` y `bonus_sprint`. Sufijo `· Sprint Int.` / `· Bonificación`.
- **Si `rd.primaryType === 'itt' || 'ttt'`** → "Puntos intermedios (N)": waypoints `intermediate_split`. Sin sufijo. La descripción SEO usa "puntos intermedios".

`isTimeTrial` decide qué subconjunto mostrar y el título de la caja. La caja "Puertos" no cambia. Si se añade un tipo nuevo que no debe mostrar sprints, ampliar la condición.
