# Feeds iCal — detalle de implementación

> Para operaciones (forzar regeneración, verificar, troubleshoot) ver `docs/runbooks/feeds-ical.md`.

## Subfeeds disponibles

| Key | Descripción |
|---|---|
| *(anual base)* | Todas las carreras del año |
| `pro` | Categorías Pro (1.Pro, 2.Pro) |
| `wt` | WT masculino (1.UWT, 2.UWT) |
| `wwt` | WT femenino (1.WWT, 2.WWT) |
| `masc` | Todas las masculinas |
| `fem` | Todas las femeninas |

URLs: `/feed/{year}.ics` y `/feed/{year}-{key}.ics`.

## Puntos de entrada en la app

- **Web:** `<a class="btn-ical" href="/suscripcion/">` (texto: **Calendario**) en `index.html`, `mes.html`, `temporada.html` (2 instancias en temporada: fila 1 y fila 2).
- **iOS:** `SettingsView.swift` → `subscribeCard` abre `https://calendariociclismo.app/suscripcion/` con `openURL`.
- **Android:** `SettingsScreen.kt` → botón "Suscribirse al calendario" lanza `Intent.ACTION_VIEW` a esa URL.

## Suscripciones antiguas (`feed.calendariociclismo.app`)

Añadir el subdominio como custom domain del proyecto Pages (Cloudflare Dashboard → Pages → Settings → Custom domains). Retirar la Route del Worker (Workers → feed → Triggers). Mantener la Configuration Rule que desactiva "Always Use HTTPS" en ese host (para `webcal://`).

## Añadir jornada suelta al calendario (chip "Añadir al calendario")

Distinto del flujo de suscripción. Añade UN evento al calendario primario.

| Plataforma | Mecanismo |
|---|---|
| **iOS** | `webcal://calendariociclismo.app/feed/event/{slug}.ics` → Safari Calendar preview + suscripción |
| **Android** | `Intent.ACTION_INSERT` sobre `CalendarContract.Events.CONTENT_URI` con TITLE/DESCRIPTION/EVENT_LOCATION/BEGIN/END. **No** usar `calendar.google.com/r?cid=` — suscribe el .ics como calendario externo (oculto en "Otros calendarios") |
| **Web** | `js/jornada.js` → overlay con la URL `.ics` del evento |

`feeds-ical.yml` genera `feed/event/{slug}.ics` por cada jornada publicada (no rest day, no cancelled). La fuente de verdad para iOS/web; Android construye el evento en cliente.

## Reglas al modificar

- Tipo de jornada nuevo → `TYPE_LABELS` en `feeds-ical.yml` (único sitio).
- Categoría/filtro nuevo → `FEED_KEYS` + filtros en `fetch_races` del workflow + entrada en `suscripcion/index.html` (`FEEDS` array).
- No añadir `Content-Disposition` en los `.ics` — rompe el botón "Suscribirse" de Safari.
