# Vídeos de jornadas de carretera y sección Vídeos

Desarrollo: `docs/plans/videos-5-2.md` (web y apps 5.2.0). Carga de datos:
skill `cc-videos`. Vídeos de ciclocross: `cx_videos` y skill `cc-cx-carreras`.

## Datos

- `public.race_day_videos`: `id`, `raceDayId` (FK con borrado en cascada),
  `kind` (`full`, `summary`, `last_km`, `other`), `title` y `titleEn`,
  `channel` (emisor), `url` (https), `embeddable` (oEmbed; NULL sin comprobar),
  `country` (grupos regionales de `broadcasts`), `sortOrder`, `updatedAt`.
  Lectura pública; escritura de administradores y de `save_race_day_videos`
  (`cc_agent`), con auditoría en `private.race_day_video_log`.
- `video_feed_days(p_from, p_to)`: jornadas de carretera con vídeos propios o,
  con clasificaciones propias, con emisiones de Revive; JSON con la jornada,
  `race`, `videos` y `broadcasts` (estas, solo con Revive). Con `p_from` nulo,
  el último día con contenido hasta `p_to`. Lectura `anon`, `authenticated`,
  `cc_agent` y `cc_publicador`.
- `broadcasts.embeddable` y `cx_broadcasts.embeddable`: 401, 403 y 404 del
  oEmbed de YouTube son `false`.

## Regla común (web `js/services/stage-videos.js`, iOS y Android `StageVideoLogic`)

- Emisión convertida: emisión de Revive de una jornada con clasificaciones
  propias, de YouTube con vídeo fijo y `embeddable` distinto de `false`. Pasa a
  Vídeos como «Emisión de la etapa» / «Emisión de la carrera» (tipo `full`) y
  sale de Revive.
- Orden: emisión completa, resumen, último kilómetro y resto; en cada tipo,
  `sortOrder` (en `full`, primero `race_day_videos`). El mismo vídeo (ID de
  YouTube o URL normalizada) aparece una vez.
- Región: los vídeos con `country` siguen el filtro de las emisiones.
- Reproductor integrado: YouTube (`youtube-nocookie`, `playsinline`) con
  `embeddable` distinto de `false`; el resto, fila externa «<plataforma> ↗».
- Sin reproducción automática en acordeones, paneles y secciones; el modal de
  TV de la web sí arranca solo. La fila abierta va en seminegrita, sin rótulo de
  estado («Reproduciendo» retirado el 2026-11-11).

## Superficies

- Jornada: panel «Vídeos» (`#videos`), acordeón con el primero abierto. En
  pantalla ancha, mampostería: Perfil, Información y Revive en la columna
  principal; Puntos clave y Vídeos en la lateral. Terminada, la Información va
  antes que Revive. Web `stageVideosPanelHtml`; iOS `StageVideosPanel`; Android
  `StageVideosPanel` y `StageScreen`.
- Clasificaciones: vídeos de la jornada tras «Perfil y datos», mismo acordeón.
- Tarjeta terminada de Hoy y Competición: con vídeos propios y emisión íntegra,
  menú «Vídeos» / «Completa» («Videos» / «Broadcast»); con uno de los dos, un
  botón (`cardActions` / `cardVideoActions`).
- Sección Vídeos (`/videos/`, pestaña 3 de las apps): conmutador Ciclocross /
  Carretera (Ciclocross primero en la temporada CX; chincheta de Carretera solo
  en la web), días con cabecera, ventana de 14 días anclada al último día con
  vídeos y «Cargar más carreras» de 7 en 7 hasta el principio de la temporada.
  Cada carrera es una tarjeta que se despliega hacia abajo; plegada, solo la
  carrera y una flecha hacia abajo. Filas: vídeos por tipo y, al final, las
  emisiones de Revive restantes. Sin vídeos, una sola emisión da el botón
  «Emisión ↗» y varias despliegan la tarjeta. Al pie, «Ir a la etapa / carrera
  / prueba ›».
- Ciclocross en la sección: tipo deducido del título (`Carrera completa`,
  `Resumen`, `Meta`; las emisiones de YouTube convertidas son `full`) y Revive
  con el estado de resultados de la agenda. En la ficha CX, el emisor bajo el
  título.
- Orden CX (web y apps; decisión de Dani, 2026-11-14, que sustituye a la del
  2026-11-11 con la carrera completa delante): en la ficha y en la sección,
  los vídeos de `cx_videos` por categoría (ME, WE, MU, WU, MJ, WJ; lo común,
  sin categoría, delante) y, dentro de cada una, por tipo (carrera completa,
  resumen, meta y el resto) y después el orden cargado; al final, las
  emisiones convertidas («Carrera completa <categoría>», «Retransmisión
  completa») y el Revive, también por categoría. La TV en directo y el Revive
  de la ficha siguen el mismo orden de categorías; solo la lista de horarios
  conserva el orden cronológico del programa.
- Enlaces: `calendariociclismo://stage/<id>#videos`, `/jornada/<slug>/#videos`
  y `/en/stage/<slugEn>/#videos` abren la jornada desplazada al panel;
  `calendariociclismo://tab/videos`, la sección.

## SEO de la sección Vídeos

- `tools/site/prerender-videos.mjs` (sitio base del VPS, `PRERENDER_VIDEOS=all`
  en `tools/publicacion/vps/base.sh`, cada reconstrucción del sitio base, unos
  15 minutos) pinta en `/videos/` y `/en/videos/` la vista inicial con el código
  del navegador y la región de la audiencia principal (sin restricción, ES y
  EUROPA), y añade en el `<head>` JSON-LD `CollectionPage` con
  `BreadcrumbList` e `ItemList` (hasta 40 carreras de las dos disciplinas, con
  enlace a la jornada `#videos` o a la ficha CX `?view=videos`).
- `js/videos-feed.js` conserva ese HTML sin capa de carga (`data-prerendered`
  con `htmlFingerprint`) y solo repinta si los datos vivos o la región del
  visitante dan otro HTML. El conmutador espera a los datos.
- Título visible para buscadores: `h1` «Vídeos de ciclismo» / «Cycling
  videos» (`videos.pageTitle`); título, descripción, canonical, hreflang, OG,
  sitemap y `llms.txt` en las páginas fuente.

## Analítica

- `video_open` con `platform` (`youtube`, `rtve_play`, `etb_on`, `raiplay`,
  `auvio`, `other`) y `video_kind`, en las tres plataformas.
- Pantallas `videos` (Carretera) y `videos_cx` (Ciclocross) de la sección
  Vídeos en iOS y Android, al abrir y en cada cambio de disciplina. Hoy registra
  `today` (Ruta) y `cyclocross` (CX); Calendario, `month` y `season`.
