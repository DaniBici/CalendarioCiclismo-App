# Runbook — Vigilancia diaria de resultados del Tour de Francia 2026

Playbook para volcar y consolidar los resultados de **cada etapa** del Tour de Francia
2026 en directo, con un loop de vigilancia supervisado por Claude. Se usa **todos los
días hasta el final del Tour** (última etapa: 21, 2026-07-26).

## Datos fijos de la carrera

| Campo | Valor |
|---|---|
| `raceId` | `u5p2npjYLwduznQbDY4e` (Tour de Francia masc 2026) |
| Fuente | **Tissot** (`race_uci_links.source = 'tissot'`) |
| `tissotCode` / comp | `tdf2026` |
| `competitionId` (puente, sintético negativo) | `-56031` |
| Género | `male` |
| Script de watch | `scripts/results-fetchers/_watch-tdf2026.sh <STAGE>` |

**Todo vive en `scripts/results-fetchers/`**: el watcher (`_watch-tdf2026.sh`), los
`.mjs` del pipeline (`tissot-results-fetch.mjs`, `results-upsert.mjs`) y el directorio
de trabajo `_results_run/` (donde se escriben el JSON y los `.eN.sig`).

⚠️ Hasta el 2026-07-18 el watcher vivía en `scripts/catalog-continental/`, el nombre
anterior al renombrado del motor de resultados. Ese directorio ya NO existe: quedaba este
único fichero huérfano y se movió aquí. Si un comando viejo lo cita, actualízalo.

El watcher es de **una pasada por invocación**: la cadencia la marca el loop, no el script.
Es genérico por etapa (recibe `<STAGE>`) y es el único que queda: los watchers de otras
carreras y el `_watch-tdf2026-e1-ttt.sh` de la CRE de la E1 ya no existen.

**Por qué Tissot y no UCI/DataRide:** Tissot publica los resultados validados 5–15 min
tras meta, antes que DataRide. El link ya está conmutado a `source='tissot'`, así que el
cron automático (`results-today.yml`) ya vuelca en la ventana de meta. Este loop es
una **capa de supervisión encima**: confirma en vivo que la etapa y —sobre todo— la
**clasificación por puntos** se rellenan bien, y **bloquea** las clasificaciones al cerrar.

## Calendario 2026 (nº de etapa · fecha · tipo · meta estimada UTC)

| E | Fecha | Tipo | Meta UTC | Notas |
|---|---|---|---|---|
| 1 | 07-04 | CRE (ttt) | 17:16 | ✅ cerrada |
| 2 | 07-05 | rolling | 15:36 | ✅ |
| 3 | 07-06 | media montaña | 15:08 | ✅ cerrada (bloqueada) |
| 4 | 07-07 | media montaña | 15:34 | |
| 5 | 07-08 | rolling | 15:46 | |
| 6 | 07-09 | alta montaña | 15:46 | |
| 7 | 07-10 | llano | 15:24 | |
| 8 | 07-11 | llano | 15:31 | |
| 9 | 07-12 | media montaña | 15:58 | |
| — | 07-13 | **DESCANSO** | — | no hay etapa |
| 10 | 07-14 | media montaña | 15:24 | |
| 11 | 07-15 | llano | 15:40 | |
| 12 | 07-16 | llano | 15:39 | ✅ cerrada (bloqueada; relegación tardía de Van Mechelen) |
| 13 | 07-17 | media montaña | 15:59 | |
| 14 | 07-18 | alta montaña | 15:38 | ✅ cerrada (bloqueada; Pogačar. Zombi de BD a mitad de volcado, ver abajo) |
| 15 | 07-19 | alta montaña | 15:55 | |
| — | 07-20 | **DESCANSO** | — | no hay etapa |
| 16 | 07-21 | **CRI (itt)** | 15:50 | ⚠ crono individual |
| 17 | 07-22 | rolling | 15:28 | |
| 18 | 07-23 | media montaña | 15:25 | |
| 19 | 07-24 | alta montaña | 15:34 | |
| 20 | 07-25 | alta montaña | 14:29 | |
| 21 | 07-26 | rolling | 17:40 | última; meta tarde |

Las horas de meta son la `estimatedFinishTimeUtc` de `race_days` (curadas); pueden variar
±10-15 min. **Arrancar el loop ~5-10 min antes de la meta estimada.**

## Cómo se lanza cada día

