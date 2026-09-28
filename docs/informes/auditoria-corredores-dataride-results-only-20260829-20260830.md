# Auditoría de corredores del lote DataRide results-only — 2026-08-29/30

> **Nota de contrato vigente (2026-08-30):** este runbook conserva la semántica histórica de su operación. Las referencias a `uciId` como perfil interno no describen el contrato actual: el perfil se guarda en `uciProfileId` y `uciId` queda reservado a licencias UCI de 11 cifras. La limpieza global posterior está documentada en [`limpieza-global-uci-ids-20260830.md`](limpieza-global-uci-ids-20260830.md).

## Manifiesto previo a la reparación

Estado del manifiesto: preparado antes de nuevas escrituras de datos.

### Alcance reproducible

El lote se delimita por enlaces `race_uci_links` de carreras `races.resultsOnly = true`, año 2026, fuente `uci`, creados entre:

- inicio: `2026-08-29 09:12:02.308972+00` UTC;
- fin: `2026-08-29 09:13:46.228187+00` UTC.

La consulta de alcance devuelve 338 enlaces, 110 competiciones, 334 carreras UCI y 6.891 filas de `race_uci_results`, con 3.888 `globalRiderId` distintos. El lote contiene 198 carreras masculinas y 140 femeninas.

Entre esos 3.888 objetivos se detectaron 2.449 perfiles creados desde el inicio temporal del lote: 2.430 `catalog_gold`, 3 `manual`, 15 con fuente `SCF/Sportstiming Campeonato de Suecia CRI 2026; manual_global_link` y 1 con fuente `stsport-gp-plouay-2026`. Solo los 2.430 `catalog_gold` constituyen la cohorte generada por el volcado DataRide; los 19 restantes se conservan fuera de las reparaciones dirigidas.

La cohorte de perfiles generados se define como los `globalRiderId` de esos resultados que pertenecen a `riders_men`/`riders_women`, tienen `source = 'catalog_gold'` y `createdAt >= 2026-08-29 09:12:02.308972+00` UTC. El resultado previo a la reparación fue 2.430 fichas: 1.898 masculinas y 532 femeninas. El último `createdAt` observado es `2026-08-30 00:57:06.633833+00` UTC.

### Estado previo

- Las 6.891 filas de resultados tienen `globalRiderId` no nulo.
- Cada resultado enlaza con una ficha de la tabla correspondiente al género de la carrera.
- No hay grupos duplicados por posición con `bib` o `rank` no nulos.
- No hay `identityKey` duplicados dentro de la cohorte ni colisiones de aliases para sus claves.
- Las 2.430 fichas tienen nombre, nacionalidad e `identityKey`; ninguna tiene `uciId`.
- Tres fichas carecen de fecha de nacimiento: `joia-almeida-evander-jorge`, `milisavljevic-nikola` y `yang-taeyang`.
- La cohorte tiene una referencia de startlist de creación concurrente (`guilbert-matteo`); se conserva fuera de las reparaciones DataRide dirigidas.
- Existe una colisión histórica de `globalRiderId` entre las tablas masculina y femenina para `zhang-hao`, con 27 resultados del lote. Las dos fichas tienen fechas, nacionalidades y UCI IDs distintos. No se modifica por quedar fuera de la cohorte nueva; queda pendiente separado.

### Reparaciones dirigidas autorizadas

Se reparan únicamente identidades con coincidencia de género, fecha de nacimiento y nacionalidad, sin coaparición en una misma carrera, y con evidencia adicional de nombre canónico, estado de ficha o fuente externa:

| Género | Ficha de cohorte | Ficha canónica | Acción |
| --- | --- | --- | --- |
| F | `elmeddah-yasmine` | `el-meddah-yasmine` | Reapuntar resultados y conservar la ficha verificada `El Meddah`. Alias de la clave compacta. |
| M | `jamshidian-amirhossein` | `jamshidian-amir-hossein` | Reapuntar resultados, conservar la ficha manual verificada y registrar alias. |
| M | `kim-jihun` | `kim-ji-hun` | Reapuntar resultados y registrar la variante con guion. |
| M | `roque-rr-king` | `roque-rr-king` | Mantener la ficha de cohorte por el nombre `Rr King`; reapuntar las referencias de `roque-rrking` y registrar alias. |
| M | `pavon-cano-ruben` | `pavon-cano-ruben` | Mantener la ficha con el nombre oficial `Ruben Pavon Cano`, transferir `uciId = 972043`, referencias y afiliación desde `pavon-cano-sebastian-ruben`; registrar alias. |
| M | `weigelt-mikkel` | `weigelt-mikkel-bang-fredso` | Reapuntar la nueva ficha a la ficha existente de nombre completo y registrar alias; la tercera variante histórica `bang-fredsoo-weigelt-mikkel` queda pendiente fuera del alcance de altas nuevas. |

