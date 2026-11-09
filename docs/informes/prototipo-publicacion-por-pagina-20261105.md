# Prototipo de publicación por página (2026-11-05)

Prototipo y medición de una alternativa al sistema de páginas de la web: regenerar
solo las URL afectadas por cada escritura en la base de datos, con los renderizadores
de `js/*-html.js` en Node, y servirlas desde disco. Código y órdenes:
`tools/publicacion/`. Sin cambios en producción: lectura de la base de datos
en solo lectura y sin escrituras en R2, el VPS ni el build. Los cambios de datos de
las pruebas se aplican en memoria.

Este informe recoge la medición inicial y la recomendación de esa fecha. Dani autorizó
después el desarrollo completo: las familias, las mediciones posteriores y lo que falta
para el corte están en `docs/plans/publicacion-por-pagina.md`, y la operación del servicio
en `docs/runbooks/publicador-vps.md`.

## Resumen

- **Velocidad en móvil.** Contenido visible de la jornada de 952 a 654 ms, JS de 75 a
  31 KB, peticiones de 39 a 16 y lecturas de Supabase de 12 a 0.
- **Casi toda la ganancia en primer pintado no requiere migrar.** Retirar las precargas
  de módulos del HTML actual lo baja de 951 a 687 ms en jornada y de 1.242 a 950 ms en
  inscritos, con el dibujo del perfil 251 ms más tarde. Falta confirmarlo en producción.
- **CLS.** No justifica el cambio: en la carga normal, los 17 tipos de página medidos
  dan 0 px de salto entre secciones y un CLS máximo de 0,03.
- **Datos desfasados.** Es donde el salto existe: hasta 358 px en escritorio con una
  jornada que pierde el perfil y 53 px en móvil con una jornada cancelada. La API de CLS
  apenas lo registra (0,0002 en móvil) porque el repintado sustituye los nodos.
- **Frescura.** Publicar una carrera tarda 4–40 ms en local, más hasta 2 s de sondeo y la
  lectura. El circuito actual tarda 4–16 min (cálculo: vigilante, lote, build y caché de
  10 min). La detección real se ha observado en producción; una publicación real con
  páginas afectadas no ha ocurrido durante la vigilancia.
- **Coste.** Sin CDN, en escritorio con red rápida la carga es unos 100 ms más lenta
  que un HIT de Fastly. El VPS pasaría a ser punto único de fallo.
- **La lentitud mayor está en otras páginas.** Portada de resultados 3,5 s, portada
  2,9 s, resultados EN 2,9 s, agenda CX 2,5 s, mapa 2,3 s y calendario 2,3 s. El
  prototipo no las cubre.

## Método

- Chrome sin interfaz, con un contexto nuevo en cada carga y consentimiento guardado
  como rechazado. Móvil: 412×823 a 2,625, agente de Pixel 8, «Slow 4G» (150 ms, 1,6
  Mbit/s de bajada, 750 kbit/s de subida) y CPU ×4. Escritorio: 1280×900 sin limitar.
- Mediana de 5 cargas en jornadas e inscritos, de 3 en peores casos y panorama, y de 7
  en las mejoras sin migrar.
- Sistemas: **producción**; **copia**, la web actual servida desde un servidor local con
  gzip y sin retardo; **híbrido**, HTML publicado por página con el JS actual, que lee
  Supabase y conserva el DOM si la huella coincide; **prototipo**, HTML publicado con
  una isla de JS, sin Supabase. Híbrido y prototipo llevan 37 ms más por petición y 74 ms
  más en cada conexión nueva, la diferencia medida entre Fastly (8 ms) y el VPS (45 ms).
- Copia, híbrido y prototipo sirven desde este Mac por HTTP/2 local, sin priorización
  de flujos. No se ha servido nada desde el VPS.
- **Salto visual.** La API de CLS solo cuenta nodos que ya existían, y un repintado con
  `innerHTML` los sustituye. Por eso se mide además, en cada fotograma, cuánto se mueve
  en pantalla cada sección de `<main>` y el pie, seguidos por su clase y no por su nodo.
  Solo sigue secciones de primer nivel: no ve movimientos dentro de una sección, como las
  filas de fichajes (CLS 0,03 con 0 px). Por eso se dan las dos medidas.
- «Contenido visible» es el primer fotograma sin cortina `cc-booting` ni capa de carga.
  El LCP no sirve para esto: registra texto pintado bajo la cortina o el rótulo de la
  capa (portada: LCP 636 ms, contenido visible 2.851 ms).