1. **Arranque:** unos minutos antes de la meta estimada de la etapa del día, lanzar el
   loop dinámico apuntando al script con el número de etapa correcto. La forma canónica en
   Codex es crear un **heartbeat** para el task de la vigilancia con este prompt (sustituir
   `<N>` por la etapa):

   ```
   /loop vigilancia resultados TdF 2026 E<N> (race u5p2npjYLwduznQbDY4e, Tissot tdf2026):
   ejecuta `bash scripts/results-fetchers/_watch-tdf2026.sh <N>` cada tick.
   Cadencia 60s hasta que la línea STATE muestre TOP50=1, luego 5' (300s).
   Vigila que POINTS_ROWS crezca y POINTS_WIN se rellene cuando se asignen los puntos de meta.
   CIERRE: NO antes de 45' desde la meta real (las relegaciones de los comisarios llegan
   tarde) y con >=2 pasadas seguidas CHANGED=0. Antes de bloquear, verifica integridad
   (rowCount == filas reales, 0 corredores sin enlazar). NO esperes a FINAL_GC: solo se
   rellena al cerrar la E21. Entonces BLOQUEA todas las clasificaciones de la E<N> vía MCP
   Supabase con `UPDATE race_uci_stages SET "lockedAt"=now() WHERE
   "raceId"='u5p2npjYLwduznQbDY4e' AND "stageNumber"=<N> AND "lockedAt" IS NULL;`, verifica
   que quedan bloqueadas y para el loop.
   Playbook: docs/informes/tdf-2026-daily-results-watch.md
   ```

   **Comprobación de conectividad (Codex):** antes de interpretar una primera pasada como
   «aún SIN publicar», confirmar que el entorno que ejecuta el loop tiene salida de red a
   Tissot. El watcher distingue ambos casos: `FETCH=ERROR` (y salida no nula) significa que
   el fetch falló —por ejemplo, porque el sandbox bloquea la red— y **no** que la etapa aún
   carezca de Stage Ranking. Resolver la conectividad y reintentar; no esperar a la siguiente
   actualización de resultados.

   **Asociación del heartbeat (crítico):** al crearlo, usar el **ID real del task** devuelto
   por `list_threads` como `targetThreadId`. No pasar la cadena literal `"current"`: se
   acepta como valor, pero no identifica ningún task y el heartbeat no se ejecuta. Confirmar
   en `~/.codex/automations/<id>/automation.toml` que `target_thread_id` contiene el UUID
   del task. Cuando el primer `STATE` tenga `TOP50=1`, actualizar el mismo heartbeat a cinco
   minutos; volver temporalmente a un minuto si queda un corredor entrando o se espera una
   corrección de última hora.

2. **Cadencia (la marca el loop, no el script — el script hace UNA pasada por invocación):**
   - **60s** mientras `TOP50=0` (la etapa aún no tiene 50 finishers).
   - **5' (300s)** en cuanto `TOP50=1`. A partir de ahí solo quedan por asentarse los gaps
     finos, los abandonos (DNF/DNS/OTL) y las clasificaciones secundarias.

3. **Qué vigila el script** (línea `STATE k=v` al final de cada pasada):
   - `STAGE_FIN` — finishers de la clasificación de etapa (prefijo contiguo con puesto).
   - `TOP50` — 1 si `STAGE_FIN>=50` → señal para bajar a 5'.
   - `POINTS_ROWS` / `POINTS_WIN` — **filas y líder de la clasificación por PUNTOS.**
     Es el foco de esta vigilancia: los puntos de meta se asignan al cerrarse la etapa, así
     que `POINTS_ROWS` debe **crecer** y `POINTS_WIN` **rellenarse/estabilizarse** en las
     últimas pasadas. Si la etapa está cerrada y `POINTS_ROWS` sigue a 0 o el líder no
     cuadra → investigar (feed Tissot que aún no publica la de puntos, o mapeo).
   - `CHANGED` — 1 si esta pasada volcó algo nuevo.
   - `FINAL_GC` — filas de la GC de la pseudo-final (`stageNumber` NULL). **NO es señal de
     cierre diario:** se queda a 0 durante todo el Tour y solo se rellena al cerrar la E21
     (Tissot mantiene `status=Live` hasta el 26-jul). Esperarla para cerrar una etapa
     intermedia = esperar hasta el final del Tour.

4. **El script vuelca solo cuando la firma cambia** (idempotente, prefijo contiguo, SIN
   `--source` porque el link ya es tissot). El `.eN.sig` en `_results_run/tissot-tdf2026/`
   guarda la última firma volcada por etapa.

## CIERRE — bloquear todas las clasificaciones (paso CRÍTICO)

**Criterio de cierre (los tres a la vez):**

