# Saneo de la deuda de datos (2026-09-29)

Ejecución del saneo inventariado en
[deuda-datos-prueba-skills-20260929.md](deuda-datos-prueba-skills-20260929.md).
Cada sección recoge recuentos previos, acción, tabla de respaldo en `private`,
verificación y SQL de reversión, o la pregunta pendiente.

Complemento posterior a estos informes: 374 jornadas con `finishLocation = ''`
sin meta en inglés ni traducción pasan a NULL (respaldo
`private.jornadas_finish_empty_20260929_backup`, creado con el rol
`cc_agent`). De las 9 restantes (respaldo
`private.jornadas_finish_residual_20260929_backup`), 7 con meta inglesa igual a
la salida o vacía pasan a NULL sin traducción de meta (Tour de Francia
femenino 1 y 9, Tour de Gyeongnam 1-5); `tour-de-francia-2026-etapa-21` pasa a
Thoiry › París (Campos Elíseos) y `tour-feminin-du-burundi-2026-etapa-1` recibe
la meta Karwema, según sus campos en inglés. Quedan 0 metas vacías o iguales a
la salida. El panel guarda ya NULL cuando la meta está
vacía o coincide con la salida. El título inglés de jornada del generador
estático usa la salida cuando la meta es NULL. Las referencias a Eurovision
Sport como fuente Revive se retiraron de `broadcasts-vps.md` y
`docs/memory/broadcasts.md`.

## Decisiones de Dani (2026-09-29)

Respaldo `private.decisiones_dani_20260929_backup` (11 filas, rol `cc_agent`).

- `garcia-pablo`: retirado en julio de 2026. Se borra
  `garcia-pablo-polti__team_1776705783470_ii0i0m__2026` (`catalog_gold`,
  `dateTo` NULL); queda la fila del panel con `dateTo` 2026-07-03 y
  `recompute_current_team` deja `currentTeamId` NULL. La retirada
  `tr_1784552446934_iym30q` se conserva.
- `van-empel-fem`: sin equipo desde finales de 2025; `fromTeamName` pasa de
  `-` a `Sin equipo` en `tr_1789662012071_zeiy3g` (destino FDJ United - SUEZ
  sin cambios).
- Eurovision Sport: borradas las 4 filas de los Juegos del Mediterráneo; sus
  jornadas pasan de `confirmed_time` a `tvStatus` NULL al no constar otro
  emisor verificado. Ninguna dependía del sincronizador.
- Perfiles y logos: migración `20260929072205_guard_profile_format_logo_host`.
  `guard_profile_image_format` rechaza perfiles nuevos o sustituidos que no
  sean JPG/PNG; `guard_logo_hosted` rechaza logos nuevos o sustituidos fuera
  de `https://assets.calendariociclismo.app/`. Los perfiles existentes se
  conservan; los 4 logos de `ta2026.com` se retiran (`logoUrl` NULL, respaldo
  `private.logos_externos_20260929_backup`) porque no se admite ningún logo
  externo; después se rehospedan en R2 (A7). El panel solo ofrece JPG/PNG al subir un perfil y muestra el error de
  validación al guardar una carrera.
- Sin cambios por decisión: fichas CX, `primaryType` de Nacionales,
  bonificaciones, cimas y waypoints, parejas Eurosport previas a julio,
  perfiles PDF/WEBP existentes y subidas a R2.

## Saneo 2026-09-29: resultados e identidades, mercado de fichajes y ciclocross

Manifiesto: `docs/informes/deuda-datos-prueba-skills-20260929.md` (secciones «Resultados e identidades», «Mercado de fichajes», «Ciclocross»). Proyecto `bcecwlkynpgovnzhbpah`, vía MCP `execute_sql`, rol `postgres`.

Backup único de la sesión: `private.saneo_resultados_fichajes_cx_20260929_backup` (`entity`, `row_key`, `row_data jsonb`, `backed_up_at`), con el mismo patrón que `repair_retegi_mikel_20260927_backup`: RLS activado, `REVOKE ALL FROM PUBLIC, anon, authenticated`, `GRANT SELECT, INSERT TO service_role`. Contenido: `race_uci_stages` 1, `rider_team_affiliations` 273, `rider_team_affiliations_inserted` 1, `rider_transfers` 4, `riders_men` 1, `cx_riders_men` 17, `cx_riders_women` 7.

Punto abierto: la tabla se creó con `execute_sql`, no con `apply_migration` (restricción de la sesión). No figura en `supabase_migrations` ni existe archivo en `supabase/migrations/`. Si se requiere trazabilidad, registrar una migración con el DDL exacto (CREATE TABLE + RLS + REVOKE/GRANT + COMMENT).

Cada escritura se ejecutó en una transacción con bloque `DO` que comprueba el estado auditado, guarda el backup, aplica el cambio por identificadores exactos, verifica recuentos y aborta ante cualquier desviación.

### 1. Resultados e identidades

#### 1.1 Cabecera final mal agrupada — GP Capodarco 2026 (`ru_-1608202601`) — CERRADO

- Recuento previo: detector 6 global = 1. Fila `stage/stage`, `isFinalClassification=true`, `raceDayId=51941963-cdea-45eb-9d75-8bcfce84f675`, `stageNumber` NULL, `lockedAt` 2026-08-16, `official`, 162 filas.
- Criterio: `cc-reparacion-resultados` (cabecera final con `raceDayId` y `stageNumber` NULL). Precedente idéntico: Cyclassics Hamburgo (`ru_-1404570100`).
- Acción: `UPDATE race_uci_stages SET "raceDayId"=NULL WHERE id='ru_-1608202601'`. Backup: `entity='race_uci_stages'`, 1 fila. Aserción previa de estado y aserción posterior de puntos UCI (el trigger `race_uci_stages_points_metadata` recalcula puntos).
- Verificación: detector 6 global = 0. `lockedAt`, `rowCount` 162, ganador y `publicationStatus` sin cambios. Suma de `uciPoints` 111.00 antes y después.
- Rollback: `UPDATE race_uci_stages SET "raceDayId"='51941963-cdea-45eb-9d75-8bcfce84f675' WHERE id='ru_-1608202601';`

#### 1.2 Afiliaciones deterministas con prefijo de otro corredor (detector 7) — 273 CERRADAS, 1 PENDIENTE

- Recuento previo: 274 filas, 274 corredores, todas `year=2026`, `regular`, equipo y año del id coinciden con la fila. 272 `catalog_gold` con prefijo de un id retirado (renombrados: `alana-castrique` → `castrique-alana`, etc.), 1 `panel` con prefijo alias (`fernandez-samuel`, alias registrado de `fernandez-garcia-samuel`), 1 `catalog_gold` con prefijo de otra ficha existente (`cepeda-jefferson`, Jefferson Alveiro Cepeda, 1996-03-02, UCI 96889, distinto de `cepeda-jefferson-alexander`, 1998-06-16, UCI 160098; el `riderId` y el equipo EF son los correctos).
- Ninguna tabla referencia `rider_team_affiliations.id`.
- Acción: `UPDATE rider_team_affiliations SET id = "riderId"||'__'||"teamId"||'__'||year` para 273 filas (todas salvo `garcia-pablo-polti__team_1776705783470_ii0i0m__2026`). Backup: `entity='rider_team_affiliations'`, 273 filas; `row_data` incluye `_newId`. Aserciones: ids destino libres y únicos; `currentTeamId` de los 273 corredores idéntico antes y después (el trigger `sync_affiliation_to_current_team` recalcula).
- Verificación: detector 7 = 1 (el pendiente). Sin cambios de `currentTeamId`.
- Rollback: `UPDATE rider_team_affiliations a SET id=b.row_key FROM private.saneo_resultados_fichajes_cx_20260929_backup b WHERE b.entity='rider_team_affiliations' AND a.id=b.row_data->>'_newId';`

