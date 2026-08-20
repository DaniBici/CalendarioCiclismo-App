# Orden de salida (CRI / CRE)

Vista de horarios de salida en contrarreloj. Web tiene la página propia
(`orden-salida.html` / `start-order/`); iOS y Android ahora también la tienen como
vista nativa (antes abrían Safari/Chrome Tabs).

**Dos modos según el tipo de jornada:**
- **CRI (`primaryType=itt`)** — salen corredores. Tabla de 4 columnas:
  **Salida · Dorsal · Corredor (+bandera) · Equipo**. Cruce por dorsal contra la startlist.
- **CRE (`primaryType=ttt`)** — salen equipos. Tabla de 2 columnas: **Salida · Equipo**
  (sin dorsal, sin bandera, sin corredor) y **sin** los filtros Contrarrelojistas/General.
  Cruce por **nombre de equipo** contra `startlist_teams` (nombre canónico vía `teams`).

## Tabla Supabase

`start_order_entries` — migraciones 055 (creación), 056 (favoritos), 057 (dos grupos de filtros).

| Campo        | Tipo    | Notas                                                            |
|--------------|---------|------------------------------------------------------------------|
| `id`         | text    | PK                                                               |
| `raceDayId`  | text    | FK → `race_days`                                                 |
| `sortOrder`  | int     | Orden de presentación                                            |
| `dorsal`     | int     | Dorsal del corredor                                              |
| `startTime`  | text    | "HH:MM" o "HH:MM:SS" en hora local de la carrera                 |
| `riderId`    | text?   | FK → riders_men/women (cuando hay match)                         |
| `riderName`  | text?   | Snapshot si no hay match canónico                                |
| `teamName`   | text?   | Equipo (snapshot)                                                |
| `countryCode`| text?   | ISO-2                                                            |

Los filtros de "Contrarrelojistas" / "General" viven en `race_days`:
- `startOrderTtDorsals: int[]` — dorsales considerados TT specialists.
- `startOrderGcDorsals: int[]` — dorsales considerados GC.

### Vista `start_order_entries_resolved` (migración 070)

`start_order_entries` guarda un **snapshot** de `riderName`/`teamName`/`countryCode`
tomado al importar. Cuando después se matchea un dorsal a su ficha canónica
(`riders_men`/`riders_women`) o se corrige un nombre de corredor/equipo, el
snapshot quedaba obsoleto y las páginas mostraban el nombre viejo hasta que el
admin pulsaba "Re-sincronizar" a mano.

La vista `start_order_entries_resolved` resuelve los nombres **en tiempo de
lectura**, igual que `startlist_riders_resolved` hace para las startlists:

- **`riderName`**: se resuelve por `(raceId, dorsal)` contra
  `startlist_riders_resolved` (que ya aplica la precedencia BD↔snapshot). Si no
  hay match por dorsal, cae al snapshot de `start_order_entries`.
- **`teamName`**: sigue la cadena del panel
  `startlist_riders_resolved.teamId → startlist_teams.id → startlist_teams.teamId
  → teams.name`, cayendo a `startlist_teams.teamName` y, en último término, al
  snapshot.
- **`countryCode`**: el resuelto (respeta override de selección nacional); si no
  hay match, el snapshot.

El match por dorsal usa `LEFT JOIN LATERAL ... LIMIT 1` para no multiplicar filas
si hubiese dorsales duplicados. Shape idéntico a la tabla → web/iOS/Android leen
la vista sin tocar DTOs.

**Quién lee la vista** (público): web `js/orden-salida.js`, iOS
`StartOrderViewModel`, Android `SupabaseService.startOrderEntries`.
**Quién lee/escribe la tabla directa**: el panel (`js/panel.js`) al importar y
re-sincronizar. Las apps antiguas que aún leen la tabla siguen funcionando gracias
a los snapshots sincronizados (save, botón Re-sincronizar,
`sync_startlist_riders_to_canonical`).

**Panel — modo CRE:** `setupStartOrderSection` ramifica por `isTtt`. Parser
`parseStartOrderTeamsInput` (`HH:MM nombre equipo`), `buildTeamMapForRace` +
`resolveTeamName` (match por nombre normalizado contra `startlist_teams`, fallback
`findMatchingTeam` del catálogo). Preview de 2 columnas; oculta inputs de dorsales TT/GC
y el botón "Re-sincronizar nombres". Save con `dorsal=0`. La descripción SEO de la
página estática (`.github/workflows/og-pages.yml`) usa "cada equipo"/"each team" en CRE.

