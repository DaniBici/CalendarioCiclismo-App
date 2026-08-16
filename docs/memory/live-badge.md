# Indicador de retransmisión en vivo (Live Badge)

Documentación técnica del indicador de retransmisión en vivo.

Indicador visual que aparece en cards de `Hoy`, jornada individual, modal de datos de carrera y vista de competición cuando una emisión TV está activa.

## Lógica de activación

`tvBadgeCard()` en `js/app.js` (~líneas 139-210):

1. `tvStatus = 'confirmed_time'` **AND**
2. `broadcast.startTimeUtc <= NOW`

Sin `endTimeUtc` definido, el badge permanece como "Live" indefinidamente mientras la condición se cumpla.

Estados resultantes:
- Broadcast con hora y en directo → `"Live"` con clase `.badge--tv--live` (verde).
- Broadcast confirmado sin hora → `"TV"` con clase `.badge--tv` (azul).
- Sin TV → `"Pending"` o `"Unavailable"` según `tvStatus`.

## Estilos CSS (`css/app.css` ~líneas 1099-1100)

```css
.badge--tv--live        { background: rgba(109,213,140,0.15); color: var(--green); }
.badge--tv--live:hover  { background: rgba(109,213,140,0.3); }
```

- **Verde:** `#6dd58c` (variable `--green`).
- **Fondo defecto:** `rgba(109,213,140,0.15)` (15 % opacidad).
- **Fondo hover:** `rgba(109,213,140,0.3)` (30 % opacidad).
- Mismos colores en tema claro y oscuro (sin overrides locales).
- **Sin animación pulso actualmente.** El `@keyframes cc-dot-pulse` existe en CSS pero solo se aplica a loaders (`.loading__dots`), no al live badge.

## Arquitectura por plataforma

| Plataforma | Archivo | Función |
|---|---|---|
| Web (Hoy) | `js/app.js:139-210` | `tvBadgeCard()` |
| Web (jornada) | `js/jornada.js:442-461` | Render sección TV |
| Web (competición) | `js/competicion.js` | `tvBadge()` (lógica idéntica) |
| iOS | `StageDetailView.swift` | `BroadcastRowView` |
| Android | `StageScreen.kt` | Composable de broadcast |

## Datos origen (tabla `broadcasts`)

| Columna | Tipo | Uso |
|---|---|---|
| `startTimeUtc` | `TIMESTAMPTZ` nullable | Inicio de la emisión |
| `endTimeUtc` | `TIMESTAMPTZ` nullable | Fin (opcional) |
| `url` | `TEXT` | Enlace a la emisión |
| `embeddable` | `BOOLEAN` nullable | Si permite iframe en web (YouTube) |

Carga: eager en `js/app.js` (~línea 261), todos los broadcasts de la jornada al renderizar Hoy.

## Prioridad del enlace del badge (qué emisión se abre al pulsar)

Cuando una jornada tiene varios broadcasts con URL, el badge enlaza al de mayor prioridad
según este orden (decisión Dani 2026-06-13):

1. **YouTube** (`youtube.com`, `youtu.be`)
2. **Otras redes sociales** (Facebook, Instagram, X/Twitter, TikTok, Twitch, Kick)
3. **TV pública en abierto** — RTVE (`rtve.es`), CCMA / 3Cat (`ccma.cat`, `3cat.cat` → TV3,
   Esport3, 3Cat) y EITB (`eitb.eus`, `eitb.tv` → ETB)
4. **Resto de cadenas** — **Eurosport / HBO Max / Max son "una cadena más"** (tier 3, sin
   trato especial; antes las apps los colocaban en un tier propio por delante del resto).

**Precedencia de emisión EN DIRECTO (fix 2026-07-07):** ANTES del tier, una emisión **ya en
directo** (su `startTimeUtc` ≤ ahora) gana SIEMPRE el enlace a una que aún no ha empezado, aunque
esta última sea de mayor tier. Motivo: si Eurosport (tier 3) ya emite pero RTVE (tier 2) todavía no,
el badge dice "Live" y debe enlazar a lo **accesible AHORA** (Eurosport), no a RTVE. Entre emisiones
del mismo estado (todas en directo, o todas por empezar) manda el tier; sin ninguna en directo se
conserva el tier puro (pre-carrera, un YouTube programado sigue ganando el enlace). Bug de referencia:
etapa 4 del Tour de Francia 2026 (LIVE con Eurosport, enlazaba a RTVE sin empezar). El orden final del
comparador es: **en-directo antes que por-empezar → tier → `sortOrder` del admin.** La HORA mostrada
del badge NO cambia (sigue siendo la de la emisión accesible más temprana).