La correspondencia de Pavon se comprobó con la ficha oficial UCI `https://www.uci.org/rider-details/972043`, que identifica a Ruben Pavon Cano, nacido el 30-05-2005 y de nacionalidad HON. La variante de Weigelt tiene evidencia coincidente de fecha, nacionalidad, resultados y licencia UCI `10079923031` en documentación pública de cronometraje; el campo local `uciId` sigue reservado al identificador interno de ficha UCI y no se rellena con la licencia de 11 dígitos.

### Pendientes explícitos

No se completa automáticamente ningún `uciId` de las 2.430 fichas porque el payload DataRide usado por el volcado no contiene el identificador interno de ficha UCI. También quedan pendientes por falta de evidencia inequívoca las parejas `jurado-lopez-cristofer`/`jurado-christofer`, `morales-garcia-ferlandy`/`morales-ferlandy-eliu` y `ogando-reynoso-jonatan`/`ogando-jonathan`, además de la variante histórica de Weigelt. Se mantienen separadas las parejas que coaparecen o tienen datos incompatibles: Elvira/Elvira, Liu/Liu, Yang/Yang y Hadzhistoyanov/Hadzhistoyanov.

### Backup previsto

Antes de la primera modificación se crea el backup privado `private.repair_results_only_rider_catalog_20260830_backup`, operación `results-only-rider-catalog-repair-20260830`. Contendrá las filas completas de las fichas afectadas, aliases, resultados, startlists y afiliaciones, antes de cada lote de reparación.

## Resultado verificado

Se aplicaron seis reparaciones dirigidas:

- `elmeddah-yasmine` → `el-meddah-yasmine`;
- `jamshidian-amirhossein` → `jamshidian-amir-hossein`;
- `kim-jihun` → `kim-ji-hun`;
- `roque-rrking` → `roque-rr-king`;
- `pavon-cano-sebastian-ruben` → `pavon-cano-ruben`;
- `weigelt-mikkel` → `weigelt-mikkel-bang-fredso`.

Se retiraron seis fichas duplicadas, se crearon seis aliases y se reapuntaron 27 filas de resultados, 2 filas de startlist y una afiliación. Pavon conserva el equipo y la afiliación histórica y queda con `uciId = 972043`, `verified = true` y el nombre `Ruben Pavon Cano`.

La verificación posterior devuelve 2.426 fichas activas de la cohorte (`1.895` masculinas y `531` femeninas), una ficha con `uciId` (`pavon-cano-ruben`) y 2.425 sin `uciId`; las tres fechas de nacimiento ausentes permanecen identificadas. Los 6.891 resultados siguen resueltos, sin referencias a fichas retiradas, sin huérfanos de startlist, sin duplicados de posición con dorsal o puesto, y sin perfiles faltantes en la tabla de género correspondiente. Los aliases de la operación apuntan a seis fichas existentes. No hay duplicados de `identityKey` ni de `uciId` dentro de cada tabla de género.

El backup de esta reparación contiene 117 filas: 10 `riders_men`, 2 `riders_women`, 88 `race_uci_results`, 16 `startlist_riders` y 1 `rider_team_affiliations`. El backup histórico `private.repair_results_only_identity_link_20260829_backup` se conserva intacto.

La colisión histórica `zhang-hao` entre las tablas masculina y femenina sigue pendiente y no se modifica en esta operación: afecta a fichas anteriores a la cohorte y requiere una decisión de diseño sobre el identificador global. La variante `bang-fredsoo-weigelt-mikkel` también se conserva intacta como pendiente fuera del alcance de altas nuevas.

### Enlaces dirigidos de resultados con fuentes externas — 2026-08-30

Tras la retirada de `uciId`, el criterio operativo sigue siendo el
`race_uci_results.globalRiderId`. Los códigos UCI de 11 cifras se conservaron
solo como evidencia externa y no se escribieron en `uciProfileId`, que continúa
siendo el identificador interno de perfil UCI. Se ejecutaron tres lotes con
preflight, backup privado e invariantes posteriores:

