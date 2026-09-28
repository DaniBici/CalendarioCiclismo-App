# Auditoría y reparación de clasificaciones colectivas UCI 2026 — 2026-08-30

> Este documento conserva el corte de la primera reparación (`2.495` enlaces).
> El estado final del backfill de startlists, la creación controlada de equipos y
> la corrección del Tour del Porvenir está en
> [`catalogo-equipos-startlists-20260830.md`](catalogo-equipos-startlists-20260830.md).

## Alcance

Operación: `repair-collective-team-links-20260830`.

Se inspeccionaron las filas de `public.race_uci_results` unidas a
`public.race_uci_stages` y `public.races` con:

```sql
rc."year" = 2026
AND s."classKind" = 'teams'
AND s."isTeamEvent" = true
AND r."globalRiderId" IS NULL
```

El censo contiene 5.470 filas en 265 stages de 39 carreras. La consulta
solicitada indicaba 5.452; la diferencia son 18 filas del stage
`ru_-1268830006`, `Clubklassement`, de Dwars door het Hageland. Ese stage tiene
`competitionId=-126883`, `uciRaceId=-1268830000`, fecha `2026-06-20`,
`sourcePdfUrl IS NULL` y no tiene coincidencia en `startlist_teams`.

La estructura confirma que son clasificaciones colectivas, no corredores:

- 5.470 filas tienen `bib IS NULL` y `riderDisplay IS NOT NULL`.
- `riderDisplay` contiene nombres de equipos o selecciones.
- No hay ninguna fila colectiva con `globalRiderId` no nulo.
- Las 5.470 filas pertenecen a carreras con `resultsOnly=false`.
- No se crearon startlists de Campeonatos Nacionales `resultsOnly`; el alcance
  colectivo no contiene ninguna carrera de ese tipo.

El campo `sourcePdfUrl` está vacío en 5.072 filas del alcance. La evidencia de
fuente disponible en la base de datos se conserva en los enlaces oficiales de
cada carrera (`races.websiteUrl` y `race_uci_links`). La reparación no usó
fuentes externas fuera de Supabase.

## Criterio aplicado

Antes de escribir se exigió:

1. coincidencia de `fold_team_name(startlist_teams.teamName)` con
   `fold_team_name(race_uci_results.riderDisplay)`;
2. misma carrera;
3. exactamente un `startlist_teams.teamId` distinto de NULL;
4. existencia del equipo en `public.teams`;
5. sexo del equipo nulo o compatible con `races.gender`;
6. `race_uci_results.teamId IS NULL` y `globalRiderId IS NULL`.

La huella determinista de la selección `id:teamId` fue
`7162dfa674a6376516d340bed2d781da`; comprendía 2.495 filas, 164 equipos y
ningún stage bloqueado. Se conservaron los `teamId` ya existentes en
`startlist_teams`, incluidos 230 enlaces a ediciones especiales de equipos que
ya estaban asignados explícitamente a esa carrera. No se hizo matching contra
ediciones especiales del catálogo cuando no existía esa evidencia de startlist.

El backup se creó antes de la actualización en
`private.repair_collective_team_links_20260830_backup`. Contiene 2.495 filas,
todas con `teamId` y `globalRiderId` nulos, con huella previa
`433865563450690422e95d21d3a89d4b`. La tabla privada tiene RLS habilitado y
privilegios explícitos únicamente para `service_role`.

## Resultado

| Estado | Filas |
| --- | ---: |
| Colectivas totales | 5.470 |
| `teamId` enlazado antes | 2.322 |
| Enlaces aplicados | 2.495 |
| `teamId` enlazado después | 4.817 |
| Pendientes | 653 |

Los 2.495 enlaces aplicados cubren 26 carreras. Solo se actualizó
`race_uci_results.teamId`; no se modificaron nombres, puestos, tiempos,
dorsales, puntos, IRM, `globalRiderId`, `startlist_teams`, `startlist_riders` ni
`teams`.

## Pendientes y recomendación

Las 653 filas restantes se clasifican así:

