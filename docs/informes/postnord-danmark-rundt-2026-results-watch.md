# Runbook — Resultados de la Vuelta a Dinamarca 2026

Procedimiento operativo para vigilar y volcar manualmente los resultados de las
etapas restantes de la Vuelta a Dinamarca 2026 desde Sportstiming.

Este documento describe el flujo de trabajo del proyecto. No sustituye el contrato
interno de la fuente ni documenta sus endpoints no públicos.

## Datos fijos

| Campo | Valor |
|---|---|
| `raceId` | `XCUHepDJ484CSPUKLhvP` |
| Fuente | `sportstiming` |
| `competitionId` | `-89615` |
| Código estable | `postnord-danmark-rundt-2026` |
| Startlist | 145 corredores |

Cada etapa tiene un evento distinto en Sportstiming. Confirmar el identificador de
la URL del día; no deducirlo sumando uno al de la etapa anterior.

## Regla principal del loop

1. Empezar en la hora estimada de meta de `race_days.estimatedFinishTimeUtc`.
2. Sondear la página cada cinco minutos.
3. **En cuanto la clasificación de etapa tenga un `rank = 1`, hacer el primer
   volcado aunque todavía falten corredores.**
4. Repetir el volcado cada cinco minutos con el estado más reciente.
5. El criterio de completitud sirve para detener el loop, **nunca para retrasar el
   primer volcado**.

Antes de que exista `rank = 1`, Sportstiming puede mostrar DNS o DNF. Esas filas se
conservan como información de seguimiento, pero no se materializa ninguna
clasificación en Supabase.

## Acceso cuando aparece Turnstile

Sportstiming puede devolver una comprobación humana tanto al fetch programático como
al navegador. No intentar rodearla.

1. Abrir el evento en el navegador y completar la comprobación normal.
2. Abrir la clasificación de etapa y todas las pestañas acumuladas visibles:
   general, puntos, montaña, jóvenes, combatividad y equipos.
3. Guardar el HTML de cada tabla en una carpeta temporal con los nombres que espera
   `--html-dir`:

   ```text
   stage.html
   leader.html
   points.html
   hill.html
   youth.html
   fighter.html
   team.html
   ```

4. En equipos, usar la vista visible **Holdkonkurrencen**. El listado de standings
   alternativo puede estar vacío aunque esa vista ya tenga la clasificación.
5. Tras recargar, esperar a que la tabla contenga filas antes de guardar el HTML. El
   `DOMContentLoaded` puede dispararse antes de que Sportstiming termine de pintarla.

## Dónde leer cada clasificación

Las pestañas de `/event/<evento>/results?viewType=...` son las clasificaciones
de la **etapa** (y sus puntos del día), no necesariamente las acumuladas. Para
el volcado hay que separar ambas superficies:

- Etapa: `/event/<evento>/results`.
- General, puntos, montaña, jóvenes y combatividad acumulados: abrir
  `/event/<evento>/standings` y usar las cinco pestañas `standings/leader`,
  `standings/points`, `standings/hill`, `standings/youth` y
  `standings/fighter`.
- Equipos: comprobar `standings/team` y la pestaña visible
  `results?viewType=team`. Sportstiming puede publicar las demás generales
  antes que la tabla de equipos; si ambas están vacías, no emitir `teams` y
  reintentar en la siguiente pasada.

No confundir los puntos o la montaña de `results?viewType=...` (lo ganado hoy)
con las acumuladas de `standings/...`: solo estas últimas se guardan como
`scope='overall'`.

## Generar el JSON

Ejemplo para la etapa 2; sustituir evento, etapa y fecha:

```bash
node scripts/results-fetchers/sportstiming-results-fetch.mjs \
  --event 18579 \
  --stage 2 \
  --code postnord-danmark-rundt-2026 \
  --competition-id -89615 \
  --date 2026-07-30 \
  --html-dir /private/tmp/sportstiming-pndkr-2026-stage-2 \
  --out /private/tmp/sportstiming-pndkr-2026-stage-2-json
```

El fetcher normaliza los microcortes de `Behind #1` recalculando el gap de etapa
desde el tiempo oficial de grupo. Antes de volcar, comprobar:

- ganador y tiempo;
- filas clasificadas e IRM;
- dorsales únicos;
- ranks y gaps razonables;
- clasificaciones acumuladas presentes;
- equipos con `riderDisplay = teamName`, tiempo del líder y gaps;
- `rowCount === rows.length`.

## General y jóvenes durante el recálculo

Justo después de meta, Sportstiming puede servir una clasificación transitoria
inválida: algunos corredores conservan el total de la víspera y otros ya tienen el
acumulado del día. En la etapa 2 se mezclaron tiempos de unas cuatro horas con otros
de unas ocho, colocando temporalmente a Van Aert 57.º a casi cuatro horas.

