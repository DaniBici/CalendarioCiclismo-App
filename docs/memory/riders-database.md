# Base de datos de corredores

Introducida en `058_riders.sql`. Ampliada en `060_riders_source_verified_and_indexes.sql` y `061_startlist_riders_resolved_view.sql`. Permite normalizar nombres de corredores en startlists sin tener que corregir manualmente en cada carrera, y sustenta la futura página individual `/rider/<id>`.

## Esquema

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

## Vista `startlist_riders_resolved`

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

## Sincronización snapshot ↔ BD canónica

Para que apps antiguas (que leen la tabla, no la vista) sigan viendo nombres correctos:

1. **`saveStartlistEdits` (`js/panel/startlists.js`)**: usa preparación persistente y aplicación atómica. Reutiliza identidad exacta/alias/identificador UCI únicos; las variantes se revisan. Solo crea fichas tras completar nacionalidad y nacimiento (`source='startlist_import'`, `verified=false`). Sincroniza snapshots y enlaces por dorsal una vez.
2. **`saveRider` (`js/panel/riders.js`)**: al editar un rider de BD, se hace `UPDATE startlist_riders SET firstName=…, lastName=… WHERE globalRiderId=…`. El `countryCode` NO se propaga (preserva overrides de selecciones nacionales).
3. **`deleteRider` (`js/panel/riders.js`)**: avisa cuántas startlists tienen el rider linkado, hace `UPDATE startlist_riders SET globalRiderId=NULL WHERE globalRiderId=…` antes de `DELETE`, evita huérfanos. El snapshot del nombre se preserva como fallback.

## Campo `otherNames`

Separados por coma. Se usa para detectar variantes del nombre que aparecen en startlists importadas (no altera `firstName`/`lastName`):

| Caso | `lastName` | `otherNames` | Matchea |
|---|---|---|---|
| Segundo apellido español | `Rodríguez` | `Cano` | "Rodríguez Cano Carlos" o "Rodriguez Cano" |
| Variante sin apóstrofo | `O'Connor` | `OConnor` | "OConnor Ben" |
| Nombre de pila alternativo | `Pogačar` | — | — (basta con el apellido) |
| Abreviatura usada en listas | `Quemeneur` | `JB` | "Quemeneur JB" |

## Matching y altas

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

## Categorías de equipo (`teams.category`)

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

## Carga del editor

`openStartlistEditor` consulta equipos de la lista y catálogo de equipos en paralelo;
lee los inscritos desde la vista resuelta. Los datos de plantilla se cargan solo
si se usan para completar una entrada manual. No hay un barrido de 2.000 fichas ni
consultas nominales individuales durante la importación del archivo.

## Mantenimiento

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
- **Cambio de slug**: el `id` también es editable desde el panel (carretera y CX). Las RPC `admin_rename_rider` (carretera) y `cx_rename_rider` (CX, migración `admin_rename_rider_rpc`) reasignan el `id` y re-vinculan en una transacción las referencias blandas. Carretera (migraciones `admin_rename_rider_full_relink` y `admin_rename_rider_affiliations_first`): afiliaciones con su `id` determinista regenerado, antes que inscritos para que la sincronización de plantillas de club no cree una afiliación duplicada; inscritos, resultados, transferencias, alias de identidad, `private.historical_team_roster_observations`, `private.historical_participation_decisions`, `private.rider_uci_profile_aliases` y `private.uci_catalog_changes`. Filtra por género, ya que `riders_men` y `riders_women` comparten ids; si el id existe en ambas tablas y una referencia sin género no permite decidir, se detiene. `start_order_entries."riderId"` referencia `startlist_riders` y no se modifica; `private.historical_identity_changes` conserva el id histórico. En CX (`cx_rename_rider`), además, las generales de torneo; inscritos, resultados y generales se filtran por la inicial de la categoría (M/W), como defensa adicional: desde la migración `cx_rider_id_unique_across_genders` un trigger impide ids compartidos entre `cx_riders_men` y `cx_riders_women`, y la ingesta elige un id libre en ambas tablas. Ante choque de `identityKey`, si es la misma persona se fusiona; si son homónimos reales, se declara con la clave `base-añoNacimiento` (requiere fecha de nacimiento). Lógica compartida en `js/rider-rename-logic.js`.
- **IDs únicos entre géneros**: un id no puede existir a la vez en `riders_men` y `riders_women` (trigger `a01_rider_id_unique_across_genders`); los generadores de la base de datos y el panel eligen un id libre en ambas tablas. Mismo contrato en CX.
- **Añadir variante**: editar `otherNames` en el panel (campo de texto, comas como separador).
- **Añadir equipo nuevo**: dar de alta el equipo y su plantilla desde el panel (vista Equipos).
- **Revisar auto-creados**: en panel → Corredores → filtro "Sin verificar". Cada fila tiene badge "?" naranja y botón "✓" inline para marcar verificado en un click. El editor muestra el `source` para contexto.
- **Fusionar duplicados**: si un rider auto-creado coincide con uno ya existente, abrir el unverified, ir al canónico y reasignar manualmente la startlist (o eliminar el unverified — al borrar, `deleteRider` desenlaza primero y conserva el snapshot, sin huérfanos).