- `season-2026-result-official-links-20260830`: 15 resultados. Se reapuntaron
  Agata Kowalska, Andrea Soldevilla Sanchez y Celia Torres Arias a fichas
  existentes. Se crearon ocho fichas globales y se enlazaron Flatt Amelie,
  Mathias Wiele, Aleksandra Dixa, Izabela Janusz, Nikola Gliniecka, Martyna
  Lopianiak, Daniela Carphio y Diana Corrales. Sus nacionalidades son,
  respectivamente, `de`, `de`, `pl`, `pl`, `pl`, `pl`, `ec` y `co`. Las fechas se
  dejan nulas cuando la fuente consultada no publica el día exacto.
- `season-2026-result-denmark-corrections-20260830`: 3 resultados del
  Campeonato de Dinamarca. Las filas brutas `Sabine Clausen Celine`, `Sophie
  Nielsen` y `Cecilie Porsdal`, en las posiciones 32, 37 y 38, se enlazaron a
  `clausen-cecilie-sabine`, `trampe-sophie` y `porsdal-catrine`, respectivamente,
  porque la clasificación publicada las identifica como Cecilie Sabine Clausen,
  Sophie Trampe y Catrine Porsdal. No se modificó `riderDisplay`.
- `season-2026-result-plouay-bib-links-20260830`: 2 resultados. Los dorsales
  46 y 36, en las posiciones 47 y 59 de Classic Lorient Agglomération, se
  enlazaron a Daniek Hengeveld y Anastasiya Kolesava. La startlist interna
  conserva los dorsales 45 y 35 para esas fichas; se documenta como discrepancia
  de inscritos y no se corrige en este lote.