PENDIENTE — `garcia-pablo-polti__team_1776705783470_ii0i0m__2026`:
- El id destino `garcia-pablo__team_1776705783470_ii0i0m__2026` ya existe. Mismo corredor (`garcia-pablo`), equipo (Team Polti VisitMalta) y año:
  - fila A (prefijo ajeno): `catalog_gold`, `dateFrom`/`dateTo` NULL, creada 2026-06-08.
  - fila B (id correcto): `panel`, `dateTo=2026-07-03`, creada 2026-07-03.
- `rider_transfers` `tr_1784552446934_iym30q`: `retirement` confirmado, `season=2027`, desde Polti, `dateVisible=false`.
- `currentTeamId` actual = Polti, sostenido solo por la fila A. Eliminar A deja `currentTeamId` NULL (la fila B vence el 2026-07-03).
- Pregunta: ¿Pablo García dejó Polti el 2026-07-03 (entonces se borra A y la ficha queda sin equipo actual) o sigue hasta final de 2026 (entonces se borra A y se pone `dateTo` NULL en B)? En ambos casos se elimina A; la decisión es el `dateTo` de B.

#### 1.3 Fichas CX creadas por la ingesta (`source='results_dataride'`) — 24 CERRADAS, 396 PENDIENTES

- Recuento previo: 420 fichas (339 `cx_riders_men`, 81 `cx_riders_women`), todas sin `otherNames`, ninguna con `uciProfileId`/`uciLicenseId`. 37 contienen ya caracteres no ASCII. El inventario citaba 339 (solo hombres o recuento anterior).
- Convención verificada en `results_manual`: `otherNames` = nombre completo acentuado, también con un solo apellido; `lastName` = primer apellido.
- Evidencia usada: ficha de carretera (`riders_men`/`riders_women`) del mismo género con misma `birthDate`, misma nacionalidad y nombre plegado (`fold_name`) igual. Coinciden 24 fichas. No existe columna de código UCI común.
- Acción (una transacción): 
  - `mejias-garcia-marlies`: `lastName` «Mejias Garcia» → «Mejías»; `otherNames` = «Marlies Mejías García» (grafía de la ficha de carretera `mejias-garcia-marlies`, 1992-12-29, CU).
  - 23 fichas: `otherNames` = `firstName || ' ' || lastName` (grafía idéntica a la de carretera): alleleijn-judith, bronswijk-mike, brouwer-emma, buskermolen-sven, de-vos-mees, delme-fausto, hunchuck-steve, jacoby-francois, janssens-willem, langley-emma, lenferink-femke, lenne-arthur, lepoittevin-dubost-joris, mijnten-rinus, moen-nynke, neffgen-tim, rouinsard-felix, soulard-dorian, te-nahuis-sepp, turkstra-danny, vancompernolle-tibo, willems-meadow, wisse-nick.
  - Backup: `cx_riders_men` 17, `cx_riders_women` 7. Auditoría: 24 filas `private.cx_change_log` `operation='rider_names_review'` con `before`/`after`/`evidence` (`roadRiderId`, criterio, backup).
  - El cambio no afecta a generales: `cx_standings_changed` solo reacciona a `birthDate` y `verified`.
- Verificación: 24 fichas con `otherNames`; restantes sin `otherNames`: 322 hombres, 74 mujeres.
- Rollback: `UPDATE cx_riders_men r SET "lastName"=b.row_data->>'lastName', "otherNames"=b.row_data->>'otherNames' FROM private.saneo_resultados_fichajes_cx_20260929_backup b WHERE b.entity='cx_riders_men' AND r.id=b.row_key;` y equivalente para `cx_riders_women`.

PENDIENTE — 396 fichas sin evidencia en la BD:
- No tienen ficha de carretera coincidente ni identificador UCI. Completar `otherNames` y tildes exige fuente externa (UCI/DataRide/organizador) por ficha.
- Candidatas prioritarias (dos apellidos hispanos sin tilde, probable acentuación ausente, no verificable en BD): `gonzalez-jimenez-gabriel` (CL), `hormann-ripoll-katia` (CL), `narvaez-revilla-hugo` (ES), `sanchez-mendoza-nicole` (CL), `urzua-ovalle-juan-ignacio` (CL). Además, en estas el `lastName` contiene los dos apellidos, contra la regla CX (primer apellido en `lastName`, completo en `otherNames`).
- Pregunta: ¿se autoriza una pasada con fuente externa (ficha UCI o web federativa) para estas 396, empezando por las 5 anteriores?
- Nota `de-vos-mees`: CX «De Vos», carretera «de Vos». Diferencia de mayúscula de partícula, no de tilde; no modificado. Pregunta: ¿se normalizan las partículas neerlandesas en CX a minúscula como en carretera?
- Comprobado: `aguirre-lavin-lilou` (dataride) y `aguirre-lavin-lea` (uci_rankings) comparten nacimiento 2008-02-28 y apellidos, pero corren la misma carrera WE con dorsales 11 y 6: personas distintas. Sin acción.

### 2. Mercado de fichajes

`MARKET_SEASON = 2027` (`js/panel/constants.js`).

#### 2.1 `juaristi-txomin`: dos movimientos no `midSeason` en 2027 — CERRADO

- Recuento previo: `tr_1784552446934_47suxj` (`transfer` a `?`, confirmado, carga inicial 2026-07-20, `dateVisible=false`) y `tr_20260819_juaristi_txomin_euskaltel` (`renewal` confirmada con Euskaltel-Euskadi, `announcedAt` 2026-08-19, `contractUntil` 2028). Sin afiliación 2027. Ficha `contractUntil` NULL.
- Criterio: unicidad de `cc-fichajes` (prevalece el movimiento posterior) y efectos de la renovación confirmada.
- Acción: `DELETE` de `tr_1784552446934_47suxj`; `INSERT` afiliación de mercado `aff_1790664758625_ee9894` (Euskaltel `team_1776714490672_r88dfo`, 2027, `dateFrom` 2027-01-01, `dateTo` 2028-12-31, `manual`, `verified=true`, `regular`); `riders_men.contractUntil=2028`. Backup: `rider_transfers` (2 filas de Juaristi), `riders_men` 1, `rider_team_affiliations_inserted` 1.
- Verificación: un único movimiento no `midSeason` en 2027 (la renovación); afiliación 2027 presente; `contractUntil=2028`; `currentTeamId` Euskaltel sin cambio.
- Rollback: reinsertar `row_data` de `tr_1784552446934_47suxj`, borrar `aff_1790664758625_ee9894`, restaurar `contractUntil` NULL.

#### 2.2 `tr_1784536560160_y4oe4r` (`martin-cuevas-marco`): `midSeason` con `season=2026` — CERRADO

- Recuento previo: 1 fila `midSeason` con `season<>2027`. Movimiento BBK-Euskadi Fundazioa → Euskaltel-Euskadi, confirmado, `announcedAt` 2026-07-10, contrato 2028. Afiliaciones ya coherentes (2026 origen hasta 2026-07-24, destino desde 2026-07-25, mercado 2027 Euskaltel hasta 2028-12-31); ficha `contractUntil` 2028.
- Acción: `UPDATE rider_transfers SET season=2027`. Backup: 1 fila.
- Verificación: 0 filas `midSeason` con `season<>2027`. El movimiento pasa a ser visible en la web (feed 2027 con distintivo «M. Temporada»).

#### 2.3 `arens-megan`: `teamId` y nombre a la vez — CERRADO; `van-empel-fem` `fromTeamName='-'` — PENDIENTE

