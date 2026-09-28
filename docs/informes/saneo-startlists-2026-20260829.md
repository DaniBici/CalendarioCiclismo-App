# Saneamiento de startlists y fichas 2026 — 2026-08-29

## Alcance y manifiesto

Operación dirigida sobre las carreras de 2026 con startlist. El censo inicial
registró 816 carreras y 51.787 filas de `startlist_riders`. El alcance
prioritario fue `1.1`, `1.2`, `1.2U`, `1.Pro`, `1.UWT`, `1.WWT`, `2.1`, `2.2`,
`2.2U`, `2.Pro`, `2.UWT` y `2.WWT`: 8.345 corredores globales enlazados.

Cada ítem del manifiesto se identificó por la clave global del corredor y, para
snapshots, por la clave estable de fila. Los criterios fueron:

- completar `birthDate` o `nationality` solo cuando la observación DataRide
  fue única y no contradictoria;
- completar `startlist_riders.countryCode` solo desde la ficha global ya
  confirmada, sin sustituir códigos de selección u otras excepciones de fuente;
- mover a `otherNames` el nombre hispano largo y recortar a nombre de uso más
  un apellido solo con la regla de alta confianza del runbook de saneamiento;
- conservar como pendientes las colisiones, homónimos, transliteraciones,
  fichas sin catálogo y observaciones sin confirmación.

La evidencia UCI se obtuvo mediante los enlaces existentes de DataRide y se
cruzó por `competitionId`, `uciRaceId`, dorsal, sexo y clave global. El lote
incluyó 260 competiciones, 5.923 filas de cruce, 5.657 con observación de
datos y 266 sin observación. De las 2.522 fichas observadas, 49 presentaron
conflictos; no se aplicó automáticamente ningún campo conflictivo. Como
segunda consulta se recuperaron 83 competiciones UCI positivas vinculadas a
la cola de fechas, usando `scripts/results-fetchers/dataride-results-fetch.mjs`.

## Cambios aplicados

- Se aplicaron 2.479 actualizaciones aceptadas en fichas globales. El efecto
  verificable frente al backup es de 2.393 fechas de nacimiento y 686
  nacionalidades completadas; los valores existentes no se sobrescribieron.
- Se completaron 814 snapshots de `startlist_riders.countryCode` cuando el
  código global era suficiente y el snapshot estaba vacío.
- Se normalizaron 32 fichas hispanas no verificadas. El nombre largo original
  quedó en `otherNames`, se preservaron nombres compuestos lógicos y se
  crearon 32 aliases de identidad. Una candidata con partícula (`Juan del
  Rosario`) fue revertida durante el preflight y no forma parte del resultado
  efectivo.
- Se completaron 410 filas de snapshot con `firstName`/`lastName` vacíos
  cuando la ficha global tenía ambos campos confirmados. En la segunda pasada
  se relocalizaron esas 30 claves globales y sus 215 filas de startlist; las
  123 filas restantes quedaron resueltas y el detector final de snapshots sin
  catálogo devuelve cero.
- Se fusionó la ficha `czapia-justyna` con `czapla-justyna` por coincidencia
  de nombre, fecha, equipo, carrera y dorsal, conservando el alias retirado.
  Se eliminó una fila de startlist de `baldi-p` que identificaba a un director
  de equipo como corredor; la ficha de catálogo se conservó porque mantiene
  una afiliación histórica.
- Se aplicó un lote exacto de 116 filas prioritarias con coincidencia única de
  nombre completo y género contra el catálogo, sin coaparición en la carrera.
- Se hizo una consulta profunda de DataRide para las competiciones `78118`
  (GP de Nogent-sur-Oise), `78386` (Tour Féminin du Burundi) y `77477`
  (Vuelta a Extremadura). Se repuntaron 19 filas de startlist hacia fichas ya
  presentes en resultados UCI: tres de Nogent, quince de Burundi y el dorsal
  97 de Extremadura. Este último estaba vacío y quedó como `Lowie Baeck`,
  `countryCode='be'`, dorsal publicado por DataRide.
- En La Périgord Ladies se contrastó la clasificación publicada y se
  repuntaron siete resultados y seis startlists. Se corrigieron las grafías
  acreditadas de Jule Märkl, Mona Mitterwallner, Astrid Fravalo y Martha
  Stokkeland. `Amelia Tyler` se mantuvo como sustitución real de `Elizabeth
  Lister`: se enlazó el resultado, no la startlist de Lister.
- Se completaron 95 snapshots de `startlist_riders.countryCode` desde la
  nacionalidad global confirmada. Los cuatro snapshots vacíos restantes
  correspondían a las tres fichas `Gebrehiwet` y a `Douwe Boonstra`. Se
  completó el snapshot de Boonstra tras confirmar `nationality='nl'`; quedan
  tres snapshots sin código.
- Se completó `nationality='cd'` en `martiny-muntumba-ditona` a partir de dos
  perfiles ciclistas coincidentes y de su fecha de nacimiento y equipo. El
  snapshot de Tour Féminin du Burundi conserva `countryCode='rw'`; se deja
  como conflicto de procedencia porque `countryCode` puede representar la
  selección o el dato publicado para esa inscripción y no se debe sobrescribir
  sin una fuente específica del evento.
