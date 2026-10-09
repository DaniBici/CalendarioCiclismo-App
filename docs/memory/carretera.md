# Carretera

Referencia de reglas y datos de carretera: carreras y jornadas, corredores, equipos e inscritos, orden de salida, perfil de jornada, resultados manuales y fichajes de mitad de temporada. El contrato de datos y el procedimiento del agente viven en las skills `cc-*` (`.agents/skills/`, tabla en `AGENTS.md`); esta nota no los sustituye.

Procedimientos que se ejecutan por separado:

- [Resultados automáticos en el VPS](../runbooks/results-vps.md).
- [Catálogo UCI diario en el VPS](../runbooks/uci-catalog-vps.md).
- [Sincronización de emisiones en el VPS](../runbooks/broadcasts-vps.md); referencia de emisiones en [broadcasts.md](broadcasts.md).
- [Calendario UCI de carretera](../runbooks/calendario-uci-carretera.md): volcado anual de fichas fuera del WorldTour.

Historia: [importación de inscritos y resultados, 2026-09-04](../informes/importacion-inscritos-resultados-20260904.md), [carga de stagiaires 2026](../informes/stagiaires-2026-20260904.md) y [saneo de resultados, 2026-06-11](../informes/saneo-resultados-20260611.md).

Secciones: [Carreras y jornadas](#carreras-y-jornadas) · [Corredores](#corredores) · [Equipos e inscritos](#equipos-e-inscritos) · [Orden de salida](#orden-de-salida-cri--cre) · [Detección de puertos](#detección-de-puertos-y-perfil-de-elevación) · [Guía simplificada](#guía-simplificada-de-horarios-de-paso) · [Resultados](#resultados-fuentes-e-importación-manual) · [Mercado de fichajes](#mercado-de-fichajes)

## Carreras y jornadas

### Alta de carrera o etapa en el panel

**Cuándo:** Añadir una carrera nueva a la temporada, añadir etapas a una carrera existente o actualizar datos de jornadas publicadas.
**Tiempo estimado:** 5-20 min según la cantidad de etapas.
**Riesgo:** bajo.
**Requisitos previos:** Acceso al panel editorial (`/panel/app.html`), credenciales de Supabase.

#### Pasos — Carrera nueva

1. Panel → pestaña **Carreras** → botón **Nueva carrera**.
2. Rellenar campos obligatorios: nombre, categoría UCI, país, género, formato (`stage_race` / `one_day`), fechas de inicio/fin.
3. Si la carrera tiene logo, subirlo desde el campo **Logo** (se sube a R2 automáticamente).
4. Guardar. La carrera aparece en la lista con `editorialStatus = draft`.
5. Añadir las jornadas: botón **+ Etapa** por cada día de competición (o descanso).
6. Por cada jornada rellenar: número de etapa, salida, meta, km, tipo principal/secundario, hora de salida neutralizada, hora estimada de llegada.
7. Añadir emisiones TV si se conocen: canal, hora de inicio UTC, URL.
8. Cuando el contenido está listo: cambiar `editorialStatus` a `published`.
9. Verificar en la web pública que aparece en la vista del día correspondiente.

#### Pasos — Etapas nuevas en carrera existente

1. Panel → buscar la carrera → **Editar**.
2. Botón **+ Etapa** → rellenar campos.
3. Guardar cada etapa individualmente.
4. Si la carrera ya estaba publicada, las etapas nuevas son visibles de inmediato.

#### Pasos — Actualización de datos en tiempo real (durante la carrera)

1. Panel → **Etapas del día** → seleccionar jornada.
2. Actualizar `estimatedFinishTimeUtc` si la organización cambia el horario.
3. Añadir emisiones TV de última hora.
4. Añadir assets (perfil, mapa, orden de salida) desde la sección **Assets**.
5. Guardar. Los cambios son inmediatos en todas las plataformas (sin caché agresiva en datos de carreras).

#### Verificación

- La jornada aparece en la vista **Hoy** de la web en la fecha correspondiente.
- La jornada aparece en iOS y Android tras refrescar (pull-to-refresh).
- Las emisiones TV se muestran en la ficha de jornada.
- Los assets se pueden abrir desde el botón correspondiente.

#### Si falla

- **Jornada no aparece en la web** → Verificar `editorialStatus = 'published'` y que `dateKey` tiene el formato `YYYY-MM-DD`.
- **Logo no se muestra** → Verificar que la URL en `races.logoUrl` apunta a `assets.calendariociclismo.app`.
- **Error al guardar emisiones** → Revisar consola del navegador; los errores de RLS de Supabase aparecen ahí.
- **Doble sector sin sufijo A/B** → `RaceLogic.annotateDoubleSectors` asigna sufijos solo cuando hay ≥ 2 etapas con el mismo `stageNumber` y mismo `dateKey` en la misma carrera. Verificar esos campos.

### Logos de carrera — 3 capas de almacenamiento

`RaceLogo` (iOS: `Views/Components/RaceLogo.swift` · Android: `ui/components/RaceLogo.kt`) resuelve en este orden:

1. **Bundle empaquetado** — `ios-app/CalendarioCiclismo/BundledLogos/` y `android-app/app/src/main/assets/bundled_logos/`. Embebido en el binario. Permite render sin red en el primer arranque.
2. **Caché offline en disco** — `OfflineCache/Images/logo_<sha1Prefix(url)>.<ext>`. Solo se rellena si el modo offline está activo (sync diario: `OfflineManager` iOS / `OfflineSyncWorker` Android).
3. **URL remota** (Cloudflare R2) — fallback con `CachedAsyncImage` (iOS) / Coil (Android).

**Hash compartido:** `sha1(url)[:20]` idéntico en `CacheManager.logoFilename` (iOS), `ImageAssetCache` (Android) y `scripts/fetch-logos.mjs`/`bundle-logos.yml`. Si cambia en uno, hay que tocar los tres.

#### ⚠️ De dónde salen los logos del bundle (cambió el 2026-07-18)

Los logos de carrera son **obras de terceros** (organizadores, federaciones) → con el repo público bajo AGPL **NO se redistribuyen**: `ios-app/CalendarioCiclismo/BundledLogos/` y `android-app/app/src/main/assets/bundled_logos/` están en **`.gitignore`** (solo se versiona un `.gitkeep`). Se **reconstruyen** desde `races.logoUrl` en Supabase (la fuente de verdad; antes se descargaban de R2 y se **commiteaban** al repo — eso ya NO se hace):

- **Local (día a día):** `node scripts/fetch-logos.mjs` **antes** de compilar iOS/Android. Sin binarios de sistema, no optimiza. `--force` re-descarga, `--prune` borra los que ya no están en BD.
- **iOS release (Xcode Cloud):** `ios-app/ci_scripts/ci_pre_xcodebuild.sh` descarga los logos con `python3` justo antes del build (no bloqueante: si falla, el bundle queda con lo que hubiera y las apps caen a la capa 3 = red).
- **Bundle optimizado (opcional):** `bundle-logos.yml` (cron **DESACTIVADO**; solo `workflow_dispatch`) además redimensiona a 192 px y comprime con `pngquant`+`oxipng`, y publica el resultado como **artefacto** (ya **NO** commitea al repo). Requiere binarios de sistema.

**iOS — `BundledLogos` es una REFERENCIA DE CARPETA, no una lista de archivos.** En `ios-app/project.yml` va como `type: folder` (excluido del escaneo recursivo de `CalendarioCiclismo`) → el `.pbxproj` tiene **una** entrada de carpeta, no ~500 `PBXFileReference`. Así el build empaqueta lo que haya en disco (o nada). **Motivo:** cuando los logos se enumeraban archivo a archivo, cada vez que un `logoUrl` cambiaba (nuevo hash) o se purgaba, el `.pbxproj` quedaba apuntando a ficheros inexistentes y el build fallaba con `The file logo_….webp couldn't be opened because there is no such file` (roto al mover los logos a `.gitignore`, 2026-07-18). **NO volver a enumerar los logos en el proyecto**: si `setup.sh`/xcodegen empieza a listarlos otra vez, revisar que la exclusión `- BundledLogos` + el source `type: folder` siguen en `project.yml`. Android no sufre esto: los `assets/` se empaquetan como carpeta por naturaleza.

**Esquema offline v2:** `OfflineManager.cacheSchemaVersion = 2` añadió descarga de logos. Bump al añadir nuevos tipos de artwork descargado.

### Assets documentales de jornadas

**DB:** `assets` (`id`, `raceDayId`, `type`, `sourceType='external'`, `url`). Flag denormalizado: `race_days.hasAssets` (no lo activa `live_text`).

**Storage:** Cloudflare R2 vía `supabase/functions/r2-upload/index.ts`. URL: `https://assets.calendariociclismo.app/{ts}-{slug}.{ext}`.

#### Tipos, orden y labels

| Tipo | Etiqueta | iOS SF Symbol | Android Material | En competición |
|---|---|---|---|---|
| `startOrder` | Orden Salida | `timer` | `Icons.Filled.Timer` | No |
| `roadbook` | Rutómetro | `doc.text` | `Icons.Filled.Description` | Sí |
| `profile` | Perfil | `chart.line.uptrend.xyaxis` | `Icons.Filled.ShowChart` | Sí |
| `ports` | Puertos | `mountain.2` | `Icons.Filled.Terrain` | No |
| `map` | Mapa | `map` | `Icons.Filled.Map` | Sí |
| `live_text` | Live texto | `text.bubble` | `Icons.Outlined.ChatBubbleOutline` | No |

Orden en jornada: Inscritos → `startOrder` → `roadbook` → `profile` → `ports` → `map` → `live_text`.

`profile` + `ports` coexistiendo en web (`js/jornada.js`, `js/race-data-modal.js`) → dos botones separados "Perfil" y "Puertos" (o "Sterrato"/"Ribinou" si `primaryType === 'sterrato'`).

Añadir tipo nuevo → tocar constantes en las 3 plataformas + `assetDocTypes` en `js/panel/jornada-save.js`.

### Botón Web oficial en jornadas

`races.websiteUrl` (TEXT, migración `010_races_website_url.sql`) — primer botón de "Documentación", antes de Inscritos. Enlace externo siempre. Replicado en panel (`er-website`), web (`js/jornada.js`, `js/race-data-modal.js`), iOS (`Race.swift` + `StageDetailView.swift`, icono `globe`), Android (`Race.kt` + `RaceEntity.kt` + `StageScreen.kt`, icono `Icons.Outlined.Language`).

- El campo vive en `races`, no en `race_days`.
- La condición de visibilidad de "Documentación" debe incluir `race?.websiteUrl != nil/null`.
- Room version bump (2→3) al añadir la columna.

### Override de país por jornada (`race_days.countryCode`)

Sobrescribe **solo la bandera visual**. Nunca afecta filtros de país. Migración `011_race_days_country_code.sql`. Room bump 3→4.

- **Override vence a `hideFlag`:** si `race.hideFlag = true` pero `rd.countryCode` tiene valor, esa jornada sí muestra bandera. Regla: `race.hideFlag && !rd.countryCode` (web) / `race.hideFlag != true || rd.countryCode != nil` (iOS/Android).
- **Helper web:** `effectiveCountryCode(rd, race)` en `js/shared.js` → `rd.countryCode || race.countryCode`.
- **Dónde aplica:** Hoy (cards), Mes (modo agenda), Jornada (cabecera), modal `race-data-modal.js`.
- **Dónde NO aplica:** vista de competición, Temporada, Buscar, PlaceholderModal.
- **iOS/Android:** patrón `rd.countryCode ?? race?.countryCode`.
- `race-data-modal.js` pinta la cabecera dos veces para evitar parpadeo — no simplificar.
- **Dropdown de país en el panel: `position: fixed` anclado al `body`.** `.editor-section` tiene `overflow: hidden`, lo que clipa dropdowns en `absolute`.

### Botones de resultados

No hay enlaces a fuentes externas (fuentes externas): las columnas
`races.extId` y `races.extSlug` se retiraron en la migración
`20260918210000_drop_race_external_result_ids.sql`.

Web, iOS y Android muestran el CTA "Ver clasificaciones" solo cuando la jornada
tiene clasificaciones propias (`race_uci_stages.keepForWeb`); sin ellas no hay
botón. El CTA abre la pantalla/página nativa de resultados. La jornada cancelada
conserva su CTA propio (aviso + generales arrastradas).

## Corredores

Introducida en `058_riders.sql`. Ampliada en `060_riders_source_verified_and_indexes.sql` y `061_startlist_riders_resolved_view.sql`. Permite normalizar nombres de corredores en startlists sin tener que corregir manualmente en cada carrera, y sustenta la futura página individual `/rider/<id>`.

### Esquema

Dos tablas separadas (`riders_men`, `riders_women`) con las mismas columnas:

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | TEXT PK | Slug: `tadej-pogacar`. Colisión de nombre+apellido → añadir año: `carlos-rodriguez-1997` |
| `firstName` | TEXT | Nombre canónico (formato título) |
| `lastName` | TEXT | Apellido canónico (formato título) |
| `otherNames` | TEXT | Comas: alias para matching. Ver sección abajo. |
| `nationality` | TEXT | ISO 3166-1 alpha-2: `es`, `fr`, `si` |
| `birthDate` | DATE | `YYYY-MM-DD` |
| `currentTeamId` | TEXT FK→teams | Equipo actual. `ON DELETE SET NULL`. |
| `source` | TEXT | Origen: `external_import`, `manual`, `startlist_auto`, `secondary_import`. Default `manual`. |
| `verified` | BOOLEAN | `true` cuando el admin ha revisado/confirmado los datos. Auto-creados de startlist arrancan en `false`. Default `true`. |
| `uciProfileId` | TEXT | Identificador interno numérico de la ficha pública UCI (`/rider-details/<id>`). No es el código de licencia. Único cuando está informado. |

Las tablas no almacenan actualmente el código UCI de licencia de 11 cifras. La retirada está documentada en [`docs/informes/retirada-uci-id-20260830.md`](../informes/retirada-uci-id-20260830.md). `uciProfileId` se conserva como referencia de la ficha pública cuando existe.

`startlist_riders.globalRiderId` (TEXT, sin FK estricta para permitir riders huérfanos durante migraciones) almacena el ID del rider de la BD que se matcheó al guardar una startlist. Índice parcial `idx_startlist_riders_global_rider_id` para acelerar joins.

### Vista `startlist_riders_resolved`

Vista pública (migración 061) que sirve a la web y las apps. Hace `COALESCE` entre la BD canónica y el snapshot de `startlist_riders`:

- **Si hay `globalRiderId`** → `firstName`/`lastName` vienen de `riders_men/women`.
- **Si no** → caen al snapshot del propio `startlist_riders`.
- **`countryCode`** se invierte: el override de la startlist (selecciones nacionales, Mundial, JJOO) GANA sobre la nacionalidad de BD.
- Expone también `verified`, `source`, `birthDate`, `currentTeamId`, `race_gender`.

Shape compatible con `startlist_riders` para que las apps puedan migrar sin tocar DTOs.

**Quién lee qué:**
- Web `js/inscritos.js` + panel "Orden de salida" → vista resuelta.
- iOS `StartlistViewModel.swift` + Android `SupabaseService.kt` → vista resuelta.
- Editor de inscritos en panel → vista `startlist_riders_resolved`.
- Apps en versiones anteriores → tabla `startlist_riders` directa. Funcionan indefinidamente porque los snapshots se mantienen sincronizados (ver siguiente sección).

### Sincronización snapshot ↔ BD canónica

Para que apps antiguas (que leen la tabla, no la vista) sigan viendo nombres correctos:

1. **`saveStartlistEdits` (`js/panel/startlists.js`)**: usa preparación persistente y aplicación atómica. Reutiliza identidad exacta/alias/identificador UCI únicos; las variantes se revisan. Solo crea fichas tras completar nacionalidad y nacimiento (`source='startlist_import'`, `verified=false`). Sincroniza snapshots y enlaces por dorsal una vez.
2. **`saveRider` (`js/panel/riders.js`)**: al editar un rider de BD, se hace `UPDATE startlist_riders SET firstName=…, lastName=… WHERE globalRiderId=…`. El `countryCode` NO se propaga (preserva overrides de selecciones nacionales).
3. **`deleteRider` (`js/panel/riders.js`)**: avisa cuántas startlists tienen el rider linkado, hace `UPDATE startlist_riders SET globalRiderId=NULL WHERE globalRiderId=…` antes de `DELETE`, evita huérfanos. El snapshot del nombre se preserva como fallback.

### Campo `otherNames`

Separados por coma. Se usa para detectar variantes del nombre que aparecen en startlists importadas (no altera `firstName`/`lastName`):

| Caso | `lastName` | `otherNames` | Matchea |
|---|---|---|---|
| Segundo apellido español | `Rodríguez` | `Cano` | "Rodríguez Cano Carlos" o "Rodriguez Cano" |
| Variante sin apóstrofo | `O'Connor` | `OConnor` | "OConnor Ben" |
| Nombre de pila alternativo | `Pogačar` | — | — (basta con el apellido) |
| Abreviatura usada en listas | `Quemeneur` | `JB` | "Quemeneur JB" |

### Matching y altas

`private.plan_startlist_import` busca primero `globalRiderId` explícito o clave de
identidad, alias curado e identificador de perfil UCI. Un único candidato exacto
se enlaza; una fecha o referencia UCI discrepante exige revisión. Para ausentes,
busca nombres por tokens o apellido e inicial antes de permitir un alta. No aplica
un umbral difuso automáticamente. El panel muestra candidatos con país y fecha.

Las altas requieren nombre, apellidos, nacionalidad y nacimiento verificado. Si
existen candidatos razonables, hay que enlazar el correcto o descartarlos de forma
explícita por id. Las fichas nuevas se crean dentro de la transacción de la lista;
las incorporaciones a clubes `CLUBM/CLUBW` generan afiliación por temporada
(`source=startlist_club`, sin verificación de contrato). El equipo actual se
deriva preservando la prioridad de afiliaciones curadas. Las selecciones y los
equipos UCI no generan afiliación por una convocatoria. Los slugs proceden de
`resolve_riders`/`fold_name`, no de una segunda implementación de normalización.

Al introducir apellidos manualmente con Tab, el panel puede consultar la plantilla
del equipo para proponer una coincidencia única. La caché es por equipo, temporada
y género; no se descarga el catálogo completo. Los documentos importados pasan
por el matching del servidor al guardar.

### Categorías de equipo (`teams.category`)

| Valor | Significado |
|---|---|
| `WT` | WorldTour masculino |
| `WWT` | WorldTour femenino |
| `PT` | ProTeam masculino |
| `PRW` | ProTeam femenino |
| `CT` | Continental masculino |
| `CTW` | Continental femenino |
| `NTM` | Selección nacional masculina |
| `NTW` | Selección nacional femenina |
| `CLUBM` | Club masculino |
| `CLUBW` | Club femenino |

`teams.gender` (`'male'` / `'female'`) se auto-rellena en el panel al elegir `category`.

### Carga del editor

`openStartlistEditor` consulta equipos de la lista y catálogo de equipos en paralelo;
lee los inscritos desde la vista resuelta. Los datos de plantilla se cargan solo
si se usan para completar una entrada manual. No hay un barrido de 2.000 fichas ni
consultas nominales individuales durante la importación del archivo.

### Mantenimiento

- **Selecciones**: `teamKind=selection` o categoría `NTM/NTW` no admiten
  afiliaciones ni `currentTeamId`. Sus convocatorias se guardan en startlists;
  cualquier corredor puede participar con ellas o incorporarse después a un club.
  El panel oculta su plantilla. Detalle y estudio de clubes:
  [plantillas-clubes-selecciones-20260904.md](../informes/plantillas-clubes-selecciones-20260904.md).
- **Clubes desde startlists**: un alta o enlace futuro de ficha canónica en
  `CLUBM/CLUBW` la incorpora automáticamente a la plantilla de esa temporada.
  Se conserva cualquier afiliación previa; una afiliación curada mantiene la
  prioridad como equipo actual. No se duplica ni se hace un backfill global.

- **Cambio de equipo**: actualizar solo `currentTeamId`. NO crear nueva fila — el `id` es el identificador canónico del corredor.
- **Corrección de nombre**: editar `firstName`/`lastName` directamente en el panel ("Corredores"). Se propaga al instante a las startlists linkadas.
- **Cambio de slug**: el `id` también es editable desde el panel (carretera y CX). Las RPC `admin_rename_rider` (carretera) y `cx_rename_rider` (CX, migración `admin_rename_rider_rpc`) reasignan el `id` y re-vinculan en una transacción las referencias blandas. Carretera (migraciones `admin_rename_rider_full_relink` y `admin_rename_rider_affiliations_first`): afiliaciones con su `id` determinista regenerado, antes que inscritos para que la sincronización de plantillas de club no cree una afiliación duplicada; inscritos, resultados, transferencias, alias de identidad, `private.rider_uci_profile_aliases` y `private.uci_catalog_changes`. Filtra por género, ya que `riders_men` y `riders_women` comparten ids; si el id existe en ambas tablas y una referencia sin género no permite decidir, se detiene. `start_order_entries."riderId"` referencia `startlist_riders` y no se modifica. En CX (`cx_rename_rider`), además, las generales de torneo; inscritos, resultados y generales se filtran por la inicial de la categoría (M/W), como defensa adicional: desde la migración `cx_rider_id_unique_across_genders` un trigger impide ids compartidos entre `cx_riders_men` y `cx_riders_women`, y la ingesta elige un id libre en ambas tablas. Ante choque de `identityKey`, si es la misma persona se fusiona; si son homónimos reales, se declara con la clave `base-añoNacimiento` (requiere fecha de nacimiento). Lógica compartida en `js/rider-rename-logic.js`.
- **IDs únicos entre géneros**: un id no puede existir a la vez en `riders_men` y `riders_women` (trigger `a01_rider_id_unique_across_genders`); los generadores de la base de datos y el panel eligen un id libre en ambas tablas. Mismo contrato en CX.
- **Añadir variante**: editar `otherNames` en el panel (campo de texto, comas como separador).
- **Añadir equipo nuevo**: dar de alta el equipo y su plantilla desde el panel (vista Equipos).
- **Revisar auto-creados**: en panel → Corredores → filtro "Sin verificar". Cada fila tiene badge "?" naranja y botón "✓" inline para marcar verificado en un click. El editor muestra el `source` para contexto.
- **Fusionar duplicados**: si un rider auto-creado coincide con uno ya existente, abrir el unverified, ir al canónico y reasignar manualmente la startlist (o eliminar el unverified — al borrar, `deleteRider` desenlaza primero y conserva el snapshot, sin huérfanos).

## Equipos e inscritos

Documentación técnica de equipos y startlists enriquecidas.

Asignar un equipo global (tabla `teams`) a cada `startlist_teams.teamId` para pintar la cabecera con colores propios y mostrar una chapa ciclista (SVG) junto al nombre. Todas las listas se enriquecen: web, panel y apps actuales deciden el render por equipo, según exista `teamId` con ficha en `teams`, y no consultan `races.enrichedStartlist`.

### Base de datos (`019_teams.sql`, `058_riders.sql`)

| Tabla / columna | Qué es |
|---|---|
| `teams` | Equipos globales. `headerBg` guarda el fondo público y `headerText` se deriva automáticamente por contraste. Los campos históricos `badgeTorsoSides`, `badgeTorsoCenter` y `badgeShorts` almacenan, en ese orden, los tres cuadrados cromáticos. `badgeInnerCircle` queda como compatibilidad de esquema y el editor lo limpia. `nameAliases` = alias separados por `\n` para matching. |
| `teams.category` | Categoría UCI: `WT`, `WWT`, `PT`, `PRW`, `CT`, `CTW`, `CLUBM`, `CLUBW`, `NTM`, `NTW`. |
| `teams.gender` | `'male'` / `'female'`. Se auto-rellena en el panel al seleccionar `category`. |
| `startlist_teams.teamId` | FK nullable a `teams` (`ON DELETE SET NULL`). |
| `startlist_teams.isDev` | ⛔ **RETIRADO — columna eliminada en producción el 2026-08-29.** Marcaba el equipo como filial añadiendo " (Devo)" al nombre. Redundante desde que cada filial tiene su **ficha propia** en `teams` (nombre y chapa propios): la condición vive en el `teamId` canónico. La 063 limpió los datos, la 128 ejecutó el `DROP COLUMN` tras publicar y adoptar la 4.0, y el checkbox del panel y la lectura en web/iOS/Android ya no existen. |
| `races.enrichedStartlist` | Columna generada `GENERATED ALWAYS AS (true) STORED` desde la migración `20260904062430_startlist_enrichment_default.sql`. Solo mantiene la lectura de apps anteriores; no representa un estado por carrera ni admite escritura. |

Ver [Corredores](#corredores) para la BD de corredores y su matching en el editor de startlist.

### Matching — `findMatchingTeam(name, teams)` en `js/shared.js`

1. Normaliza (minúsculas, sin acentos, sin stopwords: `pro`, `team`, `cycling`, `wt`, `continental`, `women`…).
2. Coincidencia exacta normalizada contra `name` o cualquier alias.
3. Fallback: contención bidireccional (≥ 4 caracteres).

### Chapa — `buildTeamBadgeSvg(team, { size, className })` en `js/shared.js`

- Polígono de 22 lados gris (`#8a8d91`) como borde exterior.
- Círculo interior con `clipPath`:
  - Semicírculo superior: fondo `badgeTorsoSides` + franja central `badgeTorsoCenter` + círculo `badgeInnerCircle` (opcional).
  - Semicírculo inferior: `badgeShorts` plano.

### Panel — sección "Equipos"

`#teamsView` en `panel/app.html`. CRUD con cuatro pares color-picker+hex sincronizados: tres cuadrados cromáticos y el fondo de pestaña/barra de título. La vista previa reproduce esas dos salidas; el texto de cabecera se calcula automáticamente. Funciones en `js/panel/teams.js`: `setupTeamsView`, `openTeamEditor`, `saveTeam`, `deleteTeam`, `refreshTeamPreview`.

### Editor e importación (2026-09-04)

Todas las listas guardadas mediante el panel o la skill se enriquecen. El selector
`Enriquecida` y la importación de JSON mínimo se han retirado. El panel tampoco
permite cargar archivos JSON completos: la creación abre directamente el editor
y las listas existentes se editan mediante campos. No ofrece recuperación ni
persistencia de borradores en el navegador. El contrato interno conserva
nombres separados, países, nacimiento, identificadores y fuentes.

`prepare_startlist_import` conserva el borrador y resuelve identidades en servidor.
`apply_startlist_import` guarda la lista y sus altas en una transacción. Las fichas
nuevas requieren nacionalidad y fecha de nacimiento; los equipos ausentes se crean
como club o selección mediante `ensure_startlist_team`. Las coincidencias ambiguas
se revisan antes de aplicar. El panel permite preparar esas altas en el selector.

No se borran todas las filas para reconstruirlas: se conservan los ids por dorsal y
solo se actualizan diferencias. Cada `importId` se aplica una sola vez. Las listas
históricas no se reclasifican en masa; la columna `enrichedStartlist` se conserva, como constante `true`, para los clientes móviles
existentes. Procedimiento: [importación de inscritos](#importación-de-inscritos).

### Render público (`js/inscritos.js`)

`js/startlist/data.js` carga los `teams` referenciados por `teamId` (y su `team_seasons` del año) en una sola consulta, sin leer `race.enrichedStartlist`, y `js/inscritos.js` pinta:
- Header con `background/color` del equipo + chapa 24px + clase `.startlist-team__header--enriched`.
- Equipos sin `teamId` o sin ficha en `teams` → estilo estándar (gris).

### Orden de equipos — por dorsal del primer corredor (cliente, 2026-06-11)

`startlist_teams.sortOrder` es el **orden de inserción del panel** ("al tuntún") y NO se usa como
orden principal: las tres plataformas ordenan en cliente por el **mínimo dorsal > 0** de cada
equipo (= dorsal del primer corredor mostrado). Equipos sin ningún dorsal (0/null) van al final
conservando `sortOrder` entre ellos → una startlist entera sin dorsales queda en el orden del panel.
- Web: `js/inscritos.js` (sort in-place del array `teams` tras agrupar corredores; el PDF
  `js/inscritos-pdf.js` comparte ese array → hereda el orden).
- Android: `util/StartlistLogic.teamsByFirstDorsal` (+ `StartlistLogicTest`), cableado en
  `CalendarRepository.loadStartlistData`.
- iOS: sort al final de `StartlistViewModel.fetchTeams` (espejo del de Android — cambios en paralelo).
No hay nada que tocar en el panel ni en BD; los corredores dentro del equipo ya se ordenaban por dorsal.

### CSS (`css/app.css`)

- `.startlist-team__header` ahora es `display:flex; align-items:center; gap:0.55rem` para acomodar la chapa.
- `.startlist-team__badge`, `.team-badge` — wrappers neutros (el SVG lleva width/height propias).

### Inscritos (startlists)

#### `races.startlistImportedAt`

Marca `TIMESTAMPTZ` (nullable). Los 2 puntos de escritura (`saveStartlistEdits`, `deleteStartlist` en `js/panel/startlists.js`) deben mantener la columna en sync. Al guardar → `new Date().toISOString()`. Al borrar → `null`.

**Importación con IA deshabilitada (2026-05-05):** solo edición manual. El Edge Function `parse-startlist` permanece en el repo pero no se invoca desde el panel.

**Consumo:** botón "Inscritos" se deriva de `race.startlistImportedAt != null`. Ubicaciones: `js/jornada.js` (`hasStartlist`), `StageDetailViewModel.swift`, `StageScreen.kt`.

#### Nacionalidad por corredor (`startlist_riders.countryCode`)

`TEXT` nullable, ISO 3166-1 alpha-2 en minúsculas (acepta sub-tag `es-ct`). Migración `034_startlist_riders_country_code.sql`. **Solo se renderiza en la página pública `/inscritos/{slug}/`** — no en iOS, Android ni en el PDF.

- **Editor:** input `.sl-country` por fila; `.sl-flag-preview` muestra mini-bandera en vivo.
- `saveStartlistEdits` valida con regex `/^[a-z]{2}(-[a-z0-9]{2,4})?$/` y guarda `null` si no es válido.
- **Render web:** `js/inscritos.js` añade `<span class="startlist-rider__flag">` con `countryFlag()`.

### Importación de inscritos

El contrato compartido vive en `js/startlist/source.mjs`. La entrada conserva
identificadores, nacionalidades, nacimientos y fuentes; no existe la extracción
mínima con nombre combinado ni una opción de lista sin enriquecer.

1. `prepare_startlist_import`: valida recuentos e identidades, conserva el documento
   y una instantánea de la lista en `private.startlist_imports` y devuelve solo
   recuentos y excepciones. No escribe equipos ni fichas públicas.
2. `apply_startlist_import`: aplica por `importId`, con correcciones por dorsal o
   índice de equipo si hacen falta. Recomprueba el estado actual y guarda las
   altas y la lista en una transacción. Conserva los ids por dorsal y actualiza
   únicamente diferencias; elimina únicamente filas retiradas de la lista.

La ruta sin excepciones usa dos RPC de escritura/preparación, independientemente
del número de equipos y corredores. El panel crea y edita inscritos mediante sus campos; no ofrece carga de archivos
JSON en la creación ni en el editor. La recarga visual tiene sus lecturas
habituales. Una respuesta perdida se reintenta con el mismo id y no duplica altas.
El panel no ofrece borradores ni los persiste en el navegador. Conserva en memoria
el identificador del guardado en curso para reintentar una respuesta perdida.

Los equipos ausentes se crean como club o selección mediante la lógica existente
`ensure_startlist_team`. Los estados sin equipo siguen siendo placeholders. Los
ciclistas nuevos exigen nacionalidad y nacimiento válido; no se inventan fechas.
Las incorporaciones futuras a clubes `CLUBM/CLUBW` crean automáticamente la
afiliación de temporada sin duplicarla ni sustituir afiliaciones curadas. Las
convocatorias con selecciones o equipos UCI no generan afiliación. Los posibles homónimos y discrepancias de
fecha/identificador UCI se presentan para revisión antes del alta.

Las RPC son de administración; el esquema privado no permite leer los documentos
de preparación a usuarios ordinarios. El indicador editable está retirado: la
columna `races.enrichedStartlist` es una constante generada `true` exclusivamente
para los clientes móviles ya publicados. Web, panel y código móvil nuevo leen las
fichas siempre y no consultan ese campo. No escribirlo en INSERT/UPDATE. La RPC
antigua `ingest_startlist` está retirada y remite a preparación/aplicación completa.
Las apps nuevas consultan solo los equipos y las temporadas de la lista abierta,
evitando descargar catálogos completos y el truncamiento a 1000 filas.

En el editor, los equipos se asocian al abrir y editar su nombre, con el
catálogo completo y sus alias de temporada; si falta uno, se muestra el aviso y
«Crear equipo», y ante homónimos se exige selección. No añadir botones de
auto-asociación, desasignación ni re-sync canónico: la lectura resuelta y el
guardado mantienen los datos. Preparar el alta de un corredor en el selector
conserva sus datos hasta guardar la lista.

El CLI `scripts/data-preflight/startlist-import.mjs` genera los SELECT para la vía SQL de `cc-nucleo`;
no conecta directamente a la base. La skill pasa su stdout directamente
al MCP o a `scripts/db/sql.mjs`, sin transcribir de nuevo el documento.

La prueba reversible `scripts/data-preflight/tests/startlist-import.sql` comprueba
altas completas, distinción club/selección, persistencia de pendientes, reintentos,
conservación de ids, edición concurrente y denegación a usuarios no administradores.
Termina con ROLLBACK. Los tests del contrato y CLI comprueban conservación de datos,
recuperación tras una respuesta perdida y bloqueo del SQL cuando falla la validación.

### Autocompletado entre equipos matriz y de desarrollo

Implementado el 4 de septiembre de 2026. El editor de inscritos consulta las
plantillas mediante `public.startlist_team_roster(p_race_id, p_team_id)`.

#### Modelo y fuente

`public.team_development_links` conserva `mainTeamId`, `developmentTeamId`, `year`,
`sourceUrl` y `verifiedAt`. La clave de filial/temporada impide varias matrices
para una misma filial ese año. Las relaciones requieren equipos regulares del
mismo género y no admiten ciclos ni cadenas. `teams.parentTeamId` conserva su
función de vincular maillots especiales; no se utiliza para inferir filiaciones
deportivas. El vínculo antiguo de Tudor U23 permanece sin cambios.

Se han registrado 28 relaciones para 2026 a partir de la página 3 de la
[tabla oficial UCI del 20 de marzo de 2026](https://assets.ctfassets.net/761l7gh5x5an/3EjeIEEJpI38fDQOoc54AI/a0a1b2a14930864325e7c0ec17a9b72d/Article2.2.001_Participation_Equipes_2026_20032026.pdf).
Se utilizan los nombres canónicos vigentes del catálogo para INEOS, Canyon y
UAE femenino. La migración exige resolver cada nombre/género a una única ficha
regular; no asigna equipos por similitud de patrocinador.

La carga comprende las 17 parejas masculinas WorldTeam/continental de la tabla,
las de Euskaltel, Kern Pharma, Solution Tech, Novo Nordisk, TotalEnergies y Tudor,
y las cinco parejas femeninas de AG Insurance, Canyon, Fenix, Liv y UAE.
No constituye una carga de todas las estructuras juveniles o de formación del
documento. Las parejas cuya equivalencia con el catálogo no se verificó no se
han añadido. Las nuevas temporadas requieren su propia comprobación y fila.

#### Consulta y emparejamiento

- Desde la matriz: plantilla propia y filiales directas de la temporada.
- Desde una filial: plantilla propia y matriz, sin ampliar a filiales hermanas.
- Las afiliaciones deben corresponder al género, año y fechas de la carrera.
- Las identidades de maillot se resuelven a su equipo regular, tanto en la
  selección del equipo como en las afiliaciones almacenadas. Las fechas de
  vigencia del diseño no sustituyen las fechas de afiliación deportiva.
- El recurso a `currentTeamId` solo se admite en la temporada actual para
  corredores sin ninguna afiliación anual. No recupera afiliaciones caducadas ni
  transporta la plantilla actual a carreras históricas.
- Cada corredor se devuelve una sola vez, aunque tenga varias afiliaciones.
  Nombre y apellido restringen conjuntamente la coincidencia. Ante varios
  candidatos, el panel muestra sus equipos y requiere selección.

La RPC devuelve JSONB completo, evitando el límite de filas de las respuestas
tabulares. Su lectura no altera fichas, afiliaciones ni listas. El guardado
mantiene el equipo inscrito y la ficha del corredor; la importación ya resuelve
las identidades exactas en el catálogo global.

#### Acceso y mantenimiento

La RPC es `SECURITY INVOKER`, con `search_path` vacío, y solo admite administración
o `service_role`. La tabla tiene RLS de lectura para administradores; los
usuarios anónimos no tienen acceso. Las escrituras se reservan a `service_role`
y a la administración de base de datos mediante MCP.

Al registrar o modificar una relación, verificar temporada, género, identidades
regulares y fuente oficial. No modificar plantillas ni `currentTeamId` como
consecuencia de esa relación. Abrir de nuevo el editor invalida su caché.

Migraciones:

- `20260904063403_startlist_development_team_rosters.sql`.
- `20260904063625_startlist_roster_special_edition_affiliations.sql`.

La comprobación transaccional está en
`scripts/data-preflight/tests/startlist-development-rosters.sql`. Se ejecuta por
Supabase MCP y termina con `ROLLBACK` de todos sus datos de ejemplo.

El mismo día se trasladaron las diez afiliaciones de Canyon//SRAM Generation
desde el maillot antiguo de zondacrypto al equipo regular, por petición expresa.
[Manifiesto, respaldo y reversión](../informes/canyon-generation-plantilla-20260904.md).

### Stagiaires: afiliación individual de prueba

#### Modelo

`rider_team_affiliations.affiliationType` distingue `regular` de `trainee`.
Las filas existentes quedaron como `regular`. Una prueba tiene UUID propio,
corredor/género, equipo UCI canónico, temporada, fechas inclusivas, `sourceUrl`,
`uciTeamProfileId`, `verifiedAt` y `dateBasis`. Solo se permite un vínculo
de prueba por corredor, género, anfitrión y temporada.

La prueba no sustituye afiliaciones habituales, no modifica `currentTeamId` y
no representa un contrato o fichaje. Puede coexistir con una afiliación habitual
al mismo equipo. Añadir, editar o retirar una prueba conserva la ficha; al
reclasificar una afiliación habitual se recalcula el equipo habitual restante.

Stagiaire y ciclista de un equipo de desarrollo son conceptos independientes.
No se crean ni modifican `team_development_links` desde una prueba.
`parentTeamId` únicamente normaliza maillots especiales.

#### Fuente y fechas

La evidencia es la sección **Trainees** de la ficha oficial UCI del equipo.
El parser compartido `scripts/results-fetchers/uci-team-roster.mjs` separa
`Riders`/`Neo`, `Trainees` y `Management`. Un panel desconocido o una
identidad duplicada detiene la extracción. Las cachés antiguas de la ingesta
ordinaria no se reutilizan porque no conservaban la sección de procedencia.

- `regulatory_window`: 1 de agosto–31 de diciembre del año. La UCI confirma la
  condición de prueba; estas fechas son la ventana reglamentaria, no fechas
  contractuales publicadas.
- `official`: fechas individuales documentadas. Un inicio en julio requiere
  acreditar la excepción reglamentaria de carreras que comienzan en julio y
  terminan en agosto; no debe anticiparse automáticamente toda prueba a julio.

Referencia normativa del censo:
[Reglamento UCI de carretera, versión 01.09.2026](https://assets.ctfassets.net/761l7gh5x5an/6FEzFHeA2oKMBGb5sdIvQ7/9da669a83c210f198edf4783dcb49113/2-ROA-20260901-E.pdf).
El autómatch identifica personas: **no certifica elegibilidad deportiva**. Una
inscripción de prueba en WorldTour requiere revisión; no cambiar la identidad
para resolver una incompatibilidad reglamentaria.

#### Alta y mantenimiento

Usar Supabase MCP, con administración o servicio, y la RPC
`public.upsert_rider_trainee`. Parámetros:

| Parámetro | Contenido |
| --- | --- |
| `p_rider_id`, `p_gender` | Ficha existente y `male`/`female` |
| `p_team_id`, `p_year` | Anfitrión canónico y temporada |
| `p_date_from`, `p_date_to` | Fechas inclusivas |
| `p_source_url`, `p_uci_team_profile_id` | Evidencia y perfil del equipo UCI |
| `p_date_basis`, `p_verified_at` | Base de las fechas y consulta de la fuente, en UTC |

La RPC devuelve el UUID del vínculo; repetir la misma clave lógica actualiza
esa fila. No elimina otros anfitriones, afiliaciones habituales o temporadas.
No fusiona personas ni transforma una afiliación habitual existente.
La reclasificación exige diagnóstico autorizado, copia previa y selección
por id exacto; debe liberar la antigua clave determinista para futuras altas
habituales. No confundir el perfil del equipo con la licencia del corredor.

El panel muestra cada afiliación por su id real, permite retirar una sola fila
y distingue la prueba únicamente con un badge «Stagiaire», sin reborde destacado,
fechas, fuente ni indicaciones adicionales en la fila. Los datos del vínculo
se conservan y se mantienen con la RPC y evidencia actualizada.
Las fechas habituales siguen siendo editables. Las fusiones distinguen también
el tipo de afiliación.

#### Autómatch

`startlist_team_roster` incorpora las pruebas únicamente al anfitrión solicitado
(o su maillot especial), en la misma temporada y género, cuando el vínculo cubre
las fechas de carrera. Solapar parcialmente agosto no basta. No propaga la
prueba por vínculos entre equipos. Las reglas previas de afiliaciones habituales
se mantienen sin cambios.

Web, panel, iOS y Android filtran `affiliationType=regular` al consultar o
materializar plantillas del mercado. Nunca usar el fin de una prueba como fin
de contrato.

#### Verificación

`scripts/data-preflight/tests/trainee-rosters.sql` usa fixtures y termina en
`ROLLBACK`: fechas, independencia del anfitrión, maillot, género, fuentes,
permisos, idempotencia, coexistencia con afiliación habitual y reclasificación.
Las comprobaciones previas de clubes y de plantillas relacionadas siguen siendo
aplicables por separado.

Carga de 2026, copia privada, artefactos locales y ensayo de reversión: [informe](../informes/stagiaires-2026-20260904.md).

## Orden de salida (CRI / CRE)

Vista de horarios de salida en contrarreloj. Web tiene la página propia
(`orden-salida.html` / `start-order/`); iOS y Android ahora también la tienen como
vista nativa (antes abrían Safari/Chrome Tabs).

**Dos modos según el tipo de jornada:**
- **CRI (`primaryType=itt`)** — salen corredores. Tabla de 4 columnas:
  **Salida · Dorsal · Corredor (+bandera) · Equipo**. Cruce por dorsal contra la startlist.
- **CRE (`primaryType=ttt`)** — salen equipos. Tabla de 2 columnas: **Salida · Equipo**
  (sin dorsal, sin bandera, sin corredor) y **sin** los filtros Contrarrelojistas/General.
  Cruce por **nombre de equipo** contra `startlist_teams` (nombre canónico vía `teams`).

En web, ambos modos comparten la segunda columna de Resultados: perfil
interactivo/oficial y datos de la jornada (`js/stage/profile.js` y
`js/stage/context.js`). La columna mide 320 px desde 1100 px de viewport; por
debajo se coloca tras la tabla. Se respetan los vetos de perfil y se omiten los
nombres de sus puntos, como en Resultados. Los filtros y la nota de zona horaria
permanecen con la tabla en la columna principal.

### Tabla Supabase

`start_order_entries` — migraciones 055 (creación), 056 (favoritos), 057 (dos grupos de filtros).

| Campo        | Tipo    | Notas                                                            |
|--------------|---------|------------------------------------------------------------------|
| `id`         | text    | PK                                                               |
| `raceDayId`  | text    | FK → `race_days`                                                 |
| `sortOrder`  | int     | Orden de presentación                                            |
| `dorsal`     | int     | Dorsal del corredor                                              |
| `startTime`  | text    | "HH:MM" o "HH:MM:SS" en hora local de la carrera                 |
| `riderId`    | text?   | FK → riders_men/women (cuando hay match)                         |
| `riderName`  | text?   | Snapshot si no hay match canónico                                |
| `teamName`   | text?   | Equipo (snapshot)                                                |
| `countryCode`| text?   | ISO-2                                                            |

Los filtros de "Contrarrelojistas" / "General" viven en `race_days`:
- `startOrderTtDorsals: int[]` — dorsales considerados TT specialists.
- `startOrderGcDorsals: int[]` — dorsales considerados GC.

#### Vista `start_order_entries_resolved` (migración 070)

`start_order_entries` guarda un **snapshot** de `riderName`/`teamName`/`countryCode`
tomado al importar. Cuando después se matchea un dorsal a su ficha canónica
(`riders_men`/`riders_women`) o se corrige un nombre de corredor/equipo, el
snapshot quedaba obsoleto y las páginas mostraban el nombre viejo hasta que el
admin pulsaba "Re-sincronizar" a mano.

La vista `start_order_entries_resolved` resuelve los nombres **en tiempo de
lectura**, igual que `startlist_riders_resolved` hace para las startlists:

- **`riderName`**: se resuelve por `(raceId, dorsal)` contra
  `startlist_riders_resolved` (que ya aplica la precedencia BD↔snapshot). Si no
  hay match por dorsal, cae al snapshot de `start_order_entries`.
- **`teamName`**: sigue la cadena del panel
  `startlist_riders_resolved.teamId → startlist_teams.id → startlist_teams.teamId
  → teams.name`, cayendo a `startlist_teams.teamName` y, en último término, al
  snapshot.
- **`countryCode`**: el resuelto (respeta override de selección nacional); si no
  hay match, el snapshot.

El match por dorsal usa `LEFT JOIN LATERAL ... LIMIT 1` para no multiplicar filas
si hubiese dorsales duplicados. Shape idéntico a la tabla → web/iOS/Android leen
la vista sin tocar DTOs.

**Quién lee la vista** (público): web `js/orden-salida.js`, iOS
`StartOrderViewModel`, Android `SupabaseService.startOrderEntries`.
**Quién lee/escribe la tabla directa**: el panel (`js/panel/start-order.js`) al importar y
re-sincronizar. Las apps antiguas que aún leen la tabla siguen funcionando gracias
a los snapshots sincronizados (save, botón Re-sincronizar,
`sync_startlist_riders_to_canonical`).

**Panel — modo CRE:** `setupStartOrderSection` ramifica por `isTtt`. Parser
`parseStartOrderTeamsInput` (`HH:MM nombre equipo`), `buildTeamMapForRace` +
`resolveTeamName` (match por nombre normalizado contra `startlist_teams`, fallback
`findMatchingTeam` del catálogo). Preview de 2 columnas; oculta inputs de dorsales TT/GC
y el botón "Re-sincronizar nombres". Save con `dorsal=0`. La descripción SEO de la
página estática (`.github/workflows/og-pages.yml`) usa "cada equipo"/"each team" en CRE.

### Lógica común a las 3 plataformas

1. La jornada debe ser CRI (`primaryType=itt`) o CRE (`primaryType=ttt`).
2. El layout depende del tipo (`isTtt = primaryType === 'ttt'`):
   - **CRI:** 4 columnas **Salida · Dorsal · Corredor (+bandera) · Equipo**.
   - **CRE:** 2 columnas **Salida · Equipo** (sin dorsal, sin bandera, sin corredor).
3. Si `race_days.timezone` ≠ TZ del usuario, las horas se convierten a la hora local
   del usuario con sufijo `+1d`/`-1d` si la fecha resultante difiere. (Idéntico en ambos modos.)
4. Filtros "Todos / Contrarrelojistas / General": solo en **CRI** y si hay dorsales TT/GC
   definidos. En **CRE no se muestran nunca** (se basan en dorsales de corredor).

#### Modelo de datos CRE (placeholder `dorsal=0`)

`start_order_entries.dorsal` es `INTEGER NOT NULL`. En CRE no hay dorsal, así que cada
entrada de equipo se guarda con `dorsal=0`, `riderId=null`, `riderName=null`,
`countryCode=null` y `teamName` = **nombre canónico** del equipo (o el snapshot pegado si
no hubo match). La vista `start_order_entries_resolved` matchea corredor por `(raceId, dorsal)`;
con `dorsal=0` no hay match → `riderName` queda null y `teamName` se sirve desde el snapshot.
Por eso el panel/skill guardan el nombre canónico al importar (no hace falta re-sync en CRE).

### Entradas a la vista

| Origen                          | Web                                | iOS                                              | Android                                         |
|---------------------------------|------------------------------------|--------------------------------------------------|-------------------------------------------------|
| Racecard de "Hoy" (badge)       | Asset `startOrder` → `orden-salida/{slug}` | `RaceCardView.startOrderBadge` → sheet `StartOrderView` | `StartOrderBadge` → `Routes.startOrder(rd.id)` |
| Detalle de jornada (chip asset) | Asset `startOrder`                 | `StageDetailView` → sheet `StartOrderView`       | `StageScreen` → `Routes.startOrder(rd.id)`      |
| Cintillo (today_highlights)     | Slide con destino `startOrder`     | Slide en `TodayHighlightsBanner`                 | Slide en `TodayHighlightsBanner.kt`             |

Antes del rework (2026-05-28), iOS abría el badge en `SafariViewController` y
Android en `CustomTabsIntent`. La vista nativa coexiste con la web (que sigue
siendo la fuente canónica para SEO, deep links externos, e iCal).

### Archivos clave

#### iOS
- `ios-app/CalendarioCiclismo/Models/StartOrderEntry.swift` — DTOs.
- `ios-app/CalendarioCiclismo/ViewModels/StartOrderViewModel.swift` — fetch + filtros + conversión TZ.
- `ios-app/CalendarioCiclismo/Views/StartOrder/StartOrderView.swift` — UI SwiftUI.

#### Android
- `android-app/.../data/model/StartOrderEntry.kt` — `StartOrderEntry`, `StartOrderRaceDay`, `StartOrderData`.
- `android-app/.../data/remote/SupabaseService.kt::startOrderRaceDay / startOrderEntries`.
- `android-app/.../data/repository/CalendarRepository.kt::loadStartOrderData`.
- `android-app/.../ui/startorder/StartOrderScreen.kt` — UI Compose.
- `android-app/.../ui/navigation/Routes.kt::START_ORDER` + `startOrder(raceDayId)`.

#### Strings (Android)
`start_order_title`, `start_order_empty`, `start_order_riders`, `start_order_filter_*`,
`start_order_col_*`, `start_order_type_*`, `start_order_stage_*`, `start_order_tz_note`
(en `res/values/strings.xml` y `res/values-en/strings.xml`).

### No degradar el badge

La vista nativa y todas sus funciones son gratuitas. Fundador y Amigo no intervienen en su disponibilidad.

### Página web, panel y reglas

Página `/orden-salida/{rdSlug}/` para CRI/CRE.

**DB:** tabla `start_order_entries` (`id`, `raceDayId`, `sortOrder`, `dorsal`, `startTime`, `riderId` nullable FK startlist_riders, `riderName`, `teamName`, `countryCode`) + columnas `race_days.startOrderImportedAt TIMESTAMPTZ`, `race_days.startOrderTtDorsals INT[]`, `race_days.startOrderGcDorsals INT[]`, `race_days.timezone TEXT` (IANA, p.ej. `Asia/Tokyo`). Migración `055_start_order.sql` + `add_timezone_to_race_days`.

**Web:** `orden-salida.html` + `js/orden-salida.js`. Pre-renderizado por `og-pages.yml`. Incluido en `sitemap.yml`. Si `rd.timezone` está informado y difiere de la zona del visitante, las horas se renderizan en la zona del usuario con tooltip mostrando la hora local de la carrera, y se anota un prefijo `±Nd` cuando la conversión cruza la medianoche.

**Helpers `shared.js`:** `startOrderUrl(rd)` → URL relativa; `startOrderFullUrl(rd)` → URL canónica completa.

**Panel:** sección "Orden de Salida" en la pestaña Documentación del editor de jornadas (solo CRI/CRE). Campos: textarea `HH:MM:SS dorsal`, dorsales TT/GC para filtros, y `Zona horaria de la jornada` (IANA, validada con `Intl.DateTimeFormat`). Al guardar el orden: (1) elimina entradas antiguas, (2) inserta nuevas cruzando por dorsal con `startlist_riders`, (3) actualiza `startOrderImportedAt` + grupos TT/GC + `timezone`, (4) crea/reemplaza el asset `startOrder` (URL por slug ES o, en su defecto, fallback a `/orden-salida.html?id=…`), (5) sincroniza input de URL en Documentación. El botón "Guardar zona y grupos" persiste timezone + dorsales sin tocar las entradas.

**Reglas:**
- Solo aplica a jornadas `primaryType == "itt"` o `"ttt"` en apps. La web no tiene esta restricción.
- El cruce por dorsal requiere startlist importada; si no hay match, la entrada se guarda con `riderName/teamName/countryCode = null`.
- Al eliminar: borra `start_order_entries`, limpia `startOrderImportedAt` + grupos TT/GC (la `timezone` se preserva), elimina el asset `startOrder`.

## Detección de puertos y perfil de elevación

### Detector heurístico — `js/stage/climb-detection.js` (dual-pass)

#### `detectClimb(points, summitKm)`

Dos pases:

1. **Estricto:** itera hacia atrás desde la cima; solo extiende si la pendiente del primer `LOCAL_WINDOW_KM = 2` km desde el candidato es ≥ `MIN_LOCAL_GRADIENT_PCT = 3 %`. Evita absorber valles suaves previos.
2. **Permisivo** (si el estricto devuelve null): umbral `MIN_LOOSE_GRADIENT_PCT = 1 %`. Captura puertos largos suaves continuos (Göygöl 13.7 km al 2.3 %) sin absorber mesetas llanas.

Filtros comunes: longitud máx 50 km / mín 0.5 km, pendiente media final ≥ `MIN_GRADIENT_PCT = 2 %`.

**Tolerancia en summitKm:** si supera el último punto del GPX hasta 2 km, se trata como si estuviera en el último punto (evita rechazar Angliru por discrepancia de 0.02 km).

#### `computeClimbStats(points, startKm, summitKm, summitAltOverride?)`

Para render: deriva longitud y % a partir del `startKm` ya guardado. Si la cima tiene `altitude` manual, se respeta como override para el cálculo del desnivel.

#### `effectiveSummitAlt(summit, points)`

Fuente de verdad de la altitud para el render. Con GPX, devuelve siempre la altitud interpolada de la curva (ignora `summit.altitude` manual). Sin GPX cae al valor manual. Aplica en `stage/elevation-profile.js` (anchor del summit + zona sombreada) y en las cajas "Puertos" de `perfil-pub.js` y `perfil.js`.

### Render

#### Summits fuera de rango del GPX

`stage/elevation-profile.js` capea summits cuyo km supere `xMax` del GPX en hasta 2 km (`SUMMIT_OVERSHOOT_TOL`). **Misma tolerancia que el detector — paridad obligatoria.**

#### Sombreado + tooltip (web)

Para cada summit con `startKm`, dibuja `<path class="ep-climb-zone">` con fill `SUMMIT_COLOR` opacidad 0.22. `hoverData.climbs[]` expone `{startKm, endKm, lengthKm, avgGradient, gain, summitAlt, name, category}`. Cuando el cursor cae dentro del tramo, el tooltip muestra "Nombre · X km · ±Y % · desnivel Z m" (idioma según `lang`).

#### iOS (`ElevationProfileView.swift`)

`ProfileSummit.climbStats(points:)` devuelve `(lengthKm, avgGradient)`. El Canvas dibuja el área antes de la curva (`Color.summitRed.opacity(0.22)`). Tap dentro de la zona muestra `climbTooltip`. La fila `SummitRow` muestra `X km · ±Y%`.

#### Android (`ElevationProfileScreen.kt`)

`ProfileSummit.climbStats(points)` con misma firma. Canvas pinta `ColorSummit.copy(alpha = 0.22f)`. `detectTapGestures` detecta tap; muestra `Surface` tooltip alineado a `TopStart`. Fila de la sección de puertos muestra `X km · ±Y%`.

### Editor del panel (`js/panel/jornada-fields.js`, `js/panel/jornada-profile.js`)

Cada fila de `summitRowHTML` incluye:
- input `.ann-start` (km de inicio, opcional).
- botón `.ann-detect-btn` (⌖) — invoca `detectClimb` con el km de la cima.
- span `.ann-stats` que muestra "X km · Y %" calculado en vivo.

Al introducir el km de la cima, si `.ann-start` está vacío se intenta autodetectar silenciosamente. `startKm` se persiste como propiedad opcional dentro de cada item de `profileSummits` (JSONB). iOS (Swift Codable) y Android (kotlinx con `ignoreUnknownKeys = true`) ignoran el campo sin romper.

#### Disparo automático tras subir GPX

`_gpxHandleUpload` en `js/panel/jornada-profile.js`, después de actualizar `_editorCache.rd.elevationProfile`, recorre las filas de `#summitsList`: si la fila tiene `km` y no tiene `startKm`, lanza `_autoDetectSummitClimb(row, /*silent*/true)`. Toast de aviso si detecta al menos un puerto.

### Backfill masivo

Backfill ejecutado el 2026-05-06: 183 puertos rellenos de 215. 32 sin match (preferible `null` antes que datos malos). Era un one-shot: el tooling (`tools/backfill-climbs/index.mjs` + workflow `.github/workflows/backfill-climbs.yml`, que nunca llegó a ejecutarse en Actions) se retiró el 2026-07-13 tras cumplir su función. Si vuelve a hacer falta un backfill masivo de `startKm`, reconstruirlo importando `js/stage/climb-detection.js` (mismo módulo que el detector) y escribiendo por el pooler IPv4 con `SUPABASE_SERVICE_ROLE_KEY`; idempotente respetando `startKm` ya existente.

### Tests

`js/__tests__/climb-detection.test.js`. Añadir caso al cambiar la heurística. Constantes del detector en `js/stage/climb-detection.js` — el script de backfill importa el mismo módulo.

### Página de perfil — Sprints vs Puntos intermedios en CRI/CRE

En la sección "Puntos clave" (`js/perfil-pub.js` y `js/perfil.js`):

- **Por defecto** → "Sprints (N)": waypoints `intermediate_sprint` y `bonus_sprint`. Sufijo `· Sprint Int.` / `· Bonificación`.
- **Si `rd.primaryType === 'itt' || 'ttt'`** → "Puntos intermedios (N)": waypoints `intermediate_split`. Sin sufijo. La descripción SEO usa "puntos intermedios".

`isTimeTrial` decide qué subconjunto mostrar y el título de la caja. La caja "Puertos" no cambia. Si se añade un tipo nuevo que no debe mostrar sprints, ampliar la condición.

## Guía simplificada de horarios de paso

Muestra los horarios medios de paso por los puntos destacados de una jornada
(salida, pie y cima de cada puerto, sprints, puntos intermedios, sectores de
pavé/sterrato, llegada), además de la salida neutralizada y la llegada
prevista ya existentes. Inspirado en la tabla de horarios del rutómetro.

### Modelo de datos (sin DDL nueva)

Las horas manuales del rutómetro se guardan **dentro de cada item** de los
JSONB ya existentes de `race_days`, como campo opcional:

- `profileSummits[i].timeUtc` — ISO 8601 UTC, hora de paso por la **cima**.
- `profileWaypoints[i].timeUtc` — ISO 8601 UTC, hora de paso por el waypoint.

Salida (km 0) y llegada (km = `distanceKm`/`elevationProfile.distance`) usan
`neutralStartTimeUtc` / `estimatedFinishTimeUtc` — no se duplican.

No requiere migración: Swift `Codable` y kotlinx (`ignoreUnknownKeys`) ignoran
campos extra (mismo mecanismo que `startKm`). El pie del puerto **no** lleva
hora propia: se estima.

### Algoritmo `buildSimplifiedGuide` (función pura, paridad 3 plataformas)

- Web: `js/simplified-guide.js` (`buildSimplifiedGuide`, `hasSimplifiedGuide`).
- iOS: `Services/SimplifiedGuide.swift` (`SimplifiedGuide.build`, `.hasGuide`).
- Android: `util/SimplifiedGuide.kt` (`SimplifiedGuide.build`, `.hasGuide`).

Devuelve una lista `GuideRow { km, kmToGo, type, label, category, timeUtc,
isEstimated }` ordenada por km. Lógica:

1. Reúne puntos: salida; por cada summit → pie (`climb_foot`, sin hora) + cima
   (`summit`, con `timeUtc` manual si la hubiera); cada waypoint visible; llegada.
2. Visibilidad de waypoints en paridad con `js/perfil-pub.js`: en CRI/CRE
   (`itt`/`ttt`) se muestran `intermediate_split`; en el resto, los sprints;
   pavé/sterrato/localidad siempre; `kom` nunca.
3. Ordena por km, deduplica mismo km+tipo (tol. 0.05).
4. **Opt-in por jornada:** la guía (`hasSimplifiedGuide`/`hasGuide`) solo se
   muestra si el editor ha introducido **al menos una hora real del rutómetro**
   en un punto intermedio (cima/waypoint). Las horas puramente interpoladas NO
   bastan — sin ninguna hora manual, no aparece el acceso en ninguna jornada.
5. **Interpola** las horas faltantes por km entre anclas con hora conocida
   (salida/llegada + horas manuales), redondeando al minuto, marcándolas
   `isEstimated`. **En CRI/CRE NO se interpola** (cada corredor pasa en un
   momento distinto): solo se muestran las horas manuales.

Tests con **vectores compartidos** (mismos km/horas/resultados):
`js/__tests__/simplified-guide.test.js`, `SimplifiedGuideTests.swift`,
`SimplifiedGuideTest.kt`. Cambiar la heurística obliga a actualizar las tres.

### Render + interacción

- **Web → modal.** El bloque "Horario" de la rejilla (`js/jornada.js`) se
  vuelve pulsable cuando `hasSimplifiedGuide`. El disparador vive en la línea
  de título (chevron) para **no aumentar la altura** del bloque en la rejilla
  horizontal de escritorio; en stacked (≤480px) aparece el enlace de texto
  "Ver horarios de paso ›". CSS en `css/app.css` (`.route-grid__block--guide`,
  `.route-grid__guide-cue/link`, `.sg-overlay/.sg-modal/.sg-row/...`).
- **Apps → despliegue inline** con cierre. iOS `StageDetailView.timeSection`
  (botón + `guideExpanded`), Android `StageScreen.TimeSection` →
  `SimplifiedGuideSection` (`AnimatedVisibility`).

Cada fila: hora local (formatters existentes `formatTimeUser`/`formatTimeLocal`),
marcador circular por tipo (mismo código de color que el perfil/mini-perfil),
nombre, km restantes, y `*` si la hora es estimada (con nota al pie).

### Panel (`js/panel/jornada-fields.js`, `js/panel/jornada-save.js`)

`summitRowHTML`/`waypointRowHTML` tienen un input `type=time` (`.ann-time`),
inicializado desde `timeUtc` con `formatTimeHHMM`. `_saveRaceDay` añade
`timeUtc: toTimestamp(dateKey, value)` si el input tiene valor (omite la clave
si vacío, como `startKm`/`lengthKm`).

## Resultados: fuentes e importación manual

### Fuentes fuente externa y clasificaciones secundarias

Una página fuente externa de resultados no implica que estén publicadas todas las
clasificaciones de la carrera. Antes de cerrar una importación hay que comprobar
por separado las vistas de etapa, general, puntos, montaña, jóvenes y equipos.

Si fuente externa devuelve `No result available` en una clasificación secundaria, no se deben
copiar los datos de la etapa anterior ni reconstruir la clasificación con reglas
supuestas. Se conserva la clasificación individual disponible y se deja la
secundaria pendiente hasta disponer de una fuente publicada. El informe de
importación debe registrar la URL concreta y el estado de cada vista.

La verificación mínima posterior a un volcado es:

```sql
SELECT id, scope, "stageNumber", "classKind", "rowCount", "publicationStatus"
FROM public.race_uci_stages
WHERE "raceId" = :race_id
ORDER BY "raceDayId" NULLS LAST, id;
```

No se debe marcar una clasificación como oficial solo porque la etapa individual
esté completa. La fuente, el número de filas y el estado de publicación se
comprueban por clasificación.

### Contratos de `results-upsert` y siembra de inscritos

`results-upsert.mjs --input-contract manual` normaliza, valida y genera el SQL del
mismo documento en una sola ejecución. `--preflight-report` guarda el informe
compacto. Se elimina el archivo normalizado intermedio del recorrido ordinario.
Un error bloquea la generación; un destino declarado distinto se rechaza incluso
fuera del preflight integrado.

`--input-contract fetcher` admite identificadores oficiales y no inventa un
`expectedRowCount` cuando el adaptador no publica un total externo. Si lo aporta,
se comprueba. No usar este contrato para eludir errores de una extracción manual.
El cron conserva sus controles y cadencias existentes; no se modifica la frecuencia
de consulta. El resolutor nominal procesa solo identidades pendientes y conserva
los enlaces existentes. Un dorsal reutilizado entre pruebas se distingue también
por el nombre y los identificadores de clasificación de la fuente, incluso cuando
el resultado almacenado ya no conserva el nombre transitorio. Las altas requieren
país y fecha completa válida; las discrepancias
de nacimiento y los candidatos ambiguos no crean fichas adicionales.

La siembra automática de inscritos solo se ejecuta cuando no existe una lista y
todos los corredores tienen una ficha y nacionalidad. Los dorsales o identidades
repetidos y equipos ambiguos impiden la siembra sin perder los resultados. Las
listas de soporte conservan `startlistImportedAt=NULL`; la siembra no publica ni
sustituye listas editadas. Utiliza `ensure_startlist_team`, con autorización
explícita del rol operativo, para crear clubes o selecciones ausentes.

## Mercado de fichajes

Reglas de datos y operación: skill `cc-fichajes`. Esta sección describe cómo
presentan el mercado el panel y la web.

### Panel

- Código: `js/panel/fichajes.js` (vista Fichajes), `js/panel/team-situation.js`
  (editor de situación por equipo e individual, afiliaciones de mercado,
  `TSE_LIFETIME_YEAR` y el destino `'?'`) y `js/services/transfer-rider.js`
  (lógica compartida). `MARKET_SEASON` en `js/panel/constants.js`.
- Los rumores muestran el botón Confirmar. Las filas de la carga inicial del
  mercado (2026-07-20) confirmadas desde «Nueva incorporación» reciben la fecha
  del día (`isInitialTransferImport`).
- El panel limita `contractUntil` a 2026–2040 (la base solo exige ≥ 2026; 9999
  es vitalicio).
- Fichas ausentes: el mercado reutiliza el editor estándar de corredores; el
  género por defecto es el del equipo de origen, si no el del destino, y si no
  masculino.
- Editor de equipo, por estado:

| Estado | Fila `rider_transfers` | Afiliación de la temporada de mercado | Ficha |
| --- | --- | --- | --- |
| Continúa | `renewal` en rumor solo si está rumoreada | al equipo actual, con año | `contractUntil` sincronizado (también en rumor), salvo 9999 o NULL |
| En duda | `renewal` `doubt` | al equipo actual | no se toca |
| Cambia | `transfer` confirmado o rumor | borra la del equipo actual; el editor de equipo no crea la de destino (sí el individual y la confirmación rápida) | según contrato si confirmado |
| Termina | `retirement`, o `transfer` con destino `?` | borra la del equipo actual | no se toca |
| Sin decidir | ninguna | borra la del equipo actual | no se toca |

### Web pública (`js/fichajes.js`)

- Feed: `transfer` `confirmed` con `dateVisible` y destino conocido (teamId o
  nombre ≠ `?`), por `announcedAt` descendente. Renovaciones en su propio feed;
  retiradas y bajas `?` no aparecen. Los `midSeason` cierran el bloque de su día
  con el distintivo «M. Temporada» en lugar del año de contrato. Una fila sin
  ficha muestra el `riderId` sin bandera.
- Vista de equipo: «Llegan» (`transfer` con `toTeamId`, confirmados antes que
  rumores, con badge Rumor), «Se marchan» (`transfer`/`retirement` con
  `fromTeamId`), «Terminan contrato» (bajas `?`) y «Continúan» (afiliación
  `regular` de la temporada de mercado, `currentTeamId` = equipo, sin salida ni
  duda). El contrato mostrado sale del `dateTo` de la afiliación; en
  «Continúan» prevalece el de la renovación. Los `midSeason` no entran en
  Llegan ni Se marchan.
- Nombres de equipo: origen con `team_seasons` de la temporada en curso,
  destino con la de la temporada de mercado; un texto libre se muestra tal cual.
- Solo se cargan filas con `season = MARKET_SEASON`: un `midSeason` guardado
  con el año en curso no se muestra.

### Publicación web

No ejecutar `admin_trigger_web_pages_workflow()` para altas o correcciones de
fichajes. La pantalla consulta `rider_transfers` en vivo y no depende de una
regeneración de páginas estáticas.