- Arens, `tr_1786526858348_9568d5`: `fromTeamName` «Picnic PostNL» con `fromTeamId=team_female_picnic_postnl`; `toTeamName` «AG Insurance-Soudal» con `toTeamId=team_1776714655588_6ae9cr`. Criterio `cc-fichajes`: con `teamId` el nombre va NULL. Acción: ambos nombres a NULL. Backup: 1 fila. Verificación: `id_and_name` sin filas de Arens.
- Van Empel, `tr_1789662012071_zeiy3g`: `transfer` `midSeason` confirmado 2027, `fromTeamId` NULL, `fromTeamName='-'`, destino FDJ United - SUEZ. El panel exige origen (id o texto) para un traspaso sin equipo asociado; `'-'` es el texto introducido para «sin equipo». Con NULL, la web mostraría «Por confirmar» (`transfers.unknownTeam`). En la BD no hay afiliación 2026 anterior a FDJ.
  - Pregunta: ¿cuál es el origen? Opciones: equipo del catálogo (p. ej. su equipo anterior, con `fromTeamId`), texto libre explícito («Sin equipo»), o conservar `'-'`.

#### 2.4 Editor de equipo del panel: «Cambia» confirmado no crea la afiliación de destino — BUG DE CÓDIGO (no corregido)

- Archivo: `js/panel/team-situation.js`, función `_tseSaveTeam()` (línea 540), rama `else if (s.state === 'change')` (líneas 596–607).
- Comportamiento: llama a `_deleteAffiliation2027(r.id, teamId, r.gender)` (borra la del equipo actual) e inserta la fila `rider_transfers` `transfer`; no llama a `_upsertAffiliation2027(r.id, r.gender, s.newTeamId, s.year)` ni a `_syncSigningAffiliation(...)` cuando `!s.rumor`.
- Defectos adicionales en la misma rama: no sincroniza `contractUntil` de la ficha (`_syncTransferContractToRider`, que sí usa la rama `stay`) pese a que `docs/memory/carretera.md` lo indica para «Cambia» confirmado; no aplica la unicidad global (`_clearOtherTransfersForRider`), solo borra los movimientos del corredor ligados al equipo editado (`_tseClearRiderTransfersForTeam`); los `insert` de `rider_transfers` en `change`, `doubt` y `end` no comprueban `error`.
- Referencias correctas: editor individual `_syncMarketSituationAffiliation(t)` (línea 491) y confirmación rápida `js/panel/fichajes.js:384` (`_syncSigningAffiliation({ ...t, status: 'confirmed' })`).
- Propuesta: en la rama `change`, si `!s.rumor`, ejecutar `await _upsertAffiliation2027(r.id, r.gender, s.newTeamId, s.year || null)` y `await _syncTransferContractToRider({ status: 'confirmed', type: 'transfer', contractUntil: s.year || null, riderGender: r.gender, riderId: r.id })`; comprobar `error` de los `insert`. Requiere `versionCode`/CHANGELOG solo si afecta a Android (no es el caso: panel web). Actualizar la fila «Cambia» de la tabla del editor en `docs/memory/carretera.md` tras el arreglo.

#### 2.5 Hallazgos nuevos fuera del manifiesto — PENDIENTES (no corregidos)

- `schrempf-carina`: `schrempf-carina-2026-sd-worx-protime` (`midSeason`, 2027) con `fromTeamId` + «Fenix-Premier Tech» y `toTeamId` + «SD Worx-Protime» (mismo defecto que Arens). Coexiste con `tr_1784552446934_3l2ki9` (baja `?` desde Fenix, carga inicial). Pregunta: ¿se anulan los nombres y se decide si la baja `?` debe sustituirse por la fila normal oculta (`midSeason=false`, `dateVisible=false`) hacia SD Worx?
- `arens-megan`: afiliación de mercado 2027 `aff_1784552446933_9ma094` a Team Picnic PostNL (origen) aunque el traspaso `midSeason` confirmado va a AG Insurance con contrato 2027. Según `cc-fichajes`, la afiliación de mercado debería ir al destino. Pregunta: ¿se sustituye por AG Insurance 2027 (`dateTo` 2027-12-31)?
- 3 `transfer` confirmados no `midSeason` 2027 con `toTeamId` y sin afiliación 2027 al destino (posible efecto del bug 2.4 o de altas por SQL): `tr_1784548615273_t5otun` okamika-ander → Euskaltel (2027); `tr_1785573557939_jj35lo` van-uden-casper → `team_1776703130449_us300h` (2029); `tr_20260820_stella_davide` stella-davide → `team_1776702951716_ezxsdy` (2029).
- 9 `renewal` 2027 confirmadas sin afiliación 2027 al equipo: craps-lars, lavik-fredrik-dversnes, ulissi-diego, brenner-marco, trentin-matteo, haller-marco, berasategi-xabier, agirre-jon, stites-tyler.
- Pregunta común: ¿se autoriza aplicar a estos 12 los efectos de `cc-fichajes` (afiliación de mercado y `contractUntil`)? No se aplicaron por quedar fuera del manifiesto y porque la skill prohíbe backfills sin movimiento explícito.

### 3. Ciclocross

#### 3.1 `cx_import_calendar`: 40 diferencias con UCI — SIN ACCIÓN; Campeonato de Australia — CERRADO SIN CAMBIO

- Las diferencias son informativas (la RPC ya no sobrescribe). Sin manifiesto UCI local en esta sesión no se re-listan.
- Australia (`baa12c5d-813e-4d9a-a36b-ca8f558af4c7`, UCI 79077): `dateKey` 2026-08-15; seis categorías con resultados `official` del 2026-08-15 (salidas UTC 00:30–05:00 del 15). `private.cx_change_log`: `save_race` del 2026-09-13 15:18 cambió 2026-08-14 → 2026-08-15; resultados manuales de `https://my.raceresult.com/413661/results/` con `dateKey` 2026-08-15. La fecha actual procede de una corrección editorial respaldada por los resultados del cronometrador; se mantiene. Si Dani prefiere la fecha UCI, la pregunta es si el calendario debe seguir a UCI aunque los resultados oficiales lleven otra fecha.

#### 3.2 Inscritos CX: `cx_prepare_startlist_import` no usa `otherNames` ni plegado — PENDIENTE (requiere cambio de función)

- Estado: `private.cx_startlist_imports` 0 filas, `cx_startlist_riders` 0 filas (flujo sin uso en producción).
- Causa: en `public.cx_prepare_startlist_import(p_race_id, p_category, p_document)` la búsqueda de candidatos compara `lower(btrim("firstName"))` y `lower(btrim("lastName"))` exactos más `nationality = row."countryCode"` (sensible a mayúsculas; las fichas CX guardan ISO en mayúsculas). No usa `public.fold_name` ni `otherNames`. La función `public.cx_rider_name_matches(p_first, p_last, p_other_names, q_first, q_last)` ya implementa plegado y alias, pero solo la usa `public.cx_ingest_results`.
- Propuesta de migración (no aplicada): en ambas subconsultas de candidatos de `cx_prepare_startlist_import`, sustituir la igualdad por `public.cx_rider_name_matches("firstName","lastName","otherNames",row."firstName",row."lastName")` y la nacionalidad por `upper(nationality)=upper(row."countryCode")`; conservar la regla de candidato único (0 o >1 → sin enlace). Añadir un caso a `supabase/tests/cc_cx_f2.sql` (nombre sin tildes y con dos apellidos enlaza por `otherNames`). La migración debe declarar los `GRANT` existentes de la función.

### Resumen de verificaciones finales

