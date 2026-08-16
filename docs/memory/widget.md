# Widget "Hoy en el ciclismo" — arquitectura técnica

Documentación técnica del widget.

## App Group / shared container (iOS)

- **Identifier:** `group.app.calendariociclismo` (`ios-app/CalendarioCiclismoWidgetExtension.entitlements`).
- **JSON compartido:** `Caches/widget_today_payload.json` dentro del container del App Group.
- **Entitlements:** solo la extensión del widget tiene `com.apple.security.application-groups`. La app principal escribe el JSON; el widget solo lee.

## TimelineProvider (iOS)

Clase `WidgetProvider` en `CalendarioCiclismoWidget.swift`. Entries generadas:
- Entrada inicial con el payload actual.
- Una entrada por cada `estimatedFinishTimeUtc` (fuerza re-render cuando termina la carrera).
- Entrada a medianoche (marca payload como nulo y dispara refresh).

`Policy: Timeline.after(refreshAt)` con `refreshAt = mín(medianoche, ahora + 90 min)`.

No hay `BGAppRefreshTask` registrado — se confía en la política reactiva + escrituras desde la app principal cuando `loadDay` termina.

## Glance (Android)

| Clase | Rol |
|---|---|
| `TodayCyclingWidget : GlanceAppWidget` | Render |
| `TodayCyclingWidgetReceiver : GlanceAppWidgetReceiver` | Recibe broadcast `APPWIDGET_UPDATE` |
| `TodayWidgetRepository` | Lee directamente de Room vía `app.repository.cachedDayData(today)` (no JSON intermedio) |
| `TodayWidgetRefreshWorker : CoroutineWorker` | Refresh periódico |

**Scheduling:** `WorkManager` periódico cada **90 min** con constraint `NetworkType.CONNECTED` + one-shot expedited al añadir el widget.

## Deep links

Mismos schemes en iOS y Android:

- Single race: `calendariociclismo://stage/{raceDayId}`
- Multi/overflow: `calendariociclismo://tab/today`
- Widget base: en iOS vía `.widgetURL()` sobre `WidgetEntryView`; en Android vía `actionStartActivity`.

## Estados del widget (5)

Ambas plataformas renderean los mismos 5 estados:

1. **Single** — 1 carrera activa con TV confirmada.
2. **Multi** — 2-3 carreras (máx 3 visibles, contador overflow).
3. **AllCompleted** — todas terminadas.
4. **Empty** — sin carreras (no publicadas o no pasan filtro).
5. **Special** — `rest_day` o `cancelled`.

## Hora local vs Madrid

- **Widget iOS:** usa `formatTimeLocal()` con `TimeZone.current`.
- **Widget Android:** usa `DateFormatting.formatTimeLocal()` en `CompactRaceRow`.
- Resto de la app sigue usando `formatTimeMadrid` para vistas detalladas.
