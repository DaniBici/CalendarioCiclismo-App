# results-fetchers

Motor de volcado de resultados. **Código en producción**: el watcher actual del VPS
invoca `results-vps-runner.mjs`, que atiende la cola manual, ejecuta
`dataride-live-linker.mjs` cada cinco minutos para enlazar las carreras reales del día
que todavía no tienen ninguna fuente y ejecuta `results-cron.mjs --configured`.
El proceso histórico separado invoca
`results-historical-vps-runner.mjs`, que ejecuta
`results-cron.mjs --scope backlog --historical --limit 1` y solo atiende carreras
2020–2025. Ambos procesos retiran las carreras verificadas sin ninguna clasificación principal publicable;
`results-today.yml` queda como fallback manual y `results-backlog.yml`
mantiene el circuito manual de recuperación. Las carreras
marcadas `races.resultsOnly=true` no siembran inscritos desde DataRide. En estas carreras el
cron puede resolver las filas con dorsal por nombre, fecha de nacimiento, nacionalidad y
aliases mediante `--resolve-bibs-by-name`, escribiendo solo `race_uci_results.globalRiderId`.

`dataride-live-linker.mjs` trabaja con el rol `cc_results_worker`, consulta solo carreras
no canceladas con una jornada real en la fecha local de España y exige coincidencia
de fecha, país, categoría y una señal de nombre/género. Si existe cualquier enlace
previo para la carrera, no la toca. El enlace se crea como `source='uci'`,
`autoMatched=true` y `matchMethod='live-today'`; todo enlace queda activo por
definición. Después
vuelca la jornada actual. Las jornadas siguientes quedan cubiertas por las ventanas
heredadas del cron configurado. Las colisiones y coincidencias ambiguas se dejan para
revisión manual.

La captación automática se activa al enlazar la fuente. El panel permite fijar
horas de apertura y cierre en horario de España. La regla puede aplicarse a toda la carrera o
sobrescribirse en una jornada concreta; la frecuencia es política interna del
watcher y no una decisión editorial. No se utiliza ningún booleano de activación:
los enlaces automáticos sin jornadas también entran en el backlog cuando la fecha
final de la carrera ya ha pasado.

La excepción es `uci-team-ranking-sync.mjs`: mantiene la única instantánea
semanal de los ránkings de equipos masculino y femenino. Un timer del VPS consulta
DataRide cada hora durante lunes y martes y repite el miércoles como red de
seguridad; el workflow queda manual. Sin `--apply` valida DataRide y los
emparejamientos sin escribir; `--fetch-only` comprueba solo la fuente.

Antes se llamaba `catalog-continental/`, nombre heredado de la tarea puntual con la
que nació el directorio. Se renombró en la preparación del repo público (2026-07-18)
porque ese nombre escondía que aquí vive el motor de resultados y estuvo a punto de
costarnos un borrado accidental.

## Qué va aquí

Solo código que **corre en producción**: los fetchers por fuente, el cron, el upsert
y las utilidades de fuentes de resultados.

## Qué NO va aquí

- **Scripts ad-hoc de vigilancia** (`_watch-*.sh`, `_poll-*.sh`). Son andamiaje de una
  carrera concreta y ya cumplieron; los playbooks quedan en `docs/runbooks/`.
  Si necesitas uno nuevo, que sea temporal y no se commitee.
- **Utilidades de catálogo** (seeds, mapeo de equipos): no son parte del volcado.
- **Documentación de contratos de API.** Los `.md` con los contratos verificados de
  las fuentes de cronometraje (Tissot, Matsport, manual_timing, race|result, STS,
  Domtel, livetiming.at, sportstiming, ChronoRace, UCI DataRide) **se mantienen
  fuera de este repositorio** desde que pasó a ser público. Detallan endpoints no documentados y
  los rodeos necesarios para consumirlos, así que publicarlos es superficie de
  reclamación por condiciones de servicio sin ninguna ganancia.

  Si trabajas en un fetcher y necesitas su contrato, pídeselo a Dani. No vuelvas a
  commitearlo aquí.