| Detector | Antes | Después |
| --- | --- | --- |
| 6 cabeceras finales mal agrupadas (global) | 1 | 0 |
| 7 afiliaciones con prefijo ajeno | 274 | 1 (garcia-pablo, pendiente) |
| CX `results_dataride` sin `otherNames` | 420 | 396 |
| `rider_transfers` no `midSeason` duplicados por corredor/temporada | 1 | 0 |
| `midSeason` con `season<>2027` | 1 | 0 |
| `teamId` + nombre en la misma fila | 2 (arens, schrempf) | 1 (schrempf, fuera de manifiesto) |
| Nombre de equipo marcador (`'-'`) | 1 | 1 (van-empel, pendiente) |

## Saneo de datos: jornadas, perfiles y editorial (2026-09-29)

Alcance: sección «Jornadas y perfiles» de `docs/informes/deuda-datos-prueba-skills-20260929.md`.
Proyecto Supabase `bcecwlkynpgovnzhbpah`, vía MCP `execute_sql`. Sin DDL de esquema público, sin cambios en el repositorio, sin tocar `assets` ni `broadcasts` (solo lectura).

Convención de backups: tablas `private.<descripcion>_20260929_backup` creadas con `CREATE TABLE AS` dentro de la misma transacción que la escritura, RLS activado, `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` (solo el propietario conserva privilegios), `COMMENT ON TABLE` con el alcance. Todas las escrituras en `race_days` actualizan `"updatedAt" = now()`, como hace el panel.

Consumo verificado antes de escribir:

- `finishLocation` NULL: web (`js/jornada.js`, `stage-card.js`, `shared.js`, `perfil-pub.js`, `mapa-pub.js`, `resultados.js`, `race-data-modal.js`), generador estático (`tools/site/gen_og_pages.py`) y apps (`RaceDay.swift`, `RaceDay.kt`) tratan NULL igual que salida = meta. `translations.en.finishLocation` no se lee en ningún consumidor.
- `profileSummits`: web, generador y apps usan `?? []` / `orEmpty()`; NULL y `[]` son equivalentes en lectura.
- `hasAssets`: solo la web lo usa para la clicabilidad (`stageIsClickable` excluye `technicalGuide` y `live_text`, igual que `cc-assets`); las apps no lo usan; el generador estático no lo lee.
- Traducciones: no existe proceso de regeneración automática en el repositorio (ni edge function ni workflow). El panel solo muestra el estado (`auto`/`manual`/`stale`/`pending`) y la web muestra `value` sin mirar `hash`. Hash: `'sha256:' || encode(sha256(convert_to(<castellano>,'UTF8')),'hex')` (contrato de `cc-editorial`). Por tanto la corrección consiste en traducir o revalidar, no en marcar.

### 1. startLocation = finishLocation

- Recuento previo: 72 jornadas (todas 2026, todas publicadas; 22 de ellas con `startLocation` y `finishLocation` vacías `''`). 19 con `finishLocationEn` informado (siempre igual a `startLocationEn`); 14 con `translations.en.finishLocation` `auto`.
- Acción: `finishLocation = NULL`; `finishLocationEn = NULL` cuando era NULL o igual a `startLocationEn`; retirada de `translations.en.finishLocation` no `manual` (`#- '{en,finishLocation}'`).
- Backup: `private.jornadas_finish_location_20260929_backup` (72 filas; columnas `startLocation`, `finishLocation`, `startLocationEn`, `finishLocationEn`, `trEnFinishLocation`, `updatedAt`).
- Verificación: 0 jornadas con `startLocation = finishLocation`; las 72 con `finishLocation` y `finishLocationEn` NULL y sin `translations.en.finishLocation`.
- Efecto en páginas estáticas: el ES no cambia (el generador ya trataba igualdad como circuito). El título EN de etapa (`gen_og_pages.py`, bloque EN, `elif finish_en: title_en += " · {finish_en}"`) pierde el sufijo de localidad en 23 etapas de vueltas; requiere build (sección 7).
- Rollback: `UPDATE race_days SET "finishLocation"=b."finishLocation", "finishLocationEn"=b."finishLocationEn", translations = CASE WHEN b."trEnFinishLocation" IS NULL THEN translations ELSE jsonb_set(translations,'{en,finishLocation}',b."trEnFinishLocation") END FROM private.jornadas_finish_location_20260929_backup b WHERE race_days.id=b.id`.

### 2. profileSummits NULL

- Recuento previo: 911 jornadas con NULL (todas 2026). El inventario daba 206 (coincide con el subconjunto «con `elevationProfile`, `profileSummits` y `profileWaypoints` NULL»). Desglose: 334 con `elevationProfile`; 577 sin perfil.
- Acción: `profileSummits = '[]'` en las 334 jornadas con `elevationProfile` (perfil trabajado; regla de `perfil-y-gpx.md`: arrays vacíos, no NULL). Las 577 sin perfil no se tocan: NULL ahí significa «sin trabajar».
- Backup: `private.jornadas_profile_summits_20260929_backup` (334 filas, con `profileSummits` y `profileWaypoints` previos).
- Verificación: 0 jornadas con `elevationProfile` y `profileSummits` NULL; 334 con `[]`. Total NULL restante: 577.
- Rollback: `UPDATE race_days SET "profileSummits"=NULL WHERE id IN (SELECT id FROM private.jornadas_profile_summits_20260929_backup)`.
- Pendiente:
  - Causa raíz en código: `js/panel/jornada-save.js` líneas 213-214 guardan `profileSummits`/`profileWaypoints` como `null` cuando la lista está vacía. Cada guardado desde el panel reintroduce NULL. Requiere cambio de código (fuera de este encargo).
  - `profileWaypoints` NULL en 241 jornadas con `elevationProfile` (misma regla; no figura en el inventario, no se ha tocado).
  - Pregunta: ¿se normalizan también a `[]` las 577 jornadas sin perfil y los 241 `profileWaypoints`, o NULL queda reservado a «perfil sin trabajar»?

### 3. hasAssets incoherente

- Recuento previo: 28 jornadas (inventario: 8), todas con `hasAssets = true` y sin documento que cuente: 19 solo con `technicalGuide`, 9 solo con `live_text` (Vuelta a Camerún). Regla: `cc-assets` paso 4.
- Acción: `hasAssets = EXISTS(assets de tipo roadbook, profile, ports, map o startOrder)`.
- Backup: `private.jornadas_has_assets_20260929_backup` (28 filas, con `assetTypes` previos).
- Verificación: 0 jornadas incoherentes en toda la tabla.
- Efecto: esas jornadas dejan de ser clicables en tarjetas web salvo que tengan perfil visible. Sin efecto en páginas estáticas ni apps.
- Aviso: otro agente trabaja en paralelo en `assets`; si añade o retira documentos por SQL sin actualizar `hasAssets`, la incoherencia puede reaparecer. Consulta de control: la de verificación de esta sección.
- Rollback: `UPDATE race_days SET "hasAssets"=true WHERE id IN (SELECT id FROM private.jornadas_has_assets_20260929_backup)`.

### 4. Campeonatos Nacionales 2026

#### 4.1 colorHex

- Recuento previo: 5 países con `colorHex` distintos. BA, GT, LT, RS: mismo color con distinta capitalización. SE (no listado en el inventario porque sus carreras mezclan `countryCode` `se` y `SE`): mismo caso. BE: tres colores distintos.
- Acción: normalización a minúsculas (forma mayoritaria: 511 de 615 CN 2026 y la que produce el selector de color del panel) en los países cuyo único conflicto era de mayúsculas: BA 4, GT 5, LT 7, RS 4, SE 2 = 22 carreras.
- Backup: `private.cn_color_hex_case_20260929_backup` (22 filas, tabla `races`).
- Verificación: el único país con más de un `colorHex` es BE.
- Rollback: `UPDATE races SET "colorHex"=b."colorHex" FROM private.cn_color_hex_case_20260929_backup b WHERE races.id=b.id`.
- Pendiente BE: `#fdda24` en élite (4), `#f23e02` en CRI sub23 masculina y femenina, `#000000` en línea sub23 masculina. El mismo patrón se repite en todas las ediciones 2020-2025, lo que indica una elección deliberada o una copia de importación. Pregunta: ¿se unifica BE 2026 (y el histórico) en `#fdda24`, o las pruebas sub23 conservan colores propios como excepción?

