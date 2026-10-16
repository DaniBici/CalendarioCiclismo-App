# Iconos de la aplicación en Icon Composer

Los paquetes `.icon` contienen las composiciones por capas de Original,
Fundador y Amigo. Los SVG no incorporan fondo, sombra, desenfoque ni degradado;
el fondo se define en el documento de Icon Composer. Desde 5.0.15, Original
usa el diseño Tierra seca de ciclocross: fondo marrón y una capa raster
`00-fondo-barro.png` de 1024 × 1024 px en un grupo inferior, sin máscara.
Fundador y Amigo no cambian.

Las capas `01-calendar.svg` y `02-cyclist.svg` son contornos rellenos: el trazo
redondeado de 2.3 unidades del glifo (`favicon.svg`) convertido y unido en un
único `path`. Sin trazos, el grosor visible no depende del cálculo de límites
del renderizador y ningún lado queda recortado. Se regeneran en los paquetes
`.icon` y en las carpetas `AppIconFounder/` y `AppIconFriend/` con
`python3 ios-app/IconComposer/outline-layers.py` (requiere `skia-pathops`); la
geometría y los colores viven en ese script.

| Icono | Fondo | Capas |
| --- | --- | --- |
| Original | `#805234`, opaco, y `00-fondo-barro.png` (barro) | calendario y ciclista en `#FFFFFF` |
| Fundador | `#101828`, opaco | calendario, ciclista y estrella en `#F6A623` |
| Amigo | `#FFFFFF`, opaco | calendario, ciclista y corazón en `#1A73E8` |

Configuración:

1. Abrir `AppIcon.icon`, `AppIconFounder.icon` y `AppIconFriend.icon` con Icon Composer 2 Beta 5 o posterior.
2. Mantener el fondo opaco y sin máscara importada.
3. Mantener los símbolos de cada documento en un único grupo combinado; en Original, el barro ocupa un segundo grupo debajo.
4. Mantener bordes definidos; no añadir desenfoques, sombras ni brillos a los SVG.
5. Revisar `Default`, `Dark` y `Mono`, además de las vistas `Clear` y `Tinted`.
   En Original, la apariencia `dark` define un fondo `#191108` y reduce el
   barro (`00-fondo-barro`) a una opacidad de 0,22; las capas `01-calendar` y
   `02-cyclist` llevan una especialización de relleno `dark` en `#FFFFFF`. Sin
   ellas, el sistema funde los símbolos con el barro y el icono conserva el
   fondo marrón. Comprobación local:
   `ictool AppIcon.icon --export-image --platform iOS --rendition Dark
   --design-generation 27 …`.
6. Conservar los PNG planos de los asset catalogs para los sistemas anteriores.
   `AppIcon-1024x1024.png` y `OriginalAppIcon.png` son la composición plana de
   `00-fondo-barro.png` con los símbolos blancos, sin canal alfa.

En Android, el icono adaptativo usa `drawable-nodpi/ic_launcher_mud_background.png`
(432 × 432 px, 108 dp): el mismo arte de 1024 px encajado en la zona visible de
72 dp y prolongado por debajo en el margen que recortan las máscaras. El color
`ic_launcher_background` sigue en uso para la pantalla de inicio.

Los archivos `*-preview.svg` solo permiten revisar la composición plana; no se
importan como capa.