## Resultados

### Jornadas con datos vigentes, móvil

| Página | Sistema | Contenido visible | Perfil | CLS | Peticiones | Supabase | KB total | KB JS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Giro, etapa 10 | Producción | 1.027 | 1.365 | 0,0002 | 39 | 12 | 181 | 79 |
| | Copia | 952 | 1.300 | 0,0002 | 39 | 12 | 175 | 75 |
| | Híbrido | 956 | 1.300 | 0,0002 | 39 | 12 | 176 | 75 |
| | Prototipo | 654 | 1.184 | 0,0000 | 16 | 0 | 122 | 31 |
| Tour, etapa 21 | Copia | 950 | 1.366 | 0,0003 | 40 | 12 | 207 | 75 |
| | Prototipo | 653 | 1.256 | 0,0000 | 17 | 0 | 153 | 31 |
| Mundial en línea | Copia | 943 | 1.280 | 0,0002 | 39 | 12 | 182 | 75 |
| | Prototipo | 646 | 1.170 | 0,0000 | 16 | 0 | 130 | 31 |
| Tour 2027, etapa 16 | Copia | 903 | 1.202 | 0,0000 | 38 | 12 | 159 | 75 |
| | Prototipo | 653 | 1.188 | 0,0000 | 15 | 0 | 107 | 31 |

- **Escritorio sin limitar.** Giro y Tour 2027: producción 63–80 ms con la página en
  caché de Fastly, prototipo 165–167 ms con el retardo emulado. Sin CDN, el VPS cuesta
  unos 100 ms en primera carga.
- **Segunda visita (móvil).** Copia: 40 peticiones y 59 KB, 12 de ellas a Supabase.
  Prototipo: 17 peticiones y 51 KB. Tras cada build, la web actual vuelve a descargar
  todo su JS y CSS por el `?v=` global; el prototipo usa nombres con hash e `immutable`.
- **Otras zonas (móvil).** Bogotá y Londres, en copia e híbrido: el JS repinta (de 4 a 7
  inserciones en `<main>`). En prototipo el script previo al pintado lo resuelve sin
  repintar y con 0 px de salto. Bogotá: contenido visible 946 ms frente a 654 ms.

### Dato cambiado después del build

Salto visual en píxeles. Giro / Tour 2027, salvo inscritos.

| Cambio | Dispositivo | Copia | CLS en copia | Híbrido | Prototipo |
| --- | --- | ---: | ---: | ---: | ---: |
| Jornada cancelada | Móvil | 53 / 53 | 0,0002 / 0,0000 | 0 / 0 | 0 / 0 |
| Jornada cancelada | Escritorio | 53 / 187 | 0,0004 / 0,0019 | 0 / 0 | 0 / 0 |
| Perfil retirado | Móvil | 0 / 2 | 0,0001 / 0,0000 | 0 / 71 | 0 / 2 |
| Perfil retirado | Escritorio | 0 / 358 | 0,0004 / 0,0339 | 73 / 73 | 0 / 0 |
| Emisión añadida | Móvil | 0 / 0 | 0,0002 / 0,0000 | 0 / 0 | 0 / 0 |
| Documento añadido | Móvil | 0 / 0 | 0,0002 / 0,0000 | 0 / 0 | 0 / 0 |

- Los 71–73 px del híbrido son del pie, empujado por la barra de acciones que el JS
  actual inserta al cargar. El prototipo la lleva en el HTML.
- **Inscritos con un corredor añadido (móvil).** 0 px en todos, pero el repintado retrasa
  el LCP: copia 2.200 ms, híbrido 1.220 ms.
- **Pestaña abierta (prototipo).** El cambio se ve en 0,6–0,9 s con sondeo cada 2 s, sin
  saltos en 18 cargas. Un cambio que altera lo que se está viendo espera a la siguiente
  interacción o a que salga de la pantalla.

### Panorama de la web actual (producción, móvil)

