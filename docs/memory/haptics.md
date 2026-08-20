# Haptics — mapeo iOS / Android

Documentación técnica de hápticos.

Archivos: `Services/Haptics.swift` (iOS) · `util/Haptics.kt` (Android).

## Tabla de eventos

| Evento | iOS | Android |
|---|---|---|
| `navigation` / `Navigation` | `.light` impact | `CLOCK_TICK` |
| `boundary` / `Boundary` | `.light` impact | `CLOCK_TICK` |
| `selection` / `Selection` | `UISelectionFeedbackGenerator` | `CONTEXT_CLICK` |
| `toggle` / `Toggle` | `.soft` impact | `SEGMENT_FREQUENT_TICK` (API 34+) / `CLOCK_TICK` |
| `primaryAction` / `PrimaryAction` | `.medium` impact | `VIRTUAL_KEY` |
| `success` / `Success` | `.success` notification | `CONFIRM` (API 30+) / `VIRTUAL_KEY` |
| `warning` / `Warning` | `.warning` notification | `LONG_PRESS` |
| `error` / `Error` | `.error` notification | `REJECT` (API 30+) / `LONG_PRESS` |

## Patrón Compose

```kotlin
val haptic = rememberHaptics()
Button(onClick = { haptic(Haptics.Event.Navigation) }) { … }
```

## Dónde se aplican (paridad iOS ↔ Android)

- Tab bar: `Navigation`
- Hoy: `navigation` fecha/cards, `selection` chips
- Mes: `navigation` mes/chips/filas
- Temporada: ídem + chips de mes/año/país
- Buscar: `navigation` en tap
- Ajustes: offline `success`/`warning`, push `success`/`toggle`, iCal `primaryAction`, borrar `warning`, toggle hápticos `toggle`

Al añadir pantallas nuevas, buscar el equivalente en `Haptics.swift` para mantener paridad.