1. **≥45 min desde la meta real.** Las **relegaciones de los comisarios llegan tarde** —
   bastante después de que el estado "se estabilice". En la **E12 (2026-07-16)** se cerró a
   los ~16 min con dos pasadas `CHANGED=0`, y ~30 min tras meta Tissot publicó la
   relegación de **Van Mechelen** (17º → **144º**, `gap=+0`: se le mantiene el tiempo del
   grupo pero se le manda al final) por tirar a Gaviria en el sprint. Como ya estaba
   bloqueada, **el cron no la aplicó** y hubo que desbloquear → volcar → re-bloquear a mano.
   Una etapa con **sprint masivo** es la de mayor riesgo.
2. **≥2 pasadas seguidas con `CHANGED=0`.**
3. **Integridad verificada** (ver query abajo): `rowCount` == filas reales y **0 corredores
   sin enlazar** en todas las clasificaciones.

⚠️ **NO usar `FINAL_GC` como señal**: se queda a 0 hasta la E21 (ver arriba).

Cumplidos los tres, **bloquear TODAS las clasificaciones de la etapa** para que ningún
volcado posterior del cron las pise. Se pone `lockedAt = now()` en `race_uci_stages`
(mismo patrón con el que quedaron E1/E3):

```sql
UPDATE race_uci_stages SET "lockedAt" = now()
 WHERE "raceId" = 'u5p2npjYLwduznQbDY4e' AND "stageNumber" = <N> AND "lockedAt" IS NULL;
```

Esto cubre las ~8 clasificaciones de la etapa: `stage`, `gc`, `points`, `kom`, `youth`,
`teams` (overall) + las gemelas `keepForWeb=false`. **Verificar tras el UPDATE** que todas
quedan con `lockedAt` no nulo:

```sql
SELECT "stageNumber","classKind",scope,"rowCount","lockedAt"
FROM race_uci_stages
WHERE "raceId"='u5p2npjYLwduznQbDY4e' AND "stageNumber"=<N>
ORDER BY "classKind",scope;
```

Se hace **vía MCP Supabase** (no por el script): el worktree no tiene `DATABASE_URL`, así
que el `UPDATE` directo por MCP es la vía limpia. Una vez bloqueadas, `results-upsert.mjs`
salta esas clasificaciones (el guard `lockedAt IS NULL` está en el propio SQL del upsert).

**Verificación de integridad ANTES de bloquear** (paso 3 del criterio) — `rowCount` debe
cuadrar con las filas reales y `sin_enlazar` debe ser 0 en las 8:

```sql
SELECT s."classKind", s.scope, s."rowCount", s."winnerName",
       COUNT(r.id) AS filas_reales,
       COUNT(*) FILTER (WHERE r."globalRiderId" IS NULL AND r.irm IS NULL
                          AND r.bib IS NOT NULL) AS sin_enlazar
FROM race_uci_stages s
LEFT JOIN race_uci_results r ON r."stageRef" = s.id
WHERE s."raceId" = 'u5p2npjYLwduznQbDY4e' AND s."stageNumber" = <N>
GROUP BY s.id, s."classKind", s.scope, s."rowCount", s."winnerName"
ORDER BY s."classKind", s.scope;
```

**La pseudo-final** (`stageNumber` NULL, `isFinalClassification`) también se bloquea al
cerrar la ÚLTIMA etapa (E21). Durante el Tour, cada etapa que cierra reescribe esa
pseudo-final con las generales del día; no se bloquea hasta el final.

### Corregir una etapa YA bloqueada (relegación tardía)

Si tras bloquear aparece una corrección (relegación, DSQ, cambio de tiempos), el cron **no
la aplicará** — el candado es justo lo que se lo impide. Hay que hacerlo a mano
(secuencia usada en la E12 con la relegación de Van Mechelen):

```bash
# 1. Desbloquear (MCP Supabase)
#    UPDATE race_uci_stages SET "lockedAt" = NULL
#     WHERE "raceId"='u5p2npjYLwduznQbDY4e' AND "stageNumber"=<N>;

# 2. Forzar el re-volcado: borrar la firma para que el watcher NO lo dé por "sin cambios"
rm -f scripts/results-fetchers/_results_run/tissot-tdf2026/.e<N>.sig
bash scripts/results-fetchers/_watch-tdf2026.sh <N>

# 3. Verificar el cambio en BD, y re-bloquear con el UPDATE de arriba.
```

El upsert es idempotente (DELETE+INSERT por clasificación) → re-volcar no duplica filas.

## Notas por tipo de etapa

- **CRI E16 (07-21):** crono individual. La web la pinta como ITT (tiempos truncados a
  segundos, gaps `+N"`). El watcher funciona igual (mismo feed). Al cerrar, comprobar que
  los tiempos/gaps son coherentes (no m.t. absurdos).