Evidencia consultada: [registro oficial PZKol/Akces del Campeonato de Polonia](https://zgloszenia.akces-sport.pl/startList/159.html), [resultados oficiales de Alemania](https://zpn-timing.de/uploads/ergebnisse/2026/Hasenrasen2026.pdf) y [rad-net](https://static.rad-net.de/html/bdr/meisterschaften/08-bdr/strasse/dm-str-u23_erg.pdf), [ranking oficial RFEC](https://rfec.com/es/smartweb/seccion/clasificacioncircuito/rfec/carretera/feminas/2026/26RANKRUTAFEM), [clasificación oficial FPC con Daniela Carphio](https://www.fpciclismo.pt/ficheiros/2024/2024-vp-s19f-3etapa.pdf), [registro oficial colombiano de Diana Corrales](https://efbt585jris.exactdn.com/wp-content/uploads/2026/03/LISTADO-DE-INSCRITOS-CAMPEONATO-PANAMERICANO-DE-RUTA-MONTERIA-2026.pdf), [página oficial UCI DataRide del Campeonato de Dinamarca](https://dataride.uci.org/iframe/EventResults/364968?competitionId=77932&disciplineId=10), [clasificación danesa publicada](https://example.invalid), [clasificación de Plouay](https://velopressecollection.ouest-france.fr/route/classements/38046-classic-lorient-agglomeration-ceratizit-29-aout-2026-classement.html) y [startlist publicada de Plouay](https://www.domestiquecycling.com/en/cycling-races/classic-lorient-agglomeration/2026/startlist/). La [FPC confirma oficialmente la edición 2026 de la Volta a Portugal Feminina](https://www.fpciclismo.pt/noticia/volta-a-portugal-feminina-jogos-santa-casa-regressa-para-a-sua-edicao-mais-internacional-de-sempre), pero no publica en la página consultada un documento indexable con UCI ID para las seis filas pendientes.

El backup de los tres lotes contiene 20 filas de `race_uci_results` en
`private.repair_results_only_rider_catalog_20260830_backup`, con las
operaciones indicadas. La verificación posterior devuelve cero referencias
colgantes. El bloque con carrera y startlist queda en 5.459 filas sin enlace:
5.452 son clasificaciones de equipos válidas y 7 son individuales pendientes.
Las siete filas son `694340` (João Martins, Maia/Earth Consulters, 16.º),
`745285`, `745420`, `745527` (Fernanda Zarate, Volta a Portugal Feminina), y
`745341`, `745448`, `745542` (Maria Costanza Pezzotti, la misma prueba).

`694340` permanece separado de `martins-joao` (Credibom): el ranking oficial
FPC identifica al corredor de Maia/Earth Consulters con UCI `10044444774`, pero
la ficha existente tiene otro corredor, UCI interno `442534` y fecha
`2004-03-27`; no se creó un homónimo sin fecha diferenciadora. Fernanda Zarate
queda pendiente porque la fuente oficial mexicana confirma su nombre y país,
pero la vinculación específica con la Volta procede de una fuente secundaria.
Maria Costanza Pezzotti queda pendiente porque la identificación disponible de
la prueba y la fecha `2004-01-27` procede de una fuente secundaria y no se ha
encontrado todavía una ficha federativa oficial. No se rellenan fechas ni
nacionalidades por deducción.

### Cierre de los enlaces individuales VPF y Nacional sub-23 — 2026-08-30

La investigación de fuentes oficiales y de continuidad de carrera resolvió las
siete filas individuales que permanecían sin `globalRiderId` en carreras de
2026 con startlist. El lote se ejecutó con la operación
`season-2026-vpf-cn-result-links-20260830` y quedó respaldado en
`private.repair_results_only_rider_catalog_20260830_backup` antes de escribir.
El backup contiene 10 filas: 7 resultados, 1 startlist y 2 fichas de corredor.

- `694340`, João Martins, 16.º del Campeonato de Portugal sub-23 de fondo, se
  enlazó a la ficha nueva `martins-joao-2005`, con `birthDate = 2005-05-16` y
  `nationality = pt`. El resultado oficial de la [FPC identifica al João
  Martins de Earth Consulters/Maia](https://www.fpciclismo.pt/calendarios_ficheiros/2026/08032026165826anexo_classificacao_EpA4xj6c8q2tVRv1pZ28p.pdf)
  con licencia UCI `10044444774`; la crónica del [Nacional sub-23 confirma su
  16.º puesto y el mismo equipo](https://desportivodominho.com/2026/06/27/gabriel-baptista-vice-campeao-ruben-rodrigues-e-andre-ribeiro-no-top10-no-nacional-de-fundo-em-sub-23/).
  Se corrigió además la inscripción de dorsal 18 que apuntaba por error a
  `martins-joao`. El João Martins de Credibom, dorsal 13, se conserva separado
  con fecha `2004-03-27`.
- `745285`, `745420` y `745527`, abreviados como ZARATE Fernanda, se
  enlazaron a `garcia-fernanda`. La ficha queda como Fernanda Garcia, con
  `otherNames = 'Fernanda Paola Zarate Garcia'`, `birthDate = 2007-03-06` y
  `nationality = mx`. La [FPC confirma el nombre corto, el equipo Atum
  General/Tavira/Madre Fruta y su participación en la prueba](https://www.fpciclismo.pt/noticia/ana-caramelo-vence-na-maia-e-conquista-taca-de-portugal-feminina-em-elite);
  la [startlist publicada conserva el dorsal 104 y el nombre
  completo](https://example.invalid),
  y la ficha de resultados publica fecha, país y las tres posiciones
  coincidentes de la Volta ([fuente de resultados](https://example.invalid)).
  La nacionalidad se contrastó además con [documentación mexicana de la
  Olimpiada Nacional 2026](https://elitesinaloa.com/sinaloa/sinaloa-cierra-con-exito-el-ciclismo-de-ruta-con-medallas-de-oro-y-bronce-en-olimpiada-nacional-conade-2026/).
- `745341`, `745448` y `745542`, abreviados como PEZZOTTI Maria Costanza, se
  enlazaron a `sosa-maria`. La ficha queda como Maria Costanza Pezzotti Sosa,
  con `otherNames = 'Maria Constanza Pezzotti Sosa'`, `birthDate = 2004-01-27`
  y `nationality = ar`. La [startlist de la Volta publica el dorsal 186 y el
  nombre completo](https://example.invalid),
  mientras que [la clasificación de la prueba reproduce sus tres posiciones,
  fecha y país](https://example.invalid).
  La identidad argentina se contrastó con [inscripción argentina publicada
  para Pezzotti Sosa](https://www.ciclismoxxi.com.ar/wp-content/uploads/2023/09/Listado-de-inscriptos-definitivo.pdf).

Se registraron seis aliases para conservar las variantes históricas y se
mantuvieron los nombres completos en `otherNames` cuando la ficha canónica se
redujo al formato operativo. La página de la [5.ª Volta a Portugal Feminina de
FPCiclismo](https://www.fpciclismo.pt/pagina/5-volta-portugal-feminina) confirma
la prueba, las cinco jornadas, sus resultados y la lista de participantes. No
se encontró una página directa indexable de la edición 2026 en
Classificações.net; sus páginas de resultados siguen siendo útiles como fuente
auxiliar cuando exponen UCI ID, pero no se usaron para justificar estos siete
enlaces.

La verificación final devuelve 52.785 startlists 2026, cero filas sin
`globalRiderId`, cero snapshots sin `countryCode`, cero referencias de
resultados colgantes y 7.005 resultados sin `globalRiderId` en total. Dentro de
carreras con startlist no queda ninguna fila individual pendiente; las 5.452
restantes son clasificaciones colectivas de equipos (`classKind='teams'` o
`isTeamEvent=true`) y se conservan sin ficha personal.
