# Push Notifications — arquitectura completa

Documentación técnica de notificaciones push.

3 plataformas: APNs (iOS), FCM (Android), Web Push (`sw.js` + VAPID). Todas guardadas en `push_subscriptions` con columna `platform` ∈ `ios|android|web`.

## Categorías de notificación (Fase 3 del plan 2.0, añadido 2026-05-07)

Las notificaciones se segmentan por tipo (`category`). Todas las categorías son gratuitas desde 4.3.

### Modelo

| Categoría | Tier | Cubre |
|---|---|---|
| `general` | Free (siempre activa, no se puede desactivar) | Anuncios admin, novedades, mejoras de la app — todo lo que entregaba la app 1.4.4. |
| `race_start` | Gratis | Aviso T-30 min antes del banderazo. |
| `tv_start` | Gratis | Aviso T-5 min antes de cada retransmisión. |
| `results` | Gratis | Resumen al cerrar la jornada. |

Las tres categorías enriquecidas dejaron de estar bloqueadas en 4.3.

### Esquema (migración `040_push_subscription_categories.sql`)

| Tabla | Cambio |
|---|---|
| `push_subscription_categories` (nueva) | `subscriptionId` FK a `push_subscriptions(id)` ON DELETE CASCADE + `category` con CHECK in (`general\|race_start\|tv_start\|results`) + UNIQUE(`subscriptionId`, `category`). Solo política RLS de SELECT pública; escritura solo vía RPC. |
| `scheduled_push_notifications` | Nueva columna `category TEXT NOT NULL DEFAULT 'general'` con mismo CHECK. |
| `push_notifications` | Misma columna `category` para historial. |
| Trigger `trg_push_subscriptions_default_category` | AFTER INSERT en `push_subscriptions` → inserta `'general'` automáticamente. Cubre la web (sigue insertando directo, sin pasar por la RPC) y cualquier cliente que no envíe categorías. No se dispara para UPDATEs (no interfiere con renovaciones de token ni con la RPC). |
| Backfill | Cada device preexistente (495 al aplicar) recibió `'general'` para preservar el baseline. |

### RPC `set_push_subscription_with_categories(p_token, p_platform, p_is_active, p_region, p_categories)`

Una sola llamada atómica: upsert en `push_subscriptions` + `DELETE` + `INSERT` de categorías. `SECURITY DEFINER` con `search_path = public, pg_temp`, `GRANT EXECUTE` a `anon, authenticated`. Retorna el `id` de la subscripción.

Las apps iOS y Android la usan en lugar del upsert directo a la tabla. Beneficios:
1. Atómica — si algo falla, ni el upsert ni el reemplazo se aplican.
2. No requiere políticas RLS de escritura sobre `push_subscription_categories` (que serían difíciles de hacer seguras sin user account).
3. Una sola llamada de red.

### Edge Function `send-push` — filtro por categoría

`doSend(msg, adminClient, category = 'general')` hace:
```sql
SELECT deviceToken, platform, push_subscription_categories!inner(category)
FROM push_subscriptions
WHERE isActive = true
  AND push_subscription_categories.category = $category
```

Solo entrega a devices que tengan esa categoría activa. El handler valida estrictamente `category` contra los 4 valores permitidos (devuelve 400 si no coincide). Modos 1, 2 y 3 (inmediato / scheduled / processScheduled) propagan la categoría.

### Clientes

| Plataforma | Servicio / archivo | Persistencia | Default |
|---|---|---|---|
| iOS | `Services/NotificationCategoryService.swift` (`@MainActor @Observable`) | `UserDefaults` clave `notification_categories` (CSV de rawValues) | `{general}` |
| Android | `data/prefs/NotificationCategoryPreference.kt` + `AppPreferences.notificationCategories` | DataStore `notification_categories` (CSV) | `{GENERAL}` |
| Web | — (no envía categorías) | — | Trigger AFTER INSERT asigna `general` al primer registro |

`general` siempre está en el set y no se puede desactivar (los `setEnabled(.general, false)` son no-op). Las demás categorías se pueden activar sin compra.

### Sección Ajustes

- **iOS:** subsección "Tipos de notificación" dentro de `notificationsSection` en `SettingsView.swift`. Solo visible cuando push está activo.
- **Android:** mismo patrón en `SettingsScreen.kt` — `NotificationCategorySelector` + `NotificationCategoryRow`. Visible solo cuando `push == true`.

Al cambiar un toggle: persiste en DataStore/UserDefaults + dispara `pushManager.syncCategories()` (Android) / `manager.healSubscriptionIfNeeded()` (iOS) que re-invoca la RPC con el conjunto actualizado.

### Panel admin

`panel/app.html` añade un `<select id="push-category">` con las 4 opciones. `js/panel.js`:
- `sendPushNotification()` y `sendScheduledNotificationNow()` propagan `category` en el body del POST a `send-push`.
- `loadScheduledNotifications()` y `loadPushHistory()` muestran un badge con `pushCategoryLabel(cat)` ("General", "Inicio carrera", "Inicio TV", "Resultados").

### Reglas al modificar

