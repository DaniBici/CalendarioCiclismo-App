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
| `source` | TEXT | Origen: `pcs_import`, `manual`, `startlist_auto`, `fc_import`. Default `manual`. |
| `verified` | BOOLEAN | `true` cuando el admin ha revisado/confirmado los datos. Auto-creados de startlist arrancan en `false`. Default `true`. |

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
- Editor de inscritos en panel → tabla `startlist_riders` directa (el admin edita el snapshot canónico ahí).
- Apps en versiones anteriores → tabla `startlist_riders` directa. Funcionan indefinidamente porque los snapshots se mantienen sincronizados (ver siguiente sección).

## Sincronización snapshot ↔ BD canónica

Para que apps antiguas (que leen la tabla, no la vista) sigan viendo nombres correctos:

1. **`saveStartlistEdits` (panel.js)**: al guardar una startlist, los riders sin link se auto-crean en BD (`source='startlist_auto'`, `verified=false`) tras un matching exhaustivo contra el catálogo completo del género (score ≥ 0.9 → link directo). Toda startlist guardada queda 100 % linkada.
2. **`saveRider` (panel.js)**: al editar un rider de BD, se hace `UPDATE startlist_riders SET firstName=…, lastName=… WHERE globalRiderId=…`. El `countryCode` NO se propaga (preserva overrides de selecciones nacionales).
3. **`deleteRider` (panel.js)**: avisa cuántas startlists tienen el rider linkado, hace `UPDATE startlist_riders SET globalRiderId=NULL WHERE globalRiderId=…` antes de `DELETE`, evita huérfanos. El snapshot del nombre se preserva como fallback.

## Campo `otherNames`

Separados por coma. Se usa para detectar variantes del nombre que aparecen en startlists importadas (no altera `firstName`/`lastName`):

| Caso | `lastName` | `otherNames` | Matchea |
|---|---|---|---|
| Segundo apellido español | `Rodríguez` | `Cano` | "Rodríguez Cano Carlos" o "Rodriguez Cano" |
| Variante sin apóstrofo | `O'Connor` | `OConnor` | "OConnor Ben" |
| Nombre de pila alternativo | `Pogačar` | — | — (basta con el apellido) |
| Abreviatura usada en listas | `Quemeneur` | `JB` | "Quemeneur JB" |

## Algoritmo de matching

Implementado en `_slMatchRider(firstName, lastName)` en `js/panel.js`. Funciona sobre un cache pre-cargado (`_slRidersMatchCache`) al abrir el editor de startlist.

1. Normalizar input: NFD → sin diacríticos → minúsculas → solo `[a-z0-9]` → separado por espacios.
2. Buscar candidatos por `lastName` normalizado (clave del cache).
3. Fallback 1: el apellido input puede ser un `otherNames` en la BD → buscar en `_slRidersMatchByOther`.
4. Fallback 2: apellido compuesto → buscar si alguna clave del cache está contenida en el input (o viceversa). Solo si ≥ 4 chars.
5. Puntuar candidatos por `firstName`:
   - Exacto → 1.0
   - Prefijo (uno empieza con el otro) → 0.8
   - `firstName` del input aparece en `otherNames` → 0.6
   - Sin `firstName` en el input → 0.5
6. Threshold: ≥ 0.8 = aplicar automáticamente al abrir el editor. 0.5–0.7 = mostrar chip de sugerencia.

El chip de sugerencia muestra el nombre canónico con bandera y botones "Usar" y "✕".

### Botón "Auto-matchear corredores" en la toolbar del editor

`#slAutoMatchRidersBtn` ejecuta `_slAutoMatchAllRiders()` bajo demanda. Itera todas las filas sin `data-global-rider-id` y aplica el mismo threshold (≥ 0.8 enlace directo, 0.5–0.7 sugerencia). Respeta las sugerencias previamente descartadas (`suggestion.dataset.dismissed`) — para volver a verlas, cerrar y reabrir el editor. Toast final reporta `N enlazado(s) · M sugerencia(s)`. Útil tras añadir corredores manualmente con "+ Corredor" o cuando `saveStartlistEdits` recién ha auto-creado nuevos riders en la BD por una startlist hermana.

El botón se oculta si no hay BD de corredores cargada (cache vacío).

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

## Carga de riders al abrir el editor de startlist

`openStartlistEditor` consulta `riders_men` o `riders_women` (según `races.gender`) filtrando por los `currentTeamId` presentes en la startlist. Si la startlist no tiene equipos enriquecidos todavía, carga hasta 2000 riders de la tabla completa como fallback.

## Mantenimiento

- **Cambio de equipo**: actualizar solo `currentTeamId`. NO crear nueva fila — el `id` es el identificador canónico del corredor.
- **Corrección de nombre**: editar `firstName`/`lastName` directamente en el panel ("Corredores"). Se propaga al instante a las startlists linkadas.
- **Añadir variante**: editar `otherNames` en el panel (campo de texto, comas como separador).
- **Añadir equipo nuevo**: dar de alta el equipo y su plantilla desde el panel (vista Equipos).
- **Revisar auto-creados**: en panel → Corredores → filtro "Sin verificar". Cada fila tiene badge "?" naranja y botón "✓" inline para marcar verificado en un click. El editor muestra el `source` para contexto.
- **Fusionar duplicados**: si un rider auto-creado coincide con uno ya existente, abrir el unverified, ir al canónico y reasignar manualmente la startlist (o eliminar el unverified — al borrar, `deleteRider` desenlaza primero y conserva el snapshot, sin huérfanos).
