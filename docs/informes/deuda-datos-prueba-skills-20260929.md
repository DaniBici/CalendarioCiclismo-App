# Deuda de datos detectada al probar las skills (2026-09-29)

Hallazgos de la prueba de procedimientos de las skills `cc-*`. Ninguno se ha
corregido: quedan para una sesión de saneo (`cc-saneo-resultados` y
`cc-reparacion-resultados` para resultados; la skill de cada dominio para el
resto). Recuentos a fecha de la prueba.

## Resultados e identidades

- **Cabecera final mal agrupada:** `race_uci_stages` `ru_-1608202601` (GP
  Capodarco 2026, `nfEYyPO7cteHdqZsM1dG`, `one_day`), `stage/stage` con
  `isFinalClassification=true` y `raceDayId` informado; bloqueada. Detector 6
  de `cc-saneo-resultados`.
- **274 afiliaciones deterministas con prefijo de otro corredor**
  (`rider_team_affiliations.id` `rider__team__year` cuyo prefijo no es su
  `riderId`). Bloquean upserts futuros. Detector 7.
- **339 fichas CX creadas por la ingesta** (`source` `results_dataride`) sin
  `otherNames` ni tildes revisadas.

## Jornadas y perfiles

- 72 jornadas de 2026 con `startLocation = finishLocation` (debería ser
  `finishLocation` NULL).
- 206 jornadas con `profileSummits` NULL en lugar de `[]`.
- 8 jornadas con `hasAssets` incoherente con sus assets.
- 217 de 284 pruebas en línea de Campeonatos Nacionales 2026 con
  `primaryType` NULL; `colorHex` distintos para BE y variantes de mayúsculas
  en BA, GT, LT y RS.
- 35 bonificaciones de 2026 fuera de la plantilla; 13 traducciones `auto` de
  bonificaciones y 83 de descripciones con hash que ya no corresponde al
  castellano; 14 traducciones `manual` con el castellano vacío.

## Assets

- 142 perfiles recientes en PDF y 21 en WEBP (la regla exige JPG/PNG para lo
  nuevo; decidir si se convierten).
- 13 `ports` recientes en JPG/PNG.
- Guía técnica de `vuelta-al-ecuador` (2026-09-07) apuntando a
  `stage-1/ports.pdf`; `roadbook` de `tour-of-shanghai` (2026-09-06)
  apuntando a `technicalGuide-2.pdf`.
- Documentos sin rehospedar con URL externa: `letour-guadeloupe.fr`,
  `sitekbe.com`, `arnowallaardmemorial.nl` (con `#page=`).
- 4 `races.logoUrl` en `ta2026.com` (favicon externo).
- 43 filas antiguas de `assets` con `sourceType` `pdf`, `image` u `official`.

## Emisiones

- 4 filas `Eurovision Sport`/`EUROPA` (Juegos del Mediterráneo, 2026-08-22 y
  2026-08-24).
- 3 filas `TNT Sports / HBO Max` (Dauphiné, junio) y 1
  `Eurosport (HBO Max)`/`ALL` (Polonia femenina).
- 174 Eurosport sin pareja TNT anteriores a julio de 2026 y 8 filas con
  `country` NULL.
- `docs/runbooks/broadcasts-vps.md` admite Eurovision Sport como Revive,
  frente a la regla de no crear filas con ese canal.

## Mercado de fichajes

- `juaristi-txomin`: dos movimientos no `midSeason` en 2027 (renovación
  confirmada y `transfer` con destino `?`).
- `tr_1784536560160_y4oe4r`: `midSeason` con `season=2026`, invisible en la web.
- `van-empel-fem` con `fromTeamName='-'`; `arens-megan` con `teamId` y nombre a
  la vez en origen y destino.
- Panel: el editor de equipo, con «Cambia» confirmado, no crea la afiliación
  de destino (sí el editor individual y la confirmación rápida).

## Ciclocross

- `cx_import_calendar` corregido (migración `20260929063019`); las 40
  diferencias con UCI que habría aplicado siguen visibles al reimportar y no
  requieren acción salvo revisión puntual (p. ej. fecha del Campeonato de
  Australia: UCI 2026-08-14, dato actual 2026-08-15).
- Inscritos CX: el flujo `cx_prepare/apply_startlist_import` no se ha usado
  nunca en producción; el emparejamiento exige nombre exacto con acentos y no
  consulta `otherNames`.

## Estado tras el saneo del 2026-09-29

Detalle, respaldos y reversión en
[saneo-deuda-datos-20260929.md](saneo-deuda-datos-20260929.md).

- Cerrados: cabecera final de Capodarco; 273 de 274 afiliaciones con prefijo
  ajeno; 24 fichas CX con evidencia en carretera; `juaristi-txomin`,
  `tr_1784536560160_y4oe4r` y `arens-megan`; `finishLocation` igual a la
  salida (72) o vacía (383); `profileSummits` `[]` en 334 jornadas con perfil;
  `hasAssets` (28); `colorHex` en minúsculas (22); 53 bonificaciones a la
  plantilla; traducciones `auto` obsoletas (101) y `manual` vacías (14);
  `sourceType` antiguo (37); TNT de la Dauphiné, Eurosport `ALL` y `country`
  NULL (8); runbook de emisiones.
