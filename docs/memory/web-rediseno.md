# Rediseño web (Figma, octubre 2026)

Reestilizado de la web pública según el Figma `calendarioCiclismo` (marcos de
escritorio de 1440 px, claro y oscuro). Solo la web: las apps, el panel, los
generadores (`tools/site/`) y Supabase no cambian. Rutas, metadatos, JSON-LD,
textos e i18n son los mismos.

## Tokens
- Paleta propia de la web en `css/app.css` §1 (`:root` oscuro y `html.light`;
  el tema sigue al dispositivo, sin selector). `css/tokens.css` no cambia porque
  lo comparte el panel.
- Tema oscuro con los valores Grafito de `css/tokens.css` (fondo `#0b0c0f`,
  tarjeta `#24262b`, tinte `#2e3036`, cabecera `#222429`, bordes `#3a3d44`,
  contorno `#8f949d`, texto `#f2f3f5`/`#a9adb5`) y la composición del diseño
  (superficies con contorno). Del Figma conserva el lima de la marca y de los
  filtros activos y las teselas claras. El tema claro es el del Figma.
- Nuevos: `--bg-tint` (franja de navegación, cabeceras de panel y tabla),
  `--border-strong`, `--control-border`, `--brand` (logo), `--selected-*`
  (filtro activo), `--day-selected-*`, `--tile-green-*` y `--tile-amber-*`
  (cifras de la jornada).
- `--card-shadow` pasa a ser un anillo de 1 px: todas las superficies que lo
  usaban quedan contorneadas, como en el Figma, sin desplazar el layout.
- Contraste AA verificado para texto, texto secundario y enlaces sobre fondo,
  tinte y hover en los dos temas. Excepción deliberada: las losetas y el
  banner de equipo reproducen los colores del Figma tal cual, y algunas
  parejas quedan por debajo de 4,5:1 (p. ej. Netcompany INEOS, XDS Astana).

## Cabecera
- Fila de marca del doble de la franja de navegación: 80 px sobre 40 px desde
  1280 (72 y 64 px en 1100–1279 y 601–1099), con logo, Apps, Apoyar e idioma a
  su escala. El marcado sale de `js/header-html.js` (también en el prerender).
- Logo: los dos iconos de siempre (calendario y ciclista, Lucide) calados en
  una placa del color de la marca, seguida del nombre y la firma «by Dani
  Sánchez» en Momo Trust Display; en móvil, solo la placa.
- Fija (sticky) desde 601 px: Calendario salta al día de hoy al cargar y la
  cabecera debe seguir a la vista. Las barras de cada página se colocan debajo
  con `--site-header-h` (js/header.js). En móvil se desplaza con la página.

## Interacción y desplazamiento
- Hover: `--hover-bg` es el tinte azul del diseño (`--bg-tint`), no el gris
  de la versión anterior. Un `:hover` solo cambia colores, borde, subrayado,
  sombra o filtro; nunca tamaño, peso ni relleno.
- Una sola barra de desplazamiento, la de la página (fina, con los colores del
  tema). Ningún contenedor interior muestra barra: las listas crecen y las
  filas horizontales (pestañas, filtros) se desplazan sin barra, con
  difuminado en el borde que queda oculto.
- Ficha de jornada (≥1100 px): Puntos clave ocupa una columna junto a Perfil,
  Televisión y Descripción, sin altura máxima.

## Espaciado
- Medido sobre la geometría de los marcos del Figma a 1440 px: margen de
  página de 16 px y columna lateral de las fichas pegada al borde izquierdo
  (312 px).
- Orden del Figma: Fichajes · Resultados · Hoy · Calendario · Ciclocross. Con la
  home cedida a Ciclocross: Fichajes · Resultados · Ciclocross · Calendario.
- Móvil (≤600 px): misma barra inferior, con los colores nuevos.