No volcar `gc` ni `youth` mientras mezclen órdenes de magnitud. Si ya entraron:

1. retirar solo esas clasificaciones de la etapa;
2. conservar etapa, puntos, montaña, combatividad y equipos;
3. reinsertar general y jóvenes cuando todos sus tiempos absolutos correspondan al
   mismo número de etapas.

## Filas IRM que desaparecen del HTML

La fuente puede mostrar DNS/DNF antes de meta y ocultarlos después al regenerar la
tabla. Un re-volcado no debe borrar estados ya confirmados.

Antes de emitir el JSON definitivo, fusionar los IRM conocidos que no estén en la
captura nueva, siempre que su dorsal no aparezca ya como clasificado. Mantenerlos al
final con:

- `rank = null`;
- `rankText = irm`;
- `irm = DNS|DNF|OTL|DSQ`;
- tiempos y gap nulos.

## Cola truncada de la clasificación de etapa

En las etapas 1 y 2 la tabla de etapa quedó truncada, mientras la general ya incluía
a todos los corredores. El loop no debe esperar indefinidamente si la cobertura se
puede demostrar.

Para una etapa posterior a la primera:

1. Tomar los dorsales que terminaron la jornada anterior.
2. Restar los contabilizados hoy en etapa, incluidos los IRM.
3. Verificar que cada ausente sí aparece en la general actual.
4. Para corredores fuera de los puestos con bonificación, calcular:

   ```text
   tiempo_etapa_hoy = tiempo_general_hoy - tiempo_general_ayer
   gap_etapa_hoy = tiempo_etapa_hoy - tiempo_del_ganador
   ```

5. Reconstruir solo si todos los gaps forman una cola coherente posterior al último
   corredor publicado. No aplicar esta resta a corredores bonificados.
6. Ordenar la cola por gap y usar la general como desempate estable cuando varios
   corredores tengan el mismo tiempo.
7. Revalidar que todos los dorsales objetivo están contabilizados una sola vez.

En la etapa 2 se reconstruyeron así los puestos 122–137. El resultado final fue
137 clasificados + 4 IRM = los 141 corredores que habían terminado la etapa 1.

## Volcado por Supabase MCP

Generar el SQL con el upsert canónico:

```bash
node scripts/results-fetchers/results-upsert.mjs \
  --in /private/tmp/sportstiming-pndkr-2026-stage-2-json/-89615.json \
  --race-id XCUHepDJ484CSPUKLhvP \
  --source sportstiming \
  --emit-sql /private/tmp/sportstiming-pndkr-2026-stage-2.sql
```

Revisar el resumen y aplicar el SQL mediante el conector MCP de Supabase. No usar
REST ni credenciales en scripts. El upsert es transaccional e idempotente: si una
fila inválida hace fallar el lote, todo queda en rollback y se corrige el JSON antes
de reintentar.

## Verificación después de cada pasada

```sql
SELECT s."classKind", s.scope, s."rowCount", s."winnerName",
       COUNT(r.id) AS filas_reales,
       COUNT(*) FILTER (
         WHERE r."globalRiderId" IS NULL AND r.bib IS NOT NULL
       ) AS sin_enlazar
FROM race_uci_stages s
LEFT JOIN race_uci_results r ON r."stageRef" = s.id
WHERE s."raceId" = 'XCUHepDJ484CSPUKLhvP'
  AND s."stageNumber" = <ETAPA>
GROUP BY s.id
ORDER BY s."classKind";
```

Para cerrar el loop:

- la etapa tiene `rank = 1`;
- todos los corredores objetivo están clasificados o tienen IRM;
- `rowCount` coincide con las filas reales;
- `sin_enlazar = 0`;
- general y jóvenes no mezclan totales de días distintos;
- se han revisado las seis complementarias, incluida equipos.

## Incidencias aprendidas en la etapa 2

- El primer volcado debía hacerse al aparecer `rank = 1`; esperar a completar todos
  los corredores fue un error de procedimiento.
- La general transitoria mezcló tiempos de una y dos etapas.
- La etapa cambió de ganador provisional: Plowright apareció primero y después
  Sportstiming situó a Van Aert como ganador.
- Los DNS/DNF iniciales desaparecieron de capturas posteriores y hubo que
  conservarlos.
- Equipos estaba en la vista visible de resultados aunque el standings alternativo
  estuviera vacío.
- Las cabeceras de equipos llegaron en inglés; el parser debe admitir
  `Time`/`Behind #1` además de `Tid`/`Efter #1`.
- Las filas de equipos necesitan `riderDisplay = teamName` porque la columna es
  `NOT NULL` en `race_uci_results`.
