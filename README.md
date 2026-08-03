# Calendario Ciclismo

Guía editorial del ciclismo profesional en ruta, masculino y femenino. Reúne el calendario internacional, horarios, recorridos, perfiles, televisión y streaming, inscritos, resultados y mercado de fichajes.

- **Web:** [calendariociclismo.app](https://calendariociclismo.app)
- **iOS:** [App Store](https://apps.apple.com/app/id6761902611)
- **Android:** [Google Play](https://play.google.com/store/apps/details?id=app.calendariociclismo.android)

## Plataformas

El proyecto tiene tres clientes sobre el mismo backend. La web es un sitio estático enriquecido con JavaScript; las apps móviles son nativas y comparten la mayor parte de la experiencia, además de funciones propias como notificaciones y modo sin conexión.

| Plataforma | Stack | Directorio |
|---|---|---|
| Web | HTML5 + CSS3 + JavaScript (ES modules, sin framework) | raíz |
| iOS | SwiftUI nativa (iOS 18+) | `ios-app/` |
| Android | Kotlin + Jetpack Compose (Android 8.0/API 26+) | `android-app/` |

Las apps móviles son **nativas puras**, sin WebView ni shell híbrida, y consumen directamente la API de Supabase. Todas sus funciones son gratuitas; la suscripción opcional solo elimina los anuncios y ayuda a cubrir los costes del proyecto.

## Funcionalidades

- **Hoy** — carreras de cada día con horas de salida y meta, estado de TV y accesos a resultados o repeticiones al terminar
- **Calendario** — vistas mensual y de temporada, con filtros por categoría, género y país
- **Competición y jornada** — recorrido, perfil interactivo y oficial, puertos y puntos clave, mapas, rutómetro, libro de ruta y canales de TV/streaming
- **Resultados** — clasificaciones de etapa, general, puntos, montaña, jóvenes y equipos, importadas desde UCI DataRide y nueve cronometradores; incluye el ránking UCI de equipos masculino y femenino
- **Mercado de fichajes** — confirmaciones, rumores, renovaciones, contratos y movimientos por equipo y temporada
- **Dorsales y orden de salida** — listas curadas, abandonos y horarios de CRI/CRE
- **Calendarios iCal** — feeds de temporada por categoría y género, además de eventos individuales
- **Apps móviles** — notificaciones personalizables vía APNs/FCM y descarga automática para consulta sin conexión
- **Experiencia** — castellano e inglés, tema claro/oscuro/automático y soporte de las opciones de accesibilidad del sistema

## Stack

| Capa | Tecnología |
|---|---|
| Web | HTML5, CSS3, JavaScript (ES6 modules, sin framework) |
| iOS | Swift 6, SwiftUI, MapKit, Swift Concurrency, StoreKit 2 |
| Android | Kotlin 2.2, Jetpack Compose, Room, WorkManager, Coil 3, MapLibre |
| Datos y API | [Supabase](https://supabase.com) (PostgreSQL, PostgREST, Auth y Edge Functions en Deno) |
| Hosting web | [GitHub Pages](https://pages.github.com) por artefacto + CDN de Cloudflare |
| Assets | [Cloudflare R2](https://developers.cloudflare.com/r2/) |
| Cartografía | MapKit en iOS; [OpenFreeMap](https://openfreemap.org) + MapLibre en web y Android |
| Push | APNs HTTP/2 + FCM HTTP v1 (edge function `send-push`) |
| Publicidad y pagos | AdMob + StoreKit 2 / Google Play Billing, solo para la opción sin anuncios |
| Analytics | Firebase Analytics (GA4) — opt-in en web, opt-out en las apps |

## Estructura

```
├── index.html, calendario.html, …  # Fuentes de la web
├── js/                             # Módulos JavaScript y lógica compartida
├── css/                            # Hojas de estilo
├── ios-app/                        # App iOS (SwiftUI)
├── android-app/                    # App Android (Kotlin + Compose)
├── panel/                          # Panel editorial y de administración
├── supabase/
│   ├── migrations/                 # Migraciones SQL
│   └── functions/                  # Edge Functions
├── scripts/
│   ├── results-fetchers/           # Resultados (UCI + 9 cronometradores)
│   └── fetch-logos.mjs             # Descarga de logos (ver más abajo)
├── tools/site/                      # Generadores de páginas, sitemap y feeds
├── workers/                         # OpenGraph y redirección del dominio legado
└── docs/                            # Arquitectura, memorias y ADRs
```

Las páginas generadas por competición y jornada —incluidos sus resultados—, el sitemap y los feeds iCal no se versionan. En producción, un workflow privado los regenera desde Supabase, compone el sitio completo y publica un único artefacto de GitHub Pages. Los workflows operativos se excluyen del espejo público para evitar que sus procesos se ejecuten por duplicado.

## Desarrollo y comprobaciones

```bash
npm ci && npm test                              # web
open ios-app/CalendarioCiclismo.xcodeproj       # iOS
cd android-app && ./gradlew test assembleDebug  # Android
```

Las apps necesitan archivos de configuración que no se versionan: `Supabase.xcconfig` y `GoogleService-Info.plist` en iOS; `google-services.json` y `secrets.properties` en Android. Hay plantillas `.template` para un entorno de desarrollo. Consulta [`android-app/README.md`](android-app/README.md) para el entorno Android; `ios-app/setup.sh` permite regenerar el proyecto Xcode con XcodeGen cuando sea necesario.

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