## Ficha de carrera (≥1100 px)
- `raceLayoutHtml()` (`js/shared.js`, sin DOM) compone la columna lateral
  (280 px; 312 px desde 1280) dentro de los constructores de página
  (`js/*-html.js`), así que el prerender del build ya la trae y nada se mueve al
  cargar: jornada, resultados, inscritos, orden de salida, competición y ficha
  de ciclocross (estas dos también las genera el build: `js/competicion-html.js`
  y `js/cx-race-html.js`). La fila «Clasificación general final» de la lista de
  etapas sale desactivada y marcada con `data-gc-final-check` cuando la página
  no sabe si existe; `js/race-gc-final.js` la activa en el navegador. Por
  debajo de 1100 px las cajas usan `display: contents` y el orden es el de
  siempre.
- Web oficial, libro de ruta e inscritos van en la fila de pestañas
  (`data-side-link`) y en la fila de enlaces de la columna (`.race-side-links`);
  el CSS muestra una u otra según el ancho.
- En la jornada la columna lleva además `buildStageList()`: enlaces a las etapas
  con los datos que la página ya carga; el selector `<select>` se oculta solo
  mientras esa lista existe.
- Ciclocross: la columna lleva las mangas del torneo (`buildCxRoundList()`,
  datos que la página ya carga); la manga actual, rellena.
- Lista lateral de etapas idéntica en todas las páginas de una vuelta por
  etapas (`raceSideStageList`, js/shared.js): jornada, resultados, perfil,
  mapa, inscritos, orden de salida y competición. Etapas (sin descansos),
  «Clasificación general» (pestaña General de /resultados/<carrera>/, que
  muestra la última publicada) y «Ver todas las etapas» (actual en
  Competición). Cada etapa enlaza dentro de la sección: resultados a su
  clasificación (o a la jornada si aún no tiene), perfil y mapa a los suyos,
  inscritos a `?etapa=N`, el resto a la jornada. Solo depende de las jornadas,
  así que el build pinta lo mismo; para ello resultados, inscritos y orden de
  salida leen salida, meta y slugs de race_days (navegador y build:
  prerender-resultados, prerender-inscritos y prerender-auxiliares).
- Lo que aún no ha ocurrido va desactivado (span con aria-disabled): en
  resultados, las etapas sin clasificación; en todas, «Clasificación general
  final» hasta que existe la final. Las páginas que no la conocen la pintan
  desactivada (igual en build y navegador) y js/race-gc-final.js la activa
  tras cargar.
- Grandes Vueltas (Tour, Giro, Vuelta, masculinas y femeninas): acento de
  marca solo con CSS (`:root:has(link[rel=canonical][href*=…])`, css/app.css):
  fila actual de la lista, pestaña activa, etapa activa en resultados y filete
  superior de la cabecera lateral.
- Inscritos por etapa (`?etapa=N`, misma URL canónica): tachados solo quienes
  no tomaron la salida de esa etapa (abandono en una anterior o DNS en ella),
  `prepareStartlistData(..., { atStage })`.
- Composición de Race_Info del Figma (≥1100 px, solo CSS): perfil a todo el
  ancho con Interactivo/Oficial como botones (el activo relleno); puntos clave
  en tarjetas con «Añadir al calendario» y «Reportar cambios» a la derecha;
  descripción de la etapa y, en una columna de 272 px, la televisión.
- Teselas con la escala de los componentes 24–28 (verde → turquesa → lima →
  ámbar → rojo, de más fácil a más duro; `stageTileLevels` en js/shared.js).
  Distancia y desnivel con los umbrales de las notas del Figma (150/175/200/225
  km; 1000/1750/2500/3250 m); perfil por tipo de etapa y final por pendiente
  media (3/4,5/6/8 %), establecidos para que los ejemplos del diseño salgan en
  ámbar.
- «Clasificación general» (`raceGcLink`): fila bajo las tarjetas de
  Competición; en la lista lateral, antes de «Ver todas las etapas» (que se
  mantiene aunque no esté en el Figma). Con la última etapa corrida enlaza a la
  clasificación final de la carrera («Final»); antes, a la general de la
  última etapa con resultados («Tras la etapa N»).
- Perfil interactivo y mapa (`js/perfil-mapa-html.js`) con la misma
  composición que la jornada: columna lateral, migas, pestañas y teselas.

