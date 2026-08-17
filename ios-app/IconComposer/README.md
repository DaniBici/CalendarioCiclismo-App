# Iconos alternativos 4.3 en Icon Composer

Los paquetes `.icon` contienen las composiciones por capas de Original,
Fundador y Amigo. Los SVG no incorporan fondo, sombra, desenfoque ni degradado;
el fondo se define en el documento de Icon Composer.

| Icono | Fondo | Capas |
| --- | --- | --- |
| Original | `#1A73E8`, opaco | calendario y ciclista en `#FFFFFF` |
| Fundador | `#101828`, opaco | calendario, ciclista y estrella en `#F6A623` |
| Amigo | `#FFFFFF`, opaco | calendario, ciclista y corazón en `#1A73E8` |

Configuración:

1. Abrir `AppIcon.icon`, `AppIconFounder.icon` y `AppIconFriend.icon` con Icon Composer 2 Beta 5 o posterior.
2. Mantener el fondo opaco y sin máscara importada.
3. Mantener las capas de cada documento en un único grupo combinado.
4. Mantener bordes definidos; no añadir desenfoques, sombras ni brillos a los SVG.
5. Revisar `Default`, `Dark` y `Mono`, además de las vistas `Clear` y `Tinted`.
6. Conservar los PNG planos de los asset catalogs para los sistemas anteriores.

Los archivos `*-preview.svg` solo permiten revisar la composición plana; no se
importan como capa.