#### 4.2 primaryType

- Recuento previo: 284 pruebas en línea CN 2026, 217 con `primaryType` NULL (coincide con el inventario). Las 331 CRI tienen `itt`.
- Acción: ninguna. La skill exige «línea con su tipo real», que depende de fuente o perfil; solo 6 de las 217 tienen `elevationProfile`. No es determinista.
- Pregunta: ¿se deja NULL cuando no hay recorrido publicado, se asigna un tipo por defecto (p. ej. `flat`/`rolling`) o se clasifican solo las 6 con perfil? Nota: cambiar `primaryType` dispara `race_day_metrics_changed` y `private.trg_uci_points_from_race_day` (recalcula límites de tiempo y puntos UCI de la carrera).

#### 4.3 Observación fuera del inventario

- 22 carreras CN 2026 con `countryCode` en minúsculas (`ec` 6, `fi` 6, `se` 2, `us` 8), contra la regla «ISO-2 en mayúsculas». La web normaliza con `toUpperCase()`. Corrección determinista propuesta: `UPDATE races SET "countryCode"=upper("countryCode") WHERE "uciCategory"='CN' AND year=2026 AND "countryCode" <> upper("countryCode")`. No aplicada por estar fuera del manifiesto.

### 5. Bonificaciones fuera de plantilla (2026)

- Plantilla medida: `^(Hay N-N-N" en meta( y N-N-N" en <mecanismo>)?\.|No hay bonificaciones\.)$` (`cc-editorial`).
- Recuento previo: 113 jornadas, 36 textos distintos (inventario: 35).
- Acción: reescritura a la plantilla de 18 textos sin cambio de contenido (orden, comillas rectas, «en la meta»/«en la llegada» → «en meta», «No hay en toda la semana» → «No hay bonificaciones.», «dos/tres sprints intermedios» conservado como «en los dos/tres sprints intermedios»). 53 jornadas: Tour de Omán 5, Tour El Salvador 4, Tour de Lituania 5, Vuelta a Bélgica 5, Volta a Catalunya 7, Vuelta a Asturias 4, UAE Tour femenino 4, Vuelta al Alentejo 4, Carrera de la Paz 4, Volta a Portugal do Futuro 3, Tour Down Under 5, Tour Down Under femenino 3. Solo filas sin traducción `manual`. En la misma sentencia, `translations.en.bonuses` nueva (`status` `auto`, hash del castellano nuevo), con la redacción inglesa ya usada en la base para el mismo texto; se añade traducción en las 8 filas que no la tenían (Bélgica, Portugal do Futuro).
- Backup: `private.jornadas_bonuses_plantilla_20260929_backup` (53 filas; `bonuses` y `trEnBonuses` previos).
- Verificación: 53/53 dentro de la plantilla y con hash vigente. Restan 60 jornadas y 18 textos fuera de plantilla.
- Rollback: `UPDATE race_days SET bonuses=b.bonuses, translations = CASE WHEN b."trEnBonuses" IS NULL THEN translations #- '{en,bonuses}' ELSE jsonb_set(translations,'{en,bonuses}',b."trEnBonuses") END FROM private.jornadas_bonuses_plantilla_20260929_backup b WHERE race_days.id=b.id`.
- Pendiente (60 jornadas), con pregunta:
  - Aclaración añadida tras la cifra de meta (redundante con la plantilla, pero es información editorial): Tour de Francia «El sprint intermedio solo entrega puntos.» (24; 19 con traducción `manual`), Tour de Romandía «Los sprints intermedios otorgan solo puntos…» (5), Tour de Francia femenino «…en el punto de bonificación. El sprint intermedio solo entrega puntos.» (3; 1 `manual`), Baloise Ladies Tour «(no hay sprints bonificados)» (4), Belgrado-Banja Luka «(no hay sprints intermedios)» (3) y «6-4-2" en meta (es sector y no etapa completa).» (2), Vuelta a Gran Bretaña femenina etapa 4 «y no hay sprints intermedios» (1). Pregunta: ¿se suprimen estas aclaraciones y queda solo `Hay 10-6-4" en meta.`, o la plantilla admite una segunda frase aclaratoria?
  - Mecanismo compuesto: Circuit des Ardennes «tanto en el Sprints Bonus como en el GPM Bonus (uno de cada uno)» (5). Pregunta: ¿forma aceptada o `… en el Sprints Bonus y en el GPM Bonus.`?
  - Formato con lugar y km: Vuelta a Burgos etapas 1-5 (5; etapa 1 con traducción `manual`). Pregunta: ¿se reduce a `Hay 10-6-4" en meta y 3-2-1" en el sprint bonificado de <lugar>.` perdiendo los km?
  - GP Torres Vedras «Se entregan 10-6-4" … Pontos Quentes ('Puntos Calientes'), señalados en nuestros perfiles interactivos con una B.» (2, `manual`); La Vuelta etapa 21 «Hay 6-4-2" en el sprint bonificado. Las bonificaciones en meta han quedado suspendidas.» (1, `manual`, caso excepcional legítimo).
  - Reformulación sin cambio de contenido pero con traducción `manual`: Boucles de la Mayenne (3), Bretagne Ladies Tour «10-6-4" en meta.» (2). `cc-editorial` prohíbe sobrescribir una traducción `manual` sin indicación de Dani y obliga a actualizar la traducción al cambiar el castellano. Pregunta: ¿autoriza reescribir el castellano y conservar o regenerar la traducción manual?
- Observaciones fuera del inventario: 3 CRI/CRE con «No hay bonificaciones.» (la regla pide vacío); 281 etapas en línea de vueltas por etapas con `bonuses` vacío (la regla pide plantilla o «No hay bonificaciones.»), p. ej. Vuelta a Colombia etapas 6, 7 y 9.

### 6. Traducciones

#### 6.1 bonuses `auto` con hash obsoleto

- Recuento previo: 13 con hash distinto (9 con el hash correcto sin prefijo `sha256:`; 4 de la Vuelta a Burgos Féminas con hash de un castellano anterior) y 5 sin hash (Bakú-Jankendi). En las 18 el valor inglés traduce fielmente el castellano vigente.
- Acción: hash recalculado sobre el castellano vigente; `value`, `model` y `updatedAt` de la traducción sin cambios.
- Verificación: 0 `bonuses` `auto` con hash distinto del castellano.

#### 6.2 description `auto` con hash obsoleto

- Recuento previo: 63 con hash distinto y 20 sin hash = 83 (coincide con el inventario). Revisadas una a una contra el castellano vigente.
- Acción:
  - 58 fieles al castellano vigente: solo hash recalculado.
  - 25 con traducción nueva (`status` `auto`, hash del castellano, `updatedAt` actual), por:
    - Contenido distinto del castellano: `fleche-du-sud-2026-etapa-5`, `veenendaal-veenendaal-2026`, `la-vuelta-femenina-2026-etapa-6`, `clasica-castilla-y-leon-2026`, `baloise-ladies-tour-2026-prologo`.
    - `\n` literal o negritas perdidas: `arctic-race-of-norway-2026-etapa-4`, `la-polynormande-2026`, `vuelta-a-austria-2026-etapa-1` a `-5`, `vuelta-a-gran-bretana-femenina-2026-etapa-2`.
    - Markdown roto o errores léxicos: `la-vuelta-femenina-2026-etapa-1`, `tour-de-romandia-2026-prologo`, `vuelta-a-turquia-2026-etapa-1`, `classic-grand-besancon-doubs-2026` («Cup de France», «Franco-Comté»).
    - Negritas y párrafos alineados con el castellano: `epz-omloop-van-borsele-2026`, `tour-de-francia-femenino-2026-etapa-9`, `vuelta-a-gran-bretana-2026-etapa-1`, `gp-anicolor-2026-etapa-1`, `lieja-bastona-lieja-2026`, `nxt-classic-2026`, `o-gran-camino-2026-etapa-1`, `rutland-melton-classic-2026`.
  - Protección: cada fila se actualizó solo si el hash del castellano en el momento de escribir coincidía con el revisado.
- Verificación: 0 `description` `auto` con hash distinto o ausente; 25 traducciones nuevas sin `\n` literal.

#### 6.3 bonuses `manual` con castellano vacío

- Recuento previo: 14 (inventario: 14). En todas `value` es NULL: son retiradas hechas escribiendo `value: null` en lugar de borrar la clave. Jornadas: 5 pruebas de un día, 6 CRI/CRE (Baltic Chain Tour 1a, La Vuelta 1 y 18, Sibiu Tour 2, Tour of Istanbul 4, Vuelta a Alemania prólogo) y Vuelta a Colombia 6, 7 y 9.
- Acción: retirada de la clave con la forma del contrato (`translations #- '{en,bonuses}'`). No se pierde texto (no había traducción) ni se inventa castellano.
- Verificación: 0 `bonuses` `manual` con castellano vacío.