## Pie
- Montado por `js/header.js` sobre el pie de cada página (conserva su
  copyright, Privacidad e iCal): marca, columnas «Secciones» (las de la
  barra) y «Más» (Acerca de mí, Datos abiertos, iCal y Gestión de cookies,
  que añade `js/cookie-consent.js`) y, abajo, la autoría (Dani Sánchez en
  negrita) y la firma del rediseño en Style Script, gris y a la escala del
  texto del pie, enlazada a su perfil de X.
- Siempre bajo el pliegue: el pie va al fondo del cuerpo (posición absoluta)
  y el cuerpo mide al menos una pantalla (`100lvh`) más el pie
  (`--site-footer-h`, medido en `header.js`); en móvil, además, la barra
  inferior.

## Huecos de imagen
- Carrera sin logo o con un logo que no carga: la placa de la marca apagada
  sobre el tinte, del tamaño del logo (`js/components/logo-placeholder.js`,
  `.logo-ph`). Tarjetas, feed, cabecera, hero de competición, ciclocross y
  calendario.

## Calendario y ránking
- Calendario: el mes es la cabecera tintada de su tabla y queda fija con ella
  al desplazar.
- Ránking UCI: género como conmutador segmentado, explicación en panel con
  cabecera tintada y niveles con la paleta de las teselas.

## Fichajes
- Dos vistas, Mercado y Equipos (`?vista=equipos`; `?div=` y `?team=` también
  abren Equipos). El `<h1>` es siempre el del mercado (oculto con `sr-only` en
  Equipos y en la ficha de equipo).
- Filtros del mercado (en memoria, sin URL): categoría, división del equipo,
  edad UCI (`SEASON − año de nacimiento`: júnior ≤18, sub-23 19–22, élite ≥23)
  y años de contrato (1, 2, 3, 4 o más). Dentro de un grupo suman; entre grupos
  restan. Un grupo completo no filtra, así que los datos desconocidos solo se
  ocultan cuando se desmarca algo de su grupo.
- Lecturas añadidas: `birthDate` de la ficha y `teams.countryCode` de los
  equipos de la temporada.
- Losetas y cabecera del equipo con los colores del diseño
  (`js/fichajes-figma-colors.js`, por teamId); un equipo sin entrada usa
  `headerBg`/`headerText` del panel (o los de la temporada anterior si la
  chapa no es visible).
- Feed de resultados: ganador y líderes con su equipo entre paréntesis
  (`resolveRiderTeams`, por la startlist de la carrera).
- Franjas: las tres del diseño en losetas, banner y filas de los equipos con
  entrada; el resto, las de maillot del panel.
- Rumores: la fila entera sobre un tinte azul suave y RUMOR en azul a la
  derecha, igual en plantilla, llegadas y salidas.
- Plantilla = continúan + llegadas confirmadas, teñidas por año de fin de
  contrato (verde ≥ +2, amarillo +1, rojo el año del mercado); las llegadas, en
  tono fuerte.

## Decisiones
- Tipografía del Figma: Montserrat para el texto y Momo Trust Display para el
  logotipo (nombre y «by Dani Sánchez»), autoalojadas (fonts/web/README.md);
  Style Script solo para la firma del rediseño.
  El panel y el PDF de inscritos siguen con Google Sans.
- Logo: los iconos de siempre en placa más el nombre del Figma en escritorio y
  tableta; en móvil, la placa.
- Sin selector de tema (decisión posterior al Figma: el tema sigue al
  dispositivo).
- Perfiles: conservan el color de cada carrera; el lima/marino del Figma es un
  marcador de posición.
- Colores de texto de las cifras más oscuros que en el Figma para pasar AA.
- Sin marcos de móvil ni tableta en el Figma: los puntos de corte son los de
  siempre (600, 760, 1099, 1280).
- Móvil: las pestañas de documentación forman una rejilla de celdas iguales
  (sin desplazamiento); cifras de la jornada de dos en dos; la lectura del
  perfil flota sobre el gráfico; los filtros de Hoy en una fila desde 320 px.
- Un solo enlace en la fila lateral de la ficha: centrado.
