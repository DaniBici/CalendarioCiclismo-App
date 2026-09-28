# Retirada de `uciId` de las fichas de corredores

## Manifiesto previo

- **Operación:** `drop-uci-license-column-20260830`
- **Fecha de la fotografía:** `2026-08-30T06:27:29Z`
- **Proyecto Supabase:** `bcecwlkynpgovnzhbpah`
- **Alcance exacto:** `public.riders_men."uciId"` y `public.riders_women."uciId"`.
- **Motivo:** no existe una fuente pública accesible que permita asociar de forma inequívoca y completa los códigos de licencia UCI de 11 cifras a las fichas actuales. El ranking público consultado solo cubre las categorías élite vigentes y sus identificadores no son uniformes.
- **Fuera de alcance:** `uciProfileId`, `globalRiderId`, resultados, startlists, afiliaciones, equipos y cualquier otra columna o tabla.

## Fotografía de datos antes del backup

| Métrica | Valor |
|---|---:|
| Filas `riders_men` | 9.459 |
| Filas `riders_women` | 3.215 |
| Filas totales | 12.674 |
| `uciId` no nulos | 34 |
| `uciId` no nulos en hombres | 5 |
| `uciId` no nulos en mujeres | 29 |
| `uciId` nulos | 12.640 |
| Valores con 11 cifras | 34 |
| Valores inválidos | 0 |
| MD5 ordenado de `gender`, `rider_id`, `uci_id` | `a91eb000aefdcc9bace5cdc079fc5fdb` |

## Dependencias comprobadas

La columna tiene únicamente los índices `uq_riders_men_uci_id` y `uq_riders_women_uci_id` y los checks `riders_men_uci_license_11_check` y `riders_women_uci_license_11_check`. No hay vistas, funciones ni triggers de base de datos que dependan de ella.

## Procedimiento autorizado

1. Crear `private.uci_id_drop_20260830_backup` mediante migración DDL, copiando todas las filas de ambas tablas con sus identificadores y valores actuales.
2. Verificar recuento y huella del backup mediante Supabase MCP.
3. Aplicar una migración DDL separada que elimine las dos columnas; PostgreSQL retirará sus índices y checks dependientes junto con ellas.
4. Adaptar los generadores locales para que no emitan SQL contra `uciId` ni intenten propagarlo a las fichas. Los valores `uciId` de payloads externos se conservan solo donde formen parte del contrato de parsing de resultados y no se escriben en la base de datos.
5. Verificar esquema, backup, referencias intactas y ausencia de referencias de código a columnas de fichas inexistentes.

No se ejecutará ningún rollback automático. El backup privado se conserva.

## Resultado verificado

- **Backup:** `private.uci_id_drop_20260830_backup`, operación `drop-uci-license-column-20260830`.
- **Fotografía del backup:** 12.674 filas completas, 9.459 hombres y 3.215 mujeres; 34 `uciId` no nulos (5 hombres y 29 mujeres), todos válidos; MD5 `a91eb000aefdcc9bace5cdc079fc5fdb`.
- **Hora del backup:** `2026-08-30T06:28:23.985477Z`.
- **Migración aplicada:** `20260830063000_drop_uci_license_columns.sql` mediante Supabase MCP.
- **Esquema posterior:** `uciId` ya no existe en ninguna de las dos tablas; `uciProfileId` permanece en ambas. Los índices y checks de `uciId` ya no existen.
- **Referencias comprobadas después:** 9.457 fichas masculinas, 3.215 femeninas, 52.790 filas de startlist, 307.816 resultados y 4.940 afiliaciones. `startlist_riders.globalRiderId` nulos: 0; `race_uci_results.globalRiderId` nulos: 7.050.
- **Cambio concurrente detectado:** entre la fotografía y la auditoría posterior desaparecieron las fichas `aranburu-alex` y `aranburu-deva-alex` de `riders_men`. La migración de retirada solo ejecutó DDL y no restauró ni modificó esas filas. Quedan referencias históricas a `aranburu-alex` en resultados; no forman parte de esta operación.

## Estado

Operación terminada y verificada. El backup privado se conserva. La ingesta global de códigos UCI queda anulada hasta disponer de una fuente oficial accesible y una clave de identidad determinista.