- Se completaron cuatro fechas de nacimiento con UCI ID ya identificado:
  `d-aiuto-filippo` (`2002-03-21`), `kardos-csongor` (`2007-11-20`),
  `tissieres-arnaud` (`1996-05-14`) y `winter-zeno-levi` (`2007-01-26`).
  Las fuentes de contraste fueron [Filippo D'Aiuto](https://example.invalid),
  [Csongor Kardos](https://example.invalid),
  [Arnaud Tissières](https://www.lequipe.fr/fiche/arnaud-tissieres/118388) y
  [Zeno Levi Winter](https://example.invalid).
- La consulta UCI profunda de 83 competiciones aportó 42 fechas adicionales
  para fichas globales existentes, siempre con valor previo nulo y una única
  fecha repetida cuando había más de una clasificación. Se respaldaron y
  actualizaron 21 fichas masculinas y 21 femeninas. `martins-joao` se excluyó:
  la fuente devuelve `2004-03-27` y `2005-05-16` para el mismo identificador.
- Se aplicaron 46 enlaces exactos adicionales y un enlace contextual de
  `Estanislao Calabuig` hacia `calabuig-estanislao`, sin crear fichas nuevas.
  Noa Grellier, Nolan Martineau, Andrei Stetsiv, Francisco Crespí y las filas
  suecas sin candidato inequívoco permanecen pendientes.
- Se completó `boonstra-douwe` con `nationality='nl'` y su snapshot con
  `countryCode='nl'`, respaldados en la operación específica. La evidencia es
  la [ficha de SwABo](https://www.swabo-cyclingteam.nl/renners/), la [ficha de
  equipo 2026](https://example.invalid) y
  la [ficha del corredor](https://example.invalid).
- La primera revisión externa de identidades y fechas añadió seis fechas sin
  sobrescribir valores existentes: Pere Barceló (`2007-05-17`), Amy Addlesee
  (`1998-11-29`), Nicolai Andersen (`2006-01-21`), Muhammad Shahmir Aiman Abd
  Halim (`2000-04-24`), Maya Anthoine (`2005-12-08`) y Laida Hierro
  (`2007-07-31`). Se contrastaron los perfiles de [Pere Barceló](https://example.invalid),
  [Amy Addlesee](https://example.invalid),
  [Nicolai Andersen](https://example.invalid),
  [Shahmir Aiman Abd Halim](https://example.invalid),
  [Maya Anthoine](https://example.invalid) y
  [Laida Hierro Alzola](https://example.invalid)
  con equipos, carreras y, cuando estaba disponible, documentos federativos.
- Se fusionaron dos duplicados externos detectados durante esa revisión. Las
  fichas `abetxuko-andoni` y `lopez-de-abetxuko-andoni` se consolidaron en la
  ficha verificada `jimenez-andoni`, renombrada a `Andoni López de Abetxuko`,
  con las formas completas en `otherNames`, dos aliases y 11 startlists y 48
  resultados concentrados en la ficha superviviente; se repuntaron 3 filas de
  startlist y 8 resultados. `landaluce-eduardo` se consolidó en la ficha
  verificada `perez-landaluce-eduardo`, con 9 startlists y 78 resultados
  concentrados en la ficha superviviente; se repuntó 1 startlist y 6 resultados. La
  evidencia de Andoni incluye la [clasificación federativa portuguesa](https://www.fpciclismo.pt/calendarios_ficheiros/2026/26032026203622anexo_classificacao_etapa2_2PfuuHYZ88qGnWMiUXCGM.pdf),
  [L'Équipe](https://www.lequipe.fr/fiche/andoni-lopez-de-abetxuko/108381) y
  [la plantilla 2026 de Anicolor](https://example.invalid); la de Eduardo,
  [la plantilla 2026 de Óbidos](https://example.invalid) y
  [la ficha federativa de la prueba](https://www.fpciclismo.pt/calendarios_ficheiros/2026/26032026203622anexo_classificacao_etapa2_2PfuuHYZ88qGnWMiUXCGM.pdf).
  Los aliases `abetxuko-andoni` y `andoni-jimenez` evitan recrear la ficha por
  cargas futuras. El backup específico es `season-2026-external-identity-merges-20260829`.
- El detector complementario de `race_uci_results` localizó 1.720 filas de 92
  IDs heredados sin ficha actual. Solo un ID tenía un alias explícito
  (`arda-tekirdag` → `tekirdag-arda`); se repuntó 1 fila con backup. Quedan
  1.719 filas de 91 IDs para una cola separada de cruces por nombre completo,
  UCI ID, carrera y equipo. No se ejecutó un relink masivo por similitud nominal.
- No se modificaron las tres fichas `Gebrehiwet`: la búsqueda externa no
  distingue de forma suficiente a Lemlem, Tigist y Tsega ni acredita su país o
  fecha individualmente. Tampoco se corrigió el conflicto de nacionalidad de
  Amy Addlesee: el catálogo conserva `de`, mientras los perfiles competitivos
  consultados muestran `gb`; queda como contradicción, no como campo ausente.
- Las correcciones anteriores de Clásica Azuero, Tour of Samsun y Tour of
  Bulgaria se conservaron.

## Detectores finales de la primera revisión

Tras las relocalizaciones, fusiones y correcciones de cruces, el alcance
prioritario queda en 47.668 filas: 3 sin `globalRiderId`, 198 corredores
globales únicos sin fecha de nacimiento y 3 sin nacionalidad. Las ausencias
son pendientes explícitos, no valores inferidos. En todo 2026 quedan 25 filas
sin enlace global.

Los detectores de claves `identityKey` duplicadas en hombres y mujeres y de
aliases duplicados devuelven cero. También queda en cero el detector de
dorsales repetidos dentro de la misma carrera y equipo, excluyendo el dorsal
`0` usado en campeonatos contrarreloj sin dorsal publicado. Los nombres de
fuente distintos del nombre global no se trataron como errores salvo cuando
existía evidencia directa de cruce; los snapshots sin nombre de catálogo y los
enlaces a fichas inexistentes quedan en cero.

Este último detector se refiere a `startlist_riders`; el detector equivalente
de `race_uci_results` mantiene 1.719 filas de 91 IDs heredados pendientes, ya
que no se deben crear ni fusionar fichas por similitud nominal aislada.

Los snapshots con `countryCode` vacío son 3 en 2026 y 3 en el alcance
prioritario. Corresponden a Lemlem, Tigist y Tsega Gebrehiwet, cuyas fichas
globales tampoco tienen nacionalidad confirmada.

## Pendientes de la primera revisión

- 49 fichas con fechas o nacionalidades contradictorias en DataRide.
- 266 cruces sin observación DataRide en el censo inicial; este contador no se
  interpreta como número directo de filas de startlist pendientes.
- 198 fechas y 3 nacionalidades aún ausentes en el alcance prioritario. La
  extracción UCI permitió completar 42 fechas adicionales y la primera revisión
  externa otras seis; las restantes requieren una fuente específica o revisión
  manual.
- 3 filas prioritarias sin enlace global y 25 en el conjunto completo de 2026:
  Noa Grellier y Nolan Martineau, sin resultado UCI coincidente en Nogent, y
  Elizabeth Lister, cuya ausencia en el resultado de La Périgord está explicada
  por la sustitución confirmada por Amelia Tyler.
- 3 snapshots sin `countryCode`, ligados a las tres fichas `Gebrehiwet` sin
  nacionalidad confirmada. El artículo de [Team Africa Rising sobre Chambéry]
  (https://teamafricarising.org/african-womens-cycling/) confirma que Amani
  fue retirada de la lista, pero no identifica de forma individual el país de
  las tres fichas; no se infiere por el nombre del equipo.
- `gebrehiwet-lemlem`, `gebrehiwet-tigist` y `gebrehiwet-tsega` siguen
  pendientes de nacionalidad y fecha. `boonstra-douwe` ya está corregido a
  Países Bajos.
- `martins-joao` queda pendiente por conflicto de fechas UCI; no se
  sobrescribe ninguna de las dos posibilidades.
- `martiny-muntumba-ditona` ya tiene `nationality='cd'`; queda pendiente
  resolver manualmente el conflicto del snapshot `countryCode='rw'`.

Se repararon cruces inequívocos de resultados contra dorsal y nombre de fuente
en cinco casos, sin alterar puestos, tiempos ni textos: Robin Kull, Jakob
Neumann (dos carreras), Esteban Sorli y José María García Soriano. También se
corrigieron dos dorsales de startlist confirmados por las listas oficiales:
Martijn Rasenberg pasó de 53 a 54 en Circuito de Valonia y Julia Kopecký de 14
a 13 en París-Roubaix femenina.

Los homónimos se mantienen separados. En particular, `fernandez-garcia-samuel`
es Samuel Fernández García, de Caja Rural-Seguros RGA (nacido el 11/07/2003),
y `fernandez-heres-samuel` es Samuel Fernández Heres, de Euskaltel-Euskadi
(nacido el 14/05/2003). El corredor del dorsal 43 del Czech Tour corresponde a
Caja Rural; la ficha de Euskaltel no se fusionó ni se modificó.

Los pendientes requieren revisión manual por corredor y no autorizan una
fusión por similitud de nombre, equipo o dorsal. La clasificación publicada de
La Périgord usada en esta pasada es
`https://example.invalid

## Segunda revisión externa y cierre operativo — 2026-08-29

La segunda pasada se ejecutó sobre el estado actual de la base, después de las
ingestas posteriores al primer censo. Se conservaron las correcciones previas y
se corrigieron las regresiones detectadas:

- Se repuntaron 116 resultados de las claves de ingesta
  `saizonou-kpikpassou-exodu`, `saizonou-jesugnon-glorad`,
  `gandaho-maurice-coffi-char` y `attai-kocou-corneil` a las fichas
  `saizonou-exodus`, `saizonou-glorad`, `gandaho-charbel` y `attai-corneil`.
  Se añadieron aliases persistentes para impedir que una nueva ingesta vuelva a
  crear esas claves. El PDF de resultados de [Tour du Bénin 2026]
  (https://example.invalid) y las
  fichas de [Glorad Saizonou]
  (https://example.invalid), [Charbel Gandaho]
  (https://example.invalid) y [Corneil Attai]
  (https://example.invalid) confirman las
  correspondencias, fechas y nacionalidad beninesa.
- Se corrigió la única fila que volvió a entrar como `bocke-stein` a
  `bocxe-stein`, preservando la ficha verificada de Stein Bocxe y su alias.
- Se completaron 16 snapshots prioritarias sin `countryCode` a partir de la
  nacionalidad global de la ficha enlazada. Permanecen solo las tres filas de
  `gebrehiwet-lemlem`, `gebrehiwet-tigist` y `gebrehiwet-tsega`; no se asigna
  país ni fecha por compartir apellido o por pertenecer al mismo bloque de
  equipo.
- Se completó `dupont-jeanne.birthDate` con `2002-10-02`, según el perfil de
  [Team Belgium](https://www.teambelgium.be/atleten/Jeanne-Dupont-692), y se
  conservaron las seis fichas de nombres completos contrastados en
  `otherNames`: Del Rosario, Leon, Tijani, Berastegi, Sánchez y Restituyo.

Los detectores posteriores al lote devuelven 47.814 filas prioritarias y 8.359
fichas globales enlazadas. En esta continuación se completaron siete fechas
adicionales: `cerquetella-carlo` (`2006-01-07`), `del-rosario-juan`
(`2001-08-18`), `bessiere-maina` (`2006-10-24`), `menendez-linda`
(`2001-12-30`), `posada-maria` (`1996-06-18`), `pedersen-carl`
(`2006-01-16`) y `der-werf-sven` (`2004-11-16`). Quedan 26 fichas prioritarias
sin fecha de nacimiento:
`dias-bento`, `duffy-kane`, `jamian-mohamad-iezuan`, `leon-daniel`,
`macedo-andre`, `moreira-vieira-daniel-filipe`, `murphy-alex`, `oliveira-david`,
`orsi-riccardo`, `saunders-samuel`, `stenhaug-gustav-kjall`, `tijani-quwam`,
`becker-lena`, `berastegi-ane`, `brindle-joy-lily`, `buannic-guirriec-louise`,
`corraboeuf-lea`, `docx-katja`, `gebrehiwet-lemlem`, `gebrehiwet-tigist`,
`gebrehiwet-tsega`, `georges-louisemene`, `restituyo-raquel`, `ros-leonie`,
`sanchez-ivette` y `torreguitart-jenni`.

Las fuentes de las fechas completadas son la [lista FCI de Carlo Cerquetella]
(https://www.italciclismo.it/wp-content/uploads/2024/04/Trofeo-Citt%C3%A0-di-Manoppello-01052024-elenco-iscritti.pdf),
los perfiles [fuente externa de Juan Carlos del Rosario]
(https://example.invalid) y [Sven
van der Werf](https://example.invalid), y las
listas fuente externa con UCI de [Maïna Bessiere]
(https://example.invalid),
[Linda Menendez](https://example.invalid),
[María Paula Posada](https://example.invalid)
y [Carl Emil Pedersen](https://example.invalid).

La nacionalidad ausente queda limitada a las tres fichas `Gebrehiwet`. Los
snapshots sin `countryCode` son exactamente los tres de esas fichas en el Grand
Prix Féminin de Chambéry; las listas publicadas consultadas no las contienen y
no permiten atribuir país individual. Los enlaces no nulos de `startlist_riders`
y `race_uci_results` están completos: el detector devuelve cero filas con una
clave no nula sin ficha global. Los 7.589 resultados de 2026 con
`globalRiderId` nulo se mantienen fuera de ese detector: 1.721 llevan dorsal y
5.868 no lo llevan, y requieren separar primero resultados de corredores,
equipos y clasificaciones antes de autorizar un relink. El cruce exacto de
carrera, dorsal y nombre no aporta más candidatos después de Rasmus Käll; no se
asignaron fichas por similitud nominal.

Se corrigió además la fila de startlist del dorsal 213 de Durango-Durango
Emakumeen Saria, que identificaba a `sanz-de-galdeano-lur` cuando el resultado
oficial corresponde a Amara Sanz de Galdeano Peñalver. La ficha se repuntó a
`sanz-de-galdeano-penalver-amara` y se registró alias para la forma errónea. La
fuente es el [resultado de Durango-Durango 2026]
(https://example.invalid).
También se fusionó `marmoni-solene` con `marnoni-solene`: la ficha superviviente
tiene UCI ID `717697`, fecha `2004-06-21` y referencias de la carrera; se
conservó alias para la errata. Véanse el [perfil fuente externa de Solène Marnoni]
(https://example.invalid) y su [perfil de
fuente externa](https://example.invalid).

La revisión nominal detectó seis colisiones de nombre exacto. Se mantienen
separadas `João Almeida` profesional y `João Almeida` sub23 sin UCI, los dos
`João Silva`, los dos `Matthew Walls`, los dos `Pedro Pinto` y los dos `Rafael
Reis`, porque presentan UCI, nacionalidad, fecha o contexto incompatibles. Se
fusionó únicamente `batsaikhan-tegshbayar` con `batsaikhan-tegsh-bayar`: la
variante del resultado del Campeonato de Mongolia CRI tiene la misma fecha,
nacionalidad y UCI ID `10014871696`; la [ficha fuente externa de Tegshbayar Batsaikhan]
(https://example.invalid) confirma la
identidad. Andoni López de Abetxuko ya figura como una única ficha canónica, y
Samuel Fernández de Caja Rural y Samuel Fernández de Euskaltel siguen separados.

## Tercera revisión externa y cierre de enlaces inequívocos — 2026-08-29

Se completaron tres lotes adicionales con preflight, copia íntegra de las filas
afectadas y detector posterior:

- `season-2026-external-identity-andrei-crespi-20260829-v81`: se vinculó la
  fila del dorsal 90 del Campeonato de España línea sub23 a
  `crespi-rios-francisco`. La ficha se normalizó a `Francisco Crespi Ros`, se
  conservó la forma recibida `Francisco Crespi Rios` en `otherNames` y se
  completó `2005-07-25`. La correspondencia está respaldada por los perfiles de
  [fuente externa](https://example.invalid), [El Pelotón]
  (https://elpeloton.net/ciclista/francisco-crespi-ros/) y resultados de
  [AEDeca](https://aedeca.net/index.php/competiciones/temporada-2026/clasificaciones-carreras/clasificacion-vuelta-al-guadalentin-2026).
  La fila del dorsal 21, Andrei Stetsiv, se vinculó al perfil existente
  `stetsiv-stetsiv-andrei` y se corrigió su apellido a `Stetsiv`; no se inventó
  fecha ni UCI.
- `season-2026-swedish-itt-global-links-20260829-v82`: se crearon 20 perfiles
  provisionales para los tres corredores del CRI femenino y 17 del CRI
  masculino del Campeonato de Suecia 2026. Se enlazaron las 20 startlists y
  sus 20 resultados por nombre y dorsal coincidentes. La nacionalidad `se` se
  tomó del contexto del campeonato; fecha, UCI e identidad fuera de esa prueba
  permanecen sin confirmar y `verified=false`. La competición y su marco
  temporal constan en el [calendario oficial de la SCF]
  (https://scf.se/landsvag/sm-linje-och-tempo-2026/); la clasificación externa
  de [WielerStats](https://www.wielerstats.nl/race-result/national-championships-sweden-me-itt-2?year=2026)
  confirma la nomenclatura de la prueba y de sus participantes.
- `season-2026-result-exact-crossings-20260829-v83`: se enlazaron 16 resultados
  sin `globalRiderId` de los campeonatos de Estados Unidos CRI, todos con nombre
  exacto, nacionalidad coincidente y ficha global previa con referencias. No se
  crearon startlists ni se modificaron candidatos con nacionalidad incompatible.

El detector final devuelve 52.039 filas de startlist de 2026, 0 filas sin
`globalRiderId` y 0 referencias no resolubles en startlists o resultados. En el
alcance operativo .1/.2/U (todo 2026 excepto `CN`) hay 47.921 filas, 8.361
fichas globales, 26 fichas sin fecha de nacimiento, 3 fichas sin nacionalidad y
3 snapshots sin `countryCode`. Las tres snapshots restantes son los dorsales
71, 73 y 75 de `gebrehiwet-tigist`, `gebrehiwet-tsega` y
`gebrehiwet-lemlem` en el Grand Prix Féminin de Chambéry. Las consultas de
[fuente externa Chambéry](https://example.invalid)
y del [roster femenino de Amani](https://www.teamamani.com/womens-team-amani-roster)
no permiten atribuir país individual; permanecen pendientes.

Los campeonatos nacionales se auditan aparte: suman 4.118 filas y 637 fichas
sin fecha de nacimiento, sin nacionalidades ausentes. Es una cola diferenciada
porque combina élite, sub23, junior, masters y federaciones con calendarios y
formatos de identificación distintos. No se rellenan fechas por edad mostrada,
año de nacimiento, equipo o coincidencia nominal.

La cola de resultados 2026 sin ficha global queda en 6.994 filas, de las que
1.126 llevan dorsal; incluye agrupadores, clasificaciones y resultados sin
identificador de corredor. Los cruces nominales exactos que además tenían
contexto nacional inequívoco se aplicaron en v83; los restantes requieren UCI,
organizador o revisión individual. No quedan claves `identityKey` ni aliases
duplicados, y los homónimos documentados —incluidos los dos Samuel Fernández,
los dos João Silva y los dos Pedro Pinto— siguen separados.

Los aliases y las fusiones se comprobaron junto con las claves de identidad:
no quedan `identityKey` duplicadas ni aliases duplicados. Se mantienen separados
los homónimos y los conflictos documentados, incluidos Samuel Fernández de Caja
Rural y Samuel Fernández de Euskaltel, y no se fusionaron Katja Docx con Mieke
Docx.

El backup de este cierre es `season-2026-external-identity-repairs-20260829-v66`,
`season-2026-snapshot-countrycodes-20260829-v2`,
`season-2026-external-birthdates-20260829-v67`,
`season-2026-external-name-enrichment-20260829-v68`,
`season-2026-external-birthdates-20260829-v69`,
`season-2026-external-identity-merges-20260829-v70`,
`season-2026-external-birthdates-20260829-v71`,
`season-2026-result-exact-crossings-20260829-v72`,
`season-2026-external-identity-merges-20260829-v73`,
`season-2026-external-birthdates-20260829-v74` y
`season-2026-external-identity-merges-20260829-v75`.

## Backup y recuperación

La tabla privada de backup es
`private.repair_season_2026_rider_enrichment_backup`, creada por la migración
`20260829150000_season_2026_rider_enrichment_backup.sql`. Las operaciones son:

- `season-2026-uci-enrichment-20260829`;
- `season-2026-hispanic-names-20260829`;
- `season-2026-snapshot-names-20260829`;
- `season-2026-dangling-relinks-20260829`;
- `season-2026-samuel-relink-20260829`;
- `season-2026-manual-evidence-20260829`;
- `season-2026-czapia-relink-20260829`;
- `season-2026-manual-nationality-20260829`;
- `season-2026-result-crossings-20260829`;
- `season-2026-startlist-dorsals-20260829`;
- `season-2026-startlist-uci-exact-relinks-20260829` (116 startlists);
- `season-2026-uci-deep-startlist-relinks-20260829` (19 startlists);
- `season-2026-uci-deep-perigord-relinks-20260829` (6 startlists y 7
  resultados).
- `season-2026-snapshot-countrycode-20260829` (95 snapshots).
- `season-2026-rider-attributes-20260829` (cinco fichas).
- `season-2026-startlist-exact-relinks-20260829-v2` (46 startlists).
- `season-2026-startlist-contextual-relinks-20260829` (1 startlist).
- `season-2026-uci-birthdates-20260829` (21 fichas).
- `season-2026-uci-birthdates-20260829-v2` (21 fichas).
- `season-2026-boonstra-nationality-20260829` (1 ficha y 1 snapshot).
- `season-2026-external-identity-merges-20260829` (4 fichas, 4 startlists y
  14 resultados).
- `season-2026-external-birthdates-20260829` (1 ficha).
- `season-2026-external-birthdates-20260829-v2` (2 fichas).
- `season-2026-external-birthdates-20260829-v3` (3 fichas).
- `season-2026-result-alias-relinks-20260829` (1 resultado).
- `season-2026-external-identity-repairs-20260829-v66` (116 resultados y 1
  startlist).
- `season-2026-snapshot-countrycodes-20260829-v2` (16 snapshots).
- `season-2026-external-birthdates-20260829-v67` (1 ficha).
- `season-2026-external-name-enrichment-20260829-v68` (6 fichas).
- `season-2026-external-birthdates-20260829-v69` (5 fichas).
- `season-2026-external-identity-merges-20260829-v70` (2 fichas, 1 startlist y
  1 resultado).
- `season-2026-external-birthdates-20260829-v71` (1 ficha).
- `season-2026-result-exact-crossings-20260829-v72` (1 resultado).
- `season-2026-external-identity-merges-20260829-v73` (2 fichas y 1 startlist).
- `season-2026-external-birthdates-20260829-v74` (1 ficha).
- `season-2026-external-identity-merges-20260829-v75` (2 fichas y 1 resultado).
- `season-2026-external-identity-andrei-crespi-20260829-v81` (2 fichas y 2
  startlists).
- `season-2026-swedish-itt-global-links-20260829-v82` (20 startlists y 20
  resultados; 20 fichas nuevas).
- `season-2026-result-exact-crossings-20260829-v83` (16 resultados).
- `season-2026-result-exact-national-championship-relinks-20260829-v84` (37
  resultados).
- `season-2026-external-birthdate-gustav-stenhaug-20260829-v85` (1 ficha).
- `season-2026-external-identity-merges-20260829-v86` (3 fichas y 3
  startlists).
- `season-2026-result-substitution-parkhomiuk-20260829-v87` (1 resultado).
- `season-2026-result-exact-national-championship-relinks-20260829-v88` (1
  resultado).

La tabla no tiene acceso para `PUBLIC`, `anon` ni `authenticated`. No se
regeneraron páginas: startlists y fichas se leen en vivo desde Supabase.

## Continuación concurrente del saneamiento — v84-v88 — 2026-08-29

El VPS continuó procesando resultados DataRide de Campeonatos Nacionales que no
estaban incluidos en el primer censo. Los recuentos de esta sección son lecturas
de una base mutable y no sustituyen a los recuentos históricos de las secciones
anteriores.

- `season-2026-result-exact-national-championship-relinks-20260829-v84`:
  se enlazaron 37 resultados CN con ficha global ya existente. El criterio fue
  nombre completo exacto normalizado, sexo de la carrera, nacionalidad compatible
  con el país del campeonato y candidato único en el catálogo; no había otro
  corredor enlazado al mismo candidato en la carrera. Se incluyeron 14 filas
  australianas, una colombiana, cuatro neozelandesas, seis sudafricanas, dos
  chilenas, dos griegas, cuatro estonias, dos japonesas y tres salvadoreñas.
  Quedaron fuera cinco filas con conflicto explícito de nacionalidad: William
  Holmes (dos resultados AU frente a ficha `gb`), Georgia Simpson (NZ frente a
  ficha `gb`) y Dylan Rawson (dos resultados NZ frente a ficha `au`). No se
  enlazaron por similitud débil ni se alteraron campos deportivos.
- `season-2026-external-birthdate-gustav-stenhaug-20260829-v85`: se completó
  `stenhaug-gustav-kjall.birthDate='2005-06-10'`. La fecha y la identidad se
  contrastaron en [Ratsit](https://www.ratsit.se/20050610-Gustav_Karl_Georg_Kjall_Stenhaug_Bunkeflostrand/Soe61_KFTvecwnsIFuCsQeyAeD1xzV-D3KXhmCrhtBk),
  la [Federación Sueca](https://scf.se/landsvag/mycket-intressanta-sm-linjelopp-vantar-runt-balinge-i-helgen/)
  y [fuente externa](https://example.invalid). No se
  sobrescribió ningún valor existente.
- `season-2026-external-identity-merges-20260829-v86`: se fusionaron, tras
  revisar carreras, dorsales, equipos y posibles homónimos, `duffy-kane` en
  `duffy-joshua`, `saunders-samuel` en `saunders-tristan` y
  `brindle-joy-lily` en `brindle-lily`. Se respaldaron tres fichas antiguas y
  tres snapshots, se repuntaron sus referencias y se registraron aliases
  persistentes. [Team Brennan](https://www.brennanit.com.au/our-company/brennan-cycling/),
  [fuente externa](https://example.invalid),
  [fuente externa de Tristan Saunders](https://example.invalid),
  [fuente externa de Lily Brindle](https://example.invalid) y el
  [resultado UCI de Trofeo Oro in Euro](https://www.italciclismo.it/wp-content/uploads/2026/03/ORD-ARR-ORO-IN-EURO-2026.pdf)
  sustentan las correspondencias. No hubo carreras compartidas entre las fichas
  fusionadas y las supervivientes. Samuel Fernández de Caja Rural y Samuel
  Fernández de Euskaltel, Pedro Pinto profesional y sub23, João Silva y João
  Almeida incompatibles, y Andoni López de Abetxuko se mantuvieron según las
  reglas de separación de homónimos.
- `season-2026-result-substitution-parkhomiuk-20260829-v87`: se corrigió el
  resultado `race_uci_results.id=197420`, dorsal 205 del GP Mazda Schelkens, de
  `brindle-lily` a `parkhomiuk-viktoriia`. El resultado publicado identifica a
  Viktoriia Parkhomiuk; el dorsal 205 de la startlist sigue siendo Lily Brindle
  porque la discrepancia es una sustitución de resultado y no una prueba para
  reescribir la inscripción.
- `season-2026-result-exact-national-championship-relinks-20260829-v88`:
  se enlazó el resultado `id=690581`, dorsal 67 del Campeonato de Sudáfrica
  femenino, a `le-roux-maude-elaine`. La coincidencia completa y única de nombre
  y país se verificó con la ficha UCI de [Maude Elaine Le Roux](https://www.uci.org/rider-details/1251764),
  que publica RSA y `22.01.1997`; el backup contiene una fila y el cambio no
  altera puesto, tiempo, dorsal ni texto de origen.

El preflight posterior a estos lotes registra 52.147 filas de startlist 2026,
0 sin `globalRiderId`, 300.162 resultados, 6.956 resultados sin enlace global y
1.088 de estos con dorsal. La ingesta del VPS puede modificar estos tres últimos
recuentos. Los detectores de referencias no resolubles devuelven cero en
`race_uci_results` y `startlist_riders`; las claves `identityKey` y aliases
duplicados también devuelven cero.

La cola prioritaria no-CN conserva 22 fechas de nacimiento ausentes: hombres
`dias-bento`, `jamian-mohamad-iezuan`, `leon-daniel`, `macedo-andre`,
`moreira-vieira-daniel-filipe`, `murphy-alex`, `oliveira-david`, `orsi-riccardo`
y `tijani-quwam`; mujeres `becker-lena`, `berastegi-ane`,
`buannic-guirriec-louise`, `corraboeuf-lea`, `docx-katja`,
`gebrehiwet-lemlem`, `gebrehiwet-tigist`, `gebrehiwet-tsega`,
`georges-louisemene`, `restituyo-raquel`, `ros-leonie`, `sanchez-ivette` y
`torreguitart-jenni`. Las búsquedas en UCI, federaciones, organizadores y
perfiles de equipos no aportaron una fecha exacta verificable para esos casos;
se rechazaron coincidencias con atletas de otras disciplinas y fechas derivadas
de edad o año. Las tres nacionalidades ausentes siguen limitadas a las fichas
`Gebrehiwet`; sus tres snapshots de Chambéry siguen sin `countryCode`. Team
Amani, Team Africa Rising, la FFC y la clasificación del [Grand Prix Féminin de
Chambéry](https://competitions.ffc.fr/calendrier/competition/2026/4173001004/grand-prix-feminin-de-chambery/)
no identifican individualmente el país de Lemlem, Tigist y Tsega, por lo que no
se infiere desde la licencia del equipo.

La cola CN cambió por la ingesta concurrente: la lectura más reciente cuenta
5.715 perfiles distintos enlazados desde resultados o startlists CN y 922 sin
`birthDate`, frente a los 637 del primer censo. El incremento es de alcance,
no una regresión de fechas ya verificadas. La cola se mantiene por lotes de
fuente suficiente; no se rellenan fechas desde edad, año, equipo o coincidencia
nominal aislada. El cruce exacto posterior a v88 no deja candidatos adicionales
con nombre, sexo y país compatibles; permanecen cuatro filas con conflicto de
nacionalidad: William Holmes (dos resultados AU frente a ficha `gb`), Dylan
Rawson (NZ frente a ficha `au`) y Georgia Simpson (NZ frente a ficha `gb`).

## Continuación estable tras DataRide — 2026-08-30

La comprobación de estabilidad del VPS se hizo con dos lecturas separadas: el
total permaneció en 52.790 startlists 2026, la última fila se creó a las
05:28:11 UTC y no hubo altas durante los 15 minutos anteriores a la segunda
lectura. Las escrituras siguientes fueron dirigidas y llevaron preflight,
backup privado y verificador en la misma transacción.

- `season-2026-dob-20260830-01`: se completaron cinco fechas exactas en fichas
  masculinas: Magnus Denwood (`2007-11-16`, [fuente externa](https://example.invalid)),
  Alexander Jonathan Guatibonza Becerra (`2004-06-01`, [Sito del Ciclismo](https://sitodelciclismo.com/coureurfiche.php?coureurid=163790)
  y [VeloStatistics](https://velostatistics.azurewebsites.net/renners/jonathan-alexander-guatibonza-becerra/)),
  Edgar Laurensot (`2004-02-05`, [fuente externa](https://example.invalid)),
  Thomas Portsmouth (`2001-12-19`, [fuente externa](https://example.invalid),
  [L'Équipe](https://www.lequipe.fr/fiche/tom-portsmouth/111282) y [fuente externa](https://example.invalid))
  y Alain Suarez Fernández (`2003-02-12`, [fuente externa](https://example.invalid),
  [fuente externa](https://example.invalid),
  [WielerFlits](https://www.wielerflits.nl/profiel/alain-suarez-fernandez) y [RFEC](https://rfec.com/index.php/smartweb/inscripcionescursos/pagar/42015)).
  No se alteraron nacionalidades ni identidades.
- `season-2026-unlink-cross-gender-20260830-03`: se eliminó el enlace global de
  una sola fila, `sruci_60d77c4713b84d4039f01f10c189ed27`, dorsal 97 de la
  Vuelta a Extremadura Femenina. La fila decía Lowie Baeck, pero apuntaba a la
  ficha masculina `baeck-lowie` y al equipo `TEAM ABADIE MAGNAN`; la ficha
  masculina está confirmada como belga, nacida el 7-10-2007 y aparece en el
  equipo masculino Coppi-Boburo. No existe candidata femenina inequívoca: la
  fila queda pendiente con `globalRiderId=NULL` y no se borró.
- `season-2026-cn-dob-20260830-04`: se completaron tres fechas exactas de la
  cola CN: Iver Tildheim Andersen (`2000-09-29`, identidad de carretera UCI
  `1750181` contrastada con [UCI](https://www.uci.org/rider-details/1750181) y
  [FIS](https://www.fis-ski.com/DB/general/athlete-biography.html?competitorid=214879&sectorcode=cc)),
  Georgia Lancaster (`2005-05-23`, [fuente externa](https://example.invalid))
  y Julie Abrahamsen (`1998-07-11`, [fuente externa](https://example.invalid)).
- `season-2026-relink-dangling-20260830-05`: se repuntaron 137 resultados a
  fichas canónicas existentes y se crearon cuatro aliases persistentes:
  `aranburu-alex` → `aranburu-deba-alex`,
  `chaves-torres-jhonatan-steven` → `chaves-jhonatan`,
  `quiroz-ayala-oscar-adalberto` → `quiroz-oscar` y
  `gordillo-sanchez-ronaldo-emerson` → `gordillo-emerson`. Se completaron en
  `otherNames` los nombres completos de Chaves, Quiroz y Gordillo. Las
  correspondencias se sustentan en [DataRide/UCI de Alex Aranburu](https://dataride.uci.ch/iframe/RiderRankingDetails/422863?baseRankingTypeId=3&categoryId=22&countryId=63&disciplineId=10&disciplineSeasonId=464&groupId=1&momentId=199842&raceTypeId=0&rankingId=1&teamId=0),
  la [Federación Colombiana de Ciclismo para Chaves](https://federacioncolombianadeciclismo.com/jhonatan-chaves-brillo-y-se-alzo-con-la-vuelta-del-futuro-coldeportes-2017/),
  [fuente externa de Quiroz](https://example.invalid),
  [fuente externa de Nu Colombia](https://example.invalid),
  [fuente externa del CN sub23](https://example.invalid) y [FCC](https://federacioncolombianadeciclismo.com/wp-content/uploads/2021/12/CLASIFICACION-CUARTA-ETAPA-FUTURO-2021.pdf).
- `season-2026-dob-20260830-06`: se completaron Alex Murphy (`2006-08-17`,
  [fuente externa](https://example.invalid) y [British Continental](https://stats.thebritishcontinental.co.uk/riders/alex-murphy))
  y Quwam Afolajomi Tijani (`2005-12-02`, [DirectVelo](https://www.directvelo.com/coureur/67165/quwam-afolajomi-tijiani)
  y [resultado oficial del Tour du Bénin](https://www.benin-sports.com/wp-content/uploads/2025/05/Livre-Resultat-Etape-6.pdf)).

La medición posterior registra 52.790 startlists, 1 sin `globalRiderId`, 3
snapshots sin `countryCode`, 3.218 perfiles CN enlazados con 627 sin
`birthDate`, 8.451 perfiles no-CN enlazados con 26 sin `birthDate`, y cero
perfiles enlazados sin nacionalidad salvo los tres Gebrehiwet cuando se auditan
por sus fichas. Hay 7.050 resultados sin `globalRiderId`, 1.092 con dorsal y
cero referencias de resultados colgantes. No se encontró ningún resultado sin
global con dorsal que pudiera cruzarse de forma única con una startlist por
`raceId`+dorsal.

Los pendientes explícitos son: los tres perfiles y snapshots de Chambéry de
Lemlem, Tigist y Tsega Gebrehiwet, sin país individual verificable; 26 fechas
no-CN (`dias-bento`, `jamian-mohamad-iezuan`, `leon-daniel`, `macedo-andre`,
`oliveira-david`, `orsi-riccardo`, `van-seventer-eliam` y las 19 fichas
femeninas restantes de la cola); 627 fechas CN; y la fila Lowie Baeck sin
enlace global. No se derivan fechas desde edad, año, equipo o nombre, ni país
desde el equipo. Los homónimos Samuel Fernández de Caja Rural y Euskaltel,
Pedro Pinto profesional y sub23, João Silva, João Almeida y Andoni López de
Abetxuko permanecen separados.

Los backups privados nuevos son `season-2026-dob-20260830-01`,
`season-2026-unlink-cross-gender-20260830-03`,
`season-2026-cn-dob-20260830-04`,
`season-2026-relink-dangling-20260830-05` y
`season-2026-dob-20260830-06`.

## Retirada de snapshot provisional de Chambéry — 2026-08-30

Se auditó el origen de los tres snapshots sin `countryCode` que quedaban en
2026. La carrera `QXryJLOoYzHXFDjvODZw` tenía 146 filas de corredores y un
bloque Amani de cinco filas, todas creadas en el mismo lote, con el equipo
snapshot sin confirmar y sin referencias al orden de salida. La lista
publicada de [144 corredoras](https://velopressecollection.ouest-france.fr/route/engages/35936-grand-prix-feminin-de-chambery-19-avril-2026-les-engagees.html)
no incluye Amani y sitúa a Eyeru Tesfoam Gebru con el dorsal 117 de Team
Buffaz; la [startlist de fuente externa](https://example.invalid)
confirma la ausencia del bloque. En la base de datos no había resultados para
los dorsales 71, 73 y 75; el resultado de Eyeru se conserva con el dorsal 117.

El veredicto es `anomalía de fuente / snapshot provisional`, reparable sin
decidir identidades. Con el backup
`season-2026-remove-provisional-chambery-amani-20260830-01` se retiraron las
cinco filas de `startlist_riders` y la fila de `startlist_teams` de Amani. No
se modificaron resultados, la fila válida de Eyeru ni las fichas globales.
Las fichas de Tigist, Tsega, Lemlem y Adiam Tesfalem quedan en catálogo sin
referencias activas; no se eliminan por ausencia de evidencia de que sean
identidades inexistentes.

El detector posterior devuelve 52.785 filas de startlist de 2026, 473 carreras
con startlist, una fila sin `globalRiderId` (Lowie Baeck, pendiente) y cero
snapshots sin `countryCode`. Quedan 3.218 perfiles CN con 627 fechas ausentes
y 8.447 perfiles no-CN con 23 fechas ausentes. Los resultados mantienen 7.050
filas sin `globalRiderId`, 1.092 con dorsal, cero referencias globales
colgantes y cero claves `identityKey` duplicadas. Las fichas globales
enlazadas ya no tienen nacionalidad ausente; las tres fichas Gebrehiwet siguen
sin fecha, país ni referencias y permanecen fuera del recuento de perfiles
enlazados. El backup conserva el estado completo de las seis filas retiradas
para rollback dirigido.

## Revisión de fila sin enlace y resultados sin `globalRiderId` — 2026-08-30

Se revisó primero la única fila de startlist que seguía sin enlace. La fila
`sruci_60d77c4713b84d4039f01f10c189ed27`, dorsal 97 de `Vuelta a Extremadura`,
decía `Lowie Baeck` en una carrera femenina y usaba el snapshot de `TEAM ABADIE
MAGNAN`. La [startlist publicada por fuente externa](https://example.invalid)
sitúa en ese dorsal a `Laury Milette`; los resultados locales de la carrera
también muestran `MILETTE Laury` en el dorsal 097 y ya enlazado a
`milette-laury`. Se sustituyó la identidad de la fila, conservando carrera,
equipo y dorsal, y se aplicó `countryCode='ca'`. No se creó una ficha nueva ni
se enlazó Lowie a una carrera femenina. El backup es
`season-2026-lowie-milette-substitution-20260830-02`.

Se auditó la cola de resultados por categoría, existencia de startlist, dorsal,
nombre, etapa y clasificación. Las reparaciones dirigidas fueron:

- `season-2026-result-oetomo-samsun-20260830-03`: dos filas del dorsal 27 de
  Tour of Samsun se enlazaron a `oetomo-yosandy-darmawan`. El mismo corredor,
  nombre, dorsal y carrera ya estaban enlazados en las demás etapas; el dorsal
  27 no existe en la snapshot actual y no se añadió una inscripción.
- `season-2026-result-cn-unique-20260830-04`: se enlazaron la 20.ª de Agata
  Kowalska en el Campeonato de Polonia (`kowalska-agata`) y el DNF de Francisco
  Alves en el Campeonato de Portugal sub-23 (`alves-francisco`). La [inscripción
  oficial polaca](https://zgloszenia.akces-sport.pl/startList/159.html), la
  [clasificación publicada](https://example.invalid)
  y el [resultado portugués](https://example.invalid)
  confirman las identidades y equipos. La fila DNF duplicada de Agata se dejó
  sin enlace porque contradice la clasificación publicada.
- `season-2026-result-gutierrez-vpf-20260830-05`: dos filas sin dorsal de
  Ariadna Gutiérrez en la Volta a Portugal Femenina se enlazaron a
  `gutierrez-arzaluz-ariadna`; la snapshot y las otras etapas de la misma carrera
  aportan la continuidad inequívoca.
- `season-2026-result-cn-joao-martins-credibom-20260830-06`: la 5.ª plaza de
  João Martins se enlazó a `martins-joao`, ficha de Credibom nacida en 2004. La
  [clasificación de fuente externa](https://example.invalid)
  distingue a ese corredor de otro João Martins de Maia/Earth Consulters, 16.º,
  cuyo perfil fuente externa indica nacimiento en 2005. La 16.ª plaza, la segunda snapshot
  y la identidad del catálogo no se mezclan ni se enlazan por nombre.

El resultado del primer lote fue una fila de startlist corregida y siete filas
de resultados enlazadas. No se crearon startlists para los campeonatos
nacionales que solo disponen de resultados. La medición de ese lote devolvió
52.785 filas de startlist, 473 carreras con startlist, cero filas sin
`globalRiderId` y cero snapshots sin `countryCode`. El segundo lote y la
revisión específica de clasificaciones de equipos se documentan a continuación.

La búsqueda de nombre exacto en la misma carrera no produjo más candidatos
únicos. El único cruce nominal restante con snapshot es el segundo João Martins:
dos filas de startlist de equipos distintos apuntan hoy a la misma ficha, por lo
que el resultado 16.º queda pendiente hasta localizar o crear la ficha
independiente con evidencia UCI suficiente. Los resultados CN sin startlist se
conservan como filas válidas sin identidad global, conforme a la política del
proyecto; no se eliminan por no tener inscripción. También quedan documentados
la fila DNF contradictoria de Agata y los dos resultados de Plouay sin nombre de
corredor y sin dorsal presente en la snapshot. La reparación mantuvo puestos,
tiempos, dorsales, IRM y textos de resultados sin cambios.

## Reconciliación del bloque de 5.490 resultados — 2026-08-30

El censo inicial identificó 5.490 resultados de 2026 sin `globalRiderId` en
carreras que sí tienen alguna startlist. El bloque no representa 5.490
corredores: 5.452 filas son clasificaciones de equipos (`classKind='teams'` o
`isTeamEvent=true`). Se validan como resultados colectivos y deben conservar
`globalRiderId=NULL`; no se enlazaron equipos a fichas de corredores.

Las 38 filas restantes eran individuales o auxiliares. Siete DNF del
Campeonato británico masculino se enlazaron en la operación
`season-2026-result-cn-gb-abbreviations-20260830-07`, usando coincidencia de
abreviatura con la snapshot, dorsal, equipo, país y continuidad de carrera:
Elliott Colyer, William Salter, Alexander Foster, Joshua Horsfield, Alfred
George, William Truelove y William Smith. El backup es privado y conserva las
filas completas.

Se enlazaron otras cuatro filas individuales en la operación
`season-2026-result-safe-crossings-20260830`: Max Roth a
`roth-maximilian`, Ailsa McLagan a `mclagan-ailsa`, Yurani/Iurani Blanco
Calbet a `blanco-iurani` y Patrycja Lorkowska a `lorkowska-patrycja`. Las
coincidencias se verificaron con la única snapshot nominal de cada carrera,
país, dorsal y ficha global; las fuentes externas confirman la forma completa
de Max Roth ([ficha del equipo](https://maxsolar-cycling-team.de/team/max/)),
Ailsa McLagan ([British Cycling](https://www.britishcycling.org.uk/events/details/335045/2026-Lloyds-National-Road-Race-Championships)) e Iurani Blanco
Calbet ([resultado RFEC](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/noticia/55837/documentos/doc_6676cf9f926107_89638387_imagen_CLASS-FEM-1.pdf)).

Estado posterior: 52.785 filas de startlist, cero filas sin
`globalRiderId`, cero snapshots sin `countryCode`, 7.032 resultados sin
enlace global y 1.090 con dorsal. Dentro del bloque de carreras con startlist
quedan 5.479 filas sin enlace: 5.452 son clasificaciones de equipos válidas y
27 son filas individuales o auxiliares pendientes. No se crearon startlists
para campeonatos nacionales results-only. Permanecen sin enlazar, entre otros,
el João Martins de Maia/Earth Consulters (16.º), la fila DNF contradictoria de
Agata Kowalska, dos resultados de Plouay sin nombre y dorsal, y los resultados
sin snapshot nominal inequívoca de Volta a Portugal Feminina. No hay referencias
globales colgantes. El backup contiene cuatro filas bajo
`season-2026-result-safe-crossings-20260830` y siete bajo
`season-2026-result-cn-gb-abbreviations-20260830-07`.