## Añadir una fuente nueva

Los fetchers de carretera emiten el **mismo JSON intermedio**, que consume `results-upsert.mjs`.
Esa es la única interfaz que hay que respetar: si tu fetcher emite ese formato, el
resto del pipeline (locks, resolución por dorsal, saneos) funciona sin tocar nada.

CX tiene un contrato independiente por categoría: `dataride-results-fetch.mjs --discipline 3`
usa `cx-dataride-results.mjs` y su salida pasa a `cx-results-upsert.mjs`/`cx_ingest_results`.
No enviar esa salida al upsert de carretera. Calendario desde web UCI, matching propio CX,
bonos X2O desconocidos NULL y protección de correcciones manuales.
[Contrato y operación CX](../../docs/runbooks/cc-cx-results-pipeline.md).

`cc-cx-results.timer` usa `results-vps-runner.mjs --discipline 3` y
`cx-results-cron.mjs`: cola compartida separada por disciplina, ventanas desde el
final UCI estimado, programa verificado, cadencia de enlace CX y protección manual.
`--discipline 3 --dry-run` solo lee decisiones. El runner sin argumentos conserva
carretera; los enlazadores y el backlog de carretera no crean ni eliminan datos CX.

Para una clasificación individual con dorsal, el contrato de salida preferido es
solo `bib`, `rank`/`rankText` y el valor de resultado (`timeText`/`gapText`, puntos
o `irm`). En carreras normales, el upsert resuelve identidad exclusivamente por
`bib` contra la startlist; no añadir nombre, equipo, país ni `winnerName`. En carreras
`resultsOnly`, DataRide conserva además `riderDisplay`, nombre, país y fecha de
nacimiento para la resolución nominal opt-in, sin crear inscritos. Las únicas otras
excepciones son clasificaciones por equipos y filas históricas sin dorsal, que
conservan `riderDisplay` como fallback explícito. Los fetchers existentes pueden
mantener campos de texto transitorios mientras el parser los necesita para leer una
tabla; no llegan a persistirse cuando la fila trae dorsal salvo en DataRide.

El patrón está en cualquiera de los existentes; `tissot-results-fetch.mjs` es el más
completo (incluye el híbrido con DataRide para las CRE).

`tissot-results-fetch.mjs` cubre dos topologías de Tissot. Las carreras por etapas
(Tour, Vuelta, ARA…) leen la competición y sus `/stages`. Los campeonatos
`MultiEvents` (Mundiales de carretera) agrupan varias pruebas de un día bajo un
mismo comp_id: ahí se pasa `--tissot-event <n>` (nº de evento) y el fetcher emite
una única clasificación final por invocación, porque cada prueba es una carrera de
un día con su propio `raceId`. El nº de evento entra en la semilla de los IDs
sintéticos (`comp#evento`), de modo que las pruebas del mismo campeonato no
colisionan. `race_uci_links.tissotEventNumber` transporta ese selector; NULL
mantiene intacto el comportamiento de etapas. El contrato de los endpoints vive
fuera del repositorio, junto al resto de contratos de cronometradores.
Mientras la clasificación `/results` no exista, el fetcher usa `/live` solo con
filas que acrediten un split `Finish` con puesto positivo y tiempo absoluto. No
publica puestos de pasos intermedios ni estados DNS/DNF como llegadas; los
volcados siguientes incorporan el resto de llegadas y la clasificación oficial.

El relevo mixto se publica como `gc` final con `raceType='TTT'`. Sus filas están
expandidas por dorsal, por lo que `isTeamEvent=false` permite resolver las fichas
desde los inscritos. Se conserva el ID histórico de esa clasificación al corregir
su tipo. Los tiempos absolutos publicados tienen prioridad; si solo hay diferencias,
se suman con centésimas antes de truncar el resultado a segundos enteros.