- Decisiones de Dani aplicadas: `garcia-pablo` retirado en julio de 2026
  (se borra la afiliación `catalog_gold`; sin equipo actual);
  `van-empel-fem` con origen `Sin equipo`; Eurovision Sport retirado (4 filas,
  `tvStatus` NULL); perfiles nuevos solo JPG/PNG y logos solo en la zona de
  assets, con triggers (migración `20260929072205`).
- Se mantienen por decisión de Dani: 396 fichas CX sin evidencia (base de
  datos nueva), `primaryType` NULL en 217 pruebas de Nacionales, 60
  bonificaciones fuera de plantilla, `profileSummits`/`profileWaypoints`
  NULL, 171 Eurosport sin pareja anteriores a julio y los perfiles PDF/WEBP
  existentes.
- Sin decidir: `ports` en JPG/PNG (13 recientes, 29 en total). Colores de BE
  en Nacionales: cerrado el 2026-10-14 (sección siguiente).
- Pendientes de subida a R2 (aplazada por Dani): guía técnica de
  `vuelta-al-ecuador`, rutómetro de la etapa 3 de `tour-of-shanghai`, 5
  documentos externos y los 4 logos de los Juegos del Mediterráneo, retirados
  (`logoUrl` NULL) porque no se admiten logos externos.
- Pendientes de código: cerrados el 2026-10-14 (sección siguiente).
- Regeneración web de 48 páginas de jornada, a lanzar desde `main`.

## Cierre del 2026-10-14

Recuento releído con `sql.mjs --read-only` antes de escribir; cada escritura se
probó con `--rollback`, se aplicó y se verificó. Respaldos en `private` con
RLS y sin privilegios para roles de API.

- **`profileSummits` NULL con perfil:** 7 jornadas del 4 al 11 de octubre pasan
  a `[]` (0 restantes). Respaldo
  `private.jornadas_summits_be_color_20261014_backup`.
- **Color de los Campeonatos de Bélgica:** 3 pruebas (CRI sub23 masculino y
  femenino, línea sub23 masculino) pasan a `#fdda24`, el color de las otras 4.
  «Campeonato de Flandes» (`#ffd500`) no es nacional y se conserva. Mismo
  respaldo.
- **`schrempf-carina`:** `fromTeamName` y `toTeamName` a NULL en
  `schrempf-carina-2026-sd-worx-protime`; la baja `?` ya la había sustituido la
  fila normal oculta hacia SD Worx. Respaldo
  `private.fichajes_afiliaciones_20261014_backup`.
- **`arens-megan`:** sin acción; la afiliación de mercado 2027 ya apunta a AG
  Insurance.
- **Afiliaciones de mercado 2027 ausentes:** insertadas para los 5
  movimientos confirmados no `midSeason` con destino y sin afiliación
  (`stella-davide`, `okamika-ander`, `van-uden-casper`, `craps-lars`,
  `ulissi-diego`), con `dateTo` = 31-dic del año de contrato; `contractUntil`
  de `van-uden-casper` = 2029. `currentTeamId` sin cambios. Las otras 7 del
  recuento del 2026-09-29 ya constaban resueltas.
- **Editor de equipo del panel:** la rama «Cambia» de `_tseSaveTeam` crea la
  afiliación de destino y sincroniza `contractUntil` cuando el cambio está
  confirmado (no en rumor); los `insert` de `rider_transfers` de «En duda»,
  «Cambia» y «Termina» comprueban el error. Tabla del editor actualizada en
  `docs/memory/carretera.md`. Panel validado con `esbuild`.
- **`cx_prepare_startlist_import`:** migración
  `20261014201236_cx_prepare_startlist_import_nombres_plegados`. El
  emparejamiento usa `cx_rider_name_matches` (tildes y `otherNames`) y compara
  la nacionalidad sin distinguir mayúsculas; mantiene candidato único. Sin
  prueba SQL nueva: la función exige `cx_require_admin`.

### Sin cambios o pendientes

- **Fichas CX de `results_dataride` sin `otherNames`:** 614 (497 hombres, 117
  mujeres), por la ingesta posterior al 2026-09-29. Completarlas exige fuente
  externa por ficha. Seis tienen dos apellidos en `lastName`
  (`gonzalez-jimenez-gabriel`, `urzua-ovalle-juan-ignacio`,
  `cidras-alvarez-xoel`, `vazquez-golpe-aitor`, `hormann-ripoll-katia`,
  `sanchez-mendoza-nicole`). La búsqueda web del 2026-10-14 no dio grafía con
  tilde verificable (solo `Vazquez Golpe` en fuente externa, sin tilde); no se
  modificaron.
- **Perfiles PDF/WEBP (356 y 28 en total):** se mantienen por decisión de Dani
  del 2026-09-29. Convertirlos exige renderizar, subir a R2 y reapuntar
  `assets.url`.
- **`ports` en JPG/PNG y subidas a R2 aplazadas:** sin decisión ni subida.
- **Filas Eurovision Sport:** ya borradas el 2026-09-29 (0 filas).
- **Regeneración web de 48 páginas de jornada:** a lanzar desde `main`.
