# Calendario Ciclismo

Calendario de carreras del ciclismo profesional. Horarios, recorridos, retransmisiones de TV/streaming, perfiles de etapa y resultados de todas las competiciones del pelotón internacional.

**Web:** [calendariociclismo.app](https://calendariociclismo.app)
**iOS:** [App Store](https://apps.apple.com/app/id6761902611)
**Android:** [Google Play](https://play.google.com/store/apps/details?id=app.calendariociclismo.android)

## Plataformas

Tres plataformas nativas sobre el mismo backend. La cobertura de funcionalidades es muy similar, con algunas diferencias deliberadas (las notificaciones push, por ejemplo, son exclusivas de las apps):

| Plataforma | Stack | Directorio |
|---|---|---|
| Web | HTML5 + CSS3 + JS (ES modules, sin framework) | raíz |
| iOS | SwiftUI nativa (iOS 18+) | `ios-app/` |
| Android | Kotlin + Jetpack Compose (API 26+) | `android-app/` |

Las apps móviles son **nativas puras** — sin WebView ni shell híbrida. Consumen directamente la API REST de Supabase.

## Funcionalidades

- **Vista diaria** — carreras del día con horarios y TV en directo; navegación filter-aware
- **Calendario** — vista mensual y de temporada, filtrable por categoría y país
- **Detalle de carrera y etapa** — perfiles de elevación, recorridos, mapas interactivos, horarios de paso, canales de TV/streaming
- **Resultados** — clasificaciones propias volcadas desde la UCI y ocho cronometradores, con etapa, general, puntos, montaña, jóvenes y equipos
- **Mercado de fichajes** — altas, bajas, renovaciones y rumores por equipo
- **Inscritos y orden de salida** — startlists curadas con dorsales y abandonos
- **Modo sin conexión** — descarga de datos y assets para consulta offline
- **Push notifications** — alertas de jornada vía APNs (iOS) y FCM (Android)
- **Suscripción iCal** — feeds `.ics` con filtros por categoría y género
- **Bilingüe** (ES/EN), tema claro/oscuro/automático

## Stack

| Capa | Tecnología |
|---|---|
| Web | HTML5, CSS3, JavaScript (ES6 modules, sin framework) |
| iOS | SwiftUI, Combine, Swift Concurrency |
| Android | Kotlin 2.0, Jetpack Compose, Room, WorkManager, Coil 3 |
| Datos y API | [Supabase](https://supabase.com) (PostgreSQL + Edge Functions Deno) |
| Hosting | [GitHub Pages](https://pages.github.com) + Cloudflare Workers |
| Assets | [Cloudflare R2](https://developers.cloudflare.com/r2/) |
| Cartografía | [OpenFreeMap](https://openfreemap.org) + MapLibre GL |
| Push | APNs HTTP/2 + FCM HTTP v1 (edge function `send-push`) |
| Analytics | Firebase Analytics (GA4) — opt-in en web, opt-out en las apps |

## Estructura

```
├── index.html, calendario.html, …   # Web
├── js/                    # Módulos JavaScript
├── css/                   # Hojas de estilo
├── ios-app/               # App iOS (SwiftUI)
├── android-app/           # App Android (Kotlin + Compose)
├── panel/                 # Panel de administración
├── supabase/
│   ├── migrations/        # Migraciones SQL
│   └── functions/         # Edge Functions
├── scripts/
│   ├── results-fetchers/  # Volcado de resultados (UCI + 8 cronometradores)
│   └── fetch-logos.mjs    # Descarga de logos (ver más abajo)
├── workers/               # Cloudflare Workers
├── feed/                  # Feeds iCal estáticos
└── docs/                  # Documentación técnica, runbooks y ADRs
```

## Compilar

```bash
npm install && npm test        # web
cd ios-app && ./setup.sh       # iOS: genera el xcodeproj
cd android-app && ./gradlew assembleDebug   # Android
```

Las apps necesitan credenciales que no se versionan (`Supabase.xcconfig`, `google-services.json`, `secrets.properties`). Hay plantillas `.template` de cada una. El runbook [`docs/runbooks/nuevo-equipo.md`](docs/runbooks/nuevo-equipo.md) cubre el arranque completo.

### Logos de carreras

Los logos que las apps empaquetan **no están en el repositorio**: son obras de sus respectivos titulares (organizadores, federaciones) y no se redistribuyen. Un clon limpio trae los directorios vacíos.

```bash
node scripts/fetch-logos.mjs
```

Las apps compilan igual sin este paso, pero pierden el logo cuando no hay conexión.

## Licencia

Publicado bajo **[GNU Affero General Public License v3.0](LICENSE)** (AGPL-3.0).

Puedes usar, estudiar, modificar y redistribuir este código bajo los términos de esa licencia. La AGPL exige, además de lo habitual en la GPL, que **si ofreces una versión modificada como servicio en red, publiques el código de esa versión**.

### Qué NO cubre la licencia

La AGPL cubre **el código de este repositorio**. No cubre — ni podría, por no ser obra del autor:

- **Marcas, logotipos y nombres de carreras, equipos, organizadores y patrocinadores.** No se distribuyen aquí, y aparecen en la app a título descriptivo. Ninguna licencia de marca se concede ni se implica.
- **Datos deportivos** (resultados, startlists, recorridos, horarios) obtenidos de organizadores, cronometradores y federaciones. Los hechos no son propiedad de nadie, pero su compilación puede estar protegida en algunas jurisdicciones.
- **Cartografía y elevación** — ver [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- **Iconos de banderas** ([flag-icons](https://github.com/lipis/flag-icons), MIT) — compatibles con AGPL, atribuidos en el mismo fichero.
- **SDK propietarios de Google** (Firebase Analytics, AdMob, UMP, Play Billing) — dependencias binarias bajo la [Android SDK License](https://developer.android.com/studio/terms), no redistribuibles. Detalle en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Si reutilizas este código, esos materiales son responsabilidad tuya.

## Autor

**[Dani Sánchez](https://danisanchez.info)** — profesional de la comunicación en el ciclismo durante dos décadas: departamento de comunicación de Movistar Team (2011-2024) y editor digital en Eurosport España (2024-2026). Actualmente responsable de contenido web en castellano del Giro d'Italia (2025-), freelance y docente en comunicación digital.

[danisanchez.info](https://danisanchez.info) · [@danibvo_](https://x.com/danibvo_) · [LinkedIn](https://linkedin.com/in/danibvo) · [hola@danisanchez.info](mailto:hola@danisanchez.info)

---

Copyright © 2026 Dani Sánchez
