# Limpieza global de identificadores UCI — 2026-08-30

> **Estado posterior (2026-08-30):** el contrato de licencia de 11 cifras quedó retirado. Las columnas `uciId` de `riders_men` y `riders_women` se eliminaron después de crear el backup completo `private.uci_id_drop_20260830_backup`. Este documento conserva el manifiesto y la verificación de la limpieza anterior; la retirada está descrita en [`retirada-uci-id-20260830.md`](retirada-uci-id-20260830.md).

## Manifiesto de operación

- **Operación:** `uci-license-contract-20260830`
- **Proyecto Supabase:** `bcecwlkynpgovnzhbpah`
- **Fecha de apertura:** 2026-08-30
- **Alcance exclusivo:** `public.riders_men` y `public.riders_women`.
- **Criterio de inclusión:** filas con `uciId IS NOT NULL` en cualquiera de las dos tablas en el instante del backup.
- **Fuera de alcance:** resultados, startlists, afiliaciones, `globalRiderId`, equipos, homónimos y fichas que no estén afectadas por este contrato.

## Fotografía previa

Consulta de control ejecutada por el conector MCP de Supabase a las `2026-08-30 05:41:45.317958+00`:

| Control | Valor |
|---|---:|
| Filas totales de corredores | 12.674 |
| `uciId` no nulos | 4.243 |
| Códigos de licencia válidos (`^[0-9]{11}$`) | 29 |
| Identificadores internos de perfil (`^[0-9]{5,7}$`) | 4.213 |
| Valores no válidos restantes | 1 |
| Valores no nulos distintos | 4.243 |
| Duplicados entre géneros | 0 |

Valor no válido identificado: `riders_women/wirski-erica`, `USA19940501`, origen `startlist_official_raceresult`. Se conservará en el backup y se limpiará del campo vivo; no se convertirá por inferencia.

## Contrato nuevo

- `uciId` queda reservado al código oficial UCI de licencia de **exactamente 11 cifras**.
- `uciProfileId` conserva el identificador interno numérico de la URL pública `/rider-details/<id>`.
- La ausencia de código de licencia queda representada por `NULL`.
- No se asignan códigos por semejanza nominal ni se fusionan homónimos.
- Los códigos procedentes de una fuente deben validarse con `^[0-9]{11}$` antes de entrar en la base de datos.

La guía organizativa de la UCI define el UCI ID como un número de once cifras que acompaña al corredor durante su carrera: <https://assets.ctfassets.net/761l7gh5x5an/GU3rEQggTTe2V589z8Es9/a780bdc6596c8049b12b1b8162d6d67f/organisation-guide-track-cycling-international-competitions.pdf>. El módulo público de equipos solo expone el identificador de perfil. El módulo DataRide `LICENCEES`, que permite buscar por UCI ID, requiere sesión de usuario: <https://downloads.ctfassets.net/761l7gh5x5an/11kU1UF3fm58W6UMmB0T2C/3fd40103fb5d961a66d03b7fd9a484ef/training-guide-for-road-commissaires.pdf>.

## Backup y migración

- **Migración:** `20260830060000_uci_license_profile_contract.sql`
- **Backup:** `private.uci_license_cleanup_20260830_backup`
- **Filas previstas en backup:** 4.243, una por cada `uciId` no nulo de la fotografía previa.
- El backup contiene la fila completa como `row_data`, género, ID, operación y fecha UTC.
- La migración añade checks `NOT VALID` para bloquear nuevas escrituras que no sean de 11 cifras. Se validarán después de la limpieza.

## Secuencia autorizada

1. Aplicar la migración DDL.
2. Insertar en el backup las filas que cumplan el criterio de inclusión y comprobar recuento, distribución y hash determinista.
3. Copiar cada identificador interno de 5–7 cifras a `uciProfileId` si está vacío y poner `uciId = NULL`.
4. Poner a `NULL` los valores no válidos no numéricos, conservados en el backup.
5. Validar los checks y ejecutar la auditoría global de cierre.

## Rollback no ejecutado

El rollback se haría de forma dirigida desde `private.uci_license_cleanup_20260830_backup`, restaurando por `gender + rider_id` los campos `uciId` y `uciProfileId` de `row_data`, previa comprobación de que no exista una asignación posterior legítima. No se ejecutará automáticamente ni se eliminará el backup.