El carril de startlists tiene sus propias piezas: `tissot-startlist-fetch.mjs`
extrae `/startlist` (en CRI, `rank` = orden de salida y `value` = hora local) y
`/teams` (selección con nombre, miembros y UCI ID) y emite un documento crudo sin
tocar la BD; `tissot-startlists-sync.mjs` resuelve identidad y equipo contra
Supabase y aplica vía la RPC `vps_import_tissot_startlist`. Retirado del runner
del VPS el 2026-09-25: se conserva para ejecución manual, solo para carreras de un día. En una vuelta por etapas la
startlist de Tissot es la de cada etapa, no la de inscritos, y no se procesa.
El `uciRiderId` de Tissot es una licencia (`uciLicenseId`), no un perfil UCI
corto (`uciProfileId`). El país del catálogo se lee de `nationality`. Si no hay
licencia registrada, se puede resolver por dorsal y nombre o alias exacto de la
lista existente, sin asignar identidades ambiguas. Las listas y órdenes ya
importados como oficiales se omiten antes de consultar de nuevo la fuente.

Los Juegos servidos por Bornan (Juegos Asiáticos 2026, `source='bornan'`) tienen su
propio carril de inscritos: `bornan-startlist-fetch.mjs` lee la API `entries` por
NOC mientras la organización no publica dorsales, y el PDF «Start List» (C51R/C51T)
cuando aparece; `bornan-startlists-sync.mjs` resuelve selección por `selectionCode`
ISO-2 y ficha por nombre/nacimiento, y aplica con `prepare_startlist_import` +
`apply_startlist_import`. La lista queda provisional (dorsal 0) hasta el PDF oficial.
La firma de origen se compara con `vps_startlist_state` para no reaplicar una lista
idéntica en cada pasada, y las identidades ambiguas bloquean la importación hasta su
revisión manual. Corre en el runner en la cadencia lenta.

`bornan-results-fetch.mjs` vuelca la clasificación oficial de una unidad Bornan. Lee
el endpoint estructurado `/s/{champ}/{lang}/{disc}/results/{unitKey}` que alimenta la
web oficial y publica solo cuando `Info.Status` es `OFFICIAL`; `Competitors` aporta
puesto, dorsal, NOC, tiempo, hueco e IRM sin depender del PDF. El índice
`/reports/all` solo descubre la unidad y la clave; el cuadro `Results` (C73T) queda
como respaldo si el endpoint estructurado no responde. Sin clasificación oficial no
emite etapas y el enlace permanece pendiente. El cron lo activa con
`race_uci_links.source='bornan'` y `bornanCode=<apiBase>|<champ>|<disc>|<eventKey>`.



`classificacoes-results-fetch.mjs` es la excepción portuguesa: recibe el slug de
la prueba, descubre desde la web los ids de etapa y clasificaciones y conserva los
dorsales publicados. Para crear el enlace, su `--suggest-id` da el `competitionId`
sintético estable y el cron usa `race_uci_links.source='classificacoes'` junto a
`classificacoesCode=<slug>`.

`burgos-results-fetch.mjs` descubre los dos PDFs que publica la página estable
`/es/clasificaciones-Na-etapa/` de la Vuelta a Burgos. Extrae etapa, general,
puntos, montaña, jóvenes y equipos; el cron lo activa con
`race_uci_links.source='burgos'`.

`timing-results-fetch.mjs` consume el JSON público de timing.ee, conserva el PDF
oficial de cada jornada como URL de fuente y excluye las filas de preparación que
el cronometrador marca sin correspondencia. El cron lo activa con
`race_uci_links.source='timing.ee'` y `timingCode=<event>`.

`maneffic-results-fetch.mjs` consume los JSON públicos de Maneffic Timing &
Results en timing-results.com. Una vuelta publica llegada, joven y equipos por
jornada, además de las generales acumuladas. El cron lo activa con
`race_uci_links.source='maneffic'` y
`manefficCode=<YYYY/DISCIPLINA/EVENTO>`. La fecha de generación debe coincidir
con la jornada seleccionada: el proveedor puede dejar datos de prueba en las
mismas URLs antes de la carrera.

