# Limpieza global dirigida de resultados UCI 2026 — 2026-08-30

## Estado y autorización

- **Estado:** completada.
- **Operación:** `global-results-cleanup-20260830`.
- **Proyecto Supabase:** `bcecwlkynpgovnzhbpah`.
- **Alcance:** correcciones dirigidas en `public.race_uci_results` con
  evidencia estructural inequívoca.
- **Autorización:** continuación explícita de la limpieza global solicitada
  por Dani el 2026-08-30.
- **I/O:** todas las lecturas y escrituras se ejecutaron mediante MCP
  Supabase.

## Preflight

La auditoría global detectó 294 valores no nulos de
`race_uci_results.teamId` que no coincidían con `teams.id`. Los 294 sí
coincidían con una fila `startlist_teams`, y sus valores `startlist_teams.teamId`
eran no nulos y existentes en `teams`. El conjunto tenía 49 filas de
inscripción distintas y 38 equipos canónicos.

El alcance quedó limitado a estas carreras y no se extendió a otros resultados:

| Carrera | `raceId` | Filas |
|---|---|---:|
| Konvert Kortrijk Koerse | `wyPulMAO9ifb8EIobUsV` | 157 |
| Argenta Classic - Deurne | `XXREjBydVZ00t5V5FYP7` | 136 |
| GP de Nogent-sur-Oise | `6NbeLIBFDcuCgOf3XDVp` | 1 |

Las 294 filas eran resultados individuales. Ninguna era una clasificación
colectiva.

Durante el preflight, la fila previamente auditada como `id=1729472` del Tour
of Samsun ya no existía. La clasificación del mismo evento, dorsal 27 y
`OETOMO Yosandy Darmawan`, figura actualmente como `id=1730111` con
`globalRiderId='oetomo-yosandy-darmawan'`. No se atribuye ese cambio a esta
operación y no se modifica el resultado.

## Backup

Se aplicó la migración
`20260830180000_backup_global_results_cleanup_20260830.sql`, que creó la tabla
privada:

`private.repair_global_results_cleanup_20260830_backup`

La tabla no tiene privilegios para `public`, `anon` ni `authenticated`; solo
`service_role` tiene `SELECT` e `INSERT`. Antes de reparar se almacenaron 294
snapshots completos (`to_jsonb(r)`), con la clave:

- `operation = 'global-results-cleanup-20260830'`;
- `entity = 'race_uci_results_team_override'`;
- `row_id = race_uci_results.id`.

El backup permanece sin borrar.

## Cambios aplicados

Se ejecutó una actualización dirigida que, para cada fila respaldada, sustituyó
`race_uci_results.teamId` por el `startlist_teams.teamId` canónico. Se
actualizaron exactamente 294 filas. No se tocaron `globalRiderId`, `rank`,
`rankText`, `bib`, `riderDisplay`, `resultValue`, `timeText`, `gapText`,
`points`, `irm`, `sortOrder` ni `uciPoints`.

No se crearon equipos, no se cambiaron startlists y no se generaron
startlists para Campeonatos Nacionales `results-only`.

## Verificadores de cierre

Consulta de cierre por MCP Supabase:

| Control | Resultado |
|---|---:|
| Filas de resultados 2026 | 308.063 |
| Resultados 2026 sin `globalRiderId` | 7.005 |
| Clasificaciones colectivas 2026 | 5.470 |
| Colectivas sin `teamId` | 0 |
| Resultados individuales sin `globalRiderId` | 1.535 |
| Individuales sin `globalRiderId` y sin startlist | 1.535 |
| Carreras con ese pendiente results-only | 106 |
| Referencias de equipo inválidas, todos los años | 0 |
| Referencias de corredor global inválidas, todos los años | 0 |
| Conflictos resultado-equipo/sexo 2026 | 0 |
| Corredores de startlist 2026 sin `globalRiderId` | 0 |
| Referencias colgantes de equipo en startlists | 0 |
| Filas del backup | 294 |

Los 7.005 `globalRiderId` nulos no son todos deuda: 5.470 pertenecen a
clasificaciones colectivas, donde el corredor y el dorsal deben permanecer
nulos, y 1.535 pertenecen a resultados-only sin startlist. El pendiente
individual no se resuelve por semejanza nominal ni mediante la creación de
startlists sintéticas.

## Rollback no ejecutado

El rollback requiere una nueva autorización y una lectura previa de las 294
filas actuales. La restauración dirigida usaría `row_data->>'teamId'` del
backup, casando por `operation`, `entity` y `row_id`, y verificaría que no haya
un enlace posterior legítimo antes de escribir. El backup no se elimina.

## Alcance pendiente

La limpieza global de los cabos reales de resultados queda cerrada: no existen
referencias de equipo inválidas, referencias globales inválidas ni colectivas
sin equipo. Permanecen únicamente los 1.535 resultados individuales de 106
carreras results-only sin evidencia de startlist; deben permanecer pendientes
hasta disponer de una fuente oficial de identidad o de una startlist oficial.