## Verificaciones de cierre

- Todos los `uciId` vivos son `NULL` o coinciden con `^[0-9]{11}$`.
- Todos los antiguos perfiles numéricos de 5–7 cifras están en `uciProfileId`.
- No hay duplicados de `uciId` ni de `uciProfileId` dentro de cada género ni valores cruzados entre géneros.
- `startlist_riders.globalRiderId`, `race_uci_results.globalRiderId` y `rider_team_affiliations.riderId` no cambian por esta limpieza.
- El ingestor UCI no escribe nunca un identificador de perfil en `uciId` y solo acepta licencias validadas de 11 cifras mediante un mapa o una fuente oficial.

## Resultado verificado

Auditoría de cierre ejecutada por Supabase MCP a las `2026-08-30 05:53:55.397261+00` UTC:

| Control | Valor |
|---|---:|
| Fichas totales | 12.674 |
| `uciId` no nulos | 34 |
| `uciId` válidos de 11 cifras | 34 |
| `uciId` inválidos | 0 |
| `uciProfileId` no nulos | 4.213 |
| Perfiles internos copiados desde el backup | 4.213 |
| Licencias preservadas desde el backup | 29 |
| Duplicados de licencia dentro de género | 0 |
| Duplicados de perfil dentro de género | 0 |
| Duplicados cruzados entre géneros | 0 |
| Duplicados de `identityKey` dentro de género | 0 hombres / 0 mujeres |
| Claves nominales compartidas entre tablas de género | 6, conservadas separadas |
| Checks UCI validados | 2 / 2 |

Tras la limpieza, un proceso concurrente incorporó cinco licencias adicionales válidas (`annie-scott`, `goudswaard-skyler`, `lawson-mairen`, `tait-amanda`, `yeakey-hannah`). Por ese motivo el cierre contiene 34 códigos frente a los 29 de la fotografía del backup. No apareció ningún valor inválido nuevo.

El backup permanece intacto con 4.243 filas y hash `601d955c855ac3cbeaf09669a4badfb6`.

La operación no escribió resultados, startlists, afiliaciones ni `globalRiderId`. La consulta global de referencias detecta 8 resultados con IDs de corredor inexistentes, 1 startlist con ID inexistente y 2 afiliaciones con ID inexistente; son anomalías ajenas a esta operación y quedan fuera de alcance. También quedan 7.050 resultados globales sin `globalRiderId` y 0 startlists sin `globalRiderId`; no se corrigen aquí para no ampliar el alcance a corredores antiguos.

Las seis claves nominales compartidas por las tablas masculina y femenina son `aerts-toon`, `bernard-thibaut`, `de-pestel-sander`, `geeraerts-ferre`, `zhang-hao` y `thonnon-senne`. No se fusionan: las tablas mantienen el género como frontera de identidad y `zhang-hao` conserva además dos perfiles UCI distintos.

## Pendientes explícitos

El catálogo completo de licencias no se puede obtener del roster público de equipos sin acceso autorizado al módulo DataRide `LICENCEES`. Se verificó además el servicio oficial UCI ID Webservice (`https://dataridews.uci.ch/licensees/`): su WSDL público expone las operaciones de lectura `GetPeople`/`GetPeopleDetail` y el campo `Person.UCIID`, pero una petición de solo lectura sin credenciales al endpoint `People.svc` devolvió `HTTP 401` con `WWW-Authenticate: Negotiate, NTLM` el `2026-08-30 06:11:45+00`. El servicio queda identificado como fuente oficial utilizable cuando se disponga de acceso federativo o de una exportación autorizada; no se intentará sortear esa autenticación.

El siguiente insumo requerido es una exportación autorizada de `LICENCEES` o del servicio UCI ID Webservice que conserve, como mínimo, nombre, fecha de nacimiento, nacionalidad y `UCIID` de 11 cifras. La asociación con `uciProfileId` se hará solo mediante una clave de perfil suministrada por la exportación o mediante coincidencia exacta de nombre, fecha, nacionalidad y género con revisión de colisiones; nunca por semejanza nominal aislada. Los corredores sin evidencia oficial de 11 cifras permanecerán con `uciId = NULL`.
