# Third-Party Notices

Calendario Ciclismo redistribuye o utiliza los siguientes materiales de terceros.
Este fichero recoge sus avisos de licencia, como exigen dichas licencias.

El código del repositorio está bajo [AGPL-3.0](LICENSE). Lo que aparece aquí
tiene su propia licencia y **no queda cubierto por ella**.

---

## Material de terceros que NO se distribuye en este repositorio

Se retiró del control de versiones al publicar el proyecto (2026-07-18). No es
obra del autor y la AGPL no puede relicenciarlo:

| Qué | Dónde está ahora |
|---|---|
| **Logos de carreras** (~509) — organizadores, federaciones, patrocinadores | Fuera del repo. `scripts/fetch-logos.mjs` los descarga de sus URLs de origen para el bundle offline de las apps. |
| **Libros de resultados en PDF** — organizadores y cronometradores | Fuera del repo. |
| **Capturas de App Store** — contienen logos de carreras | Fuera del repo. |

Mostrar un logo dentro de la app es uso descriptivo (nominativo). Redistribuir
el fichero bajo una licencia que concede a terceros derecho a copiarlo y
modificarlo es otra cosa, y no está en manos del autor concederlo.

**Marcas y nombres** de carreras, equipos, organizadores y patrocinadores
pertenecen a sus titulares. Su aparición en la app o en el código (nombres de
carrera, slugs, identificadores) es descriptiva y no implica afiliación,
patrocinio ni licencia de marca.

**Datos deportivos** — resultados, startlists, recorridos, horarios — proceden
de organizadores, cronometradores y federaciones. Los hechos deportivos no son
objeto de propiedad, pero su compilación puede estar protegida como base de
datos en algunas jurisdicciones (p. ej. el derecho *sui generis* de la UE).
Quien reutilice este código es responsable de cómo obtiene y usa esos datos.

---

## flag-icons

Iconos de banderas de países, redistribuidos en las apps de iOS y Android
(`ios-app/CalendarioCiclismo/Assets.xcassets/Flags/`,
`android-app/app/src/main/assets/flags/`) y cargados desde CDN en la web.

- Proyecto: https://github.com/lipis/flag-icons
- Versión: 7.2.3
- Licencia: MIT

Nota: algunos SVG del set de iOS están modificados respecto al original para
sortear limitaciones del motor CoreSVG de iOS (aplanado de `<use>`, reescritura
de `clip-path`, expansión de `<marker>`). La geometría se conserva; ver
`scripts/flags/README.md`.

```
The MIT License (MIT)

Copyright (c) 2013 Panayiotis Lipiridis

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## Librerías

Ninguna se redistribuye en este repositorio: la web las carga desde CDN y las
apps las resuelven en tiempo de compilación (SPM / Gradle). Se listan porque
llegan al usuario final como parte del producto.

| Librería | Uso | Licencia |
|---|---|---|
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) 4.7.1 | Mapa del recorrido (web), vía unpkg | BSD-3-Clause |
| [MapLibre Native Android](https://github.com/maplibre/maplibre-native) 11.8.1 | Mapa del recorrido (Android) | BSD-2-Clause |
| [supabase-swift](https://github.com/supabase/supabase-swift) 2.x | Cliente de datos (iOS) | MIT |
| [Ktor](https://ktor.io) · [Coil](https://coil-kt.github.io/coil/) 3 · [Room](https://developer.android.com/training/data-storage/room) · [Material Components](https://github.com/material-components/material-components-android) | Red, imágenes, caché local y UI (Android) | Apache-2.0 |
| [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging) | Push (Android) | Apache-2.0 |
| [Vitest](https://vitest.dev) | Tests de la web (solo desarrollo) | MIT |

### SDK de Google bajo licencia propietaria

No todo el ecosistema de Google es Apache-2.0. Estos artefactos declaran en su
POM la **[Android Software Development Kit License](https://developer.android.com/studio/terms)**,
una licencia propietaria que **no** concede derecho a redistribuir ni modificar:

| SDK | Uso |
|---|---|
| Firebase Analytics (`firebase-analytics-ktx`) | Analytics |
| User Messaging Platform (`user-messaging-platform` 3.1.0) | Consentimiento RGPD |
| Google Play Billing (`billing-ktx` 8.2.1) | Suscripción |

Se consumen como dependencia binaria en tiempo de compilación; ni sus fuentes ni
sus binarios están en este repositorio. Quien compile un derivado de este código
acepta esos términos por su cuenta al resolver las dependencias.

En iOS, los paquetes SPM equivalentes ([firebase-ios-sdk](https://github.com/firebase/firebase-ios-sdk),
[google-mobile-ads](https://github.com/googleads/swift-package-manager-google-mobile-ads),
[user-messaging-platform](https://github.com/googleads/swift-package-manager-google-user-messaging-platform))
publican el *wrapper* bajo Apache-2.0, pero el binario que descargan se rige por
los términos de Google enlazados arriba.

### Dependencias transitivas (iOS)

`Package.resolved` fija 23 paquetes. Todas sus licencias son permisivas y
compatibles con AGPL-3.0; ninguno se redistribuye en este repositorio (SPM los
resuelve en tiempo de compilación). Verificado en la versión fijada de cada uno:

| Licencia | Paquetes |
|---|---|
| Apache-2.0 | abseil-cpp-binary, app-check, firebase-ios-sdk, google-ads-on-device-conversion-ios-sdk, GoogleAppMeasurement, GoogleDataTransport, GoogleUtilities, grpc-binary, gtm-session-fetcher, interop-ios-for-google-sdks, promises, swift-asn1, swift-crypto, swift-http-types, swift-protobuf, y los dos *wrappers* SPM de Google Ads |
| MIT | supabase-swift, swift-clocks, swift-concurrency-extras, xctest-dynamic-overlay |
| BSD-3-Clause | leveldb |
| zlib | nanopb |

Los paquetes de Google de esta tabla son código abierto (el SDK propietario es
el binario que descargan, tratado en el apartado anterior).

### Dependencias transitivas (Android)

El grafo completo de `releaseRuntimeClasspath` son 284 artefactos. Licencia
declarada en el POM de cada uno, en la versión que Gradle resuelve:

| Licencia | Artefactos |
|---|---|
| Apache-2.0 | 246 — AndroidX, Compose, Kotlin/kotlinx, Ktor, Coil, Room, Firebase Messaging, Guava… |
| Android SDK License (propietaria) | 25 — Play Services (ads, measurement, base), Play Billing, UMP, Firebase Analytics |
| MIT | 10 — supabase-kt, krypto, slf4j-api, checker-qual |
| BSD | 3 — MapLibre Android SDK y su librería de gestos (BSD-2-Clause), protobuf embebido en Glance (BSD-3-Clause) |

**Ninguna copyleft** (GPL/LGPL/MPL/EPL/CDDL) ni de fuente restringida
(SSPL/BUSL), y ningún artefacto sin licencia declarada. Los 25 propietarios son
los SDK de Google ya descritos y sus dependencias internas; el resto es
compatible con AGPL-3.0.

Reproducible con:

```bash
cd android-app && ./gradlew :app:dependencies --configuration releaseRuntimeClasspath
```

---

## Cartografía (mapas de etapas)

- **OpenStreetMap** — datos © OpenStreetMap contributors, licencia ODbL.
  Servido vía OpenFreeMap. https://www.openstreetmap.org/copyright
- **Esri World Imagery** — imágenes de satélite. Tiles © Esri — Source: Esri,
  Maxar, Earthstar Geographics, and the GIS User Community.
- **AWS Terrain Tiles** — datos de elevación (relieve 3D), AWS Open Data.
