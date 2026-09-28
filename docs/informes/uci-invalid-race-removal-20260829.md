# Retirada de carrera UCI sin resultado publicable — 2026-08-29

## Ítem aplicado

- Carrera: `31d6e3dd-3fbf-422c-aaf9-7afa0ab3aa4c`
- Nombre: `Campeonato de Barbados línea femenino`
- `race_uci_links.competitionId`: `77938`
- `race_uci_links.uciRaceId`: `256008`
- Fuente: UCI DataRide
- Motivo: DataRide devolvió una única clasificación `Women Elite - Individual Road Race`
  con una única fila `HINDS Danielle`, `rankText=DNS`, `irm=DNS`; no había `rank=1`
  válido sin IRM.

La comprobación inmediatamente anterior al borrado confirmó una carrera, una jornada,
un enlace UCI, cero etapas UCI, cero filas de resultados y cero ganadores principales
válidos.

## Operación

La función `private.delete_invalid_results_race` guardó primero el estado completo de
la carrera y sus dependencias, eliminó los vínculos privados de emisiones que usan
`ON DELETE RESTRICT`, y después eliminó `race_days` y `races`. Las tablas con `CASCADE`
o `SET NULL` quedaron gestionadas por sus restricciones.

- Operación: `manual-invalid-results-barbados-women-20260829`
- Backup: `private.repair_invalid_results_race_20260829_backup`
- Verificación: carrera, jornada, enlace, etapas y resultados inexistentes; backup de
  una fila con las claves de todas las tablas relacionadas.

## Prevención

`results-cron.mjs --scope backlog` solo retira una carrera cuando todas sus fuentes
configuradas responden y ninguna contiene una clasificación principal publicable. Un
fallo de fetch o de upsert no autoriza el borrado. La operación mantiene una guarda SQL
contra el borrado de una carrera que ya tenga un ganador válido y conserva el snapshot
antes de la eliminación.

## Rollback

Detener temporalmente `cc-results.timer`, consultar el `payload` por
`operation_id` y restaurar las filas en orden inverso a la eliminación: `races`,
`race_days`, entidades auxiliares y jornadas UCI, resultados, enlaces y dependencias
privadas. Verificar después las claves foráneas, el slug y los recuentos antes de
reactivar el timer. No reutilizar el snapshot para otra carrera.