Para etapa y general, Maneffic aporta como censo independiente la lista de salida
de la jornada, con dorsales únicos y carrera, etapa y fecha contrastadas. Se admite
su publicación la víspera. Así las bajas anteriores o dorsales sustituidos de la
lista inicial no bloquean la oficialidad. El cierre conserva los 30 minutos de
estabilidad observada y exige que todos los dorsales de ese censo estén resueltos.

`belgiancycling-results-fetch.mjs` vigila el PDF oficial estable `CODE-U.pdf` de
Belgian Cycling. Distingue el marcador previo a la publicación del resultado
definitivo y extrae clasificados, DNS, DNF, OTL y DSQ, incluidos los clubes
amateurs impresos sin código UCI de equipo. La fecha impresa puede
llevar errata de un día; con `--date`, un desfase de hasta un día se avisa y se
normaliza a la fecha de la jornada, y más de un día se rechaza. El cron lo activa con
`race_uci_links.source='belgiancycling'` y `belgianCyclingCode=<código con año>`.

`belgiancycling-startlist-fetch.mjs` y `belgiancycling-startlists-sync.mjs`
constituyen el carril de inscritos de la misma federación, **retirado del VPS
el 2026-09-18** por falta de fiabilidad: el PDF no aporta UCI ID ni país y cada
lista generaba excepciones de identidad y de equipo que bloqueaban la
aplicación. Los scripts permanecen como herramienta manual — el fetcher vuelca
el documento sin tocar la BD y la aplicación corre con
`prepare_startlist_import` + `apply_startlist_import` (con overrides de riders
por dorsal y teams por índice) desde MCP, resolviendo las excepciones a mano.
El fetcher analiza por coordenadas con `pdftotext -bbox-layout` (bloques de
equipos en columnas variables por edición, línea `PL/DS`, dorsales en el
Partants y sin ellos en el Engagements provisional), valida edición, fecha
(misma tolerancia de un día) y recuento, y exige dorsales únicos y positivos.
El extractor manual con `--patch` para nombres recortados sigue en
`scripts/data-preflight/`.

`colombia-pdf-results-fetch.mjs` vigila la página de una prueba en
`clasificacionesdelciclismocolombiano.com`, descubre los PDFs de cada etapa y
extrae llegada, general, puntos/regularidad, montaña, jóvenes, equipos e IRM.
Para la Clásica Azuero 2026 se configura
`race_uci_links.source='colombia'` junto a
`colombiaCode='clasica-azuero-2026'`; el cron pasa el año de la carrera para
rechazar accidentalmente un PDF de otra edición. La carrera tiene dos etapas,
por lo que no se usa `--one-day`. Si la página ya enlaza el PDF solicitado pero
ninguno de sus cuadros puede interpretarse, el proceso termina con error en vez de
presentarlo al watcher como una fuente todavía vacía.
La fecha de edición se lee en la primera página con texto (Word exporta a veces
una hoja inicial en blanco): `Fecha : dd/mm/aa`,
`02.SEPT.2026` o la portada de Word en letra (`12 DE AGOSTO DE 2026`), con o
sin día de la semana (`LUNES 5 DE OCTUBRE DE 2026`). Si ese día contradice la
fecha, la portada se descarta y rige el `Fecha :` de la página siguiente. Los
retiros y fueras de control que solo publica el boletín del jurado de comisarios
(`RETIROS DORSAL 83`, `CORREDORES FUERA DEL LIMITE …: 65 – 84`) se emiten como
DNF y OTL de la llegada. Una etapa
cuyo encabezado anuncia C.R.I., contrarreloj o cronoescalada, o cuya tabla trae
`T.Inter`, se emite con `raceType='ITT'`. Las diferencias se derivan del tiempo
final cuando la fila lo publica; la columna de diferencia solo se usa sin tiempo.