Backup común de 6.1-6.3: `private.jornadas_traducciones_20260929_backup` (107 filas; columna `translations` completa, `description`, `bonuses`, `updatedAt`). Tomado después de las secciones 1 y 5, por lo que un rollback completo debe aplicarse en orden inverso: 6 → 5 → 1.
Rollback de 6: `UPDATE race_days SET translations=b.translations FROM private.jornadas_traducciones_20260929_backup b WHERE race_days.id=b.id`.

#### 6.4 Observaciones fuera del inventario

- 8 descripciones EN `auto` con hash vigente contienen `\n` literal visible en la web inglesa: `arctic-race-of-norway-2026-etapa-1` a `-3`, `cyclassics-hamburgo-2026`, `vuelta-a-la-republica-checa-czech-tour-2026-etapa-1` a `-4`. Corrección determinista: `replace(value, '\n', E'\n')` sin cambiar el hash.
- `translations.en.finishLocation` con `value` vacío en `tour-de-gyeongnam-2026-etapa-1` a `-5`; `tour-de-francia-2026-etapa-21` con `finishLocation` vacío y traducción `Paris (Champs-Élysées)`.
- 398 jornadas 2026 con `finishLocation = ''` en lugar de NULL: el panel guarda cadena vacía (`js/panel/jornada-save.js` línea 194). Consumidores las tratan igual que NULL.

### 7. Regeneración web pendiente

La web dinámica lee los cambios en vivo. Las páginas estáticas cambian en 48 jornadas y requieren `build-site.yml` (no ejecutable en esta sesión: sin `gh`):

- Título EN sin sufijo de localidad tras `finishLocation` NULL (23): `bretagne-ladies-tour-2026-etapa-2,faun-tour-femmes-2026-etapa-2,faun-tour-femmes-2026-etapa-3,faun-tour-femmes-2026-etapa-4,giro-della-valle-daosta-2026-etapa-3,itzulia-basque-country-2026-etapa-3,itzulia-basque-country-2026-etapa-4,itzulia-basque-country-2026-etapa-5,la-vuelta-2026-etapa-21,tour-de-mauricio-2026-etapa-1,tour-de-mauricio-2026-etapa-2,tour-de-mauricio-2026-etapa-4,tour-down-under-2026-etapa-1,tour-down-under-2026-etapa-5,tour-down-under-femenino-2026-etapa-1,tour-el-salvador-2026-etapa-4,tour-of-magnificent-qinghai-2026-etapa-1,volta-a-catalunya-2026-etapa-1,vuelta-a-albania-2026-etapa-4,vuelta-a-gran-bretana-femenina-2026-etapa-1,vuelta-a-rumania-2026-etapa-5,vuelta-a-turquia-2026-etapa-7,vuelta-a-turquia-2026-etapa-8`
- Descripción EN nueva (25): `arctic-race-of-norway-2026-etapa-4,baloise-ladies-tour-2026-prologo,clasica-castilla-y-leon-2026,classic-grand-besancon-doubs-2026,epz-omloop-van-borsele-2026,fleche-du-sud-2026-etapa-5,gp-anicolor-2026-etapa-1,la-polynormande-2026,la-vuelta-femenina-2026-etapa-1,la-vuelta-femenina-2026-etapa-6,lieja-bastona-lieja-2026,nxt-classic-2026,o-gran-camino-2026-etapa-1,rutland-melton-classic-2026,tour-de-francia-femenino-2026-etapa-9,tour-de-romandia-2026-prologo,veenendaal-veenendaal-2026,vuelta-a-austria-2026-etapa-1,vuelta-a-austria-2026-etapa-2,vuelta-a-austria-2026-etapa-3,vuelta-a-austria-2026-etapa-4,vuelta-a-austria-2026-etapa-5,vuelta-a-gran-bretana-2026-etapa-1,vuelta-a-gran-bretana-femenina-2026-etapa-2,vuelta-a-turquia-2026-etapa-1`

48 slugs superan el máximo de 30 del build incremental: dos ejecuciones `gh workflow run build-site.yml --ref main -f stage_slugs=<lista>` (una por lista) o un build completo sin `-f`.

Observación sobre el generador: el título EN de etapa (`tools/site/gen_og_pages.py`, bloque EN) añade la localidad solo si hay `finishLocation`; con meta NULL omite también la salida, mientras el título y la miga ES usan `startLocation`. Afecta ya a las 637 jornadas 2026 con meta NULL previa. Corrección de código fuera de este encargo.

### Tablas de backup creadas

| Tabla | Filas | Tabla origen |
| --- | --- | --- |
| `private.jornadas_finish_location_20260929_backup` | 72 | `race_days` |
| `private.jornadas_profile_summits_20260929_backup` | 334 | `race_days` |
| `private.jornadas_has_assets_20260929_backup` | 28 | `race_days` |
| `private.cn_color_hex_case_20260929_backup` | 22 | `races` |
| `private.jornadas_bonuses_plantilla_20260929_backup` | 53 | `race_days` |
| `private.jornadas_traducciones_20260929_backup` | 107 | `race_days` |

## Saneo de assets y emisiones (2026-09-29)

Alcance: secciones «Assets» y «Emisiones» de
`docs/informes/deuda-datos-prueba-skills-20260929.md`. Proyecto
`bcecwlkynpgovnzhbpah`, vía MCP `execute_sql`. Sin escrituras en `race_days`,
resultados, R2 ni Storage. Sin migraciones. Sin cambios en el repositorio.

Tablas de backup creadas (RLS activado, `REVOKE ALL` a `PUBLIC`, `anon`,
`authenticated` y `service_role`; solo el propietario `postgres`):

- `private.broadcasts_saneo_20260929_backup`: 12 filas (columnas de
  `broadcasts` + `backedUpAt` + `motivo`).
- `private.assets_source_type_20260929_backup`: 37 filas (columnas de
  `assets` + `backedUpAt`).

### Emisiones

#### E1. `TNT Sports / HBO Max` (Dauphiné, junio): aplicado