- **CRE:** ya no queda ninguna pendiente (la E1 CRE está cerrada). Si hubiera, Tissot no
  publica tiempos individuales de meta → el fetcher cae al fallback por roster (ver
  `TISSOT-TIMING-API.md` y la memoria `project_tissot_results_source`).
- **Días de descanso (07-13, 07-20):** no se lanza nada.

## Solución de problemas

- **`FATAL: --apply necesita DATABASE_URL` en la 1.ª pasada (worktree):** el `.env` está
  gitignored y **no se hereda** en un worktree. **PASO 0 antes de arrancar el loop**
  (la ruta del checkout principal se deriva sola; `-L` porque allí el `.env` es un
  symlink a Drive):
  ```bash
  cp -L "$(dirname "$(git rev-parse --git-common-dir)")/.env" ./.env
  ```
- **Leer el JSON del fetcher a mano y ver datos VIEJOS:** el default de `--out` ya está
  anclado al directorio del script (fix 2026-07-16), y la ruta que imprime es absoluta →
  fiarse SIEMPRE de esa ruta. Antes era relativa al cwd: invocarlo desde
  `scripts/results-fetchers/` escribía en una carpeta anidada distinta de la que se
  leía, y se concluía "no hay relegación" sobre un fichero rancio (pasó en la E12).
- **`E<N> aún SIN publicar` persistente pasada la meta:** Tissot puede tardar hasta
  ~15 min. Si a los 20-25 min sigue vacío, verificar que la etapa terminó de verdad y que
  el comp/stage son correctos (`node tissot-results-fetch.mjs --competition tdf2026
  --competition-id -56031 --stage <N>` imprime `status` y si la etapa tiene Stage Ranking).
- **`FETCH=ERROR` / `FETCH FAILED`:** es un fallo del fetch, no una señal de que Tissot no
  haya publicado la etapa. En Codex suele indicar que el shell está en un sandbox sin salida
  de red; ejecutar la pasada en un entorno local con red autorizada y repetirla. El watcher
  no lee ni vuelca el JSON que pudiera haber quedado de una pasada anterior.
- **El heartbeat no ejecuta pasadas:** comprobar primero su asociación. Si el archivo
  `automation.toml` muestra `target_thread_id = "current"` (literal), pausar/eliminar esa
  automatización y recrearla con el UUID real obtenido de `list_threads`; actualizar el
  prompt no corrige ese destino. Antes de depender de él para el cierre, lanzar una pasada
  manual y comprobar que el watcher imprime `FETCH=OK`.
- **`POINTS_ROWS=0` con etapa cerrada:** el feed Tissot de puntos puede ir por detrás de la
  de etapa unos minutos. Mantener el loop; si tras varias pasadas de 5' sigue vacío,
  revisar el mapeo SprintPoints→points en el fetcher.
- **`upsert FALLÓ rc=1`:** fallo fatal (no idempotente). Revisar la salida; posible
  contención de instancia (transacciones zombi) — ver memoria `project_db_contention_volcado`.
  ⚠️ **Tras CUALQUIER fallo de upsert hay que BORRAR LA FIRMA** (`rm -f
  scripts/results-fetchers/_results_run/tissot-tdf2026/.e<N>.sig`) antes de la siguiente
  pasada: el watcher guarda la firma por volcado, y si no se borra da la pasada fallida por
  buena y **no reintenta** hasta que el feed vuelva a cambiar — datos perdidos en silencio.
  Cazado en la **E14 (2026-07-18)**: `canceling statement due to statement timeout` con
  rollback, causado por una transacción **zombi** (`idle in transaction` 3m40s en
  `ClientRead` vía Supavisor, con un INSERT a `race_uci_results` a medias) que retenía locks.
  Secuencia de rescate: localizar el backend en `pg_stat_activity` (filtrando
  `state='idle in transaction'`), comprobar que no es un proceso propio vivo,
  `pg_terminate_backend(<pid>)`, verificar integridad (el rollback deja la BD consistente),
  borrar el `.sig` y re-lanzar el watcher.
- **Transacciones zombi bloqueando `race_uci_*`:** `pg_terminate_backend` sobre los
  backends `idle in transaction` (documentado en las memorias de fuentes de resultados).

## Referencias

- Fuente Tissot: `scripts/results-fetchers/TISSOT-TIMING-API.md`, memoria
  `project_tissot_results_source`.
- Pipeline de resultados in-house: `docs/memory/` y las memorias `project_uci_results_*`.
- Bloqueo `lockedAt` (migración 087): memoria `project_panel_results_tab`.
