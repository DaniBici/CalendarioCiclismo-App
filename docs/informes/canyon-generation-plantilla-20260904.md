# Traslado de la plantilla de Canyon//SRAM Generation

## Manifiesto

- Identificador: `canyon-generation-roster-20260904`.
- Alcance: diez afiliaciones femeninas de 2026 y sus fichas de corredora.
- Origen: `team_devo_canyon_fem`, Canyon//SRAM zondacrypto Generation,
  identificado en el catálogo como maillot especial del destino.
- Destino: `team_1780079146432_mu00hr`, Canyon//SRAM Generation, equipo regular
  femenino CTW y filial vinculada a Canyon//SRAM para 2026.
- Evidencia: diez `riders_women.currentTeamId` y diez afiliaciones anuales sin
  fechas apuntan al maillot antiguo; ninguna afiliación apunta al destino y no
  hay otras afiliaciones de estas corredoras. Todas las afiliaciones conservan
  fuente `catalog_gold`, `verified=true` y fecha original de junio de 2026.
- Veredicto: enlace de equipo erróneo en la plantilla; `reparable`.
- Autorización: petición expresa de trasladar las ciclistas al equipo sin
  zondacrypto en esta tarea, el 4 de septiembre de 2026.
- Riesgo: colisión de ids deterministas o reasignación involuntaria por triggers.
  Se comprueban el destino vacío, el estado auditado y los cambios exactos.
- Acción: cambiar equipo e id determinista de las diez afiliaciones; el trigger
  existente recalcula `currentTeamId`. Conservar fechas, fuente y verificación.

Identificadores de corredora:

`alisch-sophie`, `bianchi-erja-giulia`, `chneslasie-araya-monaliza`,
`corvi-valentina`, `dixon-emily`, `kiros-kahsay-tsige`, `markl-jule`,
`messemer-joelle`, `roberts-awen`, `wasaty-weronika`.

## Respaldo y comprobación

La tabla privada `repair_canyon_generation_roster_20260904_backup` conserva el
manifiesto, las veinte filas anteriores, las veinte posteriores y los controles
de referencias. Las escrituras de traslado se ejecutan en una transacción por
Supabase MCP. No se modifica la entidad de maillot ni sus usos históricos.

Control inicial: 10 fichas y 10 afiliaciones en origen, 0 en destino, 110 filas
de inscritos y 585 resultados asociados a esas corredoras. Control final confirmado:
0 fichas/afiliaciones en origen, 10 en destino y conservación exacta de inscritos,
resultados, identidad de corredora y atributos deportivos de la afiliación.

Traslado aplicado el 4 de septiembre de 2026. La migración de respaldo es
`20260904064206_repair_canyon_generation_roster_backup.sql`; su tabla contiene
42 registros. El SQL ejecutado se conserva localmente en
`output/repairs/canyon-generation-20260904/transfer.sql`, fuera de Git.

## Rollback dirigido

Antes de revertir, comparar las filas vigentes con las entradas `after_rider` y
`after_affiliation`; una modificación posterior requiere revisión. En una
transacción, actualizar las diez afiliaciones identificadas por esas entradas
con `id`, `teamId` y `updatedAt` de `before_affiliation`. El trigger restaura el
equipo vigente. Restaurar únicamente `updatedAt` de las fichas desde
`before_rider`, después de comprobar que sus demás campos coinciden. Verificar
los mismos controles de referencias y el retorno de 10 filas al origen antes
de confirmar. No ejecutar resolutores ni recrear fichas.