- Recuento previo: 3 filas `UK_IE`, `url` NULL, misma hora que su
  `Eurosport (HBO Max)`/`EUROPA` (ids `50b59f4a…`, `b855f08f…`, `0afd9546…`;
  etapas 1–3 de `tour-auvernia-rodano-alpes-dauphine-2026`).
- Regla: canal canónico `TNT Sports (HBO Max)` + `UK_IE` + URL
  `https://www.hbomax.com/gb/en/sports/cycling` (cc-broadcasts).
- SQL: `UPDATE broadcasts SET channel='TNT Sports (HBO Max)', url='https://www.hbomax.com/gb/en/sports/cycling' WHERE id IN (3 ids) AND channel='TNT Sports / HBO Max' AND url IS NULL`.
  3 filas. `sortOrder` sin cambios.
- Verificación: 0 filas con `TNT Sports / HBO Max`.

#### E2. `Eurosport (HBO Max)`/`ALL` (Polonia femenina): aplicado

- Recuento previo: 1 fila (`17daeecf…`, `vuelta-a-polonia-femenina-2026-etapa-3`),
  con pareja TNT a la misma hora.
- SQL: `UPDATE broadcasts SET country='EUROPA' WHERE id='17daeecf…' AND country='ALL'`. 1 fila.
- Verificación: 0 filas `Eurosport (HBO Max)` con `country<>'EUROPA'`.

#### E3. `country` NULL: aplicado

- Recuento previo: 8 filas. Valor asignado según el grupo del mismo canal en el
  resto de la tabla y la regla «YouTube → `ALL`»:

| id | jornada | canal | country |
| --- | --- | --- | --- |
| `46acbe21…` | eschborn-frankfurt-2026 | HR | `DE_AT_CH` (precedente `HR (ARD)`) |
| `bcfd193a…` | eschborn-frankfurt-2026 | Caracol | `LATAM` (39 filas previas) |
| `4ebd21c5…` | festival-elsy-jacobs-garnich-2026 | Motomediateam (YouTube) | `ALL` |
| `013018b3…` | la-vuelta-femenina-2026-etapa-1 | Teledeporte / RTVE Play | `ES` |
| `ac993765…` | la-vuelta-femenina-2026-etapa-7 | Teledeporte / RTVE Play | `ES` |
| `ba2023ba…` | vuelta-a-grecia-2026-etapa-3 | Canal Deporte | `ES` |
| `37bef695…` | tour-of-shanghai-2026-etapa-2 | YouTube | `ALL` |
| `e8bab452…` | gp-industria-artigianato-larciano-2026 | Lega Ciclismo Professionistico (YouTube) | `ALL` |

- SQL: `UPDATE broadcasts b SET country=v.c FROM (VALUES …) v WHERE b.id=v.id AND b.country IS NULL`. 8 filas.
- Verificación: 0 filas con `country` NULL.

E1–E3 en una sola transacción con comprobación de `ROW_COUNT` (3, 1, 8) y
backup previo de las 12 filas en `private.broadcasts_saneo_20260929_backup`.

#### E4. Filas `Eurovision Sport`/`EUROPA`: pendiente

- Recuento: 4 filas, únicas emisiones de sus jornadas; `showInRevive=true`,
  `tvStatus='confirmed_time'` en las cuatro jornadas:
  `33b9d7ae…` (juegos-del-mediterraneo-cri-femenino-2026, 2026-08-22 09:00 UTC),
  `3631b429…` (cri-masculino, 2026-08-22 11:25), `25e4b3e9…` (linea-femenino,
  2026-08-24 07:00), `9187c74c…` (linea-masculino, 2026-08-24 11:00). URLs
  `eurovisionsport.com/es/mediacard/…` responden 200 («Watch live and free on
  Eurovision Sport»).
- Motivo: la regla exige que no existan filas con ese canal. Borrarlas deja
  cuatro jornadas con `tvStatus='confirmed_time'` y ninguna emisión, y la
  corrección de `race_days` queda fuera de este alcance. No hay fuente oficial
  de un emisor sustituto (p. ej. RAI) que permita reemplazarlas de forma
  determinista.
- Pregunta a Dani: ¿se borran las 4 filas y se pasa `tvStatus` de las 4 jornadas
  a NULL (o `none`), o se sustituyen por el emisor real con fuente oficial que
  indiques (canal, territorio, URL)?

#### E5. 171 `Eurosport (HBO Max)` sin pareja TNT anteriores a julio: no tocado

- Recuento: 174 antes del saneo; 171 después de E1 (las 3 de Dauphiné ya
  forman pareja exacta). Desde 2026-07-01: 0 sin pareja.
- Distribución (fecha de jornada, sin pareja exacta): enero 17, febrero 4,
  marzo 40, abril 46, mayo 52, junio 12. De ellas, 151 no tienen ninguna fila
  TNT; 20 (Giro, Vuelta femenina, Tro-Bro Léon, Valonia) tienen
  `TNT Sports (HBO Max)`/`UK_IE` con hora propia distinta de Eurosport
  (entre −30 y +150 min) y URL `https://www.tntsports.co.uk`.
- Motivo: la pareja con hora idéntica se aplica de forma sistemática desde julio
  de 2026. Antes, TNT figuraba con su horario lineal propio o no figuraba. Crear
  151 filas o igualar 20 horas en jornadas pasadas no deriva de fuente oficial.
- Pregunta a Dani: ¿se da por buena la regla solo desde 2026-07-01 (anotarlo en
  cc-broadcasts), o se retroaplica a las jornadas anteriores?

#### E6. Discrepancia en `docs/runbooks/broadcasts-vps.md`: propuesta de texto

Líneas 207–209 actuales:

```
  un `showInRevive=true` existente a `false`. RTVE y Eurovision Sport solo son
  Revive cuando sus datos lo declaran; HBO Max y redes sociales mantienen sus
  reglas automáticas.
```

Reemplazo:

```
  un `showInRevive=true` existente a `false`. RTVE solo es Revive cuando sus
  datos lo declaran; HBO Max y redes sociales mantienen sus reglas automáticas.
  Eurovision Sport no es un emisor: no se crean filas con ese canal.
```

La misma mención figura en `docs/memory/broadcasts.md`, línea 85:

```
es la regla remota autoritativa para RTVE, Eurovision Sport y cualquier fuente
```

Reemplazo:

```
es la regla remota autoritativa para RTVE y cualquier fuente
```

`docs/changelog/tecnico/hasta-2026-08.md` (línea 605) conserva la mención como
histórico; no requiere cambio.

#### Hallazgos adicionales fuera del manifiesto (no tocados)

- 3 `TNT Sports (HBO Max)` de julio con URL `https://www.tntsports.co.uk/`
  (una es la pareja de E2), 1 de junio con `play.hbomax.com/sport/{uuid}` y
  11 de mayo–junio con URL NULL; la regla fija
  `https://www.hbomax.com/gb/en/sports/cycling`.
- Nombres no canónicos del emisor español: `Teledeporte / RTVE Play` (26),
  `Teledeporte / TDP Play` (Dauphiné), `RTVE Play`; la regla admite
  `TDP / RTVE Play` o `RTVE`. `HR` frente a `HR (ARD)`; `Motomediateam` frente
  a `Motomediateam (YouTube)`.

### Assets

#### A1. `sourceType` antiguo: aplicado

- Recuento previo: 37 filas (`image` 21, `pdf` 15, `official` 1), todas con URL
  en R2, jornadas de 2026-02-16 a 2026-05-24. El inventario indicaba 43; la
  medición actual da 37 y no hay otros valores distintos de `external`.
- Regla: vocabulario único `external` (default de la columna, cc-assets, panel y
  RPC). Ningún cliente (web, iOS, Android) lee `sourceType` para decidir
  comportamiento.