Fuente única de la prioridad y de la selección (espejo en 3 plataformas):

| Plataforma | Función |
|---|---|
| Web | `broadcastLinkPriority(url)` + `pickBadgeBroadcast(broadcasts, startSeconds, nowSec)` en `js/broadcast-priority.js` (módulos puros, testeables en Node — `pickBadgeBroadcast` aplica la precedencia en-directo→tier→sortOrder) — usados por `tvBadgeCard` (`js/app.js`, Hoy) y `tvBadge` (`js/race-assets.js`, Competición/Campeonatos) |
| iOS | `RaceLogic.broadcastLinkPriority(_:)` + `isBroadcastLive(_:)` — usados por `selectedBroadcast` en `TVBadge.swift` |
| Android | `RaceLogic.broadcastLinkPriority(url)` + `isBroadcastLive(...)` — usados por `selectedBroadcast` en `TVBadge.kt` |

Tests de la precedencia en-directo: `js/__tests__/broadcastPriority.test.js` (`describe('pickBadgeBroadcast')`).

⚠️ `x.com` se ancla con `//` o `.` delante para no capturar `play.max.com` (que contiene la
subcadena "x.com" pero es HBO Max, tier 3). Tests: `js/__tests__/broadcastPriority.test.js`,
`RaceLogicTest.kt`, `RaceLogicTests.swift`.

> **Nota:** la lógica **Revive** (botón post-carrera) es independiente y SÍ agrupa
> Eurosport/HBO Max/YouTube/Facebook intencionadamente (`showInRevive`); este cambio de
> prioridad solo afecta al **badge de TV en directo**.

## Notas

- Si hay URL, el badge se renderiza como `<a target="_blank">`; sin URL es `<span>`.
- En Competición (`js/race-assets.js`) el badge pasó a ser clicable a **cualquier** cadena por
  tier (antes solo a redes sociales), para honrar RTVE.es y la paridad con Hoy y las apps.

## Chip "Live texto" — dos modos (paridad web / iOS / Android)

El chip "Live texto" (asset tipo `live_text`) aparece en dos situaciones distintas. Verde si la carrera
ya empezó (`livetext`), azul si aún no (`livetext_pre`).

1. **Sustituye al badge de TV** cuando no hay TV: `tvStatus` ∈ {`none`, `unavailable_es`, `pending`}, o
   sin `tvStatus` y sin broadcasts. Solo se muestra el chip de live texto.
2. **Acompaña al badge de TV** cuando la carrera ya empezó pero la emisión de referencia (la del enlace, o
   la más temprana) aún **no** ha comenzado (`raceStarted && refTs > now`). Se muestran **dos** chips:
   `TV hh:mm` + `Live texto`. Esto cubre el caso típico de una etapa que ya rodó pero cuya TV arranca más
   tarde (p. ej. `tvStatus = "confirmed_time"` con broadcast a una hora futura).

Cuando la TV ya está en directo (`confirmed_time` + emisión comenzada → "Live"), el chip de live texto
**no** se muestra (ya hay TV en vivo).

| Plataforma | Implementación |
|---|---|
| Web | `tvBadgeCard()` en `js/app.js` — `liveTextBadge` + `liveTextAlongside` |
| iOS | `TVBadge.swift` — `showLiveText` (modo 1) + `showLiveTextAlongside` (modo 2), chip en `liveTextChip` |
| Android | `TVBadge.kt` — `isLiveText` (modo 1) + `showLiveTextAlongside` (modo 2), chip en `LiveTextChip` |

> **Bug histórico (corregido 2026-06-01):** las apps solo cubrían el modo 1; el modo 2 ("Live texto" junto
> al badge de TV) faltaba, así que en etapas ya iniciadas con TV programada para más tarde el chip no salía.
> Caso de referencia: Etapa 3 del Giro de Italia femenino 2026.
