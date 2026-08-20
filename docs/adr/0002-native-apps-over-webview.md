# ADR-0002: Apps nativas en lugar de WebView

**Fecha:** 2025-Q2
**Estado:** aceptado

## Contexto

La primera versión de la app iOS era un `WKWebView` que cargaba la web de `calendariociclismo.app`. Funcionaba, pero tenía limitaciones importantes:

- Las notificaciones push reales (APNs) no son posibles desde un WebView sin puente nativo complejo.
- El modo offline requería Service Workers, que tienen soporte limitado e inconsistente en `WKWebView`.
- Los haptics, animaciones fluidas y accesibilidad nativa son imposibles o muy difíciles desde un WebView.
- El rendimiento de scroll y transiciones no era comparable al nativo.
- No había app Android.

## Decisión

Reescribir iOS en SwiftUI nativo y crear Android en Jetpack Compose nativo. Ambas apps consumen directamente la API REST de Supabase, con:

- Caché local: `CacheManager` (iOS) y Room (Android).
- Offline real: `OfflineManager` (iOS) y `OfflineSyncWorker` con WorkManager (Android).
- Push notifications: APNs (iOS) y FCM (Android), gestionados por Supabase Edge Function `send-push`.
- Haptics nativos, accesibilidad VoiceOver/TalkBack, deep links, widgets.

## Alternativas consideradas

- **React Native** → descartado por complejidad de setup para una persona, dependencia de un framework intermedio y pérdida de control fino sobre la UX nativa. La curva de aprendizaje para alguien sin experiencia en desarrollo es mayor que SwiftUI/Compose.
- **Flutter** → mismo razonamiento que React Native, más el ecosistema más pequeño para integraciones iOS/Android específicas (widgets, notificaciones enriquecidas).
- **Capacitor/Ionic** → descartado porque el producto es una app de consulta rápida donde la performance de scroll y la experiencia nativa importan. Un WebView embebido no lo consigue.
- **Mejorar el WebView** → descartado porque los problemas de offline y push son estructurales, no se resuelven sin puentes nativos que serían más complejos que escribir la app nativa.

## Consecuencias

**Positivas:**
- Push notifications reales, modo offline real, haptics, accesibilidad nativa completa.
- Control total sobre la experiencia de usuario en cada plataforma.
- Mejor rendimiento y estabilidad percibida (sin bridge JS↔nativo).
- Widgets nativos (iOS WidgetKit, Android Glance).
- Deep links con `autoVerify` (Android) y Universal Links (iOS).

**Negativas:**
- Doble mantenimiento de UI: cada cambio de presentación requiere implementarlo en iOS y Android.
- Cada cambio de lógica de negocio requiere release de app (no hay hot-reload de contenido como en la web).
- La paridad funcional entre plataformas requiere disciplina: cada feature nueva debe implementarse en las dos.