- SQL: `UPDATE assets SET "sourceType"='external' WHERE id IN (backup) AND "sourceType" IN ('pdf','image','official')`.
  37 filas, transacción con backup previo en
  `private.assets_source_type_20260929_backup`.
- Verificación: `assets."sourceType"` = `external` en 3958/3958 filas.

#### A2. Guía técnica de `vuelta-al-ecuador` en `stage-1/ports.pdf`: pendiente (R2)

- Fila `a61b157a…` (`technicalGuide`, `vuelta-al-ecuador-2026-etapa-1`) →
  `races/vuelta-al-ecuador/2026/stage-1/ports.pdf`.
- Comprobación R2: el archivo (200, 9,4 MB, 56 páginas) es la guía técnica
  completa (simbología, mapa general, altimetrías, mapa y minuto a minuto de
  las etapas 1–7, reglamento, premios). `technicalGuide.pdf`, `-2` y `-3`: 404.
  No existe fila `ports` en esa carrera.
- Estado: el contenido enlazado es correcto; solo la clave no es canónica.
  Corregirla exige subir el mismo archivo a
  `races/vuelta-al-ecuador/2026/technicalGuide.pdf` y actualizar la fila;
  sin credenciales R2 en este entorno.
- Pendiente: copiar `stage-1/ports.pdf` → `technicalGuide.pdf`, verificar GET
  200 y `UPDATE assets SET url='https://assets.calendariociclismo.app/races/vuelta-al-ecuador/2026/technicalGuide.pdf' WHERE id='a61b157a-d513-48b3-9686-87f7dfa31761'`.
  Decidir si se conserva la clave antigua (no hay filas `ports` que la usen).

#### A3. `roadbook` de `tour-of-shanghai` etapa 3 en `technicalGuide-2.pdf`: pendiente (R2)

- Fila `f2589749…` (`roadbook`, `tour-of-shanghai-2026-etapa-3`) →
  `races/tour-of-shanghai/2026/technicalGuide-2.pdf`.
- Comprobación R2: el archivo (200, 21,1 MB, 4 páginas, título «2026 - Tour of
  Shangai (arrastrado) 2») es el rutómetro de la etapa 3 Fengxian-Nanhui,
  6 de septiembre. `stage-3/roadbook.pdf` y `roadbook-2.pdf`: 404. La guía
  técnica completa está en `technicalGuide-3.pdf` (59 págs., 133 MB) y
  `technicalGuide-4.pdf` (59 págs., 29 MB, la enlazada por la fila
  `technicalGuide`).
- Estado: contenido correcto, clave no canónica. Corregirla exige subir a
  `races/tour-of-shanghai/2026/stage-3/roadbook.pdf` (21,1 MB ≥ 20 MB: aplicar
  la compresión de `ingesta.md`) y actualizar la fila `f2589749-f400-483b-ac60-ce2c8e82d35a`.

#### A4. Perfiles en PDF/WEBP: pendiente (decisión de Dani + R2)

- Recuento (`type='profile'`, jornadas de 2026): PDF 356 (142 desde junio,
  136 desde julio, 3 futuras); WEBP 28 (18 desde junio, 8 desde julio,
  6 futuras). Todas en R2.
- Pregunta a Dani: ¿se convierten a JPG/PNG solo los futuros (3 PDF + 6 WEBP),
  los de desde junio (142 + 18) o todos (356 + 28)? La conversión exige
  rasterizar, subir nuevas claves y actualizar filas.

#### A5. `ports` en JPG/PNG: pendiente (decisión de Dani + R2)

- Recuento 2026: JPG 11, PNG 18 (13 desde junio: 6 JPG, 7 PNG); ninguna futura.
- Regla: un único PDF multipágina con fichas del organizador; nunca recortes del
  perfil. Convertir una imagen a PDF no garantiza que sea ficha del organizador.
- Pregunta a Dani: ¿se revisan y convierten a PDF, o se dejan como histórico?

#### A6. Documentos con URL externa: pendiente (R2)

| id | jornada | tipo | URL | estado |
| --- | --- | --- | --- | --- |
| `b4f053c7…` | tour-de-la-guadeloupe-2026-etapa-1 | technicalGuide | `letour-guadeloupe.fr/revue-tour.html` | 200 HTML (página, no PDF) |
| `e8f01fff…` | kreiz-breizh-2026-etapa-1 | technicalGuide | `sitekbe.com/…/ROADBOOK-KBE-2026-web-Vdef-1.pdf` | 200 PDF 21,9 MB |
| `df13bff9…` | arno-wallaard-memorial-2026 | technicalGuide | `arnowallaardmemorial.nl/…/Draaiboek-AWM-2026-NL.pdf` | 202 |
| `679bb3ff…` | arno-wallaard-memorial-2026 | roadbook | ídem `#page=16` | ídem |
| `5cbf864d…` | arno-wallaard-memorial-2026 | map | ídem `#page=12` | ídem |

- Ninguna clave canónica existe en R2 (404).
- Pendiente: descargar, subir a `races/tour-de-la-guadeloupe/2026/technicalGuide.pdf`
  (requiere localizar el PDF en la página), `races/kreiz-breizh/2026/technicalGuide.pdf`
  (comprimir: ≥ 20 MB), `races/arno-wallaard-memorial/2026/technicalGuide.pdf`;
  extraer la pág. 16 como `roadbook.pdf` y la pág. 12 como `map.{ext}` de
  Arno Wallaard; actualizar las 5 filas.
- Fuera del manifiesto: 5 `roadbook` de `tour-du-loir-et-cher-2026` (etapas 1–5)
  apuntan a un artículo de `lanouvellerepublique.fr` (403 sin navegador); no es
  fuente oficial ni documento rehospedado.

#### A7. `races.logoUrl` en `ta2026.com`: rehospedados en R2

- Recuento: 4 carreras (`juegos-del-mediterraneo-{cri,linea}-{femenino,masculino}-2026`),
  URL `https://www.ta2026.com/wp-content/uploads/2024/05/cropped-fav_ta2026.png`
  (200, PNG 39 KB, 512×512 RGBA, logo oficial completo de Taranto 2026).
- Retirada inicial: `logoUrl` NULL, respaldo `private.logos_externos_20260929_backup`.
- Rehospedaje (2026-09-29): PNG compuesto sobre fondo blanco y exportado a JPG
  512×512 opaco (calidad 90, 44 KB), subido a R2 como
  `1790667060273-logo-{races.slug}.jpg` (una clave por fila de `races`, GET 200
  `image/jpeg`) y asignado a `logoUrl` de las 4 filas del respaldo.

### Estado final

| Hallazgo | Estado | Filas |
| --- | --- | --- |
| E1 TNT canónico | aplicado | 3 |
| E2 Eurosport `ALL` → `EUROPA` | aplicado | 1 |
| E3 `country` NULL | aplicado | 8 |
| E4 Eurovision Sport | pendiente, decisión | 4 |
| E5 Eurosport sin pareja pre-julio | no tocado, decisión | 171 |
| E6 runbook | texto propuesto | — |
| A1 `sourceType` | aplicado | 37 |
| A2 guía Ecuador | pendiente, R2 | 1 |
| A3 rutómetro Shanghai E3 | pendiente, R2 | 1 |
| A4 perfiles PDF/WEBP | pendiente, decisión + R2 | 142 + 18 desde junio |
| A5 ports JPG/PNG | pendiente, decisión + R2 | 13 desde junio |
| A6 documentos externos | pendiente, R2 | 5 |
| A7 logos ta2026.com | rehospedados en R2 | 4 |

Reversión: los backups conservan las filas completas previas; restaurar con
`UPDATE public.<tabla> t SET … FROM private.<backup> k WHERE t.id=k.id`.