`evodata-results-fetch.mjs` consume la API JSON pública de EvoData CIS. El
`eventId` padre descubre las jornadas y cada una publica llegada, general,
puntos, montaña, jóvenes y equipos. Un evento autónomo, sin padre ni
`subEvents` (campeonatos UEC), es su propia y única jornada. El token público
de aplicación solo vive en memoria. El cron lo activa con
`race_uci_links.source='evodata'` y `evodataCode=<eventId padre o autónomo>`.
En una carrera de un día, los abandonos se leen del `status` de la lista de
salida (1 DNF, 3 DNS, 9 OTL), ausentes de la llegada. Con `status` 0, tras 20
minutos sin nuevas llegadas: `started` sin `finished` = DNF; `started=false`
con `starting` no falso = DNS, si el concurso registra alguna salida. Un dorsal
retirado de la lista de EvoData no se recupera.
Una CRI de un día solo se publica cuando todos los corredores de la lista de
salida con `starting` no falso tienen llegada o IRM; sin lista no se publica.
Completa, se emite con `publication.format='fixed'` y `sourceStatus='official'`
y queda oficial en el mismo volcado, sin la regla de estabilidad.
El relevo mixto UEC (concurso de selecciones con `raceTypeId` 13 y concursos
«Singoli» con los corredores) se publica como el de Tissot: `gc` final con
`raceType='TTT'`, primer dorsal de cada selección con puesto y tiempo absoluto
y compañeros sin puesto, con su tiempo individual si EvoData lo publica.

`manual_timing-results-fetch.mjs` consume el JSON live público de
`timing.example.invalid`. El cron lo activa cada minuto con
`race_uci_links.source='manual_timing'` y `manual_timingCode=<código estable>`, siempre
para la jornada seleccionada. Exige una llegada con filas antes del primer
volcado, omite la general virtual y refresca los puestos firmes durante la ventana.

`raceresult-results-fetch.mjs` admite eventos con varios concursos mediante perfiles
curados por edición. Philadelphia 2026 separa hombres y mujeres dentro del mismo
`raceresultCode`: emite únicamente la clasificación por tiempos y bloquea cualquier
resultado parcial hasta la vuelta 10 masculina, la vuelta 5 femenina o una marca
explícita de meta en la lista live. En una vuelta por etapas, un volcado dirigido con
`--stage N` usa la lista LIVE cuando `N` todavía no está en el selector de la pestaña
"results" (race|result lo añade al publicar la oficial, minutos después de meta);
solo la acepta si la fecha del cabecero coincide con `--date`, y toma del grupo de
meta los finishers más los IRM explícitos, descartando los parciales sin puesto. Las
generales oficiales (GC, puntos, montaña, jóvenes y equipos) se piden con el selector
propio de cada lista. En el volcado de la jornada en curso, cuando Results aún no
tiene puntos o montaña, se usan sus listas LIVE acumuladas si fecha, columnas,
puestos y dorsales son válidos. GC, jóvenes y equipos esperan a Results. En la
última jornada el cron añade `--final` junto a `--stage N`: el fetcher emite la
pseudo-etapa «Final Classification» con los acumulados de Results aunque
race|result todavía no marque `EventOver`; los acumulados LIVE provisionales no
forman la final y un `--stage` intermedio sobre una carrera terminada no la abre. Las
pruebas de racetiming.ca (Gatineau 2026)
usan perfiles propios: el mismo cronometrador publica el tiempo en meta con
centésimas y, en la crono, una lista de progreso por parciales que impide volcar
hasta que termina el último corredor en salir.

`chronohr-results-fetch.mjs` consume los HTML públicos de CH:RO:NO. Parte del
índice de la carrera, descubre la portada real de cada jornada y después los
cuadros publicados, sin presuponer prefijos de archivo. Las etiquetas `1st-a` y
`1st-b` determinan el sector. El cron lo activa cada minuto con
`race_uci_links.source='chronohr'` y `chronoHrCode=<YYYYMMDD_slug>`; vuelve a leer
la jornada durante toda la ventana porque llegada, generales y correcciones se
publican progresivamente.