## Lógica común a las 3 plataformas

1. La jornada debe ser CRI (`primaryType=itt`) o CRE (`primaryType=ttt`).
2. El layout depende del tipo (`isTtt = primaryType === 'ttt'`):
   - **CRI:** 4 columnas **Salida · Dorsal · Corredor (+bandera) · Equipo**.
   - **CRE:** 2 columnas **Salida · Equipo** (sin dorsal, sin bandera, sin corredor).
3. Si `race_days.timezone` ≠ TZ del usuario, las horas se convierten a la hora local
   del usuario con sufijo `+1d`/`-1d` si la fecha resultante difiere. (Idéntico en ambos modos.)
4. Filtros "Todos / Contrarrelojistas / General": solo en **CRI** y si hay dorsales TT/GC
   definidos. En **CRE no se muestran nunca** (se basan en dorsales de corredor).

### Modelo de datos CRE (placeholder `dorsal=0`)

`start_order_entries.dorsal` es `INTEGER NOT NULL`. En CRE no hay dorsal, así que cada
entrada de equipo se guarda con `dorsal=0`, `riderId=null`, `riderName=null`,
`countryCode=null` y `teamName` = **nombre canónico** del equipo (o el snapshot pegado si
no hubo match). La vista `start_order_entries_resolved` matchea corredor por `(raceId, dorsal)`;
con `dorsal=0` no hay match → `riderName` queda null y `teamName` se sirve desde el snapshot.
Por eso el panel/skill guardan el nombre canónico al importar (no hace falta re-sync en CRE).

## Entradas a la vista

| Origen                          | Web                                | iOS                                              | Android                                         |
|---------------------------------|------------------------------------|--------------------------------------------------|-------------------------------------------------|
| Racecard de "Hoy" (badge)       | Asset `startOrder` → `orden-salida/{slug}` | `RaceCardView.startOrderBadge` → sheet `StartOrderView` | `StartOrderBadge` → `Routes.startOrder(rd.id)` |
| Detalle de jornada (chip asset) | Asset `startOrder`                 | `StageDetailView` → sheet `StartOrderView`       | `StageScreen` → `Routes.startOrder(rd.id)`      |
| Cintillo (today_highlights)     | Slide con destino `startOrder`     | Slide en `TodayHighlightsBanner`                 | Slide en `TodayHighlightsBanner.kt`             |

Antes del rework (2026-05-28), iOS abría el badge en `SafariViewController` y
Android en `CustomTabsIntent`. La vista nativa coexiste con la web (que sigue
siendo la fuente canónica para SEO, deep links externos, e iCal).

## Archivos clave

### iOS
- `ios-app/CalendarioCiclismo/Models/StartOrderEntry.swift` — DTOs.
- `ios-app/CalendarioCiclismo/ViewModels/StartOrderViewModel.swift` — fetch + filtros + conversión TZ.
- `ios-app/CalendarioCiclismo/Views/StartOrder/StartOrderView.swift` — UI SwiftUI.

### Android
- `android-app/.../data/model/StartOrderEntry.kt` — `StartOrderEntry`, `StartOrderRaceDay`, `StartOrderData`.
- `android-app/.../data/remote/SupabaseService.kt::startOrderRaceDay / startOrderEntries`.
- `android-app/.../data/repository/CalendarRepository.kt::loadStartOrderData`.
- `android-app/.../ui/startorder/StartOrderScreen.kt` — UI Compose.
- `android-app/.../ui/navigation/Routes.kt::START_ORDER` + `startOrder(raceDayId)`.

### Strings (Android)
`start_order_title`, `start_order_empty`, `start_order_riders`, `start_order_filter_*`,
`start_order_col_*`, `start_order_type_*`, `start_order_stage_*`, `start_order_tz_note`
(en `res/values/strings.xml` y `res/values-en/strings.xml`).

## No degradar el badge

La vista nativa y todas sus funciones son gratuitas. Fundador y Amigo no intervienen en su disponibilidad.