| Estado | Filas | Acción |
| --- | ---: | --- |
| Coincidencia de nombre en startlist con `teamId` NULL | 265 | Pendiente de enlazar la startlist o aportar fuente oficial; no crear equipo automáticamente. |
| Sin coincidencia de nombre en la startlist | 387 | Pendiente de roster o clasificación oficial por carrera. |
| Coincidencia única con sexo incompatible | 1 | Mantener NULL; `Norway` del Tour del Porvenir masculino no debe enlazarse a `team_ntw_norway`. |

Dentro de las 387 sin coincidencia de startlist, el cruce conservador con el
catálogo produjo 130 candidatos únicos por nombre y sexo, cuatro candidatos
ambiguos, cuatro candidatos con sexo incompatible y 249 sin candidato. Los 130
no se aplicaron: sin evidencia de la misma carrera no son enlaces inequívocos.

También se detectaron 11 enlaces preexistentes con sexo incompatible, todos en
el Tour del Porvenir masculino: cinco filas a `team_ntw_indonesia` y seis a
`team_ntw_norway`. No se modificaron porque esta operación solo completa NULL y
no existe en este manifiesto una fuente oficial específica para decidir si deben
desenlazarse, sustituirse por un NTM o corregirse en la startlist. Deben formar
una operación dirigida independiente.

Recomendación operativa:

- Mantener los 2.495 enlaces aplicados y reutilizar el catálogo existente cuando
  exista la coincidencia única de startlist ya usada.
- No crear equipos nuevos para las 653 filas pendientes sin clasificación o
  roster oficial inequívoco.
- Revisar primero los 265 equipos de startlist sin `teamId`, después los 387
  nombres sin startlist; cualquier equipo nacional nuevo debe seguir el contrato
  NTM/NTW de `cc-startlists-corredores` y tener fuente oficial.
- Corregir los 11 enlaces de sexo incompatible en una operación separada y
  dirigida. No convertir ninguna de estas filas colectivas en corredores.
- Investigar el stage de Hageland y completar su fuente o startlist antes de
  considerar cualquier enlace.

## Verificadores ejecutados

Los detectores posteriores devolvieron:

- 5.470 filas colectivas, 4.817 con `teamId` y 653 pendientes.
- 0 filas colectivas con `globalRiderId`.
- 0 filas colectivas con dorsal y 0 `riderDisplay` nulos.
- 0 residual del criterio seguro aplicado.
- 2.495 filas en el backup y 2.495 filas actuales enlazadas desde ese backup.
- 0 referencias de equipo colgantes entre las filas reparadas.
- 0 incompatibilidades de sexo entre las 2.495 filas reparadas.
- 0 filas colectivas en carreras `resultsOnly`.

Los 11 enlaces incompatibles indicados en «Pendientes» son preexistentes y no
pertenecen al lote reparado.

## Rollback dirigido

El rollback, si se autoriza, debe limitarse a la operación y entidad del backup,
restaurando únicamente el valor anterior de `teamId`:

```sql
UPDATE public.race_uci_results r
SET "teamId" = NULL
FROM private.repair_collective_team_links_20260830_backup b
WHERE b.operation = 'repair-collective-team-links-20260830'
  AND b.entity = 'race_uci_results'
  AND r.id::text = b.row_id
  AND b.row_data->>'teamId' IS NULL;
```

No se ejecutó rollback.

## Advisor de seguridad posterior

El advisor de Supabase informa `rls_enabled_no_policy` como nivel informativo
para la tabla privada creada. Es intencionado: RLS está habilitado, no hay
políticas para roles públicos y los privilegios explícitos se limitan a
`service_role`. Referencia: [Supabase Database Linter — RLS enabled without a
policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

También permanecen avisos preexistentes y ajenos a esta operación sobre
`pg_net` en `public` y varias funciones `SECURITY DEFINER` ejecutables por
`anon`. No se modificaron en este saneamiento. Referencias: [extensión en
`public`](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)
y [funciones `SECURITY DEFINER` ejecutables por
`anon`](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