| Página | Contenido visible | LCP | CLS | Salto | Bloqueo | Peticiones | Supabase | KB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Portada de resultados | 3.541 | 1.508 | 0,0000 | 0 | 661 | 80 | 8 | 397 |
| Portada EN | 3.001 | 636 | 0,0000 | 0 | 32 | 55 | 10 | 293 |
| Resultados EN | 2.931 | 1.000 | 0,0023 | 0 | 0 | 94 | 28 | 314 |
| Portada | 2.851 | 636 | 0,0000 | 0 | 40 | 54 | 10 | 288 |
| Agenda CX | 2.450 | 1.032 | 0,0000 | 0 | 0 | 51 | 10 | 284 |
| Mapa | 2.286 | 6.148 | 0,0000 | 0 | 40 | 51 | 9 | 932 |
| Calendario | 2.257 | 1.116 | 0,0050 | 0 | 56 | 132 | 12 | 1.008 |
| Inscritos | 1.252 | 1.236 | 0,0000 | 0 | 0 | 69 | 14 | 236 |
| Resultados ES | 1.185 | 1.168 | 0,0026 | 0 | 0 | 92 | 28 | 290 |
| Torneo CX | 1.153 | 1.128 | 0,0000 | 0 | 0 | 47 | 10 | 236 |
| Carrera CX | 1.130 | 1.108 | 0,0000 | 0 | 9 | 61 | 24 | 301 |
| Resultados CX | 1.129 | 1.104 | 0,0000 | 0 | 9 | 61 | 24 | 301 |
| Jornada | 1.004 | 988 | 0,0002 | 0 | 18 | 39 | 12 | 181 |
| Competición | 981 | 960 | 0,0000 | 0 | 0 | 32 | 4 | 251 |
| Orden de salida | 955 | 948 | 0,0001 | 0 | 0 | 56 | 10 | 242 |
| Perfil | 928 | 908 | 0,0000 | 0 | 0 | 32 | 8 | 151 |
| Fichajes | 877 | 852 | 0,0295 | 0 | 0 | 69 | 26 | 311 |

Portada, portada de resultados, agenda CX, calendario y resultados EN son las que
`estudio-prerender-paginas-20261021.md` y `docs/plans/contenido-generado-build.md`
descartaron o dejaron sin contenido generado. El mapa ES sí lo lleva: pesa 932 KB, 282 KB
de JS.

### Mejoras sin migrar

HTML, JS y CSS actuales, móvil, mediana de 7.

| Variante | Jornada: visible | Jornada: perfil | Inscritos: visible | Salto |
| --- | ---: | ---: | ---: | ---: |
| Actual | 951 | 1.416 | 1.242 | 0 |
| Sin precargas de módulos | 687 | 1.667 | 950 | 0 |
| Sin cortina `cc-booting` | 919 | 1.285 | 1.202 | 56 |
| Sin ambas | 678 | 1.690 | 912 | 56 |

Las 11 precargas de módulos compiten con el CSS por el ancho de banda y retrasan el
primer pintado. A cambio, sin ellas el JS llega más tarde y el perfil se dibuja 251 ms
después. La cortina debe quedarse: quitarla apenas adelanta y añade un salto. El
servidor local no prioriza flujos, así que la ganancia en producción puede ser menor.

### Publicación y señal

- **Familia completa (Mac).** 5.229 páginas en 6,9 s: pintado 1,5 s y Brotli con
  escritura 5,4 s. CPU de pintado, 0,32 ms por página. Árbol de 343 MB. Las mediciones
  del job de build dan CI/local ×2,3–3,6 como referencia para el VPS, sin medir.
- **Una carrera (Mac).** Giro, 48 páginas, 31 ms; Tour, 46 páginas, 40 ms; un día, 2
  páginas, 4 ms. Lectura real de la carrera: 100–206 ms desde aquí.
- **Abanico.** Un equipo en 126 carreras reescribe 245 páginas en 270 ms, con 3,4 s de
  lectura. Un corredor en 42 carreras: 0,9 s de lectura.
- **Señal sin cambios en producción.** Sondeo cada 2 s de recuento y suma de `xmin` por
  tabla (10,7 ms en base de datos con las cinco tablas de jornadas). En `race_uci_results`
  (387.000 filas) y `startlist_riders` (67.000), contadores de `pg_stat_user_tables`; solo
  si se mueven se compara por carrera (1,4 s y 78 ms). El retraso de esos contadores
  está sin medir.
- **Observado en producción.** 72 minutos de vigilancia, 2.100 pasadas: 10 filas de
  `races` detectadas, 96 ms de detección a publicación y ninguna página afectada, porque
  esas carreras no tienen jornadas publicadas. Los dos repintados de control no
  encontraron páginas desfasadas.
- **Caída de conexión.** Con la conexión cortada de verdad, reconecta y resincroniza en
  unos 6 s sin cambios espurios.
- **Repintado a las 00:05 de Madrid.** Con procesos nuevos, porque `CX_HOME` y el año del
  calendario se fijan al cargar los módulos. Toda página que cambie en él delata una
  dependencia sin registrar.