`istanbul-results-fetch.mjs` vigila la página oficial estable de resultados del
Tour of Istanbul y descubre el dossier PDF publicado para cada etapa. Extrae
llegada, general, puntos, montaña, jóvenes, equipos e IRM; rechaza un PDF de otro
año, fecha o etapa. El cron lo activa con `race_uci_links.source='istanbul'` y usa
el año y las jornadas de la propia carrera, sin código adicional por proveedor.

`livetiming-results-fetch.mjs` incorpora el dossier oficial de Computerauswertung
para Sauerlandrundfahrt 2026. Prefiere los PDF publicados y utiliza el live mientras
no exista PDF, comprobando carrera, etapa y fecha. Conserva el enlace
`source='livetiming'`, `livetimingCode='260903'` y los identificadores de la carga
manual previa. La CRI conserva las diferencias publicadas antes de truncar las
centésimas; los PDF requieren `pdftotext`, ya instalado en el VPS.

`southbohemia-results-fetch.mjs` descubre los dossiers publicados por etapa en la
página oficial del Tour of South Bohemia. El cron usa `source='southbohemia'`, el
año de la carrera y las fechas de sus jornadas. Comprueba edición, fecha, etapa,
puestos, dorsales, IRM y los totales publicados; conserva los tiempos del jurado
sin reordenar la llegada. Jóvenes deriva de la general y de la elegibilidad U23
marcada en el dossier, conforme al reglamento oficial. La clasificación final se
publica exclusivamente desde el dossier de la última etapa.

`atresults-results-fetch.mjs` lee los dossiers PDF por etapa de AT Results
Service en `atresult.synology.me/PDF/<carpeta>/<prefijo> Results Stage N.pdf`.
Valida proveedor, etapa, edición y fecha; extrae llegada con IRM y recuento del
jurado, general, puntos, montaña y equipos. La general y los equipos cortan al
reaparecer un puesto 1 aunque falte el encabezado del cuadro siguiente. El cron
lo activa con `race_uci_links.source='atresults'` y `atresultsCode=<carpeta>/<prefijo>`.

`mikatiming-results-fetch.mjs` lee el listado HTML de un evento de mika:timing
(`<host>/<edición>/?pid=list&event=<evento>`, 100 filas por página) y la ficha
del ganador. Emite la clasificación de un día con dorsal, puesto y tiempo.
Valida que el evento figure en el selector de la edición y descarta la
simulación previa a la carrera contrastando la hora de llegada con la fecha y
la salida programadas de la jornada. El cron lo activa con
`race_uci_links.source='mikatiming'` y `mikatimingCode=<host>/<edición>/<evento>`,
y lo relee dentro de la ventana mientras llegan corredores.

`ficr-results-fetch.mjs` lee la API JSON de FICR (`apiciclismo.ficr.it/CIC`)
de una carrera `<año>/<equipo>/<carrera>`: llegada de cada tappa con dorsal,
tiempo y estados de fuera de carrera, y en vueltas las generales de tiempo,
puntos, montaña y equipos. Asigna etapa por fecha (prólogo 0) y sector a las
tappe de una misma fecha, y valida la fecha contra la jornada (en un día
admite la fecha de alta de FICR hasta 3 días antes). El cron lo
activa con `race_uci_links.source='ficr'` y `ficrCode=<año>/<equipo>/<carrera>`,
y lo relee dentro de la ventana mientras llegan corredores.

`lapclip-results-fetch.mjs` lee el listado de vueltas por transpondedor de
LAPCLIP (Matrix Sports, `matrix-sports.jp/lap`) de una categoría
`<evento>/<categoría>/<vueltas>`. Emite la llegada de un día en circuito cuando
el primero completa las vueltas, con regla de grupo de un segundo, y los DNF y
DNS pasado el margen de cierre. Valida la fecha del título de la categoría
contra la jornada. El cron lo activa con `race_uci_links.source='lapclip'` y
`lapclipCode=<evento>/<categoría>/<vueltas>`, y lo relee dentro de la ventana.