- **Añadir categoría nueva** → tocar 5 sitios:
  1. `CHECK` constraint en migración (`push_subscription_categories.category`, `scheduled_push_notifications.category`, `push_notifications.category`).
  2. `VALID_CATEGORIES` en `supabase/functions/send-push/index.ts`.
  3. Enum iOS (`NotificationCategoryService.NotificationCategory`).
  4. Enum Android (`NotificationCategoryPreference`).
  5. Selector del panel admin + helper `pushCategoryLabel`.
- Ninguna categoría puede depender de Fundador o Amigo. `general` debe seguir siempre activa.
- Las apps que aún no se han actualizado a 2.0 siguen llamando al upsert directo (sin RPC). Eso es OK: el trigger AFTER INSERT les asigna `general` y siguen recibiendo lo de siempre.

## Edge Function `supabase/functions/send-push/index.ts`

Tres modos en una sola función:
- **Inmediato:** payload normal → `doSend()`.
- **`scheduledAt`:** guarda en tabla `scheduled_push_notifications` (status `pending`) y retorna inmediatamente.
- **`processScheduled`:** lee filas `pending` con `scheduledAt <= now()` y las envía vía `doSend()` (helper compartido).

Ramas dentro de `doSend()`:
- `platform='ios'` → APNs HTTP/2 con JWT firmado en cada invocación.
- `platform='android'` → FCM HTTP v1 API con OAuth2 (token de service account generado on-the-fly).
- `platform='web'` → cifrado RFC 8291 (aes128gcm) + VAPID JWT.

## Envíos programados (añadido 2026-05-01)

El panel permite programar una notificación para que se envíe automáticamente en el futuro.

### Flujo

1. Admin rellena el formulario, activa "Programar para más tarde" y elige fecha/hora local.
2. Panel hace POST a `send-push` con `{ ..., scheduledAt: "<ISO UTC>" }` → edge function guarda en `scheduled_push_notifications` (status `pending`) y retorna inmediatamente.
3. Supabase `pg_cron` invoca `send-push` cada 5 minutos. La Edge Function solo reclama y entrega las pendientes entre las 08:00 y las 22:00 de España peninsular (`Europe/Madrid`), por lo que aplica correctamente CET/CEST; fuera de la franja las deja pendientes para la mañana siguiente.
4. La edge function actualiza atómicamente las `pending` con `scheduledAt <= now()` a `processing`, las envía una a una (reutilizando `doSend()`), e inserta cada envío en `push_notifications` (historial).
5. La sección "Programadas" del panel muestra estado en tiempo real (pending / failed / cancelled).

### Archivos clave

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/032_scheduled_push_notifications.sql` | Tabla `scheduled_push_notifications` + RLS + índice parcial |
| `supabase/functions/send-push/index.ts` | Tres modos: inmediato / `scheduledAt` / `processScheduled` |
| `supabase/migrations/036_pg_cron_scheduled_push.sql` | Crea el job `pg_cron` que invoca `processScheduled` cada 5 min |
| `.github/workflows/scheduled-push.yml` | Ejecución manual de diagnóstico de `processScheduled` con `CRON_SECRET` |
| `panel/app.html` | Toggle "Programar para más tarde" + campo datetime-local + sección "Programadas" |
| `js/panel.js` | `loadScheduledNotifications()`, `cancelScheduledNotification()`, lógica en `sendPushNotification()` |

**Secret de GitHub necesario:** `CRON_SECRET` (Settings → Secrets → Actions del repo).

**Cancelación:** El panel hace `UPDATE status='cancelled' WHERE status='pending'` — si el cron ya lo reclamó (`processing`) no se puede cancelar.

**Reclamación atómica:** La edge function hace un único UPDATE `pending → processing` con `.lte('scheduledAt', now)` y `.select()`. Si dos runners corren a la vez, solo uno obtiene filas (el segundo UPDATE no encuentra `pending`). Evita doble envío sin necesidad de tabla de locks.

## Web Push (añadido 2026-04-30)

| Archivo | Qué hace |
|---|---|
| `sw.js` (raíz) | Service Worker: manejador `push` → `showNotification`, `notificationclick` → abrir URL |
| `js/push-web.js` | Registro del SW, `subscribe()`, `unsubscribe()`, upsert en `push_subscriptions` |
| `manifest.json` | Web App Manifest mínimo (necesario para SW en todos los navegadores) |
| `index.html` / `en/index.html` | Botón `btn-alerts` + modal de onboarding + inline script de control |

### VAPID keys

Generadas con `web-push generate-vapid-keys`:
- `VAPID_PUBLIC_KEY` (pública, no sensible): hardcodeada en `js/config.js` y `js/config.template.js`.
- `VAPID_PRIVATE_KEY` + `VAPID_PUBLIC_KEY`: secrets de la Edge Function `send-push` (Supabase Dashboard → Edge Functions → send-push → Secrets).

### Suscripciones web

En `push_subscriptions`: `platform='web'`, `deviceToken = JSON.stringify(PushSubscription.toJSON())`.

### UX — `.ical-bar` muestra `[ 🔔 Alertas ]  [ 🗓 Calendario ]`

- Desktop: click Alertas → modal de onboarding push.
- Móvil (≤ 768px): click Alertas → `openAppsModal()` (invita a bajarse la app).
- El botón se oculta automáticamente si el navegador no soporta Web Push.
- iOS Safari sin PWA: no tiene soporte — se redirige al modal de apps.

Texto del modal: idéntico al onboarding de las apps nativas, con "web" en lugar de "app".