### Comprobaciones

- **`<head>` en Node frente a `gen_og_pages.py`.** 5.227 de 5.228 páginas de jornadas e
  inscritos, campo a campo y con el JSON-LD comparado como dato. La diferencia es un
  defecto de datos de producción (abajo).
- **Paridad de texto visible.** 48 de 48 combinaciones de 6 páginas y 8 zonas, en
  prototipo frente a copia.
- **Híbrido.** El JS actual conserva el HTML en 9 de 9 páginas de jornadas e inscritos.
- **Funciones de la isla.** 12 de 12: volver, avisos, calendario, modo oficial del
  perfil, barra de acciones, visor de documentos, filtro y variantes de TV, apps,
  idioma y ausencia de lecturas de Supabase.
- **Ciclo de vida.** 44 de 44, con cambios en memoria: altas, cambios del `<head>`, de
  slug (301, en cadena y de vuelta), bajas, traslados entre carreras, abanicos y, en
  inscritos, paso a lista provisional. Tras restaurar, las páginas quedan idénticas
  byte a byte, y la lectura real por carrera da las mismas páginas que el volcado.

## Lo que cubre y lo que no

Cubierto: jornadas ES y EN en isla y en híbrido, e inscritos con lista ES y EN en
híbrido. El servidor sirve lo publicado y pide lo demás a la web actual, como lo haría
nginx con proxy a Pages.

Sin medir ni construir:

- **VPS real.** Primer byte desde disco, HTTP/2, carga en 2 vCPU y 4 GB. El retardo está
  emulado.
- **Publicación real con páginas afectadas.** Solo se ha observado la detección.
- **Resto de familias.** Portada, calendario, agenda CX, resultados, competición,
  perfil, mapa, orden de salida, fichajes, ciclocross, feeds y sitemap. Portada y agenda
  dependen de la hora y del visitante, y son el caso más difícil.
- **Inscritos sin lista.** Siguen en la web actual.
- **Bloqueos de LaLiga.** La página del prototipo no lee Supabase, cuyas IP son de
  Cloudflare, pero no se ha probado durante un bloqueo.
- **Fuera de Europa.** Con VPS en Alemania y sin CDN, el coste de latencia será mayor.
- **Interacción.** Sin medir. La página de error del prototipo es un texto mínimo.

## Señal alternativa

La base de datos ya tiene los disparadores `change_notice_*`
(`docs/runbooks/aviso-cambio-webs-externas.md`), por sentencia y con carrera, en `races`,
`race_days`, `assets`, `race_uci_stages`, `race_uci_results`, `startlist_teams` y
`startlist_riders`. Evitarían comparar `race_uci_results` por carrera. A cambio exigen
un destino nuevo con todas las carreras, una escritura más en cada sentencia y ampliar
los disparadores a `broadcasts`, equipos y corredores: una migración de producción. El
prototipo no los usa.

## Defecto encontrado

`races.slug` es nulo en una carrera con jornada publicada, «Kryterium Asów Beskid Race»
(`91c32bbc-ce63-4187-9ddb-7fb2f5cae2b9`). `gen_og_pages.py` filtra esas filas, de modo que
`/jornada/kryterium-asow-beskid-race-2026/` se publica con el título «: Bielsko-Biała ·
159,6 km» y su página EN responde 404. Sin corregir: queda por decidir si se completa el
slug o se retira la carrera.

## Recomendación

1. **Retirar las precargas de módulos en las páginas con contenido generado**, con
   medición en producción en una familia antes de extenderlo. Es un cambio en el build
   actual, sin migración, y es la mejora más barata de este estudio.
2. **Prototipar la portada en isla.** Es donde más tiempo se puede ganar y donde se
   decide si el sistema resuelve lo que dependa de la hora y del visitante.
3. **Probar en el VPS** con un nombre de prueba: primer byte real, carga y una
   publicación real.
4. **Decidir el reemplazo con esos datos.** Con lo medido hasta ahora, el CLS no lo
   justifica y el primer pintado de las páginas generadas tampoco. Lo justificarían la
   frescura en segundos, la independencia de Supabase y de los bloqueos de LaLiga, menos
   JS y las páginas lentas, si el punto 2 lo confirma.

Si se decide migrar, la vía de menor riesgo es por fases: híbrido por familia, que no
toca el cliente, y después isla, con nginx como proxy a Pages para lo no trasladado y
vuelta atrás por DNS.
