# Google Analytics 4 — Definiciones Personalizadas

Configuración en Google Analytics 4 para los parámetros implementados en iOS y Android.

---

## Custom Dimensions

Crear en **Admin → Custom Definitions → Custom Dimensions**

| Nombre (Display) | Parámetro | Ámbito | Descripción |
|---|---|---|---|
| Category Filter | `category_filter` | Event | Filtro de categoría activo (all, pro, uwt, wwt, male, female) |
| Year | `year` | Event | Año de la temporada |
| Country Code | `country_code` | Event | Código ISO del país en modo Temporada |
| Search Query | `search_query` | Event | Término de búsqueda |
| Race ID | `race_id` | Event | ID único de la carrera |
| Race Name | `race_name` | Event | Nombre de la carrera |
| Race Day ID | `race_day_id` | Event | ID único de la jornada/etapa |
| Stage Name | `stage_name` | Event | Nombre de la etapa |
| Onboarding Step | `onboarding_step` | Event | Paso del onboarding (notifications, offline, analytics) |
| Action | `action` | Event | Acción del usuario (accepted, skipped) |

---

## Custom Events

Crear en **Admin → Custom Definitions → Custom Events**

| Nombre | Parámetros | Descripción |
|---|---|---|
| `onboarding_view` | `onboarding_step` | Usuario ve una pantalla de onboarding |
| `onboarding_action` | `onboarding_step`, `action` | Usuario acepta o salta un paso de onboarding |

**Nota:** `logScreenView()` automáticamente crea eventos `screen_view` con los parámetros. No requieren definición explícita.

---

## Resumen

- **10 Custom Dimensions** — parámetros de contexto (filtro, año, país, query, IDs de carrera/etapa, nombres)
- **2 Custom Events** — acciones específicas de onboarding
- Todas ámbito **Event** (aplica a cada evento individual)
- Parámetros **snake_case** (exactos como se envían desde iOS/Android)
